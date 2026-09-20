const cds = require('@sap/cds')
const {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
} = require('../../support/xtravels')

// SAP's xtravels reference app, federating from three real provider processes.
// Skipped unless the submodule is initialised (git submodule update --init).
describe.skipIf(!isXtravelsAvailable())('xtravels — foundation', () => {

    beforeAll(async () => {
        await startXtravelsProviders()
    }, 120000)

    afterAll(async () => {
        await stopXtravelsProviders()
    })

    const { GET, POST, expect, axios } = cds.test(XTRAVELS_DIR)
    axios.defaults.auth = { username: 'alice', password: 'admin' }

    describe('providers are wired as real remotes', () => {
        it('binds FlightsService over HCQL and S/4 over OData', () => {
            expect(cds.env.requires['sap.capire.flights.FlightsService'].kind).to.equal('hcql')
            expect(cds.env.requires['sap.capire.s4.business-partner'].kind).to.equal('odata')
            expect(cds.env.requires['sap.capire.hotels.HotelsService'].kind).to.equal('odata')
        })

        it('connects each of them as a RemoteService, not a local one', async () => {
            // xtravels serves HotelsService itself, so an incompletely resolved
            // binding resolves to that local service and the tests below would
            // pass without a single byte crossing the network. Fail loudly.
            for (const name of [
                'sap.capire.flights.FlightsService',
                'sap.capire.s4.business-partner',
                'sap.capire.hotels.HotelsService',
            ]) {
                const srv = await cds.connect.to(name)
                expect(srv.constructor.name, name).to.equal('RemoteService')
                expect(srv.isAppService, name).to.not.be.true
            }
        })
    })

    describe('@federation.replicate against the running providers', () => {

        // The startup preload is a background job; force a settled state rather
        // than racing it.
        beforeAll(async () => {
            for (const name of ['Flights', 'Supplements', 'Customers']) {
                const { status } = await POST('/pipeline/execute', { name })
                expect(status).to.equal(200)
            }
        }, 60000)

        it('registers one pipeline per annotated consumption view', async () => {
            const { data } = await GET`/pipeline/Pipelines?$select=name,mode&$orderby=name`
            // Entity caches use the same engine and register as
            // `data-federation-cache:<entity>`; only replications are asserted here.
            const replications = data.value.filter(p => !p.name.startsWith('data-federation-cache:'))
            expect(replications.map(p => p.name)).to.deep.equal(['Customers', 'Flights', 'Supplements'])
            expect(replications.find(p => p.name === 'Flights').mode).to.equal('delta')
            expect(replications.find(p => p.name === 'Customers').mode).to.equal('full')
        })

        it('fills the local replica tables at startup', async () => {
            const flights = await SELECT.from('sap.capire.xflights.Flights')
            const supplements = await SELECT.from('sap.capire.xflights.Supplements')
            const customers = await SELECT.from('sap.capire.s4.Customers')
            expect(flights.length).to.equal(52)
            expect(supplements.length).to.equal(49)
            expect(customers.length).to.equal(728)
        })

        it('applies the projection: renames, flattened paths, static where', async () => {
            const flight = await SELECT.one.from('sap.capire.xflights.Flights').where({ ID: 'SW1537' })
            // airline.name / origin.name / destination.name flattened by the view
            expect(flight.airline).to.be.a('string').and.not.be.empty
            expect(flight.origin).to.be.a('string').and.not.be.empty
            // `where BusinessPartnerCategory == '1'` — persons only, renamed columns
            const customer = await SELECT.one.from('sap.capire.s4.Customers')
            expect(customer).to.have.property('Name')
            expect(customer).to.not.have.property('PersonFullName')
        })
    })

    describe('static where over real OData (Customers)', () => {
        // The fork's own suite covers this in-process, where CQN handles `==`
        // natively. Over OData the `==` must be rewritten to `=`/`eq` or the
        // remote rejects the $filter — so this is the case that matters here.
        const S4 = 'API_BUSINESS_PARTNER.A_BusinessPartner'

        it("sends the view's `== '1'` as an OData filter and skips organizations", async () => {
            const s4 = await cds.connect.to('sap.capire.s4.business-partner')
            // OData V4 allows only single-entity POSTs, so insert one at a time.
            await s4.run(INSERT.into(S4).entries(
                { BusinessPartner: 'ORG900', PersonFullName: 'Globex Inc', BusinessPartnerCategory: '2' },
            ))
            await s4.run(INSERT.into(S4).entries(
                { BusinessPartner: 'PER900', PersonFullName: 'Grace Hopper', BusinessPartnerCategory: '1' },
            ))
            try {
                const { status } = await POST('/pipeline/execute', { name: 'Customers' })
                expect(status).to.equal(200)
                const ids = (await SELECT`ID`.from('sap.capire.s4.Customers')).map(c => c.ID)
                expect(ids).to.include('PER900')
                expect(ids).to.not.include('ORG900')
            } finally {
                // Key-addressed: CAP rejects filter-based DELETE on a remote.
                await s4.run(DELETE.from(S4, { BusinessPartner: 'ORG900' }))
                await s4.run(DELETE.from(S4, { BusinessPartner: 'PER900' }))
                await DELETE.from('sap.capire.s4.Customers').where({ ID: { in: ['ORG900', 'PER900'] } })
            }
        })
    })

    describe('showcase service', () => {
        it('is served alongside the untouched TravelService', async () => {
            const { status, data } = await GET`/showcase/$metadata`
            expect(status).to.equal(200)
            expect(data).to.contain('FederationShowcaseService')
            const travels = await GET`/odata/v4/travel/Travels?$top=1&$filter=IsActiveEntity eq true`
            expect(travels.status).to.equal(200)
        })
    })
})
