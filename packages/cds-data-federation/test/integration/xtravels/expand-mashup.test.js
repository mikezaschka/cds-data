const cds = require('@sap/cds')
const {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
} = require('../../support/xtravels')

/**
 * Joining across the federation boundary, against the real providers:
 *
 *  - delegated expand   — both sides remote, resolved by the remote itself
 *  - local → replica    — deep $expand and filters/ordering across the join,
 *                         which is plain SQL precisely because it is replicated
 *  - replica → local    — the same association followed the other way
 *  - aggregation        — local amounts grouped by a replicated column
 *
 * The plugin's own fixtures cover cross-service expand in isolation; this is
 * the same machinery inside a real app's model, where associations are
 * composite-keyed and draft-enabled.
 */
describe.skipIf(!isXtravelsAvailable())('xtravels — expands and mashups', () => {

    beforeAll(async () => {
        await startXtravelsProviders()
    }, 120000)

    afterAll(async () => {
        await stopXtravelsProviders()
    })

    const { GET, POST, expect, axios } = cds.test(XTRAVELS_DIR)
    axios.defaults.auth = { username: 'alice', password: 'admin' }

    const FLIGHTS = 'sap.capire.flights.FlightsService'

    beforeAll(async () => {
        for (const name of ['Flights', 'Customers']) {
            await POST('/pipeline/execute', { name })
        }
    }, 60000)

    it('resolves a delegated expand remotely (Airlines → flights)', async () => {
        const flights = await cds.connect.to(FLIGHTS)
        const [{ ID }] = await flights.run(SELECT.from(`${FLIGHTS}.Airlines`).columns('ID').orderBy('ID'))
        const { status, data } = await GET(`/showcase/Airlines?$filter=ID eq '${ID}'&$expand=flights($select=ID)`)
        expect(status).to.equal(200)
        const expected = await flights.run(
            SELECT.from(`${FLIGHTS}.Flights`).columns('ID').where({ airline_ID: ID }),
        )
        expect(data.value[0].flights.length).to.equal(expected.length)
    })

    it('expands local Travels into both replicas in one request', async () => {
        const { status, data } = await GET`/odata/v4/travel/Travels?$top=1&$filter=IsActiveEntity eq true&$select=ID&$expand=Customer($select=Name),Bookings($select=Pos;$expand=Flight($select=ID,airline))`
        expect(status).to.equal(200)
        const [travel] = data.value
        expect(travel.Customer).to.have.property('Name')
        expect(travel.Bookings[0].Flight).to.have.property('airline')
    })

    it('filters and orders local rows by replicated columns', async () => {
        const { Name } = await SELECT.one`Name`.from('sap.capire.s4.Customers').where({ Name: { '!=': null } })
        const filtered = await GET(
            `/odata/v4/travel/Travels?$filter=IsActiveEntity eq true and Customer/Name eq '${Name}'&$select=ID&$count=true`,
        )
        expect(filtered.status).to.equal(200)
        expect(filtered.data['@odata.count']).to.be.greaterThan(0)

        const ordered = await GET`/odata/v4/travel/Travels?$filter=IsActiveEntity eq true&$top=5&$orderby=Customer/Name asc&$select=ID&$expand=Customer($select=Name)`
        const names = ordered.data.value.map(t => t.Customer?.Name).filter(Boolean)
        expect(names).to.eql([...names].sort())
    })

    it('follows the association back: replicated Flights → local Bookings', async () => {
        const booking = await SELECT.one.from('sap.capire.travels.Bookings').where({ Flight_ID: { '!=': null } })
        const { Flight_ID, Flight_date } = booking
        const { data } = await GET(
            `/odata/v4/travel/Flights?$filter=ID eq '${Flight_ID}' and date eq ${Flight_date}&$select=ID&$expand=Bookings($select=Travel_ID,Pos)`,
        )
        const expected = await SELECT.from('sap.capire.travels.Bookings').where({ Flight_ID, Flight_date })
        expect(data.value[0].Bookings.length).to.equal(expected.length)
    })

    it('aggregates local amounts grouped by a replicated column', async () => {
        const { status, data } = await GET`/odata/v4/travel/Bookings?$apply=groupby((Flight/airline),aggregate(FlightPrice with sum as total))`
        expect(status).to.equal(200)
        const groups = data.value.filter(r => r.Flight?.airline)
        expect(groups.length).to.be.greaterThan(1)
        const [first] = groups
        const [{ sum }] = await SELECT`sum(b.FlightPrice) as sum`
            .from('sap.capire.travels.Bookings as b')
            .join('sap.capire.xflights.Flights as f').on`f.ID = b.Flight_ID and f.date = b.Flight_date`
            .where`f.airline = ${first.Flight.airline}`
        expect(Number(first.total)).to.equal(Number(sum))
    })
})
