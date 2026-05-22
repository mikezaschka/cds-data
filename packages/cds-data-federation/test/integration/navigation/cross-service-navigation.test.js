const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — cross-service navigation
//
// N1–N5: OData navigation URLs that cross a local/remote boundary
// (`/Reviews(id)/product` — local → remote; `/Customers('C001')/bookmarks` — remote → local).
// See: `spec/concepts/cross-service-scenarios.md#cross-service-navigation`.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('Cross-service navigation (V4-only)', () => {

        it('[4.2.12] N1 [cross-service navigation: local → remote]: Local → remote navigation: Reviews(id)/product', async () => {
            const reviews = await GET`/odata/v4/consumer/Reviews`
            const reviewId = reviews.data.value[0].ID
            const { data } = await GET(`/odata/v4/consumer/Reviews('${reviewId}')/product`)
            expect(data).to.have.property('productId')
            expect(data).to.have.property('productName')
            expect(data).to.have.property('category')
        })

        it('[4.2.12] N2 [cross-service navigation: remote → local]: Remote → local navigation: Customers(id)/bookmarks (backlink)', async () => {
            const { data } = await GET(`/odata/v4/consumer/Customers('C001')/bookmarks`)
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(2)
            expect(data.value[0]).to.have.property('label')
            expect(data.value[0]).to.have.property('customer_ID', 'C001')
        })

        it('[4.2.12] N3 [cross-service navigation: local → remote]: Navigation with $select on target', async () => {
            const reviews = await GET`/odata/v4/consumer/Reviews`
            const reviewId = reviews.data.value[0].ID
            const { data } = await GET(`/odata/v4/consumer/Reviews('${reviewId}')/product?$select=productName,category`)
            expect(data).to.have.property('productName')
            expect(data).to.have.property('category')
            expect(data).to.not.have.property('unitPrice')
        })

        it('[4.2.12] N4 [cross-service navigation: remote → local]: Remote → local navigation with $filter', async () => {
            const { data } = await GET(`/odata/v4/consumer/Customers('C001')/bookmarks?$filter=label eq 'VIP customer'`)
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(1)
            expect(data.value[0]).to.have.property('label', 'VIP customer')
        })

        it('[4.2.12] N5 [cross-service navigation: local → remote]: Local → remote navigation: Bookmarks(id)/customer (wildcard)', async () => {
            const bookmarks = await GET`/odata/v4/consumer/Bookmarks`
            const bookmarkId = bookmarks.data.value[0].ID
            const { data } = await GET(`/odata/v4/consumer/Bookmarks('${bookmarkId}')/customer`)
            expect(data).to.have.property('ID')
            expect(data).to.have.property('name')
            expect(data).to.have.property('city')
        })
    })
})
