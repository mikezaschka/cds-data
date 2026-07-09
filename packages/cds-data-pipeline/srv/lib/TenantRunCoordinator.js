const cds = require('../runtime-cds')
const { runInTenantContext } = require('./tenant-context')

const LOG = cds.log('cds-data-pipeline')

/** @type {(() => Promise<string[]>) | null} */
let _listTenantsFn = null

/**
 * Federation (or consumer) registers a tenant enumeration callback.
 */
function setTenantListProvider(fn) {
    _listTenantsFn = typeof fn === 'function' ? fn : null
}

function _pipelineMultitenancyConfig() {
    return cds.env?.requires?.['cds-data-pipeline']?.multitenancy || {}
}

function isMultitenancyActive() {
    const pipe = _pipelineMultitenancyConfig()
    if (pipe.active === false) return false
    if (pipe.active === true) return true
    const req = cds.env?.requires || {}
    if (req.multitenancy === true) return true
    if (req['[production]']?.multitenancy === true) return true
    return false
}

function shouldFanOutScheduledRuns() {
    const cfg = _pipelineMultitenancyConfig()
    if (cfg.fanOutScheduledRuns === false) return false
    return isMultitenancyActive()
}

async function listTenants() {
    if (_listTenantsFn) {
        const list = await _listTenantsFn()
        if (Array.isArray(list) && list.length > 0) return list.map(String)
    }
    const fed = cds.env?.requires?.['cds-data-federation']?.multitenancy || {}
    if (typeof fed.listTenants === 'function') {
        const list = await fed.listTenants()
        if (Array.isArray(list) && list.length > 0) return list.map(String)
    }
    if (Array.isArray(fed.tenantIds) && fed.tenantIds.length > 0) {
        return fed.tenantIds.map(String)
    }
    const defaultTenant =
        fed.defaultTenant ||
        cds.env?.requires?.['cds-data-federation']?.entityCache?.defaultTenant ||
        'default'
    return [String(defaultTenant)]
}

/**
 * Resolve per-tenant execute options (4.15.2 v1 — cds.env overrides).
 */
function resolveTenantExecuteOpts(tenant, pipelineName, baseOpts = {}) {
    const fed = cds.env?.requires?.['cds-data-federation']?.multitenancy || {}
    const tenants = fed.tenants || {}
    const tCfg = tenants[tenant] || {}
    const repl = tCfg.replicate || {}
    const entityShort = pipelineName.includes(':') ? pipelineName.split(':').pop() : pipelineName
    const entityCfg = repl[entityShort] || repl[pipelineName] || {}
    return {
        ...baseOpts,
        ...(entityCfg.mode ? { mode: entityCfg.mode } : {}),
        ...(entityCfg.trigger ? { trigger: entityCfg.trigger } : {}),
    }
}

/**
 * Run a pipeline once per subscribed tenant (ADR 0010 / 4.15.1).
 */
async function runForAllTenants(pipelineService, pipelineName, opts = {}) {
    const tenants = await listTenants()
    const results = []
    for (const tenant of tenants) {
        const tenantOpts = resolveTenantExecuteOpts(tenant, pipelineName, opts)
        try {
            const result = await pipelineService.execute(pipelineName, { ...tenantOpts, tenant })
            results.push({ tenant, ...result })
        } catch (err) {
            LOG.warn(`Pipeline '${pipelineName}' failed for tenant '${tenant}': ${err.message}`)
            results.push({ tenant, error: err.message })
        }
    }
    return results
}

module.exports = {
    setTenantListProvider,
    isMultitenancyActive,
    shouldFanOutScheduledRuns,
    listTenants,
    resolveTenantExecuteOpts,
    runForAllTenants,
    runInTenantContext,
}
