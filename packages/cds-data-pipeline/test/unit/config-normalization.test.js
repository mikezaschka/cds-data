const DataPipelineService = require('../../srv/DataPipelineService')

describe('DataPipelineService config normalization', () => {
    let srv

    beforeAll(() => {
        srv = new DataPipelineService('DataPipelineService')
    })

    it('entity-shape defaults: mode full, no delta config', () => {
        const n = srv._normalizeConfig({
            name: 'p',
            source: { service: 'S', entity: 'E' },
            target: { entity: 'db.T' },
        })
        expect(n.mode).toBe('full')
        expect(n.delta).toBeUndefined()
        expect(n.source.batchSize).toBe(1000)
    })

    it('entity-shape + mode delta: applies timestamp delta defaults', () => {
        const n = srv._normalizeConfig({
            name: 'p',
            source: { service: 'S', entity: 'E' },
            target: { entity: 'db.T' },
            mode: 'delta',
        })
        expect(n.mode).toBe('delta')
        expect(n.delta.mode).toBe('timestamp')
        expect(n.delta.field).toBe('modifiedAt')
    })

    it('query-shape defaults: mode full, refresh full, no delta config', () => {
        const n = srv._normalizeConfig({
            name: 'p',
            source: { service: 'db', query: () => ({}) },
            target: { entity: 'db.T' },
        })
        expect(n.mode).toBe('full')
        expect(n.delta).toBeUndefined()
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

    it('normalizes 5-field cron to queued engine', () => {
        expect(srv._normalizeSchedule('*/10 * * * *', 'x')).toEqual({
            every: '*/10 * * * *',
            engine: 'queued',
        })
        expect(srv._normalizeSchedule({ every: '0 */10 * * *' }, 'x')).toEqual({
            every: '0 */10 * * *',
            engine: 'queued',
        })
    })

    it('rejects cron with explicit spawn engine', () => {
        expect(() => srv._normalizeSchedule({ every: '*/10 * * * *', engine: 'spawn' }, 'x'))
            .toThrow(/cron/)
    })
})
