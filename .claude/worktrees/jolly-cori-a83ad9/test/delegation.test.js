const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('./setup')

describe('Delegate Strategy', () => {

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(__dirname + '/consumer/')

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)
    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Parameterized query capability tests (V4 + V2) ────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Each test category is defined once and runs against both OData V4 and V2
    // entity sets. The `num()` helper handles V2-specific type quirks
    // (decimals/counts returned as strings).

    function describeQueryCapabilities(protocol, entities) {
        const { Customers, Products, Orders, Suppliers, isV2 } = entities
        const num = isV2 ? Number : v => v
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

                it('A1: Orders → buyer (to-one, renamed association)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=buyer`)
                    expect(data.value).to.have.length(6)
                    expect(data.value[0]).to.have.property('buyer')
                    expect(data.value[0].buyer).to.have.property('ID')
                    expect(data.value[0].buyer).to.have.property('name')
                })

                it('A2: Orders → item (to-one, renamed assoc + renamed fields in target)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=item`)
                    expect(data.value[0]).to.have.property('item')
                    expect(data.value[0].item).to.have.property('productId')
                    expect(data.value[0].item).to.have.property('productName')
                    expect(data.value[0].item).to.have.property('unitPrice')
                    expect(data.value[0].item).to.not.have.property('stock')
                })

                it('A3: Customers → orders (to-many)', async () => {
                    const { data } = await GET(`${base}/${Customers}('C001')?$expand=orders`)
                    expect(data).to.have.property('orders')
                    expect(data.orders).to.be.an('array')
                    expect(data.orders.length).to.equal(2)
                })

                it('A4: Orders → buyer,item (multiple expands in one request)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=buyer,item`)
                    const order = data.value[0]
                    expect(order).to.have.property('buyer')
                    expect(order).to.have.property('item')
                    expect(order.buyer).to.have.property('name')
                    expect(order.item).to.have.property('productName')
                })

                it('A5: Nested expand — Orders → buyer → orders', async () => {
                    const { data } = await GET(`${base}/${Orders}('O001')?$expand=buyer($expand=orders)`)
                    expect(data.buyer).to.have.property('orders')
                    expect(data.buyer.orders).to.be.an('array')
                })

                it('A6: Expand with $select — Orders → buyer($select=ID,name)', async () => {
                    const { data } = await GET(`${base}/${Orders}?$expand=buyer($select=ID,name)`)
                    const buyer = data.value[0].buyer
                    expect(buyer).to.have.property('ID')
                    expect(buyer).to.have.property('name')
                    expect(buyer).to.not.have.property('email')
                    expect(buyer).to.not.have.property('city')
                })

                it('A7: Single entity with expand', async () => {
                    const { data } = await GET(`${base}/${Orders}('O001')?$expand=buyer`)
                    expect(data.orderId).to.equal('O001')
                    expect(data.buyer).to.have.property('ID', 'C001')
                    expect(data.buyer).to.have.property('name', 'Acme Corp')
                })
            })

            // ── $expand options (V4 only — V2 does not support nested query options in $expand) ──

            if (!isV2) {
                describe('$filter / $orderby / $top / $skip within $expand', () => {

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

    // Run all parameterized tests against both protocols
    describeQueryCapabilities('OData V4', {
        Customers: 'Customers', Products: 'Products',
        Orders: 'Orders', Suppliers: 'Suppliers', isV2: false
    })

    describeQueryCapabilities('OData V2', {
        Customers: 'CustomersV2', Products: 'ProductsV2',
        Orders: 'OrdersV2', Suppliers: 'SuppliersV2', isV2: true
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── V4-only: Navigation path $filter ──────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── V4-only: Lambda operators (any/all) ────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    // OData V2 does not support lambda operators. These tests are V4-only.

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── V4-only: Scenario B navigation path $filter (cross-service) ──────────
    // ═══════════════════════════════════════════════════════════════════════════
    // When a LOCAL entity's $filter navigates through a to-one association to a
    // FEDERATED entity (e.g., Reviews?$filter=product/productName eq 'X'), the
    // plugin pre-resolves the remote filter: queries the remote service for matching
    // keys, then rewrites to a simple FK IN filter on the local table (4.2.7).

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── V4-only: $expand Scenario B (Local → Remote) ──────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('$expand Scenario B: Local → Remote (V4)', () => {

        it('B1: Reviews → product (local → delegate with renames)', async () => {
            const { data } = await GET`/odata/v4/consumer/Reviews?$expand=product`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('product')
            expect(data.value[0].product).to.have.property('productId')
            expect(data.value[0].product).to.have.property('productName')
        })

        it('B2: Bookmarks → customer (local → delegate, wildcard)', async () => {
            const { data } = await GET`/odata/v4/consumer/Bookmarks?$expand=customer`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('customer')
            expect(data.value[0].customer).to.have.property('ID')
            expect(data.value[0].customer).to.have.property('name')
        })

        it('B3: Reviews → product with $select', async () => {
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

        it('B4: InventoryReports → product (local → ProviderService)', async () => {
            const { data } = await GET`/odata/v4/consumer/InventoryReports?$expand=product`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('product')
            expect(data.value[0].product).to.have.property('productId')
            expect(data.value[0].product).to.have.property('productName')
        })

        it('B5: InventoryReports → warehouse (local → InventoryService)', async () => {
            const { data } = await GET`/odata/v4/consumer/InventoryReports?$expand=warehouse`
            expect(data.value).to.have.length(3)
            expect(data.value[0]).to.have.property('warehouse')
            expect(data.value[0].warehouse).to.have.property('ID')
            expect(data.value[0].warehouse).to.have.property('name')
        })

        it('B6: InventoryReports → product,warehouse (both providers in one expand)', async () => {
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

        it('B7: Bookmarks → customer($expand=orders) nested expand with rename mapping', async () => {
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

        it('B8: LightBookmarks → customer (excluding columns not in response)', async () => {
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

        it('B9: AddressNotes → address (composite key, to-one with renames)', async () => {
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

        it('B10: ProductCategories → products (to-many, batch-fetch + array grouping)', async () => {
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

        it('B11: ProductCategories → products with $top (per-parent limiting)', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$expand=products($top=1)`
            expect(data.value).to.have.length(2)
            const electronics = data.value.find(c => c.category === 'Electronics')
            expect(electronics.products.length).to.equal(1)
            const furniture = data.value.find(c => c.category === 'Furniture')
            expect(furniture.products.length).to.equal(1)
        })

        it('B12: ProductCategories → products with $filter in expand', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$expand=products($filter=unitPrice gt 100)`
            const electronics = data.value.find(c => c.category === 'Electronics')
            expect(electronics.products.length).to.equal(1)
            expect(electronics.products[0]).to.have.property('productName', 'Laptop Pro')
        })

        it('B13: ProductCategories with lambda any() on to-many remote association', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$filter=products/any(p:p/unitPrice gt 1000)`
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(1)
            expect(data.value[0]).to.have.property('category', 'Electronics')
        })

        it('B14: ProductCategories with lambda any() — no matches', async () => {
            const { data } = await GET`/odata/v4/consumer/ProductCategories?$filter=products/any(p:p/unitPrice gt 99999)`
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(0)
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── V4-only: $expand Scenario C (Remote → Local) ──────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('$expand Scenario C: Remote → Local (V4)', () => {

        it('C1: Customers → bookmarks (remote → local, to-many backlink)', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks`
            expect(data).to.have.property('bookmarks')
            expect(data.bookmarks).to.be.an('array')
            expect(data.bookmarks).to.have.length(2)
            expect(data.bookmarks.map(b => b.label).sort()).to.deep.equal(['Favorite supplier', 'VIP customer'])
        })

        it('C2: Customers → bookmarks (all customers, some with empty arrays)', async () => {
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

        it('C3: Customers → bookmarks with $select in expand', async () => {
            const { data } = await GET`/odata/v4/consumer/Customers('C001')?$expand=bookmarks($select=label)`
            expect(data.bookmarks).to.be.an('array').with.length(2)
            expect(data.bookmarks[0]).to.have.property('label')
        })

        it('C4: Customers → bookmarks,orders (mixed: Scenario C + Scenario A)', async () => {
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
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Consumption view patterns ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

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
            // CaLeSi docs: "OData doesn't support denormalization like we used for
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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Cross-service navigation (V4-only) ──────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Navigation across service boundaries generates a CQN with from.ref.length == 2,
    // which is distinct from $expand. Fiori Elements uses navigation URLs when users
    // click links from list pages to detail pages.
    //
    // Ref: SAP risk-management sample (risk-service.js) shows the manual pattern.
    // See REQUIREMENTS.md 4.2.12.

    describe('Cross-service navigation (V4-only)', () => {

        it('N1: Local → remote navigation: Reviews(id)/product', async () => {
            const reviews = await GET`/odata/v4/consumer/Reviews`
            const reviewId = reviews.data.value[0].ID
            const { data } = await GET(`/odata/v4/consumer/Reviews('${reviewId}')/product`)
            expect(data).to.have.property('productId')
            expect(data).to.have.property('productName')
            expect(data).to.have.property('category')
        })

        it('N2: Remote → local navigation: Customers(id)/bookmarks (backlink)', async () => {
            const { data } = await GET(`/odata/v4/consumer/Customers('C001')/bookmarks`)
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(2)
            expect(data.value[0]).to.have.property('label')
            expect(data.value[0]).to.have.property('customer_ID', 'C001')
        })

        it('N3: Navigation with $select on target', async () => {
            const reviews = await GET`/odata/v4/consumer/Reviews`
            const reviewId = reviews.data.value[0].ID
            const { data } = await GET(`/odata/v4/consumer/Reviews('${reviewId}')/product?$select=productName,category`)
            expect(data).to.have.property('productName')
            expect(data).to.have.property('category')
            expect(data).to.not.have.property('unitPrice')
        })

        it('N4: Remote → local navigation with $filter', async () => {
            const { data } = await GET(`/odata/v4/consumer/Customers('C001')/bookmarks?$filter=label eq 'VIP customer'`)
            expect(data.value).to.be.an('array')
            expect(data.value.length).to.equal(1)
            expect(data.value[0]).to.have.property('label', 'VIP customer')
        })

        it('N5: Local → remote navigation: Bookmarks(id)/customer (wildcard)', async () => {
            const bookmarks = await GET`/odata/v4/consumer/Bookmarks`
            const bookmarkId = bookmarks.data.value[0].ID
            const { data } = await GET(`/odata/v4/consumer/Bookmarks('${bookmarkId}')/customer`)
            expect(data).to.have.property('ID')
            expect(data).to.have.property('name')
            expect(data).to.have.property('city')
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Multi-provider (V4-only) ──────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Mixed protocol ────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── CQL / SELECT via application service ──────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Caching (via cds-caching) ───────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Caching (via cds-caching)', () => {
        const base = '/odata/v4/consumer'
        let cache, longTermCache

        beforeAll(async () => {
            cache = await cds.connect.to('caching')
            longTermCache = await cds.connect.to('longTermCache')
            await cache.setMetricsEnabled(true)
            await longTermCache.setMetricsEnabled(true)
        })

        beforeEach(async () => {
            await cache.clear()
            await cache.clearMetrics()
            await longTermCache.clear()
            await longTermCache.clearMetrics()
        })

        // ── Cache hit/miss ───────────────────────────────────────────────

        describe('Cache hit/miss', () => {

            it('C1: should return data on first request (cache miss)', async () => {
                const { data } = await GET(`${base}/CachedCustomers`)
                expect(data.value).to.have.length(5)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(0)
            })

            it('C2: should return cached data on second identical request (cache hit)', async () => {
                await GET(`${base}/CachedCustomers`)
                const { data } = await GET(`${base}/CachedCustomers`)
                expect(data.value).to.have.length(5)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })

            it('C3: should produce separate cache entries for different $filter', async () => {
                await GET(`${base}/CachedCustomers?$filter=city eq 'Berlin'`)
                await GET(`${base}/CachedCustomers?$filter=city eq 'Munich'`)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            })

            it('C4: should produce separate cache entries for different $select', async () => {
                await GET(`${base}/CachedCustomers?$select=ID,name`)
                await GET(`${base}/CachedCustomers?$select=ID,city`)
                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            })
        })

        // ── TTL expiration ───────────────────────────────────────────────

        describe('TTL expiration', () => {

            it('C5: should expire cached entries after TTL', async () => {
                await GET(`${base}/CachedCustomers`)
                let metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)

                await new Promise(resolve => setTimeout(resolve, 6000))

                await GET(`${base}/CachedCustomers`)
                metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            }, 15000)
        })

        // ── Cache with consumption view renames ──────────────────────────

        describe('Cache with consumption view renames', () => {

            it('C6: should cache responses with local field names', async () => {
                const { data: first } = await GET(`${base}/CachedProducts`)
                expect(first.value[0]).to.have.property('productId')
                expect(first.value[0]).to.have.property('productName')
                expect(first.value[0]).to.have.property('unitPrice')

                const { data: second } = await GET(`${base}/CachedProducts`)
                expect(second.value[0]).to.have.property('productId')
                expect(second.value[0]).to.have.property('productName')

                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })

            it('C7: should serve cached response for $filter on renamed field', async () => {
                const { data: first } = await GET(`${base}/CachedProducts?$filter=unitPrice gt 100`)
                expect(first.value.length).to.be.greaterThan(0)
                first.value.forEach(p => expect(Number(p.unitPrice)).to.be.greaterThan(100))

                const { data: second } = await GET(`${base}/CachedProducts?$filter=unitPrice gt 100`)
                expect(second.value).to.deep.equal(first.value)

                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })
        })

        // ── Tag-based invalidation ───────────────────────────────────────

        describe('Tag-based invalidation', () => {

            it('C8: should invalidate by custom static tag', async () => {
                await GET(`${base}/CachedProducts`)
                await GET(`${base}/CachedProducts`)
                let metrics = await cache.getCurrentMetrics()
                expect(metrics.hits).to.equal(1)

                await cache.deleteByTag('product-cache')

                await GET(`${base}/CachedProducts`)
                metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
            })

            it('C9: should invalidate by auto-generated entity tag', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedCustomers`)
                let metrics = await cache.getCurrentMetrics()
                expect(metrics.hits).to.equal(1)

                await cache.deleteByTag('federation:CachedCustomers')

                await GET(`${base}/CachedCustomers`)
                metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
            })

            it('C10: should not affect other entities when invalidating by tag', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                await cache.deleteByTag('federation:CachedCustomers')

                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                const metrics = await cache.getCurrentMetrics()
                expect(metrics.misses).to.equal(3)
                expect(metrics.hits).to.equal(1)
            })

            it('C11: should support dynamic data-based tags', async () => {
                await GET(`${base}/CachedOrders`)
                await GET(`${base}/CachedOrders`)
                let metrics = await longTermCache.getCurrentMetrics()
                expect(metrics.hits).to.equal(1)

                await longTermCache.deleteByTag('order-O001')

                await GET(`${base}/CachedOrders`)
                metrics = await longTermCache.getCurrentMetrics()
                expect(metrics.misses).to.equal(2)
            })
        })

        // ── Custom cache service ─────────────────────────────────────────

        describe('Custom cache service', () => {

            it('C12: should use named cache service from annotation', async () => {
                await GET(`${base}/CachedOrders`)

                const defaultMetrics = await cache.getCurrentMetrics()
                const ltMetrics = await longTermCache.getCurrentMetrics()
                expect(defaultMetrics.misses || 0).to.equal(0)
                expect(defaultMetrics.hits || 0).to.equal(0)
                expect(ltMetrics.misses).to.equal(1)
            })

            it('C13: should isolate entries between cache services', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedOrders`)

                // cache.clear() resets both entries AND metrics for the cleared service
                await cache.clear()

                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedOrders`)

                const defaultMetrics = await cache.getCurrentMetrics()
                const ltMetrics = await longTermCache.getCurrentMetrics()
                // default cache was cleared → CachedCustomers re-fetched → 1 miss (post-clear)
                expect(defaultMetrics.misses).to.equal(1)
                expect(defaultMetrics.hits).to.equal(0)
                // longTermCache was NOT cleared → CachedOrders still cached → 1 hit
                expect(ltMetrics.misses).to.equal(1)
                expect(ltMetrics.hits).to.equal(1)
            })
        })

        // ── Cache clear ──────────────────────────────────────────────────

        describe('Cache clear', () => {

            it('C14: should clear all cached entries for a service', async () => {
                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                // cache.clear() resets both entries AND metrics
                await cache.clear()

                await GET(`${base}/CachedCustomers`)
                await GET(`${base}/CachedProducts`)

                const metrics = await cache.getCurrentMetrics()
                // Both re-fetched after clear → 2 misses (post-clear only)
                expect(metrics.misses).to.equal(2)
                expect(metrics.hits).to.equal(0)
            })
        })

        // ── $expand with cache ───────────────────────────────────────────

        describe('$expand with cache', () => {

            it('C15: should cache Scenario A expand results', async () => {
                const { data: first } = await GET(`${base}/CachedOrders?$expand=buyer`)
                expect(first.value[0]).to.have.property('buyer')
                expect(first.value[0].buyer).to.have.property('name')

                const { data: second } = await GET(`${base}/CachedOrders?$expand=buyer`)
                expect(second.value[0].buyer).to.have.property('name')

                const metrics = await longTermCache.getCurrentMetrics()
                expect(metrics.misses).to.equal(1)
                expect(metrics.hits).to.equal(1)
            })
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── CRUD delegation (CREATE / UPDATE / DELETE) ─────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('CRUD delegation (V4)', () => {

        const base = '/odata/v4/consumer'

        it('should CREATE a new customer on the remote service', async () => {
            const { status, data } = await POST(`${base}/Customers`, {
                ID: 'C099',
                name: 'Test Corp',
                city: 'Berlin',
                country: 'DE',
                email: 'test@corp.de',
                blocked: false
            })
            expect(status).to.equal(201)
            expect(data.ID).to.equal('C099')
            expect(data.name).to.equal('Test Corp')

            const { data: readBack } = await GET(`${base}/Customers('C099')`)
            expect(readBack.name).to.equal('Test Corp')
        })

        it('should UPDATE an existing customer on the remote service', async () => {
            const { status } = await PATCH(`${base}/Customers('C099')`, {
                name: 'Test Corp Updated',
                city: 'Munich'
            })
            expect(status).to.equal(200)

            const { data: readBack } = await GET(`${base}/Customers('C099')`)
            expect(readBack.name).to.equal('Test Corp Updated')
            expect(readBack.city).to.equal('Munich')
        })

        it('should DELETE a customer from the remote service', async () => {
            const { status } = await DEL(`${base}/Customers('C099')`)
            expect(status).to.equal(204)

            try {
                await GET(`${base}/Customers('C099')`)
                expect.fail('Expected 404')
            } catch (e) {
                expect(e.response.status).to.equal(404)
            }
        })

        it('should CREATE a product with renamed fields on the remote service', async () => {
            const { status, data } = await POST(`${base}/Products`, {
                productId: 'P099',
                productName: 'Test Widget',
                category: 'Testing',
                unitPrice: 9.99,
                currency: 'EUR'
            })
            expect(status).to.equal(201)
            expect(data.productId).to.equal('P099')
            expect(data.productName).to.equal('Test Widget')

            const { data: readBack } = await GET(`${base}/Products('P099')`)
            expect(readBack.productName).to.equal('Test Widget')
            expect(readBack.unitPrice).to.equal(9.99)
        })

        it('should UPDATE a product with renamed fields on the remote service', async () => {
            const { status } = await PATCH(`${base}/Products('P099')`, {
                productName: 'Updated Widget',
                unitPrice: 19.99
            })
            expect(status).to.equal(200)

            const { data: readBack } = await GET(`${base}/Products('P099')`)
            expect(readBack.productName).to.equal('Updated Widget')
            expect(readBack.unitPrice).to.equal(19.99)
        })

        it('should DELETE a product from the remote service', async () => {
            const { status } = await DEL(`${base}/Products('P099')`)
            expect(status).to.equal(204)

            try {
                await GET(`${base}/Products('P099')`)
                expect.fail('Expected 404')
            } catch (e) {
                expect(e.response.status).to.equal(404)
            }
        })

        it('should propagate remote errors for invalid CREATE', async () => {
            try {
                await POST(`${base}/Customers`, {})
                expect.fail('Expected error')
            } catch (e) {
                expect(e.response.status).to.be.at.least(400)
            }
        })

        it('should reject CREATE on read-only entity (Suppliers has no write flags)', async () => {
            try {
                await POST(`${base}/Suppliers`, {
                    supplierId: 'S099',
                    companyName: 'Test Supplier'
                })
                expect.fail('Expected 405')
            } catch (e) {
                expect(e.response.status).to.equal(405)
            }
        })

        it('should reject PATCH on read-only entity (Orders has no write flags)', async () => {
            try {
                await PATCH(`${base}/Orders('does-not-matter')`, { status: 'closed' })
                expect.fail('Expected 405')
            } catch (e) {
                expect(e.response.status).to.equal(405)
            }
        })

        it('should reject DELETE on read-only entity (Suppliers has no write flags)', async () => {
            try {
                await DEL(`${base}/Suppliers('does-not-matter')`)
                expect.fail('Expected 405')
            } catch (e) {
                expect(e.response.status).to.equal(405)
            }
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Selective write flags (create + update, no delete) ─────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Selective write flags (WritableCustomersNoDelete)', () => {

        const base = '/odata/v4/consumer'

        it('should CREATE via selective write entity', async () => {
            const { status, data } = await POST(`${base}/WritableCustomersNoDelete`, {
                ID: 'C098',
                name: 'Selective Corp',
                city: 'Hamburg',
                country: 'DE',
                email: 'sel@corp.de',
                blocked: false
            })
            expect(status).to.equal(201)
            expect(data.ID).to.equal('C098')
        })

        it('should UPDATE via selective write entity', async () => {
            const { status } = await PATCH(`${base}/WritableCustomersNoDelete('C098')`, {
                name: 'Selective Corp Updated'
            })
            expect(status).to.equal(200)
        })

        it('should reject DELETE on selective write entity (delete not enabled)', async () => {
            try {
                await DEL(`${base}/WritableCustomersNoDelete('C098')`)
                expect.fail('Expected 405')
            } catch (e) {
                expect(e.response.status).to.equal(405)
            }
        })

        afterAll(async () => {
            try { await DEL(`${base}/Customers('C098')`) } catch { /* cleanup */ }
        })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── Aggregation ($apply) and $search — discovery ──────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════
    // Server-driven paging (Northwind-style caps)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // The remote PagedCustomers entity has @cds.query.limit: { max: 2 } applied,
    // so every request returns at most 2 rows regardless of the client's $top.
    // The delegate handler must auto-loop the remote until all rows are collected
    // (or the client's $top is satisfied) so this is transparent to the client.

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
