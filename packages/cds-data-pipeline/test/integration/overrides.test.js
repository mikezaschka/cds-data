const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const {
    getPipelineService,
    waitForConsumerFixturePipelines,
    readPipelineRow,
} = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')
const PIPELINES = 'plugin_data_pipeline_Pipelines'

async function registerFresh(srv, name, config) {
    // Simulate process restart: drop in-memory registration so addPipeline can run again.
    await srv._stopInternalSchedule?.(name)
    srv.pipelines.delete(name)
    await srv.addPipeline({ name, ...config })
}

describe('Pipeline config overrides', () => {
    const names = []
    const auth = { username: 'alice', password: 'alice' }

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET, POST } = cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)

    afterAll(async () => {
        const srv = await getPipelineService().catch(() => null)
        for (const name of names) {
            try { await srv?.clearSchedule(name) } catch { /* ignore */ }
            try { await srv?.setEnabled?.(name, true) } catch { /* ignore */ }
            srv?.pipelines?.delete(name)
        }
        await stopProvider()
    })

    function unique(prefix) {
        const name = `__ovr_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        names.push(name)
        return name
    }

    const baseOpts = {
        source: { service: 'ProviderService', entity: 'Customers' },
        target: { entity: 'consumer.ReplicatedCustomersV2' },
    }

    it('[4.13.8] persists overrides and re-applies after simulated restart', async () => {
        const srv = await getPipelineService()
        const name = unique('persist')
        await srv.addPipeline({
            name,
            ...baseOpts,
            mode: 'delta',
            schedule: 60_000,
            description: 'coded desc',
        })

        await srv.setOverrides(name, {
            mode: 'full',
            source: { batchSize: 42 },
            description: 'ops desc',
        })

        const row1 = await readPipelineRow(name)
        expect(row1.overrides).toBeTruthy()
        const stored = JSON.parse(row1.overrides)
        expect(stored.mode).toBe('full')
        expect(stored.source.batchSize).toBe(42)
        expect(JSON.parse(row1.baseConfig).mode).toBe('delta')

        await registerFresh(srv, name, {
            ...baseOpts,
            mode: 'delta',
            schedule: 60_000,
            description: 'coded desc',
        })

        const pip = srv.pipelines.get(name)
        expect(pip.config.mode).toBe('full')
        expect(pip.config.source.batchSize).toBe(42)
        expect(pip.config.description).toBe('ops desc')
        expect(pip.baseConfig.mode).toBe('delta')
        expect(pip.overrides.mode).toBe('full')
    })

    it('re-registration updates baseConfig but preserves overrides', async () => {
        const srv = await getPipelineService()
        const name = unique('rereg')
        await srv.addPipeline({
            name,
            ...baseOpts,
            description: 'v1',
            source: { ...baseOpts.source, batchSize: 1000 },
        })
        await srv.setOverrides(name, { source: { batchSize: 25 } })

        await registerFresh(srv, name, {
            ...baseOpts,
            description: 'v2-coded',
            source: { ...baseOpts.source, batchSize: 2000 },
        })

        const row = await readPipelineRow(name)
        const base = JSON.parse(row.baseConfig)
        expect(base.description).toBe('v2-coded')
        expect(base.source.batchSize).toBe(2000)
        expect(JSON.parse(row.overrides).source.batchSize).toBe(25)
        expect(srv.pipelines.get(name).config.source.batchSize).toBe(25)
    })

    it('[4.13.8] setEnabled(false) stops scheduling; manual execute still runs', async () => {
        const srv = await getPipelineService()
        const name = unique('enable')
        await srv.addPipeline({
            name,
            ...baseOpts,
            schedule: 200,
        })
        await srv.clear(name)
        await srv.setEnabled(name, false)

        const row = await readPipelineRow(name)
        // node:sqlite stores Boolean as 0/1
        expect(!!row.enabled).toBe(false)
        expect(srv._scheduleRegistry.has(name)).toBe(false)

        await new Promise((r) => setTimeout(r, 700))
        const runsBefore = (await SELECT.from('plugin_data_pipeline_PipelineRuns'))
            .filter((r) => r.pipeline_name === name)
        // No scheduled ticks while disabled
        expect(runsBefore.every((r) => r.trigger !== 'scheduled') || runsBefore.length === 0).toBe(true)

        await srv.execute(name, { mode: 'delta', trigger: 'manual' })
        const runsAfter = (await SELECT.from('plugin_data_pipeline_PipelineRuns'))
            .filter((r) => r.pipeline_name === name && r.trigger === 'manual')
        expect(runsAfter.length).toBeGreaterThan(0)

        await srv.setEnabled(name, true)
        expect(srv._scheduleRegistry.has(name)).toBe(true)
        expect(!!(await readPipelineRow(name)).enabled).toBe(true)
    }, 20_000)

    it('setSchedule override hot-applies and persists', async () => {
        const srv = await getPipelineService()
        const name = unique('sched')
        await srv.addPipeline({
            name,
            ...baseOpts,
            schedule: 60_000,
        })
        await srv.clear(name)
        await srv.setSchedule(name, { every: 200, engine: 'spawn' })

        const pip = srv.pipelines.get(name)
        expect(pip.overrides.schedule.every).toBe(200)
        expect(pip.config.schedule.every).toBe(200)

        await new Promise((r) => setTimeout(r, 900))
        const mine = (await SELECT.from('plugin_data_pipeline_PipelineRuns'))
            .filter((r) => r.pipeline_name === name)
        expect(mine.length).toBeGreaterThan(0)

        const row = await readPipelineRow(name)
        expect(JSON.parse(row.overrides).schedule.every).toBe(200)
    }, 20_000)

    it('rejects non-overridable keys', async () => {
        const srv = await getPipelineService()
        const name = unique('reject')
        await srv.addPipeline({ name, ...baseOpts })
        await expect(srv.setOverrides(name, { viewMapping: { isWildcard: false } }))
            .rejects.toThrow(/not overridable/)
        await expect(srv.setOverrides(name, { source: { entity: 'Other' } }))
            .rejects.toThrow(/source\.entity/)
    })

    it('tuning knob override is visible on adapter config for next run', async () => {
        const srv = await getPipelineService()
        const name = unique('tune')
        await srv.addPipeline({
            name,
            ...baseOpts,
            source: { ...baseOpts.source, batchSize: 1000 },
        })
        await srv.setOverrides(name, { source: { batchSize: 17, maxRetries: 1 } })
        const pip = srv.pipelines.get(name)
        expect(pip.adapter.config.source.batchSize).toBe(17)
        expect(pip.adapter.config.source.maxRetries).toBe(1)
        expect(pip.config.source.batchSize).toBe(17)
    })

    it('[4.13.8] configView returns base / overrides / effective / meta', async () => {
        const srv = await getPipelineService()
        const name = unique('view')
        await srv.addPipeline({
            name,
            ...baseOpts,
            mode: 'delta',
            schedule: 30_000,
        })
        await srv.setOverrides(name, { mode: 'full' })
        const view = srv.getConfigView(name)
        expect(view.base.mode).toBe('delta')
        expect(view.overrides.mode).toBe('full')
        expect(view.effective.mode).toBe('full')
        expect(view.meta.scheduleLiveChangeSupported).toBe(true)
        expect(view.fields.find((f) => f.path === 'mode').source).toBe('override')
    })

    it('clearOverrides restores coded schedule', async () => {
        const srv = await getPipelineService()
        const name = unique('clear')
        await srv.addPipeline({
            name,
            ...baseOpts,
            schedule: { every: 45_000, engine: 'spawn' },
        })
        await srv.setSchedule(name, { every: 90_000 })
        expect(srv.pipelines.get(name).config.schedule.every).toBe(90_000)

        await srv.clearOverrides(name, 'schedule')
        expect(srv.pipelines.get(name).config.schedule.every).toBe(45_000)
        expect(srv.pipelines.get(name).overrides.schedule).toBeUndefined()
    })

    it('management API exposes configView and setOverrides', async () => {
        const srv = await getPipelineService()
        const name = unique('odata')
        await srv.addPipeline({ name, ...baseOpts, mode: 'delta' })

        const { data, status } = await GET(
            `/pipeline/Pipelines('${name}')/DataPipelineManagementService.configView()`,
            { auth },
        )
        expect(status).toBe(200)
        const raw = typeof data === 'string' ? data : (data.value ?? data)
        const view = typeof raw === 'string' ? JSON.parse(raw) : raw
        expect(view.effective.mode).toBe('delta')

        const post = await POST(
            `/pipeline/Pipelines('${name}')/DataPipelineManagementService.setOverrides`,
            { overrides: JSON.stringify({ mode: 'full', source: { batchSize: 9 } }) },
            { auth },
        )
        expect(post.status).toBeLessThan(300)
        expect(srv.pipelines.get(name).config.mode).toBe('full')
        expect(srv.pipelines.get(name).config.source.batchSize).toBe(9)
    })
})
