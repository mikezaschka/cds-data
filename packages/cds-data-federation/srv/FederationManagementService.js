const cds = require('@sap/cds')
const { getFederationConfigs, getFederationConfig } = require('./federation-registry')
const { resolveWriteFlags } = require('./annotation-scanner')
const { refreshEntityCache } = require('./entity-cache/public-api')
const delegateMetrics = require('./metrics/delegate-metrics')
const { applyExpandedSemantics } = require('./delegation/cqn-evaluator')

const LOG = cds.log('cds-data-federation')

const PIPELINE_SERVICE = 'data-pipeline'
const PIPELINE_API = 'DataPipelineManagementService'
const CACHING_API = 'plugin.cds_caching.CachingApiService'

/**
 * The scanner keeps projected columns in the shape the remote fetch needs: a
 * plain name for a column taken as-is, a CQN ref such as
 * `{ ref: ['BusinessPartner'], as: 'ID' }` for one renamed with `as`. This API
 * promises remote column names, so flatten here rather than change the
 * scanner, which other code relies on. Passed through unflattened, a renamed
 * view came back as `[object Object]` — the `array of String` type does not
 * make CAP coerce anything.
 */
function remoteColumnName(column) {
    if (typeof column === 'string') return column
    if (Array.isArray(column?.ref)) return column.ref.join('.')
    return String(column?.name ?? column)
}

/**
 * Federation management API (ADR 0017).
 *
 * Reads the other plugins' services rather than embedding or copying them: the
 * pipeline name comes from the engine's own registry, and the detail links
 * point at whichever management surfaces are actually served.
 */
class FederationManagementService extends cds.ApplicationService {

    async init() {
        this.on('READ', 'FederatedEntities', req => this._read(req))
        this.on('refreshReplica', 'FederatedEntities', req => this._refreshReplica(req))
        this.on('refreshEntityCache', 'FederatedEntities', req => this._refreshEntityCache(req))
        this.on('invalidate', 'FederatedEntities', req => this._invalidate(req))
        this.on('setMetricsCollection', req => this._setMetricsCollection(req))
        return super.init()
    }

    // ─── reads ────────────────────────────────────────────────────────────────

    /**
     * The rows are computed, not stored, so CAP applies none of the query for
     * us: `$filter`, `$orderby` and `$top` all arrive as CQN that this handler
     * has to honour itself. Returning every row and ignoring them looks fine
     * until a client filters and gets the unfiltered set back.
     *
     * `applyExpandedSemantics` is federation's own CQN-over-JS-rows evaluator,
     * already used for locally-resolved expands.
     */
    async _read(req) {
        let rows = getFederationConfigs().map(cfg => this._toRow(cfg))

        // A by-key read arrives as `req.data.entity` with no `where` at all,
        // so the CQN path below would never narrow it.
        const key = req.data?.entity
        if (key) rows = rows.filter(row => row.entity === key)

        const select = req.query?.SELECT || {}
        const entityDef = req.target
        try {
            // Project last: a $filter or $orderby may name a column $select leaves out.
            const matched = applyExpandedSemantics(rows, select.where, select.orderBy, select.limit, entityDef)
            return this._project(matched, select.columns, entityDef)
        } catch (err) {
            // An unsupported predicate must not silently return everything.
            LOG.warn('federation management: unsupported query —', err.message)
            return req.reject(400, `Unsupported query on FederatedEntities: ${err.message}`)
        }
    }

