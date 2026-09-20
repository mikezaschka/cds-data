const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../../support/setup')

const consumerRoot = path.join(__dirname, '../../fixtures/consumer')

/**
 * The federation management API — ADR 0017.
 *
 * One row per `@federation.*` entity, addressed by the consumption view's FQN,
 * so a caller never needs to know what the underlying pipeline or cache is
 * called. Nothing here is persisted, and nothing copies run statistics or cache
 * metrics: those stay with the plugins that own them.
 */
describe('Federation management API (ADR 0017)', () => {

    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET, POST, expect, axios } = cds.test(consumerRoot)
    // Several cases here assert a rejection, so status codes must come back as
    // values rather than thrown errors.
    axios.defaults.validateStatus = () => true
    // The management API requires an authenticated user by design.
    axios.defaults.auth = { username: 'alice', password: '' }

    afterAll(async () => {
        await stopProvider()
    })

    const byEntity = async () => {
        const { data } = await GET('/federation/FederatedEntities')
        return Object.fromEntries(data.value.map(r => [r.entity, r]))
    }

    describe('the inventory', () => {

        it('serves the API only because the app asked for it', async () => {
            // requires.data-federation.management.reuse.api in the fixture.
            const { status } = await GET('/federation/FederatedEntities')
            expect(status).to.equal(200)
        })

        it('refuses an anonymous caller', async () => {
            // This describes which remote systems the app talks to and how it
            // renames and scopes them, so it is not public. @requires:
            // 'authenticated-user' on the service; the console route carries an
            // express guard for the same reason.
            const { status } = await axios.get('/federation/FederatedEntities', { auth: null })
            expect(status).to.equal(401)
        })

        it('lists every annotated entity, addressed by consumption-view FQN', async () => {
            const rows = await byEntity()
            expect(Object.keys(rows)).to.include.members([
                'consumer.ReplicatedCustomers',
                'consumer.EntityCachedCustomers',
            ])
            // The key is the FQN, not the short name.
            for (const [key, row] of Object.entries(rows)) {
                expect(key).to.contain('.')
                expect(row.name).to.equal(key.split('.').pop())
            }
        })

        it('reports the strategy and the remote each view projects on', async () => {
            const rows = await byEntity()
            const replicated = rows['consumer.ReplicatedCustomers']
            expect(replicated.strategy).to.equal('replicate')
            expect(replicated.sourceService).to.be.a('string').and.not.be.empty
            expect(replicated.sourceEntity).to.be.a('string').and.not.be.empty
        })

        it('distinguishes the two cache strategies from a plain delegate', async () => {
            const rows = await byEntity()
            const strategies = new Set(Object.values(rows).map(r => r.cacheStrategy))
            expect(strategies).to.include('entity')
            expect(strategies).to.include(null) // an uncached delegate, or a replica
        })

        it('reads a single entity by its FQN', async () => {
            const { status, data } = await GET(
                "/federation/FederatedEntities('consumer.ReplicatedCustomers')",
            )
            expect(status).to.equal(200)
            expect(data.entity).to.equal('consumer.ReplicatedCustomers')
        })

        it('names the pipeline without making the caller know it', async () => {
            const rows = await byEntity()
            // Resolved through the engine's own registry (ADR 0018), not by
            // re-deriving the name here.
            expect(rows['consumer.ReplicatedCustomers'].pipeline).to.equal('ReplicatedCustomers')
            expect(rows['consumer.EntityCachedCustomers'].pipeline)
                .to.equal('data-federation-cache:consumer.EntityCachedCustomers')
        })

        it('links to the pipeline detail rather than copying its state', async () => {
            const rows = await byEntity()
            const row = rows['consumer.ReplicatedCustomers']
            expect(row.pipelineDetail).to.contain("Pipelines('ReplicatedCustomers')")
            expect(row.pipelineDetailUnavailable).to.be.null
            // No run statistics are mirrored onto the federation row.
            expect(row).to.not.have.any.keys('lastRun', 'statistics_created', 'runs')
        })
    })

    describe('what the projection declares', () => {

        it('reports renames declared with `as`', async () => {
            const rows = await byEntity()
            const withRenames = Object.values(rows).filter(r => r.renames?.length)
            expect(withRenames.length, 'no fixture entity declares a rename').to.be.greaterThan(0)
            for (const { local, remote } of withRenames[0].renames) {
                expect(local).to.be.a('string')
                expect(remote).to.be.a('string')
                expect(local).to.not.equal(remote)
            }
        })

        it('flags a view carrying a static where as scoped', async () => {
            const rows = await byEntity()
            const scoped = Object.values(rows).filter(r => r.scoped)
            expect(scoped.length, 'no fixture entity has a static where').to.be.greaterThan(0)
        })

        it('reports write flags, defaulting to read-only', async () => {
            const rows = await byEntity()
            const readOnly = Object.values(rows).filter(r => !r.writable)
            expect(readOnly.length).to.be.greaterThan(0)
            for (const row of readOnly) expect(row.writeVerbs).to.equal('')
            for (const row of Object.values(rows).filter(r => r.writable)) {
                expect(row.writeVerbs).to.match(/create|update|delete/)
            }
        })
    })

    describe('actions', () => {

        it('refreshes a replica through the engine', async () => {
            const { status, data } = await POST(
                "/federation/FederatedEntities('consumer.ReplicatedCustomers')/refreshReplica",
                {},
            )
            expect(status).to.equal(200)
            expect(data.action).to.equal('execute')
            expect(data.entity).to.equal('consumer.ReplicatedCustomers')
        })

        it('refreshes one row when given keys', async () => {
            const { status, data } = await POST(
                "/federation/FederatedEntities('consumer.ReplicatedCustomers')/refreshReplica",
                { keys: JSON.stringify({ ID: '1' }) },
            )
            expect(status).to.equal(200)
            expect(data.action).to.equal('executeEvent')
        })

        it('rejects malformed keys rather than running the whole pipeline', async () => {
            const { status } = await POST(
                "/federation/FederatedEntities('consumer.ReplicatedCustomers')/refreshReplica",
                { keys: 'not-json' },
            )
            expect(status).to.equal(400)
        })

        it('refreshes an entity-cache snapshot', async () => {
            const { status, data } = await POST(
                "/federation/FederatedEntities('consumer.EntityCachedCustomers')/refreshEntityCache",
                {},
            )
            expect(status).to.equal(200)
            expect(data.action).to.equal('refreshEntityCache')
        })

        it('refuses an action the entity\'s strategy does not support', async () => {
            // A replica has no snapshot to refill and no response cache to drop.
            const cacheOnReplica = await POST(
                "/federation/FederatedEntities('consumer.ReplicatedCustomers')/refreshEntityCache",
                {},
            )
            const invalidateReplica = await POST(
                "/federation/FederatedEntities('consumer.ReplicatedCustomers')/invalidate",
                {},
            )
            expect(cacheOnReplica.status).to.equal(400)
            expect(invalidateReplica.status).to.equal(400)
        })

        it('404s for an entity that is not federated', async () => {
            const { status } = await POST(
                "/federation/FederatedEntities('consumer.NotFederated')/refreshReplica",
                {},
            )
            expect(status).to.equal(404)
        })

        it('exposes no other mutation', async () => {
            // Read-mostly by design: configuration changes belong to the
            // annotations, schedules and overrides to /pipeline.
            const created = await POST('/federation/FederatedEntities', { entity: 'x' })
            expect(created.status).to.be.oneOf([405, 400])
        })
    })
})
