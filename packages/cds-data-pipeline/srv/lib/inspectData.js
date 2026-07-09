const cds = require('../runtime-cds')
const { withRetry } = require('./retry')
const { resolveSourceEntityRef } = require('../adapters/lib/entityShapeReadStream')
const { sourceAdapterRetryOptions } = require('../adapters/lib/sourceAdapterRetryOptions')
const { auditSensitiveRead } = require('./inspectAudit')

const LOG = cds.log('cds-data-pipeline')

const VALID_OPS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains'])
const DEFAULT_TOP = 50
const MAX_TOP = 200

/**
 * Human-readable schedule label for the management UI tracker row.
 *
 * @param {number|string|object|undefined} schedule
 * @returns {string|null}
 */
function formatScheduleLabel(schedule) {
    if (schedule == null) return null
    if (typeof schedule === 'number') {
        return schedule >= 60000 && schedule % 60000 === 0
            ? `every ${schedule / 60000} min`
            : `every ${schedule} ms`
    }
    if (typeof schedule === 'string') return schedule
    if (typeof schedule === 'object' && schedule.every != null) {
        const every = schedule.every
        const everyLabel = typeof every === 'number'
            ? (every >= 60000 && every % 60000 === 0 ? `${every / 60000} min` : `${every} ms`)
            : String(every)
        const engine = schedule.engine ? ` (${schedule.engine})` : ''
        return `every ${everyLabel}${engine}`
    }
    return String(schedule)
}

function parseFilters(raw) {
    if (!raw) return []
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!Array.isArray(parsed)) return []
        return parsed.filter(
            (f) => f && typeof f.field === 'string' && VALID_OPS.has(f.op)
        )
    } catch {
        return []
    }
}

function buildWhereClause(filters) {
    if (!filters.length) return undefined
    const clauses = filters.map((f) => {
        const { field, op, value } = f
        switch (op) {
            case 'eq':
                return { [field]: value }
            case 'ne':
                return { [field]: { '!=': value } }
            case 'gt':
                return { [field]: { '>': value } }
            case 'ge':
                return { [field]: { '>=': value } }
            case 'lt':
                return { [field]: { '<': value } }
            case 'le':
                return { [field]: { '<=': value } }
            case 'contains':
                return { [field]: { like: `%${String(value)}%` } }
            default:
                return {}
        }
    })
    if (clauses.length === 1) return clauses[0]
    return { and: clauses }
}

function elementType(el) {
    if (!el) return 'String'
    if (el.type) return String(el.type)
    if (el.items) return 'Array'
    return 'String'
}

function modelDef(entityName) {
    if (!entityName) return undefined
    const defs = cds.model?.definitions
    if (!defs) return undefined
    if (defs[entityName]) return defs[entityName]
    const suffix = `.${entityName}`
    const match = Object.keys(defs).find((key) => key === entityName || key.endsWith(suffix))
    return match ? defs[match] : undefined
}

function isEntityHidden(def) {
    return !!def?.['@HideFromDataInspector']
}

function hiddenElementSet(def) {
    const hidden = new Set()
    if (!def?.elements) return hidden
    for (const [name, el] of Object.entries(def.elements)) {
        if (el?.['@HideFromDataInspector']) hidden.add(name)
    }
    return hidden
}

function isInspectableElement(el) {
    if (!el || el.virtual) return false
    if (el.type === 'cds.Association' || el.type === 'cds.Composition') return false
    if (el['@HideFromDataInspector']) return false
    return true
}

function allowedColumns(entityName, selected) {
    const def = modelDef(entityName)
    if (!def?.elements) {
        return (selected || []).filter(Boolean)
    }
    const hidden = hiddenElementSet(def)
    const modeled = Object.keys(def.elements).filter(
        (name) => isInspectableElement(def.elements[name]) && !hidden.has(name),
    )
    if (selected?.length) {
        return selected.filter((name) => modeled.includes(name))
    }
    return modeled
}

function emptyHiddenInspectResult() {
    return {
        columns: [],
        rows: [],
        hasMore: false,
        limitedSupport: true,
    }
}

function columnsFromModel(entityName, selectedColumns) {
    const def = modelDef(entityName)
    if (!def?.elements) {
        return (selectedColumns || []).map((name) => ({ name, type: 'String' }))
    }
    const names = allowedColumns(entityName, selectedColumns?.length ? selectedColumns : undefined)
    return names.map((name) => ({
        name,
        type: elementType(def.elements[name]),
    }))
}

function columnsFromRows(rows, selectedColumns) {
    if (!rows?.length) {
        return (selectedColumns || []).map((name) => ({ name, type: 'String' }))
    }
    const keys = selectedColumns?.length
        ? selectedColumns
        : Object.keys(rows[0])
    return keys.map((name) => ({ name, type: typeof rows[0][name] }))
}

