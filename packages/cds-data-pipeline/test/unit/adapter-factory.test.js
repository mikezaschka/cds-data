const path = require('path')
const cds = require('@sap/cds')
const BaseSourceAdapter = require('../../srv/adapters/BaseSourceAdapter')

const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

class EchoSourceAdapter extends BaseSourceAdapter {
    async *readStream() {
        yield []
    }
}

describe('createAdapter (source factory)', () => {
    cds.test(consumerRoot)
    const { expect } = require('@jest/globals')

    beforeAll(waitForConsumerFixturePipelines)

    it('prefers source.adapter class reference', async () => {
        const srv = await cds.connect.to('DataPipelineService')
        const name = `__src_ad_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers', adapter: EchoSourceAdapter },
            target: { entity: 'consumer.ReplicatedCustomers' },
        })
        const p = srv.pipelines.get(name)
        expect(p.adapter).toBeInstanceOf(EchoSourceAdapter)
    })

    it('honours explicit source.kind rest via RestAdapter', async () => {
        const srv = await cds.connect.to('DataPipelineService')
        const name = `__src_rest_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'RestProvider', kind: 'rest' },
            rest: {
                path: '/api/customers',
                pagination: { type: 'offset', pageSize: 100 },
                dataPath: 'results',
            },
            target: { entity: 'consumer.ReplicatedRestCustomers' },
        })
        const p = srv.pipelines.get(name)
        expect(p.adapter.constructor.name).toBe('RestAdapter')
    })
})
