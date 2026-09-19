const cds = require('@sap/cds')
const {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
} = require('../../support/xtravels')

/**
 * The S/4 Business Partner API bound as OData **V2** — the protocol xtravels'
 * `[production]` profile configures for a real S/4 system, and a different wire
 * format from V4: `d.results`, `/Date(…)/`, `$inlinecount`.
 *
 * The app repo has its own V2 suite; this one keeps the plugin's V2 replicate
 * path (static `where` with `==`, renames, date mapping) covered by our CI.
 */
describe.skipIf(!isXtravelsAvailable())('xtravels — replicate over OData V2', () => {

    beforeAll(async () => {
        await startXtravelsProviders({ s4Protocol: 'v2' })
    }, 120000)

    afterAll(async () => {
        await stopXtravelsProviders()
    })

    const { POST, expect, axios } = cds.test(XTRAVELS_DIR)
    axios.defaults.auth = { username: 'alice', password: 'admin' }

    const S4 = 'API_BUSINESS_PARTNER.A_BusinessPartner'

    // `preload: true` runs in the background, so a read right after boot races
    // it. Run the pipeline explicitly and assert on a settled state.
    beforeAll(async () => {
        const { status } = await POST('/pipeline/execute', { name: 'Customers' })
        expect(status).to.equal(200)
    }, 60000)

    it('binds S/4 as odata-v2', () => {
        const binding = cds.env.requires['sap.capire.s4.business-partner']
        expect(binding.kind).to.equal('odata-v2')
        expect(binding.credentials.url).to.contain('/odata/v2/')
    })

    it('fills the replica from the V2 endpoint', async () => {
        const rows = await SELECT.from('sap.capire.s4.Customers')
        expect(rows.length).to.be.greaterThan(0)
        const sample = rows[0]
        expect(sample).to.include.keys('ID', 'Name', 'modifiedAt')
        expect(sample).to.not.have.property('PersonFullName')
        // `/Date(…)/` must not leak into the local table
        expect(String(sample.modifiedAt)).to.not.contain('/Date(')
    })

    it("sends the view's `== '1'` as a V2 $filter and skips organizations", async () => {
        const s4 = await cds.connect.to('sap.capire.s4.business-partner')
        await s4.run(INSERT.into(S4).entries(
            { BusinessPartner: 'ORG321', PersonFullName: 'Cyberdyne Systems', BusinessPartnerCategory: '2' },
        ))
        await s4.run(INSERT.into(S4).entries(
            { BusinessPartner: 'PER321', PersonFullName: 'Ada Byron', BusinessPartnerCategory: '1' },
        ))
        try {
            const { status } = await POST('/pipeline/execute', { name: 'Customers' })
            expect(status).to.equal(200)
            const ids = (await SELECT`ID`.from('sap.capire.s4.Customers')).map(c => c.ID)
            expect(ids).to.include('PER321')
            expect(ids).to.not.include('ORG321')
        } finally {
            await s4.run(DELETE.from(S4, { BusinessPartner: 'ORG321' }))
            await s4.run(DELETE.from(S4, { BusinessPartner: 'PER321' }))
            await DELETE.from('sap.capire.s4.Customers').where({ ID: { in: ['ORG321', 'PER321'] } })
        }
    })
})
