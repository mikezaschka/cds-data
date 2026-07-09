const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('PIPELINE lifecycle hooks', () => {
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

    it('persists optional description on the tracker row', async () => {
        const srv = await getPipelineService()
        const name = `__lc_desc_${Date.now()}`
        const description = 'Integration test pipeline description'
        await srv.addPipeline({
            name,
            description,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
        })
        const row = await srv.getStatus(name)
        expect(row.description).toBe(description)
    })

    it('correlates runId across START and DONE', async () => {
        const srv = await getPipelineService()
        const name = `__lc_run_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
        })

        const seen = { start: null, done: null }
        srv.on('PIPELINE.START', name, (req) => {
            seen.start = req.data.runId
        })
        srv.on('PIPELINE.DONE', name, (req) => {
            seen.done = req.data.runId
        })

        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        expect(seen.start).toBeTruthy()
        expect(seen.done).toBe(seen.start)
    })

    it('[4.7.1] R18: before MAP can filter sourceRecords', async () => {
        const srv = await getPipelineService()
        const name = `__lc_map_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
        })
        srv.before('PIPELINE.MAP', name, (req) => {
            req.data.sourceRecords = req.data.sourceRecords.filter(
                r => r.blocked === false || r.blocked === 'false',
            )
        })

        await srv.clear(name)
        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedCustomersV2')
        expect(rows.length).toBe(4)
        expect(rows.every(c => c.ID !== 'C003')).toBe(true)
    })

    it('[4.7.1] R19: after MAP can enrich targetRecords', async () => {
        const srv = await getPipelineService()
        const name = `__lc_after_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Products' },
            target: { entity: 'consumer.ReplicatedProducts' },
            viewMapping: {
                isWildcard: false,
                projectedColumns: ['ID', 'name', 'category', 'price', 'currency'],
                remoteToLocal: { ID: 'productId', name: 'productName', price: 'unitPrice' },
                localToRemote: {},
            },
        })
        srv.after('PIPELINE.MAP', name, (_res, req) => {
            req.data.targetRecords = req.data.targetRecords.map(r => ({
                ...r,
                category: r.category ? r.category.toUpperCase() : r.category,
            }))
        })

        await srv.clear(name)
        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedProducts')
        const laptop = rows.find(p => p.productId === 'P001')
        expect(laptop.category).toBe('ELECTRONICS')
    })
})
