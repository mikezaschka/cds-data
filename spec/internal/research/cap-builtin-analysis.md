# CAP Built-in Analysis: Native Federation & Integration Capabilities

This document details what SAP CAP provides natively for data federation, delegation, replication, and remote service integration — the building blocks that cds-data-federation automates. For each capability in the comparison matrix, we describe what CAP offers, show how the manual implementation looks, and link to the relevant documentation.

---

## Overview

CAP's architecture treats remote services as first-class CAP services. The `cds.connect.to()` API returns either a local `cds.ApplicationService` or a remote `cds.RemoteService` proxy — both share the same `cds.Service` base class and the same query API. This means queries, filters, and expands written in CQL work identically regardless of whether the target is local or remote.

The key primitives:

| API | Purpose | Docs |
|---|---|---|
| `cds.connect.to(name)` | Connect to any service (local or remote) | [cds-connect](https://cap.cloud.sap/docs/node.js/cds-connect) |
| `srv.run(query)` | Execute CQL query on any service | [srv-run](https://cap.cloud.sap/docs/node.js/core-services#srv-run) |
| `srv.send(method, path, data)` | Send arbitrary request | [srv-send](https://cap.cloud.sap/docs/node.js/core-services#srv-send-request) |
| `srv.emit(event, data)` | Emit async event | [srv-emit](https://cap.cloud.sap/docs/node.js/core-services#srv-emit-event) |
| `srv.on(event, handler)` | Register event handler | [srv-on](https://cap.cloud.sap/docs/node.js/core-services#srv-on-event) |
| `cds.outboxed(srv)` | Wrap service with transactional outbox | [outbox](https://cap.cloud.sap/docs/node.js/outbox) |
| `cds.ql.clone(query)` | Clone CQN safely before modification | [cds-ql-clone](https://cap.cloud.sap/docs/node.js/cds-ql#clone) |

**What cds-data-federation adds:** Declarative annotations that auto-wire these primitives, eliminating the manual handler code shown below. Annotate `@federation.delegate` or `@federation.replicate` on a consumption view, and the plugin registers all necessary handlers, manages replication schedules, translates navigation filters, resolves cross-service `$expand`, and integrates caching — all without writing a single line of JavaScript.

---

## Capability Breakdown

### Delegate (Live Proxy)

**CAP status:** Manual code — all primitives available, you write the handler yourself.

CAP provides automatic query translation through CDS projection chains. When you call `remote.run(req.query)` on a consumption view, CAP translates field names, restricts `$select` to projected columns, and maps results back. But you must register the handler manually for each entity.

```js
// srv/travel-service.js
const s4 = await cds.connect.to('sap.capire.s4.business-partner')
const { Customers } = cds.entities('sap.capire.s4')

this.on('READ', Customers, req => s4.run(req.query))
```

This is the xtravels sample pattern: one line per entity, but it must be written for every delegated entity.

**What's automatic:** Query translation (`$filter`, `$select`, `$orderby`), column restriction, result mapping — all handled by CAP through the projection chain.

**What's manual:** Handler registration, navigation path filter translation for renamed associations, cross-service `$expand` resolution.

Ref: [Service Integration guide — Delegation](https://cap.cloud.sap/docs/guides/integration/calesi#delegation), [Service Integration guide — Automatic Query Translation](https://cap.cloud.sap/docs/guides/integration/calesi#automatic-query-translation)

---

### Replicate into Main DB

**CAP status:** Manual code — the xtravels sample demonstrates the full pattern.

CAP provides all the building blocks: `@cds.persistence.table` to create local tables from consumption views, `UPSERT` for idempotent writes, and `srv.run()` for querying remote services. But you implement the replication logic yourself.

**Step 1 — Turn consumption view into a table:**

```cds
// Turn the consumption view into a persistence table for replicated data
annotate x.Flights with @cds.persistence.table;
```

**Step 2 — Basic per-entity replication:**

```js
const xflights = await cds.connect.to('sap.capire.flights.data')
const { Flights } = cds.entities('sap.capire.xflights')
let { latest } = await SELECT.one`max(modifiedAt) as latest`.from(Flights)
let touched = await xflights.read(Flights).where`modifiedAt > ${latest || 0}`
if (touched.length) await UPSERT(touched).into(Flights)
```

**Step 3 — Generic `@federated` handler (from xtravels data-federation.js):**

```js
const cds = require('@sap/cds')
const feed = []

cds.on('loaded', csn => {
  for (let e of cds.linked(csn).entities) {
    if (e['@federated']) {
      let srv = remote_srv4(e)
      if (is_remote(srv)) {
        e['@cds.persistence.table'] = true
        feed.push({ entity: e.name, remote: srv })
      }
    }
  }
})

cds.once('served', () => Promise.all(feed.map(async each => {
  const srv = await cds.connect.to(each.remote)
  srv._once ??=! srv.on('replicate', replicate)
  await srv.schedule('replicate', each).every('10 minutes')
})))

async function replicate(req) {
  let { entity } = req.data, remote = this
  let { latest } = await SELECT.one`max(modifiedAt) as latest`.from(entity)
  let rows = await remote.run(
    SELECT.from(entity).where`modifiedAt > ${latest}`
  )
  if (rows.length) await UPSERT(rows).into(entity)
}
```

**What's manual:** `@cds.persistence.table` annotation, replication scheduling, delta detection (`modifiedAt`-based), UPSERT logic, error handling, retry, concurrency control.

Ref: [Service Integration guide — Data Federation](https://cap.cloud.sap/docs/guides/integration/calesi#data-federation), [Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation)

---

### Native Joins with Local Data

**CAP status:** Works automatically once data is replicated into the main DB.

Once a consumption view has `@cds.persistence.table` and data has been replicated, CAP treats the entity like any other local table. SQL joins work natively:

```js
await SELECT.from(Bookings).where`Flight.origin like '%Ken%'`
```

Without federation (data not replicated), the same query fails because CAP cannot join across service boundaries at the SQL level. You'd need to split it manually:

```js
const flights = await xflights.read`ID`.from`Flights`.where`origin like '%Ken%'`
const flightIDs = flights.map(f => f.ID)
await SELECT.from(Bookings).where`Flight.ID in ${flightIDs}`
```

Ref: [Service Integration guide — Navigation](https://cap.cloud.sap/docs/guides/integration/calesi#navigation)

---

### Field Renames (Consumption Views)

**CAP status:** Fully supported — this is a core CDS modeling feature.

Consumption views with `as` clauses define field renames. CAP automatically translates queries through the projection chain:

```cds
@federated entity Customers as projection on S4.A_BusinessPartner {
  BusinessPartner as ID,
  PersonFullName  as Name,
  LastChangeDate  as modifiedAt,
} where BusinessPartnerCategory == 1;
```

When you query `Customers` with `$filter=Name eq 'Acme'`, CAP translates to `$filter=PersonFullName eq 'Acme'` on the remote `A_BusinessPartner` entity.

**What's automatic:** Rename translation in `$select`, `$filter`, `$orderby`, result mapping.

**What's not automatic:** Navigation path filter translation for renamed associations (e.g., `buyer/name` where `buyer` is renamed from `customer`) — this is what cds-data-federation's `translateNavigationFilters()` handles.

Ref: [Service Integration guide — Consumption Views](https://cap.cloud.sap/docs/guides/integration/calesi#consumption-views)

---

### Column Restriction

**CAP status:** Fully supported via CDS projections.

When a consumption view projects only a subset of fields, CAP automatically restricts `$select` to those columns. In the example above, `Customers` only projects `BusinessPartner`, `PersonFullName`, `LastChangeDate`, and `BusinessPartnerCategory`. Remote requests never include fields outside the projection.

Ref: [Service Integration guide — Consumption Views](https://cap.cloud.sap/docs/guides/integration/calesi#consumption-views)

---

### Scheduled Sync

**CAP status:** Manual — you write the scheduling logic.

The xtravels sample uses `srv.schedule().every()` for periodic replication:

```js
await srv.schedule('replicate', each).every('10 minutes')
```

There is no built-in cron or scheduling framework in CAP. The `schedule` API shown in xtravels is a convenience built on top of `setInterval`. For production, you'd typically use an external scheduler (Cloud Foundry jobs, Kubernetes CronJobs) or implement your own.

**What's manual:** Schedule definition, interval management, error recovery on missed runs, concurrency control between scheduled executions.

Ref: [Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation)

---

### Delta / Incremental Sync

**CAP status:** Manual — the xtravels sample demonstrates `modifiedAt`-based delta.

The generic replication handler in xtravels uses `max(modifiedAt)` to track the high-water mark and only fetches records modified after that timestamp:

```js
let { latest } = await SELECT.one`max(modifiedAt) as latest`.from(entity)
let rows = await remote.run(
  SELECT.from(entity).where`modifiedAt > ${latest}`
)
```

This is a simple but effective polling-based delta strategy. It requires the remote entity to have a `modifiedAt` field.

**What's manual:** High-water mark tracking, delta query construction, handling of deletes (not covered by this pattern — deleted records in the source are never removed locally), OData delta token support.

Ref: [Data Federation guide — Service-level Replication](https://cap.cloud.sap/docs/guides/integration/data-federation#service-level-replication)

---

### Event-Driven Sync

**CAP status:** Manual — all primitives available via CAP messaging and transactional outbox.

CAP provides `srv.emit()` for asynchronous events and `cds.outboxed()` for reliable delivery:

```js
// Provider side: emit event when data changes
const xflights_ = cds.outboxed(xflights)
this.after('SAVE', Travels, ({ Bookings = [] }) => {
  return Promise.all(Bookings.map(booking => {
    let { Flight_ID: flight, Flight_date: date } = booking
    return xflights_.send('POST', 'BookingCreated', { flight, date })
  }))
})

// Consumer side: subscribe to events
xflights.on('Flights.Updated', async msg => {
  // re-replicate affected data
})
```

The transactional outbox stores events in the same transaction as the triggering write, then a background process reliably delivers them.

**What's manual:** Event definition, handler registration, mapping events to replication triggers, error handling, idempotent event processing.

Ref: [Service Integration guide — Outboxed Emits](https://cap.cloud.sap/docs/guides/integration/calesi#outboxed-emits), [CAP Messaging](https://cap.cloud.sap/docs/guides/messaging/)

---

### Custom Transforms

**CAP status:** Manual code — no hook system, you write the transformation logic inline.

Transformations between remote and local schemas are handled in application code:

```js
let rows = await remote.run(SELECT.from(entity))
rows = rows.map(row => ({
  ...row,
  status: mapRemoteStatus(row.status),
  amount: convertCurrency(row.amount, row.currency, 'EUR')
}))
await UPSERT(rows).into(entity)
```

There is no declarative hook system or event pipeline for transforms. You write the mapping code directly in your replication handler.

**What's manual:** Everything — transformation logic, pipeline orchestration, before/after hooks.

---

### Multi-Source Federation

**CAP status:** Not supported as a built-in pattern.

CAP has no concept of merging data from multiple remote sources into a single local entity. Each consumption view points to exactly one source. If you need to combine data from two providers into one local entity, you write the merge logic yourself.

**What's manual:** Source coordination, conflict resolution, key deduplication, merge strategy.

---

### Retry / Resilience

**CAP status:** Manual — basic retry must be coded by the developer.

CAP's `cds.RemoteService` provides timeout configuration via `credentials.requestTimeout`, and the Cloud SDK libraries handle some connectivity resilience. But application-level retry (exponential backoff, skip-4xx, max retries) is not built in:

```json
{
  "cds": {
    "requires": {
      "API_BUSINESS_PARTNER": {
        "kind": "odata",
        "credentials": {
          "requestTimeout": 60000
        }
      }
    }
  }
}
```

For replication retry, you'd implement your own:

```js
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn() }
    catch (e) {
      if (i === maxRetries || e.status < 500) throw e
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    }
  }
}
```

**What's manual:** Retry logic, backoff strategy, error classification (retriable vs. permanent), circuit breaker patterns.

Ref: [Remote Services — Configuration](https://cap.cloud.sap/docs/node.js/remote-services)

---

### Response Cache / Entity Cache / TTL / LRU

**CAP status:** Not available.

CAP provides no built-in caching layer for remote service responses or replicated entity data. There is no TTL, LRU eviction, or cache invalidation mechanism. Every remote call hits the network unless you add caching yourself or use a plugin (`cds-caching`, `@cap-js-community/common`).

---

### Per-Tenant Cache Isolation

**CAP status:** Not available.

CAP's multi-tenancy support (`@sap/cds-mtxs`) handles tenant isolation at the database level, but there is no tenant-aware caching infrastructure for remote service data.

---

### Monitoring

**CAP status:** Not available for federation/replication.

CAP provides general observability hooks (`cds.log`, Open Telemetry integration via `@cap-js/telemetry`), but no federation-specific monitoring: no replication run tracking, no success/failure dashboards, no sync status API.

---

### Rate Limiting

**CAP status:** Not available.

CAP has no built-in rate limiting for outbound remote service calls or inbound request throttling.

---

## Cross-Service $expand

This deserves its own section because it's the most complex area where manual code is required.

### Scenario A: Remote-to-Remote $expand

When both the parent and the expanded association target are on the same remote service, CAP forwards the `$expand` natively. No custom code needed.

```js
// Works out of the box — CAP forwards $expand to the remote service
this.on('READ', Orders, req => remote.run(req.query))
// GET /Orders?$expand=customer → forwarded as-is to the remote
```

### Scenario B: Local-to-Remote $expand

When a local entity has an association to a federated entity, CAP cannot resolve the `$expand` across service boundaries. You must split the query manually:

```js
// Manual: fetch local data, then batch-fetch remote data, stitch
await SELECT.from(Bookings).columns`Flight_ID, Flight_date`.limit(3)
  .then(all => Promise.all(all.map(async b => ({
    Flight: await xflights.read`ID, date, destination`
      .from`Flights`.where`ID = ${b.Flight_ID} and date = ${b.Flight_date}`
  }))))
```

This is what cds-data-federation's `registerLocalExpandResolvers()` automates.

### Scenario C: Remote-to-Local $expand

When a remote entity has a backlink association to a local entity and the client requests `$expand`, the expand must be resolved locally:

```js
// Manual: fetch remote data, then expand local associations
const customers = await s4.read(Customers).columns`{ ID, Name }`
  .then(all => Promise.all(all.map(async c => Object.assign(c, {
    Travels: await SELECT`ID`.from(Travels).where`Customer.ID = ${c.ID}`
  }))))
```

Ref: [Service Integration guide — Expands](https://cap.cloud.sap/docs/guides/integration/calesi#expands)

---

## Cross-Service Navigation

Navigation is distinct from `$expand`. While `$expand` embeds associated data inline (`/Risks?$expand=supplier`), navigation follows an association path to a different entity (`/Risks(id)/supplier`). The CQN structures differ fundamentally:

**$expand** — the association appears as a column with `.expand`:

```json
{
  "from": { "ref": ["RiskService.Risks"] },
  "columns": [
    { "ref": ["ID"] },
    { "ref": ["supplier"], "expand": [{ "ref": ["ID"] }, { "ref": ["fullName"] }] }
  ]
}
```

**Navigation** — the `from.ref` has 2 segments (source entity + association name):

```json
{
  "from": {
    "ref": [
      { "id": "RiskService.Risks", "where": [{ "ref": ["ID"] }, "=", { "val": "..." }] },
      "supplier"
    ]
  },
  "columns": [{ "ref": ["ID"] }, { "ref": ["fullName"] }],
  "one": true
}
```

**CAP status:** Manual — you must detect the multi-segment `from.ref` and resolve it yourself.

When a user clicks a link in a Fiori Elements list page to navigate from a Risk to its Supplier, the framework generates a navigation URL, not an expand. The handler for the **target** entity (Suppliers) must detect this and resolve the source entity's FK:

```js
// From risk-service.js — handling Risks(id)/supplier navigation
this.on('READ', 'Suppliers', async (req, next) => {
    const select = req.query.SELECT;
    if (!(select.from.ref.length == 2
        && select.from.ref[0].id == 'RiskService.Risks')) return next();

    const risk = await this.run(SELECT.one('supplier_ID')
        .from('RiskService.Risks')
        .where(select.from.ref[0].where));

    if (!risk) throw new Error(`Risk doesn't exists`);

    return this.run(SELECT(select.columns)
        .from('RiskService.Suppliers')
        .where("ID = ", risk.supplier_ID));
});
```

This handler runs on `Suppliers` but needs to understand `Risks` — a tight coupling between unrelated entities.

Ref: [Consuming Services — Handle Navigations](https://cap.cloud.sap/docs/guides/services/consuming-services#handle-navigations-across-local-and-remote-entities), [risk-service.js](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js)

---

## Reuse & Compose — Service Integration

The [Reuse & Compose guide](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose) documents how CAP apps can **import content from reuse packages** (schemas, services, implementations, data, i18n) via `npm add`. Once imported, the consumer chooses between two modes:

| Mode | Configuration | Service runs | Our plugin applies |
|---|---|---|---|
| **Embedded** (default) | No `cds.requires` entry. The imported service's models + implementation run inside the consumer process. | In-process, shared DB. | No — embedded services are local; federation is not needed. |
| **Integrated** | `cds.requires.<Service>: { kind: 'odata', model: '@capire/...' }` | As a separate microservice, reached via the Cloud SDK client. | **Yes** — this is the precondition our `@federation.*` annotations operate on. |

```json
"cds": {
  "requires": {
    "ReviewsService": {
      "kind": "odata", "model": "@capire/reviews"
    }
  }
}
```

### The manual delegation example CAP shows

The guide's delegation example mashes up a local `CatalogService` with a remote `ReviewsService` by registering a per-association handler on `Books/reviews`:

```js
// bookstore/srv/mashup.js
const CatalogService = await cds.connect.to('CatalogService')
const ReviewsService = await cds.connect.to('ReviewsService')
CatalogService.prepend(srv => srv.on('READ', 'Books/reviews', (req) => {
  const [id] = req.params, { columns, limit } = req.query.SELECT
  return ReviewsService.read('Reviews', columns).limit(limit).where({ subject: String(id) })
}))
```

Three things the developer has to do manually:

1. Register the handler against the exact navigation path `'Books/reviews'` (one per association).
2. Read the source key from `req.params`, forward the columns/limit from the inbound query, and rewrite the `where` clause against the remote's FK field (`subject`).
3. Wrap the registration with `.prepend` so the custom handler supersedes CAP's default generic handler.

This is a simpler cousin of the Risk Management sample's Handler 5 (Scenario B expand). It targets the **to-many backlink** case where the association lives on the remote side (Books → reviews, where `reviews.subject = Books.ID` is the FK on the remote Reviews entity).

### The "Restricted Reuse Options" warning

The guide explicitly calls out limits that apply once a service is integrated (not embedded):

> "Because models of integrated services only serve as imported APIs, **you're restricted with respect to how you can use the models of services to integrate with**. For example, only adding fields is possible, or cross-service navigation and expands."

This aligns one-to-one with the CQL/OData limitations tracked in `CLAUDE.md` (no `like`, no `distinct`, no `$apply`, no flatten, no cross-service projection). Nothing in this guide contradicts our design.

### With cds-data-federation

The `CatalogService.prepend(...)` snippet is exactly what the plugin's [**cross-service expand: local → remote**](../../concepts/cross-service-scenarios.md#cross-service-expand-local--remote) (formerly Scenario B) and [**cross-service navigation: remote → local**](../../concepts/cross-service-scenarios.md#cross-service-navigation-remote--local) (formerly N2) resolve automatically for any consumption view. The plugin collects foreign keys from the local records, batch-fetches the remote in a single call, handles composite keys / to-many grouping / `$top` per-parent / nested expands / renamed FKs, and stitches results — replacing per-association hand-rolled handlers.

| Integration pattern | CAP guide example | cds-data-federation |
|---|---|---|
| `GET /Books(id)/reviews` (remote→remote backlink, cross-service expand: local → remote variant) | Manual `srv.on('READ', 'Books/reviews', ...)` | Auto-registered via `@federation.delegate` on the `Reviews` consumption view |
| `GET /Risks(id)/supplier` (cross-service navigation: local → remote, formerly N1) | Custom handler reading `supplier_ID`, delegating | `resolveLocalToRemoteNavigation()` |
| `GET /Suppliers(id)/risks` (cross-service navigation: remote → local, formerly N2) | Custom handler detecting `from.ref.length == 2`, rewriting | `rewriteRemoteToLocalNavigation()` |
| `GET /Risks?$expand=supplier` (cross-service expand: local → remote, formerly Scenario B) | Custom strip-and-stitch handler (~30 lines) | `registerLocalExpandResolvers()` |
| `GET /Suppliers?$expand=risks` (cross-service expand: remote → local, formerly Scenario C) | Custom strip-and-stitch handler (~25 lines, single-record only) | `resolveRemoteToLocalExpands()` (handles lists) |

Ref: [Reuse & Compose — Service Integration](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#service-integration), [bookstore/srv/mashup.js](https://github.com/capire/bookstore/blob/main/srv/mashup.js)

---

## Inner-Loop Development Tooling

The [Inner-Loop Development guide](https://cap.cloud.sap/docs/guides/integration/inner-loops) documents CAP's dev-workflow tooling for apps that integrate with remote services. None of these features change the plugin's runtime behaviour — the plugin sits behind CAP's service resolution — but they affect how consumers develop and test apps that use `@federation.*`.

### `cds watch` — mock out-of-the-box

When a consumer app declares a remote service in `cds.requires` and starts with `cds watch`, CAP **automatically mocks** that service in-process, backed by the shared in-memory database:

```
[cds] - mocking sap.capire.s4.business-partner {
  at: [ '/odata/v4/s4-business-partner' ],
  decl: 's4/external/API_BUSINESS_PARTNER.csn:7'
}
```

For plugin consumers: `@federation.delegate` entities work transparently in mocked mode — the "remote" service runs in the same process, and `remote.run(req.query)` resolves against the mock. `@federation.replicate` also works: the scheduled sync pulls from the mock into the main DB. No configuration changes are needed to switch between mock and real.

### `cds mock` — separate processes, local bindings

For closer-to-production testing, `cds mock <api.cds>` starts a remote service in a separate process. `cds watch` then **auto-binds** required services through `~/.cds-services.json`:

```json
{
  "cds": {
    "provides": {
      "ReviewsService": {
        "kind": "odata",
        "credentials": { "url": "http://localhost:4005/reviews" }
      }
    }
  }
}
```

`cds watch` on the provider side writes its entry; `cds watch` on the consumer side reads the binding. The plugin's delegate handler calls `remote.run(req.query)`, which follows the binding to the separate process.

### `cds repl` — interactive query inspection

`cds repl <app>` exposes `cds.connect.to()` and CQL interactively:

```js
const s4 = await cds.connect.to('sap.capire.s4.business-partner')
await s4.read`A_BusinessPartner`.limit(3)   // raw remote entity
const { Customers } = cds.entities('sap.capire.s4')
await s4.read(Customers).limit(3)           // through consumption view
```

Useful for debugging plugin consumers: test that the consumption view's renames round-trip correctly (e.g. `BusinessPartner → ID`, `PersonFullName → Name`) before adding `@federation.delegate`.

### npm workspaces + proxy packages — fast iteration across projects

`npm workspaces` and the "proxy package" pattern let the consumer app import the provider's CDS sources directly from the workspace, eliminating the `export → publish → install` cycle during API iteration. For plugin consumers this means the consumption view can be updated as the provider's schema evolves, without the plugin needing any awareness of the source — the annotation scanner re-reads the CSN on every `cds watch` reload.

### Why the plugin's test harness uses real provider apps instead of `cds mock`

Despite `cds mock` being the guide's recommended dev workflow, the plugin's [`packages/cds-data-federation/test/support/setup.js`](https://github.com/mikezaschka/cds-data-monorepo/blob/main/packages/cds-data-federation/test/support/setup.js) spawns **real** CAP provider apps (`test/fixtures/provider`, `test/fixtures/inventory`, `test/fixtures/rest-provider`) rather than using `cds mock`. Per `CLAUDE.md` §6 ("what NOT to do"):

> "Don't write tests that mock the provider service — use the real `test/provider` CAP app via `setup.js`. Mocking gives false confidence; the real OData translation has subtleties (`@odata.count`, OData v2 timestamp format, etc.) that mocks miss."

The plugin's test harness is intentionally closer to production than the inner-loop defaults. `cds mock` remains the correct tool for **plugin consumers**' own app tests — it just doesn't exercise the protocol surface we need to verify.

### Compatibility summary

| Tool | Compatible with plugin | Notes |
|---|---|---|
| `cds watch` (in-process mock) | Yes | Delegate + replicate both work against the mock. |
| `cds mock` (separate processes) | Yes | Plugin sees a real OData endpoint; no distinction from production. |
| `~/.cds-services.json` bindings | Yes | Resolved by CAP before the plugin runs. |
| `cds repl` | Yes | Useful for debugging consumption view renames. |
| npm workspaces / proxy packages | Yes | Annotation scanner re-reads CSN on reload. |
| CSV-based mock data | Yes | Delegate reads it through the mock; replicate pulls it into the main DB. |

Ref: [Inner-Loop Development](https://cap.cloud.sap/docs/guides/integration/inner-loops)

---

## Reference App: SAP Risk Management

The [SAP Risk Management sample](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui) is an official SAP reference application that integrates local risk management with the remote `API_BUSINESS_PARTNER` from S/4HANA. It demonstrates the **full manual mashup approach** — every pattern that cds-data-federation automates.

### The data model

```cds
// db/schema.cds
namespace sap.ui.riskmanagement;
using { API_BUSINESS_PARTNER as bupa } from '../srv/external/API_BUSINESS_PARTNER';

entity Risks : managed {
    key ID   : UUID;
    title    : String(100);
    impact   : Integer;
    supplier : Association to Suppliers;       // local → remote FK
}

entity Suppliers as projection on bupa.A_BusinessPartner {
    key BusinessPartner as ID,                 // rename
    BusinessPartnerFullName as fullName,        // rename
    BusinessPartnerIsBlocked as isBlocked,      // rename
    risks : Association to many Risks           // backlink mixin (remote → local)
        on risks.supplier = $self
}
```

Two entity types, two data sources:
- `Risks` — local (SQLite/HANA), with a managed association `supplier` pointing to the remote
- `Suppliers` — remote projection on `A_BusinessPartner` with field renames, plus a backlink `risks` association to local Risks

This setup requires handling **all three cross-service patterns**: basic delegation, local→remote `$expand`, remote→local `$expand`, and cross-boundary navigation.

Source: [db/schema.cds](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/db/schema.cds)

### The manual handler code (~100 lines)

The [risk-service.js](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js) registers **5 separate handlers** that must be ordered correctly. Each implements a pattern our plugin automates.

#### Handler 1: Scenario C — Remote expand local (`/Suppliers?$expand=risks`)

```js
this.on('READ', 'Suppliers', async (req, next) => {
    const select = req.query.SELECT;
    if (!select.columns) return next();
    const expandIndex = select.columns.findIndex(
        ({ expand, ref }) => expand && ref[0] === "risks"
    );
    if (expandIndex < 0) return next();
    const expandColumns = select.columns[expandIndex].expand;

    req.query.SELECT.columns.splice(expandIndex, 1);    // mutates shared query!

    if (expandColumns.indexOf('*') == -1 &&
        !expandColumns.find(column => column.ref && column.ref.find(ref => ref == "ID")))
    {
        expandColumns.push({ ref: ["ID"] });
    }

    const suppliers = await next();
    if (Array.isArray(suppliers) && suppliers.length > 0)
        throw new Error('Expand only allowed when requesting one supplier.');
    const supplier = Array.isArray(suppliers) ? suppliers[0] : suppliers;

    supplier.risks = await this.run(SELECT(expandColumns)
        .from('RiskService.Risks')
        .where("supplier_ID = ", supplier.ID)
        .limit(select.limit?.rows?.val, select.limit?.offset?.val));

    return suppliers;
});
```

**Issues:**
- Only works for a **single** supplier — throws an error when expanding a list.
- Mutates `req.query.SELECT.columns` in-place with `splice()` — no `cds.ql.clone()`.
- Hardcodes entity name `'RiskService.Risks'` and FK name `'supplier_ID'`.

#### Handler 2: Cross-boundary navigation (`/Risks(id)/supplier`)

```js
this.on('READ', 'Suppliers', async (req, next) => {
    const select = req.query.SELECT;
    if (!(select.from.ref.length == 2
        && select.from.ref[0].id == 'RiskService.Risks')) return next();

    const risk = await this.run(SELECT.one('supplier_ID')
        .from('RiskService.Risks')
        .where(select.from.ref[0].where));

    if (!risk) throw new Error(`Risk doesn't exists`);

    const suppliers = await this.run(SELECT(select.columns)
        .from('RiskService.Suppliers')
        .where("ID = ", risk.supplier_ID)
        .limit(select.limit?.rows?.val, select.limit?.offset?.val));

    return suppliers;
});
```

**Issues:**
- Handler is on `Suppliers` but must understand the `Risks` entity structure — tight coupling.
- Hardcodes `'RiskService.Risks'` in the `ref[0].id` check — breaks on refactoring.
- Error message has a typo ("doesn't exists").

#### Handler 3: Basic delegation (fallthrough)

```js
this.on('READ', 'Suppliers', async req => {
    return bupa.run(req.query);
});
```

Must be registered **last** — if placed before Handlers 1-2, expand and navigation requests would be forwarded to the remote service, which cannot resolve the local `risks` association.

#### Handler 4: Computed field enrichment (app-specific)

```js
this.after('READ', 'Risks', risksData => {
    const risks = Array.isArray(risksData) ? risksData : [risksData];
    risks.forEach(risk => {
        if (risk.impact >= 100000) {
            risk.criticality = 1;
        } else {
            risk.criticality = 2;
        }
    });
});
```

Not federation-related — this is application-specific logic that computes a `criticality` field. It coexists with federation handlers. This is the **only** handler that would remain with the plugin.

#### Handler 5: Scenario B — Local expand remote (`/Risks?$expand=supplier`)

```js
this.on("READ", 'Risks', async (req, next) => {
    if (!req.query.SELECT.columns) return next();
    const expandIndex = req.query.SELECT.columns.findIndex(
        ({ expand, ref }) => expand && ref[0] === "supplier"
    );
    if (expandIndex < 0) return next();

    req.query.SELECT.columns.splice(expandIndex, 1);    // mutates shared query!

    if (!req.query.SELECT.columns.indexOf('*') >= 0 &&
        !req.query.SELECT.columns.find(
            column => column.ref && column.ref.find(ref => ref == "supplier_ID")))
    {
        req.query.SELECT.columns.push({ ref: ["supplier_ID"] });
    }

    const risks = await next();

    const asArray = x => Array.isArray(x) ? x : [x];
    const supplierIds = asArray(risks).map(risk => risk.supplier_ID);
    const suppliers = await bupa.run(
        SELECT.from('RiskService.Suppliers').where({ ID: supplierIds })
    );

    const suppliersMap = {};
    for (const supplier of suppliers) suppliersMap[supplier.ID] = supplier;
    for (const note of asArray(risks)) note.supplier = suppliersMap[note.supplier_ID];

    return risks;
});
```

**Issues:**
- Mutates `req.query.SELECT.columns` in-place — no `cds.ql.clone()`.
- FK column injection has a precedence bug: `!req.query.SELECT.columns.indexOf('*') >= 0` evaluates as `(!indexOf) >= 0` which is always `true` when `*` is at index 0.
- No chunking for large `supplierIds` arrays — can exceed OData URL length limits.
- No error handling for failed remote batch-fetch.

### With cds-data-federation: annotation replaces ~100 lines

The CDS model is **identical** — consumption views and associations stay the same. The only change: add `@federation.delegate` and **delete the integration handler code**:

```cds
@federation.delegate
entity Suppliers as projection on bupa.A_BusinessPartner {
    key BusinessPartner as ID,
    BusinessPartnerFullName as fullName,
    BusinessPartnerIsBlocked as isBlocked,
    risks : Association to many Risks on risks.supplier = $self
}
```

```js
// srv/risk-service.js — ONLY the app-specific logic remains
module.exports = cds.service.impl(async function() {
    this.after('READ', 'Risks', risksData => {
        const risks = Array.isArray(risksData) ? risksData : [risksData];
        risks.forEach(risk => {
            risk.criticality = risk.impact >= 100000 ? 1 : 2;
        });
    });
});
```

The plugin auto-registers all necessary handlers via `service.prepend()`:
- Basic delegation (`remote.run(req.query)`)
- Scenario B resolver (Risks → supplier expand: batch-fetch + stitch)
- Scenario C resolver (Suppliers → risks expand: strip, forward, query local, stitch)
- Correct handler ordering (federation handlers before app-defined handlers)
- CQN safety (`cds.ql.clone()` on every query modification)

### Side-by-side comparison

| Concern | Manual (risk-service.js) | cds-data-federation |
|---|---|---|
| **Lines of integration code** | ~100 lines, 5 handlers | 0 lines, 1 annotation |
| **Handler ordering** | Must register expand/nav before delegation fallthrough; wrong order = silent bugs | `service.prepend()` guarantees correct order |
| **CQN mutation safety** | `columns.splice()` mutates shared query | `cds.ql.clone()` before every modification |
| **Scenario C list support** | Throws error: "Expand only allowed when requesting one supplier" | Handles both single records and lists |
| **FK column injection** | Manual `columns.push()` with precedence bug | Auto-injects required FK columns from association metadata |
| **Entity name hardcoding** | `'RiskService.Risks'`, `'supplier_ID'` — breaks on refactor | Infers from CDS model metadata |
| **Remote error handling** | None — remote failures crash the request | `propagateRemoteError()` with status + context |
| **Caching** | None — every request hits the remote API | Optional TTL-based caching: `{ cache: { ttl: 60000 } }` |
| **Retry** | None — transient failures are permanent | Configurable exponential backoff via `withRetry()` |
| **Monitoring** | None | Federation tracker with run history and statistics |

Source: [risk-service.js](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js), [db/schema.cds](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/db/schema.cds), [srv/risk-service.cds](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.cds)

---

## Required Mashup Implementations Matrix

When local and remote entities are mixed in a single service, six types of requests can occur. CAP handles some natively; others require manual code. This matrix shows what's needed and what the plugin automates.

Based on the [old "Consuming Services" guide](https://cap.cloud.sap/docs/guides/services/consuming-services#required-implementations-for-mashups):

| Request Type | Example URL | CAP Native? | Manual Code Required | cds-data-federation |
|---|---|---|---|---|
| Local (incl. same-source nav+expand) | `/Risks` | Yes | None | Not needed |
| Local: **expand** to remote | `/Risks?$expand=supplier` | No | Strip expand, batch-fetch remote, stitch results ([Handler 5](#handler-5-scenario-b--local-expand-remote-risksexpandsupplier)) | **Automated** (Scenario B) |
| Local: **navigate** to remote | `/Risks(id)/supplier` | No | Read source FK, query remote target ([Handler 2](#handler-2-cross-boundary-navigation-risksidsupplier)) | Planned |
| Remote (incl. same-remote nav+expand) | `/Suppliers`, `/Suppliers?$expand=addresses` | Partial | Delegation handler for each entity ([Handler 3](#handler-3-basic-delegation-fallthrough)) | **Automated** (`@federation.delegate`) |
| Remote: **expand** to local | `/Suppliers?$expand=risks` | No | Strip expand, forward remote, query local, stitch ([Handler 1](#handler-1-scenario-c--remote-expand-local-suppliersexpandrisks)) | **Automated** (Scenario C) |
| Remote: **navigate** to local | `/Suppliers(id)/risks` | No | Read remote source, query local target | Planned |

The risk-management sample requires Handlers 1-3 and 5 (4 of the 6 request types need manual code). With the plugin, all four are automated.

---

## Transient Access vs. Replication Decision Matrix

This matrix helps developers choose between `@federation.delegate` and `@federation.replicate`. Based on the [old "Consuming Services" guide](https://cap.cloud.sap/docs/guides/services/consuming-services#transient-access-vs-replication):

| Feature | Delegate (Transient) | Replicate (Local Copy) |
|---|---|---|
| **Filter on local OR remote fields** | Yes | Yes |
| **Filter on local AND remote fields (same request)** | **No** — requires cross-service query splitting | Yes — both are local SQL |
| **SQL JOINs with local entities** | **No** — different data sources | Yes — same database |
| **Flatten associations** | **No** — OData protocol limitation | Yes — local SQL can denormalize |
| **User permissions from remote system** | **Yes** — request carries user context to remote | **No** — replicated data bypasses remote auth |
| **Data freshness** | Live (always current) | Stale (until next sync) |
| **Performance** | Network-dependent (latency per request) | Local SQL (fast) |
| **Offline availability** | **No** — depends on remote uptime | **Yes** — serves from local DB |
| **Aggregation / $apply** | **No** — CAP rejects `.groupBy` for OData remotes | Yes — full SQL capabilities |
| **AI / Vector search** | **No** — remote OData has no vector support | Yes — extend with HANA embeddings |

**Rule of thumb:**
- Use `@federation.delegate` for: live lookups, low-volume reads, value helps, write-back scenarios
- Use `@federation.replicate` for: dashboards, analytics, cross-system joins, offline access, aggregations
- Add `cache: { ttl }` to delegate when: API is rate-limited, data changes infrequently, multiple users read the same data

---

## Projection Features: CAP Native vs. Plugin

The [old "Consuming Services" guide](https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features) documents which CDS projection features work with remote services. Several features that are **not supported natively** are implemented by the plugin:

| Projection Feature | CAP Native | cds-data-federation | Notes |
|---|---|---|---|
| Resolve projections to remote | Yes | Yes (via CAP) | Core CDS feature |
| Multi-level projection chains | Yes | Yes (via CAP) | E.g., `ServiceEntity → dbEntity → RemoteEntity` |
| Field aliases (`as` clauses) | Yes | Yes (via CAP) | Full rename translation |
| `excluding` | Yes | Yes (via CAP) | Excluded fields absent from response |
| Resolve associations (same remote) | Yes | Yes (via CAP) | Scenario A $expand |
| Redirected associations (`redirected to`) | Yes | Untested | Should work (CAP handles in projection chain) |
| **Static `where` clause** | **No** | **Yes** | Plugin extracts `projection.where` from CSN and injects into remote query via `runDirectRemoteQuery()`. Supports wildcard + restricted projections, combined with client `$filter`. |
| **`order by` in projection** | **No** | **No** | Same technique as `where` could apply (future) |
| Flatten associations (path expressions) | **No** | **No** | OData protocol limitation; works only with HCQL |
| Infix filter for associations | **No** | **No** | Not supported by CAP's `cqn2odata` serializer |
| Model associations with mixins | Yes | Yes (via CAP) | Backlink associations like `risks : Association to many Risks on risks.supplier = $self` |

The static `where` clause support is a concrete plugin value-add. CAP's documentation lists it as "not supported" for remote projections, but the plugin makes it work by extracting the where clause at model load time and injecting it into every remote query for that entity.

---

## Summary: What CAP Provides vs. What You Must Build vs. What the Plugin Provides

| Capability | CAP provides | You must build (manual) | cds-data-federation provides |
|---|---|---|---|
| **Remote service proxy** | `cds.connect.to()` + `cds.RemoteService` | Nothing | Nothing extra needed |
| **Query translation** | Automatic via CDS projection chains | Nav path filter translation for renamed associations | `translateNavigationFilters()` — automatic |
| **Delegation handler** | `this.on('READ', Entity, req => remote.run(req.query))` | One handler per entity, correct ordering | `@federation.delegate` — zero handlers, auto-registration via `service.prepend()` |
| **Consumption views** | Full CDS modeling: `as` clauses, `excluding`, projections | Nothing | Nothing extra needed |
| **Static `where` in projections** | **Not supported** for remote services | Custom query interception to inject filter | Automatic — `runDirectRemoteQuery()` extracts and injects `projection.where` |
| **Persistence tables** | `@cds.persistence.table` annotation | Setting annotation per entity + `@cds.persistence.skip: false` | Automatic for `@federation.replicate` at model load time |
| **Replication** | `UPSERT`, `SELECT`, remote `srv.run()` | Scheduling, delta detection, concurrency, retry, error handling, field mapping | `@federation.replicate` — full pipeline with hooks, retry, concurrency guard |
| **Cross-service $expand (B)** | **Not supported** across service boundaries | Strip expand, collect FKs, batch-fetch, build lookup, stitch ([~30 lines](#handler-5-scenario-b--local-expand-remote-risksexpandsupplier)) | `registerLocalExpandResolvers()` — automatic, handles lists, auto-injects FKs |
| **Cross-service $expand (C)** | **Not supported** across service boundaries | Strip expand, forward remote, query local, stitch ([~25 lines](#handler-1-scenario-c--remote-expand-local-suppliersexpandrisks)) | `resolveRemoteToLocalExpands()` — automatic, handles lists (no single-record limitation) |
| **Cross-service navigation** | **Not supported** across service boundaries | Detect `from.ref` segments, read source FK, query target ([~15 lines](#handler-2-cross-boundary-navigation-risksidsupplier)) | Planned |
| **CUD forwarding** | `remote.run(req.query)` for write operations | Handler registration per entity, read-only enforcement | `writable: true` annotation flag — auto-registers CUD handlers, enforces `@readonly` by default |
| **Event-driven sync** | `srv.emit()`, `cds.outboxed()`, messaging | Event-to-replication wiring, idempotent processing | Planned |
| **Caching** | Nothing | Everything — TTL, stores, invalidation | `{ cache: { ttl } }` option — via `cds-caching` peer dependency |
| **Monitoring** | `cds.log`, Open Telemetry hooks | Federation-specific tracking, dashboards, status APIs | Federation tracker + ReplicationRuns + Management OData API |
| **Retry** | `requestTimeout` on RemoteService | Backoff, error classification, circuit breakers | `withRetry()` — exponential backoff, skip-4xx, configurable |
| **CQN safety** | `cds.ql.clone()` available | Must remember to use it; easy to forget (see [Handler 5 bug](#handler-5-scenario-b--local-expand-remote-risksexpandsupplier)) | Always clones before modification |

### The bottom line

The xtravels sample's `data-federation.js` is ~30 lines and handles a simple replication case. The risk-management sample's `risk-service.js` is ~100 lines and handles delegation with cross-service $expand. Both are **reference-quality code from SAP** — and both contain limitations (single-record expand, no retry, no caching, CQN mutation bugs) that production scenarios cannot tolerate.

cds-data-federation replaces this manual code with declarative annotations while adding production qualities: correct handler ordering, CQN safety, error propagation, retry, caching, monitoring, and support for list-level $expand across service boundaries.

---

## References

| Resource | URL |
|---|---|
| Service Integration guide (CAP-Level Service Integration) | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP-level Data Federation | https://cap.cloud.sap/docs/guides/integration/data-federation |
| Reuse & Compose | https://cap.cloud.sap/docs/guides/integration/reuse-and-compose |
| Inner-Loop Development | https://cap.cloud.sap/docs/guides/integration/inner-loops |
| Consuming Services (deprecated, archived) | https://cap.cloud.sap/docs/guides/services/consuming-services |
| Remote Services API | https://cap.cloud.sap/docs/node.js/remote-services |
| Core Services API | https://cap.cloud.sap/docs/node.js/core-services |
| CDS Plugins | https://cap.cloud.sap/docs/plugins/ |
| CAP Messaging | https://cap.cloud.sap/docs/guides/messaging/ |
| Transactional Outbox | https://cap.cloud.sap/docs/node.js/outbox |
| Bookshop sample walkthrough (foundational tutorial — demonstrates projection-as-contract and the `cds.connect.to()` proxy in isolation) | https://cap.cloud.sap/docs/get-started/bookshop |
| Bookshop sample (GitHub, Node.js) | https://github.com/capire/bookshop |
| Bookshop sample (GitHub, Java) | https://github.com/sap-samples/cloud-cap-samples-java |
| xtravels sample (GitHub) | https://github.com/capire/xtravels |
| xflights sample (GitHub) | https://github.com/capire/xflights |
| xtravels data-federation.js | https://github.com/capire/xtravels/blob/main/srv/data-federation.js |
| bookstore sample (Reuse & Compose demo) | https://github.com/capire/bookstore |
| bookstore mashup.js (manual delegation example) | https://github.com/capire/bookstore/blob/main/srv/mashup.js |
| Risk Management sample (ext-service branch) | https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui |
| Risk Management risk-service.js | https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js |
| Risk Management db/schema.cds | https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/db/schema.cds |
| CAP Remote Services + Fiori Elements (blog) | https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/ |
| Native HANA features in CAP (synonyms, `@cds.persistence.exists`) | https://cap.cloud.sap/docs/advanced/hana#native-hana-features |
