const cds = require('@sap/cds')
const { DELETE, SELECT } = cds.ql

const LOG = cds.log('cds-data-federation')
const { getEntityCacheRegistry } = require('./EntityCacheRegistry')
const { getEntityCacheDbResolver } = require('./EntityCacheDbResolver')
const {
    globalEntityCacheOptions,
    resolveEntityCacheOptions,
    effectiveTtlMs,
    cacheTenantKey,
    STATIC_TENANT_KEY,
} = require('./entity-cache-options')
const { usesEntityCacheAnnotation } = require('./cache-schema')

class EntityCacheCoordinator {
    constructor() {
        this._intervals = []
        this._started = false
    }

    registerFromConfigs(configs) {
        const registry = getEntityCacheRegistry()
        for (const cfg of configs) {
            if (cfg.strategy !== 'delegate' || !usesEntityCacheAnnotation(cfg) || !cfg.entityCache?.storageFqn) continue
            const resolved = resolveEntityCacheOptions(cfg.options?.cache || {})
            registry.registerConfig(cfg.entityFullName, {
                entityFullName: cfg.entityFullName,
                entityName: cfg.entityName,
                sourceService: cfg.sourceService,
                sourceEntity: cfg.sourceEntity,
                storageFqn: cfg.entityCache.storageFqn,
                pipelineName: cfg.entityCache.pipelineName,
                dbServiceName: cfg.entityCache.dbServiceName,
                perTenantFiles: cfg.entityCache.perTenantFiles,
                viewMapping: cfg.viewMapping,
                resolved,
            })
        }
    }

    startIntervals() {
        if (this._started) return
        this._started = true
        const opts = globalEntityCacheOptions()
        if (opts.check > 0) {
            const checkTimer = setInterval(() => {
                this.pruneAll().catch((err) => {
                    LOG.warn(`Entity-cache prune failed: ${err.message}`)
                })
            }, opts.check)
            checkTimer.unref()
            this._intervals.push(checkTimer)
        }
        if (opts.stats > 0) {
            const statsTimer = setInterval(() => {
                this.logStats()
            }, opts.stats)
            statsTimer.unref()
            this._intervals.push(statsTimer)
        }
    }

    logStats() {
        const registry = getEntityCacheRegistry()
        const s = registry.statsSnapshot()
        if (s.hits === 0 && s.missed === 0) return
        LOG.info('Entity-cache statistics', s)
    }

    async preloadOnBoot() {
        const registry = getEntityCacheRegistry()
        const defaultTenant = getEntityCacheDbResolver().resolveTenantId()
        for (const meta of registry.allConfigs()) {
            if (!meta.resolved?.preload) continue
            try {
                await this.refreshEntity(meta.entityFullName, defaultTenant, { reason: 'boot-preload' })
            } catch (err) {
                LOG.warn(`Entity-cache boot preload failed for '${meta.entityFullName}': ${err.message}`)
            }
        }
    }

    async preloadForTenant(tenant) {
        const registry = getEntityCacheRegistry()
        for (const meta of registry.allConfigs()) {
            if (!meta.resolved?.preload) continue
            try {
                await this.refreshEntity(meta.entityFullName, tenant, { reason: 'tenant-preload' })
            } catch (err) {
                LOG.warn(`Entity-cache tenant preload failed for '${meta.entityFullName}': ${err.message}`)
            }
        }
    }

    async refreshGroup(groupName, tenant) {
        const registry = getEntityCacheRegistry()
        const members = registry.groupMembers(groupName)
        for (const entityFullName of members) {
            await this.refreshEntity(entityFullName, tenant, { reason: 'group-refresh' })
        }
    }

    async refreshEntity(entityFullName, tenant, _opts = {}) {
        const registry = getEntityCacheRegistry()
        const meta = registry.getConfig(entityFullName)
        if (!meta?.pipelineName) {
            throw new Error(`No entity-cache pipeline registered for '${entityFullName}'`)
        }
        const tenantKey = cacheTenantKey(tenant, meta.resolved?.static)
        await this.ensureCapacity(tenantKey, entityFullName)
        const ps = await cds.connect.to('data-pipeline')
        const execOpts = { mode: 'delta' }
        if (tenant != null && String(tenant) !== '' && !meta.resolved?.static) {
            execOpts.tenant = String(tenant)
        }
        await ps.execute(meta.pipelineName, execOpts)
        if (meta.resolved?.validate !== false) {
            await this.validateCounts(meta, tenantKey)
        }
        const bytes = await this.estimateTableBytes(meta, tenantKey)
        registry.markFresh(entityFullName, tenantKey, bytes)
        return { entityFullName, tenant: tenantKey, bytes }
    }

