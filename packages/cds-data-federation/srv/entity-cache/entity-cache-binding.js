const cds = require('@sap/cds')
const { registerEntityCacheTargetDb } = require('cds-data-pipeline/srv/lib/entity-cache-target-registry')

const LOG = cds.log('cds-data-federation')
const { pipelineDisplayName, usesEntityCacheAnnotation } = require('./cache-schema')
const { resolveEntityCacheOptions } = require('./entity-cache-options')
const { getEntityCacheDbResolver, usesPerTenantSqliteFiles, DEFAULT_SERVICE } = require('./EntityCacheDbResolver')

/** Build allowed payload keys per storage entity definition (omit associations). */
function allowedWriteKeys(storageFqn) {
    const def = cds.model.definitions?.[storageFqn]
    const allowed = new Set()
    const els = def?.elements
    if (!els) return allowed
    for (const name of Object.keys(els)) {
        const el = els[name]
        if (el.target) continue
        allowed.add(name)
    }
    return allowed
}

function registerSanitizeWrites(dataPipelineSrv, pipName, storageFqn) {
    const allowedKeys = allowedWriteKeys(storageFqn)

    dataPipelineSrv.before('PIPELINE.WRITE', pipName, (req) => {
        const batch = req.data.targetRecords || []
        for (const row of batch) {
            if (allowedKeys.size <= 1) continue
            for (const key of Array.from(Object.keys(row))) {
                if (!allowedKeys.has(key)) delete row[key]
            }
        }
    })
}

/**
 * Binds federation entity-cache pipelines (SQLite target, truncate-before-refresh).
 *
 * Per-tenant isolation uses separate SQLite files when `FederationEntityCache` (or
 * `cds-data-federation.entityCache.urlTemplate`) is configured (ADR 0010).
 * Otherwise cache tables attach to the primary `db` (tenant-scoped under CAP MTX).
 */
function stripEntityCacheMetadata(configs) {
    for (const c of configs) {
        if (c.strategy === 'delegate' && usesEntityCacheAnnotation(c)) delete c.entityCache
    }
}

function resolveEntityCacheDbService(opts) {
    if (opts.dbService) return opts.dbService
    if (usesPerTenantSqliteFiles()) return DEFAULT_SERVICE
    return 'db'
}

async function bindEntityCachePipelines(configs, options = {}) {
    const perTenantFiles = usesPerTenantSqliteFiles()
    const svcName = resolveEntityCacheDbService(options)

    const ecConfigs = configs.filter((c) =>
        c.strategy === 'delegate'
        && usesEntityCacheAnnotation(c)
        && c.entityCache
        && !c.entityCacheSkipped
        && c.entityCache.storageFqn)
    if (!ecConfigs.length) return

    if (perTenantFiles) {
        try {
            await cds.connect.to(svcName)
        } catch (_e) {
            LOG.warn(
                `Entity-cache datastore '${svcName}' unavailable — disabling entity caches. ` +
                    `Configure cds.requires.${svcName} (kind: sqlite) for per-tenant cache files.`,
            )
            stripEntityCacheMetadata(configs)
            return
        }
    } else {
        try {
            await cds.connect.to(svcName)
        } catch (_e) {
            LOG.warn(
                `Entity-cache datastore '${svcName}' unavailable — disabling entity caches. ` +
                    'Ensure the primary database is reachable.',
            )
            stripEntityCacheMetadata(configs)
            return
        }
    }

    let dataPipelineSrv
    try {
        dataPipelineSrv = await cds.connect.to('DataPipelineService')
    } catch (err) {
        LOG.warn(`cds-data-pipeline not available — disabling entity caches: ${err.message}`)
        stripEntityCacheMetadata(configs)
        return
    }

    const resolver = getEntityCacheDbResolver()

    for (const c of ecConfigs) {
        await registerOneEntityCachePipeline(dataPipelineSrv, c, svcName, perTenantFiles, resolver)
    }

    if (ecConfigs.length) {
        LOG.info(
            `Bound ${ecConfigs.length} entity-cache pipeline(s) → ${svcName}` +
                (perTenantFiles ? ' (per-tenant SQLite files)' : ''),
        )
    }
}

async function registerOneEntityCachePipeline(dataPipelineSrv, cfg, svcName, perTenantFiles, resolver) {
    const pip = pipelineDisplayName(cfg)
    const cacheOpts = cfg.options.cache || {}
    const bs = Number(cacheOpts.batchSize) || 1000

    const flags = {
        entityCacheRefreshTruncate: true,
    }
    if (perTenantFiles) {
        flags.entityCachePerTenantDb = true
    }

    await dataPipelineSrv.addPipeline({
        name: pip,
        description: `Federation entity-cache for '${cfg.entityFullName}'`,
        source: {
            service: cfg.sourceService,
            entity: cfg.sourceEntity,
            batchSize: bs,
        },
        target: {
            entity: cfg.entityCache.storageFqn,
            service: svcName,
        },
        mode: 'delta',
        delta: { mode: 'none', field: 'modifiedAt' },
        viewMapping: cfg.viewMapping,
        flags,
    })

    if (perTenantFiles) {
        const useStatic = cfg.entityCache.static === true
        registerEntityCacheTargetDb(pip, () => {
            if (useStatic) return resolver.connectStatic()
            const { currentEntityCacheTenant } = require('cds-data-pipeline/srv/lib/entity-cache-tenant')
            const tid =
                currentEntityCacheTenant() ??
                cds.context?.tenant ??
                cds.context?.user?.tenant ??
                resolver.resolveTenantId()
            return resolver.connect(tid)
        })
    }

    registerSanitizeWrites(dataPipelineSrv, pip, cfg.entityCache.storageFqn)

    if (perTenantFiles) {
        const useStatic = cfg.entityCache.static === true
        dataPipelineSrv.before('PIPELINE.READ', pip, async () => {
            if (useStatic) {
                await resolver.connectStatic()
                return
            }
            const { currentEntityCacheTenant } = require('cds-data-pipeline/srv/lib/entity-cache-tenant')
            const tid =
                currentEntityCacheTenant() ??
                cds.context?.tenant ??
                cds.context?.user?.tenant ??
                resolver.resolveTenantId()
            await resolver.connect(tid)
        })
    }

    cfg.entityCache.pipelineName = pip
    cfg.entityCache.dbServiceName = svcName
    cfg.entityCache.perTenantFiles = perTenantFiles
    cfg.entityCache.resolved = resolveEntityCacheOptions(cacheOpts)
}

module.exports = { bindEntityCachePipelines, registerSanitizeWrites }
