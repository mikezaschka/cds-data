const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('DataPipelineService.execute', () => {
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

    it('sync execute resolves done with completed status', async () => {
        const srv = await getPipelineService()
        const { runId, done } = await srv.execute('ReplicatedCustomers', {
            mode: 'full',
            trigger: 'manual',
        })
        expect(runId).toBeTruthy()
        const result = await done
        expect(result.status).toBe('completed')
        expect(result.statistics).toBeDefined()
    })

    it('async spawn returns pending done that settles', async () => {
        const srv = await getPipelineService()
        const { runId, done } = await srv.execute('ReplicatedCustomers', {
            mode: 'full',
            trigger: 'manual',
            async: true,
        })
        expect(runId).toBeTruthy()
        const result = await done
        expect(result.status).toBe('completed')
    })

    it('queued async omits done when cds.queued is available', async () => {
        if (typeof cds.queued !== 'function') return
        const srv = await getPipelineService()
        const q = cds.queued(srv)
        if (!q || typeof q.emit !== 'function') return

        const out = await srv.execute('ReplicatedCustomers', {
            mode: 'delta',
            trigger: 'manual',
            async: true,
            engine: 'queued',
        })
        expect(out.runId).toBeTruthy()
        expect(out.done).toBeUndefined()
    })

    it('throws for unknown pipeline', async () => {
        const srv = await getPipelineService()
        await expect(
            srv.execute(`__nope_${Date.now()}`, { mode: 'full' }),
        ).rejects.toThrow(/Unknown pipeline/)
    })
})
