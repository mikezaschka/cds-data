const DbTargetAdapter = require('../../srv/adapters/targets/DbTargetAdapter')

describe('DbTargetAdapter', () => {
    it('advertises full DB capabilities', () => {
        const a = new DbTargetAdapter(null, {})
        const c = a.capabilities()
        expect(c.batchInsert).toBe(true)
        expect(c.keyAddressableUpsert).toBe(true)
        expect(c.batchDelete).toBe(true)
        expect(c.truncate).toBe(true)
    })
})
