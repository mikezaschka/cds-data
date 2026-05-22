const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('DataPipelineManagementService OData', () => {
    const { expect } = require('@jest/globals')
    const auth = { username: 'alice', password: 'alice' }

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET, POST } = cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)
    afterAll(async () => {
        await stopProvider()
    })

    it('GET /pipeline/Pipelines returns tracker rows', async () => {
        const { data } = await GET('/pipeline/Pipelines', { auth })
        expect(data.value).toBeInstanceOf(Array)
        expect(data.value.some(p => p.name === 'ReplicatedCustomers')).toBe(true)
    })

    it('GET /pipeline/PipelineRunModes and PipelineRunTriggers serve value help for start action', async () => {
        const { data: modes } = await GET('/pipeline/PipelineRunModes', { auth })
        expect(modes.value.map((r) => r.code).sort()).toEqual(['delta', 'full'])
        const { data: triggers } = await GET('/pipeline/PipelineRunTriggers', { auth })
        expect(triggers.value.map((r) => r.code).sort()).toEqual(['event', 'external', 'manual', 'scheduled'])
        const { data: one } = await GET(`/pipeline/PipelineRunModes('delta')`, { auth })
        expect(one.code).toBe('delta')
    })

    it('GET /pipeline/PipelineRuns returns run history', async () => {
        const { data } = await GET('/pipeline/PipelineRuns', { auth })
        expect(data.value).toBeInstanceOf(Array)
    })

    it('[4.8.2] R16: POST /pipeline/execute executes synchronously', async () => {
        const { data } = await POST(
            '/pipeline/execute',
            { name: 'ReplicatedCustomers', mode: 'full', trigger: 'manual', async: false },
            { auth },
        )
        expect(String(data.value || data)).toMatch(/completed successfully/)
    })

    it('POST Pipelines(...)/start bound action executes synchronously', async () => {
        const { data } = await POST(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.start`,
            { mode: 'full', trigger: 'manual', async: false },
            { auth },
        )
        expect(String(data.value || data)).toMatch(/completed successfully/)
    })

    it('POST /pipeline/flush clears pipeline output', async () => {
        await POST('/pipeline/execute', { name: 'ReplicatedCustomers', mode: 'full', trigger: 'manual', async: false }, { auth })
        await POST('/pipeline/flush', { name: 'ReplicatedCustomers' }, { auth })
        const rows = await SELECT.from('consumer.ReplicatedCustomers')
        expect(rows.length).toBe(0)
    })

    it('GET /pipeline/status returns one pipeline row', async () => {
        const { data } = await GET(`/pipeline/status(name='ReplicatedProducts')`, { auth })
        expect(data.name).toBe('ReplicatedProducts')
    })
})
