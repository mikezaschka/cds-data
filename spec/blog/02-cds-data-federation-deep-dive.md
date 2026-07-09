---
title: "cds-data-federation in depth — alternatives, a reproducible xflights demo, and an agent-driven scaffold"
description: "A deep dive into @federation.delegate and @federation.replicate, how they relate to SAP and community alternatives (xtravels, Risk Management, HANA SDA, Datasphere, SAP Graph, cds-caching, @cap-js-community/common), plus a fully reproducible travel-extension demo on top of SAP's @capire/xflights provider, built two ways: by hand, then by an AI coding agent."
date: 2026-05-23
author: Mike Zaschka
tags: [SAP CAP, cds-data-federation, side-by-side extensions, xflights, xtravels, AI coding agents]
---

# cds-data-federation in depth — alternatives, a reproducible xflights demo, and an agent-driven scaffold

> **Series — part 2 of 2.** [Part 1](./01-introducing-cds-data.md) introduced the toolkit. This post zooms into the federation plugin: how the two strategies behave, how they map to existing SAP and community options, and how to build the same demo project twice — once by hand, once by an AI coding agent.

The shape of a CAP side-by-side extension is reasonably stable. There is a remote SAP service (S/4HANA Cloud, SuccessFactors, Ariba, Concur, an aggregated SAP Graph context, or a reference provider like [`@capire/xflights`](https://github.com/capire/xflights)); a destination or `cds.requires` block wires CAP to it; one or more consumption views project remote entities into the extension's schema; local entities — notes, tags, scoring, approval state, audit logs — sit next to them with managed associations; a Fiori Elements UI consumes the combined model. The thing that varies project to project is the *assembly* between the consumption view and the runtime: read forwarding, write opt-in, cross-service `$expand`, scheduled sync, caching, retry, delta tracking.

`cds-data-federation` exposes that assembly as two annotations on the consumption view: `@federation.delegate` for live forwarding, `@federation.replicate` for scheduled sync. The remaining sections of this post walk through how the annotations behave, what the alternatives are, and how to build a small travel-extension on top of xflights using the plugin — first by hand, then with an AI coding agent.

---

## The two strategies

Pick one annotation per consumption view:

| Strategy | Annotation | Behavior | Reach for it when |
|---|---|---|---|
| **Delegate** | `@federation.delegate` | Live proxy. Every read goes to the remote at request time. CUD opt-in per operation. | The data must be strictly consistent with the system of record, writes must land in S/4HANA / SuccessFactors / Ariba, or the dataset is too large to copy. |
| **Replicate** | `@federation.replicate` | Scheduled sync into the local DB. Subsequent reads served from local SQL. | Joins across local and remote, analytics and aggregations, resilience during remote outages, offline capability. |

Caching is orthogonal to the strategy, configured as an option on either annotation:

- `cache.strategy: 'response'` — TTL-keyed response cache via [`cds-caching`](https://github.com/mikezaschka/cds-caching). Fits when the same query repeats inside the TTL window.
- `cache.strategy: 'entity'` — full-entity SQLite snapshot refreshed on TTL miss, backed by `cds-data-pipeline`. Fits when arbitrary queries against the same entity repeat inside the TTL window.

The full annotation reference (every option, type, default) lives at [Federation → Annotations](https://mikezaschka.github.io/cds-data/federation/reference/annotations).

---

## What the federation plugin does inside the CAP runtime

At `cds.on('loaded')`, the scanner walks CSN for `@federation.*` annotations and extracts:

- **Source service** — from the `projection on remoteService.RemoteEntity` clause.
- **Projected columns** — the upper bound for `$select` on remote calls.
- **Bidirectional rename mapping** — `localToRemote` for outbound queries, `remoteToLocal` for inbound responses, derived from the `as` clauses.
- **Strategy and options** — `delegate` vs. `replicate`, and any `cache`, `writable`, `schedule`, `delta`, `rest` sub-options.

At `cds.once('served')`:

- For each `@federation.delegate` entity the plugin registers an `on('READ', Entity, …)` handler (plus optional `on('CREATE' | 'UPDATE' | 'DELETE', …)` if the CUD flags are set). The handler clones `req.query`, applies the rename map and column restriction, and calls `remote.run(query)`. Cross-service `$expand` items are stripped, executed separately against the correct service, then stitched on the foreign key.
- For each `@federation.replicate` entity the plugin calls `addPipeline({ … })` on `DataPipelineService` via `srv/pipeline-binding.js`. The entity-shape config gives the engine enough information to derive `kind: 'replicate'` and `mode: 'delta'`.

Both flows ride on the [Calesi pattern](https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern). The remote service is a CAP service like any other; CAP handles destination resolution, mocking, and the OData → CQN translation. The plugin adds the rename map, column restriction, cross-service stitching, CUD opt-in, schedule, delta tracking, and the pipeline binding.

---

## A worked example: a personal travel extension on top of xflights

[`@capire/xflights`](https://github.com/capire/xflights) is SAP's reference master-data provider for flights, airlines, airports, and supplements. It is the same provider [xtravels](https://github.com/capire/xtravels) consumes in the SAP-blessed federation sample, so the entity shape, naming, and OData V4 surface are exactly what a real CAP federation looks like in practice. It also has the practical advantage of being clonable and runnable locally — no destination, no API key, no SAP API Hub registration.

The demo below is a small **travel-extension app** sitting next to xflights: live airline lookups, a cached airport list for autocomplete, a replicated flight schedule for SQL-side analytics, plus local-owned entities (a watchlist, bookings, and notes) joined to the federated data through cross-service `$expand`.

### Domain shape

```
xflights provider (port 4444)                  Travel extension (port 4004)
───────────────────────────────                ───────────────────────────────
sap.capire.flights.data
  Airlines   ────────────────────────────────►   Airlines           (@federation.delegate)
  Airports   ────────────────────────────────►   Airports           (@federation.delegate
                                                                      + 30s response cache)
  Flights    ────────────────────────────────►   ReplicatedFlights  (@federation.replicate
                                                                      every 10 min)
  Supplements ───────────────────────────────►   Supplements        (@federation.delegate)

                                               local entities (SQLite)
                                                 Bookings           ─► assoc to Airlines + Airports (delegate)
                                                 FlightWatchlist    ─► assoc to ReplicatedFlights (local SQL)
                                                 AirportNotes       ─► assoc to Airports (delegate)
                                                 AircraftStats      ─► GROUP BY over ReplicatedFlights (local SQL)
                                                 AvailableFlights   ─► filtered read model on ReplicatedFlights
```

`ReplicatedFlights` is the analytics view: SQL aggregations and `$apply` over the flight schedule are impractical over a live remote, so the engine keeps a local copy refreshed every 10 minutes. **`AircraftStats`** and **`AvailableFlights`** are read models on top of that local table — they only return data after a successful sync. **`FlightWatchlist`** stores price alerts with a managed association to **`ReplicatedFlights`** (composite key `ID` + `date`), so you can `$expand=flight` without calling xflights again. `Bookings` and `AirportNotes` stay on the delegate side for cross-service expand into live master data.

### The consumption views

```cds title="srv/travel-service.cds"
using from 'cds-data-pipeline/db';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
using { sap.capire.flights.data as flights } from './external/data-service';

namespace travel;

service TravelService {

  // 1. Live delegate — every read forwards to xflights.
  //    Field names match the imported OData CSN (currency/country/type are flattened to *_code).
  @federation.delegate
  entity Airlines as projection on flights.Airlines {
      ID,
      name,
      icon,
      currency_code
  };

  // 2. Live delegate + 30-second response cache — used by an autocomplete widget.
  @federation.delegate: { cache: { ttl: 30000 } }
  entity Airports as projection on flights.Airports {
      ID            as code,
      name          as fullName,
      city,
      country_code  as country
  };

  // 3. Live delegate — supplements catalog.
  @federation.delegate
  entity Supplements as projection on flights.Supplements {
      ID,
      type_code    as type,
      descr        as description,
      price,
      currency_code
  };

  // 4. Scheduled replication every 10 minutes for SQL-side analytics.
  //    Flights has a composite key (ID, date) — both keys are projected.
  //    mode: 'full' because the xflights Flights OData view excludes modifiedAt
  //    (no reliable delta watermark on the wire). First boot still needs a manual
  //    POST /pipeline/execute — see requests/travel-extension.http.
  @federation.replicate: { schedule: 600000, mode: 'full' }
  entity ReplicatedFlights as projection on flights.Flights {
      ID,
      date,
      aircraft,
      price,
      currency_code,
      maximum_seats,
      occupied_seats,
      free_seats,
      airline_ID,
      origin_ID,
      destination_ID
  };

  // 5. Read models over the replicated table — SQL views, not sibling tables.
  //    Empty until the first sync completes. cds-data-federation clears inherited
  //    @cds.persistence.table on projections/selects over @federation.replicate targets.
  @readonly
  entity AvailableFlights as projection on ReplicatedFlights {
      ID,
      date,
      aircraft,
      price,
      currency_code,
      free_seats,
      airline_ID,
      origin_ID,
      destination_ID
  } where free_seats > 0;

  @readonly
  entity AircraftStats as select from ReplicatedFlights {
      aircraft,
      count(*)          as flightCount    : Integer,
      avg(price)        as avgPrice       : Decimal(9, 4),
      sum(free_seats)   as totalFreeSeats : Integer
  } group by aircraft;

  // 6. Local-owned entities with associations to federated ones.
  entity Bookings {
      key ID               : UUID;
          passengerName    : String(100);
          airline          : Association to Airlines;
          departureAirport : Association to Airports;
          arrivalAirport   : Association to Airports;
          bookedAt         : Timestamp;
  }

  entity FlightWatchlist {
      key ID         : UUID;
          flight       : Association to ReplicatedFlights;
          watchedBy    : String(100);
          maxPrice     : Decimal(9, 4);
          createdAt    : Timestamp;
  }

  entity AirportNotes {
      key ID        : UUID;
          airport   : Association to Airports;
          author    : String(100);
          subject   : String(200);
          body      : String(2000);
          createdAt : Timestamp;
  }

}
```

Four `@federation.*` consumption views, two read models over the replicated table, three local entities. No JavaScript handler file — but `@federation.replicate` needs the pipeline **tracker** tables in your database (`using from 'cds-data-pipeline/db'`) and the **management OData** surface at `/pipeline` (`using from 'cds-data-pipeline/srv/DataPipelineManagementService'`) for manual sync and run history (see Step 4).

### What this gives you, query by query

After Step 6 you run these from [VS Code REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) or the built-in HTTP request editor (`.http` files). The teaching sequence is: sync replicated flights first, then query local analytics and `$expand` into the replicated copy.

```http title="requests/travel-extension.http (excerpt)"
@base = http://localhost:4004
@travel = {{base}}/odata/v4/travel

### Live airline read — one HTTP request to xflights
GET {{travel}}/Airlines?$top=5

### Cached airport autocomplete — run twice within 30s; second response is from cds-caching
GET {{travel}}/Airports?$filter=startswith(code,'F')&$select=code,fullName,city

### Bootstrap replication (required before ReplicatedFlights / AircraftStats return rows)
POST {{base}}/pipeline/execute
Content-Type: application/json

{ "name": "ReplicatedFlights", "mode": "full", "trigger": "manual" }

### Local SQL over the replicated schedule — no remote call
GET {{travel}}/ReplicatedFlights?$top=5&$orderby=price desc

### GROUP BY / $apply — rejected on delegate entities; works on replicated data
GET {{travel}}/AircraftStats?$orderby=avgPrice desc

### Filtered read model — only flights with free seats in the local copy
GET {{travel}}/AvailableFlights?$top=10

### Local booking with cross-service $expand into live delegate entities
GET {{travel}}/Bookings?$expand=airline,departureAirport,arrivalAirport

### Watchlist row with $expand into the replicated flight (local SQL join, no xflights call)
GET {{travel}}/FlightWatchlist?$expand=flight
```

### Triggering replication and inspecting the tracker

The pipeline engine exposes a management OData service at `/pipeline` once you included `using from 'cds-data-pipeline/srv/DataPipelineManagementService'`:

```http title="requests/travel-extension.http (pipeline section)"
@base = http://localhost:4004

### Trigger a full sync (independent of the 10-minute schedule)
POST {{base}}/pipeline/execute
Content-Type: application/json

{ "name": "ReplicatedFlights", "mode": "full", "trigger": "manual" }

### Inspect pipelines and their last-run state
GET {{base}}/pipeline/Pipelines?$select=name,status,lastSync,errorCount

### Drill into individual runs
GET {{base}}/pipeline/PipelineRuns?$orderby=startTime desc&$top=10

### Convenience function for one pipeline
GET {{base}}/pipeline/status(name='ReplicatedFlights')
```

`PipelineRuns` carries `status`, `startTime`, `endTime`, row statistics, and any error message. The same data is also available programmatically through the `DataPipelineService` API — useful when an action handler or a Fiori extension UI needs to surface sync state.

### Cross-service `$expand` mechanics

The `$expand=airline,departureAirport,arrivalAirport` query above is the most interesting one: a local entity with three federated expand items, all against the same provider. The plugin handles all four expand topologies — see the table below — and the full reference with mermaid diagrams lives at [Cross-Service Scenarios](https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios).

| Topology | Main entity | Expand target | Mechanism |
|---|---|---|---|
| Delegated expand | `@federation.delegate` | `@federation.delegate` (same provider) | Forward the full query; rename map applied to inner items. |
| Cross-service expand: local → remote | local or `@federation.replicate` | `@federation.delegate` | Strip the expand item, run local SQL, batch-fetch by FK, stitch. |
| Cross-service expand: remote → local | `@federation.delegate` | local or `@federation.replicate` | Run the remote query, batch-fetch the local side by FK, stitch. |
| Cross-service expand: cross-provider | local or `@federation.replicate` | `@federation.delegate` (multiple providers) | One batch-fetch per provider; stitch all sides. |

In every cross-service flow the remote side is `@federation.delegate`. The local side can be plain local CAP or `@federation.replicate` — both look like ordinary local tables at query time.

---

## Where the plugin sits, and what to pick when

### Application-layer alternatives — same architectural neighborhood

These options live inside the CAP app, like `cds-data-federation` does:

| Alternative | What it is | Pick it when |
|---|---|---|
| [**xtravels**](https://github.com/capire/xtravels) (SAP Service Integration reference sample) | Travel-booking consumer for [xflights](https://github.com/capire/xflights). Delegation via `on('READ', Entity, req => remote.run(req.query))` and a generic `@federated` handler in [`srv/data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js). | One or two federated entities, zero plugin dependencies, full handler ownership. The Part A walkthrough below uses xflights as the same provider so the two patterns are directly comparable. |
| [**Risk Management — ext-service branch**](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui) | SAP's S/4HANA mashup sample. Five handlers in [`risk-service.js`](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js) cover read delegation, write-back, value helps, navigation, and a mashup. | Extending Risk Management itself or staying close to the SAP-blessed sample shape. |
| [**Kai Niklas — CAP Remote Services + Fiori Elements**](https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/) | End-to-end blog with EDMX import, consumption view, Fiori UI. | A tutorial-level introduction to the same recipe, no plugin adoption. |
| [**Gregor Wolf — cap-replication-demo**](https://github.com/gregorwolf/cap-replication-demo) | Replication-focused demo against `API_BUSINESS_PARTNER`: action-triggered load, offset pagination loop driven by `$count`, per-entity column projection, `UPSERT().into()`, event-driven upsert on `sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1` via [Event Mesh](https://help.sap.com/docs/SAP_EM). | A canonical reference for the moving parts that a scheduled-sync plugin contributes — useful side-by-side before adopting `@federation.replicate`. |
| [**`@cap-js-community/common`** (Replication Cache)](https://github.com/cap-js-community/common) | Loads a full entity dataset into a per-tenant SQLite file on first access; serves subsequent queries from the snapshot within a TTL. Declarative via `@cds.replicate`. | Entity-level caching as the single concern, no field renames, no cross-service `$expand`, preference for that specific community package. Functionally close to `cds-data-federation`'s `cache.strategy: 'entity'`. |
| [**`cds-caching`**](https://github.com/mikezaschka/cds-caching) | Response-level cache for CAP services. | TTL-keyed caching on identical queries. The plugin's default `cache.strategy: 'response'` rides on this package. |

The [federation comparison matrix](https://mikezaschka.github.io/cds-data/federation/reference/comparison) puts these side-by-side row by row.

### Database-layer alternatives — integration in HANA Cloud

[HANA synonyms](https://cap.cloud.sap/docs/advanced/hana#native-hana-features) (`.hdbsynonym`) alias a table or view in another HANA schema. Common in CAP HDI containers paired with an S/4HANA CDS view schema. [HANA Smart Data Access](https://help.sap.com/docs/SAP_HANA_PLATFORM/6b94445c94ae495c83a19646e7c3fd56/6ce5a8dc7c0f44e28f12ff09db93b45c.html) provides virtual tables federating remote HANA, MSSQL, Oracle, Postgres into the HANA query engine.

Pick a DB-layer option when the integration boundary belongs in the database — native joins, query pushdown, queries that stay within HANA. The application layer comes back into play when the contract needs field renames, cross-service `$expand`, opt-in CUD, or a scheduler with delta tracking.

### Platform-layer alternatives — integration outside the CAP app

| Option | Pick it when |
|---|---|
| [**SAP Business Data Cloud**](https://www.sap.com/products/data-cloud.html) (umbrella over Datasphere, Databricks integration, Analytics Cloud, Joule agents) | A governed, enterprise-scale data fabric across SAP applications is the target. |
| [**SAP Datasphere Replication Flow**](https://help.sap.com/docs/SAP_DATASPHERE) | Managed enterprise-scale replication; the closest platform-layer match for `@federation.replicate`. |
| [**SAP Cloud Integration (Integration Suite)**](https://help.sap.com/docs/integration-suite) | The integration itself is the deliverable — transformation logic, B2B/EDI, A2A messaging, routing, error handling in middleware. Also valid as an upstream producer: CPI exposes a virtualized OData endpoint, the CAP app consumes via `@federation.delegate`. |
| [**SAP Graph**](https://help.sap.com/docs/SAP_GRAPH) | A harmonized, cross-system read API (One Domain Model) across S/4HANA, SuccessFactors, Ariba, Concur is the deliverable. Orthogonal to the plugin: if SAP Graph exposes OData for a given context, it is a `@federation.delegate` source like any other. |
| [**SAP Master Data Integration**](https://help.sap.com/docs/SAP_MASTER_DATA_INTEGRATION) | Master-data lifecycle (CRUD propagation, soft-delete, cross-system harmonization) is the problem. Architecturally similar to SAP Graph from the plugin's perspective — OData APIs on BTP, candidate `@federation.delegate` / `@federation.replicate` source. Natural pairing with MDI-emitted change events on [Event Mesh](https://help.sap.com/docs/SAP_EM). |
| Generic CDC / ETL — [Debezium](https://debezium.io/), [Airflow](https://airflow.apache.org/), [dbt](https://www.getdbt.com/) | Heterogeneous data pipelines across many consumers are the deliverable and the CAP app is just one of them. |

### A decision tree

```
                       Where does the integration contract live?
                                          │
        ┌─────────────────────────────────┼───────────────────────────────┐
        │                                 │                               │
   in the database                  in the CAP app                in a data platform
        │                                 │                               │
   HANA SDA /                              │                       Business Data Cloud /
   synonyms                                │                       Datasphere /
                                           │                       Integration Suite /
                                           │                       SAP Graph /
                                           │                       Master Data Integration /
                                           │                       Debezium, Airflow, dbt
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            │                              │                              │
       live reads?                  scheduled sync?              one or two entities only?
            │                              │                              │
            ▼                              ▼                              ▼
  @federation.delegate         @federation.replicate              xtravels recipe
  (+ optional cache:           (+ cds-data-pipeline                (handler per entity)
   response or entity)           under the hood)
```

---

## Part A — Build the demo by hand

This walkthrough produces the project described above. It runs end-to-end on a single laptop with two terminals: one for the xflights provider, one for the federated consumer. No SAP API Hub, no destinations, no auth.

### Prerequisites

- Node.js 24+
- `@sap/cds-dk` 8+ installed globally (`npm install -g @sap/cds-dk`)
- Git

```bash
node -v        # → v24.x or newer
cds --version  # → @sap/cds: >= 8
```

A workspace folder for the two projects:

```bash
mkdir -p ~/cds-data-demo && cd ~/cds-data-demo
```

### Step 1 — Run the xflights provider (terminal 1)

Clone xflights, install its dependencies, and serve it on port 4444:

```bash
cd ~/cds-data-demo
git clone https://github.com/capire/xflights.git provider
cd provider
npm install
npx cds run --port 4444
```

The log ends with something like:

```
[cds] - server listening on { url: 'http://localhost:4444' }
[cds] - launched at 12:34:56, version: 9.x.x, in: 1.234s
[cds] - [ terminate with ^C ]
```

Quick smoke test — create `requests/provider-smoke.http` in the provider folder (or use REST Client from any `.http` file):

```http title="provider/requests/smoke.http"
@provider = http://localhost:4444/odata/v4/data

GET {{provider}}/Airports?$top=3&$select=ID,name,city
###
GET {{provider}}/Airlines?$top=3
###
GET {{provider}}/Flights?$top=3
```

Each request should return a small JSON payload. Leave this terminal running.

### Step 2 — Bootstrap the federated consumer (terminal 2)

```bash
cd ~/cds-data-demo
mkdir consumer && cd consumer
cds init
npm add cds-data-federation cds-data-pipeline @cap-js/sqlite
```

Both plugins auto-activate via their `cds-plugin.js` entry points. No `server.js` wiring required.

### Step 3 — Import the running provider's metadata

`cds import` expects a local metadata file. Fetch `$metadata` from the running provider and save the response body as `xflights.edmx`:

```http title="requests/import-metadata.http"
GET http://localhost:4444/odata/v4/data/$metadata
```

In REST Client, use **Save Response Body** on the result (or copy the XML into `xflights.edmx`). Then import:

```bash
npx cds import xflights.edmx
```

The import generates CSN/CDS under `srv/external/` and adds a `cds.requires` entry to `package.json`. Rename the block to something friendlier and point it at the running provider:

```json title="package.json (excerpt)"
"cds": {
  "requires": {
    "flights": {
      "kind": "odata-v4",
      "model": "srv/external/data-service",
      "credentials": { "url": "http://localhost:4444/odata/v4/data" }
    },
    "db": {
      "kind": "sqlite",
      "credentials": { "url": "db.sqlite" }
    }
  }
}
```

The same model file works against any deployment of xflights — local, BTP, or a destination — by swapping the `credentials` block.

### Step 4 — Declare the consumption views and include the pipeline tracker schema

Create `srv/travel-service.cds` with the contents from the worked example above. Three details matter beyond the federation annotations:

1. **`using from 'cds-data-pipeline/db'`** at the top of the service file. Installing `cds-data-pipeline` registers `DataPipelineService` at runtime, but it does **not** add the tracker entities to your deploy. Without this line, boot fails when federation binds `@federation.replicate` — `SqliteError: no such table: plugin_data_pipeline_Pipelines`. The import pulls `Pipelines` and `PipelineRuns` into the compiled model; `cds deploy` (Step 5) materializes them in SQLite.

2. **`using from 'cds-data-pipeline/srv/DataPipelineManagementService'`** on the same file. This exposes the management OData API at `/pipeline` (`execute`, `Pipelines`, `PipelineRuns`) used in Step 6.

3. The **`using { sap.capire.flights.data as flights }`** clause must match the `cds.requires.flights` block from Step 3:

```cds title="srv/travel-service.cds (excerpt)"
using from 'cds-data-pipeline/db';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
using { sap.capire.flights.data as flights } from '../@cds-models/flights';
// or, if you keep the original `cds import` path:
// using { sap.capire.flights.data as flights } from './external/data-service';

namespace travel;

service TravelService { ... }
```

### Step 5 — Deploy the local schema and run

```bash
npx cds deploy --to sqlite:db.sqlite
npx cds watch --port 4004
```

The boot log includes:

```
[cds-data-federation] discovered 4 @federation.* entities
[cds-data-federation] scheduled replication ReplicatedFlights (every 600000ms)
[cds-data-pipeline] DataPipelineService served at /pipeline
[cds] - server listening on { url: 'http://localhost:4004' }
```

The pipeline tracker tables (`plugin_data_pipeline_Pipelines`, `plugin_data_pipeline_PipelineRuns`) are defined in `packages/cds-data-pipeline/db/index.cds` and enter your SQLite file only because Step 4 included `using from 'cds-data-pipeline/db'`. The plugin performs no runtime DDL.

### Step 6 — Exercise each capability (`.http` requests)

Install the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension in VS Code (or use Cursor's built-in HTTP request editor). Create `requests/travel-extension.http` in the consumer project and run requests with **Send Request** above each `###` separator.

Run them top to bottom — replicated read models stay empty until the first `POST /pipeline/execute` succeeds.

```http title="consumer/requests/travel-extension.http"
@base = http://localhost:4004
@travel = {{base}}/odata/v4/travel

# ── Delegate reads ───────────────────────────────────────────────────────────

### Live airline read — one HTTP roundtrip to xflights
GET {{travel}}/Airlines?$top=5

### Cached airport autocomplete — run twice within 30s; second response is from cds-caching
GET {{travel}}/Airports?$filter=startswith(code,'F')&$select=code,fullName,city

### (repeat the request above to observe a cache hit)

# ── Replication bootstrap ────────────────────────────────────────────────────

### Full sync — required before ReplicatedFlights / AircraftStats / AvailableFlights return rows
POST {{base}}/pipeline/execute
Content-Type: application/json

{ "name": "ReplicatedFlights", "mode": "full", "trigger": "manual" }

### Local SQL over the replicated schedule — no remote call
GET {{travel}}/ReplicatedFlights?$top=5&$orderby=price desc

### GROUP BY read model — only possible on the local replica
GET {{travel}}/AircraftStats?$orderby=avgPrice desc

### Filtered read model — flights with free seats in the local copy
GET {{travel}}/AvailableFlights?$top=10

# ── Local entities joined to federated data ──────────────────────────────────

### Create a booking — FK names follow the consumption-view keys (Airports key is `code`, not `ID`)
POST {{travel}}/Bookings
Content-Type: application/json

{
  "passengerName": "Mike",
  "airline_ID": "GA",
  "departureAirport_code": "FRA",
  "arrivalAirport_code": "JFK"
}

### Cross-service $expand into live delegate entities (three batch-fetches to xflights)
GET {{travel}}/Bookings?$expand=airline,departureAirport,arrivalAirport

### Watchlist row — assoc to ReplicatedFlights uses composite FK (ID + date); paste values from the replicated GET above
POST {{travel}}/FlightWatchlist
Content-Type: application/json

{
  "watchedBy": "mike",
  "maxPrice": 299.00,
  "flight_ID": "GA0322",
  "flight_date": "2024-06-02"
}

### $expand into the replicated flight — local SQL join, no xflights call
GET {{travel}}/FlightWatchlist?$expand=flight

### Airport note with assoc to cached delegate entity
POST {{travel}}/AirportNotes
Content-Type: application/json

{
  "airport_code": "FRA",
  "author": "mike",
  "subject": "Lounge",
  "body": "Senator lounge near gate Z25."
}

GET {{travel}}/AirportNotes?$expand=airport

# ── Pipeline tracker ─────────────────────────────────────────────────────────

### Inspect pipeline state after the sync
GET {{base}}/pipeline/Pipelines?$select=name,status,lastSync,errorCount

### Recent runs
GET {{base}}/pipeline/PipelineRuns?$orderby=startTime desc&$top=5

### Convenience function for one pipeline
GET {{base}}/pipeline/status(name='ReplicatedFlights')
```

Replace `airline_ID`, `flight_ID`, and `flight_date` with values from the `Airlines` and `ReplicatedFlights` responses if the placeholders do not match your provider seed data.

### Step 7 — Hook into the pipeline (optional)

A common requirement: drop a column before write, or transform a value during MAP. The federation plugin composes the engine, so the standard event-hook API works on the federation-bound pipeline:

```javascript title="srv/travel-service.js"
const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
    const pipelines = await cds.connect.to('DataPipelineService');

    pipelines.before('PIPELINE.MAP', 'ReplicatedFlights', async (req) => {
        // Drop flights with zero free seats from the local copy.
        req.data.sourceRecords = req.data.sourceRecords.filter(f => f.free_seats > 0);
    });

    pipelines.after('PIPELINE.WRITE', 'ReplicatedFlights', async (req) => {
        const { affectedRows } = req.data;
        cds.log('travel').info(`replicated ${affectedRows} flights`);
    });
});
```

Same surface as any other CAP service.

### Step 8 — Mount the UI on the local CAP server (optional)

`cds watch` serves static files from `app/` on the **same origin** as OData (`http://localhost:4004/…`). No BTP approuter, no separate UI5 dev server — the Fiori apps and the backend share one process, which is exactly what you want when clicking through federation features locally.

You need three pieces: a Fiori Elements app over `Bookings`, the Pipeline Console mounted from `cds-data-pipeline`, and a sandbox launchpad that links both.

#### 8.1 — Generate a Fiori Elements app

From the consumer project root:

```bash
cds add fiori
```

When prompted, pick **SAP Fiori elements**, **List Report Object Page**, service **`TravelService`**, main entity **`Bookings`**. The generator creates `app/bookings/webapp/` (component namespace varies by cds-dk version — adjust the launchpad tile below if your folder name differs).

Add list-report annotations so the federated associations show up in the UI — the Object Page can expand into live xflights master data without any custom OData code:

```cds title="srv/travel-service-ui.cds"
using TravelService from './travel-service';

annotate TravelService.Bookings with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Booking',
            TypeNamePlural : 'Bookings',
            Title          : { Value: passengerName }
        },
        LineItem: [
            { Value: passengerName, Label: 'Passenger' },
            { Value: airline.name,  Label: 'Airline' },
            { Value: departureAirport.fullName, Label: 'From' },
            { Value: arrivalAirport.fullName,   Label: 'To' },
            { Value: bookedAt,      Label: 'Booked at' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Flight', Target: '@UI.FieldGroup#Flight' },
            { $Type: 'UI.ReferenceFacet', Label: 'Airline', Target: 'airline/@UI.LineItem' },
            { $Type: 'UI.ReferenceFacet', Label: 'Departure', Target: 'departureAirport/@UI.LineItem' },
            { $Type: 'UI.ReferenceFacet', Label: 'Arrival', Target: 'arrivalAirport/@UI.LineItem' }
        ],
        FieldGroup #Flight: {
            Data: [
                { Value: passengerName },
                { Value: bookedAt }
            ]
        }
    }
);
```

Redeploy so annotations reach the OData metadata:

```bash
npx cds deploy --to sqlite:db.sqlite
```

#### 8.2 — Enable the Pipeline Console

The replication tracker is already on `/pipeline` from Step 4. Enable the pre-built console via config reuse (same pattern as [cds-caching](https://github.com/mikezaschka/cds-caching) `metrics.reuse.*`):

```json title="package.json"
{
  "cds": {
    "requires": {
      "datapipeline": {
        "impl": "cds-data-pipeline",
        "management": {
          "reuse": {
            "api": true,
            "console": true
          }
        }
      }
    }
  }
}
```

The console is served at `/pipeline-console/`; the management API stays at `/pipeline/`. For BTP HTML5 repo deployments, use `cds add pipeline-console` instead of `management.reuse.console`. See [Feature activation](../../docs/pipeline/guide/feature-activation.md).
```

#### 8.3 — Add a sandbox launchpad

Create `app/launchpage.html` — a `sap.ushell` sandbox that embeds the Bookings app and the Pipeline Console as tiles on the same host:

```html title="app/launchpage.html (excerpt — applications block)"
<script>
    window['sap-ushell-config'] = {
        defaultRenderer: 'fiori2',
        applications: {
            'bookings-app': {
                title: 'Bookings',
                description: 'Local bookings with cross-service $expand into xflights',
                additionalInformation: 'SAPUI5.Component=ns.bookings',
                applicationType: 'URL',
                url: './bookings/webapp',
                navigationMode: 'embedded'
            },
            'pipeline-console': {
                title: 'Pipeline Console',
                description: 'Trigger ReplicatedFlights sync and inspect run history',
                additionalInformation: 'SAPUI5.Component=pipeline.monitor.fcl',
                applicationType: 'URL',
                url: '/pipeline-console',
                navigationMode: 'embedded'
            }
        }
    };
</script>
<script src="https://ui5.sap.com/test-resources/sap/ushell/bootstrap/sandbox.js"></script>
```

Match `SAPUI5.Component=…` to the `id` in `app/bookings/webapp/manifest.json` (`sap.app/id`). The Pipeline Console component id is fixed in the shipped package.

Full launchpad boilerplate (UI5 bootstrap script, `sap.ushell.Container.createRenderer()`, …) follows the same pattern as [`examples/consumer/app/launchpage.html`](https://github.com/mikezaschka/cds-data/blob/main/examples/consumer/app/launchpage.html).

#### 8.4 — Open the launchpad

Restart the consumer (so `server.js` is picked up), bootstrap replication once if you have not already, then open:

```
http://localhost:4004/launchpage.html
```

| Tile | What you exercise |
|---|---|
| **Bookings** | Fiori Elements list/object page on a local entity; Object Page facets call live delegate entities via cross-service `$expand`. |
| **Pipeline Console** | Manual `ReplicatedFlights` sync, run history, schedule — the same operations as `POST /pipeline/execute` in Step 6, now clickable. |

Direct URLs still work for debugging: `http://localhost:4004/bookings/webapp/index.html`, `http://localhost:4004/pipeline-console/index.html`.

### Tear-down

`Ctrl+C` in both terminals stops everything. To reset local state for a clean re-run:

```bash
rm -f consumer/db.sqlite
```

### Comparing the result to xtravels

[xtravels](https://github.com/capire/xtravels) consumes the same xflights provider with delegation handlers in [`srv/data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) — a useful side-by-side reference for what `cds-data-federation` composes. The published API surface is the same; the difference shows up in the CDS file (annotations) vs. the JS file (handlers).

### Reference reading while you work

- [Installation](https://mikezaschka.github.io/cds-data/federation/getting-started/installation) — peer dependency matrix.
- [First Delegation](https://mikezaschka.github.io/cds-data/federation/getting-started/first-delegation) — the consumption-view-as-contract idea in detail.
- [First Replication](https://mikezaschka.github.io/cds-data/federation/getting-started/first-replication) — delta modes and the management API.
- [Joining Local with Remote](https://mikezaschka.github.io/cds-data/federation/getting-started/joining-local-with-remote) — cross-service `$expand` mechanics.
- [Consumption Views](https://mikezaschka.github.io/cds-data/federation/concepts/consumption-views) — wildcard, renames, `excluding`, static `where`.
- [Annotations reference](https://mikezaschka.github.io/cds-data/federation/reference/annotations) — every option with type and default.

---

## Part B — Build the same demo with an AI coding agent

Each published package ships agent guidance inside the npm tarball:

- `node_modules/cds-data-federation/AGENTS.md` — entry point for AI tools following the [AGENTS.md cross-tool standard](https://agentsmd.org). [Cursor](https://cursor.com), [Claude Code](https://www.claude.com/product/claude-code), [Codex CLI](https://github.com/openai/codex), [GitHub Copilot](https://github.com/features/copilot), and [Aider](https://aider.chat/) all pick it up.
- `node_modules/cds-data-federation/skills/` — task-focused [Agent Skills](https://agentskills.io). Each skill is a small markdown file the agent reads on demand (declare a delegate, add caching, add CUD opt-in, configure REST replication, hook into the pipeline, …).

This means the agent's job, on this kind of project, is closer to picking the matching skill and following its checklist than to drafting CAP integration code from training data.

### Step 0 — Run the provider

Terminal 1 from Part A still applies — the provider is the same regardless of how the consumer is built:

```bash
cd ~/cds-data-demo
git clone https://github.com/capire/xflights.git provider
cd provider && npm install && npx cds run --port 4444
```

### Step 1 — Bootstrap the consumer and link the agent guidance

```bash
cd ~/cds-data-demo
mkdir consumer && cd consumer
cds init
npm add cds-data-federation cds-data-pipeline @cap-js/sqlite

# Pull the shipped Agent Skills into the workspace.
npx skills-npm --include cds-data-federation cds-data-pipeline

# Surface AGENTS.md at the project root so any tool finds it.
ln -s node_modules/cds-data-federation/AGENTS.md ./AGENTS-cds-data-federation.md
ln -s node_modules/cds-data-pipeline/AGENTS.md   ./AGENTS-cds-data-pipeline.md
```

### Step 2 — Wire up MCP for CSN introspection

[Model Context Protocol](https://modelcontextprotocol.io/) gives the agent live introspection capabilities. [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) lets the agent ask "what services / entities / annotations are defined?" without `node -e "…"` snippets. [`@sap/fiori-mcp`](https://www.npmjs.com/package/@sap/fiori-mcp) is useful when the same agent is also going to scaffold a Fiori Elements UI on top.

```json title=".mcp.json"
{
  "mcpServers": {
    "cap-mcp":   { "command": "npx", "args": ["-y", "@cap-js/mcp-server"] },
    "fiori-mcp": { "command": "npx", "args": ["-y", "@sap/fiori-mcp"] }
  }
}
```

### Step 3 — The prompt

A single prompt produces the same project as Part A. The structure — clear deliverables, explicit references to the agent surface — is what keeps the agent on-task:

> I'm building a CAP travel extension on top of the `@capire/xflights` reference provider, using `cds-data-federation` and `cds-data-pipeline`. Both packages are installed and their `AGENTS.md` plus skills are linked into this workspace. The `cap-mcp` MCP server is available for live CSN introspection.
>
> The xflights provider is already running on `http://localhost:4444/odata/v4/data` (entities: `Airlines`, `Airports`, `Flights`, `Supplements`; namespace `sap.capire.flights.data`).
>
> Please:
>
> 1. Fetch provider metadata with a GET on `http://localhost:4444/odata/v4/data/$metadata`, save the response as `xflights.edmx`, then run `cds import xflights.edmx` to bring in the remote model.
> 2. Configure `cds.requires.flights` in `package.json` with `kind: 'odata-v4'`, `model: 'srv/external/data-service'`, and `credentials.url: 'http://localhost:4444/odata/v4/data'`. Add `cds.requires.db` as SQLite at `db.sqlite`.
> 3. Create `srv/travel-service.cds` with `using from 'cds-data-pipeline/db';` and `using from 'cds-data-pipeline/srv/DataPipelineManagementService';` at the top (required for `@federation.replicate` — without the db import, boot fails with `no such table: plugin_data_pipeline_Pipelines`). Then expose (use the skills under `skills/cds-data-federation/` for every annotation choice):
>    - `Airlines` — `@federation.delegate` projection on `Airlines` with `ID, name, icon, currency_code`.
>    - `Airports` — `@federation.delegate: { cache: { ttl: 30000 } }` projection on `Airports` with `ID as code, name as fullName, city, country_code as country`.
>    - `Supplements` — `@federation.delegate` projection with `ID, type_code as type, descr as description, price, currency_code`.
>    - `ReplicatedFlights` — `@federation.replicate: { schedule: 600000, mode: 'full' }` projection on `Flights` with composite key `(ID, date)` and columns `ID, date, aircraft, price, currency_code, maximum_seats, occupied_seats, free_seats, airline_ID, origin_ID, destination_ID`. Use `mode: 'full'` because the xflights `Flights` OData view excludes `modifiedAt`.
>    - `AvailableFlights` — `@readonly` projection on `ReplicatedFlights` with `where free_seats > 0`.
>    - `AircraftStats` — `@readonly` `group by aircraft` over `ReplicatedFlights` with `count`, `avg(price)`, `sum(free_seats)`.
>    - Local entities `Bookings`, `FlightWatchlist`, `AirportNotes` — managed associations to federated entities (`Bookings` → delegate `Airlines`/`Airports`; `FlightWatchlist` → `ReplicatedFlights`; `AirportNotes` → `Airports`).
> 4. Deploy with `cds deploy --to sqlite:db.sqlite` and start on port 4004. Confirm the boot log includes `[cds-data-federation] discovered 4 @federation.* entities` and `scheduled replication ReplicatedFlights`.
> 5. Create `requests/travel-extension.http` (VS Code REST Client format) that exercises:
>    - Live read on `Airlines`.
>    - Cached read on `Airports` (twice, to demonstrate the cache hit).
>    - Manual replication via `POST /pipeline/execute` with `{ "name": "ReplicatedFlights", "mode": "full", "trigger": "manual" }`.
>    - Local reads on `ReplicatedFlights`, `AircraftStats`, and `AvailableFlights`.
>    - Create a `Bookings` row and `GET …/Bookings?$expand=airline,departureAirport,arrivalAirport` (use `departureAirport_code` / `arrivalAirport_code` FK names because the airport key is renamed to `code`).
>    - Create a `FlightWatchlist` row with `flight_ID` + `flight_date` from replicated data, then `$expand=flight`.
>    - `AirportNotes` with `$expand=airport`.
>    - Pipeline tracker queries on `/pipeline/Pipelines` and `/pipeline/PipelineRuns`.
> 6. Mount a local launchpad (optional but recommended):
>    - `cds add fiori` for `TravelService.Bookings` (List Report Object Page).
>    - Add `srv/travel-service-ui.cds` with `@UI.LineItem` / `@UI.Facets` for `airline`, `departureAirport`, and `arrivalAirport`.
>    - Add `management.reuse.console` under `cds.requires.datapipeline` to serve the Pipeline Console at `/pipeline-console/`.
>    - Create `app/launchpage.html` with tiles for the Bookings app (`./bookings/webapp`) and the Pipeline Console (`/pipeline-console`). Open `http://localhost:4004/launchpage.html`.
>
>    Run the `.http` requests and report the response shapes.
>
> Cite the docs at https://mikezaschka.github.io/cds-data/federation/ when you explain trade-offs.

### What the agent typically does

1. Reads `AGENTS-cds-data-federation.md` and the relevant skills before writing any code.
2. Uses `cap-mcp` to confirm what the imported `sap.capire.flights.data.*` entities look like (avoids guessing at wire names like `currency_code` vs. `currency`, `type_code` vs. `type`, or `country_code` vs. `country`).
3. Writes the consumption view in a single pass — the annotation surface is small enough that there is little room for drift.
4. Runs `cds deploy` and `cds watch`, watches the boot log, then runs the `.http` request file. Failures (e.g. a wrong field name in a rename) surface as a `[cds-data-federation]` error on boot rather than a runtime mystery later.

### Iteration patterns that map onto skills

Once the baseline runs, follow-up asks compose cleanly:

- *"Switch `Airports` to `cache.strategy: 'entity'` with `batchSize: 500` and a 5-minute TTL."* → the entity-cache skill.
- *"Add `EditableAirlines` as a writable delegate with `update: true`; leave the public `Airlines` read-only."* → the CUD-opt-in skill.
- *"Publish a CDS event via [Event Mesh](https://help.sap.com/docs/SAP_EM) when `ReplicatedFlights` finishes a successful run, carrying the run summary."* → the pipeline-hook skill plus the messaging recipe.

The shipped skills are deterministic enough that the agent is composing them, not inventing.

### A reference for the agent to imitate

The [`examples/`](https://github.com/mikezaschka/cds-data/tree/main/examples) folder in the repository has two full setups — the [Sales Intelligence Workbench](https://github.com/mikezaschka/cds-data/tree/main/examples/sales-intel) (Northwind V4 + V2 + a local CAP provider + a REST provider) and a [Movies & Streaming demo](https://github.com/mikezaschka/cds-data/tree/main/examples/consumer). Both boot in one command and aggregate Fiori apps behind a launchpad. Pointing the agent at one of these as a structural template improves the success rate on the first pass.

---

## Closing notes

A few takeaways that hold across both walkthroughs:

1. **The strategy is a runtime choice.** The same `sap.capire.flights.data.Airlines` projection can appear in the model as a live `Airlines`, a cached `HotAirlines`, a replicated `ReplicatedAirlines`, and an opt-in-writable `EditableAirlines`. The annotation is the switch.
2. **The plugin is application-layer.** Pick it when the integration contract belongs in the CAP app — renames, cross-service `$expand`, opt-in CUD, scheduled sync with tracker observability. Pick a [HANA SDA / synonym](https://cap.cloud.sap/docs/advanced/hana#native-hana-features), [Datasphere Replication Flow](https://help.sap.com/docs/SAP_DATASPHERE), [SAP Graph](https://help.sap.com/docs/SAP_GRAPH), [Master Data Integration](https://help.sap.com/docs/SAP_MASTER_DATA_INTEGRATION), or [Cloud Integration](https://help.sap.com/docs/integration-suite) when the contract belongs to a different layer.
3. **The reference samples remain useful.** [xtravels](https://github.com/capire/xtravels) — built on the same [xflights](https://github.com/capire/xflights) provider this demo uses — shows the recipe at the handler level. Reading it side by side with the consumption view from Part A clarifies what `cds-data-federation` composes and where the boundaries are.
4. **A travel-extension is roughly six files plus an optional `app/` folder.** `cds.requires`, one `.cds` file with the projections and local entities, one `.http` request file, `cds deploy`, `cds watch`, and — when you want clickable UI — `server.js` + `app/launchpage.html`. Two terminals if you count the provider.
5. **The agent path is shorter than it looks.** With the shipped `AGENTS.md`, skills, and `cap-mcp` for live CSN introspection, a single structured prompt produces the same scaffold as the hands-on walkthrough.

For depth on individual capabilities:

- [Annotations reference](https://mikezaschka.github.io/cds-data/federation/reference/annotations) — every option with type and default.
- [Comparison matrix](https://mikezaschka.github.io/cds-data/federation/reference/comparison) — alternatives row by row.
- [Cross-service scenarios](https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios) — every expand and navigation topology with mermaid diagrams.
- [Pipeline guide](https://mikezaschka.github.io/cds-data/pipeline/) — programmatic API, adapters, recipes.

→ Back to **[Part 1: Introducing cds-data](./01-introducing-cds-data.md)**.

---

## Links

### Packages and docs

| Resource | URL |
|---|---|
| Documentation portal | https://mikezaschka.github.io/cds-data/ |
| `cds-data-federation` guide | https://mikezaschka.github.io/cds-data/federation/ |
| `cds-data-pipeline` guide | https://mikezaschka.github.io/cds-data/pipeline/ |
| `cds-data-materialization` guide | https://mikezaschka.github.io/cds-data/materialization/ |
| Source repo (monorepo) | https://github.com/mikezaschka/cds-data |
| Federation annotations reference | https://mikezaschka.github.io/cds-data/federation/reference/annotations |
| Federation comparison matrix | https://mikezaschka.github.io/cds-data/federation/reference/comparison |
| Cross-service scenarios | https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios |
| Terminology page | https://mikezaschka.github.io/cds-data/federation/concepts/terminology |

### SAP and CAP references

| Resource | URL |
|---|---|
| CAP Service Integration guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation guide | https://cap.cloud.sap/docs/guides/integration/data-federation |
| The Calesi Pattern | https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern |
| Consuming Services (projection features) | https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features |
| HANA native features in CAP | https://cap.cloud.sap/docs/advanced/hana#native-hana-features |
| `@capire/xflights` (reference provider, used in Part A) | https://github.com/capire/xflights |
| `@capire/xtravels` (canonical handler-level consumer of xflights) | https://github.com/capire/xtravels |
| `API_BUSINESS_PARTNER` on SAP API Hub | https://api.sap.com/api/API_BUSINESS_PARTNER/overview |

### Alternatives

| Tool | URL |
|---|---|
| Risk Management ext-service branch | https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui |
| Kai Niklas — CAP Remote Services + Fiori Elements | https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/ |
| Gregor Wolf — cap-replication-demo | https://github.com/gregorwolf/cap-replication-demo |
| `@cap-js-community/common` (Replication Cache) | https://github.com/cap-js-community/common |
| `cds-caching` | https://github.com/mikezaschka/cds-caching |
| HANA Smart Data Access | https://help.sap.com/docs/SAP_HANA_PLATFORM/6b94445c94ae495c83a19646e7c3fd56/6ce5a8dc7c0f44e28f12ff09db93b45c.html |
| SAP Business Data Cloud | https://www.sap.com/products/data-cloud.html |
| SAP Datasphere | https://help.sap.com/docs/SAP_DATASPHERE |
| SAP Cloud Integration (Integration Suite) | https://help.sap.com/docs/integration-suite |
| SAP Graph | https://help.sap.com/docs/SAP_GRAPH |
| SAP Master Data Integration | https://help.sap.com/docs/SAP_MASTER_DATA_INTEGRATION |
| SAP Event Mesh | https://help.sap.com/docs/SAP_EM |
| Debezium | https://debezium.io/ |
| Apache Airflow | https://airflow.apache.org/ |
| dbt | https://www.getdbt.com/ |

### Agent tooling

| Tool | URL |
|---|---|
| AGENTS.md standard | https://agentsmd.org |
| Agent Skills format | https://agentskills.io |
| Model Context Protocol | https://modelcontextprotocol.io/ |
| `@cap-js/mcp-server` | https://www.npmjs.com/package/@cap-js/mcp-server |
| `@sap/fiori-mcp` | https://www.npmjs.com/package/@sap/fiori-mcp |
| Cursor | https://cursor.com |
| Claude Code | https://www.claude.com/product/claude-code |
| Codex CLI | https://github.com/openai/codex |
| GitHub Copilot | https://github.com/features/copilot |
| Aider | https://aider.chat/ |
