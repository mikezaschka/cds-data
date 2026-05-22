const express = require('express')

const app = express()
app.use(express.json())

const customers = [
    { ID: 'C001', name: 'Acme Corp', city: 'Berlin', country: 'DE', email: 'acme@example.com', blocked: false, modifiedAt: '2025-01-15T10:00:00Z' },
    { ID: 'C002', name: 'Globex Inc', city: 'Munich', country: 'DE', email: 'globex@example.com', blocked: false, modifiedAt: '2025-02-01T12:00:00Z' },
    { ID: 'C003', name: 'Initech Ltd', city: 'London', country: 'GB', email: 'initech@example.com', blocked: true, modifiedAt: '2025-02-15T08:30:00Z' },
    { ID: 'C004', name: 'Umbrella Corp', city: 'Paris', country: 'FR', email: 'umbrella@example.com', blocked: false, modifiedAt: '2025-03-01T09:00:00Z' },
    { ID: 'C005', name: 'Stark Industries', city: 'New York', country: 'US', email: 'stark@example.com', blocked: false, modifiedAt: '2025-03-10T14:00:00Z' },
]

const products = [
    { ID: 'P001', name: 'Laptop Pro', category: 'Electronics', price: 1299.99, currency: 'EUR', stock: 50, modifiedAt: '2025-01-10T10:00:00Z' },
    { ID: 'P002', name: 'Wireless Mouse', category: 'Electronics', price: 29.99, currency: 'EUR', stock: 200, modifiedAt: '2025-01-12T11:00:00Z' },
    { ID: 'P003', name: 'Office Desk', category: 'Furniture', price: 449.00, currency: 'EUR', stock: 30, modifiedAt: '2025-02-01T09:00:00Z' },
    { ID: 'P004', name: 'Ergonomic Chair', category: 'Furniture', price: 599.00, currency: 'EUR', stock: 25, modifiedAt: '2025-02-05T14:00:00Z' },
    { ID: 'P005', name: 'USB-C Hub', category: 'Electronics', price: 79.99, currency: 'EUR', stock: 100, modifiedAt: '2025-03-01T08:00:00Z' },
]

function filterByModifiedSince(data, modifiedSince) {
    if (!modifiedSince) return [...data]
    const since = new Date(modifiedSince)
    return data.filter(r => new Date(r.modifiedAt) > since)
}

/**
 * Offset/limit pagination — ?limit=&offset= or defaults
 */
function handleList(data, req, res) {
    let result = filterByModifiedSince(data, req.query.modifiedSince)

    const total = result.length
    const limit = parseInt(req.query.limit, 10) || result.length
    const offset = parseInt(req.query.offset, 10) || 0
    result = result.slice(offset, offset + limit)

    res.json({ results: result, total })
}

/**
 * Page/limit pagination — ?page=1&limit=2 (1-based page)
 */
function handlePageList(data, req, res) {
    let result = filterByModifiedSince(data, req.query.modifiedSince)
    const limit = parseInt(req.query.limit, 10) || result.length
    const page = parseInt(req.query.page, 10) || 1
    const offset = (page - 1) * limit
    const pageRows = result.slice(offset, offset + limit)
    res.json({ results: pageRows, total: result.length })
}

const CURSOR_PAGE = 2

app.get('/api/customers', (req, res) => handleList(customers, req, res))
app.get('/api/products', (req, res) => handleList(products, req, res))
app.get('/api/customers-paged', (req, res) => handlePageList(customers, req, res))

/** Cursor pagination: ?cursor=startIndex; response { items, nextCursor } */
app.get('/api/customers-cursor', (req, res) => {
    const result = filterByModifiedSince(customers, req.query.modifiedSince)
    const start = parseInt(req.query.cursor, 10) || 0
    const batch = result.slice(start, start + CURSOR_PAGE)
    const nextCursor = start + CURSOR_PAGE < result.length ? String(start + CURSOR_PAGE) : null
    res.json({ items: batch, nextCursor })
})

app.get('/', (req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 4446
const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`REST provider listening on port ${PORT}`)
    // eslint-disable-next-line no-console
    console.log('[cds] - server listening on { url: \'http://localhost:' + PORT + '\' }')
})

module.exports = { app, server }
