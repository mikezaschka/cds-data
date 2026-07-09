const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('RemoteCqnAdapter integration', () => {
    beforeAll(async () => {
        await startProvider()
    }, 60000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await stopProvider()
    })

    it('[4.6.1] R22: full sync replicates all customers (V4)', async () => {
        const srv = await getPipelineService()
        await srv.clear('ReplicatedCustomers')
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedCustomers')
        expect(rows.length).toBe(5)
        expect(rows.map(c => c.ID).sort()).toEqual(['C001', 'C002', 'C003', 'C004', 'C005'])
    })

    it('[4.6.1] R24: remote CQN adapter uses viewMapping for column restriction', async () => {
        const srv = await getPipelineService()
        await srv.clear('ReplicatedProducts')
        await srv.execute('ReplicatedProducts', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedProducts')
        const laptop = rows.find(p => p.productId === 'P001')
        expect(laptop.productName).toBe('Laptop Pro')
        expect(Number(laptop.unitPrice)).toBe(1299.99)
        expect(laptop).not.toHaveProperty('stock')
    })

    it('delta timestamp yields no new rows when source is older than lastSync', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' })
        await srv.execute('ReplicatedCustomers', { mode: 'delta', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedCustomers')
        expect(rows.length).toBe(5)
    })

    it('[4.6.1] V2 protocol replicates customers', async () => {
        const srv = await getPipelineService()
        await srv.clear('ReplicatedCustomersV2')
        await srv.execute('ReplicatedCustomersV2', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedCustomersV2')
        expect(rows.length).toBe(5)
    })

    it('[4.6.1a] R30: server-driven page cap still loads all paged customers', async () => {
        const srv = await getPipelineService()
        await srv.clear('ReplicatedPagedCustomers')
        await srv.execute('ReplicatedPagedCustomers', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedPagedCustomers')
        expect(rows.length).toBe(5)
    })

    it('key delta respects lastKey on tracker', async () => {
        const srv = await getPipelineService()
        const name = `__oda_key_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
            mode: 'delta',
            delta: { mode: 'key', field: 'ID' },
        })
        await srv.clear(name)
        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        await UPDATE('plugin_data_pipeline_Pipelines')
            .set({ lastKey: 'C003' })
            .where({ name })
        await srv.execute(name, { mode: 'delta', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedCustomersV2').where({ ID: { '>=': 'C004' } })
        expect(rows.length).toBeGreaterThanOrEqual(2)
    })

    it('accepts explicit source.kind hcql', async () => {
        const srv = await getPipelineService()
        const name = `__hcql_kind_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers', kind: 'hcql' },
            target: { entity: 'consumer.ReplicatedCustomers' },
        })
        const p = srv.pipelines.get(name)
        expect(p.adapter.constructor.name).toBe('RemoteCqnAdapter')
    })

})
