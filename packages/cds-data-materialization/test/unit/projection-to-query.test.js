const path = require('path')
const {
    compileProjectionToQuery,
    resolveSourceFrom,
    validateSupportedProjection,
} = require('../../srv/projection-to-query')

const spikeProjection = require('../fixtures/projections/daily-revenue-csn.json').projection

describe('projection-to-query compiler', () => {
    const projection = spikeProjection

    it('[M-3] compiles group-by projection to a SELECT closure', async () => {
        const queryFn = compileProjectionToQuery({
            sourceFrom: 'consumer.SourceOrders',
            projection,
        })
        const built = queryFn()
        expect(built.SELECT).toBeTruthy()
        const fromRef = built.SELECT.from.ref
        expect(fromRef.join('.')).toBe('consumer.SourceOrders')
        expect(built.SELECT.columns.length).toBe(4)
        expect(built.SELECT.groupBy).toEqual([{ ref: ['customerId'] }])
    })

    it('[M-3] resolveSourceFrom uses namespace for single-segment from ref', () => {
        const from = resolveSourceFrom({
            projection,
            entityFqn: 'spike.DailyRevenue',
        })
        expect(from).toBe('spike.Orders')
    })

    it('[M-5] rejects non-aggregation projections', () => {
        expect(() =>
            validateSupportedProjection('X', { columns: [{ ref: ['id'] }] }),
        ).toThrow(/group by or aggregate/)
    })
})
