const cds = require('@sap/cds')

// Two sibling pipelines that consolidate Shipments from DEV and PROD
// LogisticsService instances into one local table. Both write to the
// same `example05.Shipments`; the `sourced` aspect on that entity adds
// the `source` key column so rows coexist.
//
// What the plugin does automatically once `source.origin` is set:
//   - Stamps every mapped row with `source = <origin>` before UPSERT.
//   - Uses the compound key `(ID, source)` for UPSERT keying.
//   - On `mode: 'full'`, scopes the pre-sync DELETE to
//     `source = <origin>` — siblings survive.
//   - Writes `origin` to the tracker row; the Pipeline Monitor shows it
//     on the line item.
//
// No custom hooks needed.
cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService')

    const shared = {
        target: { entity: 'example05.Shipments' },
        delta:  { mode: 'timestamp', field: 'modifiedAt' },
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
    }

    await pipelines.addPipeline({
        ...shared,
        name: 'Shipments_DEV',
        source: {
            service: 'LogisticsDev',
            entity:  'LogisticsDev.Shipments',
            origin:  'DEV',
        },
    })

    await pipelines.addPipeline({
        ...shared,
        name: 'Shipments_PROD',
        source: {
            service: 'LogisticsProd',
            entity:  'LogisticsProd.Shipments',
            origin:  'PROD',
        },
    })
})

module.exports = cds.server
