const { runWithEntityCacheTenant } = require('./entity-cache-tenant')

/**
 * Run `fn` with entity-cache tenant context (ADR 0010).
 * Delegates to AsyncLocalStorage — does not mutate cds.context.
 */
async function runInTenantContext(tenant, fn) {
    if (tenant == null || String(tenant) === '') {
        throw new Error('runInTenantContext: tenant id is required')
    }
    if (typeof fn !== 'function') {
        throw new Error('runInTenantContext: fn must be a function')
    }
    return runWithEntityCacheTenant(String(tenant), fn)
}

module.exports = { runInTenantContext, runWithEntityCacheTenant }