function projectRows(rows, columnNames) {
    if (!columnNames?.length) return rows
    return rows.map((row) => {
        const out = {}
        for (const col of columnNames) {
            if (Object.prototype.hasOwnProperty.call(row, col)) {
                out[col] = row[col]
            }
        }
        return out
    })
}

function applyInMemoryFilters(rows, filters) {
    if (!filters.length) return rows
    return rows.filter((row) =>
        filters.every(({ field, op, value }) => {
            const cell = row[field]
            const str = cell == null ? '' : String(cell)
            const cmp = value == null ? '' : String(value)
            switch (op) {
                case 'eq':
                    return str === cmp
                case 'ne':
                    return str !== cmp
                case 'gt':
                    return str > cmp
                case 'ge':
                    return str >= cmp
                case 'lt':
                    return str < cmp
                case 'le':
                    return str <= cmp
                case 'contains':
                    return str.toLowerCase().includes(cmp.toLowerCase())
                default:
                    return true
            }
        })
    )
}

async function runEntityQuery(service, entityName, { columns, filters, top, skip, auditCtx }) {
    const columnNames = allowedColumns(entityName, columns?.length ? columns : undefined)
    if (!columnNames.length) {
        return emptyHiddenInspectResult()
    }
    let query = SELECT.from(entityName).columns(...columnNames)
    const where = buildWhereClause(filters)
    if (where) {
        query = query.where(where)
    }
    query = query.limit(top + 1, skip)
    const rows = await withRetry(
        () => service.run(query),
        sourceAdapterRetryOptions({ maxRetries: 2 })
    )
    const list = Array.isArray(rows) ? rows : []
    const hasMore = list.length > top
    const page = projectRows(hasMore ? list.slice(0, top) : list, columnNames)
    const result = {
        columns: columnsFromModel(entityName, columnNames),
        rows: page,
        hasMore,
    }
    await auditSensitiveRead(entityName, result.columns.map((c) => c.name), auditCtx)
    return result
}

async function inspectTarget(pipeline, { columns, filters, top, skip, auditCtx }) {
    const config = pipeline.config
    if (typeof config.target?.adapter === 'function') {
        return inspectCustomAdapterSide(config.target?.entity, columns)
    }
    const entity = config.target?.entity
    if (!entity) {
        throw new Error(`inspectData: pipeline '${pipeline.name}' has no target.entity`)
    }
    if (isEntityHidden(modelDef(entity))) {
        return emptyHiddenInspectResult()
    }
    const svcName = config.target?.service || 'db'
    const service = await cds.connect.to(svcName)
    return runEntityQuery(service, entity, { columns, filters, top, skip, auditCtx })
}

async function inspectSourceEntity(pipeline, tracker, { columns, filters, top, skip, auditCtx }) {
    const config = pipeline.config
    const source = config.source
    if (typeof source?.adapter === 'function') {
        return inspectCustomAdapterSide(source.entity, columns)
    }
    if (!source?.entity) {
        throw new Error(`inspectData: pipeline '${pipeline.name}' has no source.entity`)
    }
    const service = pipeline.adapter?.service || await cds.connect.to(source.service)
    const entityRef = resolveSourceEntityRef(service, source.entity)
    if (isEntityHidden(modelDef(entityRef)) || isEntityHidden(modelDef(source.entity))) {
        return emptyHiddenInspectResult()
    }
    return runEntityQuery(service, entityRef, { columns, filters, top, skip, auditCtx })
}

function inspectCustomAdapterSide(entityName, selectedColumns) {
    return {
        columns: columnsFromModel(entityName, selectedColumns),
        rows: [],
        hasMore: false,
        limitedSupport: true,
    }
}

async function inspectSourceQuery(pipeline, tracker, { columns, filters, top, skip }) {
    const sourceConfig = pipeline.config.source
    if (typeof sourceConfig.query !== 'function') {
        throw new Error(`inspectData: source.query is not a function for pipeline '${pipeline.name}'`)
    }
    const built = sourceConfig.query(tracker)
    if (!built?.SELECT && !built?.select) {
        throw new Error(`inspectData: source.query(tracker) must return a SELECT CQN`)
    }
    const plain = built.SELECT ? { SELECT: built.SELECT } : built
    const service = pipeline.adapter?.service || await cds.connect.to(sourceConfig.service)
    let rows = await withRetry(
        () => service.run(plain),
        sourceAdapterRetryOptions(sourceConfig)
    )
    rows = Array.isArray(rows) ? rows : []
    rows = applyInMemoryFilters(rows, filters)
    const columnNames = columns?.length ? columns : undefined
    rows = projectRows(rows, columnNames)
    const page = rows.slice(skip, skip + top + 1)
    const hasMore = page.length > top
    const resultRows = hasMore ? page.slice(0, top) : page
    return {
        columns: columnsFromRows(resultRows.length ? resultRows : rows, columnNames),
        rows: resultRows,
        hasMore,
        limitedSupport: true,
    }
}

