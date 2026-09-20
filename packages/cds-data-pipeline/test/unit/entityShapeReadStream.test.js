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

describe('entityShapeReadStream static where', () => {
    async function firstSelect(kind, staticWhere) {
        const { entityShapeReadStream } = require('../../srv/adapters/lib/entityShapeReadStream')
        const queries = []
        const service = { name: 'Remote', options: { kind }, run: async q => { queries.push(q); return [] } }
        const config = {
            source: { entity: 'E', batchSize: 10 },
            viewMapping: { isWildcard: true, projectedColumns: [], staticWhere },
            delta: {},
        }
        const stream = entityShapeReadStream({ service, config, tracker: {}, buildDeltaFilter: () => ({}) })
        while (!(await stream.next()).done) { /* drain */ }
        return queries[0].SELECT // not the query itself: a returned thenable would be executed
    }

    it("rewrites CXL '==' to '=' for OData remotes (cqn2odata has no '==' mapping)", async () => {
        const where = [{ ref: ['Category'] }, '==', { val: '1' }]
        const select = await firstSelect('odata', where)
        expect(select.where).toEqual([{ ref: ['Category'] }, '=', { val: '1' }])
        expect(where[1]).toBe('==') // CSN projection stays untouched
    })

    it("rewrites '==' inside nested xpr for odata-v2 remotes", async () => {
        const where = [{ xpr: [{ ref: ['A'] }, '==', { val: 1 }] }, 'and', { ref: ['B'] }, '!=', { val: 2 }]
        const select = await firstSelect('odata-v2', where)
        expect(select.where).toEqual([{ xpr: [{ ref: ['A'] }, '=', { val: 1 }] }, 'and', { ref: ['B'] }, '!=', { val: 2 }])
    })

    it("keeps '==' for CQN-native remotes (hcql)", async () => {
        const select = await firstSelect('hcql', [{ ref: ['Category'] }, '==', { val: '1' }])
        expect(select.where).toEqual([{ ref: ['Category'] }, '==', { val: '1' }])
    })
})
