const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider, startRestProvider, stopRestProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('RestAdapter integration', () => {
    const { expect } = require('@jest/globals')

    beforeAll(async () => {
        await Promise.all([startProvider(), startRestProvider()])
    }, 60000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await Promise.all([stopProvider(), stopRestProvider()])
    })

    it('[4.6.2] R25: offset pagination + dataPath replicates customers', async () => {
        const srv = await getPipelineService()
        await srv.clear('ReplicatedRestCustomers')
        await srv.execute('ReplicatedRestCustomers', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
        expect(rows.length).toBe(5)
    })

    it('[4.6.2] R27: delta passes modifiedSince and keeps row count when source is stale', async () => {
        const srv = await getPipelineService()
        await srv.execute('ReplicatedRestCustomers', { mode: 'full', trigger: 'manual' })
        await srv.execute('ReplicatedRestCustomers', { mode: 'delta', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
        expect(rows.length).toBe(5)
    })

    it('page pagination walks all pages', async () => {
        const srv = await getPipelineService()
        const name = `__rest_page_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'RestProvider', batchSize: 2 },
            rest: {
                path: '/api/customers-paged',
                pagination: { type: 'page', pageParam: 'page', limitParam: 'limit' },
                dataPath: 'results',
            },
            target: { entity: 'consumer.ReplicatedRestCustomers' },
        })
        await srv.clear(name)
        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
        expect(rows.length).toBe(5)
    })

    it('cursor pagination walks all chunks', async () => {
        const srv = await getPipelineService()
        const name = `__rest_cur_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'RestProvider', batchSize: 2 },
            rest: {
                path: '/api/customers-cursor',
                pagination: { type: 'cursor', cursorPath: 'nextCursor', cursorParam: 'cursor' },
                dataPath: 'items',
            },
            target: { entity: 'consumer.ReplicatedRestCustomers' },
        })
        await srv.clear(name)
        await srv.execute(name, { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedRestCustomers')
        expect(rows.length).toBe(5)
    })
})
