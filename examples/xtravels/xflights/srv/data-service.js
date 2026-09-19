const cds = require ('@sap/cds')
class DataService extends cds.ApplicationService { init() {

  const { Flights } = cds.entities ('sap.capire.flights')

  this.on ('ReserveSeats', async req => {
    const { flight, date, seats = [null] } = req.data
    const confirmed = await UPDATE (Flights, { flight_ID:flight, date })
      .set `occupied_seats = occupied_seats + ${seats.length}`
      .where `free_seats >= ${seats.length}`
    if (!confirmed) req.reject('Flight is fully booked')
    this.emit('FlightsUpdated', { flight, date })
  })

  this.on ('ReleaseSeats', async (req) => {
    const { flight, date, seats = [null] } = req.data
    await UPDATE (Flights, { flight_ID:flight, date })
      .set `occupied_seats = occupied_seats - ${seats.length}`
    this.emit('FlightsUpdated', { flight, date })
  })

  return super.init()

}}
module.exports = DataService
