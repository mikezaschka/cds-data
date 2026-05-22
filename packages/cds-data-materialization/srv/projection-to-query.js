const cds = require('@sap/cds')

const AGGREGATE_FUNCS = new Set(['sum', 'count', 'min', 'max', 'avg'])

/**
 * Builds a non-async source.query closure from a materialize entity's CSN projection.
 *
 * @param {object} params
 * @param {string} params.sourceFrom - Fully qualified SELECT.from target (e.g. consumer.SourceOrders)
 * @param {object} params.projection - entityDef.projection from CSN
 * @returns {() => object} closure for addPipeline source.query
 */
function compileProjectionToQuery({ sourceFrom, projection }) {
    if (!projection?.from?.ref?.length) {
        throw new Error('compileProjectionToQuery: projection.from.ref is required')
    }
    if (!projection.columns?.length) {
        throw new Error('compileProjectionToQuery: projection.columns is required')
    }

    const columnSpecs = projection.columns.map(csnColumnToSelectArg)
    const groupBySpecs = (projection.groupBy || []).map(gb => groupByRefToArg(gb))
    const staticWhere = projection.where || null

    return () => {
        let q = SELECT.from(sourceFrom).columns(...columnSpecs)
        if (groupBySpecs.length > 0) {
            q = q.groupBy(...groupBySpecs)
        }
        if (staticWhere) {
            q = q.where(staticWhere)
        }
        return q
    }
}

/**
 * Resolves the SELECT.from target for the configured CQN service.
 */
/**
 * Fully qualified CSN entity for SELECT.from — independent of cds.requires
 * service name (e.g. `db` vs `consumer.SourceOrders`).
 */
function resolveSourceFrom({ projection, entityFqn }) {
    const fromRef = projection.from.ref

    if (fromRef.length >= 2) {
        return fromRef.join('.')
    }

    const single = fromRef[0]
    if (typeof single === 'string' && single.includes('.')) {
        return single
    }

    const namespace = entityFqn.includes('.') ? entityFqn.split('.').slice(0, -1).join('.') : null
    if (namespace) {
        return `${namespace}.${single}`
    }
    return single
}

function csnColumnToSelectArg(col) {
    if (col.func) {
        return {
            func: col.func,
            args: normalizeFuncArgs(col.args),
            as: col.as,
        }
    }

    const remoteName = col.ref?.[0]
    if (!remoteName) {
        throw new Error('compileProjectionToQuery: column without ref or func is not supported')
    }
    if (col.as && col.as !== remoteName) {
        return { ref: [remoteName], as: col.as }
    }
    return col.key ? { ref: [remoteName] } : remoteName
}

function normalizeFuncArgs(args) {
    if (!args || args.length === 0) return args
    return args.map(arg => {
        if (arg === '*') return { val: 1 }
        return arg
    })
}

function groupByRefToArg(gb) {
    const name = gb.ref?.[0]
    if (!name) {
        throw new Error('compileProjectionToQuery: groupBy entry without ref')
    }
    return name
}

/**
 * Returns true when the projection is a supported materialize shape.
 */
function isAggregationShaped(projection) {
    if (!projection) return false
    const hasGroupBy = Array.isArray(projection.groupBy) && projection.groupBy.length > 0
    const hasAgg = (projection.columns || []).some(c => c.func && AGGREGATE_FUNCS.has(c.func))
    return hasGroupBy || hasAgg
}

/**
 * Rejects columns that cannot be compiled (joins, nested refs, etc.).
 */
function validateSupportedProjection(entityName, projection) {
    if (!projection) {
        throw new Error(`@materialize.snapshot on '${entityName}': entity must be a projection`)
    }
    if (!isAggregationShaped(projection)) {
        throw new Error(
            `@materialize.snapshot on '${entityName}': projection must include group by or aggregate functions (sum, count, min, max, avg)`
        )
    }

    for (const col of projection.columns || []) {
        if (col.ref && col.ref.length > 1) {
            throw new Error(
                `@materialize.snapshot on '${entityName}': path expressions in select are not supported (${col.ref.join('.')})`
            )
        }
        if (col.expand || col.join) {
            throw new Error(`@materialize.snapshot on '${entityName}': expand/join columns are not supported`)
        }
    }
}

module.exports = {
    compileProjectionToQuery,
    resolveSourceFrom,
    isAggregationShaped,
    validateSupportedProjection,
}
