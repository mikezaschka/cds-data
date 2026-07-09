const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('Initial load on startup (preload)', () => {
    const registered = []

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)

    afterAll(async () => {
        const srv = await getPipelineService().catch(() => null)
        for (const name of registered) {
            try { await srv?.clearSchedule(name) } catch { /* nothing scheduled */ }
        }
        await stopProvider()
    })

    async function runsFor(name) {
        const runs = await SELECT.from('plugin_data_pipeline_PipelineRuns')
        return runs.filter((r) => r.pipeline_name === name)
    }

    it('preload: { wait: true } records a completed preload run before addPipeline resolves', async () => {
        const srv = await getPipelineService()
        const name = `__preload_wait_${Date.now()}`
        registered.push(name)
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
            preload: { mode: 'full', wait: true },
        })
        const mine = await runsFor(name)
        const preloadRuns = mine.filter((r) => r.trigger === 'preload')
        expect(preloadRuns.length).toBe(1)
        expect(preloadRuns[0].mode).toBe('full')
        expect(preloadRuns[0].status).toBe('completed')
    })

    it('preload: true kicks off a background initial load', async () => {
        const srv = await getPipelineService()
        const name = `__preload_bg_${Date.now()}`
        registered.push(name)
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
            preload: true,
        })
        // Background run via cds.spawn — poll until the preload run lands.
        let preloadRuns = []
        for (let i = 0; i < 20 && preloadRuns.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 100))
            preloadRuns = (await runsFor(name)).filter((r) => r.trigger === 'preload')
        }
        expect(preloadRuns.length).toBeGreaterThan(0)
    }, 20_000)

    it('no preload option means no startup run', async () => {
        const srv = await getPipelineService()
        const name = `__preload_none_${Date.now()}`
        registered.push(name)
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
        })
        await new Promise((r) => setTimeout(r, 300))
        expect(await runsFor(name)).toHaveLength(0)
    })

    it('rejects an invalid preload.mode', async () => {
        const srv = await getPipelineService()
        await expect(
            srv.addPipeline({
                name: `__preload_badmode_${Date.now()}`,
                source: { service: 'ProviderService', entity: 'Customers' },
                target: { entity: 'consumer.ReplicatedCustomersV2' },
                preload: { mode: 'sideways' },
            }),
        ).rejects.toThrow(/preload\.mode/)
    })

    it('rejects a non-object, non-boolean preload', async () => {
        const srv = await getPipelineService()
        await expect(
            srv.addPipeline({
                name: `__preload_badtype_${Date.now()}`,
                source: { service: 'ProviderService', entity: 'Customers' },
                target: { entity: 'consumer.ReplicatedCustomersV2' },
                preload: 'yes',
            }),
        ).rejects.toThrow(/preload must be a boolean/)
    })
})
