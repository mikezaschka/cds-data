const { getEntityCacheCoordinator } = require('./entity-cache-coordinator')

/**
 * Refresh all entity-cache pipelines in a named group for one tenant.
 * @param {string} groupName from `@federation.delegate.cache.group`
 * @param {{ tenant?: string }} [opts]
 */
async function refreshEntityCacheGroup(groupName, opts = {}) {
    return getEntityCacheCoordinator().refreshGroup(groupName, opts.tenant)
}

/**
 * Refresh one entity-cache pipeline by consumption-view full name.
 * @param {string} entityFullName e.g. `consumer.EntityCachedCustomers`
 * @param {{ tenant?: string }} [opts]
 */
async function refreshEntityCache(entityFullName, opts = {}) {
    return getEntityCacheCoordinator().refreshEntity(entityFullName, opts.tenant)
}

module.exports = {
    refreshEntityCacheGroup,
    refreshEntityCache,
    getEntityCacheCoordinator,
}
