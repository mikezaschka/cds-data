/**
 * Plain REST provider for the examples — box-office figures.
 *
 * - GET /api/box-office — list with ?limit&offset&modifiedSince
 *
 * Shape: { results: [{ ID, movie_ID, date, revenue, tickets, territory, modifiedAt }], total }
 *
 * Used by examples/consumer ReplicatedBoxOffice to demonstrate the REST adapter
 * (offset pagination + delta param).
 */
const express = require('express')

const app = express()
app.use(express.json())

const MOVIES = [
    'M001', 'M002', 'M003', 'M004', 'M005',
    'M006', 'M007', 'M008', 'M009', 'M010',
    'M011', 'M012', 'M013', 'M014', 'M015',
    'M016', 'M017', 'M018', 'M019', 'M020'
]

const TERRITORIES = ['USA', 'EUR', 'APAC']

// Deterministic pseudo-random so repeated deploys yield the same data
function prng(seed) {
    let s = seed
    return () => {
        s = (s * 9301 + 49297) % 233280
        return s / 233280
    }
}

function generate() {
    const rows = []
    const rand = prng(42)
    for (let day = 0; day < 10; day++) {
        const date = new Date(Date.UTC(2025, 0, 1 + day))
        const dateStr = date.toISOString().slice(0, 10)
        const modifiedAt = new Date(Date.UTC(2025, 0, 1 + day, 23, 30, 0)).toISOString()
        for (const movie of MOVIES) {
            const territory = TERRITORIES[Math.floor(rand() * TERRITORIES.length)]
            const baseRevenue = 500000 + Math.floor(rand() * 4500000)
            const ticketPrice = 10 + Math.floor(rand() * 6)
            rows.push({
                ID: `${movie}-${dateStr}-${territory}`,
                movie_ID: movie,
                date: dateStr,
                revenue: baseRevenue,
                tickets: Math.floor(baseRevenue / ticketPrice),
                territory,
                modifiedAt
            })
        }
    }
    return rows
}

const boxOffice = generate()

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

app.get('/api/box-office', (req, res) => handleList(boxOffice, req, res))

app.get('/', (req, res) => res.json({
    status: 'ok',
    endpoints: ['/api/box-office'],
    sampleRecords: boxOffice.length
}))

const PORT = process.env.PORT || 4446
const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Box-office REST provider listening on port ${PORT} (${boxOffice.length} records)`)
    // eslint-disable-next-line no-console
    console.log('[cds] - server listening on { url: \'http://localhost:' + PORT + '\' }')
})

module.exports = { app, server }
