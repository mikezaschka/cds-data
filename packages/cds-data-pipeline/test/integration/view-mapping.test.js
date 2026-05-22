const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('viewMapping on addPipeline', () => {
    const { expect } = require('@jest/globals')

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

    it('remoteToLocal renames and projectedColumns exclude remote-only fields', async () => {
        const srv = await getPipelineService()
        await srv.clear('ReplicatedProducts')
        await srv.execute('ReplicatedProducts', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedProducts')
        const laptop = rows.find(p => p.productId === 'P001')
        expect(laptop).toBeTruthy()
        expect(laptop).not.toHaveProperty('stock')
        expect(laptop).not.toHaveProperty('name')
    })

    it('infers the same mapping when viewMapping is omitted and target is a consumption view', async () => {
        const srv = await getPipelineService()
        await srv.clear('InferredViewProducts')
        await srv.execute('InferredViewProducts', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.InferredViewProducts')
        const laptop = rows.find(p => p.productId === 'P001')
        expect(laptop).toBeTruthy()
        expect(laptop).not.toHaveProperty('stock')
        expect(laptop).not.toHaveProperty('name')
    })
})
