const path = require('path')
const cds = require('@sap/cds')

const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('createTargetAdapter (target factory)', () => {
    cds.test(consumerRoot)
    const { expect } = require('@jest/globals')

    beforeAll(waitForConsumerFixturePipelines)

    async function expectThrow(fn) {
        let caught
        try {
            await fn()
        } catch (e) {
            caught = e
        }
        if (!caught) throw new Error('expected throw')
        return caught
    }

    it('rejects non-db target service without OData kind or custom adapter', async () => {
        const srv = await cds.connect.to('DataPipelineService')
        const err = await expectThrow(() => srv.addPipeline({
            name: `__tgt_rej_${Date.now()}`,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { service: 'RestProvider', entity: 'N/A' },
        }))
        expect(err.message).toMatch(/no built-in target adapter/)
    })

    it('resolves DbTargetAdapter when target.service is db', async () => {
        const srv = await cds.connect.to('DataPipelineService')
        const name = `__tgt_db_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { service: 'db', entity: 'consumer.ReplicatedCustomers' },
        })
        const p = srv.pipelines.get(name)
        expect(p.targetAdapter.constructor.name).toBe('DbTargetAdapter')
    })
})
