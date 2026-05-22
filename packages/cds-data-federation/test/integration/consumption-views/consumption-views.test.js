const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — consumption view patterns
//
// CDS projection features exercised via delegation: `excluding`, static `where`,
// flatten (OData-limited), higher-level flattened views, cross-service path expressions.
// See: `spec/concepts/consumption-views.md`.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('Consumption view patterns', () => {

        describe('Excluding columns (CustomersLight)', () => {

            it('should return customers without excluded fields (email, modifiedAt)', async () => {
                const { data } = await GET`/odata/v4/consumer/CustomersLight`
                expect(data.value).to.have.length(5)
                expect(data.value[0]).to.have.property('ID')
                expect(data.value[0]).to.have.property('name')
                expect(data.value[0]).to.have.property('city')
                expect(data.value[0]).to.have.property('country')
                expect(data.value[0]).to.not.have.property('email')
                expect(data.value[0]).to.not.have.property('modifiedAt')
            })

            it('should return a single customer by key without excluded fields', async () => {
                const { data } = await GET`/odata/v4/consumer/CustomersLight('C001')`
                expect(data.ID).to.equal('C001')
                expect(data.name).to.equal('Acme Corp')
                expect(data).to.not.have.property('email')
                expect(data).to.not.have.property('modifiedAt')
            })

            it('should filter on non-excluded fields', async () => {
                const { data } = await GET`/odata/v4/consumer/CustomersLight?$filter=country eq 'DE'`
                expect(data.value).to.have.length(2)
            })

            it('should support $count with excluding', async () => {
                const { data } = await GET`/odata/v4/consumer/CustomersLight?$count=true`
                expect(data['@odata.count']).to.equal(5)
            })
        })

        describe('Where condition (ActiveCustomers)', () => {
            it('should only return non-blocked customers', async () => {
                const { data } = await GET`/odata/v4/consumer/ActiveCustomers`
                expect(data.value.length).to.equal(4)
                expect(data.value.every(c => c.blocked === false)).to.be.true
            })

            it('should return correct $count respecting where condition', async () => {
                const { data } = await GET`/odata/v4/consumer/ActiveCustomers?$count=true`
                expect(data['@odata.count']).to.equal(4)
            })

            it('should support $orderby combined with static where', async () => {
                const { data } = await GET`/odata/v4/consumer/ActiveCustomers?$orderby=name asc`
                expect(data.value.length).to.equal(4)
                const names = data.value.map(c => c.name)
                expect(names).to.deep.equal([...names].sort())
            })

            it('should combine client $filter with static where', async () => {
                const { data } = await GET`/odata/v4/consumer/ActiveCustomers?$filter=country eq 'DE'`
                expect(data.value.length).to.equal(2)
                expect(data.value.every(c => c.blocked === false && c.country === 'DE')).to.be.true
            })
        })

        describe('Where + renames (ElectronicsProducts)', () => {
            it('should only return Electronics products', async () => {
                const { data } = await GET`/odata/v4/consumer/ElectronicsProducts`
                expect(data.value.length).to.equal(3)
            })

            it('should combine client $filter with static where on non-projected field', async () => {
                const { data } = await GET`/odata/v4/consumer/ElectronicsProducts?$filter=unitPrice gt 100`
                expect(data.value.length).to.equal(1)
                expect(data.value[0].productName).to.equal('Laptop Pro')
            })

            it('should NOT return excluded columns (category, stock, modifiedAt not projected)', async () => {
                const { data } = await GET`/odata/v4/consumer/ElectronicsProducts`
                expect(data.value[0]).to.have.property('productId')
                expect(data.value[0]).to.have.property('productName')
                expect(data.value[0]).to.have.property('unitPrice')
                expect(data.value[0]).to.not.have.property('category')
                expect(data.value[0]).to.not.have.property('stock')
                expect(data.value[0]).to.not.have.property('modifiedAt')
            })

            it('should return correct $count respecting where condition', async () => {
                const { data } = await GET`/odata/v4/consumer/ElectronicsProducts?$count=true`
                expect(data['@odata.count']).to.equal(3)
            })

            it('should support $orderby with static where + renames', async () => {
                const { data } = await GET`/odata/v4/consumer/ElectronicsProducts?$orderby=unitPrice desc`
                expect(data.value.length).to.equal(3)
                const prices = data.value.map(p => p.unitPrice)
                expect(prices[0]).to.be.greaterThanOrEqual(prices[1])
                expect(prices[1]).to.be.greaterThanOrEqual(prices[2])
            })
        })

        describe('Flatten association (OrderFlat — OData limitation)', () => {
            // Service Integration docs: "OData doesn't support denormalization like we used for
            // the Flights view. This works here because xflights also serves the
            // HCQL protocol, which is CAP's native protocol."
            //
            // Path expressions like `customer.name as buyerName` work with HCQL
            // but OData cannot express flattened associations in $select/$expand.

            it.skip('should return flattened fields from associations (blocked by OData protocol limitation)', async () => {
                const { data } = await GET`/odata/v4/consumer/OrderFlat`
                expect(data.value[0]).to.have.property('buyerName')
                expect(data.value[0]).to.have.property('itemName')
            })
        })

        describe('Higher-level flattened view (OrderSummary — OData limitation)', () => {
            // 2-level projection chain: OrderSummary → Orders → remote.Orders
            // Path expressions buyer.name and item.name must resolve through the chain.
            // Same OData protocol limitation as OrderFlat.

            it.skip('should resolve path expressions through 2-level projection chain (blocked by OData protocol limitation)', async () => {
                const { data } = await GET`/odata/v4/consumer/OrderSummary`
                expect(data.value[0]).to.have.property('buyerName')
                expect(data.value[0]).to.have.property('itemName')
            })
        })

        describe('Local view navigating to remote (ReviewsEnriched — cross-service limitation)', () => {
            // Reviews is local, product is remote (delegate).
            // product.productName navigates from local → remote → field.
            // Without data federation (replication), this cross-service path cannot be resolved.

            it.skip('should resolve cross-service path expressions (requires data federation)', async () => {
                const { data } = await GET`/odata/v4/consumer/ReviewsEnriched`
                expect(data.value[0]).to.have.property('productName')
                expect(data.value[0]).to.have.property('productCategory')
            })
        })
    })
})
