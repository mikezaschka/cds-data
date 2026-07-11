const cds = require('@sap/cds')
const { translateNavigationFilters } = require('./navigation-translation')
const { resolveLocalNavigationFilters } = require('./local-navigation-filters')
const { resolveLocalLambdaFilters } = require('./lambda-filters')
const { splitLocalExpands, resolveRemoteToLocalExpands } = require('./expand-remote-to-local')
const { containsLambda, runDirectRemoteQuery, propagateRemoteError } = require('./remote-query')
const { resolveLocalToRemoteNavigation } = require('./cross-service-navigation')
const { runPagedRemoteQuery } = require('./paged-remote-query')

const { rewriteQueryForEntityCacheStorage } = require('../entity-cache/query-rewrite')
const { getEntityCacheRegistry } = require('../entity-cache/EntityCacheRegistry')
const { getEntityCacheDbResolver } = require('../entity-cache/EntityCacheDbResolver')
const { getEntityCacheCoordinator } = require('../entity-cache/entity-cache-coordinator')
const {
    resolveEntityCacheOptions,
    effectiveTtlMs,
    cacheTenantKey,
    globalEntityCacheOptions,
} = require('../entity-cache/entity-cache-options')
const { resolveRequestTenant } = require('../multitenancy/resolve-request-tenant')

const LOG = cds.log('cds-data-federation')

// ─── Handler Registration ──────────────────────────────────────────────────────
//
// CAP's runtime automatically translates queries through the CDS projection chain
// when you call remote.run(req.query). This includes:
//   - Column rename translation ($select, $filter, $orderby) via `as` clauses
//   - Column restriction to projected fields only (bandwidth optimization)
//   - $expand forwarding (within the same remote service)
//   - Result structure transformation back to the consumer's schema
//   - $count, $top, $skip passthrough
//
// Reference: https://cap.cloud.sap/docs/guides/integration/calesi#delegation
//            (see "Automatic Query Translation" section)
//
// The plugin adds navigation path translation for association renames in $filter
// (e.g., buyer/name → customer/name) which CAP does not handle automatically.

function registerDelegateHandler(service, entityName, sourceServiceName, viewMapping, assocTargets, localAssocs = [], writeFlags = {}) {
    const localAssocsByName = new Map(localAssocs.map(a => [a.name, a]))

    service.prepend(function () {
        service.on('READ', entityName, async (req) => {
            const remote = await cds.connect.to(sourceServiceName)

            // Cross-service navigation (4.2.12): local → remote
            const fromRef = req.query?.SELECT?.from?.ref
            if (Array.isArray(fromRef) && fromRef.length >= 2) {
                try {
                    return await resolveLocalToRemoteNavigation(req, remote, service, sourceServiceName, viewMapping)
                } catch (e) {
                    throw propagateRemoteError(e, sourceServiceName)
                }
            }

            let query = translateNavigationFilters(req.query, viewMapping, assocTargets)

            let localFilterRewritten = false
            const navResult = resolveLocalNavigationFilters(query, localAssocsByName, service)
            if (navResult instanceof Promise) {
                query = (await navResult)._cqn
                localFilterRewritten = true
            } else {
                query = navResult
            }

            const lambdaResult = resolveLocalLambdaFilters(query, localAssocsByName, service)
            if (lambdaResult instanceof Promise) {
                query = (await lambdaResult)._cqn
                localFilterRewritten = true
            } else {
                query = lambdaResult
            }

            const { localExpandItems, effectiveQuery } = splitLocalExpands(query, localAssocsByName)
            try {
                let results
                const useDirect = needsDirectRemoteQuery(viewMapping, effectiveQuery?.SELECT?.where, localFilterRewritten)
                if (useDirect) {
                    LOG.debug(`Delegate READ ${entityName}: using direct remote query (bypass CAP projection chain)`)
                    results = await runDirectRemoteQuery(remote, sourceServiceName, effectiveQuery, viewMapping)
                } else {
                    LOG.debug(`Delegate READ ${entityName}: using CAP projection chain via paged remote query`)
                    results = await runPagedRemoteQuery(remote, effectiveQuery)
                }
                if (localExpandItems.length > 0 && results != null) {
                    await resolveRemoteToLocalExpands(results, localExpandItems, localAssocsByName, service)
                }
                return results
            } catch (e) {
                throw propagateRemoteError(e, sourceServiceName)
            }
        })

        registerWriteHandlers(service, entityName, sourceServiceName, writeFlags)
    })
    const ops = [writeFlags.create && 'CREATE', writeFlags.update && 'UPDATE', writeFlags.delete && 'DELETE'].filter(Boolean)
    LOG.info(`Registered delegate handler for ${entityName} -> ${sourceServiceName}${ops.length > 0 ? ` (write: ${ops.join(', ')})` : ''}${localAssocs.length > 0 ? ` (cross-service expand: remote → local via ${localAssocs.map(a => a.name).join(', ')})` : ''}`)
}

