const { hasDeltaFilter } = require('../../srv/adapters/lib/entityShapeReadStream')

describe('entityShapeReadStream helpers', () => {
    it('hasDeltaFilter accepts object and string filters', () => {
        expect(hasDeltaFilter({ modifiedAt: { '>': '2020-01-01' } })).toBe(true)
        expect(hasDeltaFilter("modifiedAt gt '2020-01-01'")).toBe(true)
        expect(hasDeltaFilter({})).toBe(false)
        expect(hasDeltaFilter('')).toBe(false)
        expect(hasDeltaFilter(null)).toBe(false)
    })
})

describe('entityShapeReadStream pagination', () => {
    it('stops when last batch is smaller than batchSize (local DB mode)', async () => {
        const { entityShapeReadStream } = require('../../srv/adapters/lib/entityShapeReadStream')
        const batches = [
            [{ ID: '1' }, { ID: '2' }],
            [{ ID: '3' }],
        ]
        let call = 0
        const service = {
            run: async () => batches[call++] || [],
        }
        const config = {
            source: { entity: 'E', batchSize: 2 },
            viewMapping: { isWildcard: true, projectedColumns: [] },
            delta: {},
        }
        const collected = []
        for await (const batch of entityShapeReadStream({
            service,
            config,
            tracker: {},
            buildDeltaFilter: () => ({}),
            stopWhenPartialPage: true,
        })) {
            collected.push(batch)
        }
        expect(collected).toHaveLength(2)
        expect(call).toBe(2)
    })

    it('keeps paging on partial batches until empty (remote server-cap mode)', async () => {
        const { entityShapeReadStream } = require('../../srv/adapters/lib/entityShapeReadStream')
        const batches = [
            [{ ID: '1' }, { ID: '2' }],
            [{ ID: '3' }, { ID: '4' }],
            [{ ID: '5' }],
            [],
        ]
        let call = 0
        const service = {
            run: async () => batches[call++] || [],
        }
        const config = {
            source: { entity: 'E', batchSize: 1000 },
            viewMapping: { isWildcard: true, projectedColumns: [] },
            delta: {},
        }
        const collected = []
        for await (const batch of entityShapeReadStream({
            service,
            config,
            tracker: {},
            buildDeltaFilter: () => ({}),
            stopWhenPartialPage: false,
        })) {
            collected.push(batch)
        }
        expect(collected).toHaveLength(3)
        expect(collected.flat()).toHaveLength(5)
    })
})
