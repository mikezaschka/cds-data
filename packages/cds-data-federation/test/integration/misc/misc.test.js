const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — navigation, multi-provider, discovery
//
// V4-only tests that don't fit into a single scenario bucket:
// - `$filter` with navigation paths (assoc rename translation).
// - Lambda operators (delegated + remote → local via `resolveLocalLambdaFilters`).
// - Multi-provider mashup (Warehouses + StockLevels from inventory provider).
// - Mixed V4 + V2 in the same test.
// - `$apply` / `$search` discovery.
// - Server-driven paging when the remote caps below the requested `$top`.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('$filter with navigation paths (V4)', () => {

        it('should filter orders by buyer name (renamed assoc: buyer → customer)', async () => {
            const { data } = await GET`/odata/v4/consumer/Orders?$filter=buyer/name eq 'Acme Corp'`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(o => o.buyer_ID === 'C001')).to.be.true
        })

        it('should filter orders by buyer country', async () => {
            const { data } = await GET`/odata/v4/consumer/Orders?$filter=buyer/country eq 'DE'`
            const validCustomerIds = ['C001', 'C002']
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(o => validCustomerIds.includes(o.buyer_ID))).to.be.true
        })

        it('should filter with contains() on navigation path', async () => {
            const { data } = await GET(`/odata/v4/consumer/Orders?$filter=contains(buyer/name,'Corp')`)
            expect(data.value.length).to.be.greaterThan(0)
            const corpCustomerIds = ['C001', 'C004']
            expect(data.value.every(o => corpCustomerIds.includes(o.buyer_ID))).to.be.true
        })

        it('should filter by boolean on navigation path', async () => {
            const { data } = await GET`/odata/v4/consumer/Orders?$filter=buyer/blocked eq true`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(o => o.buyer_ID === 'C003')).to.be.true
        })

        it('should combine navigation filter with local field filter', async () => {
            const { data } = await GET`/odata/v4/consumer/Orders?$filter=buyer/country eq 'DE' and status eq 'shipped'`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(o => o.status === 'shipped')).to.be.true
            const validCustomerIds = ['C001', 'C002']
            expect(data.value.every(o => validCustomerIds.includes(o.buyer_ID))).to.be.true
        })

        it('should filter through renamed assoc to non-renamed target field', async () => {
            const { data } = await GET`/odata/v4/consumer/Orders?$filter=item/category eq 'Electronics'`
            expect(data.value.length).to.be.greaterThan(0)
        })
    })

    describe('Lambda operators (V4)', () => {

        it('should filter with any() on to-many association', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers?$filter=orders/any(o:o/status eq 'shipped')`
            expect(data.value.length).to.be.greaterThan(0)
            const expectedIds = ['C001', 'C002', 'C005']
            expect(data.value.every(c => expectedIds.includes(c.ID))).to.be.true
        })

        it('should filter with all() on to-many association', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers?$filter=orders/all(o:o/status ne 'cancelled')`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(c => c.ID !== 'C003')).to.be.true
        })

        it('Scenario C: lambda on remote→local collection (bookmarks)', async () => {
            // bookmarks is a LOCAL association on the delegated Customers entity.
            // The plugin's resolveLocalLambdaFilters() pre-resolves the lambda by
            // querying the local DB for matching customer IDs, then replaces the
            // lambda with a simple `ID in [values]` filter before forwarding to remote.
            const { data } = await GET`/odata/v4/consumer/Customers?$filter=bookmarks/any(b:b/label eq 'VIP customer')`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.some(c => c.ID === 'C001')).to.be.true
        })

        it.skip('Scenario B: lambda on local→remote collection (requires query splitting)', async () => {
            // Filtering a local entity by a to-many association to remote entities
            // using any()/all() lambda operators requires cross-service query splitting.
            // This is harder than simple navigation path filters because CAP parses
            // lambdas into `exists` expressions rather than multi-segment refs.
        })
    })

    describe('Multi-provider: Inventory Service (Warehouses — wildcard)', () => {

        it('should return all warehouses from inventory provider', async () => {
            const { data } = await GET`/odata/v4/consumer/Warehouses`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('ID')
            expect(data.value[0]).to.have.property('name')
            expect(data.value[0]).to.have.property('location')
            expect(data.value[0]).to.have.property('capacity')
        })

        it('should return a single warehouse by key', async () => {
            const { data } = await GET`/odata/v4/consumer/Warehouses('W001')`
            expect(data.ID).to.equal('W001')
            expect(data.name).to.equal('Central Europe Hub')
        })

        it('should filter warehouses', async () => {
            const { data } = await GET`/odata/v4/consumer/Warehouses?$filter=capacity gt 9000`
            expect(data.value).to.have.length(2)
        })

        it('should handle $count on warehouses', async () => {
            const { data } = await GET`/odata/v4/consumer/Warehouses?$count=true`
            expect(data['@odata.count']).to.equal(3)
        })
    })

    describe('Multi-provider: Inventory Service (StockLevels — renames)', () => {

        it('should return stock levels with renamed fields', async () => {
            const { data } = await GET`/odata/v4/consumer/StockLevels`
            expect(data.value).to.have.length(6)
            expect(data.value[0]).to.have.property('stockId')
            expect(data.value[0]).to.have.property('productRef')
            expect(data.value[0]).to.have.property('onHand')
            expect(data.value[0]).to.have.property('lastCounted')
        })

        it('should filter by renamed field (onHand → quantity)', async () => {
            const { data } = await GET`/odata/v4/consumer/StockLevels?$filter=onHand gt 100`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(s => s.onHand > 100)).to.be.true
        })

        it('should order by renamed field', async () => {
            const { data } = await GET`/odata/v4/consumer/StockLevels?$orderby=onHand desc`
            const quantities = data.value.map(s => s.onHand)
            for (let i = 0; i < quantities.length - 1; i++) {
                expect(quantities[i]).to.be.greaterThanOrEqual(quantities[i + 1])
            }
        })
    })

    describe('Multi-provider: Simultaneous queries to both providers', () => {

        it('should query products (Provider) and warehouses (Inventory) in same test', async () => {
            const products = await GET`/odata/v4/consumer/Products`
            const warehouses = await GET`/odata/v4/consumer/Warehouses`
            expect(products.data.value).to.have.length(5)
            expect(warehouses.data.value).to.have.length(3)
        })
    })

    describe('Mixed protocol (V4 and V2 in same test)', () => {

        it('should query same data via V4 and V2 and get consistent results', async () => {
            const v4 = await GET`/odata/v4/consumer/Customers`
            const v2 = await GET`/odata/v4/consumer/CustomersV2`
            expect(v4.data.value).to.have.length(v2.data.value.length)
            const v4Ids = v4.data.value.map(c => c.ID).sort()
            const v2Ids = v2.data.value.map(c => c.ID).sort()
            expect(v4Ids).to.deep.equal(v2Ids)
        })

        it('should return same renamed product data via V4 and V2', async () => {
            const v4 = await GET`/odata/v4/consumer/Products('P001')`
            const v2 = await GET`/odata/v4/consumer/ProductsV2('P001')`
            expect(v4.data.productId).to.equal(v2.data.productId)
            expect(v4.data.productName).to.equal(v2.data.productName)
            expect(Number(v4.data.unitPrice)).to.equal(Number(v2.data.unitPrice))
        })
    })

    describe('$apply and $search — discovery', () => {

        it.skip('should support $apply groupby on delegated entities (not supported — CAP rejects .groupBy for remote services)', async () => {
            // Discovery result: CAP throws "Feature not supported: SELECT statement with .groupBy"
            // when $apply is used on a remote service. CAP's cqn2odata serializer does not translate
            // $apply/groupby to OData $apply. Same class of limitation as `like` and `distinct`.
            const { data } = await GET`/odata/v4/consumer/Products?$apply=groupby((category),aggregate($count as count))`
            expect(data.value).to.be.an('array')
        })

        it('should support $search on delegated entities', async () => {
            // Discovery result: $search IS forwarded to the remote OData service via
            // remote.run(). CAP searches all string columns by default (no @cds.search needed).
            const { data } = await GET`/odata/v4/consumer/Customers?$search=Acme`
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(c => JSON.stringify(c).includes('Acme'))).to.be.true
        })
    })

    describe('Server-driven paging (remote caps at 2 rows/page)', () => {

        it('should return all 5 rows when client asks for more than the remote per-page cap', async () => {
            const { data } = await GET`/odata/v4/consumer/PagedCustomers?$top=10`
            expect(data.value).to.have.length(5)
            const ids = data.value.map(r => r.ID).sort()
            expect(ids).to.deep.equal(['C001', 'C002', 'C003', 'C004', 'C005'])
        })

        it('should return all rows when client does not supply $top', async () => {
            const { data } = await GET`/odata/v4/consumer/PagedCustomers`
            expect(data.value).to.have.length(5)
        })

        it('should honor client $top when smaller than the remote per-page cap', async () => {
            const { data } = await GET`/odata/v4/consumer/PagedCustomers?$top=1`
            expect(data.value).to.have.length(1)
        })

        it('should honor client $top when larger than the cap but smaller than the total', async () => {
            const { data } = await GET`/odata/v4/consumer/PagedCustomers?$top=3`
            expect(data.value).to.have.length(3)
        })

        it('should report the correct total @odata.count even when remote paginates', async () => {
            const { data } = await GET`/odata/v4/consumer/PagedCustomers?$count=true&$top=10`
            expect(data['@odata.count']).to.equal(5)
            expect(data.value).to.have.length(5)
        })
    })
})
