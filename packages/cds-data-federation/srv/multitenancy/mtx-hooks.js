const cds = require('@sap/cds')
const { setTenantListProvider } = require('cds-data-pipeline/srv/lib/TenantRunCoordinator')
const { listSubscribedTenants } = require('./tenant-provider')
const { getEntityCacheDbResolver } = require('../entity-cache/EntityCacheDbResolver')
const fs = require('fs')

const LOG = cds.log('cds-data-federation')

/** @type {string[]} */
let _replicatePipelineNames = []

function registerReplicatePipelineNames(names) {
    _replicatePipelineNames = Array.isArray(names) ? names.filter(Boolean) : []
}

function _multitenancyConfig() {
    return cds.env?.requires?.['cds-data-federation']?.multitenancy || {}
}

/**
 * Wire tenant list provider into cds-data-pipeline coordinator.
 */
function initTenantRunCoordinator() {
    setTenantListProvider(() => listSubscribedTenants())
}

/**
 * Optional MTX sidecar hooks — consumer imports and calls from `mtx/sidecar/server.js`:
 *
 *   const { registerMtxDeploymentHooks } = require('cds-data-federation/srv/multitenancy/mtx-hooks')
 *   registerMtxDeploymentHooks()
 */
function registerMtxDeploymentHooks() {
    cds.on('served', () => {
        const ds = cds.services['cds.xt.DeploymentService']
        if (!ds) return

        const cfg = _multitenancyConfig()

        ds.after('subscribe', async (result, req) => {
            if (cfg.syncOnSubscribe !== true) return
            const tenant = req?.data?.tenant
            if (!tenant) return
            await _syncReplicatePipelinesForTenant(tenant)
        })

        ds.after('unsubscribe', async (result, req) => {
            if (cfg.flushOnUnsubscribe !== true) return
            const tenant = req?.data?.tenant
            if (!tenant) return
            await _flushTenantCaches(tenant)
        })

        LOG.info('Registered MTX DeploymentService subscribe/unsubscribe hooks')
    })
}

async function _syncReplicatePipelinesForTenant(tenant) {
    if (!_replicatePipelineNames.length) return
    let ps
    try {
        ps = await cds.connect.to('DataPipelineService')
    } catch (err) {
        LOG.warn(`MTX subscribe sync skipped — DataPipelineService unavailable: ${err.message}`)
        return
    }
    for (const name of _replicatePipelineNames) {
        try {
            await ps.execute(name, { trigger: 'manual', tenant: String(tenant) })
            LOG.info(`MTX subscribe: synced pipeline '${name}' for tenant '${tenant}'`)
        } catch (err) {
            LOG.warn(`MTX subscribe: pipeline '${name}' failed for tenant '${tenant}': ${err.message}`)
        }
    }
}

async function _flushTenantCaches(tenant) {
    const resolver = getEntityCacheDbResolver()
    const url = resolver.resolveUrl(tenant)
    try {
        if (fs.existsSync(url)) fs.unlinkSync(url)
        LOG.info(`MTX unsubscribe: removed entity-cache sqlite for tenant '${tenant}'`)
    } catch (err) {
        LOG.warn(`MTX unsubscribe: could not remove entity-cache file ${url}: ${err.message}`)
    }
}

module.exports = {
    initTenantRunCoordinator,
    registerMtxDeploymentHooks,
    registerReplicatePipelineNames,
}
