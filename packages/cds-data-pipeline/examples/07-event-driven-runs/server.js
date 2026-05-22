const cds = require('@sap/cds')

require('./messaging-bridge')

cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')

    // Same entity-shape replicate as example 01 — batch runs use readStream +
    // delta watermark; event micro-runs reuse MAP/WRITE without advancing lastSync.
    await pipelines.addPipeline({
        name: 'Shipments',
        description: 'Batch delta replicate + CAP messaging micro-runs (ADR 0009).',
        source: { service: 'LogisticsService', entity: 'LogisticsService.Shipments' },
        target: { entity: 'example07.Shipments' },

        delta: { mode: 'timestamp', field: 'modifiedAt' },

        viewMapping: {
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
        },
    })
})

module.exports = cds.server
