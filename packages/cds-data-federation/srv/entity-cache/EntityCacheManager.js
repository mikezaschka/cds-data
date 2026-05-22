/**
 * Tracks last successful entity-cache SQLite refresh per federated consumption view +
 * normalized tenant label. Used to honour TTL between pipeline runs without relying
 * on pipeline tracker timestamps (those are shared across tenants).
 */

class EntityCacheManager {
    constructor() {
        /** @type {Map<string, number>} millis since epoch */
        this._freshness = new Map()
    }

    _key(entityFullName, tenantId) {
        return `${entityFullName}::${tenantId}`
    }

    markFresh(entityFullName, tenantId) {
        const tid = tenantId == null ? '' : String(tenantId)
        this._freshness.set(this._key(entityFullName, tid), Date.now())
    }

    isFresh(entityFullName, tenantId, ttlMs) {
        const ts = this._freshness.get(this._key(entityFullName, tenantId == null ? '' : String(tenantId)))
        if (ts == null) return false
        return Date.now() - ts < ttlMs
    }

    invalidate(entityFullName, tenantId) {
        this._freshness.delete(this._key(entityFullName, tenantId == null ? '' : String(tenantId)))
    }
}

let _singleton

function getEntityCacheManager() {
    return (_singleton ||= new EntityCacheManager())
}

module.exports = { EntityCacheManager, getEntityCacheManager }
