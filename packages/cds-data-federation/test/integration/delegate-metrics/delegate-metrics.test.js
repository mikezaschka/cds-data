const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../../support/setup')
const metrics = require('../../../srv/metrics/delegate-metrics')

const consumerRoot = path.join(__dirname, '../../fixtures/consumer')

/**
 * Delegate instrumentation against a real database — ADR 0019.
 *
 * The unit tests cover accumulation; what matters here is the *merge*: two
 * flushes must accumulate rather than overwrite, which is the property that
 * makes concurrent instances safe (§5), and min/max must merge by comparison
 * rather than by last-writer-wins.
 *
 * The fixture sets a one-hour flush interval so nothing fires on a timer and
 * every flush below is deliberate.
 */
describe('Delegate metrics persistence (ADR 0019)', () => {

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET, expect, axios } = cds.test(consumerRoot)
    axios.defaults.validateStatus = () => true
    // The management API requires an authenticated user by design.
    axios.defaults.auth = { username: 'alice', password: '' }

    afterAll(async () => {
        await stopProvider()
    })

    const METRICS = 'plugin_data_federation_DelegateMetrics'
    const rowFor = async entity => SELECT.one.from(METRICS).where({ entity })

    beforeEach(async () => {
        await DELETE.from(METRICS)
    })

    it('deploys a table only because the flag is on', async () => {
        // With metrics.enabled unset the model is not loaded at all, so this
        // table would not exist. See lib/plugin-roots.js.
        const tables = (await cds.db.run("select name from sqlite_master where type='table'")).map(t => t.name)
        expect(tables).to.include(METRICS)
    })

    it('counts a delegated read against its consumption view', async () => {
        metrics.record('consumer.Customers', 'read', 12, true)
        await metrics.flush()

        const row = await rowFor('consumer.Customers')
        expect(row, 'no metrics row written').to.exist
        expect(row.requests).to.equal(1)
        expect(row.errors).to.equal(0)
        expect(row.latencySumMs).to.equal(12)
    })

    it('accumulates across flushes instead of overwriting', async () => {
        // This is the concurrency property: a second write onto an existing row
        // must add. Two instances flushing look exactly like this.
        metrics.record('consumer.Customers', 'read', 10, true)
        await metrics.flush()
        metrics.record('consumer.Customers', 'read', 30, true)
        metrics.record('consumer.Customers', 'read', 20, false)
        await metrics.flush()

        const row = await rowFor('consumer.Customers')
        expect(row.requests).to.equal(3)
        expect(row.errors).to.equal(1)
        expect(row.latencySumMs).to.equal(60)
        // The average is derived, never stored: 60 / 3.
        expect(row.latencySumMs / row.requests).to.equal(20)
        expect(row).to.not.have.property('avgLatency')
    })

    it('merges min and max by comparison, not by last write', async () => {
        metrics.record('consumer.Customers', 'read', 50, true)
        await metrics.flush()
        metrics.record('consumer.Customers', 'read', 10, true)
        await metrics.flush()
        metrics.record('consumer.Customers', 'read', 30, true)
        await metrics.flush()

        const row = await rowFor('consumer.Customers')
        // Last flush was 30; a last-writer-wins bug would show 30 for both.
        expect(row.minLatency).to.equal(10)
        expect(row.maxLatency).to.equal(50)
    })

    it('keeps writes apart from reads on the same row', async () => {
        metrics.record('consumer.Customers', 'read', 5, true)
        metrics.record('consumer.Customers', 'write', 8, false)
        await metrics.flush()

        const row = await rowFor('consumer.Customers')
        expect(row.requests).to.equal(1)
        expect(row.writes).to.equal(1)
        expect(row.writeErrors).to.equal(1)
        expect(row.errors).to.equal(0)
    })

    it('keeps entities in separate rows', async () => {
        metrics.record('consumer.A', 'read', 1, true)
        metrics.record('consumer.B', 'read', 2, true)
        await metrics.flush()

        expect((await rowFor('consumer.A')).requests).to.equal(1)
        expect((await rowFor('consumer.B')).requests).to.equal(1)
    })

    it('a real delegated read lands in the table', async () => {
        // End to end: through the OData layer, the delegate handler, and out.
        const before = await SELECT.from(METRICS)
        expect(before).to.have.length(0)

        const { status } = await GET('/odata/v4/consumer/Customers?$top=1')
        expect(status).to.equal(200)
        await metrics.flush()

        const rows = await SELECT.from(METRICS)
        expect(rows.length, 'a delegated read recorded nothing').to.be.greaterThan(0)
        const total = rows.reduce((n, r) => n + r.requests, 0)
        expect(total).to.be.greaterThan(0)
    })

    it('sweeps buckets past the retention window', async () => {
        metrics.record('consumer.Customers', 'read', 1, true)
        await metrics.flush(new Date('2020-01-01T00:00:00Z'))
        expect(await SELECT.from(METRICS)).to.have.length(1)

        await metrics.sweep()
        expect(await SELECT.from(METRICS)).to.have.length(0)
    })

    it('keeps buckets inside the window', async () => {
        metrics.record('consumer.Customers', 'read', 1, true)
        await metrics.flush()
        await metrics.sweep()
        expect(await SELECT.from(METRICS)).to.have.length(1)
    })

    describe('through the management API', () => {

        it('exposes the counters with a derived average', async () => {
            metrics.record('consumer.Customers', 'read', 10, true)
            metrics.record('consumer.Customers', 'read', 30, true)
            await metrics.flush()

            const { status, data } = await GET(
                '/federation/DelegateMetrics?$select=entity,requests,latencySumMs,avgLatency',
            )
            expect(status).to.equal(200)
            const row = data.value.find(r => r.entity === 'consumer.Customers')
            expect(row, 'not exposed on the management API').to.exist
            expect(row.requests).to.equal(2)
            expect(row.latencySumMs).to.equal(40)
            expect(row.avgLatency).to.equal(20)
        })

        it('stays read-only', async () => {
            const { status } = await axios.post('/federation/DelegateMetrics', {
                bucket: 'hourly:2026-01-01T00', entity: 'x',
            })
            expect(status).to.be.oneOf([405, 400])
        })
    })
})