/**
 * True when the remote query must bypass CAP's projection chain and use
 * manual field-name translation via runDirectRemoteQuery.
 *
 * @param {boolean} localFilterRewritten - true when resolveLocalNavigationFilters
 *   or resolveLocalLambdaFilters replaced a local-assoc predicate with a
 *   sourceKey IN filter (local field names that CAP won't translate reliably)
 */
function needsDirectRemoteQuery(viewMapping, where, localFilterRewritten = false) {
    if (viewMapping?.staticWhere) return true
    if (containsLambda(where)) return true
    if (localFilterRewritten && Object.keys(viewMapping?.localToRemote || {}).length > 0) {
        return true
    }
    return false
}

function normalizeTags(entityName, cacheOptions = {}) {
    const autoTag = { value: `federation:${entityName}` }
    const userTags = (cacheOptions.tags || []).map(t =>
        typeof t === 'string' ? { value: t } : t
    )
    const tags = [autoTag, ...userTags]

    const fed = cds.env?.requires?.['cds-data-federation'] || {}
    const mt = fed.multitenancy || {}
    const mtActive =
        mt.active === true ||
        cds.env?.requires?.multitenancy === true
    const tenantScoped = cacheOptions.tenantScoped !== false
    const hasTenantTag = userTags.some(
        (t) => t.template && String(t.template).includes('tenant'),
    )

    if (mtActive && tenantScoped && !hasTenantTag) {
        tags.push({ template: 'tenant-{{tenant}}-entity-{{entity}}' })
    }

    return tags
}