    /**
     * `$select` arrives as `SELECT.columns`, which CAP's OData layer then
     * serialises as given: return whole rows and every field goes back. Only
     * plain element refs are meaningful on this flat entity; anything else is
     * refused rather than silently widened to the full row. The key always
     * stays, as it does on any CAP-served entity.
     */
    _project(rows, columns, entityDef) {
        if (!Array.isArray(columns) || columns.length === 0 || columns.includes('*')) return rows
        const picks = columns.map(column => {
            if (column === '*' || column?.ref?.[0] === '*') return null
            if (!Array.isArray(column?.ref) || column.ref.length !== 1) {
                throw new Error(`only plain elements can be selected, got ${JSON.stringify(column)}`)
            }
            const [name] = column.ref
            if (entityDef?.elements && !entityDef.elements[name]) throw new Error(`no element '${name}'`)
            return { from: name, as: column.as || name }
        })
        if (picks.includes(null)) return rows
        const keys = Object.keys(entityDef?.keys || { entity: 1 })
        for (const key of keys) {
            if (!picks.some(pick => pick.as === key)) picks.unshift({ from: key, as: key })
        }
        const project = row => Object.fromEntries(picks.map(({ from, as }) => [as, row[from]]))
        return Array.isArray(rows) ? rows.map(project) : rows && project(rows)
    }

    _toRow(cfg) {
        const flags = resolveWriteFlags(cfg.options || {})
        const verbs = ['create', 'update', 'delete'].filter(v => flags[v])
        const vm = cfg.viewMapping || {}
        const cacheStrategy = cfg.options?.cache?.strategy || null
        const pipeline = this._pipelineNameFor(cfg)

        const pipelineDetail = this._pipelineDetail(pipeline)
        const cacheDetail = this._cacheDetail(cfg, cacheStrategy)

        return {
            entity: cfg.entityFullName,
            name: cfg.entityName,
            service: cfg.serviceName,
            strategy: cfg.strategy,
            cacheStrategy,
            sourceService: cfg.sourceService,
            sourceEntity: cfg.sourceEntity,
            writable: verbs.length > 0,
            writeVerbs: verbs.join(','),
            wildcardProjection: vm.isWildcard === true,
            scoped: vm.staticWhere != null,
            projectedColumns: vm.isWildcard ? [] : (vm.projectedColumns || []).map(remoteColumnName),
            renames: Object.entries(vm.localToRemote || {})
                .filter(([local, remote]) => local !== remote)
                .map(([local, remote]) => ({ local, remote })),
            pipeline,
            cacheTag: cacheStrategy === 'response' ? `federation:${cfg.entityName}` : null,
            metricsEnabled: delegateMetrics.isEnabled(),
            metricsCollecting: delegateMetrics.isCollecting(),
            ...pipelineDetail,
            ...cacheDetail,
        }
    }

    /**
     * ADR 0018 — ask the engine which pipeline carries this view rather than
     * re-deriving the name here. Two plugins deriving the same name the same
     * way is how they drift apart.
     */
    _pipelineNameFor(cfg) {
        const engine = cds.services[PIPELINE_SERVICE]
        if (!engine || typeof engine.pipelineForEntity !== 'function') return null
        return engine.pipelineForEntity(cfg.entityFullName)?.name ?? null
    }

    _pipelineDetail(pipeline) {
        if (!pipeline) {
            return { pipelineDetail: null, pipelineDetailUnavailable: null }
        }
        const api = cds.services[PIPELINE_API]
        if (!api) {
            return {
                pipelineDetail: null,
                pipelineDetailUnavailable:
                    "cds-data-pipeline management API not served — set requires.data-pipeline.management.reuse.api",
            }
        }
        const base = api.path || '/pipeline'
        return {
            pipelineDetail: `${base}/Pipelines('${pipeline}')`,
            pipelineDetailUnavailable: null,
        }
    }

    _cacheDetail(cfg, cacheStrategy) {
        if (cacheStrategy !== 'response') {
            return { cacheDetail: null, cacheDetailUnavailable: null }
        }
        const api = cds.services[CACHING_API]
        if (!api) {
            return {
                cacheDetail: null,
                cacheDetailUnavailable:
                    'cds-caching API not served — set requires.<cache>.metrics.reuse.api',
            }
        }
        const base = api.path || '/odata/v4/caching-api'
        // Encode the whole expression, not just the tag: a half-encoded query
        // string (escaped value, raw spaces) is rejected by the OData parser.
        const filter = encodeURIComponent(`tag eq 'federation:${cfg.entityName}'`)
        return {
            cacheDetail: `${base}/TagMetrics?$filter=${filter}`,
            cacheDetailUnavailable: null,
        }
    }

