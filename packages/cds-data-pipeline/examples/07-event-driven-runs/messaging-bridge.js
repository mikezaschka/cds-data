const cds = require('@sap/cds')
const {
    SHIPMENT_KEY_TEST,
    SHIPMENT_PAYLOAD_TEST,
} = require('../_providers/logistics-service/lib/event-topics.js')

const LOG = 'example-07-messaging-bridge'

cds.on('served', () => {
    return run()
})

async function run() {
    const messaging = await cds.connect.to('messaging')
    const pipelines = await cds.connect.to('data-pipeline')
    const log = cds.log(LOG)

    messaging.on(SHIPMENT_KEY_TEST, async (msg) => {
        const { ID } = msg.data
        if (!ID) {
            log.warn('ShipmentKeyTest missing data.ID', msg)
            return
        }
        await pipelines.executeEvent('Shipments', {
            event: { read: 'key', action: 'upsert', keys: { ID } },
        })
    })

    messaging.on(SHIPMENT_PAYLOAD_TEST, async (msg) => {
        const payload = msg.data
        if (!payload || !payload.ID) {
            log.warn('ShipmentPayloadTest missing data.ID', msg)
            return
        }
        await pipelines.executeEvent('Shipments', {
            event: { read: 'payload', action: 'upsert', payload },
        })
    })

    log.info('subscribed to', SHIPMENT_KEY_TEST, SHIPMENT_PAYLOAD_TEST)
}
