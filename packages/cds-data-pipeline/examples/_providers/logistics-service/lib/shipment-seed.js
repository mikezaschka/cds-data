const STATUSES = ['pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception']
const CARRIERS = ['UPS', 'FDX', 'DHL', 'FRT']
const DESTINATIONS = [
    { city: 'Reims', country: 'FRA' },
    { city: 'Münster', country: 'DEU' },
    { city: 'Rio de Janeiro', country: 'BRA' },
    { city: 'Lyon', country: 'FRA' },
    { city: 'Charleroi', country: 'BEL' },
    { city: 'Bern', country: 'CHE' },
    { city: 'Genève', country: 'CHE' },
    { city: 'Resende', country: 'BRA' },
    { city: 'Caracas', country: 'VEN' },
    { city: 'Walldorf', country: 'DEU' },
    { city: 'Berlin', country: 'DEU' },
    { city: 'Paris', country: 'FRA' },
    { city: 'Madrid', country: 'ESP' },
    { city: 'Amsterdam', country: 'NLD' },
]

const TRACKING_PREFIX = { UPS: '1Z12345E020527', FDX: '7734567812', DHL: 'JD014600003432', FRT: 'FRT-2025-' }

function padShipmentId(index) {
    return `a6f3c0e0-0001-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function isoDay(baseDay, offsetDays, hour = 9, minute = 0) {
    const date = new Date(Date.UTC(2025, 1, baseDay + offsetDays, hour, minute, 0))
    return date.toISOString()
}

function buildShipments(count, { orderIdStart = 10248 } = {}) {
    const rows = []
    for (let i = 1; i <= count; i++) {
        const status = STATUSES[(i - 1) % STATUSES.length]
        const carrier = CARRIERS[(i - 1) % CARRIERS.length]
        const dest = DESTINATIONS[(i - 1) % DESTINATIONS.length]
        const shippedAt = status === 'pending' ? null : isoDay(1 + (i % 20), i % 7, 8 + (i % 10), i % 60)
        const estimatedDelivery = isoDay(4 + (i % 15), i % 5, 17)
        const delivered = status === 'delivered'
        const actualDelivery = delivered ? isoDay(3 + (i % 12), i % 6, 11 + (i % 8), (i * 3) % 60) : null
        const modifiedAt = actualDelivery || shippedAt || isoDay(1, i % 14, 15)

        rows.push({
            ID: padShipmentId(i),
            orderId: orderIdStart + i - 1,
            status,
            carrier_code: carrier,
            trackingNumber: status === 'pending' ? null : `${TRACKING_PREFIX[carrier]}${String(i).padStart(4, '0')}`,
            shippedAt,
            estimatedDelivery,
            actualDelivery,
            destinationCity: dest.city,
            destinationCountry: dest.country,
            modifiedAt,
        })
    }
    return rows
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

module.exports = { buildShipments, devShipments, prodShipments }
