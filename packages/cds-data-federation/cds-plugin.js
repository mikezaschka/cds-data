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
const { setFederationConfigs } = require('./srv/federation-registry')
const { resolvePluginRoots } = require('./lib/plugin-roots')
const delegateMetrics = require('./srv/metrics/delegate-metrics')

const LOG = cds.log('cds-data-federation')

let _federationConfigs = []
let _viewMappingRegistry = {}

// ADR 0017 — inject the management model before the model is compiled, so the
// API is served only when the app asked for it.
{
    const { roots, reuseConsole, warnings } = resolvePluginRoots({
        pluginDir: __dirname,
        projectRoot: cds.root,
    })
    for (const warning of warnings) LOG.warn(warning)
    for (const root of roots) {
        cds.env.roots ??= []
        if (!cds.env.roots.includes(root)) cds.env.roots.push(root)
    }

    if (reuseConsole) {
        const { resolveUi5Url, mountFederationConsole } = require('./lib/console-bootstrap')
        const management = cds.env?.requires?.['data-federation']?.management || {}
        const { url: ui5Url, warnings: ui5Warnings } = resolveUi5Url(management)
        for (const message of ui5Warnings) LOG.warn(message)

        const consolePath = cds.utils.path.join(__dirname, 'app', 'federation-console')
        cds.once('bootstrap', (app) => {
            if (!mountFederationConsole(app, { consolePath, ui5Url })) {
                LOG.warn(
                    'cds-data-federation: app.serve is unavailable — export cds.server from server.js to mount the Federation Console',
                )
                return
            }
            LOG.info(`Serving Federation Console at /federation-console (UI5 from ${ui5Url})`)
        })
    }
}

cds.on('loaded', (csn) => {
    const { configs, viewMappingRegistry } = scanAnnotations(csn)
    _federationConfigs = configs
    _viewMappingRegistry = viewMappingRegistry
    setFederationConfigs(configs)
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
        // ADR 0019 — starts only when metrics are switched on; a last flush on
        // shutdown keeps the final interval's counts.
        await delegateMetrics.loadOverride()
        delegateMetrics.start()
        cds.on('shutdown', async () => {
            delegateMetrics.stop()
            try {
                await delegateMetrics.flush()
            } catch {
                // A failed final flush loses at most one interval of counters.
            }
        })
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
