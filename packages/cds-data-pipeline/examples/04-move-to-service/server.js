const cds = require('@sap/cds')

// Move-to-service: read from a remote OData entity, write to another
// remote OData entity on the same (or a different) service. The target
// adapter is auto-selected — `LogisticsService` in `cds.requires` has
// `kind: 'odata'`, so `target.service: 'LogisticsService'` routes writes
// through `ODataTargetAdapter`. Writes translate to POST / PATCH / DELETE
// via CAP's connected remote service ($batch change sets where the
// backend supports them).
cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')

    await pipelines.addPipeline({
        name: 'ShipmentArchive',

        source: {
            service: 'LogisticsService',
            entity:  'LogisticsService.Shipments',
        },

        // Remote target — no local table at all. `kind: 'odata'` is
        // optional (auto-detected from `service.options.kind`), kept here
        // for clarity. `batchSize` caps each $batch change set; keep it
        // modest to avoid payload limits on stricter gateways.
        target: {
            service:    'LogisticsService',
            entity:     'LogisticsService.ShipmentArchive',
            kind:       'odata',
            batchSize:  200,
            maxRetries: 3,
            retryDelay: 1000,
        },

        // Source `Shipments.carrier.code` → target `ShipmentArchive.carrierCode`.
        // The built-in PIPELINE.MAP_BATCH default runs this rename; the
        // `archivedAt` stamp is applied by the `before('PIPELINE.MAP_BATCH')`
        // hook below so the column is populated consistently.
        viewMapping: {
            isWildcard: false,
            projectedColumns: [
                'ID', 'orderId', 'status', 'carrier_code', 'trackingNumber',
                'shippedAt', 'estimatedDelivery', 'actualDelivery',
                'destinationCity', 'destinationCountry', 'modifiedAt'
            ],
            remoteToLocal: {
                carrier_code: 'carrierCode',
            },
        },

        // Keep wire volume low with a modifiedAt-based delta. `full` mode
        // is available but does O(n) remote DELETEs (OData has no bulk
        // delete primitive) — avoid on high-volume pipelines.
        delta: { mode: 'timestamp', field: 'modifiedAt' },
    })

    // Stamp `archivedAt` on every outbound batch. `req.data.sourceRecords`
    // holds the source-shape rows; `req.data.targetRecords` is populated
    // by the built-in MAP_BATCH default. We let the default run first
    // (so renames are applied), then mutate each target row in an
    // `after` hook.
    pipelines.after('PIPELINE.MAP_BATCH', 'ShipmentArchive', (_results, req) => {
        const now = new Date().toISOString()
        for (const row of req.data.targetRecords) row.archivedAt = now
    })
})

module.exports = cds.server
