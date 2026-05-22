const cds = require('@sap/cds')

// Register pipelines as soon as CAP has served its own services. The
// DataPipelineService is already instantiated by the plugin during
// `loaded`, so `connect.to(...)` here resolves the live instance.
cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')

    // Entity-shape read from a remote OData V4 service → local DB table.
    // - Source adapter is resolved from the connected `LogisticsService`
    //   kind ('odata' in package.json `cds.requires`), so no explicit
    //   `source.kind` is needed.
    // - Target adapter defaults to DbTargetAdapter because `target.service`
    //   is unset.
    // - Delta mode = 'timestamp' is inferred from the shape; `delta.field`
    //   defaults to 'modifiedAt'. We set it explicitly for clarity.
    // - `viewMapping.remoteToLocal` mirrors the alias list in the
    //   consumption view so the built-in PIPELINE.MAP_BATCH default
    //   renames each batch on the fly without a custom hook.
    // - `schedule: 60_000` wires an in-process spawn timer (every 60s).
    //   Swap to `{ every: '10m', engine: 'queued' }` for the persistent
    //   task-queue engine, or omit `schedule` and drive runs externally
    //   via `POST /pipeline/execute`.
    await pipelines.addPipeline({
        name: 'Shipments',
        description: 'Replicates logistics shipments into the local consumption view (OData V4 delta by modifiedAt).',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Shipments' },
        target: { entity: 'example01.Shipments' },

        delta: { mode: 'timestamp', field: 'modifiedAt' },

        viewMapping: {
            isWildcard: false,
            projectedColumns: [
                'ID', 'orderId', 'status', 'carrier_code', 'trackingNumber',
                'shippedAt', 'estimatedDelivery', 'actualDelivery',
                'destinationCity', 'destinationCountry', 'modifiedAt'
            ],
            remoteToLocal: {
                ID: 'id',
                carrier_code: 'carrierCode',
            },
        },

        schedule: 60_000,
    })
})

module.exports = cds.server
