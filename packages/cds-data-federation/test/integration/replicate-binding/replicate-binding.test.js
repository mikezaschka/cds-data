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
})