    // ─── actions ──────────────────────────────────────────────────────────────

    /** The bound action's key, whichever way the client addressed it. */
    _subject(req) {
        const key = req.data?.entity ?? req.params?.[0]?.entity ?? req.params?.[0]
        const cfg = getFederationConfig(typeof key === 'string' ? key : undefined)
        if (!cfg) req.reject(404, `Not a federated entity: '${key}'`)
        return cfg
    }

    async _refreshReplica(req) {
        const cfg = this._subject(req)
        if (cfg.strategy !== 'replicate') {
            req.reject(400, `'${cfg.entityFullName}' is not replicated — refreshReplica applies to @federation.replicate only`)
        }
        const engine = await this._pipelineEngine(req)
        const pipeline = engine.pipelineForEntity(cfg.entityFullName)
        if (!pipeline) {
            req.reject(404, `No pipeline registered for '${cfg.entityFullName}'`)
        }

        const keys = this._parseKeys(req)
        if (keys) {
            await engine.executeEvent(pipeline.name, { event: { read: 'key', keys } })
            return this._result(cfg, 'executeEvent', `Refreshed one row of '${pipeline.name}'`)
        }
        await engine.execute(pipeline.name, { trigger: 'external' })
        return this._result(cfg, 'execute', `Started a run of '${pipeline.name}'`)
    }

    async _refreshEntityCache(req) {
        const cfg = this._subject(req)
        if (cfg.options?.cache?.strategy !== 'entity') {
            req.reject(400, `'${cfg.entityFullName}' has no entity cache — set cache.strategy: 'entity' to use this`)
        }
        await refreshEntityCache(cfg.entityFullName)
        return this._result(cfg, 'refreshEntityCache', `Refilled the snapshot of '${cfg.entityFullName}'`)
    }

    async _invalidate(req) {
        const cfg = this._subject(req)
        if (cfg.options?.cache?.strategy !== 'response') {
            req.reject(400, `'${cfg.entityFullName}' has no response cache — set cache.strategy: 'response' to use this`)
        }
        const serviceName = cfg.options.cache.service || 'caching'
        let cache
        try {
            cache = await cds.connect.to(serviceName)
        } catch (err) {
            req.reject(503, `Cache service '${serviceName}' is not available: ${err.message}`)
        }
        const tag = `federation:${cfg.entityName}`
        await cache.deleteByTag(tag)
        return this._result(cfg, 'deleteByTag', `Dropped entries tagged '${tag}'`)
    }

    async _setMetricsCollection(req) {
        const enabled = req.data?.enabled ?? null
        try {
            const collecting = await delegateMetrics.setCollecting(enabled)
            return {
                enabled: delegateMetrics.isEnabled(),
                collecting,
                message: enabled === null
                    ? `Cleared the override; collection follows configuration and is ${collecting ? 'on' : 'off'}`
                    : `Collection ${collecting ? 'resumed' : 'paused'}`,
            }
        } catch (err) {
            return req.reject(400, err.message)
        }
    }

    async _pipelineEngine(req) {
        try {
            return await cds.connect.to(PIPELINE_SERVICE)
        } catch (err) {
            LOG.warn('federation management: data-pipeline unreachable:', err.message)
            return req.reject(503, `cds-data-pipeline is not available: ${err.message}`)
        }
    }

    /** `keys` arrives as JSON so one action covers every key shape. */
    _parseKeys(req) {
        const raw = req.data?.keys
        if (raw == null || raw === '') return null
        let parsed
        try {
            parsed = JSON.parse(raw)
        } catch {
            return req.reject(400, `keys must be a JSON object, for example {"ID":"EA0018","date":"2027-06-06"}`)
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) {
            return req.reject(400, `keys must be a non-empty JSON object`)
        }
        return parsed
    }

    _result(cfg, action, message) {
        return { entity: cfg.entityFullName, action, message }
    }
}

module.exports = FederationManagementService
