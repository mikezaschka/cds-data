const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { getPipelineService, waitForConsumerFixturePipelines } = require('../support/helpers')
const { resolvePolicy, purgeRunsForPipeline } = require('../../srv/lib/housekeeping')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')
const RUNS = 'plugin_data_pipeline_PipelineRuns'

function daysAgo(n) {
    return new Date(Date.now() - n * 86400000).toISOString()
}

async function seedRun({ pipelineName, status, startTime, endTime, id }) {
    const runId = id || cds.utils.uuid()
    await INSERT.into(RUNS).entries({
        ID: runId,
        pipeline_name: pipelineName,
        status,
        startTime,
        endTime: endTime ?? null,
        trigger: 'manual',
        mode: 'delta',
    })
    return runId
}

async function countRuns(pipelineName) {
    const rows = await SELECT.from(RUNS).where({ pipeline_name: pipelineName })
    return rows.length
}

describe('Pipeline run housekeeping', () => {
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

    async function registerProbePipeline(name) {
        const srv = await getPipelineService()
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
        })
        return srv
    }

    it('[4.13.9] retentionDays deletes only finished runs older than the cutoff', async () => {
        const name = `__hk_age_${Date.now()}`
        await registerProbePipeline(name)

        const oldId = await seedRun({
            pipelineName: name,
            status: 'completed',
            startTime: daysAgo(120),
            endTime: daysAgo(120),
        })
        const recentId = await seedRun({
            pipelineName: name,
            status: 'completed',
            startTime: daysAgo(10),
            endTime: daysAgo(10),
        })
        const runningId = await seedRun({
            pipelineName: name,
            status: 'running',
            startTime: daysAgo(200),
            endTime: null,
        })

        const policy = resolvePolicy({}, { enabled: true, retentionDays: 30 })
        const result = await purgeRunsForPipeline(name, policy)

        expect(result.deleted).toBe(1)
        expect(await countRuns(name)).toBe(2)
        const remainingIds = (await SELECT.from(RUNS).where({ pipeline_name: name })).map((row) => row.ID)
        expect(remainingIds).toContain(recentId)
        expect(remainingIds).toContain(runningId)
        expect(remainingIds).not.toContain(oldId)
    })

    it('[4.13.9] maxRuns keeps only the newest finished runs', async () => {
        const name = `__hk_count_${Date.now()}`
        await registerProbePipeline(name)

        const seededIds = []
        for (let i = 0; i < 5; i++) {
            seededIds.push(await seedRun({
                pipelineName: name,
                status: 'completed',
                startTime: new Date(Date.now() - (50 - i) * 86400000).toISOString(),
                endTime: new Date(Date.now() - (50 - i) * 86400000).toISOString(),
            }))
        }

        const policy = resolvePolicy({}, { enabled: true, maxRuns: 2 })
        const result = await purgeRunsForPipeline(name, policy)

        expect(result.deleted).toBe(3)
        expect(await countRuns(name)).toBe(2)

        const remainingIds = (await SELECT.from(RUNS)
            .where({ pipeline_name: name })
            .orderBy({ startTime: 'desc' }))
            .map((row) => row.ID)
        expect(remainingIds).toEqual([seededIds[4], seededIds[3]])
    })

    it('[4.13.9] per-pipeline retention overrides global maxRuns', async () => {
        const name = `__hk_override_${Date.now()}`
        const srv = await getPipelineService()
        await srv.addPipeline({
            name,
            source: { service: 'ProviderService', entity: 'Customers' },
            target: { entity: 'consumer.ReplicatedCustomersV2' },
            retention: { maxRuns: 1 },
        })

        for (let i = 0; i < 3; i++) {
            await seedRun({
                pipelineName: name,
                status: 'completed',
                startTime: daysAgo(10 - i),
                endTime: daysAgo(10 - i),
            })
        }

        const global = { enabled: true, retentionDays: 365, maxRuns: 100 }
        const policy = resolvePolicy({ maxRuns: 1 }, global)
        const result = await purgeRunsForPipeline(name, policy)

        expect(result.deleted).toBe(2)
        expect(await countRuns(name)).toBe(1)
    })

    it('[4.13.9] disabled policy deletes nothing', async () => {
        const name = `__hk_none_${Date.now()}`
        await registerProbePipeline(name)

        await seedRun({
            pipelineName: name,
            status: 'completed',
            startTime: daysAgo(400),
            endTime: daysAgo(400),
        })

        const result = await purgeRunsForPipeline(name, { enabled: false })
        expect(result.deleted).toBe(0)
        expect(await countRuns(name)).toBe(1)
    })

    it('[4.13.9] rejects invalid retention config at registration', async () => {
        const srv = await getPipelineService()
        await expect(
            srv.addPipeline({
                name: `__hk_bad_${Date.now()}`,
                source: { service: 'ProviderService', entity: 'Customers' },
                target: { entity: 'consumer.ReplicatedCustomersV2' },
                retention: { retentionDays: -1 },
            }),
        ).rejects.toThrow(/retention\.retentionDays must be a non-negative integer/)
    })
})
