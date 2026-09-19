#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * update-flights-dates — refresh flight dates so the running app shows
 * a usable mix of past and upcoming flights.
 *
 *   - Each flight row gets a random date in [today − 60, today + 90].
 *   - About one third land in the past bucket, two thirds in the future.
 *
 * Two CSV files are kept in sync (they share `(flight_ID/ID, date)` as key):
 *   1. db/data/sap.capire.flights-Flights.csv             (the source of truth)
 *   2. apis/data-service/data/sap.capire.flights.FlightsService.Flights.csv
 *      (the published data-service projection — uses `ID` instead of
 *      `flight_ID` and has additional columns; only the matching `date`
 *      values are copied across.)
 *
 * Quoted fields with embedded commas are preserved.
 *
 * Usage: node scripts/update-flights-dates.js
 *        npm run update-flights-dates
 */

const fs = require('fs')
const path = require('path')

const DB_FLIGHTS  = path.resolve(__dirname, 'sap.capire.flights-Flights.csv')
const API_FLIGHTS = path.resolve(__dirname, '../../apis/data-service/data/sap.capire.flights.FlightsService.Flights.csv')

const PAST_DAYS   = 60
const FUTURE_DAYS = 90
const PAST_FRACTION = 1 / 3

const DAY_MS = 86_400_000

const today = new Date()
today.setUTCHours(0, 0, 0, 0)

const isoDate = d => d.toISOString().slice(0, 10)
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS)
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

function parseCSV(text) {
  const rows = []
  let row = [], cur = '', inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = false
      } else cur += ch
    } else {
      if (ch === '"') inQuote = true
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else if (ch === '\r') { /* skip */ }
      else cur += ch
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '')
    rows.pop()
  return rows
}

const serializeCSV = rows => rows.map(r => r.map(cell => {
  const s = cell ?? ''
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}).join(',')).join('\n') + '\n'

function loadCSV(file) {
  const rows = parseCSV(fs.readFileSync(file, 'utf8'))
  const header = rows[0]
  const records = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  return { header, records }
}

const saveCSV = (file, header, records) =>
  fs.writeFileSync(file, serializeCSV([header, ...records.map(r => header.map(h => r[h] ?? ''))]))

// ---- 1. db/data/Flights — primary file ------------------------------------
const db = loadCSV(DB_FLIGHTS)
const idCol = db.header.includes('flight_ID') ? 'flight_ID' : 'ID'

// Group rows by flight_ID; assign distinct dates per group so the
// (flight_ID, date) primary key stays unique.
const rowsByFlight = new Map()
for (const row of db.records) {
  const id = row[idCol]
  if (!rowsByFlight.has(id)) rowsByFlight.set(id, [])
  rowsByFlight.get(id).push(row)
}

const sample = (n, lo, hi) => {
  const set = new Set()
  let attempts = 0
  while (set.size < n && attempts < n * 20) {
    set.add(randInt(lo, hi))
    attempts++
  }
  return [...set]
}

// Map from (flight_ID, originalDate) -> newDate, used to update the projection.
const dateMap = new Map()

let pastCount = 0, futureCount = 0
for (const [id, rows] of rowsByFlight) {
  const wantPast   = Math.round(rows.length * PAST_FRACTION)
  const wantFuture = rows.length - wantPast
  const offsets = []
  for (const o of sample(wantPast,   1, PAST_DAYS))   offsets.push(-o)
  for (const o of sample(wantFuture, 0, FUTURE_DAYS)) offsets.push(o)
  while (offsets.length < rows.length) offsets.push(randInt(-PAST_DAYS, FUTURE_DAYS))
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]]
  }
  for (let i = 0; i < rows.length; i++) {
    const original = rows[i].date
    const fresh    = isoDate(addDays(today, offsets[i]))
    dateMap.set(`${id}|${original}`, fresh)
    rows[i].date = fresh
    if (fresh < isoDate(today)) pastCount++
    else                        futureCount++
  }
}

saveCSV(DB_FLIGHTS, db.header, db.records)

// ---- 2. apis/data-service/data/Flights — projection, copy values across ---
const api = loadCSV(API_FLIGHTS)
const apiIdCol = api.header.includes('flight_ID') ? 'flight_ID' : 'ID'
let apiTouched = 0, apiSkipped = 0
for (const row of api.records) {
  const fresh = dateMap.get(`${row[apiIdCol]}|${row.date}`)
  if (fresh) { row.date = fresh; apiTouched++ }
  else apiSkipped++
}
saveCSV(API_FLIGHTS, api.header, api.records)

// ---- 3. Report ------------------------------------------------------------
console.log(`Updated ${db.records.length} flights in db/data:`)
console.log(`  past   : ${pastCount}  (${(pastCount   / db.records.length * 100).toFixed(1)}%)`)
console.log(`  future : ${futureCount} (${(futureCount / db.records.length * 100).toFixed(1)}%)`)
console.log(`Synced ${apiTouched} flights into apis/data-service/data.`)
if (apiSkipped) console.log(`  (${apiSkipped} rows in the projection had no match in db/data — left unchanged)`)
console.log()
console.log('NOTE: db/data/sap.capire.flights-Flights.csv and the matching projection have')
console.log('been rewritten in place. These changes are for your local development only —')
console.log('please do NOT commit them back to git.')
