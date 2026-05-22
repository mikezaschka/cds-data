const cds = require('@sap/cds')
const { startProvider, stopProvider, startInventoryProvider, stopInventoryProvider } = require('../../support/setup')

// Delegate Strategy — CRUD forwarding
//
// Annotation-driven CUD: `writable: true` / `create` / `update` / `delete`.
// Covers full round-trip with read-back, 405 rejection for read-only entities, and
// selective write flags (`WritableCustomersNoDelete`).

describe('Delegate Strategy', () => {

    beforeAll(async () => {
        await Promise.all([startProvider(), startInventoryProvider()])
    }, 30000)

    const { GET, POST, PATCH, DELETE: DEL, expect } = cds.test(require('path').join(__dirname, '../../fixtures/consumer'))

    afterAll(async () => {
        await Promise.all([stopProvider(), stopInventoryProvider()])
    })

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
})
