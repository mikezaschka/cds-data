/**
 * Tracks entity-cache freshness, size, LRU metadata, and hit/miss statistics
 * per federated consumption view + tenant (or static shared key).
 */

class EntityCacheRegistry {
    constructor() {
        /** @type {Map<string, { freshAt: number, touched: number, bytes: number }>} */
        this._entries = new Map()
        /** @type {Map<string, object>} entityFullName → registered metadata */
        this._configs = new Map()
        /** @type {Map<string, Set<string>>} group → entityFullNames */
        this._groups = new Map()
        this._stats = {
            hits: 0,
            used: 0,
            missed: 0,
            errors: 0,
        }
    }

    _key(entityFullName, tenantKey) {
        return `${entityFullName}::${tenantKey == null ? '' : String(tenantKey)}`
    }

    registerConfig(entityFullName, meta) {
        this._configs.set(entityFullName, meta)
        if (meta.group) {
            if (!this._groups.has(meta.group)) this._groups.set(meta.group, new Set())
            this._groups.get(meta.group).add(entityFullName)
        }
    }

    getConfig(entityFullName) {
        return this._configs.get(entityFullName)
    }

    allConfigs() {
        return [...this._configs.values()]
    }

    groupMembers(groupName) {
        return [...(this._groups.get(groupName) || [])]
    }

    recordHit() {
        this._stats.hits++
    }

    recordUsed() {
        this._stats.used++
    }

    recordMiss() {
        this._stats.missed++
    }

    recordError() {
        this._stats.errors++
    }

    statsSnapshot() {
        const { hits, used, missed, errors } = this._stats
        const ratio = hits > 0 ? Math.round((used / hits) * 100) : 0
        return { hits, used, missed, errors, ratio }
    }

    resetStats() {
        this._stats = { hits: 0, used: 0, missed: 0, errors: 0 }
    }

    markFresh(entityFullName, tenantKey, bytes) {
        const now = Date.now()
        const key = this._key(entityFullName, tenantKey)
        const prev = this._entries.get(key) || {}
        this._entries.set(key, {
            freshAt: now,
            touched: now,
            bytes: typeof bytes === 'number' ? bytes : (prev.bytes || 0),
        })
    }

    touch(entityFullName, tenantKey) {
        const key = this._key(entityFullName, tenantKey)
        const entry = this._entries.get(key)
        if (entry) entry.touched = Date.now()
    }

    setBytes(entityFullName, tenantKey, bytes) {
        const key = this._key(entityFullName, tenantKey)
        const entry = this._entries.get(key) || { freshAt: 0, touched: Date.now(), bytes: 0 }
        entry.bytes = Math.max(0, bytes || 0)
        if (!this._entries.has(key)) this._entries.set(key, entry)
    }

    isFresh(entityFullName, tenantKey, ttlMs) {
        const entry = this._entries.get(this._key(entityFullName, tenantKey))
        if (!entry || entry.freshAt == null) return false
        if (ttlMs === Infinity) return true
        return Date.now() - entry.freshAt < ttlMs
    }

    invalidate(entityFullName, tenantKey) {
        this._entries.delete(this._key(entityFullName, tenantKey))
    }

    totalBytes(tenantKey) {
        let total = 0
        const suffix = `::${tenantKey == null ? '' : String(tenantKey)}`
        for (const [key, entry] of this._entries) {
            if (key.endsWith(suffix)) total += entry.bytes || 0
        }
        return total
    }

    /**
     * Least-recently-used entity for a tenant, optionally excluding one entity.
     * @returns {string|null} entityFullName
     */
    leastRecentlyUsed(tenantKey, excludeEntityFullName) {
        const suffix = `::${tenantKey == null ? '' : String(tenantKey)}`
        let oldest = null
        let oldestTs = Infinity
        for (const [key, entry] of this._entries) {
            if (!key.endsWith(suffix)) continue
            const entityFullName = key.slice(0, key.length - suffix.length)
            if (excludeEntityFullName && entityFullName === excludeEntityFullName) continue
            if ((entry.bytes || 0) <= 0 && !entry.freshAt) continue
            if (entry.touched < oldestTs) {
                oldestTs = entry.touched
                oldest = entityFullName
            }
        }
        return oldest
    }

    tenantsWithEntries() {
        const tenants = new Set()
        for (const key of this._entries.keys()) {
            const idx = key.lastIndexOf('::')
            tenants.add(key.slice(idx + 2))
        }
        return [...tenants]
    }
}

let _singleton

function getEntityCacheRegistry() {
    return (_singleton ||= new EntityCacheRegistry())
}

/** @deprecated use getEntityCacheRegistry */
function getEntityCacheManager() {
    return getEntityCacheRegistry()
}

module.exports = {
    EntityCacheRegistry,
    getEntityCacheRegistry,
    getEntityCacheManager,
}
