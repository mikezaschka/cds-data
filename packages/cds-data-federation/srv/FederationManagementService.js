const cds = require('@sap/cds')
const { getFederationConfigs, getFederationConfig } = require('./federation-registry')
const { resolveWriteFlags } = require('./annotation-scanner')
const { refreshEntityCache } = require('./entity-cache/public-api')

const LOG = cds.log('cds-data-federation')

const PIPELINE_SERVICE = 'data-pipeline'
const PIPELINE_API = 'DataPipelineManagementService'
const CACHING_API = 'plugin.cds_caching.CachingApiService'

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
        return super.init()
    }

    // ─── reads ────────────────────────────────────────────────────────────────

    async _read(req) {
        const rows = getFederationConfigs().map(cfg => this._toRow(cfg))
        const key = req.data?.entity ?? this._keyFromQuery(req)
        if (key) return rows.filter(r => r.entity === key)
        return rows
    }

    /** By-key reads arrive as a where clause rather than in `req.data`. */
    _keyFromQuery(req) {
        const where = req.query?.SELECT?.where
        if (!Array.isArray(where)) return undefined
        const i = where.findIndex(t => t?.ref?.[0] === 'entity')
        if (i < 0) return undefined
        return where[i + 2]?.val
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
            projectedColumns: vm.isWildcard ? [] : (vm.projectedColumns || []),
            renames: Object.entries(vm.localToRemote || {})
                .filter(([local, remote]) => local !== remote)
                .map(([local, remote]) => ({ local, remote })),
            pipeline,
            cacheTag: cacheStrategy === 'response' ? `federation:${cfg.entityName}` : null,
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
