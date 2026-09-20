// just a tag file for plug & play

// The below are dummy handlers for testing with mocked service only
// This will not be required with upcomming cds v10.1 any longer
require('@sap/cds').on('serving:sap.capire.flights.FlightsService', srv => {
  if (srv.mocked) {
    srv.on ('ReserveSeats', ()=>{})
    srv.on ('ReleaseSeats', ()=>{})
  }
})
