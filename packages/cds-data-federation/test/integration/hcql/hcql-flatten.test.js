const path = require('path')
const cds = require('@sap/cds')
const { startHcqlProvider, stopProvider } = require('../../support/setup')

const consumerRoot = path.join(__dirname, '../../fixtures/consumer')

describe('HCQL flatten (delegate + replicate)', () => {
    beforeAll(async () => {
        await startHcqlProvider()
    }, 60000)

    const { GET, expect } = cds.test(consumerRoot)

    afterAll(async () => {
        await stopProvider()
    })

    it('[4.1.3] delegate OrderFlat returns flattened association fields via HCQL', async () => {
        const { data } = await GET`/odata/v4/consumer/OrderFlat`
        expect(data.value.length).to.be.greaterThan(0)
        expect(data.value[0]).to.have.property('buyerName')
        expect(data.value[0]).to.have.property('itemName')
        expect(data.value[0].buyerName).to.be.a('string').and.not.empty
    })

    // The direct-remote query path (static `where` / lambda) is not yet compatible
    // with HCQL remotes: every such query is rejected with "Cannot determine target
    // entity of query." This is independent of flattening — a plain static-where
    // view such as ElectronicsProducts fails the same way against this provider.
    it.skip('[4.1.3] ShippedOrderFlat returns flattened fields on the direct-remote path', async () => {
        const { data } = await GET`/odata/v4/consumer/ShippedOrderFlat`
        expect(data.value.length).to.equal(3)
        expect(data.value[0]).to.have.property('buyerName')
        expect(data.value[0]).to.not.have.property('customer_name')
    })

    it.skip('[4.1.3] ReplicatedOrderFlat replicate over HCQL path SELECT (pending CAP HCQL batch read)', async () => {
        const srv = await cds.connect.to('data-pipeline')
        await srv.clear('ReplicatedOrderFlat')
        await srv.execute('ReplicatedOrderFlat', { mode: 'full', trigger: 'manual' })
        const rows = await SELECT.from('consumer.ReplicatedOrderFlat')
        expect(rows[0].buyerName).to.be.a('string').and.not.empty
    })
})
