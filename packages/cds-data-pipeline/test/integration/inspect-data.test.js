const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

function parseInspectPayload(data) {
    const raw = data.value != null ? data.value : data
    return typeof raw === 'string' ? JSON.parse(raw) : raw
}

describe('inspectData management function', () => {
    const auth = { username: 'alice', password: 'alice' }

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET, POST } = cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
        await POST(
            '/pipeline/execute',
            { name: 'ReplicatedCustomers', mode: 'full', trigger: 'manual', async: false },
            { auth },
        )
    }, 60000)

    afterAll(async () => {
        await stopProvider()
    })

    it('inspectData returns target rows for a replicated pipeline', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectData(side='target',top=5,skip=0)`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.columns).toBeInstanceOf(Array)
        expect(payload.columns.length).toBeGreaterThan(0)
        expect(payload.rows).toBeInstanceOf(Array)
        expect(payload.rows.length).toBeGreaterThan(0)
        expect(typeof payload.hasMore).toBe('boolean')
    })

    it('inspectData returns source rows for an OData entity pipeline', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectData(side='source',top=5,skip=0)`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.rows).toBeInstanceOf(Array)
        expect(payload.rows.length).toBeGreaterThan(0)
    })

    it('inspectData supports column projection on target', async () => {
        const columnsJson = encodeURIComponent(JSON.stringify(['ID', 'name']))
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectData(side='target',columnsJson='${columnsJson}',top=3,skip=0)`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.columns.map((c) => c.name).sort()).toEqual(['ID', 'name'])
        expect(Object.keys(payload.rows[0]).sort()).toEqual(['ID', 'name'])
    })

    it('inspectCapabilities reports full source and target for replicated pipeline', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectCapabilities()`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.source).toBe('full')
        expect(payload.target).toBe('full')
    })

    it('inspectData supports filters on target', async () => {
        const filters = encodeURIComponent(JSON.stringify([{ field: 'country', op: 'eq', value: 'DE' }]))
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectData(side='target',top=10,skip=0,filters='${filters}')`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.rows.every((r) => r.country === 'DE')).toBe(true)
    })

    it('[4.13.7] inspectData omits @HideFromDataInspector columns from target preview', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectData(side='target',top=5,skip=0)`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        const columnNames = payload.columns.map((c) => c.name)
        expect(columnNames).not.toContain('email')
        if (payload.rows.length) {
            expect(Object.keys(payload.rows[0])).not.toContain('email')
        }
    })

    it('[4.13.7] inspectCapabilities reports none for @HideFromDataInspector target entity', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('InspectHiddenTarget')/DataPipelineManagementService.inspectCapabilities()`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.source).toBe('full')
        expect(payload.target).toBe('none')
    })

    it('[4.13.7] inspectData returns no rows for @HideFromDataInspector target entity', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('InspectHiddenTarget')/DataPipelineManagementService.inspectData(side='target',top=5,skip=0)`,
            { auth },
        )
        const payload = parseInspectPayload(data)
        expect(payload.columns).toEqual([])
        expect(payload.rows).toEqual([])
        expect(payload.limitedSupport).toBe(true)
    })

    it('[4.13.7] inspectData succeeds without audit-log configured (audit no-op)', async () => {
        expect(cds.env.requires?.['audit-log']).toBeFalsy()
        const { status } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.inspectData(side='target',top=3,skip=0)`,
            { auth },
        )
        expect(status).toBe(200)
    })

    it('setSchedule persists schedule label on tracker row', async () => {
        await POST(
            `/pipeline/Pipelines('ReplicatedProducts')/DataPipelineManagementService.setSchedule`,
            { every: 120000 },
            { auth },
        )
        const { data } = await GET(`/pipeline/Pipelines('ReplicatedProducts')`, { auth })
        expect(data.schedule).toMatch(/every (120000 ms|2 min)/)
        await POST(
            `/pipeline/Pipelines('ReplicatedProducts')/DataPipelineManagementService.clearSchedule`,
            {},
            { auth },
        )
        const { data: cleared } = await GET(`/pipeline/Pipelines('ReplicatedProducts')`, { auth })
        expect(cleared.schedule).toBeNull()
    })
})
