const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — CQL via application service
//
// `cds.ql` / `SELECT` tests against delegate entities. Covers `SELECT.one`,
// `.columns()`, `.where()` (basic + nested), `.orderBy()`, `.limit()`, entity-level renames,
// key shortcut, projection functions, `$expand` via CQL for all three expand scenarios,
// `cds.ql` tagged templates, and CQL via V2-backed entities.
// See: `CLAUDE.md` §CQL-on-OData limitations.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    describe('CQL SELECT via application service', () => {

        let cs, Customers, Products, Orders, Suppliers, Reviews, Bookmarks

        beforeAll(async () => {
            cs = await cds.connect.to('ConsumerService')
            ;({ Customers, Products, Orders, Suppliers, Reviews, Bookmarks } = cs.entities)
        })

        // ── Basic SELECT.from ────────────────────────────────────────────

        it('should return all customers via SELECT.from', async () => {
            const customers = await cs.run(SELECT.from(Customers))
            expect(customers).to.be.an('array').with.length(5)
            expect(customers[0]).to.have.property('ID')
            expect(customers[0]).to.have.property('name')
        })

        it('should return a single customer by key', async () => {
            const [customer] = await cs.run(SELECT.from(Customers).where({ ID: 'C001' }))
            expect(customer.ID).to.equal('C001')
            expect(customer.name).to.equal('Acme Corp')
        })

        it('should return products with renamed fields', async () => {
            const products = await cs.run(SELECT.from(Products))
            expect(products).to.be.an('array').with.length(5)
            expect(products[0]).to.have.property('productId')
            expect(products[0]).to.have.property('productName')
            expect(products[0]).to.have.property('unitPrice')
        })

        it('should support .where with renamed fields', async () => {
            const products = await cs.run(SELECT.from(Products).where({ unitPrice: { '>': 100 } }))
            expect(products.length).to.be.greaterThan(0)
            expect(products.every(p => p.unitPrice > 100)).to.be.true
        })

        // ── SELECT.one ──────────────────────────────────────────────────

        describe('SELECT.one', () => {

            it('should return a single object (not array) for SELECT.one', async () => {
                const customer = await cs.run(SELECT.one.from(Customers).where({ ID: 'C001' }))
                expect(customer).to.be.an('object').and.not.an('array')
                expect(customer.ID).to.equal('C001')
                expect(customer.name).to.equal('Acme Corp')
            })

            it('should return first matching product as object', async () => {
                const product = await cs.run(SELECT.one.from(Products))
                expect(product).to.be.an('object').and.not.an('array')
                expect(product).to.have.property('productId')
                expect(product).to.have.property('productName')
            })
        })

        // ── .columns() ─────────────────────────────────────────────────

        describe('.columns()', () => {

            it('should restrict returned fields via .columns()', async () => {
                const customers = await cs.run(SELECT.from(Customers).columns('ID', 'name'))
                expect(customers).to.have.length(5)
                expect(customers[0]).to.have.property('ID')
                expect(customers[0]).to.have.property('name')
                expect(customers[0]).to.not.have.property('city')
                expect(customers[0]).to.not.have.property('email')
            })

            it('should accept renamed field names in .columns()', async () => {
                const products = await cs.run(SELECT.from(Products).columns('productId', 'productName'))
                expect(products).to.have.length(5)
                expect(products[0]).to.have.property('productId')
                expect(products[0]).to.have.property('productName')
                expect(products[0]).to.not.have.property('unitPrice')
                expect(products[0]).to.not.have.property('category')
            })

            it('should accept an array of columns', async () => {
                const customers = await cs.run(SELECT.from(Customers).columns(['ID', 'name', 'city']))
                expect(customers).to.have.length(5)
                expect(customers[0]).to.have.property('ID')
                expect(customers[0]).to.have.property('name')
                expect(customers[0]).to.have.property('city')
                expect(customers[0]).to.not.have.property('email')
            })
        })

        // ── .where() — basic operators ──────────────────────────────────

        describe('.where() — basic operators', () => {

            it('should filter by equality', async () => {
                const customers = await cs.run(SELECT.from(Customers).where({ name: 'Acme Corp' }))
                expect(customers).to.have.length(1)
                expect(customers[0].ID).to.equal('C001')
            })

            it('should filter by >= comparison', async () => {
                const products = await cs.run(SELECT.from(Products).where({ unitPrice: { '>=': 449 } }))
                expect(products.length).to.equal(3)
                expect(products.every(p => p.unitPrice >= 449)).to.be.true
            })

            it('should filter by <= comparison', async () => {
                const products = await cs.run(SELECT.from(Products).where({ unitPrice: { '<=': 79.99 } }))
                expect(products.length).to.equal(2)
                expect(products.every(p => p.unitPrice <= 79.99)).to.be.true
            })

            it('should filter by != comparison', async () => {
                const products = await cs.run(SELECT.from(Products).where({ category: { '!=': 'Electronics' } }))
                expect(products.length).to.equal(2)
                expect(products.every(p => p.category === 'Furniture')).to.be.true
            })

            it.skip('should filter by like operator (not supported by OData remote services)', async () => {
                const customers = await cs.run(SELECT.from(Customers).where({ name: { like: '%Corp%' } }))
                expect(customers.length).to.be.greaterThan(0)
            })

            it('should filter by in operator', async () => {
                const customers = await cs.run(SELECT.from(Customers).where({ ID: { in: ['C001', 'C003'] } }))
                expect(customers).to.have.length(2)
                const ids = customers.map(c => c.ID).sort()
                expect(ids).to.deep.equal(['C001', 'C003'])
            })

            it('should filter by multiple conditions (implicit AND)', async () => {
                const customers = await cs.run(SELECT.from(Customers).where({ country: 'DE', city: 'Berlin' }))
                expect(customers).to.have.length(1)
                expect(customers[0].name).to.equal('Acme Corp')
            })

            it('should filter by renamed fields on entity-level rename (Suppliers)', async () => {
                const suppliers = await cs.run(SELECT.from(Suppliers).where({ companyName: 'Acme Corp' }))
                expect(suppliers).to.have.length(1)
                expect(suppliers[0].supplierId).to.equal('C001')
            })

            it('should filter by boolean field', async () => {
                const customers = await cs.run(SELECT.from(Customers).where({ blocked: true }))
                expect(customers).to.have.length(1)
                expect(customers[0].ID).to.equal('C003')
                expect(customers[0].name).to.equal('Initech Ltd')
            })
        })

        // ── .where() — nested / complex conditions ─────────────────────

        describe('.where() — nested / complex conditions', () => {

            it('should support OR via object nesting', async () => {
                const orders = await cs.run(SELECT.from(Orders).where({ status: 'shipped', or: { status: 'open' } }))
                expect(orders.length).to.equal(5)
                expect(orders.every(o => o.status === 'shipped' || o.status === 'open')).to.be.true
            })

            it('should support range-style conditions', async () => {
                const products = await cs.run(SELECT.from(Products).where({
                    unitPrice: { '>=': 100 }, and: { unitPrice: { '<=': 600 } }
                }))
                expect(products.length).to.equal(2)
                expect(products.every(p => p.unitPrice >= 100 && p.unitPrice <= 600)).to.be.true
            })

            it('should support tagged template string in .where()', async () => {
                const products = await cs.run(SELECT.from(Products).where`category = ${'Electronics'}`)
                expect(products.length).to.equal(3)
                expect(products.every(p => p.category === 'Electronics')).to.be.true
            })
        })

        // ── .orderBy() ─────────────────────────────────────────────────

        describe('.orderBy()', () => {

            it('should order ascending by default', async () => {
                const customers = await cs.run(SELECT.from(Customers).orderBy('name'))
                const names = customers.map(c => c.name)
                expect(names).to.deep.equal([...names].sort())
            })

            it('should order descending', async () => {
                const customers = await cs.run(SELECT.from(Customers).orderBy('name desc'))
                const names = customers.map(c => c.name)
                expect(names).to.deep.equal([...names].sort().reverse())
            })

            it('should order by renamed fields', async () => {
                const products = await cs.run(SELECT.from(Products).orderBy('productName'))
                const names = products.map(p => p.productName)
                expect(names).to.deep.equal([...names].sort())
            })

            it('should order by multiple columns', async () => {
                const products = await cs.run(SELECT.from(Products).orderBy('category', 'productName'))
                for (let i = 1; i < products.length; i++) {
                    const prev = products[i - 1], curr = products[i]
                    if (prev.category === curr.category) {
                        expect(prev.productName <= curr.productName).to.be.true
                    } else {
                        expect(prev.category <= curr.category).to.be.true
                    }
                }
            })
        })

        // ── .limit() ───────────────────────────────────────────────────

        describe('.limit()', () => {

            it('should limit the number of results', async () => {
                const customers = await cs.run(SELECT.from(Customers).orderBy('ID').limit(2))
                expect(customers).to.have.length(2)
                expect(customers[0].ID).to.equal('C001')
                expect(customers[1].ID).to.equal('C002')
            })

            it('should support limit with offset (pagination)', async () => {
                const page2 = await cs.run(SELECT.from(Customers).orderBy('ID').limit(2, 2))
                expect(page2).to.have.length(2)
                expect(page2[0].ID).to.equal('C003')
                expect(page2[1].ID).to.equal('C004')
            })
        })

        // ── Combined clauses ────────────────────────────────────────────

        describe('Combined clauses', () => {

            it('should chain .columns + .where + .orderBy + .limit', async () => {
                const products = await cs.run(
                    SELECT.from(Products)
                        .columns('productId', 'productName', 'unitPrice')
                        .where({ category: 'Electronics' })
                        .orderBy('unitPrice desc')
                        .limit(2)
                )
                expect(products).to.have.length(2)
                expect(products[0]).to.not.have.property('category')
                expect(products[0].unitPrice).to.be.greaterThanOrEqual(products[1].unitPrice)
                expect(products.every(p => p.productId !== undefined)).to.be.true
            })

            it('should translate renames across all clauses simultaneously', async () => {
                const products = await cs.run(
                    SELECT.from(Products)
                        .columns('productId', 'productName', 'unitPrice')
                        .where({ unitPrice: { '>=': 100 } })
                        .orderBy('unitPrice desc')
                )
                expect(products.length).to.equal(3)
                expect(products[0].unitPrice).to.be.greaterThanOrEqual(products[1].unitPrice)
                expect(products[1].unitPrice).to.be.greaterThanOrEqual(products[2].unitPrice)
                expect(products.every(p => p.unitPrice >= 100)).to.be.true
            })
        })

        // ── SELECT.distinct ────────────────────────────────────────────

        describe('SELECT.distinct', () => {

            it.skip('should return distinct values (not supported by OData remote services)', async () => {
                const categories = await cs.run(SELECT.distinct.from(Products).columns('category'))
                expect(categories).to.have.length(2)
            })
        })

        // ── Entity-level rename (Suppliers → remote Customers) ─────────

        describe('Entity-level rename (Suppliers)', () => {

            it('should query remote Customers through Suppliers projection', async () => {
                const suppliers = await cs.run(SELECT.from(Suppliers))
                expect(suppliers).to.have.length(5)
                expect(suppliers[0]).to.have.property('supplierId')
                expect(suppliers[0]).to.have.property('companyName')
                expect(suppliers[0]).to.have.property('headquarters')
                expect(suppliers[0]).to.have.property('region')
                expect(suppliers[0]).to.have.property('contactEmail')
            })

            it('should restrict columns on Suppliers', async () => {
                const suppliers = await cs.run(
                    SELECT.from(Suppliers).columns('supplierId', 'companyName', 'headquarters')
                )
                expect(suppliers).to.have.length(5)
                expect(suppliers[0]).to.have.property('supplierId')
                expect(suppliers[0]).to.have.property('companyName')
                expect(suppliers[0]).to.have.property('headquarters')
                expect(suppliers[0]).to.not.have.property('region')
                expect(suppliers[0]).to.not.have.property('contactEmail')
            })
        })

        // ── SELECT.from with key shortcut ───────────────────────────────

        describe('SELECT.from with key shortcut', () => {

            it('should return a single object via key shortcut', async () => {
                const customer = await cs.run(SELECT.from(Customers, 'C001'))
                expect(customer).to.be.an('object').and.not.an('array')
                expect(customer.ID).to.equal('C001')
                expect(customer.name).to.equal('Acme Corp')
            })

            it('should combine key shortcut with projection function', async () => {
                const product = await cs.run(
                    SELECT.from(Products, 'P001', p => { p.productId, p.productName })
                )
                expect(product).to.be.an('object').and.not.an('array')
                expect(product.productId).to.equal('P001')
                expect(product.productName).to.equal('Laptop Pro')
                expect(product).to.not.have.property('unitPrice')
            })
        })

        // ── Projection functions (arrow syntax) ─────────────────────────

        describe('Projection functions (arrow syntax)', () => {

            it('should select columns via projection function', async () => {
                const customers = await cs.run(SELECT.from(Customers, c => { c.ID, c.name }))
                expect(customers).to.be.an('array').with.length(5)
                expect(customers[0]).to.have.property('ID')
                expect(customers[0]).to.have.property('name')
                expect(customers[0]).to.not.have.property('city')
            })

            it('should select renamed fields via projection function', async () => {
                const orders = await cs.run(SELECT.from(Orders, o => { o.orderId, o.quantity, o.amount }))
                expect(orders).to.be.an('array').with.length(6)
                expect(orders[0]).to.have.property('orderId')
                expect(orders[0]).to.have.property('quantity')
                expect(orders[0]).to.have.property('amount')
                expect(orders[0]).to.not.have.property('status')
            })
        })

        // ── Expand via CQL — Scenario A (remote → remote) ──────────────

        describe('Expand via CQL — Scenario A (remote → remote)', () => {

            it('should expand to-one association (Orders → buyer)', async () => {
                const orders = await cs.run(
                    SELECT.from(Orders).columns(o => { o.orderId, o.buyer(b => { b.ID, b.name }) })
                )
                expect(orders).to.have.length(6)
                expect(orders[0]).to.have.property('buyer')
                expect(orders[0].buyer).to.have.property('ID')
                expect(orders[0].buyer).to.have.property('name')
            })

            it('should expand to-many association (Customers → orders)', async () => {
                const [customer] = await cs.run(
                    SELECT.from(Customers).where({ ID: 'C001' })
                        .columns(c => { c.ID, c.name, c.orders(o => { o.orderId, o.status }) })
                )
                expect(customer.ID).to.equal('C001')
                expect(customer.orders).to.be.an('array').with.length(2)
                expect(customer.orders[0]).to.have.property('orderId')
                expect(customer.orders[0]).to.have.property('status')
            })

            it('should expand multiple associations in one query', async () => {
                const orders = await cs.run(
                    SELECT.from(Orders).columns(o => {
                        o.orderId, o.buyer(b => { b.name }), o.item(i => { i.productName })
                    })
                )
                expect(orders).to.have.length(6)
                expect(orders[0]).to.have.property('buyer')
                expect(orders[0].buyer).to.have.property('name')
                expect(orders[0]).to.have.property('item')
                expect(orders[0].item).to.have.property('productName')
            })

            it('should support nested expand (Orders → buyer → orders)', async () => {
                const [order] = await cs.run(
                    SELECT.from(Orders).where({ orderId: 'O001' })
                        .columns(o => { o.orderId, o.buyer(b => { b.ID, b.name, b.orders(o2 => { o2.orderId }) }) })
                )
                expect(order.buyer).to.have.property('orders')
                expect(order.buyer.orders).to.be.an('array')
            })

            it('should expand with $select restriction on target', async () => {
                const orders = await cs.run(
                    SELECT.from(Orders).columns(o => { o.orderId, o.buyer(b => { b.ID, b.name }) })
                )
                const buyer = orders[0].buyer
                expect(buyer).to.have.property('ID')
                expect(buyer).to.have.property('name')
                expect(buyer).to.not.have.property('email')
            })
        })

        // ── Expand via CQL — Scenario B (local → remote) ───────────────

        describe('Expand via CQL — Scenario B (local → remote)', () => {

            it('should expand Reviews → product (local → delegate with renames)', async () => {
                const reviews = await cs.run(
                    SELECT.from(Reviews).columns(r => { r.ID, r.comment, r.product(p => { p.productId, p.productName }) })
                )
                expect(reviews).to.have.length(3)
                expect(reviews[0]).to.have.property('product')
                expect(reviews[0].product).to.have.property('productId')
                expect(reviews[0].product).to.have.property('productName')
            })

            it('should expand Bookmarks → customer (local → delegate wildcard)', async () => {
                const bookmarks = await cs.run(
                    SELECT.from(Bookmarks).columns(b => { b.ID, b.label, b.customer(c => { c.ID, c.name }) })
                )
                expect(bookmarks).to.have.length(3)
                expect(bookmarks[0]).to.have.property('customer')
                expect(bookmarks[0].customer).to.have.property('ID')
                expect(bookmarks[0].customer).to.have.property('name')
            })
        })

        // ── Expand via CQL — Scenario C (remote → local) ───────────────

        describe('Expand via CQL — Scenario C (remote → local)', () => {

            it('should expand Customers → bookmarks (remote → local to-many)', async () => {
                const customers = await cs.run(
                    SELECT.from(Customers).where({ ID: 'C001' })
                        .columns(c => { c.ID, c.name, c.bookmarks(b => { b.label }) })
                )
                expect(customers).to.have.length(1)
                expect(customers[0].bookmarks).to.be.an('array').with.length(2)
                expect(customers[0].bookmarks[0]).to.have.property('label')
            })

            it('should expand with key shortcut (single customer)', async () => {
                const customer = await cs.run(
                    SELECT.from(Customers, 'C001', c => { c.ID, c.name, c.bookmarks(b => { b.label }) })
                )
                expect(customer).to.be.an('object').and.not.an('array')
                expect(customer.ID).to.equal('C001')
                expect(customer.bookmarks).to.be.an('array').with.length(2)
                const labels = customer.bookmarks.map(b => b.label).sort()
                expect(labels).to.deep.equal(['Favorite supplier', 'VIP customer'])
            })
        })

        // ── cds.ql tagged template literals ─────────────────────────────

        describe('cds.ql tagged template literals', () => {

            it('should construct and run a basic SELECT via cds.ql', async () => {
                const q = cds.ql`SELECT from ${Customers} { ID, name }`
                const customers = await cs.run(q)
                expect(customers).to.be.an('array').with.length(5)
                expect(customers[0]).to.have.property('ID')
                expect(customers[0]).to.have.property('name')
                expect(customers[0]).to.not.have.property('city')
            })

            it('should support filters via cds.ql template interpolation', async () => {
                const q = cds.ql`SELECT from ${Products} { productId, productName, category } where category = ${'Electronics'}`
                const products = await cs.run(q)
                expect(products.length).to.equal(3)
                expect(products.every(p => p.category === 'Electronics')).to.be.true
            })

            it('should support ordering via cds.ql', async () => {
                const q = cds.ql`SELECT from ${Customers} { ID, name } order by name`
                const customers = await cs.run(q)
                const names = customers.map(c => c.name)
                expect(names).to.deep.equal([...names].sort())
            })

            it('should support expand via postfix projection in cds.ql', async () => {
                const q = cds.ql`SELECT from ${Orders} { orderId, buyer { ID, name } }`
                const orders = await cs.run(q)
                expect(orders).to.have.length(6)
                expect(orders[0]).to.have.property('buyer')
                expect(orders[0].buyer).to.have.property('ID')
                expect(orders[0].buyer).to.have.property('name')
            })

            it('should support combined filter + ordering via cds.ql', async () => {
                const q = cds.ql`SELECT from ${Products} { productId, productName, unitPrice } where unitPrice >= ${100} order by unitPrice desc`
                const products = await cs.run(q)
                expect(products.length).to.equal(3)
                expect(products.every(p => p.unitPrice >= 100)).to.be.true
                expect(products[0].unitPrice).to.be.greaterThanOrEqual(products[1].unitPrice)
            })
        })

        // ── CQL via V2-backed entities ──────────────────────────────────

        describe('CQL via V2-backed entities', () => {

            let CustomersV2, ProductsV2, OrdersV2, SuppliersV2

            beforeAll(() => {
                ;({ CustomersV2, ProductsV2, OrdersV2, SuppliersV2 } = cs.entities)
            })

            it('should return all customers via V2-backed entity', async () => {
                const customers = await cs.run(SELECT.from(CustomersV2))
                expect(customers).to.be.an('array').with.length(5)
                expect(customers[0]).to.have.property('ID')
                expect(customers[0]).to.have.property('name')
            })

            it('should return products with renamed fields via V2', async () => {
                const products = await cs.run(SELECT.from(ProductsV2))
                expect(products).to.be.an('array').with.length(5)
                expect(products[0]).to.have.property('productId')
                expect(products[0]).to.have.property('productName')
            })

            it('should support .where on V2-backed entity', async () => {
                const products = await cs.run(SELECT.from(ProductsV2).where({ unitPrice: { '>': 100 } }))
                expect(products.length).to.be.greaterThan(0)
                expect(products.every(p => Number(p.unitPrice) > 100)).to.be.true
            })

            it('should support .orderBy on V2-backed entity', async () => {
                const products = await cs.run(SELECT.from(ProductsV2).orderBy('productName'))
                const names = products.map(p => p.productName)
                expect(names).to.deep.equal([...names].sort())
            })

            it('should return orders with renamed fields via V2', async () => {
                const orders = await cs.run(SELECT.from(OrdersV2))
                expect(orders).to.be.an('array').with.length(6)
                expect(orders[0]).to.have.property('orderId')
                expect(orders[0]).to.have.property('quantity')
                expect(orders[0]).to.have.property('amount')
                expect(orders[0]).to.have.property('status')
            })

            it('should return suppliers via V2 entity-level rename', async () => {
                const suppliers = await cs.run(SELECT.from(SuppliersV2))
                expect(suppliers).to.be.an('array').with.length(5)
                expect(suppliers[0]).to.have.property('supplierId')
                expect(suppliers[0]).to.have.property('companyName')
                expect(suppliers[0]).to.have.property('headquarters')
            })

            it('should support combined clauses on V2-backed entity', async () => {
                const products = await cs.run(
                    SELECT.from(ProductsV2)
                        .columns('productId', 'productName', 'unitPrice')
                        .where({ category: 'Electronics' })
                        .orderBy('unitPrice desc')
                        .limit(2)
                )
                expect(products).to.have.length(2)
                expect(products[0]).to.not.have.property('category')
                expect(Number(products[0].unitPrice)).to.be.greaterThanOrEqual(Number(products[1].unitPrice))
            })

            it('should expand V2 Orders → buyer (Scenario A via CQL)', async () => {
                const orders = await cs.run(
                    SELECT.from(OrdersV2).columns(o => { o.orderId, o.buyer(b => { b.ID, b.name }) })
                )
                expect(orders).to.have.length(6)
                expect(orders[0]).to.have.property('buyer')
                expect(orders[0].buyer).to.have.property('ID')
                expect(orders[0].buyer).to.have.property('name')
            })
        })
    })
})
