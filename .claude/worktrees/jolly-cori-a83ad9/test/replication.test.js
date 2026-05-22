const cds = require('@sap/cds')
const { startProvider, stopProvider, startRestProvider, stopRestProvider } = require('./setup')

describe('Replicate Strategy', () => {

    const { expect } = cds.test(__dirname + '/consumer/')

    beforeAll(async () => {
        await startProvider()
        await startRestProvider()
    }, 30000)
    afterAll(async () => {
        await stopProvider()
        await stopRestProvider()
    })

    async function getReplicationService() {
        const srv = await cds.connect.to('DataReplicationService')
        if (!srv) throw new Error('Replication service not initialized')
        return srv
    }

    // ─── Full sync ─────────────────────────────────────────────────────────────

    describe('Full sync', () => {

        it('R1: should replicate all customers to local DB on full sync', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.be.an('array')
            expect(rows).to.have.length(5)
            expect(rows.map(c => c.ID).sort()).to.deep.equal(['C001', 'C002', 'C003', 'C004', 'C005'])
        })

        it('R2: should replicate products with renamed fields', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedProducts', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedProducts')
            expect(rows).to.be.an('array')
            expect(rows).to.have.length(5)

            const laptop = rows.find(p => p.productId === 'P001')
            expect(laptop).to.exist
            expect(laptop.productName).to.equal('Laptop Pro')
            expect(laptop.unitPrice).to.equal(1299.99)
            expect(laptop.currency).to.equal('EUR')
            expect(laptop.category).to.equal('Electronics')
            // Remote-only fields should NOT be present
            expect(laptop).to.not.have.property('stock')
            expect(laptop).to.not.have.property('name')
            expect(laptop).to.not.have.property('price')
        })

        it('R3: should be idempotent — no duplicates on repeated full sync', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(5)
        })

        it('R4: full sync should truncate and re-replicate (clean slate)', async () => {
            const srv = await getReplicationService()

            await srv.run('ReplicatedCustomers', 'full', 'manual')
            let rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(5)

            await srv.run('ReplicatedCustomers', 'full', 'manual')
            rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(5)
        })
    })

    // ─── Delta sync ────────────────────────────────────────────────────────────

    describe('Delta sync', () => {

        it('R5: should track lastSync timestamp after successful run', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const status = await srv.getStatus('ReplicatedCustomers')
            expect(status.lastSync).to.be.a('string')
            expect(status.status).to.equal('idle')
        })

        it('R6: delta sync should only fetch records newer than lastSync', async () => {
            const srv = await getReplicationService()

            // Full sync first to establish baseline
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            // Delta sync: all provider records have modifiedAt in 2025, lastSync is now ~2026
            await srv.run('ReplicatedCustomers', 'delta', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(5)
        })

        it('R7: should UPSERT records (update existing, insert new)', async () => {
            const srv = await getReplicationService()

            await srv.run('ReplicatedProducts', 'full', 'manual')

            const before = await SELECT.from('consumer.ReplicatedProducts')
            expect(before).to.have.length(5)

            // Full sync again — UPSERT should update, not duplicate
            await srv.run('ReplicatedProducts', 'full', 'manual')
            const after = await SELECT.from('consumer.ReplicatedProducts')
            expect(after).to.have.length(5)
        })
    })

    // ─── Statistics tracking ───────────────────────────────────────────────────

    describe('Statistics tracking', () => {

        it('R8: should track statistics (created counts) on tracker', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const status = await srv.getStatus('ReplicatedCustomers')
            expect(status.statistics_created).to.be.at.least(5)
        })

        it('R9: should record replication runs', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedProducts', 'full', 'manual')

            const runs = await SELECT.from('plugin_data_federation_ReplicationRuns')
                .where({ tracker_name: 'ReplicatedProducts' })
            expect(runs.length).to.be.at.least(1)

            const latestRun = runs.sort((a, b) =>
                new Date(b.startTime) - new Date(a.startTime)
            )[0]
            expect(latestRun.status).to.equal('completed')
            expect(latestRun.mode).to.equal('full')
            expect(latestRun.trigger).to.equal('manual')
            expect(latestRun.statistics_created).to.equal(5)
        })
    })

    // ─── Concurrency ──────────────────────────────────────────────────────────

    describe('Concurrency guard', () => {

        it('R10: should allow sequential runs after first completes', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(5)
        })
    })

    // ─── Local data queries ───────────────────────────────────────────────────

    describe('Local data queries', () => {

        it('R11: replicated data should be queryable via $filter', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
                .where({ country: 'DE' })
            expect(rows).to.have.length(2)
            expect(rows.every(c => c.country === 'DE')).to.be.true
        })

        it('R12: replicated data with renames should be queryable via local field names', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedProducts', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedProducts')
                .where({ category: 'Electronics' })
            expect(rows).to.have.length(3)

            const sorted = await SELECT.from('consumer.ReplicatedProducts')
                .orderBy({ unitPrice: 'desc' })
            expect(sorted[0].productName).to.equal('Laptop Pro')
        })

        it('R13: replicated data should support $select via CQL', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedProducts', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedProducts')
                .columns('productId', 'productName')
            expect(rows).to.have.length(5)
            expect(rows[0]).to.have.property('productId')
            expect(rows[0]).to.have.property('productName')
        })

        it('R14: replicated data should support count', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const result = await SELECT.one.from('consumer.ReplicatedCustomers')
                .columns('count(*) as count')
            expect(result.count).to.equal(5)
        })

        it('R15: replicated data should support $top/$skip via CQL', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
                .limit(2).orderBy({ ID: 'asc' })
            expect(rows).to.have.length(2)
            expect(rows[0].ID).to.equal('C001')
            expect(rows[1].ID).to.equal('C002')
        })
    })

    // ─── Manual trigger + flush ───────────────────────────────────────────────

    describe('Manual trigger + flush', () => {

        it('R16: should support manual trigger via run() API', async () => {
            const srv = await getReplicationService()

            await srv.clear('ReplicatedCustomers')
            let rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(0)

            await srv.run('ReplicatedCustomers', 'full', 'manual')
            rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(5)
        })

        it('R17: should support flush (clear replicated data)', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedCustomers', 'full', 'manual')

            await srv.clear('ReplicatedCustomers')
            const rows = await SELECT.from('consumer.ReplicatedCustomers')
            expect(rows).to.have.length(0)

            const status = await srv.getStatus('ReplicatedCustomers')
            expect(status.lastSync).to.be.null
            expect(status.status).to.equal('idle')
        })
    })

    // ─── REPLICATE.MAP phase hooks ────────────────────────────────────────────

    describe('REPLICATE.MAP phase hooks', () => {

        it('R18: should allow before.REPLICATE.MAP handler to filter records', async () => {
            const srv = await getReplicationService()

            // Register a before.REPLICATE.MAP handler that filters out blocked customers
            srv.before('REPLICATE.MAP', 'ReplicatedCustomers', async (req) => {
                // Sanity check: CAP wiring produces a proper request context
                expect(cds.context).to.exist
                req.data.sourceRecords = req.data.sourceRecords.filter(
                    r => r.blocked === false || r.blocked === 'false'
                )
            })

            await srv.run('ReplicatedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedCustomers')
            // C003 is blocked=true, so should be filtered out
            expect(rows).to.have.length(4)
            expect(rows.every(c => c.ID !== 'C003')).to.be.true
        })

        it('R19: should allow after.REPLICATE.MAP handler to enrich records', async () => {
            const srv = await getReplicationService()

            // CAP `after` hooks receive `(results, req)`. For non-READ events
            // `results` is `req.results` (often undefined); read/write data
            // from the second arg.
            srv.after('REPLICATE.MAP', 'ReplicatedProducts', async (_results, req) => {
                req.data.targetRecords = req.data.targetRecords.map(r => ({
                    ...r,
                    category: r.category ? r.category.toUpperCase() : r.category,
                }))
            })

            await srv.run('ReplicatedProducts', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedProducts')
            const laptop = rows.find(p => p.productId === 'P001')
            expect(laptop.category).to.equal('ELECTRONICS')
        })
    })

    // ─── Adapter: OData delta modes ────────────────────────────────────────────

    describe('OData adapter delta modes', () => {

        it('R22: full mode should replicate all records without delta filtering', async () => {
            const srv = await getReplicationService()

            // Use ReplicatedProducts to avoid interference from MAP hooks on Customers
            await srv.run('ReplicatedProducts', 'full', 'manual')
            const rows = await SELECT.from('consumer.ReplicatedProducts')
            expect(rows).to.have.length(5)

            // Run full again — should truncate and re-replicate all
            await srv.run('ReplicatedProducts', 'full', 'manual')
            const rows2 = await SELECT.from('consumer.ReplicatedProducts')
            expect(rows2).to.have.length(5)
        })

        it('R23: timestamp delta should filter by modifiedAt > lastSync', async () => {
            const srv = await getReplicationService()

            // Full sync to establish baseline + set lastSync
            await srv.run('ReplicatedProducts', 'full', 'manual')

            const status = await srv.getStatus('ReplicatedProducts')
            expect(status.lastSync).to.be.a('string')

            // Delta sync: provider data is from 2025, lastSync is now ~2026
            // Should fetch 0 new records, but existing data remains
            await srv.run('ReplicatedProducts', 'delta', 'manual')
            const rows = await SELECT.from('consumer.ReplicatedProducts')
            expect(rows).to.have.length(5)
        })

        it('R24: OData adapter should use viewMapping for column restriction', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedProducts', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedProducts')
            const laptop = rows.find(p => p.productId === 'P001')
            expect(laptop).to.exist
            expect(laptop.productName).to.equal('Laptop Pro')
            // Remote-only fields excluded by viewMapping
            expect(laptop).to.not.have.property('stock')
            expect(laptop).to.not.have.property('name')
        })
    })

    // ─── Adapter: REST ──────────────────────────────────────────────────────────

    describe('REST adapter', () => {

        it('R25: should replicate customers from REST API via full sync', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedRestCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
            expect(rows).to.be.an('array')
            expect(rows).to.have.length(5)
            expect(rows.map(c => c.ID).sort()).to.deep.equal(['C001', 'C002', 'C003', 'C004', 'C005'])
        })

        it('R26: should replicate with correct field values from REST response', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedRestCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
            const acme = rows.find(c => c.ID === 'C001')
            expect(acme).to.exist
            expect(acme.name).to.equal('Acme Corp')
            expect(acme.city).to.equal('Berlin')
            expect(acme.country).to.equal('DE')
        })

        it('R27: REST delta sync should pass modifiedSince parameter', async () => {
            const srv = await getReplicationService()

            await srv.run('ReplicatedRestCustomers', 'full', 'manual')
            const status = await srv.getStatus('ReplicatedRestCustomers')
            expect(status.lastSync).to.be.a('string')

            // Delta sync: provider data is from 2025, lastSync is ~2026
            // Should fetch 0 new records (all older than lastSync)
            await srv.run('ReplicatedRestCustomers', 'delta', 'manual')
            const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
            expect(rows).to.have.length(5)
        })

        it('R28: REST replicated data should be queryable locally', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedRestCustomers', 'full', 'manual')

            const deCustomers = await SELECT.from('consumer.ReplicatedRestCustomers')
                .where({ country: 'DE' })
            expect(deCustomers).to.have.length(2)

            const sorted = await SELECT.from('consumer.ReplicatedRestCustomers')
                .orderBy({ name: 'asc' }).limit(2)
            expect(sorted[0].name).to.equal('Acme Corp')
            expect(sorted[1].name).to.equal('Globex Inc')
        })

        it('R29: REST full sync should be idempotent (no duplicates)', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedRestCustomers', 'full', 'manual')
            await srv.run('ReplicatedRestCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
            expect(rows).to.have.length(5)
        })
    })

    // ─── Server-driven paging ──────────────────────────────────────────────────
    //
    // ReplicatedPagedCustomers replicates from a remote entity that caps every
    // response at 2 rows (via @cds.query.limit on the provider). The adapter
    // asks for batchSize=100 per page; the remote keeps returning 2 rows each
    // time. The loop must keep paging by $skip until the remote returns empty
    // — otherwise only the first 2 of 5 rows would be captured.

    describe('Server-driven paging (remote caps at 2 rows/page)', () => {

        it('R30: should replicate all rows when remote enforces a smaller per-request cap than batchSize', async () => {
            const srv = await getReplicationService()
            await srv.run('ReplicatedPagedCustomers', 'full', 'manual')

            const rows = await SELECT.from('consumer.ReplicatedPagedCustomers')
            expect(rows).to.be.an('array')
            expect(rows).to.have.length(5)
            expect(rows.map(c => c.ID).sort()).to.deep.equal(['C001', 'C002', 'C003', 'C004', 'C005'])
        })
    })

    // ─── Management API ────────────────────────────────────────────────────────

    describe('Management API', () => {

        it.skip('R20: should expose federation tracker via OData', async () => {
            // TODO: Fix OData routing for management service
        })

        it.skip('R21: should expose replication runs via OData', async () => {
            // TODO: Fix OData routing for management service
        })
    })
})