async function inspectSourceRest(pipeline, tracker, { columns, filters, top, skip }) {
    const adapter = pipeline.adapter
    if (!adapter?._buildParams || !adapter?._buildUrl) {
        throw new Error(`inspectData: REST adapter unavailable for pipeline '${pipeline.name}'`)
    }
    const rest = pipeline.config.rest || {}
    const batchSize = Math.min(top + skip + 1, rest.pagination?.pageSize || pipeline.config.source?.batchSize || 100)
    const params = adapter._buildParams({ page: 1, cursor: null, tracker, batchSize })
    const pathWithParams = adapter._buildUrl(rest.path, params)
    const response = await withRetry(
        () => adapter.service.send({
            method: rest.method || 'GET',
            path: pathWithParams,
            headers: rest.headers || {},
        }),
        sourceAdapterRetryOptions(pipeline.config.source)
    )
    let rows = rest.dataPath
        ? adapter._extractByPath(response, rest.dataPath)
        : (Array.isArray(response) ? response : [])
    rows = Array.isArray(rows) ? rows : []
    rows = applyInMemoryFilters(rows, filters)
    const columnNames = columns?.length ? columns : undefined
    rows = projectRows(rows, columnNames)
    const page = rows.slice(skip, skip + top + 1)
    const hasMore = page.length > top
    const resultRows = hasMore ? page.slice(0, top) : page
    return {
        columns: columnsFromRows(resultRows.length ? resultRows : rows, columnNames),
        rows: resultRows,
        hasMore,
        limitedSupport: true,
    }
}

/**
 * Preview source or target rows for the Pipeline Console data inspector.
 *
 * @param {import('./Pipeline')} pipeline
 * @param {object} opts
 * @param {'source'|'target'} opts.side
 * @param {string[]} [opts.columns]
 * @param {string} [opts.filters] JSON filter array
 * @param {number} [opts.top]
 * @param {number} [opts.skip]
 * @returns {Promise<object>}
 */
/**
 * Whether the Pipeline Console can preview source/target rows for a pipeline.
 *
 * @param {import('./Pipeline')} pipeline
 * @returns {{ source: 'full'|'limited'|'none', target: 'full'|'limited'|'none' }}
 */
function resolveInspectCapabilities(pipeline) {
    const config = pipeline.config || {}
    const source = config.source || {}
    const target = config.target || {}

    function sourceSupport() {
        if (typeof source.adapter === 'function') {
            return 'limited'
        }
        if (source.query) {
            return 'limited'
        }
        if (config.rest?.path || pipeline.adapter?.constructor?.name === 'RestAdapter') {
            return 'limited'
        }
        if (source.entity) {
            if (isEntityHidden(modelDef(source.entity))) return 'none'
            return 'full'
        }
        return 'none'
    }

    function targetSupport() {
        if (typeof target.adapter === 'function') {
            return 'limited'
        }
        if (target.entity) {
            if (isEntityHidden(modelDef(target.entity))) return 'none'
            return 'full'
        }
        return 'none'
    }

    return {
        source: sourceSupport(),
        target: targetSupport(),
    }
}

async function inspectPipelineData(pipeline, opts = {}) {
    const side = opts.side === 'target' ? 'target' : 'source'
    const columns = Array.isArray(opts.columns) ? opts.columns.filter(Boolean) : []
    const filters = parseFilters(opts.filters)
    const top = Math.min(Math.max(Number(opts.top) || DEFAULT_TOP, 1), MAX_TOP)
    const skip = Math.max(Number(opts.skip) || 0, 0)
    const auditCtx = opts.auditCtx || {}

    let result
    if (side === 'target') {
        result = await inspectTarget(pipeline, { columns, filters, top, skip, auditCtx })
    } else {
        const tracker = await pipeline._getTracker()
        const config = pipeline.config
        if (config.source?.query) {
            result = await inspectSourceQuery(pipeline, tracker, { columns, filters, top, skip })
        } else if (config.rest?.path || pipeline.adapter?.constructor?.name === 'RestAdapter') {
            result = await inspectSourceRest(pipeline, tracker, { columns, filters, top, skip })
        } else {
            result = await inspectSourceEntity(pipeline, tracker, { columns, filters, top, skip, auditCtx })
        }
    }

    return JSON.stringify(result)
}

module.exports = {
    inspectPipelineData,
    resolveInspectCapabilities,
    formatScheduleLabel,
    parseFilters,
    buildWhereClause,
    modelDef,
    isEntityHidden,
    allowedColumns,
}
