# Sales Intelligence Workbench — walkthrough

The workbench is the consumer app. Its job is to give an inside-sales rep one
place to look up customer and order data from the ERP, attach local notes and
follow-ups, and run dashboards without waiting on the backend.

Every entity in this service is a federation call under the hood. This file
walks through the service model entity by entity and explains **which
strategy is used and why**. Read the top-level [../README.md](../README.md)
first for the overall architecture.

- Base URL: http://localhost:4005
- OData service: http://localhost:4005/odata/v4/sales-intel/
- Launchpad: http://localhost:4005/launchpage.html
- Federation Monitor: http://localhost:4005/pipeline/Pipelines

---

## Why two strategies

The plugin offers two annotations and both are used here:

- **`@federation.delegate`** — read-through proxy. Every request goes to the
  remote. Use for live lookups and transactional screens where freshness
  beats latency.
- **`@federation.replicate`** — scheduled copy into local SQLite. Use for
  reference data, analytics, and anything that needs SQL features the remote
  can't evaluate (GROUP BY, HAVING, joins across services).

The workbench mixes both on purpose — and even uses **both strategies on the
same remote entity** so you can see the trade-off in one place.

---

## Entities, grouped by strategy

### Delegated — Northwind V4 (live ERP)

| Entity | Pattern | Why |
|---|---|---|
| `Customers` | wildcard + local backlinks | Freshness matters. Local `notes`, `tasks`, `risk` associations enable cross-service expand: remote → local stitching. |
| `ActiveCustomers` | static `where` clause | Shows the plugin's projection `where` injection — CAP alone rejects this for delegate entities. |
| `Orders` | renamed associations | Association rename (`Order_Details` → `lineItems`) demonstrates remote→remote `$expand` (delegated expand). |
| `Employees` | plain wildcard | Baseline V4 delegation. |

### Delegated — Northwind V2 (legacy catalog)

| Entity | Pattern | Why |
|---|---|---|
| `Products` | V2 protocol + field renames | PascalCase (`UnitPrice`, `QuantityPerUnit`) → camelCase (`unitPrice`, `packSize`). Realistic pattern: a modernised facade on a legacy V2 gateway. |

### Delegated — LogisticsService (local CAP app, port 4455)

| Entity | Pattern | Why |
|---|---|---|
| `Shipments` | wildcard | Local-CAP → local-CAP delegation. `orderId` FKs match Northwind `OrderID` so shipments stitch into Customer 360. |
| `Carriers` | **cached** (TTL 5 min) | The provider sleeps 2 s on reads. The cache option makes the first request slow, every subsequent request sub-10-ms. Watch the browser network panel and time the drop. |
| `TrackingEvents` | wildcard | Shipment history for the Order Tracker tile (Phase 2). |

### Replicated — Northwind V4

| Entity | Pattern | Why |
|---|---|---|
| `Categories` | full refresh (no `modifiedAt`) | Slow-changing reference data. Local dashboards need to join against it cheaply. |
| `SalesOrders` | full refresh | **Same remote entity as `Orders`** — but replicated for analytics. The ALP needs `$apply/groupby` which CAP rejects for delegate entities. This is the core teaching moment. |
| `SalesOrderLines` | full refresh | Line items for revenue aggregation (unit price × quantity × (1 − discount)). |
| `SalesProducts` | full refresh | Product dimension for the Sales Analytics ALP. |

### Replicated — FXService (REST, port 4456)

| Entity | Pattern | Why |
|---|---|---|
| `ExchangeRates` | REST adapter, offset pagination, `modifiedSince` delta | The FX feed has no CDS model — the annotation declares an explicit `source` and a `rest:` config with `path`, `pagination`, `deltaParam`, `dataPath`. Shows the REST replication pipeline end to end. |

### Local — sales-rep authored

| Entity | Pattern | Why |
|---|---|---|
| `CustomerNotes` | local + association to delegated `Customers` | Drives cross-service expand: local → remote (`$expand=customer` batch-fetches from Northwind). |
| `FollowUpTasks` | local + two assocs (Customers, Orders) | Cross-remote mashup in a single local query. |
| `CustomerRiskRatings` | local, backlink target | Referenced from `Customers.risk` — drives cross-service expand: remote → local. |
| `ShipmentAlerts` | local + assoc to local-CAP `Shipments` | Proves the expand stack is source-agnostic (works through a CAP provider the same way it works through public Northwind). |

---

## Tile catalogue — Phase 1 MVP

The sandbox launchpad (`/launchpage.html`) ships five tiles across four
groups. Each is a Fiori Elements app under [`app/`](app/).

| Group | Tile | Floorplan | Entity | Demonstrates |
|---|---|---|---|---|
| My Work | Customer Notes | List Report | `CustomerNotes` | Local entity with cross-service expand: local → remote to Northwind |
| Master Data | Customers | List Report | `Customers` | Live V4 delegation |
| Intelligence | Customer 360 | Object Page | `Customers` | Object Page facets for notes / tasks / risk (cross-service expand: remote → local) |
| Intelligence | Sales Analytics | ALP | `SalesOrders` | Chart + KPIs over replicated data (`$apply/groupby` works) |
| Admin | Pipeline Monitor | List Report | `Pipelines` | Plugin management service with run history facet |

The **Customer 360** tile points at the same `customers` app as **Customers**
— the Object Page is already rich enough to serve as the 360° view. Click a
row in the list and you land on the Object Page with facets for notes, tasks,
and risk, populated by the plugin's cross-service expand: remote → local resolver.

Phase 2 adds the remaining nine tiles. See [TODO.md](TODO.md).

---

## Running it

```bash
# From the repository root
bash examples/sales-intel/start-all.sh
# Then open http://localhost:4005/launchpage.html
```

Before the Sales Analytics tile shows numbers, trigger the replications:

```bash
curl -X POST http://localhost:4005/pipeline/run \
    -H 'Content-Type: application/json' \
    -d '{"name":"Categories","mode":"full"}'
curl -X POST http://localhost:4005/pipeline/run \
    -H 'Content-Type: application/json' \
    -d '{"name":"SalesOrders","mode":"full"}'
curl -X POST http://localhost:4005/pipeline/run \
    -H 'Content-Type: application/json' \
    -d '{"name":"SalesOrderLines","mode":"full"}'
curl -X POST http://localhost:4005/pipeline/run \
    -H 'Content-Type: application/json' \
    -d '{"name":"SalesProducts","mode":"full"}'
```

All four runs are also bundled in
[`http/50-analytics-apply.http`](http/50-analytics-apply.http) — the easier
route is to run that file top to bottom in VS Code.

---

## Where to go next

- **Follow the `.http` scenarios** — [`http/`](http/) — each file is
  self-documenting and tells the reader exactly what to watch for.
- **Read the plan** — [../README.md](../README.md) captures the architecture
  and the phase split.
- **Feature reference** — the repo's
  [`test/consumer/`](../../../test/consumer/) is the exhaustive federation
  feature reference, maintained as the test fixture.
