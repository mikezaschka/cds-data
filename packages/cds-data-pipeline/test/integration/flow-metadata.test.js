const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../support/setup')
const { waitForConsumerFixturePipelines } = require('../support/helpers')

const consumerRoot = path.join(__dirname, '../fixtures/consumer')

function parsePayload(data) {
    const raw = data.value != null ? data.value : data
    return typeof raw === 'string' ? JSON.parse(raw) : raw
}

describe('flowMetadata management functions', () => {
    const auth = { username: 'alice', password: 'alice' }

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET } = cds.test(consumerRoot)

    beforeAll(async () => {
        await waitForConsumerFixturePipelines()
    }, 60000)

    afterAll(async () => {
        await stopProvider()
    })

    it('flowMetadata returns lifecycle events and graph nodes', async () => {
        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedProducts')/DataPipelineManagementService.flowMetadata()`,
            { auth },
        )
        const payload = parsePayload(data)
        expect(payload.events).toHaveLength(5)
        expect(payload.events.map((e) => e.id)).toEqual([
            'PIPELINE.START',
            'PIPELINE.READ',
            'PIPELINE.MAP',
            'PIPELINE.WRITE',
            'PIPELINE.DONE',
        ])
        expect(payload.graph.nodes.some((n) => n.key === 'source')).toBe(true)
        expect(payload.graph.nodes.some((n) => n.key === 'PIPELINE.MAP')).toBe(true)
        expect(payload.graph.nodes.some((n) => n.key === 'target')).toBe(true)
        expect(payload.graph.groups?.length).toBeGreaterThanOrEqual(3)
        expect(payload.customizations.some((c) => c.id === 'view-mapping')).toBe(true)
    })

    it('flowMetadata lists registered hooks', async () => {
        const srv = await cds.connect.to('DataPipelineService')
        srv.before('PIPELINE.MAP', 'ReplicatedCustomers', () => {})

        const { data } = await GET(
            `/pipeline/Pipelines('ReplicatedCustomers')/DataPipelineManagementService.flowMetadata()`,
            { auth },
        )
        const payload = parsePayload(data)
        expect(payload.customizations.some((c) => c.kind === 'hook' && c.event === 'PIPELINE.MAP')).toBe(true)
        const mapNode = payload.graph.nodes.find((n) => n.key === 'PIPELINE.MAP')
        expect(mapNode.status).toBe('Warning')
        expect(mapNode.attributes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    label: 'Hook (before)',
                    value: expect.stringContaining('MAP'),
                }),
            ]),
        )
        expect(payload.graph.nodes.some((n) => String(n.key).startsWith('custom:'))).toBe(false)
        expect(payload.graph.groups.some((g) => g.title === 'Customizations')).toBe(false)
    })

    it('landscapeMetadata returns all pipelines and a deduplicated graph', async () => {
        const { data } = await GET('/pipeline/landscapeMetadata()', { auth })
        const payload = parsePayload(data)
        expect(payload.pipelineCount).toBeGreaterThan(3)
        expect(payload.pipelines.some((p) => p.name === 'ReplicatedCustomers')).toBe(true)
        expect(payload.graph.groups?.length).toBeGreaterThan(0)
        expect(payload.graph.groups.every((g) => g.description)).toBe(true)
        expect(payload.graph.nodes.some((n) => n.title === 'Customers')).toBe(true)
        expect(payload.graph.lines.length).toBeGreaterThanOrEqual(payload.pipelineCount * 2)
    })
})
