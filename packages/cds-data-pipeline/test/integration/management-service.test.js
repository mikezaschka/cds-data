const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

describe('DataPipelineManagementService OData', () => {
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

    // The value lists have no table, so CAP applies no query to them. Until the
    // handler did, every option below was silently ignored — including the
    // $orderby the Start dialog sends, so its trigger list came back unsorted.
    it('applies $orderby, $filter, $top/$skip, $select and $count to the value lists', async () => {
        const get = async (q) => (await GET(`/pipeline/PipelineRunTriggers?${q}`, { auth })).data

        expect((await get('$orderby=code')).value.map(r => r.code))
            .toEqual(['event', 'external', 'manual', 'scheduled'])
        expect((await get("$filter=code eq 'event' or code eq 'manual'")).value.map(r => r.code).sort())
            .toEqual(['event', 'manual'])
        expect((await get("$filter=contains(code,'ed')")).value.map(r => r.code)).toEqual(['scheduled'])
        expect((await get('$orderby=code desc&$top=1&$skip=1')).value.map(r => r.code)).toEqual(['manual'])

        const selected = await get('$select=code')
        for (const row of selected.value) expect(Object.keys(row)).toEqual(['code'])

        const counted = await get('$top=1&$count=true')
        expect(counted.value).toHaveLength(1)
        expect(counted['@odata.count']).toBe(4)

        const modes = (await GET("/pipeline/PipelineRunModes?$filter=code eq 'full'", { auth })).data
        expect(modes.value.map(r => r.code)).toEqual(['full'])
    })

    it('refuses a value-list query it cannot evaluate rather than returning everything', async () => {
        const res = await GET("/pipeline/PipelineRunTriggers?$filter=matchesPattern(code,'^m')", { auth })
            .catch(err => err.response)
        expect(res.status).toBe(400)
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
