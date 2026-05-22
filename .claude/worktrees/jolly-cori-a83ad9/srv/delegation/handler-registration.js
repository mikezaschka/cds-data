const cds = require('@sap/cds')
const { translateNavigationFilters } = require('./navigation-translation')
const { resolveLocalLambdaFilters } = require('./lambda-filters')
const { splitLocalExpands, resolveRemoteToLocalExpands } = require('./expand-remote-to-local')
const { containsLambda, runDirectRemoteQuery, propagateRemoteError } = require('./remote-query')
const { resolveLocalToRemoteNavigation } = require('./cross-service-navigation')
const { runPagedRemoteQuery } = require('./paged-remote-query')

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

            const lambdaResult = resolveLocalLambdaFilters(query, localAssocsByName, service)
            if (lambdaResult instanceof Promise) {
                query = (await lambdaResult)._cqn
            } else {
                query = lambdaResult
            }

            const { localExpandItems, effectiveQuery } = splitLocalExpands(query, localAssocsByName)
            try {
                let results
                if (viewMapping.staticWhere || containsLambda(effectiveQuery?.SELECT?.where)) {
                    results = await runDirectRemoteQuery(remote, sourceServiceName, effectiveQuery, viewMapping)
                } else {
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
    LOG.info(`Registered delegate handler for ${entityName} -> ${sourceServiceName}${ops.length > 0 ? ` (write: ${ops.join(', ')})` : ''}${localAssocs.length > 0 ? ` (Scenario C: ${localAssocs.map(a => a.name).join(', ')})` : ''}`)
}

function normalizeTags(entityName, cacheOptions) {
    const autoTag = { value: `federation:${entityName}` }
    const userTags = (cacheOptions.tags || []).map(t =>
        typeof t === 'string' ? { value: t } : t
    )
    return [autoTag, ...userTags]
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

            const lambdaResult = resolveLocalLambdaFilters(query, localAssocsByName, service)
            if (lambdaResult instanceof Promise) {
                query = (await lambdaResult)._cqn
            } else {
                query = lambdaResult
            }

            const { localExpandItems, effectiveQuery } = splitLocalExpands(query, localAssocsByName)
            const delegateHandler = async () => {
                try {
                    if (viewMapping.staticWhere || containsLambda(effectiveQuery?.SELECT?.where)) {
                        return await runDirectRemoteQuery(remote, sourceServiceName, effectiveQuery, viewMapping)
                    }
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

module.exports = { registerDelegateHandler, registerCachedDelegateHandler, normalizeTags }
