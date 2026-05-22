const DataPipelineService = require('../../srv/DataPipelineService')

describe('DataPipelineService config normalization', () => {
    let srv

    beforeAll(() => {
        srv = new DataPipelineService('DataPipelineService')
    })

    it('entity-shape defaults: mode delta, delta.timestamp modifiedAt', () => {
        const n = srv._normalizeConfig({
            name: 'p',
            source: { service: 'S', entity: 'E' },
            target: { entity: 'db.T' },
        })
        expect(n.mode).toBe('delta')
        expect(n.delta.mode).toBe('timestamp')
        expect(n.delta.field).toBe('modifiedAt')
        expect(n.source.batchSize).toBe(1000)
    })

    it('query-shape defaults: mode full, delta.mode full', () => {
        const n = srv._normalizeConfig({
            name: 'p',
            source: { service: 'db', query: () => ({}) },
            target: { entity: 'db.T' },
        })
        expect(n.mode).toBe('full')
        expect(n.delta.mode).toBe('full')
        expect(n.refresh).toBe('full')
    })

    it('normalizes schedule number to spawn engine', () => {
        expect(srv._normalizeSchedule(undefined, 'x')).toBeUndefined()
        expect(srv._normalizeSchedule(null, 'x')).toBeUndefined()
        expect(srv._normalizeSchedule(5000, 'x')).toEqual({ every: 5000, engine: 'spawn' })
        expect(srv._normalizeSchedule('10000', 'x')).toEqual({ every: '10000', engine: 'spawn' })
    })

    it('normalizes schedule object with explicit engine', () => {
        expect(srv._normalizeSchedule({ every: 200, engine: 'spawn' }, 'x')).toEqual({ every: 200, engine: 'spawn' })
    })

    it('rejects unknown schedule.engine', () => {
        expect(() => srv._normalizeSchedule({ every: 1, engine: 'kafka' }, 'x')).toThrow(/schedule\.engine/)
    })

    it('rejects schedule object without every', () => {
        expect(() => srv._normalizeSchedule({ engine: 'spawn' }, 'x')).toThrow(/schedule\.every/)
    })
})