async function registerCachedDelegateHandler(service, entityName, sourceServiceName, cacheOptions = {}, viewMapping, assocTargets, localAssocs = [], writeFlags = {}) {
    const cacheServiceName = cacheOptions.service || 'caching'

    let cachingAvailable = false
    try {
        const cache = await cds.connect.to(cacheServiceName)
        cachingAvailable = !!cache
    } catch {
        // cds-caching not available
    }

    if (!cachingAvailable) {
        LOG.warn(`Cache service '${cacheServiceName}' not available, cache option ignored for '${entityName}'`)
        registerDelegateHandler(service, entityName, sourceServiceName, viewMapping, assocTargets, localAssocs, writeFlags)
        return
    }

    const tags = normalizeTags(entityName, cacheOptions)
    const localAssocsByName = new Map(localAssocs.map(a => [a.name, a]))

    service.prepend(function () {
        service.on('READ', entityName, async (req) => {
            const cache = await cds.connect.to(cacheServiceName)
            const remote = await cds.connect.to(sourceServiceName)

            // Cross-service navigation (4.2.12): local → remote
            const fromRef = req.query?.SELECT?.from?.ref
            if (Array.isArray(fromRef) && fromRef.length >= 2) {
                try {
                    return await resolveLocalToRemoteNavigation(req, remote, service, sourceServiceName, viewMapping)
                } catch (e) {
                    throw propagateRemoteError(e, sourceServiceName)
                }
            }

            let query = translateNavigationFilters(req.query, viewMapping, assocTargets)

            let localFilterRewritten = false
            const navResult = resolveLocalNavigationFilters(query, localAssocsByName, service)
            if (navResult instanceof Promise) {
                query = (await navResult)._cqn
                localFilterRewritten = true
            } else {
                query = navResult
            }

            const lambdaResult = resolveLocalLambdaFilters(query, localAssocsByName, service)
            if (lambdaResult instanceof Promise) {
                query = (await lambdaResult)._cqn
                localFilterRewritten = true
            } else {
                query = lambdaResult
            }

            const { localExpandItems, effectiveQuery } = splitLocalExpands(query, localAssocsByName)
            const delegateHandler = async () => {
                try {
                    const useDirect = needsDirectRemoteQuery(viewMapping, effectiveQuery?.SELECT?.where, localFilterRewritten)
                    if (useDirect) {
                        LOG.debug(`Cached delegate READ ${entityName}: using direct remote query (bypass CAP projection chain)`)
                        return await runDirectRemoteQuery(remote, sourceServiceName, effectiveQuery, viewMapping)
                    }
                    LOG.debug(`Cached delegate READ ${entityName}: using CAP projection chain via paged remote query`)
                    return await runPagedRemoteQuery(remote, effectiveQuery)
                } catch (e) {
                    throw propagateRemoteError(e, sourceServiceName)
                }
            }

            const { result } = await cache.rt.run(req, delegateHandler, {
                ttl: cacheOptions.ttl || 60000,
                tags
            })

            if (localExpandItems.length > 0 && result != null) {
                await resolveRemoteToLocalExpands(result, localExpandItems, localAssocsByName, service)
            }
            return result
        })

        registerWriteHandlers(service, entityName, sourceServiceName, writeFlags)
    })
    LOG.info(`Registered cached delegate handler for ${entityName} -> ${sourceServiceName} (service: ${cacheServiceName}, ttl: ${cacheOptions.ttl || 60000}ms)`)
}

/**
 * Delegate READs served from SQLite when fresh; one remote OData full-entity synchronisation
 * per TTL interval via cds-data-pipeline; transparent fallback on errors.
 *
 * MVP limitations: `$expand`/static `where`/lambda paths fall back to the remote service.
 */
