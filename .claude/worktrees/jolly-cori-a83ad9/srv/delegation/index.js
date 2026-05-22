const cds = require('@sap/cds')
const { findServingService, findEntityNameInService } = require('./service-resolution')
const { buildAssocTargetMappings } = require('./navigation-translation')
const { buildLocalAssocInfo } = require('./expand-remote-to-local')
const { registerDelegateHandler, registerCachedDelegateHandler } = require('./handler-registration')
const { registerLocalExpandResolvers } = require('./expand-local-to-remote')

const LOG = cds.log('cds-data-federation')

/**
 * Registers delegate handlers on entities annotated with @federation.delegate / @federation.replicate.
 * If the entity has a `cache` option, wraps the handler with cds-caching.
 * Called after all services are served.
 *
 * Delegation itself is simple: `remote.run(req.query)`. CAP's runtime automatically
 * translates queries through the projection chain — including column renames ($select,
 * $filter, $orderby), column restriction, $expand, and result mapping — because the
 * CDS model captures the full projection from service entity down to the remote entity.
 * See: https://cap.cloud.sap/docs/guides/integration/calesi#delegation
 *
 * The plugin's added value for delegation is:
 *   1. Declarative handler registration via @federation.delegate (no manual code)
 *   2. Local→remote $expand resolution (Scenario B: batch-fetch + stitch)
 *   3. Optional response caching via cds-caching
 *
 * @param {Array} federationConfigs - configs from annotation scanner
 * @param {Object} viewMappingRegistry - mapping registry (only needed for Scenario B expand resolution)
 */
async function registerFederationHandlers(federationConfigs, viewMappingRegistry = {}) {
    const federatedByService = new Map()
    const pendingHandlers = []

    // Phase 1: Build the complete federatedMap for all services.
    // Handler registration is deferred so that Scenario C (remote→local expand)
    // can determine which associations point to local vs. federated entities.
    for (const config of federationConfigs) {
        const { strategy, entityName, entityFullName, sourceService, sourceEntity, options, viewMapping, writeFlags } = config

        if (strategy === 'replicate') continue

        const service = findServingService(entityFullName)
        if (!service) {
            LOG.debug(`No serving service found for federated entity '${entityFullName}', skipping.`)
            continue
        }

        const serviceEntityName = findEntityNameInService(service, entityFullName) || entityName
        const servedFullName = `${service.name}.${serviceEntityName}`

        if (!viewMappingRegistry[servedFullName]) {
            viewMappingRegistry[servedFullName] = viewMapping
        }

        if (strategy !== 'delegate') {
            LOG.warn(`Unknown federation strategy '${strategy}' for entity '${entityName}'`)
            continue
        }

        if (!federatedByService.has(service.name)) federatedByService.set(service.name, new Map())
        federatedByService.get(service.name).set(servedFullName, {
            sourceService,
            sourceEntity,
            viewMapping,
            serviceEntityName
        })

        pendingHandlers.push({
            service, serviceEntityName, sourceService, options, viewMapping, entityFullName, servedFullName, writeFlags
        })
    }

    // Phase 2: Register delegate handlers (with Scenario C local assoc info)
    for (const ph of pendingHandlers) {
        const { service, serviceEntityName, sourceService, options, viewMapping, entityFullName, servedFullName, writeFlags } = ph
        const assocTargets = buildAssocTargetMappings(entityFullName, viewMappingRegistry)
        const federatedMap = federatedByService.get(service.name)
        const localAssocs = buildLocalAssocInfo(servedFullName, service.name, federatedMap)
        const wf = writeFlags || { create: false, update: false, delete: false }

        if (options.cache) {
            await registerCachedDelegateHandler(service, serviceEntityName, sourceService, options.cache, viewMapping, assocTargets, localAssocs, wf)
        } else {
            registerDelegateHandler(service, serviceEntityName, sourceService, viewMapping, assocTargets, localAssocs, wf)
        }
    }

    // Phase 3: Register Scenario B (local → remote) expand resolvers
    for (const [serviceName, federatedMap] of federatedByService) {
        registerLocalExpandResolvers(cds.services[serviceName], federatedMap, viewMappingRegistry)
    }
}

module.exports = { registerFederationHandlers }
