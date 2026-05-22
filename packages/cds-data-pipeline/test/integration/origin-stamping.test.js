const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Multi-source origin stamping (ADR 0008)', () => {
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

    it('sibling pipelines populate disjoint compound keys', async () => {
        const srv = await getPipelineService()
        await srv.clear('FanInOriginA')
        await srv.clear('FanInOriginB')
        await srv.execute('FanInOriginA', { mode: 'full', trigger: 'manual' })
        await srv.execute('FanInOriginB', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.FanInCustomers')
        expect(rows.length).toBe(10)
        const origins = new Set(rows.map(r => r.source))
        expect(origins.has('ORIGIN_A')).toBe(true)
        expect(origins.has('ORIGIN_B')).toBe(true)
    })

    it('clear scopes delete to this origin only', async () => {
        const srv = await getPipelineService()
        await srv.clear('FanInOriginA')
        const rows = await SELECT.from('consumer.FanInCustomers')
        expect(rows.length).toBe(5)
        expect(rows.every(r => r.source === 'ORIGIN_B')).toBe(true)
        await srv.clear('FanInOriginB')
    })
})
