const cds = require('@sap/cds')
const { scanAnnotations } = require('./srv/annotation-scanner')
const { registerFederationHandlers } = require('./srv/delegation')
const { bindReplicateConfigs } = require('./srv/pipeline-binding')
const { bindEntityCachePipelines } = require('./srv/entity-cache/entity-cache-binding')
const {
    initTenantRunCoordinator,
    registerReplicatePipelineNames,
} = require('./srv/multitenancy/mtx-hooks')
const { getEntityCacheCoordinator } = require('./srv/entity-cache/entity-cache-coordinator')

const LOG = cds.log('cds-data-federation')

let _federationConfigs = []
let _viewMappingRegistry = {}

cds.on('loaded', (csn) => {
    const { configs, viewMappingRegistry } = scanAnnotations(csn)
    _federationConfigs = configs
    _viewMappingRegistry = viewMappingRegistry
    if (_federationConfigs.length > 0) {
        LOG._info && LOG.info(`Discovered ${_federationConfigs.length} @federation.* entities`)
    }
})

cds.once('served', async () => {
    initTenantRunCoordinator()

    if (_federationConfigs.length === 0) return

    const delegateConfigs = _federationConfigs.filter(c => c.strategy !== 'replicate')
    if (delegateConfigs.length > 0) {
        await bindEntityCachePipelines(delegateConfigs)
        const coordinator = getEntityCacheCoordinator()
        coordinator.registerFromConfigs(delegateConfigs)
        coordinator.startIntervals()
        await coordinator.preloadOnBoot()
        await registerFederationHandlers(delegateConfigs, _viewMappingRegistry)
    }

    const replicateConfigs = _federationConfigs.filter(c => c.strategy === 'replicate')
    if (replicateConfigs.length > 0) {
        try {
            await bindReplicateConfigs(replicateConfigs)
            registerReplicatePipelineNames(
                replicateConfigs.map((c) => c.options.name || c.entityName),
            )
            LOG._info && LOG.info(`Registered ${replicateConfigs.length} @federation.replicate bindings`)
        } catch (err) {
            LOG._error && LOG.error('Failed to bind @federation.replicate configs:', err)
            throw err
        }
    }
})
