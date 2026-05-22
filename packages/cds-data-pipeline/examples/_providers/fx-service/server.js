const express = require('express')

const app = express()
app.use(express.json())

// Synthetic daily FX rates — one entry per (base, quote, date) triple.
// Minimal but enough to drive the Sales Analytics ALP currency conversion.
const rates = [
    { ID: 'EUR-USD-2025-02-03', baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.0821, rateDate: '2025-02-03', modifiedAt: '2025-02-03T06:00:00Z' },
    { ID: 'EUR-USD-2025-02-04', baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.0845, rateDate: '2025-02-04', modifiedAt: '2025-02-04T06:00:00Z' },
    { ID: 'EUR-USD-2025-02-05', baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.0862, rateDate: '2025-02-05', modifiedAt: '2025-02-05T06:00:00Z' },
    { ID: 'EUR-USD-2025-02-06', baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.0879, rateDate: '2025-02-06', modifiedAt: '2025-02-06T06:00:00Z' },
    { ID: 'EUR-USD-2025-02-07', baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.0893, rateDate: '2025-02-07', modifiedAt: '2025-02-07T06:00:00Z' },
    { ID: 'EUR-USD-2025-02-10', baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.0914, rateDate: '2025-02-10', modifiedAt: '2025-02-10T06:00:00Z' },

    { ID: 'EUR-GBP-2025-02-03', baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8324, rateDate: '2025-02-03', modifiedAt: '2025-02-03T06:00:00Z' },
    { ID: 'EUR-GBP-2025-02-04', baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8311, rateDate: '2025-02-04', modifiedAt: '2025-02-04T06:00:00Z' },
    { ID: 'EUR-GBP-2025-02-05', baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8298, rateDate: '2025-02-05', modifiedAt: '2025-02-05T06:00:00Z' },
    { ID: 'EUR-GBP-2025-02-06', baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8307, rateDate: '2025-02-06', modifiedAt: '2025-02-06T06:00:00Z' },
    { ID: 'EUR-GBP-2025-02-07', baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8319, rateDate: '2025-02-07', modifiedAt: '2025-02-07T06:00:00Z' },
    { ID: 'EUR-GBP-2025-02-10', baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8341, rateDate: '2025-02-10', modifiedAt: '2025-02-10T06:00:00Z' },

    { ID: 'EUR-BRL-2025-02-03', baseCurrency: 'EUR', quoteCurrency: 'BRL', rate: 6.2415, rateDate: '2025-02-03', modifiedAt: '2025-02-03T06:00:00Z' },
    { ID: 'EUR-BRL-2025-02-06', baseCurrency: 'EUR', quoteCurrency: 'BRL', rate: 6.2871, rateDate: '2025-02-06', modifiedAt: '2025-02-06T06:00:00Z' },
    { ID: 'EUR-BRL-2025-02-10', baseCurrency: 'EUR', quoteCurrency: 'BRL', rate: 6.3022, rateDate: '2025-02-10', modifiedAt: '2025-02-10T06:00:00Z' },

    { ID: 'EUR-CHF-2025-02-03', baseCurrency: 'EUR', quoteCurrency: 'CHF', rate: 0.9342, rateDate: '2025-02-03', modifiedAt: '2025-02-03T06:00:00Z' },
    { ID: 'EUR-CHF-2025-02-07', baseCurrency: 'EUR', quoteCurrency: 'CHF', rate: 0.9358, rateDate: '2025-02-07', modifiedAt: '2025-02-07T06:00:00Z' },
    { ID: 'EUR-CHF-2025-02-10', baseCurrency: 'EUR', quoteCurrency: 'CHF', rate: 0.9371, rateDate: '2025-02-10', modifiedAt: '2025-02-10T06:00:00Z' },
]

function handleList(data, req, res) {
    let result = [...data]

    const modifiedSince = req.query.modifiedSince
    if (modifiedSince) {
        const since = new Date(modifiedSince)
        result = result.filter(r => new Date(r.modifiedAt) > since)
    }

    const total = result.length
    const limit = parseInt(req.query.limit) || result.length
    const offset = parseInt(req.query.offset) || 0
    result = result.slice(offset, offset + limit)

    res.json({ results: result, total })
}

app.get('/api/rates', (req, res) => handleList(rates, req, res))

app.get('/', (req, res) => res.json({ status: 'ok', service: 'fx-service', rates: rates.length }))

const PORT = process.env.PORT || 4456
const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`FX service listening on port ${PORT}`)
    // eslint-disable-next-line no-console
    console.log('[cds] - server listening on { url: \'http://localhost:' + PORT + '\' }')
})

module.exports = { app, server }
