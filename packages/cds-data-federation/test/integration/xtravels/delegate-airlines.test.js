const cds = require('@sap/cds')
const {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
} = require('../../support/xtravels')

/**
 * Scenario 1 — `FederationShowcaseService.Airlines`: a plain @federation.delegate
 * onto xflights, bound as HCQL by xtravels' `federated` profile.
 *
 * The app's own suite (test/federation-delegate.test.js in the xtravels repo)
 * covers the same entity against in-process mocks. This one runs against the
 * real xflights server, so query translation over the wire is what is under
 * test: composed filters, functions, paging, $count, ordering, key access.
 */
describe.skipIf(!isXtravelsAvailable())('xtravels — Airlines (delegate over HCQL)', () => {

    beforeAll(async () => {
        await startXtravelsProviders()
    }, 120000)

    afterAll(async () => {
        await stopXtravelsProviders()
    })

    const { GET, POST, expect, axios } = cds.test(XTRAVELS_DIR)
    axios.defaults.auth = { username: 'alice', password: 'admin' }
    axios.defaults.validateStatus = () => true

    /** Ground truth, read straight from the provider process. */
    let remote
    beforeAll(async () => {
        const flights = await cds.connect.to('sap.capire.flights.FlightsService')
        remote = await flights.run(SELECT.from('sap.capire.flights.FlightsService.Airlines'))
        expect(remote.length).to.be.greaterThan(2)
    })

    describe('reads', () => {
        it('serves every remote row', async () => {
            const { status, data } = await GET`/showcase/Airlines`
            expect(status).to.equal(200)
            expect(data.value).to.have.length(remote.length)
        })

        it('restricts columns to the projection', async () => {
            const { data } = await GET`/showcase/Airlines?$top=1`
            expect(data.value[0]).to.include.keys('ID', 'name', 'icon')
            expect(data.value[0]).to.not.have.property('modifiedAt')
        })

        it('reads by key', async () => {
            const { ID, name } = remote[0]
            const { status, data } = await GET(`/showcase/Airlines('${ID}')`)
            expect(status).to.equal(200)
            expect(data).to.include({ ID, name })
        })

        it('returns 404 for an unknown key', async () => {
            const { status } = await GET`/showcase/Airlines('NOPE')`
            expect(status).to.equal(404)
        })
    })

    describe('$filter translation', () => {
        it('eq on a projected column', async () => {
            const { data } = await GET(`/showcase/Airlines?$filter=name eq '${remote[0].name}'`)
            expect(data.value.map(a => a.ID)).to.eql([remote[0].ID])
        })

        it('ne excludes exactly one row', async () => {
            const { data } = await GET(`/showcase/Airlines?$filter=ID ne '${remote[0].ID}'`)
            expect(data.value).to.have.length(remote.length - 1)
            expect(data.value.map(a => a.ID)).to.not.include(remote[0].ID)
        })

        it('or of two eq conditions', async () => {
            const [a, b] = remote
            const { data } = await GET(
                `/showcase/Airlines?$filter=ID eq '${a.ID}' or ID eq '${b.ID}'&$orderby=ID`,
            )
            expect(data.value.map(r => r.ID)).to.eql([a.ID, b.ID].sort())
        })

        it('and of two conditions', async () => {
            const { ID, name } = remote[0]
            const { data } = await GET(
                `/showcase/Airlines?$filter=ID eq '${ID}' and name eq '${name}'`,
            )
            expect(data.value).to.have.length(1)
        })

        it('not with a parenthesised group', async () => {
            const [a, b] = remote
            const { data } = await GET(
                `/showcase/Airlines?$filter=not (ID eq '${a.ID}' or ID eq '${b.ID}')`,
            )
            expect(data.value).to.have.length(remote.length - 2)
        })

        it('in operator', async () => {
            const [a, b] = remote
            const { data } = await GET(`/showcase/Airlines?$filter=ID in ('${a.ID}','${b.ID}')`)
            expect(data.value).to.have.length(2)
        })

        it('startswith / endswith / contains functions', async () => {
            const { name } = remote[0]
            const head = name.slice(0, 3)
            const tail = name.slice(-3)
            const middle = name.slice(1, Math.max(4, name.length - 1))

            const starts = await GET(`/showcase/Airlines?$filter=startswith(name,'${head}')`)
            const ends = await GET(`/showcase/Airlines?$filter=endswith(name,'${tail}')`)
            const has = await GET(`/showcase/Airlines?$filter=contains(name,'${middle}')`)

            for (const res of [starts, ends, has]) expect(res.status).to.equal(200)
            expect(starts.data.value.map(a => a.ID)).to.include(remote[0].ID)
            expect(ends.data.value.map(a => a.ID)).to.include(remote[0].ID)
            expect(has.data.value.map(a => a.ID)).to.include(remote[0].ID)
            expect(starts.data.value.every(a => a.name.startsWith(head))).to.be.true
        })

        it('tolower comparison', async () => {
            const { name, ID } = remote[0]
            const { status, data } = await GET(
                `/showcase/Airlines?$filter=tolower(name) eq '${name.toLowerCase()}'`,
            )
            expect(status).to.equal(200)
            expect(data.value.map(a => a.ID)).to.eql([ID])
        })

        it('filters on a column that is projected but not selected', async () => {
            const { data } = await GET(
                `/showcase/Airlines?$filter=name eq '${remote[0].name}'&$select=ID`,
            )
            expect(data.value).to.have.length(1)
            expect(data.value[0]).to.not.have.property('name')
        })
    })

    describe('$orderby, paging and $count', () => {
        it('orders ascending and descending', async () => {
            const asc = await GET`/showcase/Airlines?$orderby=name asc`
            const desc = await GET`/showcase/Airlines?$orderby=name desc`
            const names = remote.map(a => a.name).sort()
            expect(asc.data.value.map(a => a.name)).to.eql(names)
            expect(desc.data.value.map(a => a.name)).to.eql([...names].reverse())
        })

        it('orders by two columns', async () => {
            const { status, data } = await GET`/showcase/Airlines?$orderby=name asc,ID desc`
            expect(status).to.equal(200)
            expect(data.value).to.have.length(remote.length)
        })

        it('pages with $top and $skip', async () => {
            const all = (await GET`/showcase/Airlines?$orderby=ID`).data.value.map(a => a.ID)
            const page1 = await GET`/showcase/Airlines?$orderby=ID&$top=2`
            const page2 = await GET`/showcase/Airlines?$orderby=ID&$top=2&$skip=2`
            expect(page1.data.value.map(a => a.ID)).to.eql(all.slice(0, 2))
            expect(page2.data.value.map(a => a.ID)).to.eql(all.slice(2, 4))
        })

        it('reports $count alongside a page', async () => {
            const { data } = await GET`/showcase/Airlines?$count=true&$top=1`
            expect(data['@odata.count']).to.equal(remote.length)
            expect(data.value).to.have.length(1)
        })

        it('reports $count with a filter applied', async () => {
            const { data } = await GET(
                `/showcase/Airlines?$count=true&$filter=ID ne '${remote[0].ID}'&$top=1`,
            )
            expect(data['@odata.count']).to.equal(remote.length - 1)
        })
    })

    describe('writes', () => {
        it('rejects CUD with 405 and leaves the remote untouched', async () => {
            const { status } = await POST('/showcase/Airlines', { ID: 'ZZ', name: 'Nope' })
            expect(status).to.equal(405)
            const flights = await cds.connect.to('sap.capire.flights.FlightsService')
            const after = await flights.run(
                SELECT.from('sap.capire.flights.FlightsService.Airlines').where({ ID: 'ZZ' }),
            )
            expect(after).to.have.length(0)
        })
    })
})
