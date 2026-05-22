const cds = require('@sap/cds')
const { scanAnnotations } = require('./srv/annotation-scanner')
const { registerFederationHandlers } = require('./srv/delegation')
const DataReplicationService = require('./srv/DataReplicationService')

const LOG = cds.log('cds-data-federation')

let _federationConfigs = []
let _viewMappingRegistry = {}

cds.on('loaded', (csn) => {
    const { configs, viewMappingRegistry } = scanAnnotations(csn)
    _federationConfigs = configs
    _viewMappingRegistry = viewMappingRegistry
    if (_federationConfigs.length > 0) {
        LOG.info(`Discovered ${_federationConfigs.length} @federation.* entities`)
    }
})

cds.once('served', async () => {
    if (_federationConfigs.length === 0) return

    const nonReplicateConfigs = _federationConfigs.filter(c => c.strategy !== 'replicate')
    if (nonReplicateConfigs.length > 0) {
        await registerFederationHandlers(nonReplicateConfigs, _viewMappingRegistry)
    }

    const replicateConfigs = _federationConfigs.filter(c => c.strategy === 'replicate')
    if (replicateConfigs.length > 0) {
        try {
            await _ensureTrackerTables()

            // Prefer the CAP auto-wired instance (from srv/replication-service.cds).
            // If CAP hasn't instantiated one yet, create + register defensively so
            // `cds.connect.to('DataReplicationService')` resolves to the same
            // instance that drives the pipeline.
            let replicationService = cds.services['DataReplicationService']
            if (!replicationService) {
                replicationService = new DataReplicationService('DataReplicationService')
                await replicationService.init()
                cds.services[replicationService.name] = replicationService
            }

            for (const config of replicateConfigs) {
                await replicationService.addReplication({
                    name: config.options.name || config.entityName,
                    source: {
                        service: config.sourceService,
                        entity: config.sourceEntity,
                        batchSize: config.options.batchSize || 1000,
                    },
                    target: {
                        entity: config.entityFullName,
                    },
                    mode: config.options.mode || 'delta',
                    delta: {
                        mode: config.options.delta?.mode || 'timestamp',
                        field: config.options.delta?.field || 'modifiedAt',
                        ...config.options.delta,
                    },
                    rest: config.options.rest,
                    schedule: config.options.schedule,
                    viewMapping: config.viewMapping,
                })
            }

            LOG.info(`Registered ${replicateConfigs.length} replication configs from annotations`)
        } catch (err) {
            LOG.error('Failed to register annotation-based replications:', err)
        }
    }
})

async function _ensureTrackerTables() {
    const db = await cds.connect.to('db')
    try {
        await db.run(SELECT.one.from('plugin_data_federation_Federations').limit(1))
    } catch {
        LOG._info && LOG.info('Creating tracker tables (plugin_data_federation_*)')
        await db.run(`CREATE TABLE IF NOT EXISTS plugin_data_federation_Federations (
            name NVARCHAR(5000) NOT NULL PRIMARY KEY,
            strategy NVARCHAR(5000),
            source NCLOB,
            target NCLOB,
            mode NVARCHAR(5000) DEFAULT 'delta',
            lastSync TIMESTAMP,
            lastKey NVARCHAR(5000),
            status NVARCHAR(5000) DEFAULT 'idle',
            errorCount INTEGER DEFAULT 0,
            lastError NVARCHAR(5000),
            statistics_created INTEGER DEFAULT 0,
            statistics_updated INTEGER DEFAULT 0,
            statistics_deleted INTEGER DEFAULT 0
        )`)
        await db.run(`CREATE TABLE IF NOT EXISTS plugin_data_federation_ReplicationRuns (
            ID NVARCHAR(36) NOT NULL PRIMARY KEY,
            tracker_name NVARCHAR(5000),
            status NVARCHAR(5000),
            startTime TIMESTAMP,
            endTime TIMESTAMP,
            "trigger" NVARCHAR(5000),
            mode NVARCHAR(5000),
            error NCLOB,
            statistics_created INTEGER DEFAULT 0,
            statistics_updated INTEGER DEFAULT 0,
            statistics_deleted INTEGER DEFAULT 0
        )`)
    }
}
