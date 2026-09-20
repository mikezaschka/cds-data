const cds = require('@sap/cds')
const {
    XTRAVELS_DIR,
    isXtravelsAvailable,
    startXtravelsProviders,
    stopXtravelsProviders,
} = require('../../support/xtravels')

/**
 * CUD opt-in against a real remote: `HotelBookings` is annotated
 * `@federation.delegate: { writable: true }`, `Hotels` is not.
 *
 * Writes are synchronous and pass straight through — nothing is stored locally
 * and nothing is outboxed, because the caller is waiting for the remote's
 * answer. Each assertion checks the *other process*, not our response.
 */
describe.skipIf(!isXtravelsAvailable())('xtravels — write-through (HotelBookings)', () => {

    beforeAll(async () => {
        await startXtravelsProviders()
    }, 120000)

    afterAll(async () => {
        await stopXtravelsProviders()
    })

    const { GET, POST, PATCH, DELETE: httpDelete, expect, axios } = cds.test(XTRAVELS_DIR)
    axios.defaults.auth = { username: 'alice', password: 'admin' }
    axios.defaults.validateStatus = () => true

    const HOTELS = 'sap.capire.hotels.HotelsService'
    const onHotels = async q => (await cds.connect.to(HOTELS)).run(q)

    const aBooking = async () => {
        const [hotel] = await onHotels(SELECT.from(`${HOTELS}.Hotels`).columns('ID'))
        return { hotel_ID: hotel.ID, guest: 'Katherine Johnson', checkIn: '2027-07-01', checkOut: '2027-07-04', rooms: 1, totalPrice: 900 }
    }

    it('forwards CREATE to the remote', async () => {
        const { status, data } = await POST('/showcase/HotelBookings', await aBooking())
        expect(status).to.equal(201)
        try {
            const remote = await onHotels(SELECT.from(`${HOTELS}.Bookings`).where({ ID: data.ID }))
            expect(remote).to.have.length(1)
            expect(remote[0].guest).to.equal('Katherine Johnson')
        } finally {
            await httpDelete(`/showcase/HotelBookings(${data.ID})`)
        }
    })

    it('forwards UPDATE and DELETE to the remote', async () => {
        const created = await POST('/showcase/HotelBookings', await aBooking())
        const { ID } = created.data

        const patched = await PATCH(`/showcase/HotelBookings(${ID})`, { rooms: 5 })
        expect(patched.status).to.be.oneOf([200, 204])
        const [afterPatch] = await onHotels(SELECT.from(`${HOTELS}.Bookings`).where({ ID }))
        expect(afterPatch.rooms).to.equal(5)

        const removed = await httpDelete(`/showcase/HotelBookings(${ID})`)
        expect(removed.status).to.equal(204)
        expect(await onHotels(SELECT.from(`${HOTELS}.Bookings`).where({ ID }))).to.have.length(0)
    })

    it('stores nothing locally for a written entity', async () => {
        const created = await POST('/showcase/HotelBookings', await aBooking())
        try {
            const tables = (await cds.db.run("select name from sqlite_master where type='table'")).map(t => t.name)
            expect(tables.some(n => n.includes('HotelBookings'))).to.be.false
            const { data } = await GET(`/showcase/HotelBookings(${created.data.ID})`)
            expect(data.guest).to.equal('Katherine Johnson') // read back over the wire
        } finally {
            await httpDelete(`/showcase/HotelBookings(${created.data.ID})`)
        }
    })

    it('rejects CUD on an entity without write flags', async () => {
        const [hotel] = await onHotels(SELECT.from(`${HOTELS}.Hotels`).columns('ID'))
        const created = await POST('/showcase/Hotels', { name: 'Nope' })
        const patched = await PATCH(`/showcase/Hotels(${hotel.ID})`, { name: 'Nope' })
        const deleted = await httpDelete(`/showcase/Hotels(${hotel.ID})`)
        expect([created.status, patched.status, deleted.status]).to.eql([405, 405, 405])

        const [unchanged] = await onHotels(SELECT.from(`${HOTELS}.Hotels`).columns('ID', 'name').where({ ID: hotel.ID }))
        expect(unchanged.name).to.not.equal('Nope')
    })
})
