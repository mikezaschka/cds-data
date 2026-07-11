const cds = require('@sap/cds')

const LOG = cds.log('cds-data-federation')

const DEFAULT_TENANT = 'default'

function _federationMultitenancyConfig() {
    return cds.env?.requires?.['data-federation']?.multitenancy || {}
}

function isMultitenancyConfigured() {
    const cfg = _federationMultitenancyConfig()
    if (cfg.active === true) return true
    const req = cds.env?.requires || {}
    return req.multitenancy === true
}

/**
 * Enumerate tenant ids for scheduled pipeline fan-out.
 * MTX consumers can override via `multitenancy.listTenants` or `multitenancy.tenantIds`.
 */
async function listSubscribedTenants() {
    const cfg = _federationMultitenancyConfig()

    if (typeof cfg.listTenants === 'function') {
        const list = await cfg.listTenants()
        if (Array.isArray(list) && list.length > 0) return list.map(String)
    }

    if (Array.isArray(cfg.tenantIds) && cfg.tenantIds.length > 0) {
        return cfg.tenantIds.map(String)
    }

    if (isMultitenancyConfigured()) {
        LOG.debug('Multitenancy active but no tenant list configured — using default tenant only')
    }

    return [cfg.defaultTenant || DEFAULT_TENANT]
}

module.exports = {
    listSubscribedTenants,
    isMultitenancyConfigured,
    DEFAULT_TENANT,
}
