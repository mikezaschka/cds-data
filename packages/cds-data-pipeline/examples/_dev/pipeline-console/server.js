const cds = require('@sap/cds')

const ReportingTargetAdapter = require('./adapters/ReportingTargetAdapter')

const shipmentsViewMapping = {
    isWildcard: false,
    projectedColumns: [
        'ID', 'orderId', 'status', 'carrier_code', 'trackingNumber',
        'shippedAt', 'estimatedDelivery', 'actualDelivery',
        'destinationCity', 'destinationCountry', 'modifiedAt',
    ],
    remoteToLocal: {
        ID: 'id',
        carrier_code: 'carrierCode',
    },
}

const archiveViewMapping = {
    isWildcard: false,
    projectedColumns: [
        'ID', 'orderId', 'status', 'carrier_code', 'trackingNumber',
        'shippedAt', 'estimatedDelivery', 'actualDelivery',
        'destinationCity', 'destinationCountry', 'modifiedAt',
    ],
    remoteToLocal: {
        carrier_code: 'carrierCode',
    },
}

const ARCHIVE_NS = 'archiveDev.'

async function deployArchiveDb() {
    const model = cds.model
    if (!model?.definitions) return

    const definitions = {}
    for (const [key, def] of Object.entries(model.definitions)) {
        if (
            key === 'archiveDev'
            || key.startsWith(ARCHIVE_NS)
        ) {
            const copy = { ...def }
            delete copy['@cds.persistence.skip']
            copy['@cds.persistence.table'] = true
            definitions[key] = copy
        }
    }
    if (!definitions['archiveDev.ShipmentArchive']) return

    const archiveDb = await cds.connect.to('ArchiveDb')
    await cds.deploy({
        $version: model.$version,
        $sources: model.$sources,
        definitions,
    }).to(archiveDb)
}

cds.on('served', async () => {
    await deployArchiveDb()

    const pipelines = await cds.connect.to('data-pipeline')
    const log = cds.log('pipeline-console-dev')

    await pipelines.addPipeline({
        name: 'Shipments',
        description: 'Scheduled OData replicate — primary console dev target.',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Shipments' },
        target: { entity: 'consoleDev.Shipments' },
        delta: { mode: 'timestamp', field: 'modifiedAt' },
        viewMapping: shipmentsViewMapping,
        schedule: 120_000,
    })

    // Showcase persisted overrides in the Pipeline Console (Overview → Configuration
    // overrides table). Safe to re-run: merge is idempotent.
    await pipelines.setOverrides('Shipments', {
        source: { batchSize: 250 },
        description: 'Dev override: slower paging for console demos',
    })
    log.info('Shipments: applied demo overrides (source.batchSize=250)')

    await pipelines.addPipeline({
        name: 'Carriers',
        description: 'Second pipeline on LogisticsService — landscape grouping.',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Carriers' },
        target: { entity: 'consoleDev.Carriers' },
        mode: 'full',
        // LogisticsService.Carriers has no modifiedAt — disable row-delta filters
        // so manual "delta" runs from the console do not 400 on the remote.
        delta: { mode: 'none' },
    })

    await pipelines.addPipeline({
        name: 'FxRates',
        description: 'REST source — second service group in the landscape graph.',
        source: { service: 'FXService' },
        target: { entity: 'consoleDev.FxRates' },
        rest: {
            path: '/api/rates',
            pagination: { type: 'offset', pageSize: 100 },
            deltaParam: 'modifiedSince',
            dataPath: 'results',
        },
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    })

    await pipelines.addPipeline({
        name: 'ShipmentArchive',
        description: 'OData → secondary SQLite (ArchiveDb) — engine-only move pattern.',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Shipments' },
        target: { service: 'ArchiveDb', entity: 'archiveDev.ShipmentArchive' },
        delta: { mode: 'timestamp', field: 'modifiedAt' },
        viewMapping: archiveViewMapping,
    })

    pipelines.after('PIPELINE.MAP', 'ShipmentArchive', (_results, req) => {
        const now = new Date().toISOString()
        for (const row of req.data.targetRecords) row.archivedAt = now
    })

    await pipelines.addPipeline({
        name: 'CarriersToReporting',
        description: 'Custom ReportingTargetAdapter — target side not available in data inspector.',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Carriers' },
        target: {
            service: 'ReportingService',
            entity: 'reportingDev.CarrierFacts',
            adapter: ReportingTargetAdapter,
        },
        mode: 'full',
        delta: { mode: 'none' },
    })

    await pipelines.addPipeline({
        name: 'ShipmentsWithHooks',
        description: 'Replicate with custom PIPELINE.* hooks — orange nodes in flow graphs.',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Shipments' },
        target: { entity: 'consoleDev.ShipmentsWithHooks' },
        delta: { mode: 'timestamp', field: 'modifiedAt' },
        viewMapping: shipmentsViewMapping,
    })

    const runState = new Map()

    pipelines.before('PIPELINE.START', 'ShipmentsWithHooks', (req) => {
        runState.set(req.data.runId, { startedAt: Date.now() })
    })

    pipelines.before('PIPELINE.MAP', 'ShipmentsWithHooks', (req) => {
        req.data.sourceRecords = req.data.sourceRecords.filter((r) => r.status !== 'pending')
    })

    pipelines.after('PIPELINE.WRITE', 'ShipmentsWithHooks', async (_results, req) => {
        const { runId, batchIndex, targetRecords } = req.data
        await cds.tx(req).run(INSERT.into('consoleDev.BatchMetrics').entries({
            runId,
            batchIndex,
            recordCount: targetRecords.length,
            writtenAt: new Date().toISOString(),
        }))
    })

    pipelines.after('PIPELINE.DONE', 'ShipmentsWithHooks', (_results, req) => {
        const state = runState.get(req.data.runId)
        const durationMs = state ? Date.now() - state.startedAt : -1
        runState.delete(req.data.runId)
        log.info(`[ShipmentsWithHooks] done status=${req.data.status} duration=${durationMs}ms`)
    })
})

module.exports = cds.server
