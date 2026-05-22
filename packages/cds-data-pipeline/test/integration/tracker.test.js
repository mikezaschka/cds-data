const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Tracker and concurrency', () => {
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

    it('parallel execute: one run skips when pipeline already running', async () => {
        const srv = await getPipelineService()
        const results = await Promise.all([
            srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' }),
            srv.execute('ReplicatedCustomers', { mode: 'full', trigger: 'manual' }),
        ])
        const settled = await Promise.all(results.map(r => r.done))
        expect(settled.some(s => s.status === 'skipped')).toBe(true)
        expect(settled.some(s => s.status === 'completed')).toBe(true)
    })

    it('failed run records error on Pipelines and PipelineRuns', async () => {
        const srv = await getPipelineService()
        const name = `__trk_fail_${Date.now()}`
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
        })
        srv.before('PIPELINE.READ', name, () => {
            throw new Error('tracker_fail_probe')
        })

        await expect(
            srv.execute(name, { mode: 'full', trigger: 'manual' }),
        ).rejects.toThrow(/tracker_fail_probe/)

        const pipe = await SELECT.one.from('plugin_data_pipeline_Pipelines').where({ name })
        expect(pipe.status).toBe('failed')
        expect(pipe.errorCount).toBeGreaterThanOrEqual(1)

        const run = await SELECT.one.from('plugin_data_pipeline_PipelineRuns')
            .where({ pipeline_name: name })
            .orderBy({ startTime: 'desc' })
        expect(run.status).toBe('failed')
    })
})