function registerEntityCachedDelegateHandler(
    service,
    entityName,
    sourceServiceName,
    cacheOptions = {},
    viewMapping,
    assocTargets,
    localAssocs = [],
    writeFlags = {},
    entityFullName,
    entityCacheMeta,
) {
    if (
        !entityCacheMeta?.pipelineName
        || !entityCacheMeta?.storageFqn
    ) {
        LOG.warn(
            `Entity cache unavailable for '${entityName}' (${entityFullName}) — pipelines not bound or model skipped. Falling back to live delegate.`,
        )
        registerDelegateHandler(service, entityName, sourceServiceName, viewMapping, assocTargets, localAssocs, writeFlags)
        return
    }

    const resolved = resolveEntityCacheOptions(cacheOptions)
    const ttl = effectiveTtlMs(resolved)
    const registry = getEntityCacheRegistry()
    const coordinator = getEntityCacheCoordinator()
    const dbResolver = getEntityCacheDbResolver()
    const perTenantFiles = !!entityCacheMeta.perTenantFiles
    const globalOpts = globalEntityCacheOptions()
    const isStatic = entityCacheMeta.static === true || resolved.static

    const localAssocsByName = new Map(localAssocs.map(a => [a.name, a]))

    service.prepend(function () {
        service.on('READ', entityName, async (req) => {
            const remote = await cds.connect.to(sourceServiceName)
            const tenantString = resolveRequestTenant(req)
            const tenantKey = cacheTenantKey(tenantString, isStatic)

            registry.recordHit()

            let localFilterRewritten = false

            async function fallbackRemote(innerQuery, expandItems = []) {
                try {
                    const useDirect = needsDirectRemoteQuery(viewMapping, innerQuery?.SELECT?.where, localFilterRewritten)
                    let res
                    if (useDirect) {
                        LOG.debug(`Entity-cache READ ${entityName}: falling back to direct remote query`)
                        res = await runDirectRemoteQuery(remote, sourceServiceName, innerQuery, viewMapping)
                    } else {
                        LOG.debug(`Entity-cache READ ${entityName}: falling back to paged remote query`)
                        res = await runPagedRemoteQuery(remote, innerQuery)
                    }
                    if (expandItems.length > 0 && res != null) {
                        await resolveRemoteToLocalExpands(res, expandItems, localAssocsByName, service)
                    }
                    return res
                } catch (e) {
                    throw propagateRemoteError(e, sourceServiceName)
                }
            }

            async function readFromSqlite(effectiveQuery) {
                let db
                if (perTenantFiles) {
                    db = isStatic
                        ? await dbResolver.connectStatic()
                        : await dbResolver.connectForCurrentTenant(tenantString || undefined)
                } else {
                    db = await cds.connect.to(entityCacheMeta.dbServiceName || 'db')
                }
                const q = rewriteQueryForEntityCacheStorage(effectiveQuery, entityCacheMeta.storageFqn)
                const run = () => db.run(q)
                if (globalOpts.measure) {
                    return coordinator.measureQuery(run, () => fallbackRemote(effectiveQuery, []))
                }
                return run()
            }

            const fromRef = req.query?.SELECT?.from?.ref
            if (Array.isArray(fromRef) && fromRef.length >= 2) {
                try {
                    return await resolveLocalToRemoteNavigation(req, remote, service, sourceServiceName, viewMapping)
                } catch (e) {
                    throw propagateRemoteError(e, sourceServiceName)
                }
            }

            let query = translateNavigationFilters(req.query, viewMapping, assocTargets)

            const navResult = resolveLocalNavigationFilters(query, localAssocsByName, service)
            if (navResult instanceof Promise) {
                query = (await navResult)._cqn
                localFilterRewritten = true
            } else {
                query = navResult
            }

            const lambdaResult = resolveLocalLambdaFilters(query, localAssocsByName, service)
            if (lambdaResult instanceof Promise) {
                query = (await lambdaResult)._cqn
                localFilterRewritten = true
            } else {
                query = lambdaResult
            }

            const { localExpandItems, effectiveQuery } = splitLocalExpands(query, localAssocsByName)
            if (localExpandItems.length > 0 || viewMapping.staticWhere || containsLambda(effectiveQuery?.SELECT?.where) || localFilterRewritten) {
                const reasons = []
                if (localExpandItems.length > 0) reasons.push('localExpand')
                if (viewMapping.staticWhere) reasons.push('staticWhere')
                if (containsLambda(effectiveQuery?.SELECT?.where)) reasons.push('lambda')
                if (localFilterRewritten) reasons.push('localFilterRewritten')
                LOG.debug(`Entity-cache READ ${entityName}: remote fallback (${reasons.join(', ')})`)
                let q = effectiveQuery
                if (!q) q = cds.ql.clone(req.query)
                return fallbackRemote(q, localExpandItems)
            }

            if (!resolved.search && effectiveQuery?.SELECT?.search?.length > 0) {
                LOG.debug(`Entity-cache READ ${entityName}: remote fallback ($search not supported on cache)`)
                return fallbackRemote(effectiveQuery, [])
            }

            async function runPipelineReload() {
                await coordinator.ensureCapacity(tenantKey, entityFullName)
                const ps = await cds.connect.to('DataPipelineService')
                const execOpts = { mode: 'delta' }
                if (tenantString && !isStatic) execOpts.tenant = tenantString
                await ps.execute(entityCacheMeta.pipelineName, execOpts)
                const meta = registry.getConfig(entityFullName)
                if (meta) {
                    if (resolved.validate !== false) {
                        const ok = await coordinator.validateCounts(meta, tenantKey)
                        if (!ok) throw new Error(`Entity-cache count validation failed for ${entityFullName}`)
                    }
                    const bytes = await coordinator.estimateTableBytes(meta, tenantKey)
                    registry.markFresh(entityFullName, tenantKey, bytes)
                } else {
                    registry.markFresh(entityFullName, tenantKey)
                }
            }

            const fresh = registry.isFresh(entityFullName, tenantKey, ttl)
            if (!fresh) {
                registry.recordMiss()
                LOG.debug(`Entity-cache READ ${entityName}: cache stale (TTL ${ttl === Infinity ? 'never' : ttl + 'ms'}); reloading`)
                if (resolved.wait === false) {
                    runPipelineReload().catch((e) => {
                        LOG.warn(`Entity-cache background reload failed for ${entityFullName}: ${e.message}`)
                        registry.recordError()
                    })
                    return fallbackRemote(effectiveQuery, [])
                }
                try {
                    await runPipelineReload()
                } catch (e) {
                    LOG.warn(`Entity-cache reload failed for ${entityFullName}: ${e.message}`)
                    registry.recordError()
                    return fallbackRemote(effectiveQuery, [])
                }
            }

            try {
                registry.touch(entityFullName, tenantKey)
                registry.recordUsed()
                LOG.debug(`Entity-cache READ ${entityName}: serving from SQLite storage ${entityCacheMeta.storageFqn}`)
                const result = await readFromSqlite(effectiveQuery)
                if (globalOpts.prune) {
                    coordinator.ensureCapacity(tenantKey, entityFullName).catch((e) => {
                        LOG.warn(`Entity-cache capacity check failed: ${e.message}`)
                    })
                }
                return result
            } catch (e) {
                LOG.warn(`Entity-cache SQLite read failed for ${entityFullName}: ${e.message}`)
                registry.recordError()
                registry.invalidate(entityFullName, tenantKey)
                return fallbackRemote(effectiveQuery, [])
            }
        })

        registerWriteHandlers(service, entityName, sourceServiceName, writeFlags)
    })
    const ttlLabel = ttl === Infinity ? 'never' : `${ttl}ms`
    LOG.info(
        `Registered entity-cached delegate handler for ${entityName} -> ${sourceServiceName} (TTL ${ttlLabel}, storage: ${entityCacheMeta.storageFqn}${isStatic ? ', static' : ''}${resolved.group ? `, group: ${resolved.group}` : ''})`,
    )
}

function registerWriteHandlers(service, entityName, sourceServiceName, writeFlags) {
    if (!writeFlags) return []
    const allOps = { CREATE: writeFlags.create, UPDATE: writeFlags.update, DELETE: writeFlags.delete }
    const enabled = []
    for (const [event, allowed] of Object.entries(allOps)) {
        if (allowed) {
            enabled.push(event)
            service.on(event, entityName, async (req) => {
                const remote = await cds.connect.to(sourceServiceName)
                try {
                    return await remote.run(req.query)
                } catch (e) {
                    throw propagateRemoteError(e, sourceServiceName)
                }
            })
        } else if (Object.values(allOps).some(Boolean)) {
            // @readonly is stripped when any write is enabled, so explicitly reject
            // disabled operations to produce a clean 405 instead of a DB error.
            service.on(event, entityName, (req) => req.reject(405, `${event} not allowed on ${entityName}`))
        }
    }
    return enabled
}

module.exports = {
    registerDelegateHandler,
    registerCachedDelegateHandler,
    registerEntityCachedDelegateHandler,
    normalizeTags,
}
