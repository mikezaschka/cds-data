const { resolveInspectCapabilities } = require('../../srv/lib/inspectData')

function mockPipeline(config, adapterName, targetAdapterName) {
    return {
        name: 'Test',
        config,
        adapter: adapterName ? { constructor: { name: adapterName } } : undefined,
        targetAdapter: targetAdapterName ? { constructor: { name: targetAdapterName } } : undefined,
    }
}

describe('resolveInspectCapabilities', () => {
    it('returns full for OData entity source and db target', () => {
        const caps = resolveInspectCapabilities(mockPipeline({
            source: { service: 'Remote', entity: 'Products' },
            target: { service: 'db', entity: 'Products' },
        }))
        expect(caps.source).toBe('full')
        expect(caps.target).toBe('full')
    })

    it('returns limited for REST source', () => {
        const caps = resolveInspectCapabilities(mockPipeline({
            source: { service: 'rest', entity: 'Rates' },
            rest: { path: '/rates' },
            target: { service: 'db', entity: 'Rates' },
        }, 'RestAdapter'))
        expect(caps.source).toBe('limited')
        expect(caps.target).toBe('full')
    })

    it('returns limited for custom target adapter', () => {
        const caps = resolveInspectCapabilities(mockPipeline({
            source: { service: 'Remote', entity: 'Carriers' },
            target: { adapter: () => {}, entity: 'Carriers' },
        }))
        expect(caps.source).toBe('full')
        expect(caps.target).toBe('limited')
    })

    it('returns none when entity is missing', () => {
        const caps = resolveInspectCapabilities(mockPipeline({
            source: {},
            target: {},
        }))
        expect(caps.source).toBe('none')
        expect(caps.target).toBe('none')
    })
})
