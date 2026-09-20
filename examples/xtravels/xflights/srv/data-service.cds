using sap.capire.flights as x from '../db/schema';
namespace sap.capire.flights;

/**
 * Master data service providing flight-related data, e.g. Flights, Airlines,
 * Airports, and Supplements (e.g. extra luggage, meals, etc.).
 */
@hcql @rest @odata @graphql @mcp
service FlightsService {

  // Serve Flights data via denormalized view with flattened FlightConnections
  @readonly entity Flights as select from x.Flights left join x.FlightConnections on ID = flight.ID {
    key ID, key date, *
  } excluding { flight, createdAt, createdBy, modifiedBy } // as flight details are flattened

  // Serve Airlines with redirected association to Flights view
  @readonly entity Airlines as projection on x.Airlines { *,
    flights : redirected to Flights
  } excluding { createdAt, createdBy, modifiedBy };

  // Serve Airports with redirected associations to Flights view
  @readonly entity Airports as projection on x.Airports { *,
    departures : redirected to Flights,
    arrivals   : redirected to Flights
  } excluding { createdAt, createdBy, modifiedBy };

  // Serve Supplements data as is
  @readonly entity Supplements as projection on x.Supplements {
    *, type.name as type,
  } excluding { createdAt, createdBy, modifiedBy };

  // Custom actions and events to sync with consumers about flight seat availability
  action ReserveSeats ( flight: Flights:ID, date: Flights:date, seats: array of Integer);
  action ReleaseSeats ( flight: Flights:ID, date: Flights:date, seats: array of Integer);
  event FlightsUpdated { flight: Flights:ID; date: Flights:date; };
}



// Temporary workarounds
using from './.workarounds';
