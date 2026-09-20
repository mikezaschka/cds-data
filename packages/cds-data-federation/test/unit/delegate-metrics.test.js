const cds = require('@sap/cds')
const metrics = require('../../srv/metrics/delegate-metrics')

/**
 * Delegate instrumentation — ADR 0019.
 *
 * The accumulation and merge rules are the substance here: an average cannot be
 * stored because averages do not merge, and min/max merge by comparison rather
 * than by sum. Those are the properties that make concurrent flushes correct.
 */
describe('delegate metrics (ADR 0019)', () => {

    const enable = (cfg = { enabled: true }) => {
        cds.env.requires ??= {}
        cds.env.requires['data-federation'] = { metrics: cfg }
    }
    const disable = () => {
        cds.env.requires ??= {}
        delete cds.env.requires['data-federation']
    }

    beforeEach(() => {
        metrics._reset()
        disable()
    })
    afterEach(() => {
        metrics._reset()
        disable()
    })

    describe('the flag', () => {

        it('is off unless explicitly enabled', () => {
            expect(metrics.isEnabled()).toBe(false)
            enable({ enabled: false })
            expect(metrics.isEnabled()).toBe(false)
            enable()
            expect(metrics.isEnabled()).toBe(true)
        })

        it('hands the original handler back untouched when off', () => {
            const handler = async () => 'x'
            const wrapped = metrics.instrument({ name: 'S' }, 'E', 'read', handler)
            // Not merely equivalent — the same function, so there is no wrapper
            // frame and no timer on the delegate path.
            expect(wrapped).toBe(handler)
        })

        it('wraps when on', () => {
            enable()
            const handler = async () => 'x'
            expect(metrics.instrument({ name: 'S' }, 'E', 'read', handler)).not.toBe(handler)
        })
    })

    describe('counting', () => {

        beforeEach(() => enable())

        it('counts a successful read and preserves the result', async () => {
            const wrapped = metrics.instrument({ name: 'S' }, 'E', 'read', async () => 'payload')
            await expect(wrapped({})).resolves.toBe('payload')

            const acc = metrics._pending().get('S.E')
            expect(acc.requests).toBe(1)
            expect(acc.errors).toBe(0)
        })

        it('counts a failed read and still rethrows', async () => {
            const boom = new Error('remote exploded')
            const wrapped = metrics.instrument({ name: 'S' }, 'E', 'read', async () => { throw boom })
            await expect(wrapped({})).rejects.toBe(boom)

            const acc = metrics._pending().get('S.E')
            expect(acc.requests).toBe(1)
            expect(acc.errors).toBe(1)
        })

        it('counts writes apart from reads', async () => {
            const read = metrics.instrument({ name: 'S' }, 'E', 'read', async () => 1)
            const write = metrics.instrument({ name: 'S' }, 'E', 'write', async () => 1)
            const failing = metrics.instrument({ name: 'S' }, 'E', 'write', async () => { throw new Error('x') })
            await read({})
            await write({})
            await failing({}).catch(() => {})

            const acc = metrics._pending().get('S.E')
            expect(acc.requests).toBe(1)
            expect(acc.errors).toBe(0)
            expect(acc.writes).toBe(2)
            expect(acc.writeErrors).toBe(1)
        })

        it('keys on the consumption-view FQN, not the served name', async () => {
            metrics.mapEntity('ShowcaseService', 'Airports', 'sap.capire.showcase.Airports')
            const wrapped = metrics.instrument({ name: 'ShowcaseService' }, 'Airports', 'read', async () => 1)
            await wrapped({})
            expect([...metrics._pending().keys()]).toEqual(['sap.capire.showcase.Airports'])
        })
    })

    describe('what the accumulator stores', () => {

        beforeEach(() => enable())

        it('stores a latency sum, never an average', () => {
            metrics.record('E', 'read', 10, true)
            metrics.record('E', 'read', 30, true)
            const acc = metrics._pending().get('E')

            expect(acc.latencySumMs).toBe(40)
            expect(acc).not.toHaveProperty('avgLatency')
            // The average is derivable, which is the point: 40/2 = 20.
            expect(acc.latencySumMs / acc.requests).toBe(20)
        })

        it('tracks min and max by comparison', () => {
            for (const ms of [50, 10, 30]) metrics.record('E', 'read', ms, true)
            const acc = metrics._pending().get('E')
            expect(acc.minLatency).toBe(10)
            expect(acc.maxLatency).toBe(50)
        })

        it('keeps entities apart', () => {
            metrics.record('A', 'read', 5, true)
            metrics.record('B', 'read', 7, false)
            expect(metrics._pending().get('A').errors).toBe(0)
            expect(metrics._pending().get('B').errors).toBe(1)
        })
    })

    describe('buckets', () => {

        it('buckets hourly, in the convention cds-caching uses', () => {
            const bucket = metrics.currentBucket(new Date('2026-09-20T14:37:12Z'))
            expect(bucket).toBe('hourly:2026-09-20T14')
        })

        it('puts two times in the same hour in one bucket', () => {
            expect(metrics.currentBucket(new Date('2026-09-20T14:00:00Z')))
                .toBe(metrics.currentBucket(new Date('2026-09-20T14:59:59Z')))
        })
    })

    describe('flushing', () => {

        beforeEach(() => enable())

        it('does nothing when there is nothing pending', async () => {
            await expect(metrics.flush()).resolves.toEqual({ rows: 0 })
        })

        it('clears the accumulator so counts are not written twice', async () => {
            metrics.record('E', 'read', 5, true)
            // Fails: no database in a unit context. The batch must still be
            // taken off the live accumulator and folded back, not double-counted.
            await metrics.flush()
            const acc = metrics._pending().get('E')
            expect(acc.requests).toBe(1)
        })

        it('folds a failed batch back so traffic is not lost', async () => {
            metrics.record('E', 'read', 5, true)
            await metrics.flush()          // fails, folds back
            metrics.record('E', 'read', 7, true)
            const acc = metrics._pending().get('E')
            expect(acc.requests).toBe(2)
            expect(acc.latencySumMs).toBe(12)
            expect(acc.minLatency).toBe(5)
            expect(acc.maxLatency).toBe(7)
        })
    })
})
