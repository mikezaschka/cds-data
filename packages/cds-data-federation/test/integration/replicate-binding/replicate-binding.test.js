const path = require('path')
const cds = require('@sap/cds')
const { startProvider, stopProvider } = require('../../support/setup')

const consumerRoot = path.join(__dirname, '../../fixtures/consumer')

/**
 * Thin seam tests: @federation.replicate → pipeline binding only.
 * Engine-depth replicate runs live in packages/cds-data-pipeline/test/.
 */
describe('Replicate binding (@federation.replicate → pipeline)', () => {
    beforeAll(async () => {
        await startProvider()
    }, 60000)

    const { GET, expect } = cds.test(consumerRoot)

    afterAll(async () => {
        await stopProvider()
    })

    it('[4.5.1] binding: registers replicate pipelines on data-pipeline', async () => {
        const rows = await SELECT.from('plugin_data_pipeline_Pipelines')
        const names = rows.map(r => r.name)
        expect(names).to.include.members([
            'data-federation-cache:consumer.EntityCachedCustomers',
            'ReplicatedCustomers',
            'ReplicatedProducts',
            'ReplicatedPagedCustomers',
            'ReplicatedOrderFlat',
            'ReplicatedRestCustomers',
        ])
    })

    it('[4.4.1] binding: replicate target is exposed on consumer OData', async () => {
        const { status } = await GET('/odata/v4/consumer/ReplicatedCustomers?$top=1')
        expect(status).to.equal(200)
        const { data } = await GET('/odata/v4/consumer/ReplicatedCustomers?$top=1')
        expect(data.value).to.be.an('array')
    })

    it('[4.7.4] binding: replication freshness advances on every sync', async () => {
        const pipeline = await cds.connect.to('data-pipeline')
        await pipeline.execute('ReplicatedCustomers', { mode: 'full', trigger: 'event' })
        const first = await SELECT.one
            .from('consumer.ReplicatedCustomers')
            .columns('lastReplicatedAt', 'lastReplicatedBy')
            .where({ ID: 'C001' })

        await UPDATE('consumer.ReplicatedCustomers')
            .set({ name: 'Local edit' })
            .where({ ID: 'C001' })
        const afterLocalUpdate = await SELECT.one
            .from('consumer.ReplicatedCustomers')
            .columns('lastReplicatedAt', 'lastReplicatedBy')
            .where({ ID: 'C001' })

        await new Promise(resolve => setTimeout(resolve, 10))
        await pipeline.execute('ReplicatedCustomers', {
            trigger: 'event',
            event: { read: 'key', action: 'upsert', keys: { ID: 'C001' } },
        })
        const second = await SELECT.one
            .from('consumer.ReplicatedCustomers')
            .columns('lastReplicatedAt', 'lastReplicatedBy')
            .where({ ID: 'C001' })

        expect(first.lastReplicatedAt).to.exist
        expect(first.lastReplicatedBy).to.exist
        expect(afterLocalUpdate).to.deep.equal(first)
        expect(second.lastReplicatedAt).to.exist
        expect(second.lastReplicatedBy).to.exist
        expect(new Date(second.lastReplicatedAt).getTime())
            .to.be.greaterThan(new Date(first.lastReplicatedAt).getTime())
    })

    it('[4.4.1] binding: replicated products entity exposes consumption-view renames', () => {
        const entity = cds.model.definitions['consumer.ReplicatedProducts']
        expect(entity.elements.productId).to.exist
        expect(entity.elements.productName).to.exist
        expect(entity.elements.name).to.be.undefined
    })

    it('binding: records the consumption view each pipeline came from (ADR 0018)', async () => {
        const rows = await SELECT.from('plugin_data_pipeline_Pipelines')
        const byName = Object.fromEntries(rows.map(r => [r.name, r.entityFullName]))

        // The short name is the identity; the FQN is the address.
        expect(byName['ReplicatedCustomers']).to.equal('consumer.ReplicatedCustomers')
        expect(byName['ReplicatedProducts']).to.equal('consumer.ReplicatedProducts')
        // The entity cache qualifies its own name already, but still carries
        // the address so every strategy resolves the same way.
        expect(byName['data-federation-cache:consumer.EntityCachedCustomers'])
            .to.equal('consumer.EntityCachedCustomers')
    })

    it('binding: a pipeline resolves by consumption view, not only by name (ADR 0018)', async () => {
        const pipelines = await cds.connect.to('data-pipeline')
        const found = pipelines.pipelineForEntity('consumer.ReplicatedCustomers')
        expect(found, 'no pipeline resolved for consumer.ReplicatedCustomers').to.exist
        expect(found.name).to.equal('ReplicatedCustomers')
        expect(pipelines.pipelineForEntity('consumer.NotFederated')).to.be.undefined
    })

    it('[4.4.1] binding: replicate defaults to full mode without delta config', async () => {
        const row = await SELECT.one.from('plugin_data_pipeline_Pipelines').where({ name: 'ReplicatedCustomers' })
        expect(row).to.exist
        const base = JSON.parse(row.baseConfig)
        expect(base.mode).to.equal('full')
        expect(base.delta).to.be.undefined
    })

    it('[4.4.1] binding: delta config without mode is ignored (full mode)', async () => {
        const row = await SELECT.one.from('plugin_data_pipeline_Pipelines').where({ name: 'ReplicatedProducts' })
        expect(row).to.exist
        const base = JSON.parse(row.baseConfig)
        expect(base.mode).to.equal('full')
        expect(base.delta).to.be.undefined
    })

    it('[4.4.2] binding: derived read models query as views over replicated tables', async () => {
        const available = cds.model.definitions['consumer.AvailableProducts']
        const stats = cds.model.definitions['consumer.CategoryStats']
        expect(available['@cds.persistence.table']).to.equal(false)
        expect(stats['@cds.persistence.table']).to.equal(false)

        const { status: availableStatus } = await GET('/odata/v4/consumer/AvailableProducts?$top=1')
        expect(availableStatus).to.equal(200)
        const { data: availableData } = await GET('/odata/v4/consumer/AvailableProducts?$top=1')
        expect(availableData.value).to.be.an('array')

        const { status: statsStatus } = await GET('/odata/v4/consumer/CategoryStats?$top=1')
        expect(statsStatus).to.equal(200)
        const { data: statsData } = await GET('/odata/v4/consumer/CategoryStats?$top=1')
        expect(statsData.value).to.be.an('array')
    })
})
