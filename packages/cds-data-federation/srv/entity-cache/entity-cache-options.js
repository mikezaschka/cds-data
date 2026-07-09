const cds = require('@sap/cds')

const STATIC_TENANT_KEY = '__static__'
const DEFAULT_TTL = 60000
const DEFAULT_SIZE = 10 * 1024 * 1024
const DEFAULT_CHECK = 60_000
const DEFAULT_STATS = 300_000

function _fedEntityCacheEnv() {
    return cds.env?.requires?.['cds-data-federation']?.entityCache || {}
}

function globalEntityCacheOptions() {
    const ec = _fedEntityCacheEnv()
    const prod = process.env.NODE_ENV === 'production'
    return {
        size: typeof ec.size === 'number' ? ec.size : (prod ? 100 * 1024 * 1024 : DEFAULT_SIZE),
        check: typeof ec.check === 'number' ? ec.check : DEFAULT_CHECK,
        stats: typeof ec.stats === 'number' ? ec.stats : DEFAULT_STATS,
        ttl: typeof ec.ttl === 'number' ? ec.ttl : 1_800_000,
        preload: ec.preload === true,
        prune: ec.prune !== false,
        validate: ec.validate !== false,
        wait: ec.wait !== false,
        search: ec.search !== false,
        measure: ec.measure === true,
        staticUrlTemplate: ec.staticUrlTemplate || 'federation-entity-cache-static.sqlite',
    }
}

/**
 * Merge per-entity `cache` annotation options with global `cds-data-federation.entityCache`.
 * @param {object} [cacheOpts] from `@federation.delegate.cache`
 */
function resolveEntityCacheOptions(cacheOpts = {}) {
    const global = globalEntityCacheOptions()
    return {
        ttl: typeof cacheOpts.ttl === 'number' ? cacheOpts.ttl : global.ttl,
        batchSize: cacheOpts.batchSize,
        preload: cacheOpts.preload === true || (cacheOpts.preload !== false && global.preload),
        group: cacheOpts.group || null,
        static: cacheOpts.static === true,
        wait: typeof cacheOpts.wait === 'boolean' ? cacheOpts.wait : global.wait,
        validate: typeof cacheOpts.validate === 'boolean' ? cacheOpts.validate : global.validate,
        search: typeof cacheOpts.search === 'boolean' ? cacheOpts.search : global.search,
        size: global.size,
        check: global.check,
        stats: global.stats,
        prune: global.prune,
        measure: global.measure,
        staticUrlTemplate: global.staticUrlTemplate,
    }
}

/** TTL in ms; negative values mean "never expire once loaded". */
function effectiveTtlMs(resolvedOpts) {
    const ttl = resolvedOpts.ttl
    if (typeof ttl === 'number' && ttl < 0) return Infinity
    return typeof ttl === 'number' && Number.isFinite(ttl) ? ttl : DEFAULT_TTL
}

function cacheTenantKey(tenantString, staticCache) {
    if (staticCache) return STATIC_TENANT_KEY
    return tenantString == null ? '' : String(tenantString)
}

module.exports = {
    STATIC_TENANT_KEY,
    globalEntityCacheOptions,
    resolveEntityCacheOptions,
    effectiveTtlMs,
    cacheTenantKey,
}
