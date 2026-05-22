# Sales Intelligence Workbench — `cds-data-federation` example

A self-contained example app that shows the plugin's full federation story
from a recognisable business angle: an inside-sales team's internal tool that
fuses ERP master data with local annotations and analytics.

Read this file first for the lay of the land. The narrative walkthrough
(which consumption view uses which strategy, and why) lives in
[workbench/README.md](workbench/README.md).

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Sales Intelligence Workbench        (CAP, port 4005)                │
│                                                                      │
│   local DB ──── CustomerNotes, FollowUpTasks, RiskRatings, Alerts   │
│                                                                      │
│   delegate ──┬── Northwind V4  (public)    → Customers, Orders, ... │
│              ├── Northwind V2  (public)    → Products (legacy cat.) │
│              └── LogisticsService (local)  → Shipments, Carriers    │
│                                                                      │
│   replicate ─┬── Northwind V4               → Categories, Sales*    │
│              └── FXService (local REST)     → ExchangeRates         │
└──────────────────────────────────────────────────────────────────────┘
         │                                     │
         │                                     │
  LogisticsService (CAP, port 4455)     FXService (REST, port 4456)
   Shipments / Carriers / Events         GET /api/rates
   Carriers intentionally slow (2 s)     offset pagination, deltaParam
```

The **Workbench** is the consumer. The two bundled providers (`LogisticsService`,
`FXService`) run in separate processes to show realistic cross-service
federation, including over REST. Northwind is hit live on the public internet
via `services.odata.org`.

## What it demonstrates

The example deliberately covers a *slice* of the plugin's feature surface — the
kind a reader can absorb in one sitting. Full feature coverage lives in
[`test/consumer/`](../../test/consumer/).

| Federation feature | Shown by |
|---|---|
| OData V4 delegation (public) | `Customers`, `Orders`, `Employees` (Northwind) |
| OData V4 delegation (local CAP) | `Shipments`, `Carriers` (LogisticsService) |
| OData V2 delegation + field renames | `Products` (Northwind V2 legacy catalog) |
| REST replication | `ExchangeRates` (FXService) |
| OData replication (reference data) | `Categories` (Northwind) |
| OData replication (analytics) | `SalesOrders`, `SalesOrderLines`, `SalesProducts` |
| **Same remote, two strategies** | `Orders` (delegate) + `SalesOrders` (replicate) |
| Caching with visible latency | `Carriers` — 2 s cold, <10 ms warm |
| Static `where` in projection | `ActiveCustomers` |
| `$expand` scenario A (remote→remote) | `Orders?$expand=buyer` |
| `$expand` scenario B (local→remote) | `CustomerNotes?$expand=customer`, cross-provider `FollowUpTasks?$expand=customer,order` |
| `$expand` scenario C (remote→local) | `Customers?$expand=notes,risk,tasks` |
| Analytical `$apply` / `groupby` | `SalesOrderLines` aggregation in the ALP |
| Federation Monitor | `/pipeline/Pipelines` + `/pipeline/run` |

## Getting started

```bash
# From the repository root — installs every workspace
npm install

# Start all three servers. Ctrl+C stops them cleanly.
bash examples/sales-intel/start-all.sh
```

Then:

- **OData service** — <http://localhost:4005/odata/v4/sales-intel/$metadata>
- **Federation Monitor** — <http://localhost:4005/pipeline/Pipelines>
- **.http scenarios** — [workbench/http/](workbench/http/) (use the VS Code REST Client extension)

Try this five-minute tour:

1. Run [`workbench/http/00-setup.http`](workbench/http/00-setup.http) — confirm every backend responds.
2. Run [`workbench/http/13-delegate-cached-carriers.http`](workbench/http/13-delegate-cached-carriers.http) — watch the first request take ~2 s and the second finish in milliseconds.
3. Run [`workbench/http/21-cross-service-expand-local-to-remote.http`](workbench/http/21-cross-service-expand-local-to-remote.http) — see local notes stitched with live Northwind customers and orders in a single query.
4. Run [`workbench/http/31-replicate-fx-rates.http`](workbench/http/31-replicate-fx-rates.http) — trigger a REST replication and watch the rows land locally.
5. Run [`workbench/http/50-analytics-apply.http`](workbench/http/50-analytics-apply.http) — see the `$apply / groupby` query succeed over the replicated sales tables.

## Layout

```
examples/sales-intel/
├── README.md                  ← you are here
├── start-all.sh               ← starts all three servers
├── providers/
│   ├── logistics-service/     CAP app — Shipments, Carriers (slow), TrackingEvents
│   └── fx-service/            Plain REST Express app — /api/rates
└── workbench/                 The consumer app
    ├── db/
    │   ├── schema.cds         Local entities + all @federation.* projections
    │   └── data/*.csv         Seed data for local tables
    ├── srv/
    │   ├── sales-intel-service.cds   Public OData service wiring
    │   ├── federation-monitor-service.cds   Pulls in plugin management service
    │   └── external/          CSN snapshots of the remote services
    └── http/                  Documented .http scenarios
```

## Delivery phases

**Phase 1 (MVP) — this is the current state.** The OData surface, `.http`
scenarios, replications, cache demo, and federation admin all work end to end
against the public Northwind service. The five MVP Fiori Elements tiles
(Customer Notes, Customers, Customer 360, Sales Analytics, Federation Monitor)
and the sandbox launchpad are still to be built — see
[workbench/TODO.md](workbench/TODO.md).

**Phase 2** extends the tile set to the full catalogue listed in the plan.

## Troubleshooting

- **Ports in use** — the `start-all.sh` script kills stragglers on ports 4005,
  4455, 4456 before starting.
- **Public Northwind flaky** — the service is community-run and occasionally
  slow. Delegate calls will surface the remote error; replicate runs retry
  transient failures.
- **Carriers feels slow** — it is, by design. Tune via
  `LOGISTICS_CARRIERS_DELAY_MS=0` when starting the LogisticsService to remove
  the sleep.
