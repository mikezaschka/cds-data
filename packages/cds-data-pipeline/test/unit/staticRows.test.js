require('@sap/cds') // for the SELECT global
const { queryStaticRows, UnsupportedQuery } = require('../../srv/lib/staticRows')

/**
 * The evaluator behind the fixed value lists on /pipeline. The OData round
 * trip is covered in management-service.test.js; this pins the CQN semantics,
 * using cds.ql so the where clauses are shaped the way CAP shapes them.
 */
describe('queryStaticRows', () => {
    const list = [
        { code: 'manual', name: 'Manual' },
        { code: 'scheduled', name: 'Scheduled' },
        { code: 'external', name: 'External' },
        { code: 'event', name: 'Event' },
    ]
    const target = {
        name: 'Test.Triggers',
        keys: { code: {} },
        elements: { code: { type: 'cds.String' }, name: { type: 'cds.String' } },
    }
    const run = (query, extra = {}) => queryStaticRows(list, { query, target, ...extra })
    const codes = rows => rows.map(r => r.code)

    it('returns the whole list for a bare read', () => {
        expect(codes(run(SELECT.from('Test.Triggers')))).toEqual(codes(list))
    })

    it('filters on comparisons joined by and/or, with or binding looser', () => {
        const q = SELECT.from('Test.Triggers')
            .where(`code = 'manual' or code = 'event' and name = 'Event'`)
        expect(codes(run(q))).toEqual(['manual', 'event'])
        const q2 = SELECT.from('Test.Triggers').where(`code != 'manual' and code != 'event'`)
        expect(codes(run(q2))).toEqual(['scheduled', 'external'])
    })

    it('supports in, not, and parentheses', () => {
        expect(codes(run(SELECT.from('Test.Triggers').where(`code in ('event', 'manual')`))))
            .toEqual(['manual', 'event'])
        expect(codes(run(SELECT.from('Test.Triggers').where(`not (code = 'manual' or code = 'event')`))))
            .toEqual(['scheduled', 'external'])
    })

    it('supports the string functions OData sends', () => {
        const q = SELECT.from('Test.Triggers').where({ func: 'contains', args: [{ ref: ['code'] }, { val: 'ed' }] })
        expect(codes(run(q))).toEqual(['scheduled'])
        const q2 = SELECT.from('Test.Triggers').where([
            { func: 'startswith', args: [{ func: 'tolower', args: [{ ref: ['name'] }] }, { val: 'e' }] },
        ])
        expect(codes(run(q2))).toEqual(['external', 'event'])
    })

    it('orders, stably, in either direction', () => {
        expect(codes(run(SELECT.from('Test.Triggers').orderBy('code'))))
            .toEqual(['event', 'external', 'manual', 'scheduled'])
        expect(codes(run(SELECT.from('Test.Triggers').orderBy('code desc'))))
            .toEqual(['scheduled', 'manual', 'external', 'event'])
    })

    it('pages after ordering, and counts before paging', () => {
        const q = SELECT.from('Test.Triggers').orderBy('code').limit(2, 1)
        q.SELECT.count = true
        const rows = run(q)
        expect(codes(rows)).toEqual(['external', 'manual'])
        expect(rows.$count).toBe(4)
    })

    it('projects to the selected columns and keeps the key', () => {
        const rows = run(SELECT.from('Test.Triggers').columns('name').where(`code = 'event'`))
        expect(rows).toEqual([{ code: 'event', name: 'Event' }])
        const renamed = run(SELECT.from('Test.Triggers').columns('code', 'name as label').limit(1))
        expect(renamed).toEqual([{ code: 'manual', label: 'Manual' }])
    })

    it('searches every string element, case-insensitively', () => {
        const q = SELECT.from('Test.Triggers')
        q.SELECT.search = [{ val: 'SCHED' }]
        expect(codes(run(q))).toEqual(['scheduled'])
    })

    it('narrows a by-key read from the request params', () => {
        expect(codes(run(SELECT.from('Test.Triggers'), { params: [{ code: 'event' }] }))).toEqual(['event'])
        expect(codes(run(SELECT.from('Test.Triggers'), { params: ['manual'] }))).toEqual(['manual'])
    })

    it('refuses what it cannot evaluate instead of returning everything', () => {
        const q = SELECT.from('Test.Triggers').where({ func: 'matchespattern', args: [{ ref: ['code'] }, { val: '^m' }] })
        expect(() => run(q)).toThrow(UnsupportedQuery)
        const q2 = SELECT.from('Test.Triggers').where(`code like 'm%'`)
        expect(() => run(q2)).toThrow(UnsupportedQuery)
    })

    it('does not mutate the source list', () => {
        run(SELECT.from('Test.Triggers').orderBy('code desc').limit(1))
        expect(codes(list)).toEqual(['manual', 'scheduled', 'external', 'event'])
    })
})
