const cds = require('@sap/cds')
const path = require('path')

const LOG = cds.log('cds-data-federation')

const DEFAULT_SERVICE = 'data-federation-cache'
const DEFAULT_TEMPLATE = 'data-federation-cache-{tenant}.sqlite'
const DEFAULT_TENANT = 'default'

/**
 * Resolves per-tenant SQLite files for federation entity-cache storage.
 * One database file per CAP tenant (ADR 0010).
 */
class EntityCacheDbResolver {
    constructor() {
        /** @type {Map<string, object>} */
        this._connections = new Map()
        /** @type {Set<string>} */
        this._deployedUrls = new Set()
    }

    _entityCacheConfig() {
        const fed = cds.env?.requires?.['data-federation'] || {}
        return fed.entityCache || {}
    }

    _serviceName() {
        return resolveConfiguredServiceName()
    }

    _urlTemplate() {
        const ec = this._entityCacheConfig()
        if (ec.urlTemplate) return ec.urlTemplate
        const req = cds.env?.requires?.[this._serviceName()] || {}
        const url = req.credentials?.url
        if (typeof url === 'string' && url.includes('{tenant}')) return url
        return DEFAULT_TEMPLATE
    }

    _staticUrlTemplate() {
        const ec = this._entityCacheConfig()
        return ec.staticUrlTemplate || 'data-federation-cache-static.sqlite'
    }

    _defaultTenant() {
        return this._entityCacheConfig().defaultTenant || DEFAULT_TENANT
    }

    _baseDir() {
        const configured = this._entityCacheConfig().baseDir
        if (!configured) return cds.root || process.cwd()
        if (path.isAbsolute(configured)) return configured
        return path.join(cds.root || process.cwd(), configured)
    }

    /**
     * Current request tenant or configured default for single-tenant dev.
     * @param {string} [explicitTenant] optional override (e.g. from req.user.tenant)
     */
    resolveTenantId(explicitTenant) {
        if (explicitTenant != null && String(explicitTenant) !== '') return String(explicitTenant)
        const tid = cds.context?.tenant ?? cds.context?.user?.tenant
        if (tid != null && String(tid) !== '') return String(tid)
        return this._defaultTenant()
    }

    /**
     * Build absolute sqlite file path for a tenant id.
     */
    resolveUrl(tenantId, { static: staticCache } = {}) {
        const fileName = staticCache
            ? this._staticUrlTemplate()
            : this._urlTemplate().replace(/\{tenant\}/g, tenantId == null ? this._defaultTenant() : String(tenantId))
        if (path.isAbsolute(fileName)) return fileName
        return path.join(this._baseDir(), fileName)
    }

    resolveStaticUrl() {
        return this.resolveUrl(null, { static: true })
    }

    /**
     * Connect to (and deploy into) the tenant-specific entity-cache SQLite database.
     */
    async connect(tenantId) {
        const tid = tenantId == null ? this.resolveTenantId() : String(tenantId)
        const url = this.resolveUrl(tid)
        const cacheKey = `${this._serviceName()}::${url}`
        if (this._connections.has(cacheKey)) return this._connections.get(cacheKey)

        // Connect with an explicit file path — strip tenant from context so CAP SQLite
        // does not append a second tenant suffix to the URL (ADR 0010).
        const prior = cds.context
        let db
        try {
            if (prior && (prior.tenant || prior.user?.tenant)) {
                cds.context = Object.assign(Object.create(Object.getPrototypeOf(prior) || null), prior, {
                    tenant: undefined,
                    user: Object.assign({}, prior.user || {}, { tenant: undefined }),
                })
            }
            db = await cds.connect.to(this._serviceName(), { credentials: { url } })
            await this._ensureDeployed(db, url)
            this._connections.set(cacheKey, db)
            return db
        } finally {
            cds.context = prior
        }
    }

    async connectForCurrentTenant(explicitTenant, { static: staticCache } = {}) {
        if (staticCache) return this.connectStatic()
        return this.connect(this.resolveTenantId(explicitTenant))
    }

    async connectStatic() {
        const url = this.resolveStaticUrl()
        const cacheKey = `${this._serviceName()}::static::${url}`
        if (this._connections.has(cacheKey)) return this._connections.get(cacheKey)

        const prior = cds.context
        let db
        try {
            if (prior && (prior.tenant || prior.user?.tenant)) {
                cds.context = Object.assign(Object.create(Object.getPrototypeOf(prior) || null), prior, {
                    tenant: undefined,
                    user: Object.assign({}, prior.user || {}, { tenant: undefined }),
                })
            }
            db = await cds.connect.to(this._serviceName(), { credentials: { url } })
            await this._ensureDeployed(db, url)
            this._connections.set(cacheKey, db)
            return db
        } finally {
            cds.context = prior
        }
    }

    async _ensureDeployed(db, url) {
        if (this._deployedUrls.has(url)) return
        const model = cds.model
        if (!model?.definitions) {
            this._deployedUrls.add(url)
            return
        }
        const definitions = {}
        for (const [k, v] of Object.entries(model.definitions)) {
            if (
                k.startsWith('plugin.data_federation.entity_cache.')
                || k === 'plugin.data_federation.entity_cache'
                || k === 'plugin.data_federation'
                || k === 'plugin'
            ) {
                definitions[k] = v
            }
        }
        if (Object.keys(definitions).length === 0) {
            this._deployedUrls.add(url)
            return
        }
        try {
            const subset = {
                $version: model.$version,
                $sources: model.$sources,
                definitions,
            }
            await cds.deploy(subset).to(db)
        } catch (err) {
            LOG.warn(`Entity-cache deploy to ${url} failed (may already exist): ${err.message}`)
        }
        this._deployedUrls.add(url)
    }
}

let _singleton

function getEntityCacheDbResolver() {
    if (!_singleton) _singleton = new EntityCacheDbResolver()
    return _singleton
}

/**
 * Effective datastore service name for the entity cache: an explicit
 * `entityCache.serviceName`, otherwise the default `data-federation-cache`.
 */
function resolveConfiguredServiceName() {
    const ec = cds.env?.requires?.['data-federation']?.entityCache || {}
    return ec.serviceName || DEFAULT_SERVICE
}

function usesPerTenantSqliteFiles() {
    const ec = cds.env?.requires?.['data-federation']?.entityCache || {}
    if (ec.urlTemplate) return true
    const svc = ec.serviceName || DEFAULT_SERVICE
    return !!cds.env?.requires?.[svc]
}

module.exports = {
    EntityCacheDbResolver,
    getEntityCacheDbResolver,
    usesPerTenantSqliteFiles,
    resolveConfiguredServiceName,
    DEFAULT_SERVICE,
    DEFAULT_TEMPLATE,
    DEFAULT_TENANT,
}
