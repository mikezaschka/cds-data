const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — cross-service expand: remote → local
//
// C1–C4: delegated entity with `$expand` to a LOCAL backlink entity. Plugin strips
// the local expand items, forwards the remote query, queries local data separately, and
// stitches. See: `spec/concepts/cross-service-scenarios.md#cross-service-expand-remote--local`.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('$expand Scenario C: Remote → Local (V4)', () => {

        it('[4.2.5] C1 [cross-service expand: remote → local]: Customers → bookmarks (remote → local, to-many backlink)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks`
            expect(data).to.have.property('bookmarks')
            expect(data.bookmarks).to.be.an('array')
            expect(data.bookmarks).to.have.length(2)
            expect(data.bookmarks.map(b => b.label).sort()).to.deep.equal(['Favorite supplier', 'VIP customer'])
        })

        it('[4.2.5] C2 [cross-service expand: remote → local]: Customers → bookmarks (all customers, some with empty arrays)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers?$expand=bookmarks`
            expect(data.value).to.have.length(5)
            const c001 = data.value.find(c => c.ID === 'C001')
            const c003 = data.value.find(c => c.ID === 'C003')
            const c002 = data.value.find(c => c.ID === 'C002')
            expect(c001.bookmarks).to.be.an('array').with.length(2)
            expect(c003.bookmarks).to.be.an('array').with.length(1)
            expect(c003.bookmarks[0].label).to.equal('Watch list')
            expect(c002.bookmarks).to.be.an('array').with.length(0)
        })

        it('[4.2.5] C3 [cross-service expand: remote → local]: Customers → bookmarks with $select in expand', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks($select=label)`
            expect(data.bookmarks).to.be.an('array').with.length(2)
            expect(data.bookmarks[0]).to.have.property('label')
        })

        it('[4.2.5] C4 [cross-service expand: remote → local]: Customers → bookmarks,orders (mixed: Scenario C + Scenario A)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks,orders`
            expect(data.bookmarks).to.be.an('array').with.length(2)
            expect(data.orders).to.be.an('array')
            expect(data.orders.length).to.equal(2)
        })

        it('C: $filter within Scenario C expand (remote → local)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks($filter=label eq 'VIP customer')`
            expect(data.bookmarks).to.be.an('array').with.length(1)
            expect(data.bookmarks[0].label).to.equal('VIP customer')
        })

        it('C: $orderby within Scenario C expand (remote → local)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks($orderby=label asc)`
            expect(data.bookmarks).to.be.an('array').with.length(2)
            const labels = data.bookmarks.map(b => b.label)
            expect(labels).to.deep.equal([...labels].sort())
        })

        it('C: $top within Scenario C expand (remote → local)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks($top=1)`
            expect(data.bookmarks).to.be.an('array').with.length(1)
        })

        it('C: String functions on remote entity with local $expand', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers?$filter=contains(name,'Corp')&$expand=bookmarks`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(c => c.name.includes('Corp'))).to.be.true
            for (const c of data.value) {
                expect(c.bookmarks).to.be.an('array')
            }
        })

        it('C: as select from renames — remote → local expand with backlink', async () => {
            const { data } = await GET`/odata/v4/consumer/SelectFromProducts('P001')?$expand=notes`
            expect(data.productKey).to.equal('P001')
            expect(data.Name).to.equal('Laptop Pro')
            expect(data.notes).to.be.an('array').with.length(1)
            expect(data.notes[0].note).to.equal('Select-from note for Laptop Pro')
        })

        it('C: navigation path $filter on local to-one assoc (detail/Name)', async () => {
            // Mirrors Products?$filter=LocalEntity/Name eq 'Product 3' — must not
            // forward LocalEntity/detail to the remote.
            const { data } = await GET`/odata/v4/consumer/SelectFromProducts?$filter=detail/Name eq 'Product 3'`
            expect(data.value).to.have.length(1)
            expect(data.value[0].productKey).to.equal('P003')
        })

        it('C: navigation path $filter + $expand on local to-one assoc', async () => {
            const { data } = await GET`/odata/v4/consumer/SelectFromProducts?$expand=detail&$filter=detail/Name eq 'Product 3'`
            expect(data.value).to.have.length(1)
            expect(data.value[0].productKey).to.equal('P003')
            expect(data.value[0].detail).to.be.an('object')
            expect(data.value[0].detail.Name).to.equal('Product 3')
        })

        it('C: contains() on local to-one navigation path', async () => {
            const { data } = await GET(`/odata/v4/consumer/SelectFromProducts?$filter=contains(detail/Name,'Detail')`)
            expect(data.value).to.have.length(2)
            const keys = data.value.map(p => p.productKey).sort()
            expect(keys).to.deep.equal(['P001', 'P002'])
        })
    })
})
