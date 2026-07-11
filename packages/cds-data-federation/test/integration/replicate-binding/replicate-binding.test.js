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

    it('[4.5.1] binding: registers replicate pipelines on DataPipelineService', async () => {
        const rows = await SELECT.from('plugin_data_pipeline_Pipelines')
        const names = rows.map(r => r.name)
        expect(names).to.include.members([
            'federation-entity-cache:consumer.EntityCachedCustomers',
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

    it('[4.4.1] binding: replicated products entity exposes consumption-view renames', () => {
        const entity = cds.model.definitions['consumer.ReplicatedProducts']
        expect(entity.elements.productId).to.exist
        expect(entity.elements.productName).to.exist
        expect(entity.elements.name).to.be.undefined
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
