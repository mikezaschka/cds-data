const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — basic queries (parameterised V4 + V2)
//
// Parameterised query capability tests. Runs the same suite against OData V4 and V2.
// Covers: wildcard, renames, `$filter`, `$orderby`, `$select`, `$top`, `$skip`, `$count`,
// scenario "Delegated expand" (A1–A7 — CAP-native same-service `$expand`), combined parameters, and error propagation.
// See: `spec/concepts/cross-service-scenarios.md#delegated-expand`.

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    function describeQueryCapabilities(protocol, entities) {
        const {
            Customers,
            Products,
            Orders,
            ShippedOrders,
            ShippedOrdersScoped,
            ActiveCustomersWithPurchases,
            Suppliers,
            isV2,
        } = entities
        // cds 10 defaults `ieee754compatible: true` (and `count_as_string: true`),
        // so Decimal/Int64 and `@odata.count` arrive as JSON strings on V4 too —
        // not just V2. Coerce unconditionally to stay compatible with cds 9 and 10.
        const num = v => Number(v)
        const base = '/odata/v4/consumer'

        describe(protocol, () => {

            // ── Core delegation ────────────────────────────────────────────

            describe('Basic READ (wildcard)', () => {

                it('should return all customers from remote service', async () => {
                    const { data } = await GET(`${base}/${Customers}`)
                    expect(data.value).to.have.length(5)
                    expect(data.value[0]).to.have.property('ID')
                    expect(data.value[0]).to.have.property('name')
                    expect(data.value[0]).to.have.property('city')
                })

                it('should return a single customer by key', async () => {
                    const { data } = await GET(`${base}/${Customers}('C001')`)
                    expect(data.ID).to.equal('C001')
                    expect(data.name).to.equal('Acme Corp')
                })

                it('should return all fields for wildcard projection', async () => {
                    const { data } = await GET(`${base}/${Customers}('C001')`)
                    expect(data).to.have.property('ID')
                    expect(data).to.have.property('name')
                    expect(data).to.have.property('city')
                    expect(data).to.have.property('country')
                    expect(data).to.have.property('email')
                    expect(data).to.have.property('blocked')
                    expect(data).to.have.property('modifiedAt')
                })
            })

            describe('Consumption view (renames)', () => {

                it('should return products with renamed local fields', async () => {
                    const { data } = await GET(`${base}/${Products}`)
                    expect(data.value).to.have.length(5)
                    expect(data.value[0]).to.have.property('productId')
                    expect(data.value[0]).to.have.property('productName')
                    expect(data.value[0]).to.have.property('unitPrice')
                    expect(data.value[0]).to.have.property('category')
                    expect(data.value[0]).to.have.property('currency')
                })

                it('should NOT return excluded fields (stock, modifiedAt not projected)', async () => {
                    const { data } = await GET(`${base}/${Products}`)
                    expect(data.value[0]).to.not.have.property('stock')
                    expect(data.value[0]).to.not.have.property('modifiedAt')
                })

                it('should return a single product by renamed key', async () => {
                    const { data } = await GET(`${base}/${Products}('P001')`)
                    expect(data.productId).to.equal('P001')
                    expect(data.productName).to.equal('Laptop Pro')
                    expect(num(data.unitPrice)).to.equal(1299.99)
                })
            })

            describe('Entity-level rename', () => {

                it('should return suppliers with renamed fields from Customers source', async () => {
                    const { data } = await GET(`${base}/${Suppliers}`)
                    expect(data.value).to.have.length(5)
                    expect(data.value[0]).to.have.property('supplierId')
                    expect(data.value[0]).to.have.property('companyName')
                    expect(data.value[0]).to.have.property('headquarters')
                    expect(data.value[0]).to.have.property('region')
                    expect(data.value[0]).to.have.property('contactEmail')
                })

                it('should NOT return excluded fields (blocked, modifiedAt not projected)', async () => {
                    const { data } = await GET(`${base}/${Suppliers}`)
                    expect(data.value[0]).to.not.have.property('blocked')
                    expect(data.value[0]).to.not.have.property('modifiedAt')
                })

                it('should filter on renamed field (companyName → name on remote)', async () => {
                    const { data } = await GET(`${base}/${Suppliers}?$filter=companyName eq 'Acme Corp'`)
                    expect(data.value).to.have.length(1)
                    expect(data.value[0].companyName).to.equal('Acme Corp')
                })

                it('should return a single supplier by renamed key', async () => {
                    const { data } = await GET(`${base}/${Suppliers}('C001')`)
                    expect(data.supplierId).to.equal('C001')
                    expect(data.companyName).to.equal('Acme Corp')
                })
            })

            // ── Query translation ──────────────────────────────────────────

            describe('$filter with renames', () => {

                it('should filter customers by country (no rename — passthrough)', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=country eq 'DE'`)
                    expect(data.value).to.have.length(2)
                    expect(data.value.every(c => c.country === 'DE')).to.be.true
                })

                it('should filter products by renamed field (unitPrice → price on remote)', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=unitPrice gt 100`)
                    expect(data.value.length).to.be.greaterThan(0)
                    expect(data.value.every(p => num(p.unitPrice) > 100)).to.be.true
                })

                it('should filter products by renamed field (productName → name on remote)', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=contains(productName,'Laptop')`)
                    expect(data.value.length).to.equal(1)
                    expect(data.value[0].productName).to.equal('Laptop Pro')
                })

                it('should filter products by non-renamed field (category — same on both sides)', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=category eq 'Electronics'`)
                    expect(data.value).to.have.length(3)
                })

                it('should filter with complex expression on renamed fields', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=category eq 'Electronics' and unitPrice lt 100`)
                    expect(data.value).to.have.length(2)
                })

                it('should filter customers with complex expression (no renames)', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=country eq 'DE' and blocked eq false`)
                    expect(data.value).to.have.length(2)
                })
            })

            describe('$filter operators (ne, ge, le, or, not, startswith, endswith)', () => {

                it('should filter with ne operator', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=country ne 'DE'`)
                    expect(data.value).to.have.length(3)
                    expect(data.value.every(c => c.country !== 'DE')).to.be.true
                })

                it('should filter with ge and le operators (range)', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=unitPrice ge 100 and unitPrice le 600`)
                    expect(data.value.length).to.be.greaterThan(0)
                    expect(data.value.every(p => num(p.unitPrice) >= 100 && num(p.unitPrice) <= 600)).to.be.true
                })

                it('should filter with or operator', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=country eq 'DE' or country eq 'GB'`)
                    expect(data.value).to.have.length(3)
                    expect(data.value.every(c => c.country === 'DE' || c.country === 'GB')).to.be.true
                })

                it('should filter with not operator', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=not (blocked eq true)`)
                    expect(data.value).to.have.length(4)
                    expect(data.value.every(c => c.blocked === false)).to.be.true
                })

                it('should filter with startswith function', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=startswith(name,'Acme')`)
                    expect(data.value).to.have.length(1)
                    expect(data.value[0].name).to.equal('Acme Corp')
                })

                it('should filter with endswith function', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=endswith(email,'example.com')`)
                    expect(data.value).to.have.length(5)
                })
            })

            describe('String functions (contains, tolower, toupper)', () => {

                it('should filter with contains on renamed field', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=contains(name,'Corp')`)
                    expect(data.value.length).to.be.greaterThan(0)
                    expect(data.value.every(c => c.name.includes('Corp'))).to.be.true
                })

                it('should filter with tolower function', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=tolower(name) eq 'acme corp'`)
                    expect(data.value).to.have.length(1)
                    expect(data.value[0].name).to.equal('Acme Corp')
                })

                it('should filter with toupper function', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=toupper(name) eq 'ACME CORP'`)
                    expect(data.value).to.have.length(1)
                    expect(data.value[0].name).to.equal('Acme Corp')
                })

                it('should filter with tolower on renamed field', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=tolower(productName) eq 'laptop pro'`)
                    expect(data.value).to.have.length(1)
                    expect(data.value[0].productName).to.equal('Laptop Pro')
                })

                it('should filter with toupper on renamed field', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=toupper(productName) eq 'LAPTOP PRO'`)
                    expect(data.value).to.have.length(1)
                    expect(data.value[0].productName).to.equal('Laptop Pro')
                })
            })

            describe('$orderby with renames', () => {

                it('should order customers by name ascending (no rename)', async () => {
                    const { data } = await GET(`${base}/${Customers}?$orderby=name asc`)
                    const names = data.value.map(c => c.name)
                    expect(names).to.deep.equal([...names].sort())
                })

                it('should order products by unitPrice descending (unitPrice → price on remote)', async () => {
                    const { data } = await GET(`${base}/${Products}?$orderby=unitPrice desc`)
                    const prices = data.value.map(p => num(p.unitPrice))
                    for (let i = 0; i < prices.length - 1; i++) {
                        expect(prices[i]).to.be.greaterThanOrEqual(prices[i + 1])
                    }
                })

                it('should order products by productName ascending (productName → name on remote)', async () => {
                    const { data } = await GET(`${base}/${Products}?$orderby=productName asc`)
                    const names = data.value.map(p => p.productName)
                    expect(names).to.deep.equal([...names].sort())
                })
            })

            describe('$select with renames', () => {

                it('should select renamed fields (local names in request, correct data returned)', async () => {
                    const { data } = await GET(`${base}/${Products}?$select=productId,productName`)
                    expect(data.value[0]).to.have.property('productId')
                    expect(data.value[0]).to.have.property('productName')
                    expect(data.value[0]).to.not.have.property('unitPrice')
                    expect(data.value[0]).to.not.have.property('category')
                })

                it('should select non-renamed fields', async () => {
                    const { data } = await GET(`${base}/${Customers}?$select=ID,name`)
                    expect(data.value[0]).to.have.property('ID')
                    expect(data.value[0]).to.have.property('name')
                    expect(data.value[0]).to.not.have.property('city')
                    expect(data.value[0]).to.not.have.property('email')
                })
            })

            describe('$top and $skip', () => {

                it('should limit results with $top', async () => {
                    const { data } = await GET(`${base}/${Customers}?$top=2`)
                    expect(data.value).to.have.length(2)
                })

                it('should paginate with $skip and $top', async () => {
                    const page1 = await GET(`${base}/${Customers}?$top=2&$skip=0`)
                    const page2 = await GET(`${base}/${Customers}?$top=2&$skip=2`)
                    expect(page1.data.value).to.have.length(2)
                    expect(page2.data.value).to.have.length(2)
                    const ids1 = page1.data.value.map(c => c.ID)
                    const ids2 = page2.data.value.map(c => c.ID)
                    expect(ids1.some(id => ids2.includes(id))).to.be.false
                })
            })

            describe('$count', () => {

                it('should return inline count', async () => {
                    const { data } = await GET(`${base}/${Customers}?$count=true`)
                    expect(num(data['@odata.count'])).to.equal(5)
                })

                it('should return count with filter on renamed field', async () => {
                    const { data } = await GET(`${base}/${Products}?$count=true&$filter=category eq 'Electronics'`)
                    expect(num(data['@odata.count'])).to.equal(3)
                })
            })

            // ── $expand Scenario A (remote → remote) ──────────────────────

            describe('$expand Scenario A: Remote → Remote', () => {

                it('[4.2.6] A1 [delegated expand]: Orders → buyer (to-one, renamed association)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=buyer`)
                    expect(data.value).to.have.length(6)
                    expect(data.value[0]).to.have.property('buyer')
                    expect(data.value[0].buyer).to.have.property('ID')
                    expect(data.value[0].buyer).to.have.property('name')
                })

                it('[4.2.6] A2 [delegated expand]: Orders → item (to-one, renamed assoc + renamed fields in target)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=item`)
                    expect(data.value[0]).to.have.property('item')
                    expect(data.value[0].item).to.have.property('productId')
                    expect(data.value[0].item).to.have.property('productName')
                    expect(data.value[0].item).to.have.property('unitPrice')
                    expect(data.value[0].item).to.not.have.property('stock')
                })

                it('[4.2.6] A3 [delegated expand]: Customers → orders (to-many)', async () => {
                    const { data } = await GET(`${base}/${Customers}('C001')?$expand=orders`)
                    expect(data).to.have.property('orders')
                    expect(data.orders).to.be.an('array')
                    expect(data.orders.length).to.equal(2)
                })

                it('[4.2.6] A4 [delegated expand]: Orders → buyer,item (multiple expands in one request)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=buyer,item`)
                    const order = data.value[0]
                    expect(order).to.have.property('buyer')
                    expect(order).to.have.property('item')
                    expect(order.buyer).to.have.property('name')
                    expect(order.item).to.have.property('productName')
                })

                it('[4.2.6] A5 [delegated expand]: Nested expand — Orders → buyer → orders', async () => {
                    const { data } = await GET(`${base}/${Orders}('O001')?$expand=buyer($expand=orders)`)
                    expect(data.buyer).to.have.property('orders')
                    expect(data.buyer.orders).to.be.an('array')
                })

                it('[4.2.6] A6 [delegated expand]: Expand with $select — Orders → buyer($select=ID,name)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=buyer($select=ID,name)`)
                    const buyer = data.value[0].buyer
                    expect(buyer).to.have.property('ID')
                    expect(buyer).to.have.property('name')
                    expect(buyer).to.not.have.property('email')
                    expect(buyer).to.not.have.property('city')
                })

                it('[4.2.6] A7 [delegated expand]: Single entity with expand', async () => {
                    const { data } = await GET(`${base}/${Orders}('O001')?$expand=buyer`)
                    expect(data.orderId).to.equal('O001')
                    expect(data.buyer).to.have.property('ID', 'C001')
                    expect(data.buyer).to.have.property('name', 'Acme Corp')
                })

                it('[4.1.6] static where + delegated expand: narrows a trimmed expand target', async () => {
                    const { data } = await GET(`${base}/${ShippedOrders}('O001')?$expand=item`)
                    expect(data.orderId).to.equal('O001')
                    expect(data.status).to.equal('shipped')
                    expect(data.item).to.have.property('productId')
                    expect(data.item).to.have.property('productName')
                    expect(data.item).to.have.property('unitPrice')
                    expect(data.item).to.not.have.property('stock')
                    expect(data.item).to.not.have.property('modifiedAt')
                })

                it('[4.1.6] static where + delegated expand: supports multiple expands', async () => {
                    const { data } = await GET(`${base}/${ShippedOrders}?$expand=buyer,item`)
                    expect(data.value).to.have.length(3)
                    expect(data.value.every(order => order.status === 'shipped')).to.be.true
                    expect(data.value[0].buyer).to.have.property('name')
                    expect(data.value[0].item).to.have.property('productName')
                    expect(data.value[0].item).to.not.have.property('stock')
                })

                it('[4.1.6] static where: exposes renamed association foreign keys', async () => {
                    const { data } = await GET(`${base}/${ShippedOrders}('O001')`)
                    expect(data).to.have.property('buyer_ID', 'C001')
                    expect(data).to.have.property('item_ID', 'P001')
                    expect(data).to.not.have.property('customer_ID')
                    expect(data).to.not.have.property('product_ID')
                })

                it('[4.1.6] static where: selects a renamed association foreign key', async () => {
                    const { data } = await GET(`${base}/${ShippedOrders}('O001')?$select=orderId,buyer_ID`)
                    expect(data).to.have.property('orderId', 'O001')
                    expect(data).to.have.property('buyer_ID', 'C001')
                })

                it('[4.1.6] static where: filters and orders by a renamed association foreign key', async () => {
                    const filtered = await GET(`${base}/${ShippedOrders}?$filter=buyer_ID eq 'C001'`)
                    expect(filtered.data.value).to.have.length(1)
                    expect(filtered.data.value[0].orderId).to.equal('O001')

                    const ordered = await GET(`${base}/${ShippedOrders}?$orderby=buyer_ID desc`)
                    const buyers = ordered.data.value.map(row => row.buyer_ID)
                    expect(buyers).to.deep.equal([...buyers].sort().reverse())
                })

                it('[4.1.6] static where + delegated expand: applies static scope on expand target', async () => {
                    const { data } = await GET(`${base}/${ShippedOrdersScoped}?$expand=item`)
                    const items = Object.fromEntries(data.value.map(o => [o.orderId, o.item?.productName ?? null]))
                    expect(items).to.deep.equal({ O001: 'Laptop Pro', O003: null, O006: 'USB-C Hub' })
                })

                it('[4.1.6] static where + delegated expand: recursively maps renamed nested expands', async () => {
                    const { data } = await GET(
                        `${base}/${ActiveCustomersWithPurchases}('C001')?$expand=purchases($expand=item)`
                    )
                    expect(data.customerName).to.equal('Acme Corp')
                    expect(data.purchases).to.have.length(2)
                    expect(data.purchases.map(order => order.orderId)).to.have.members(['O001', 'O002'])
                    expect(data.purchases.map(order => order.item.productName))
                        .to.have.members(['Laptop Pro', 'Wireless Mouse'])
                    expect(data.purchases.every(order => !('product' in order))).to.be.true
                })

                if (isV2) {
                    it('[4.1.6] static where + delegated expand: applies client filter locally for V2', async () => {
                        const { data } = await GET(`${base}/${ShippedOrdersScoped}?$expand=item($filter=unitPrice lt 100)`)
                        const items = Object.fromEntries(data.value.map(o => [o.orderId, o.item?.productName ?? null]))
                        expect(items).to.deep.equal({ O001: null, O003: null, O006: 'USB-C Hub' })
                    })

                    it('[4.1.6] static where + delegated expand: hides V2 evaluation-only fields', async () => {
                        const { data } = await GET(
                            `${base}/${ShippedOrdersScoped}?$expand=item($select=productName;$filter=unitPrice lt 100)`
                        )
                        const item = data.value.find(row => row.orderId === 'O006').item
                        expect(item).to.include({ productName: 'USB-C Hub' })
                        expect(item).to.not.have.property('unitPrice')
                    })
                }
            })

            // ── $expand options (V4 only — V2 does not support nested query options in $expand) ──

            if (!isV2) {
                describe('$filter / $orderby / $top / $skip within $expand', () => {

                    it('[4.1.6] static where + delegated expand: translates renamed filter and orderby fields', async () => {
                        const { data } = await GET(
                            `${base}/${ShippedOrders}('O001')?$expand=item($filter=unitPrice gt 100;$orderby=productName asc)`
                        )
                        expect(data.status).to.equal('shipped')
                        expect(data.item).to.have.property('productName', 'Laptop Pro')
                        expect(num(data.item.unitPrice)).to.be.greaterThan(100)
                        expect(data.item).to.not.have.property('price')
                        expect(data.item).to.not.have.property('name')
                    })

                    it('$filter within to-many expand (Scenario A)', async () => {
                        const { data } = await GET(`${base}/${Customers}('C001')?$expand=orders($filter=status eq 'shipped')`)
                        expect(data.orders).to.be.an('array')
                        expect(data.orders.every(o => o.status === 'shipped')).to.be.true
                    })

                    it('$orderby within to-many expand (Scenario A)', async () => {
                        const { data } = await GET(`${base}/${Customers}('C001')?$expand=orders($orderby=quantity desc)`)
                        expect(data.orders).to.be.an('array')
                        expect(data.orders.length).to.equal(2)
                        expect(num(data.orders[0].quantity)).to.be.greaterThanOrEqual(num(data.orders[1].quantity))
                    })

                    it('$top within to-many expand (Scenario A)', async () => {
                        const { data } = await GET(`${base}/${Customers}('C001')?$expand=orders($top=1)`)
                        expect(data.orders).to.be.an('array')
                        expect(data.orders).to.have.length(1)
                    })

                    it('$skip within to-many expand (Scenario A)', async () => {
                        // Use non-renamed field (quantity) because renamed fields in
                        // expand options fail: consumer URL parser requires local names but
                        // the remote service requires remote names.
                        const { data } = await GET(`${base}/${Customers}('C001')?$expand=orders($orderby=quantity asc;$top=1;$skip=1)`)
                        expect(data.orders).to.be.an('array')
                        expect(data.orders).to.have.length(1)
                    })
                })
            }

            // ── Combined & edge cases ──────────────────────────────────────

            describe('Combined query parameters', () => {

                it('should handle $filter + $orderby + $top on renamed fields', async () => {
                    const { data } = await GET(`${base}/${Products}?$filter=category eq 'Electronics'&$orderby=unitPrice desc&$top=2`)
                    expect(data.value).to.have.length(2)
                    expect(num(data.value[0].unitPrice)).to.be.greaterThanOrEqual(num(data.value[1].unitPrice))
                })

                it('should handle $filter + $select on non-renamed entity', async () => {
                    const { data } = await GET(`${base}/${Customers}?$filter=blocked eq false&$orderby=name asc&$top=3&$select=ID,name`)
                    expect(data.value).to.have.length(3)
                    expect(data.value[0]).to.not.have.property('city')
                    const names = data.value.map(c => c.name)
                    expect(names).to.deep.equal([...names].sort())
                })

                it('should handle $filter + $expand on renamed entity', async () => {
                    const { data } = await GET(`${base}/${Orders}?$filter=status eq 'shipped'&$expand=buyer`)
                    expect(data.value.every(o => o.status === 'shipped')).to.be.true
                    expect(data.value[0].buyer).to.have.property('name')
                })
            })

            describe('Error propagation', () => {

                it('should return 404 for non-existent customer key', async () => {
                    try {
                        await GET(`${base}/${Customers}('NONEXISTENT')`)
                        expect.fail('Should have thrown')
                    } catch (err) {
                        expect(err.response.status).to.equal(404)
                    }
                })

                it('should return 404 for non-existent product by renamed key', async () => {
                    try {
                        await GET(`${base}/${Products}('NONEXISTENT')`)
                        expect.fail('Should have thrown')
                    } catch (err) {
                        expect(err.response.status).to.equal(404)
                    }
                })

                it('should return 404 for non-existent supplier (entity-level rename)', async () => {
                    try {
                        await GET(`${base}/${Suppliers}('NONEXISTENT')`)
                        expect.fail('Should have thrown')
                    } catch (err) {
                        expect(err.response.status).to.equal(404)
                    }
                })

                it('should return 404 for non-existent order', async () => {
                    try {
                        await GET(`${base}/${Orders}('NONEXISTENT')`)
                        expect.fail('Should have thrown')
                    } catch (err) {
                        expect(err.response.status).to.equal(404)
                    }
                })

                it('should include error details in response body', async () => {
                    try {
                        await GET(`${base}/${Customers}('NONEXISTENT')`)
                        expect.fail('Should have thrown')
                    } catch (err) {
                        expect(err.response.status).to.equal(404)
                        expect(err.response.data).to.have.property('error')
                        expect(err.response.data.error).to.have.property('message')
                    }
                })
            })
        })
    }

    describeQueryCapabilities('OData V4', {
        Customers: 'Customers', Products: 'Products',
        Orders: 'Orders', ShippedOrders: 'ShippedOrders', ShippedOrdersScoped: 'ShippedOrdersScoped',
        ActiveCustomersWithPurchases: 'ActiveCustomersWithPurchases',
        Suppliers: 'Suppliers', isV2: false
    })

    describeQueryCapabilities('OData V2', {
        Customers: 'CustomersV2', Products: 'ProductsV2',
        Orders: 'OrdersV2', ShippedOrders: 'ShippedOrdersV2', ShippedOrdersScoped: 'ShippedOrdersScopedV2',
        ActiveCustomersWithPurchases: 'ActiveCustomersWithPurchasesV2',
        Suppliers: 'SuppliersV2', isV2: true
    })
})
