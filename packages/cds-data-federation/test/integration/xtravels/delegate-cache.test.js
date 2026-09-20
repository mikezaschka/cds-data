const cds = require('@sap/cds')
const {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
} = require('../../support/xtravels')

/**
 * `FederationShowcaseService.Airports` — delegation with a cds-caching response
 * cache, against the real xflights server.
 *
 * What matters is what does *not* happen: a repeated query must not produce a
 * second request to the remote. Counting is done on the outgoing remote proxy,
 * so a cache hit is observable rather than inferred from timing.
 */
describe.skipIf(!isXtravelsAvailable())('xtravels — Airports (delegate + response cache)', () => {

    beforeAll(async () => {
        await startXtravelsProviders()
    }, 120000)

    afterAll(async () => {
        await stopXtravelsProviders()
    })

    const { GET, expect, axios } = cds.test(XTRAVELS_DIR)
    axios.defaults.auth = { username: 'alice', password: 'admin' }

    let remoteReads = 0

    beforeAll(async () => {
        const flights = await cds.connect.to('sap.capire.flights.FlightsService')
        flights.before('READ', 'Airports', () => { remoteReads++ })
    })

    beforeEach(async () => {
        const cache = await cds.connect.to('caching')
        await cache.deleteByTag('federation:Airports')
        remoteReads = 0
    })

    it('fetches once, then serves repeats from the cache', async () => {
        const first = await GET`/showcase/Airports?$orderby=ID`
        expect(first.status).to.equal(200)
        expect(first.data.value.length).to.be.greaterThan(0)
        expect(remoteReads).to.equal(1)

        const second = await GET`/showcase/Airports?$orderby=ID`
        expect(remoteReads).to.equal(1)
        expect(second.data.value).to.eql(first.data.value)
    })

    it('treats a different query as a different entry', async () => {
        await GET`/showcase/Airports?$orderby=ID`
        await GET`/showcase/Airports?$orderby=ID&$top=2`
        expect(remoteReads).to.equal(2)

        await GET`/showcase/Airports?$orderby=ID&$top=2`
        expect(remoteReads).to.equal(2)
    })

    it('refetches after the entity is invalidated by its tag', async () => {
        await GET`/showcase/Airports?$orderby=ID`
        await GET`/showcase/Airports?$orderby=ID`
        expect(remoteReads).to.equal(1)

        const cache = await cds.connect.to('caching')
        await cache.deleteByTag('federation:Airports')

        await GET`/showcase/Airports?$orderby=ID`
        expect(remoteReads).to.equal(2)
    })

    it('still restricts columns to the projection when cached', async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
            const { data } = await GET`/showcase/Airports?$top=1&$orderby=ID`
            expect(data.value[0]).to.include.keys('ID', 'name', 'city')
            expect(data.value[0]).to.not.have.property('modifiedAt')
            expect(data.value[0]).to.not.have.property('arrivals')
        }
        expect(remoteReads).to.equal(1)
    })
})
