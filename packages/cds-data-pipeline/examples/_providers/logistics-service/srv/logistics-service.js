const cds = require('@sap/cds')
const { SHIPMENT_KEY_TEST, SHIPMENT_PAYLOAD_TEST } = require('../lib/event-topics.js')
const { buildShipments, devShipments, prodShipments } = require('../lib/shipment-seed.js')

const LOG = 'logistics-service'

// Optional artificial delay on Carriers reads. Kept for retry / resilience
// demos but default is 0 — the cds-data-pipeline plugin does not have a
// client-side cache feature, so no reason to slow down by default.
const CARRIERS_DELAY_MS = Number(process.env.LOGISTICS_CARRIERS_DELAY_MS ?? 0)

// Origin label — when set (DEV / PROD), the `served` hook below swaps the
// default seed data for origin-specific shipments so two instances of this
// provider can feed `examples/05-multi-source-fanin/`.
const ORIGIN = process.env.LOGISTICS_ORIGIN

// Bulk shipment count for dev-console / load demos. Ignored when LOGISTICS_ORIGIN
// is set so fan-in examples keep their small origin-specific datasets.
const SHIPMENT_COUNT = Number(process.env.LOGISTICS_SHIPMENT_COUNT ?? 0)

module.exports = cds.service.impl(function () {
    this.before('READ', 'Carriers', async () => {
        if (CARRIERS_DELAY_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, CARRIERS_DELAY_MS))
        }
    })

    this.on('emitShipmentKeyTest', async (req) => {
        const { ID } = req.data
        if (!ID) return req.error(400, 'ID is required')
        const messaging = await cds.connect.to('messaging')
        await messaging.emit(SHIPMENT_KEY_TEST, { ID })
        cds.log(LOG).info('messaging emit', { topic: SHIPMENT_KEY_TEST, ID })
        return { ok: true }
    })

    this.on('emitShipmentPayloadTest', async (req) => {
        const { ID } = req.data
        if (!ID) return req.error(400, 'ID is required')
        const payload = await loadShipmentPayload(ID)
        if (!payload) return req.error(404, `Shipment not found: ${ID}`)
        const messaging = await cds.connect.to('messaging')
        await messaging.emit(SHIPMENT_PAYLOAD_TEST, payload)
        cds.log(LOG).info('messaging emit', { topic: SHIPMENT_PAYLOAD_TEST, ID })
        return { ok: true }
    })
})

cds.on('served', async () => {
    if (!ORIGIN && !(SHIPMENT_COUNT > 0)) return
    const db = await cds.connect.to('db')
    await db.run(DELETE.from('logistics.Shipments'))
    const seed = ORIGIN
        ? (ORIGIN === 'PROD' ? prodShipments() : devShipments())
        : buildShipments(SHIPMENT_COUNT)
    await db.run(INSERT.into('logistics.Shipments').entries(seed))
    const reason = ORIGIN ? `LOGISTICS_ORIGIN=${ORIGIN}` : `LOGISTICS_SHIPMENT_COUNT=${SHIPMENT_COUNT}`
    cds.log('logistics-seed').info(`Reseeded Shipments for ${reason} (${seed.length} rows)`)
})

async function loadShipmentPayload(ID) {
    const db = await cds.connect.to('db')
    const row = await SELECT.one.from('logistics.Shipments').where({ ID })
    if (!row) return null
    return {
        ID: row.ID,
        orderId: row.orderId,
        status: row.status,
        carrier_code: row.carrier_code,
        trackingNumber: row.trackingNumber,
        shippedAt: row.shippedAt,
        estimatedDelivery: row.estimatedDelivery,
        actualDelivery: row.actualDelivery,
        destinationCity: row.destinationCity,
        destinationCountry: row.destinationCountry,
        modifiedAt: row.modifiedAt,
    }
}
