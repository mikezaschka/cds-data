const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

/**
 * Phase E spike: remote GROUP BY over HCQL CAP-to-CAP.
 * Documents whether CAP allows aggregate reads against @hcql remotes.
 */
describe('HCQL remote aggregate spike', () => {
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

    it('documents CAP support for groupBy against @hcql ProviderService', async () => {
        const remote = await cds.connect.to('ProviderService')
        try {
            const rows = await remote.run(
                SELECT.from('ProviderService.Orders')
                    .columns('status', { func: 'count', args: ['*'], as: 'orderCount' })
                    .groupBy('status')
            )
            expect(Array.isArray(rows)).toBe(true)
        } catch (err) {
            expect(err.message).toMatch(/groupBy|not supported|Feature not supported/i)
        }
    })
})
