const cds = require('@sap/cds')
const { SHIPMENT_KEY_TEST, SHIPMENT_PAYLOAD_TEST } = require('../lib/event-topics.js')

const LOG = 'logistics-service'

// Optional artificial delay on Carriers reads. Kept for retry / resilience
// demos but default is 0 — the cds-data-pipeline plugin does not have a
// client-side cache feature, so no reason to slow down by default.
const CARRIERS_DELAY_MS = Number(process.env.LOGISTICS_CARRIERS_DELAY_MS ?? 0)

// Origin label — when set (DEV / PROD), the `served` hook below swaps the
// default seed data for origin-specific shipments so two instances of this
// provider can feed `examples/05-multi-source-fanin/`.
const ORIGIN = process.env.LOGISTICS_ORIGIN

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
    if (!ORIGIN) return
    const db = await cds.connect.to('db')
    const { Shipments } = db.entities('logistics')
    await db.run(DELETE.from(Shipments))
    const seed = ORIGIN === 'PROD' ? prodShipments() : devShipments()
    await db.run(INSERT.into(Shipments).entries(seed))
    cds.log('logistics-seed').info(`Reseeded Shipments for LOGISTICS_ORIGIN=${ORIGIN} (${seed.length} rows)`)
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

function devShipments() {
    return [
        { ID: 'd0000000-0001-4000-8000-00000000dev1', orderId: 90001, status: 'in_transit',
            carrier_code: 'UPS', trackingNumber: 'DEV-UPS-0001', shippedAt: '2025-02-10T09:00:00Z',
            estimatedDelivery: '2025-02-13T17:00:00Z', destinationCity: 'Walldorf',
            destinationCountry: 'DEU', modifiedAt: '2025-02-10T09:00:00Z' },
        { ID: 'd0000000-0001-4000-8000-00000000dev2', orderId: 90002, status: 'delivered',
            carrier_code: 'FDX', trackingNumber: 'DEV-FDX-0002', shippedAt: '2025-02-11T08:00:00Z',
            estimatedDelivery: '2025-02-14T17:00:00Z', actualDelivery: '2025-02-14T12:00:00Z',
            destinationCity: 'Berlin', destinationCountry: 'DEU', modifiedAt: '2025-02-14T12:00:00Z' },
        { ID: 'd0000000-0001-4000-8000-00000000dev3', orderId: 90003, status: 'pending',
            carrier_code: 'DHL', trackingNumber: 'DEV-DHL-0003', shippedAt: null,
            estimatedDelivery: '2025-02-18T17:00:00Z', destinationCity: 'Heidelberg',
            destinationCountry: 'DEU', modifiedAt: '2025-02-12T15:00:00Z' },
    ]
}

function prodShipments() {
    return [
        { ID: 'p0000000-0001-4000-8000-0000000prod1', orderId: 10001, status: 'delivered',
            carrier_code: 'UPS', trackingNumber: 'PRD-UPS-1001', shippedAt: '2025-02-01T06:00:00Z',
            estimatedDelivery: '2025-02-04T17:00:00Z', actualDelivery: '2025-02-04T10:00:00Z',
            destinationCity: 'Paris', destinationCountry: 'FRA', modifiedAt: '2025-02-04T10:00:00Z' },
        { ID: 'p0000000-0001-4000-8000-0000000prod2', orderId: 10002, status: 'in_transit',
            carrier_code: 'FDX', trackingNumber: 'PRD-FDX-1002', shippedAt: '2025-02-03T07:30:00Z',
            estimatedDelivery: '2025-02-06T17:00:00Z', destinationCity: 'Madrid',
            destinationCountry: 'ESP', modifiedAt: '2025-02-05T12:00:00Z' },
        { ID: 'p0000000-0001-4000-8000-0000000prod3', orderId: 10003, status: 'out_for_delivery',
            carrier_code: 'DHL', trackingNumber: 'PRD-DHL-1003', shippedAt: '2025-02-05T09:00:00Z',
            estimatedDelivery: '2025-02-07T17:00:00Z', destinationCity: 'Rome',
            destinationCountry: 'ITA', modifiedAt: '2025-02-07T08:00:00Z' },
        { ID: 'p0000000-0001-4000-8000-0000000prod4', orderId: 10004, status: 'delivered',
            carrier_code: 'UPS', trackingNumber: 'PRD-UPS-1004', shippedAt: '2025-02-06T10:00:00Z',
            estimatedDelivery: '2025-02-09T17:00:00Z', actualDelivery: '2025-02-09T14:00:00Z',
            destinationCity: 'Amsterdam', destinationCountry: 'NLD', modifiedAt: '2025-02-09T14:00:00Z' },
    ]
}
