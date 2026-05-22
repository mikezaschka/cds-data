const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('ODataTargetAdapter (move-to-service)', () => {
    const { expect } = require('@jest/globals')

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 60000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    it('replicates provider customers into inventory OData service', async () => {
        const srv = await getPipelineService()
        await srv.execute('MoveCustomersToInventory', { mode: 'full', trigger: 'manual' })
        const inv = await cds.connect.to('InventoryService')
        const rows = await inv.run(SELECT.from('MirroredCustomers'))
        expect(rows.length).toBe(5)
        const acme = rows.find(r => r.ID === 'C001')
        expect(acme.name).toBe('Acme Corp')
    })
})
