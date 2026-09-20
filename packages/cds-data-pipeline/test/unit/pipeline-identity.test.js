const DataPipelineService = require('../../srv/DataPipelineService')

/**
 * ADR 0018 — pipeline names stay short and readable, so two annotated views
 * whose last segment matches still collide. The collision is detected, not
 * prevented; what this covers is that it explains itself, and that a consumer
 * can address a pipeline by the view it came from instead of by its name.
 */
describe('pipeline identity and name collisions (ADR 0018)', () => {

    let srv
    beforeEach(() => {
        srv = new DataPipelineService('DataPipelineService')
        // `init()` builds this, and it needs a served CAP app; the registry is
        // all these paths touch.
        srv.pipelines = new Map()
    })

    /** A registered pipeline, without booting one: addPipeline needs a db. */
    const registered = (name, entityFullName, producer) => {
        srv.pipelines.set(name, { name, entityFullName, producer })
    }

    describe('registration metadata', () => {

        it('carries entityFullName and producer through normalization', () => {
            const n = srv._normalizeConfig({
                name: 'Flights',
                entityFullName: 'sap.capire.xflights.Flights',
                producer: '@federation.replicate',
                source: { service: 'S', entity: 'E' },
                target: { entity: 'db.T' },
            })
            expect(n.entityFullName).toBe('sap.capire.xflights.Flights')
            expect(n.producer).toBe('@federation.replicate')
        })

        it('leaves both undefined for a direct addPipeline config', () => {
            const n = srv._normalizeConfig({
                name: 'Handwritten',
                source: { service: 'S', entity: 'E' },
                target: { entity: 'db.T' },
            })
            expect(n.entityFullName).toBeUndefined()
            expect(n.producer).toBeUndefined()
        })
    })

    describe('the collision message', () => {

        it('names both entities, both producers, and the way out', () => {
            registered('Flights', 'sap.capire.xflights.Flights', '@federation.replicate')

            const msg = srv._composeCollisionMessage('Flights', {
                name: 'Flights',
                entityFullName: 'analytics.Flights',
                producer: '@materialize.snapshot',
            })

            expect(msg).toContain('sap.capire.xflights.Flights')
            expect(msg).toContain('analytics.Flights')
            expect(msg).toContain('@federation.replicate')
            expect(msg).toContain('@materialize.snapshot')
            // The remedy, phrased for the annotation that lost the race.
            expect(msg).toContain("@materialize.snapshot: { name: '...' }")
        })

        it('says names are shared across plugins, because they are', () => {
            registered('Flights', 'sap.capire.xflights.Flights', '@federation.replicate')
            const msg = srv._composeCollisionMessage('Flights', {
                name: 'Flights',
                entityFullName: 'analytics.Flights',
                producer: '@materialize.snapshot',
            })
            expect(msg).toContain('shared across all cds-data plugins')
        })

        it('falls back to the plain message when a side has no metadata', () => {
            // A direct addPipeline call on both sides: there is nothing more
            // specific to say, and inventing detail would be worse.
            registered('Handwritten', null, null)
            const msg = srv._composeCollisionMessage('Handwritten', { name: 'Handwritten' })
            expect(msg).toBe("Pipeline configuration 'Handwritten' already exists")
        })

        it('falls back when only the incoming side is annotated', () => {
            registered('Flights', null, null)
            const msg = srv._composeCollisionMessage('Flights', {
                name: 'Flights',
                entityFullName: 'analytics.Flights',
                producer: '@materialize.snapshot',
            })
            expect(msg).toBe("Pipeline configuration 'Flights' already exists")
        })
    })

    describe('resolving by consumption view', () => {

        it('finds a pipeline by FQN without knowing its name', () => {
            registered('Flights', 'sap.capire.xflights.Flights', '@federation.replicate')
            registered('Customers', 'sap.capire.s4.Customers', '@federation.replicate')

            expect(srv.pipelineForEntity('sap.capire.s4.Customers').name).toBe('Customers')
        })

        it('finds one whose name is nothing like its entity', () => {
            // The `name` option exists precisely so these can diverge.
            registered('nightly-flights', 'sap.capire.xflights.Flights', '@federation.replicate')
            expect(srv.pipelineForEntity('sap.capire.xflights.Flights').name).toBe('nightly-flights')
        })

        it('returns undefined for an unknown entity and for no entity', () => {
            registered('Flights', 'sap.capire.xflights.Flights', '@federation.replicate')
            expect(srv.pipelineForEntity('nope.Missing')).toBeUndefined()
            expect(srv.pipelineForEntity(undefined)).toBeUndefined()
            expect(srv.pipelineForEntity('')).toBeUndefined()
        })

        it('does not match a pipeline registered without an entity', () => {
            registered('Handwritten', null, null)
            expect(srv.pipelineForEntity(null)).toBeUndefined()
        })
    })
})
