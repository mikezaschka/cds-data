const cds = require('@sap/cds')
const https = require('https')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

describe('Northwind External Service Delegation', () => {

    const base = '/odata/v4/consumer'
    let northwindAvailable = true

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])

        northwindAvailable = await new Promise(resolve => {
            const req = https.get('https://services.odata.org/v4/northwind/northwind.svc/', res => {
                res.resume()
                resolve(res.statusCode === 200)
            })
            req.on('error', () => resolve(false))
            req.setTimeout(5000, () => { req.destroy(); resolve(false) })
        })
        if (!northwindAvailable) {
            // eslint-disable-next-line no-console
            console.warn('Northwind service unreachable — skipping Northwind tests')
        }
    }, 30000)

    const { GET, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    function skipIfUnavailable() {
        if (!northwindAvailable) {
            return true
        }
        return false
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Basic delegation — Northwind V4 ─────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Basic delegation — Northwind V4 Products (renames)', () => {

        it('should return products with renamed fields from Northwind V4', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts?$top=5`)
            expect(data.value).to.be.an('array').with.length(5)
            expect(data.value[0]).to.have.property('productId')
            expect(data.value[0]).to.have.property('productName')
            expect(data.value[0]).to.have.property('unitPrice')
            expect(data.value[0]).to.have.property('discontinued')
        })

        it('should return a single product by key', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(1)`)
            expect(data.productId).to.equal(1)
            expect(data.productName).to.equal('Chai')
        })

        it('should filter by renamed field (unitPrice)', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts?$filter=unitPrice gt 50`)
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(p => p.unitPrice > 50)).to.be.true
        })

        it('should order by renamed field (productName)', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts?$orderby=productName&$top=10`)
            const names = data.value.map(p => p.productName)
            expect(names).to.deep.equal([...names].sort())
        })

        it('should support $top and $skip', async () => {
            if (skipIfUnavailable()) return
            const page1 = await GET(`${base}/NwProducts?$orderby=productId&$top=3`)
            const page2 = await GET(`${base}/NwProducts?$orderby=productId&$top=3&$skip=3`)
            expect(page1.data.value).to.have.length(3)
            expect(page2.data.value).to.have.length(3)
            expect(page1.data.value[0].productId).to.not.equal(page2.data.value[0].productId)
        })

        it('should support $count', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts?$count=true&$top=5`)
            expect(data['@odata.count']).to.be.greaterThan(5)
        })
    })

    describe('Basic delegation — Northwind V4 Categories (wildcard-like)', () => {

        it('should return categories from Northwind V4', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCategories`)
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value[0]).to.have.property('categoryId')
            expect(data.value[0]).to.have.property('categoryName')
            expect(data.value[0]).to.have.property('description')
        })

        it('should return a single category by key', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCategories(1)`)
            expect(data.categoryId).to.equal(1)
            expect(data.categoryName).to.equal('Beverages')
        })
    })

    describe('Basic delegation — Northwind V4 Customers (renames)', () => {

        it('should return customers with renamed fields', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCustomers?$top=5`)
            expect(data.value).to.have.length(5)
            expect(data.value[0]).to.have.property('customerId')
            expect(data.value[0]).to.have.property('companyName')
            expect(data.value[0]).to.have.property('contactName')
            expect(data.value[0]).to.have.property('city')
            expect(data.value[0]).to.have.property('country')
        })

        it('should filter customers by country', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCustomers?$filter=country eq 'Germany'`)
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(c => c.country === 'Germany')).to.be.true
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── $expand Scenario A — remote-to-remote (V4) ─────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('$expand Scenario A — remote-to-remote (V4)', () => {

        it('[4.2.6] A1 [delegated expand]: should expand NwProducts -> category (to-one)', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(1)?$expand=category`)
            expect(data.productId).to.equal(1)
            expect(data.productName).to.equal('Chai')
            expect(data.category).to.be.an('object')
            expect(data.category.categoryId).to.equal(1)
            expect(data.category.categoryName).to.equal('Beverages')
        })

        it('[4.2.6] A2 [delegated expand]: should expand NwCategories -> products (to-many)', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCategories(1)?$expand=products`)
            expect(data.categoryId).to.equal(1)
            expect(data.categoryName).to.equal('Beverages')
            expect(data.products).to.be.an('array')
            expect(data.products.length).to.be.greaterThan(0)
            expect(data.products[0]).to.have.property('productId')
            expect(data.products[0]).to.have.property('productName')
        })

        it('[4.2.6] A3 [delegated expand]: should expand with $select on expanded target', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(1)?$expand=category($select=categoryName)`)
            expect(data.category).to.have.property('categoryName')
            expect(data.category).to.not.have.property('description')
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── $expand Scenario B — local-to-remote (V4) ──────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('$expand Scenario B — local-to-remote (V4)', () => {

        it('[4.2.5] B1 [cross-service expand: local → remote]: should expand NwProductNotes -> product (local -> Northwind)', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProductNotes?$expand=product`)
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('product')
            expect(data.value[0].product).to.have.property('productId')
            expect(data.value[0].product).to.have.property('productName')
        })

        it('[4.2.5] B2 [cross-service expand: local → remote]: should expand with $select on Northwind remote target', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProductNotes?$expand=product($select=productName)`)
            expect(data.value).to.have.length(3)
            expect(data.value[0].product).to.have.property('productName')
            expect(data.value[0].product).to.not.have.property('unitPrice')
        })

        it('[4.2.5] B3 [cross-service expand: local → remote]: should batch-fetch products for notes referencing same product', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProductNotes?$expand=product`)
            const notesForProduct1 = data.value.filter(n => n.product && n.product.productId === 1)
            expect(notesForProduct1).to.have.length(2)
            expect(notesForProduct1[0].product.productName).to.equal('Chai')
            expect(notesForProduct1[1].product.productName).to.equal('Chai')
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── $expand Scenario C — remote-to-local (V4) ──────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('$expand Scenario C — remote-to-local (V4)', () => {

        it('[4.2.5] C1 [cross-service expand: remote → local]: should expand NwProducts -> notes (Northwind -> local backlink)', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(1)?$expand=notes`)
            expect(data.productId).to.equal(1)
            expect(data.notes).to.be.an('array').with.length(2)
            expect(data.notes[0]).to.have.property('note')
            expect(data.notes[0]).to.have.property('author')
        })

        it('[4.2.5] C2 [cross-service expand: remote → local]: should return empty array when product has no local notes', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(3)?$expand=notes`)
            expect(data.productId).to.equal(3)
            expect(data.notes).to.be.an('array').with.length(0)
        })

        it('[4.2.5] C3 [cross-service expand: remote → local]: should expand notes with $filter', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(1)?$expand=notes($filter=author eq 'Alice')`)
            expect(data.notes).to.be.an('array').with.length(1)
            expect(data.notes[0].author).to.equal('Alice')
        })

        it('[4.2.5] C4 [cross-service expand: remote → local]: should expand notes with $orderby', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwProducts(1)?$expand=notes($orderby=author)`)
            expect(data.notes).to.have.length(2)
            const authors = data.notes.map(n => n.author)
            expect(authors).to.deep.equal([...authors].sort())
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Northwind V2 delegation ────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Northwind V2 delegation', () => {

        it('should return customers with renamed fields from Northwind V2', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCustomersV2?$top=5`)
            expect(data.value).to.have.length(5)
            expect(data.value[0]).to.have.property('customerId')
            expect(data.value[0]).to.have.property('companyName')
            expect(data.value[0]).to.have.property('contactName')
            expect(data.value[0]).to.have.property('city')
            expect(data.value[0]).to.have.property('country')
        })

        it('should filter V2 customers by country', async () => {
            if (skipIfUnavailable()) return
            const { data } = await GET(`${base}/NwCustomersV2?$filter=country eq 'Germany'`)
            expect(data.value.length).to.be.greaterThan(0)
            expect(data.value.every(c => c.country === 'Germany')).to.be.true
        })

        it('should return consistent data between V4 and V2', async () => {
            if (skipIfUnavailable()) return
            const v4 = await GET(`${base}/NwCustomers?$orderby=customerId&$top=5`)
            const v2 = await GET(`${base}/NwCustomersV2?$orderby=customerId&$top=5`)
            expect(v4.data.value).to.have.length(5)
            expect(v2.data.value).to.have.length(5)
            const v4Ids = v4.data.value.map(c => c.customerId).sort()
            const v2Ids = v2.data.value.map(c => c.customerId).sort()
            expect(v4Ids).to.deep.equal(v2Ids)
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Mixed: Northwind + local providers ─────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Mixed: Northwind + local providers in same consumer', () => {

        it('should query Northwind Products and local Products in same test', async () => {
            if (skipIfUnavailable()) return
            const nw = await GET(`${base}/NwProducts?$top=3`)
            const local = await GET(`${base}/Products`)
            expect(nw.data.value).to.have.length(3)
            expect(local.data.value).to.have.length(5)
            expect(nw.data.value[0]).to.have.property('productId')
            expect(local.data.value[0]).to.have.property('productId')
        })

        it('should query Northwind Customers and local Customers independently', async () => {
            if (skipIfUnavailable()) return
            const nw = await GET(`${base}/NwCustomers?$top=3`)
            const local = await GET(`${base}/Customers`)
            expect(nw.data.value).to.have.length(3)
            expect(local.data.value).to.have.length(5)
            expect(nw.data.value[0]).to.have.property('customerId')
            expect(local.data.value[0]).to.have.property('ID')
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── CQL via application service ────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('CQL SELECT via application service (Northwind)', () => {

        let cs, NwProducts, NwProductNotes

        beforeAll(async () => {
            cs = await cds.connect.to('ConsumerService')
            ;({ NwProducts, NwProductNotes } = cs.entities)
        })

        it('should return products via SELECT.from', async () => {
            if (skipIfUnavailable()) return
            const products = await cs.run(SELECT.from(NwProducts).limit(5))
            expect(products).to.be.an('array').with.length(5)
            expect(products[0]).to.have.property('productId')
            expect(products[0]).to.have.property('productName')
            expect(products[0]).to.have.property('unitPrice')
        })

        it('should filter with renamed fields via CQL', async () => {
            if (skipIfUnavailable()) return
            const products = await cs.run(SELECT.from(NwProducts).where({ unitPrice: { '>': 50 } }).limit(10))
            expect(products.length).to.be.greaterThan(0)
            expect(products.every(p => p.unitPrice > 50)).to.be.true
        })

        it('should expand Scenario A via CQL (Products -> category)', async () => {
            if (skipIfUnavailable()) return
            const [product] = await cs.run(
                SELECT.from(NwProducts).where({ productId: 1 })
                    .columns(p => { p.productId, p.productName, p.category(c => { c.categoryId, c.categoryName }) })
            )
            expect(product.productId).to.equal(1)
            expect(product.category).to.be.an('object')
            expect(product.category.categoryName).to.equal('Beverages')
        })

        it('should expand Scenario B via CQL (NwProductNotes -> product)', async () => {
            if (skipIfUnavailable()) return
            const notes = await cs.run(
                SELECT.from(NwProductNotes).columns(n => { n.ID, n.note, n.product(p => { p.productId, p.productName }) })
            )
            expect(notes).to.have.length(3)
            expect(notes[0]).to.have.property('product')
            expect(notes[0].product).to.have.property('productName')
        }, 15000)

        it('should expand Scenario C via CQL (NwProducts -> notes)', async () => {
            if (skipIfUnavailable()) return
            const [product] = await cs.run(
                SELECT.from(NwProducts).where({ productId: 1 })
                    .columns(p => { p.productId, p.productName, p.notes(n => { n.note, n.author }) })
            )
            expect(product.productId).to.equal(1)
            expect(product.notes).to.be.an('array').with.length(2)
        })
    })
})