    async ensureCapacity(tenantKey, excludeEntityFullName) {
        const opts = globalEntityCacheOptions()
        if (!opts.size || opts.size <= 0) return
        const registry = getEntityCacheRegistry()
        while (registry.totalBytes(tenantKey) >= opts.size) {
            const victim = registry.leastRecentlyUsed(tenantKey, excludeEntityFullName)
            if (!victim) break
            await this.evictEntity(victim, tenantKey)
        }
    }

    async evictEntity(entityFullName, tenantKey) {
        const registry = getEntityCacheRegistry()
        const meta = registry.getConfig(entityFullName)
        if (!meta) return
        try {
            const db = await this._connectDb(meta, tenantKey)
            await db.run(DELETE.from(meta.storageFqn))
        } catch (err) {
            LOG.warn(`Entity-cache evict failed for ${entityFullName}: ${err.message}`)
        }
        registry.invalidate(entityFullName, tenantKey)
    }

    async pruneAll() {
        const registry = getEntityCacheRegistry()
        for (const tenantKey of registry.tenantsWithEntries()) {
            await this._pruneTenant(tenantKey)
        }
    }

    async _pruneTenant(tenantKey) {
        const opts = globalEntityCacheOptions()
        if (!opts.size || opts.size <= 0) return
        const registry = getEntityCacheRegistry()
        while (registry.totalBytes(tenantKey) > opts.size) {
            const victim = registry.leastRecentlyUsed(tenantKey)
            if (!victim) break
            await this.evictEntity(victim, tenantKey)
        }
    }

    async estimateTableBytes(meta, tenantKey) {
        try {
            const db = await this._connectDb(meta, tenantKey)
            const tableName = meta.storageFqn.split('.').pop()
            const rows = await db.run(
                'SELECT sum(pgsize) AS bytes FROM dbstat WHERE name = ?',
                [tableName],
            )
            const bytes = rows?.[0]?.bytes
            return typeof bytes === 'number' ? bytes : 0
        } catch {
            return 0
        }
    }

    async validateCounts(meta, tenantKey) {
        const remote = await cds.connect.to(meta.sourceService)
        const db = await this._connectDb(meta, tenantKey)
        const remoteRow = await remote.run(
            SELECT.one.from(meta.sourceEntity).columns('count(*) as cnt'),
        )
        const localRow = await db.run(
            SELECT.one.from(meta.storageFqn).columns('count(*) as cnt'),
        )
        const remoteCount = remoteRow?.cnt ?? remoteRow?.CNT
        const localCount = localRow?.cnt ?? localRow?.CNT
        if (remoteCount == null || localCount == null) return true
        if (Number(remoteCount) !== Number(localCount)) {
            LOG.warn(
                `Entity-cache count mismatch for '${meta.entityFullName}': remote=${remoteCount} local=${localCount}`,
            )
            getEntityCacheRegistry().invalidate(meta.entityFullName, tenantKey)
            return false
        }
        return true
    }

    async measureQuery(fnCache, fnRemote) {
        let timeCache = 0
        let timeRemote = 0
        const [cacheResult] = await Promise.all([
            (async () => {
                const start = performance.now()
                const result = await fnCache()
                timeCache = performance.now() - start
                return result
            })(),
            (async () => {
                const start = performance.now()
                await fnRemote()
                timeRemote = performance.now() - start
            })(),
        ])
        const savedPercent =
            timeRemote > 0 ? Math.round(((timeRemote - timeCache) / timeRemote) * 100) : 0
        LOG.info('Entity-cache measurement', {
            timeCache: Math.round(timeCache),
            timeRemote: Math.round(timeRemote),
            savedPercent,
        })
        return cacheResult
    }

    async _connectDb(meta, tenantKey) {
        const resolver = getEntityCacheDbResolver()
        if (meta.perTenantFiles) {
            if (meta.resolved?.static || tenantKey === STATIC_TENANT_KEY) {
                return resolver.connectStatic()
            }
            const tid = tenantKey === '' ? resolver.resolveTenantId() : tenantKey
            return resolver.connect(tid)
        }
        return cds.connect.to(meta.dbServiceName || 'db')
    }

    resolveTtlForEntity(entityFullName) {
        const meta = getEntityCacheRegistry().getConfig(entityFullName)
        if (!meta) return effectiveTtlMs(resolveEntityCacheOptions())
        return effectiveTtlMs(meta.resolved)
    }
}

let _singleton

function getEntityCacheCoordinator() {
    return (_singleton ||= new EntityCacheCoordinator())
}

module.exports = {
    EntityCacheCoordinator,
    getEntityCacheCoordinator,
}
