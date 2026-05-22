const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — cross-service expand: local → remote
//
// B1–B14: local entity with `$expand` to a federated entity. Plugin batch-fetches
// the remote side and stitches results. Covers nav-path filter, base flavour, cross-provider
// (B4–B6 — Cross-service expand: cross-provider), nested expand + excluding columns,
// composite keys and to-many. See: `spec/concepts/cross-service-scenarios.md#cross-service-expand-local--remote`.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('Scenario B: Navigation path $filter (cross-service, V4)', () => {

        it('should filter local entity by remote navigation path', async () => {
            // Reviews is local, product is a to-one assoc to delegated Products (with renames).
            // 'Laptop Pro' is product P001; Reviews has 2 entries for P001.
            const { data } = await GET`/odata/v4/consumer/Reviews?$filter=product/productName eq 'Laptop Pro'`
            expect(data.value).to.have.length(2)
            expect(data.value.every(r => r.product_productId === 'P001')).to.be.true
        })

        it('should combine remote navigation filter with local field filter', async () => {
            // Electronics products: P001 (Laptop Pro), P002 (Wireless Mouse), P005 (USB-C Hub)
            // Reviews for Electronics products: P001 rating 5, P001 rating 3, P002 rating 4
            // Filter: Electronics AND rating >= 4 → P001/rating=5 + P002/rating=4 = 2 reviews
            const { data } = await GET`/odata/v4/consumer/Reviews?$filter=product/category eq 'Electronics' and rating ge 4`
            expect(data.value).to.have.length(2)
            expect(data.value.every(r => r.rating >= 4)).to.be.true
        })

        it('should return empty results when remote navigation filter matches nothing', async () => {
            const { data } = await GET`/odata/v4/consumer/Reviews?$filter=product/productName eq 'Nonexistent Product'`
            expect(data.value).to.have.length(0)
        })

        it('should filter with navigation path combined with $expand', async () => {
            // Filter by remote field AND expand the same remote association
            const { data } = await GET`/odata/v4/consumer/Reviews?$filter=product/productName eq 'Laptop Pro'&$expand=product`
            expect(data.value).to.have.length(2)
            expect(data.value[0]).to.have.property('product')
            expect(data.value[0].product.productName).to.equal('Laptop Pro')
        })
    })

    describe('$expand Scenario B: Local → Remote (V4)', () => {

        it('[4.2.5] B1 [cross-service expand: local → remote]: Reviews → product (local → delegate with renames)', async () => {
            const { data } = await GET`/odata/v4/consumer/Reviews?$expand=product`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('product')
            expect(data.value[0].product).to.have.property('productId')
            expect(data.value[0].product).to.have.property('productName')
        })

        it('[4.2.5] B2 [cross-service expand: local → remote]: Bookmarks → customer (local → delegate, wildcard)', async () => {
            const { data } = await GET`/odata/v4/consumer/Bookmarks?$expand=customer`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('customer')
            expect(data.value[0].customer).to.have.property('ID')
            expect(data.value[0].customer).to.have.property('name')
        })

        it('[4.2.5] B3 [cross-service expand: local → remote]: Reviews → product with $select', async () => {
            const { data } = await GET`/odata/v4/consumer/Reviews?$expand=product($select=productId,productName)`
            expect(data.value[0].product).to.have.property('productId')
            expect(data.value[0].product).to.have.property('productName')
            expect(data.value[0].product).to.not.have.property('unitPrice')
        })

        it('B: $filter within Scenario B expand (local → remote)', async () => {
            const { data } = await GET`/odata/v4/consumer/Reviews?$expand=product($filter=category eq 'Electronics')`
            expect(data.value).to.have.length(3)
            expect(data.value.every(r => r.product !== null)).to.be.true
            expect(data.value.every(r => r.product.category === 'Electronics')).to.be.true

            const { data: data2 } = await GET`/odata/v4/consumer/Reviews?$expand=product($filter=category eq 'Furniture')`
            expect(data2.value).to.have.length(3)
            expect(data2.value.every(r => r.product === null)).to.be.true
        })

        it('B: $orderby within Scenario B expand (local → remote)', async () => {
            const { data } = await GET`/odata/v4/consumer/Reviews?$expand=product($orderby=productName asc)`
            expect(data.value).to.have.length(3)
            expect(data.value.every(r => r.product !== null)).to.be.true
            expect(data.value[0].product).to.have.property('productName')
        })
    })

    describe('$expand Scenario B: Cross-provider (InventoryReports)', () => {

        it('[4.2.5] B4 [cross-service expand: cross-provider]: InventoryReports → product (local → ProviderService)', async () => {
            const { data } = await GET`/odata/v4/consumer/InventoryReports?$expand=product`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('product')
            expect(data.value[0].product).to.have.property('productId')
            expect(data.value[0].product).to.have.property('productName')
        })

        it('[4.2.5] B5 [cross-service expand: cross-provider]: InventoryReports → warehouse (local → InventoryService)', async () => {
            const { data } = await GET`/odata/v4/consumer/InventoryReports?$expand=warehouse`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('warehouse')
            expect(data.value[0].warehouse).to.have.property('ID')
            expect(data.value[0].warehouse).to.have.property('name')
        })

        it('[4.2.5] B6 [cross-service expand: cross-provider]: InventoryReports → product,warehouse (both providers in one expand)', async () => {
            const { data } = await GET`/odata/v4/consumer/InventoryReports?$expand=product,warehouse`
            expect(data.value).to.have.length(3)
            const report = data.value[0]
            expect(report).to.have.property('product')
            expect(report).to.have.property('warehouse')
            expect(report.product).to.have.property('productId')
            expect(report.product).to.have.property('productName')
            expect(report.warehouse).to.have.property('ID')
            expect(report.warehouse).to.have.property('name')
        })
    })

    describe('$expand Scenario B: Nested expand + Excluding', () => {

        it('[4.2.5] B7 [cross-service expand: local → remote]: Bookmarks → customer($expand=orders) nested expand with rename mapping', async () => {
            const { data } = await GET`/odata/v4/consumer/Bookmarks?$expand=customer($expand=orders)`
            expect(data.value).to.have.length(3)
            const c001 = data.value.find(b => b.customer_ID === 'C001')
            expect(c001.customer).to.have.property('name')
            expect(c001.customer.orders).to.be.an('array')
            expect(c001.customer.orders.length).to.be.greaterThan(0)
            expect(c001.customer.orders[0]).to.have.property('orderId')
            expect(c001.customer.orders[0]).to.have.property('amount')
            expect(c001.customer.orders[0]).to.have.property('placedOn')
            expect(c001.customer.orders[0]).to.not.have.property('total')
            expect(c001.customer.orders[0]).to.not.have.property('orderDate')
        })

        it('[4.2.5] B8 [cross-service expand: local → remote]: LightBookmarks → customer (excluding columns not in response)', async () => {
            const { data } = await GET`/odata/v4/consumer/LightBookmarks?$expand=customer`
            expect(data.value).to.have.length(2)
            const bm = data.value[0]
            expect(bm.customer).to.have.property('name')
            expect(bm.customer).to.have.property('city')
            expect(bm.customer).to.not.have.property('email')
            expect(bm.customer).to.not.have.property('modifiedAt')
        })
    })

    describe('$expand Scenario B: Composite keys + To-many', () => {

        it('[4.2.5] B9 [cross-service expand: local → remote]: AddressNotes → address (composite key, to-one with renames)', async () => {
            const { data } = await GET`/odata/v4/consumer/AddressNotes?$expand=address`
            expect(data.value).to.have.length(3)
            const note1 = data.value.find(n => n.address_custId === 'C001' && n.address_addressType === 'billing')
            expect(note1).to.exist
            expect(note1.address).to.have.property('custId', 'C001')
            expect(note1.address).to.have.property('addressType', 'billing')
            expect(note1.address).to.have.property('street', '123 Main St')
            expect(note1.address).to.have.property('zip', '10115')
            expect(note1.address).to.not.have.property('customerID')
            expect(note1.address).to.not.have.property('zipCode')
        })

        it('[4.2.5] B10 [cross-service expand: local → remote]: ProductCategories → products (to-many, batch-fetch + array grouping)', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$expand=products`
            expect(data.value).to.have.length(2)
            const electronics = data.value.find(c => c.category === 'Electronics')
            expect(electronics.products).to.be.an('array')
            expect(electronics.products.length).to.equal(3)
            expect(electronics.products[0]).to.have.property('productId')
            expect(electronics.products[0]).to.have.property('productName')
            expect(electronics.products[0]).to.have.property('unitPrice')
            const furniture = data.value.find(c => c.category === 'Furniture')
            expect(furniture.products).to.be.an('array')
            expect(furniture.products.length).to.equal(2)
        })

        it('[4.2.5] B11 [cross-service expand: local → remote]: ProductCategories → products with $top (per-parent limiting)', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$expand=products($top=1)`
            expect(data.value).to.have.length(2)
            const electronics = data.value.find(c => c.category === 'Electronics')
            expect(electronics.products.length).to.equal(1)
            const furniture = data.value.find(c => c.category === 'Furniture')
            expect(furniture.products.length).to.equal(1)
        })

        it('[4.2.5] B12 [cross-service expand: local → remote]: ProductCategories → products with $filter in expand', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$expand=products($filter=unitPrice gt 100)`
            const electronics = data.value.find(c => c.category === 'Electronics')
            expect(electronics.products.length).to.equal(1)
            expect(electronics.products[0]).to.have.property('productName', 'Laptop Pro')
        })

        it('[4.2.5] B13 [cross-service expand: local → remote]: ProductCategories with lambda any() on to-many remote association', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$filter=products/any(p:p/unitPrice gt 1000)`
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(1)
            expect(data.value[0]).to.have.property('category', 'Electronics')
        })

        it('[4.2.5] B14 [cross-service expand: local → remote]: ProductCategories with lambda any() — no matches', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$filter=products/any(p:p/unitPrice gt 99999)`
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(0)
        })
    })
})
