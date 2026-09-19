/* eslint-disable no-console */
import cds from '@sap/cds'
import fs from 'node:fs'

const { local } = cds.utils, { DIMMED, RESET } = cds.utils.colors
const sflight = process.argv[2] === '--from' ? process.argv[3] : cds.error `Usage: migrate.mjs --from <sflight-home-dir>`
const namespace = 'sap.capire.flights'
await cds.deploy(sflight+'/app')
const ET_ = {

  Connections:
    SELECT.from `sap.fe.cap.travel.FlightConnection {
      AirlineID || ConnectionID as ID,
      AirlineID as airline_ID,
      DepartureAirport_AirportID as origin_ID,
      DestinationAirport_AirportID as destination_ID,
      DepartureTime as departure,
      ArrivalTime as arrival,
      Distance as distance,
    }`
    .then (rows => {
      let GA0018 = rows.find (r => r.ID === 'GA0018')
      let XA0018 = { ...GA0018,
        origin_ID: GA0018.destination_ID,
        destination_ID: GA0018.origin_ID,
        departure: time4 (GA0018.departure, +3 *hours),
        arrival: time4 (GA0018.arrival, +3 *hours),
      }
      return rows.concat ([
        { ...XA0018, ID: 'EA0018', airline_ID: 'EA' },
        { ...XA0018, ID: 'FA0018', airline_ID: 'FA' },
        { ...XA0018, ID: 'OC0018', airline_ID: 'OC' },
        { ...XA0018, ID: 'SW0018', airline_ID: 'SW' },
      ])
    }),

  Flights:
    SELECT.from `sap.fe.cap.travel.Flight {
      AirlineID || ConnectionID as flight_ID,
      FlightDate as date,
      PlaneType as aircraft,
      Price as price,
      CurrencyCode_code as currency_code,
      MaximumSeats as maximum_seats,
      OccupiedSeats as occupied_seats,
    }`
    .then (rows => {
      let GA0018 = rows.find (r => r.flight_ID === 'GA0018')
      let XA0018 = { ...GA0018,
        date: date4 (GA0018.date, +7 *days),
      }
      return rows.concat ([
        { ...XA0018, flight_ID: 'EA0018' },
        { ...XA0018, flight_ID: 'FA0018' },
        { ...XA0018, flight_ID: 'OC0018' },
        { ...XA0018, flight_ID: 'SW0018' },
      ])
    }),

}

const hours = 1000*60*60
const days = 24 * hours

const time4 = (time,delta) => new Date (
  new Date(`2000-01-01T${time}Z`).getTime() + delta
).toISOString().slice(11,16)

const date4 = (date,delta) => new Date (
  new Date(`${date}/00:00:00Z`).getTime() + delta
).toISOString().slice(0,10)

const quoted = x => {
  if (typeof x === 'string') {
    if (x.startsWith('"') && x.endsWith('"')) return x // already quoted
    if (x.endsWith(',')) x = x.slice(0, -1) // remove trailing comma
    if (x.includes(',') || x.includes('\n')) return `"${x.replace(/"/g,'""')}"`
  }
  return x
}

await Promise.all (Object.entries(ET_).map(async ([ key, rows ]) => {
  const file = import.meta.dirname + '/' + `${namespace}-${key}.csv`
  console.log('  extracting to:', DIMMED + local(file), RESET)
  let csv = fs.createWriteStream (file), i=0
  for (let r of await rows) {
    if (i++ === 0) csv.write (Object.keys(r).join(',') +'\n')
    csv.write (Object.values(r).map(quoted).join(',') +'\n')
  }
  csv.end()
}))
console.log()
