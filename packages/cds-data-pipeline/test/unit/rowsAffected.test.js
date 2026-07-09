const { rowsAffected } = require('../../srv/lib/rowsAffected')

describe('rowsAffected', () => {
    it('returns numeric results unchanged (CDS 9)', () => {
        expect(rowsAffected(0)).toBe(0)
        expect(rowsAffected(1)).toBe(1)
        expect(rowsAffected(42)).toBe(42)
    })

    it('reads `.affected` from CDS 10 write-result shape', () => {
        const result = Object.assign([], { affected: 3 })
        expect(rowsAffected(result)).toBe(3)
    })

    it('prefers `.affected` over array length on CDS 10 UPDATE (empty RETURNING array)', () => {
        const result = Object.assign([], { affected: 1 })
        expect(result.length).toBe(0)
        expect(rowsAffected(result)).toBe(1)
    })

    it('falls back to array length when `.affected` is absent', () => {
        expect(rowsAffected([{ ID: 1 }, { ID: 2 }])).toBe(2)
    })

    it('treats nullish as zero affected rows', () => {
        expect(rowsAffected(null)).toBe(0)
        expect(rowsAffected(undefined)).toBe(0)
    })

    it('treats plain objects without `.affected` as zero', () => {
        expect(rowsAffected({})).toBe(0)
    })
})
