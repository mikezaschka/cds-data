const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../../support/setup')

const exampleRoot = path.join(__dirname, '../../../examples/mcp-federation/consumer')
const MCP_PATH = '/mcp/agent'

/** MCP query `select` expects CQN ref objects, not plain field name strings. */
function cqnSelect(...fields) {
    return fields.map((f) => ({ ref: f.includes('.') ? f.split('.') : [f] }))
}

async function mcpCallTool(baseUrl, name, args) {
    const url = `${baseUrl}${MCP_PATH}`
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `test-${name}`,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    })
    const text = await res.text()
    if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const jsonLine = text.split('\n').map(l => l.replace(/^data:\s*/, '').trim()).find(l => l.startsWith('{'))
    const body = JSON.parse(jsonLine || text)
    if (body.error) {
        throw new Error(body.error.message || JSON.stringify(body.error))
    }
    const result = body.result
    if (result?.isError) {
        const msg = result.content?.[0]?.text || 'MCP tool returned isError'
        throw new Error(msg)
    }
    return result
}

function parseToolPayload(result) {
    if (result?.structuredContent) return result.structuredContent
    const raw = result?.content?.[0]?.text
    if (!raw) return result
    try {
        return JSON.parse(raw)
    } catch {
        throw new Error(`Expected JSON tool payload, got: ${raw.slice(0, 200)}`)
    }
}

/**
 * MCP (@cap-js/mcp) on top of cds-data-federation delegate + replicate entities.
 * Verifies federated remote data is reachable via MCP query tools — same service layer as OData.
 */
describe('MCP + federation', () => {
    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const t = cds.test(exampleRoot)
    const { GET, expect } = t

    beforeAll(async () => {
        const { data } = await GET('/odata/v4/federation-agent/Customers?$top=1')
        expect(data.value).to.have.length.greaterThan(0)

        const pipeline = await cds.connect.to('DataPipelineService')
        await pipeline.execute('ReplicatedCustomers', { mode: 'full', trigger: 'event' })
    }, 120000)

    afterAll(async () => {
        await stopProvider()
    })

    it('registers FederationAgentService with @mcp endpoint', () => {
        const srv = cds.model.definitions.FederationAgentService
        expect(srv).to.exist
        expect(srv['@mcp']).toBe('agent')
    })

    it('MCP describe lists delegated and replicated entities', async () => {
        const result = await mcpCallTool(t.url, 'describe', {})
        const payload = parseToolPayload(result)
        expect(payload.entities).to.exist
        expect(payload.entities.Customers).toBeDefined()
        expect(payload.entities.Products).toBeDefined()
        expect(payload.entities.ReplicatedCustomers).toBeDefined()
    })

    it('MCP query returns delegated Customers from remote provider', async () => {
        const result = await mcpCallTool(t.url, 'query', {
            entity: 'Customers',
            select: cqnSelect('ID', 'name'),
            limit: 5,
        })
        const payload = parseToolPayload(result)
        expect(payload.entity).to.equal('Customers')
        expect(payload.count).to.be.greaterThan(0)
        expect(payload.data[0]).to.have.property('ID')
        expect(payload.data[0]).to.have.property('name')
        expect(payload.data.some(c => c.ID === 'C001' && c.name === 'Acme Corp')).to.be.true
    })

    it('MCP query applies consumption-view renames on delegated Products', async () => {
        const result = await mcpCallTool(t.url, 'query', {
            entity: 'Products',
            select: cqnSelect('productId', 'productName', 'unitPrice'),
            limit: 3,
        })
        const payload = parseToolPayload(result)
        expect(payload.count).to.be.greaterThan(0)
        const row = payload.data[0]
        expect(row).to.have.property('productId')
        expect(row).to.have.property('productName')
        expect(row).to.have.property('unitPrice')
        expect(row).to.not.have.property('ID')
        expect(row).to.not.have.property('price')
    })

    it('MCP query reads replicated local Customers', async () => {
        const result = await mcpCallTool(t.url, 'query', {
            entity: 'ReplicatedCustomers',
            select: cqnSelect('ID', 'name'),
            limit: 5,
        })
        const payload = parseToolPayload(result)
        expect(payload.count).to.be.greaterThan(0)
        expect(payload.data.some(c => c.ID === 'C001')).to.be.true
    })
})
