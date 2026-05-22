# cds-data-federation

[Documentation](https://mikezaschka.github.io/cds-data-federation/) · [npm](https://www.npmjs.com/package/cds-data-federation) · [Examples](./examples/README.md)

A SAP CAP plugin for integrating external services into your application's data model through declarative CDS annotations and without any additioanl coding.

## At a glance

Declare a consumption view on the remote entity. Annotate it. That's the integration layer.

```cds
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

// Live proxy — reads forwarded to the remote service at request time
@federation.delegate
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};

// Scheduled sync — copies remote data into the local DB for local joins, analytics, offline
@federation.replicate: { schedule: 600000 }  // every 10 minutes
entity ReplicatedPartners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};
```

From any CAP service, query them like local entities. The plugin does the rest:

```http
GET /my-service/Partners?$filter=contains(name,'Acme')&$orderby=name&$top=10
```

What you get for free, per annotated entity:

- `on('READ')` handler registered automatically — no JavaScript
- CQN → remote-query translation, with field and association renames applied in both directions
- Cross-service `$expand` (local → remote, remote → local, remote → remote)
- Idempotent `UPSERT` writes, delta sync, retry with backoff, concurrency guards (replicate)
- Optional response caching via [`cds-caching`](https://github.com/mikezaschka/cds-caching) — `{ cache: { ttl: 60000 } }`
- Opt-in CUD forwarding for writable delegate entities — read-only by default

Full annotation reference, event hooks, and programmatic API below.

## What this is for

Integrating remote services is a core concept in SAP CAP. Importing an external service's model, projecting its entities into your own service, and connecting to the runtime via `cds.connect.to(...)` is well-supported out of the box. CAP's [CaLeSi guide](https://cap.cloud.sap/docs/guides/integration/calesi) frames the runtime side of this work around two named patterns:

- **Delegation** — forward requests from a local entity to a remote service at runtime. The local entity is a live view onto remote data.
- **Data federation** — copy remote data into the local database on a schedule, so queries run against local tables (referred to here as **replication** to avoid ambiguity with the broader industry meaning of "federation").

The CaLeSi guide tells you *what* these patterns are and when to use them. It stops short of giving you a turnkey implementation: in practice you still write per-entity `on('READ')` handlers for delegation, wire up scheduled jobs for replication, translate renamed fields in filters, and handle cross-service `$expand` by hand. The SAP [risk-management](https://github.com/SAP-samples/cloud-cap-risk-management) and [xtravels](https://github.com/capire/xtravels) samples demonstrate the manual pattern.

This plugin abstracts that boilerplate behind two CDS annotations. You declare a consumption view on the remote entity and annotate it — the plugin registers the handlers, drives the sync, and translates queries on your behalf.

The plugin targets apps that follow CAP's [Reuse & Compose — Service Integration](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#service-integration) pattern: the remote service (your own API package, an S/4 OData API, a community reuse module) is configured in `cds.requires` with `kind: 'odata'` so it runs as a separate microservice rather than being embedded. From there, `@federation.delegate` and `@federation.replicate` on a consumption view are all that is needed — the plugin does not change anything about the surrounding CAP lifecycle, inner-loop tooling (`cds watch` / `cds mock` / `cds repl` / auto-bindings via `~/.cds-services.json`) or deployment model.

> Throughout this documentation we use **federation** as the umbrella term for both strategies. This is intentionally broader than CAP's own usage, where *federation* means replication specifically; see [`docs/concepts/terminology.md`](./docs/concepts/terminology.md) for the reasoning.

## The two strategies

| Strategy | Annotation | Behavior | Use when |
|---|---|---|---|
| Delegate | `@federation.delegate` | Transparent live proxy. Reads (and optionally writes) are forwarded to the remote service at request time. Read-only by default; CUD is opt-in per entity. | You need up-to-the-second data, writes must hit the system of record, or the remote dataset is too large to replicate. |
| Replicate | `@federation.replicate` | Scheduled sync that copies remote data into the local database. Queries afterwards run fully locally — joinable, aggregatable, offline-capable. | You need analytics, joins across sources, resilience against remote outages, or the remote service can't sustain live query load. |

## How it compares

This plugin focuses on **application-level integration** — where the CAP service itself owns the integration contract, and the consumption view, renames, cross-service `$expand`, and sync logic all live inside the app's codebase and lifecycle. That scope is deliberate; other tools remain the right choice for DB-layer integration (HANA synonyms, Smart Data Access) or for platform-level data integration (SAP Datasphere, generic CDC/ETL).

Within the application layer, several efforts tackle slices of the problem: SAP's own [xtravels](https://github.com/capire/xtravels) and [risk-management](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui) samples show the manual handler pattern; community plugins like [`@cap-js-community/common`](https://github.com/cap-js-community/common) offer entity-level caching; [`cds-caching`](https://github.com/mikezaschka/cds-caching) provides response-level caching as a building block; and practitioner blog posts like [Kai Niklas on Remote Services + Fiori Elements](https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/) walk through the hand-written integration end-to-end.

**`cds-data-federation` aims to be the one-stop application-level answer**: declare `@federation.delegate` or `@federation.replicate` on a consumption view, and the plugin handles handler registration, query translation, cross-service `$expand`, delta sync, retries, concurrency, and optional caching — no per-entity plumbing. It doesn't compete with Datasphere at warehouse scale or with HANA-native integration at the DB layer; it fills the gap for CAP applications that just need remote data shaped into their own model without writing the same boilerplate for every entity.

For a detailed side-by-side matrix across all these options — delegation alternatives, replication alternatives, and where each one fits — see [`docs/reference/comparison.md`](./docs/reference/comparison.md).

## Install

```bash
npm add cds-data-federation
```

Peer dependencies:

- `@sap/cds` >= 8 (required)
- `cds-caching` >= 1 (optional, only needed if you use the `cache` option)
- `@sap-cloud-sdk/http-client` and `@sap-cloud-sdk/resilience` (required for OData remote services)

The plugin auto-activates on load via `cds-plugin.js`. No manual wiring.

## Try it locally

### Sales Intelligence Workbench

The primary example — an inside-sales team's internal tool fusing the public
Northwind ERP with local annotations and analytics. Lives under
[`examples/sales-intel/`](./examples/sales-intel/).

```bash
# From the repo root
npm install
bash examples/sales-intel/start-all.sh
# Open http://localhost:4005/launchpage.html
```

This starts three servers:

- **examples/sales-intel/providers/logistics-service** — bundled CAP app on :4455 (Shipments, Carriers with an artificial 2 s delay, TrackingEvents)
- **examples/sales-intel/providers/fx-service** — bundled REST app on :4456 (offset pagination + `modifiedSince` delta)
- **examples/sales-intel/workbench** — consumer on :4005 with Fiori Elements tiles in a sandbox launchpad

The workbench talks to **four** federated sources: public Northwind V4
(live ERP), public Northwind V2 (legacy product catalog), LogisticsService
(local CAP), and FXService (local REST). Phase 1 MVP ships five tiles
across four groups — **Customer Notes**, **Customers**, **Customer 360**,
**Sales Analytics** (ALP), and **Federation Monitor**. The headline teaching
moments:

- **Same remote, two strategies** — `Orders` is delegated for live lookup,
  `SalesOrders` is replicated for the ALP. `$apply/groupby` works on the
  replicated copy (it would fail on the delegate).
- **Visible caching** — `Carriers` pays 2 s on the first request, <10 ms on
  every subsequent one.
- **Cross-service `$expand`** — all three scenarios (local→remote,
  remote→local, remote→remote) shown with the same annotation surface.

See [`examples/sales-intel/README.md`](./examples/sales-intel/README.md) for
the architecture diagram and a 5-minute `.http` tour, and
[`examples/sales-intel/workbench/README.md`](./examples/sales-intel/workbench/README.md)
for the entity-by-entity walkthrough.

### Older example — Movies & Streaming

A second, earlier example lives at [`examples/consumer/`](./examples/consumer/).
Boot with `npm run examples:start` (port 4004). Still runs; kept alongside the
workbench while the two iterate.

See [`examples/README.md`](./examples/README.md) for details on the movies demo.

## Core concept: consumption views

The CDS projection IS the federation contract. The `@federation.*` annotation declares runtime behavior; the projection declares the schema (fields, shape, renames). The plugin infers source, columns, and bidirectional rename mappings automatically.

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

// 1. Wildcard — all fields, no transformation
@federation.delegate
entity Customers as projection on remote.Customers;

// 2. Column restriction + field renames (excluded fields never fetched)
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// 3. Association renames — $expand=buyer becomes $expand=customer on the remote
@federation.delegate
entity Orders as projection on remote.Orders {
    ID        as orderId,
    customer  as buyer,
    product   as item,
    quantity,
    total     as amount,
    orderDate as placedOn
};

// 4. Entity-level rename — same remote data, different local purpose
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID    as supplierId,
    name  as companyName,
    city  as headquarters,
    email as contactEmail
};
```

A query `$filter=unitPrice gt 100` on `Products` transparently becomes `$filter=price gt 100` on the remote; results are mapped back. The same applies to `$select`, `$orderby`, `$expand`.

## Annotation reference

All options are declared inline on the annotation: `@federation.<strategy>: { ... }`.

### Common options

| Option | Type | Applies to | Description |
|---|---|---|---|
| `source` | string | both | Explicit remote service name. Required for REST; inferred from the projection for OData. |
| `cache` | object | both | Enables response caching. See below. |
| `writable` | boolean | delegate | Shorthand for `create: true, update: true, delete: true`. Read-only by default. |
| `create`, `update`, `delete` | boolean | delegate | Enable individual CUD operations. Individual flags override `writable`. Disabled ops return HTTP 405. |

### Cache option

```cds
@federation.delegate: { cache: {
    ttl: 60000,                         // milliseconds
    service: 'longTermCache',           // optional, defaults to 'caching'
    tags: ['static-tag',                // static string
           { data: 'orderId', prefix: 'order-' },  // dynamic data-based tag
           { value: 'order-data' },     // wrapped static tag
           { template: '...' }]         // template tag
} }
```

- Auto-applied tag `federation:<entityName>` for entity-wide invalidation.
- Invalidate via `cache.deleteByTag('your-tag')`.
- If `cds-caching` is not installed, the option is silently ignored with a warning.

### Replicate options

| Option | Type | Description |
|---|---|---|
| `mode` | `'full'` \| `'delta'` | Default `'delta'`. |
| `schedule` | number (ms) | Interval for `cds.spawn`. Omit for manual-only. |
| `delta` | object | `{ field, mode }`. `field` defaults to `'modifiedAt'`; `mode` to `'timestamp'` (also `'key'`, `'datetime-fields'`). |
| `rest` | object | REST adapter config: `{ path, pagination: { type, pageSize }, deltaParam, dataPath }`. `type` is `offset` \| `cursor` \| `page`. |

### Examples

```cds
// Cached delegate (5s TTL)
@federation.delegate: { cache: { ttl: 5000 } }
entity CachedCustomers as projection on remote.Customers;

// Writable delegate, all CUD
@federation.delegate: { writable: true }
entity Customers as projection on remote.Customers { * };

// Selective CUD (create + update, no delete)
@federation.delegate: { create: true, update: true }
entity Partners as projection on remote.Partners { ... };

// Scheduled replicate with delta
@federation.replicate: { schedule: 600000, delta: { field: 'modifiedAt' } }
entity ReplicatedProducts as projection on remote.Products { ... };

// REST replicate (explicit source, no CDS model)
@federation.replicate: {
    source: 'RestProvider',
    delta: { field: 'modifiedAt' },
    rest: {
        path: '/api/customers',
        pagination: { type: 'offset', pageSize: 100 },
        deltaParam: 'modifiedSince',
        dataPath: 'results'
    }
}
entity ReplicatedRestCustomers { key ID: String(10); name: String(100); ... };
```

## Feature matrix

### Query delegation (OData V4, V2, HCQL)

- `$filter` with renames, comparison operators (`eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`), logical (`and`, `or`, `not`), string functions (`contains`, `startswith`, `endswith`, `tolower`, `toupper`).
- `$orderby`, `$select`, `$top`, `$skip`, `$count`, `$search` passthrough.
- Lambda operators `any()` / `all()` on to-many — including cross-service (Scenario B).
- Navigation path filters with renamed associations (e.g., `buyer/name` → `customer/name`).
- Cross-service navigation filters (Scenario B): `$filter=product/productName eq 'X'` on a local entity with an assoc to a federated entity.
- Static `where` clause in projections (e.g., `... where blocked = false`) injected into every remote query.
- `excluding { ... }` column restriction — excluded fields never fetched.
- CQL / `cds.ql` supported via the projection chain (tagged templates, `SELECT.one`, `.columns()`, `.where()`, `.orderBy()`, `.limit()`, key shortcuts, projection functions).

### `$expand` scenarios

- A (remote → remote): forwarded natively by CAP. Supports nested expand, `$select` / `$filter` / `$orderby` / `$top` / `$skip` inside the expand (V4 only; V2 does not support nested expand options).
- B (local → remote): plugin strips federated expand items, executes local SQL, batch-fetches remote with `FK IN (...)`, and stitches. Supports composite keys, to-many array grouping, nested expand with recursive rename, `$top` / `$skip` per-parent, `excluding` bandwidth optimization, cross-provider.
- C (remote → local): plugin forwards remote query, queries local, stitches. Supports `$filter` / `$orderby` / `$top` in the expand clause.

### Cross-service navigation

- `GET /Reviews(id)/product` — local → remote, reads local FK, delegates with rename mapping.
- `GET /Customers('C001')/bookmarks` — remote → local, rewrites CQN to FK-filtered local query, supports `$filter` / `$select` on the target.

### CUD forwarding (delegate)

- Read-only by default. Entities without any `writable` / `create` / `update` / `delete` flag get `@readonly` enforced.
- Synchronous (`remote.run(req.query)`), preserves request-response contract (201 / 200 / 204).
- Explicit 405 handlers for disabled operations on partially writable entities.

### Server-driven paging (delegate)

- Remote OData services (e.g. Northwind) that cap a single response below the client's requested `$top` are handled transparently. The delegate handler auto-loops the remote via `$top` / `$skip` until the client's rows are collected or the remote returns empty.
- Client `$top` / `$skip` are still honored end-to-end; `@odata.count` from the first batch is preserved.

### Protocols

| Protocol | Delegate | Replicate |
|---|---|---|
| OData V4 | yes | yes |
| OData V2 | yes | yes |
| HCQL | yes | yes |
| REST (plain JSON) | not supported (CAP does not translate CQN to REST) | yes (use `@federation.replicate` + `rest` config) |

### Caching

- TTL-based entries, per-entity auto-tag `federation:<entityName>`.
- Static, auto, dynamic (data-based), and template tags for fine-grained invalidation.
- Custom cache services (e.g., `longTermCache`).
- Correct cache keys for different `$filter` / `$select` / `$orderby` combinations.
- `cache.deleteByTag()` / `cache.clear()` for invalidation.

### Replication engine

- `UPSERT.into(entity).entries(records)` — idempotent, no duplicate rows.
- Concurrency guard via optimistic `UPDATE` on `Federations` tracker (returns early if another run is in progress).
- Retry with exponential backoff + jitter (skips 4xx by default).
- Async generator streaming — never loads full datasets into memory.
- OData delta modes: `timestamp`, `key`, `datetime-fields`.
- REST adapter: `offset` / `cursor` / `page` pagination, `deltaParam`, `dataPath` extraction.
- Server-driven paging: OData adapter keeps paging via `$skip` until the remote returns empty, even when the remote enforces a per-request cap smaller than the configured `batchSize` (e.g. Northwind's 20-row default).
- CAP-native `cds.Service` with `REPLICATE.READ` / `REPLICATE.MAP` / `REPLICATE.WRITE` events. Register `before` / `on` / `after` hooks via the standard `srv.before(event, replicationName, handler)` API.

### Management API

OData service at `/federation` (`DataFederationService`):

- `GET /federation/Federations` — configuration + statistics per replication.
- `GET /federation/ReplicationRuns` — per-run timing, trigger, status, statistics.
- `POST /federation/run` — `{ name, mode }` — manual trigger.
- `POST /federation/flush` — `{ name }` — clear replicated data and tracker.
- `GET /federation/status(name='...')` — single tracker record.

## Programmatic API

`DataReplicationService` is a standard `cds.Service` — resolve it via `cds.connect.to('DataReplicationService')`. Register hooks with CAP's native `srv.before/on/after(event, replicationName, handler)`.

```javascript
const cds = require('@sap/cds');

const federation = await cds.connect.to('DataReplicationService');

// Filter out records before MAP (before hooks receive the request only)
federation.before('REPLICATE.MAP', 'BusinessPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Custom MAP default — overrides the built-in rename mapping
federation.on('REPLICATE.MAP', 'BusinessPartners', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(record => ({
        ID: record.BusinessPartner,
        name: record.BusinessPartnerFullName,
        sourceService: req.data.source.service,
    }));
});

// Enrich after MAP (after hooks receive `(results, req)` per CAP convention)
federation.after('REPLICATE.MAP', 'BusinessPartners', async (_results, req) => {
    req.data.targetRecords = req.data.targetRecords.map(r => ({
        ...r,
        classification: classify(r),
    }));
});

// Define a replication configuration
await federation.addReplication({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { service: 'db', entity: 'db.BusinessPartners' },
    mode: 'delta',
    delta: { field: 'modifiedAt', mode: 'timestamp' },
});

// Run on demand
await federation.run('BusinessPartners');

// Cache invalidation (with cds-caching)
const cache = await cds.connect.to('caching');
await cache.deleteByTag('federation:Customers');
```

### Event hooks

Pipeline events are namespaced to avoid collision with CAP's CRUD aliases (`READ`, `WRITE`):

| Event | Fires | `req.data` contains |
|---|---|---|
| `REPLICATE.READ` | Once per run, before batch iteration | `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `REPLICATE.MAP` | Once per batch | `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `REPLICATE.WRITE` | Once per batch, after MAP | `targetRecords` (handler writes and sets `statistics`) |

Hooks register via standard CAP API: `srv.before/on/after(event, replicationName, handler)`.

**Signature note.** CAP convention: `before` and `on` hooks receive `(req)`; `after` hooks receive `(results, req)`. For non-READ events `results` is usually `undefined`, so `after` hooks should read and mutate state on the second argument (`req.data`).

**Ordering note.** Multiple hooks for the same `(event, path)` run in parallel via `Promise.all`. If you need sequential ordering, use `srv.prepend(() => srv.before(...))`.

## CQL limitations on remote (OData) services

These are CAP-platform limitations when routing CQL to OData — not plugin-specific. Everything else works through the delegation pipeline.

| CQL feature | Reason | Workaround |
|---|---|---|
| `.where({ field: { like: '%X%' } })` | OData `$filter` has no `like` keyword | Use `contains(...)`, `startswith(...)`, `endswith(...)` via HTTP `$filter` |
| `SELECT.distinct` | CAP's `cqn2odata` rejects `.distinct` | Deduplicate in app code, or replicate and use local SQL |
| `.groupBy()` / `.having()` / `$apply` | CAP rejects aggregation on remote services | Aggregate in app code, or replicate and use local SQL |
| `forUpdate()` / `forShareLock()` | DB concept, not OData | Use ETags for optimistic concurrency |

## Contributing to the docs

The documentation site lives under [`docs/`](./docs/) and is built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/). The npm scripts create and use a local Python virtual environment (`.venv/`, gitignored) so no system `pip` access is needed. Requires `python3` on `PATH`.

```bash
npm run docs:setup   # creates .venv/ and installs MkDocs deps (one-time)
npm run docs:serve   # mkdocs serve — http://127.0.0.1:8000
npm run docs:build   # mkdocs build --strict
```

The site auto-deploys to GitHub Pages from `main` via [`.github/workflows/docs.yml`](./.github/workflows/docs.yml). The first run also requires **Settings → Pages → Source = "GitHub Actions"** on the repository.

## Links

- [Documentation site](https://mikezaschka.github.io/cds-data-federation/) — full docs with search, built from `docs/`.
- [docs/reference/requirements.md](./docs/reference/requirements.md) — full feature matrix, status, architecture.
- [CLAUDE.md](./CLAUDE.md) — deep architecture notes and conventions (for AI assistants and contributors).
- [docs/reference/comparison.md](./docs/reference/comparison.md) — detailed comparison with CAP samples, community plugins, and platform alternatives.
- [docs/internal/research/cap-builtin-analysis.md](./docs/internal/research/cap-builtin-analysis.md) — CAP's native integration primitives and the manual patterns this plugin automates.
- [docs/internal/research/replication-cache-analysis.md](./docs/internal/research/replication-cache-analysis.md) — analysis of `@cap-js-community/common`'s Replication Cache.
- [docs/concepts/expand-scenarios.md](./docs/concepts/expand-scenarios.md) — cross-service `$expand` design.
- [docs/concepts/terminology.md](./docs/concepts/terminology.md) — federation / delegation / replication terminology.
- [docs/concepts/service-query-execution.md](./docs/concepts/service-query-execution.md) — how queries route through services vs. DB.
- [cds-caching](https://github.com/mikezaschka/cds-caching) — peer-dep caching plugin.
- [CAP CaLeSi guide](https://cap.cloud.sap/docs/guides/integration/calesi) — upstream delegation & federation reference.
- [CAP Reuse & Compose — Service Integration](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#service-integration) — how remote services are imported and integrated (entry-point pattern for this plugin).
