---
title: "Introducing cds-data — three CAP plugins for federation, pipelines, and snapshots"
description: "A two-part introduction to cds-data: the annotation surfaces (cds-data-federation, cds-data-materialization) and the shared engine underneath (cds-data-pipeline). This post sets up the mental model. Part 2 zooms into federation with a reproducible xflights-based demo."
date: 2026-05-23
author: Mike Zaschka
tags: [SAP CAP, cds-data, federation, pipeline, materialization, BTP, side-by-side extensions]
---

# Introducing cds-data — three CAP plugins for federation, pipelines, and snapshots

> **Series — part 1 of 2.** Part 2 zooms into [`cds-data-federation`](./02-cds-data-federation-deep-dive.md) with a fully reproducible demo on top of SAP's canonical [`@capire/xflights`](https://github.com/capire/xflights) provider, built both manually and with an AI coding agent.

`cds-data` is a set of three SAP CAP plugins that turn remote-service integration into declarative CDS annotations on consumption views. The schema you already model becomes the integration contract; an annotation on the projection picks the runtime strategy (live forwarding, scheduled sync, or local aggregate snapshot). A shared engine handles the cross-cutting concerns underneath — retry, idempotency, concurrency guard, tracker, management OData service.

This post introduces the toolkit as a whole. The follow-up walks through `cds-data-federation` in depth and through a worked travel-extension demo against the [xflights](https://github.com/capire/xflights) reference provider, both as a hands-on tutorial and as an agent-driven scaffold.

---

## Terminology

The names in `cds-data` overlap with terms SAP uses in the [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) and with terms the data industry uses more broadly. The table below is the vocabulary the rest of this series uses.

### Federation, delegation, replication

**Federation** here means integrating remote service models into your CAP app's data model and choosing how that remote data is accessed at runtime. In the broader industry, federation usually means making multiple data sources appear as one — a unified interface over heterogeneous backends, whether queries are live or data is copied locally.

SAP's [Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation) uses the term more narrowly: copy remote data into the local database so it can be joined with your own data in SQL. That pattern is one strategy inside `cds-data`, not the whole story.

| Term in `cds-data` | Annotation / package | What it does |
|---|---|---|
| **Delegation** | `@federation.delegate` | Live proxy. Reads (and optional writes) forwarded to the remote service at request time. Matches CAP's delegation pattern: `remote.run(req.query)` with automatic query translation through the projection chain. |
| **Replication** | `@federation.replicate` | Scheduled sync. Remote rows copied into the local database via UPSERT; subsequent reads are plain local SQL. Matches CAP's data-federation pattern and the `@federated` marker in the [xtravels sample](https://github.com/capire/xtravels). |
| **Federation** (umbrella) | `cds-data-federation` | The annotation namespace that holds both strategies. From the developer's perspective the intent is the same — "I need this remote entity in my app" — and delegate vs. replicate is a runtime choice on the consumption view. |

Caching is orthogonal: `{ cache: { ttl: … } }` on either annotation, using [`cds-caching`](https://github.com/mikezaschka/cds-caching) for response-level TTL or the engine for entity-level SQLite snapshots.

### Consumption view

A **consumption view** is a CDS projection of the form `entity X as projection on remote.Y { … }`. It is the schema contract: which remote fields, what shape, what renames. The `@federation.*` annotation on that projection is the runtime contract: delegate, replicate, cache, CUD flags.

The plugin infers source service, projected columns, and bidirectional rename mappings from the projection alone. No separate mapping file.

### Pipeline, replication, materialization

**Pipeline** is the engine primitive in [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline): a linear `READ → MAP → WRITE` job between exactly one source and one target, with tracker, retry, concurrency guard, and event hooks. Federation and materialization bind annotated entities to pipelines; you can also register pipelines programmatically via `addPipeline({ source, target, … })`.

The engine derives each pipeline's **kind** from the config shape — you do not pass `kind` yourself:

| Derived kind | Shape | Typical use |
|---|---|---|
| `replicate` | Entity read → row-preserving UPSERT into `db` | `@federation.replicate`, or a standalone sync job |
| `materialize` | CQN query read → snapshot write into `db` | `@materialize.snapshot` on a `group by` projection |
| `move` | Entity read → write to a non-`db` target | Forwarding to a message bus, object store, or HTTP endpoint |

**Materialization** in `cds-data-materialization` is the annotation surface for query-shape snapshots — scheduled rollups and aggregates over data you already have locally (often after a `@federation.replicate` stage).

### How this maps to CAP's Service Integration guide

SAP lists **delegation** and **data federation** (replication) as sibling topics under integration logic. `cds-data` treats them as strategies within one `@federation.*` namespace because the modeling step is identical: declare a consumption view, pick how to access it.

Other CAP terms align directly:

- **Navigation** — path expressions along associations (`flight.origin.name`). Cross-service navigation is handled when the path crosses a local / remote boundary.
- **Expand** — `$expand` across service boundaries. The plugin resolves four topologies (same-provider, local → remote, remote → local, cross-provider). See [Cross-Service Scenarios](https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios).
- **Integration** — the umbrella SAP uses for remote services, events, and messaging. `cds-data` covers the data-access slice of that umbrella.

Both federation plugins follow the [**Calesi pattern**](https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern) — CAP-level Service Interfaces: remote OData/REST calls sit behind a CAP service interface, so consumption is agnostic (`cds.connect.to`), extensible (event handlers), and mockable in tests.

For the full taxonomy, naming rationale, and comparison with CAP's `@federated` sample annotation, see the [terminology page](https://mikezaschka.github.io/cds-data/federation/concepts/terminology) in the docs.

---

## The three packages

| Package | npm | Surface |
|---|---|---|
| [`cds-data-federation`](https://www.npmjs.com/package/cds-data-federation) | annotation plugin | `@federation.delegate` and `@federation.replicate` on consumption views over remote services. |
| [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline) | engine | Shared `READ → MAP → WRITE` engine. Adapters, retry, concurrency guard, tracker, management OData service. |
| [`cds-data-materialization`](https://www.npmjs.com/package/cds-data-materialization) | annotation plugin | `@materialize.snapshot` on `group by` projections. Scheduled local rollups for analytics. |

Federation and materialization are annotation layers that bind annotated entities to pipelines on the engine. The engine is independent — register a pipeline directly via `cds.connect.to('DataPipelineService').addPipeline({ source, target, … })` when neither annotation surface fits.

```
                ┌─────────────────────────────────────────────────────────┐
                │                Your CAP service                          │
                │                                                          │
                │   @federation.delegate / @federation.replicate           │
                │   @materialize.snapshot                                  │
                │                                                          │
                └─────────┬──────────────────────────────────┬─────────────┘
                          │                                  │
            ┌─────────────▼──────────────┐    ┌──────────────▼─────────────┐
            │   cds-data-federation      │    │  cds-data-materialization  │
            │   (annotation plugin)      │    │  (annotation plugin)       │
            └─────────────┬──────────────┘    └──────────────┬─────────────┘
                          │                                  │
                          └──────────────┬───────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  cds-data-pipeline  │
                              │  (engine — adapters,│
                              │   retry, tracker,   │
                              │   management OData) │
                              └──────────┬──────────┘
                                         │
            ┌────────────────────────────┴───────────────────────────────┐
            │                                                            │
   ┌────────▼──────────┐                              ┌──────────────────▼─────────┐
   │  Remote services  │                              │  Your local database       │
   │  S/4HANA Cloud,   │                              │  (HANA Cloud, SQLite,      │
   │  SuccessFactors,  │                              │   Postgres)                │
   │  Ariba, Concur,   │                              │                            │
   │  SAP Graph, MDI,  │                              │                            │
   │  xflights,        │                              │                            │
   │  any OData/REST   │                              │                            │
   └───────────────────┘                              └────────────────────────────┘
```

---

## Why a separate toolkit

Side-by-side extensions are the dominant CAP scenario on BTP: an extension app sits next to S/4HANA (or any SAP back-end), consumes a few OData APIs over destinations, persists its own data alongside, and exposes the combined model through a Fiori Elements UI. SAP's [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi), the [xtravels reference sample](https://github.com/capire/xtravels) (which consumes [xflights](https://github.com/capire/xflights)), the [Risk Management ext-service branch](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui), [Kai Niklas's CAP Remote Services walkthrough](https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/), and [Gregor Wolf's cap-replication-demo](https://github.com/gregorwolf/cap-replication-demo) all describe the same recipe at the handler level: one `on('READ', Entity, req => remote.run(req.query))` per delegated entity, a polling loop plus `UPSERT().into()` per replicated entity, and a scheduler-plus-retry layer per project.

`cds-data` exposes that recipe as two annotations on a consumption view. Using xflights as the federated source (the same provider xtravels consumes):

```cds
using { sap.capire.flights.data as flightsRemote } from './external/data-service';

service TravelService {

  // Live proxy. Reads forwarded to the xflights provider per request.
  @federation.delegate
  entity Airlines as projection on flightsRemote.Airlines {
      ID,
      name,
      icon,
      currency_code
  };

  // Scheduled sync every 10 minutes for SQL-side analytics on schedules + prices.
  @federation.replicate: { schedule: 600000 }
  entity ReplicatedFlights as projection on flightsRemote.Flights {
      ID,
      date,
      aircraft,
      price,
      currency_code,
      maximum_seats,
      occupied_seats,
      free_seats
  };

}
```

The plugin scans CSN at `cds.on('loaded')`, registers the delegate handler at `cds.once('served')`, and binds the replicate config to a pipeline on `cds-data-pipeline`. The engine contributes the tracker, retry, idempotent UPSERT, concurrency guard, and the management OData service mounted at `/pipeline`.

The xtravels sample shows the same pattern with hand-assembled handlers in [`srv/data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) — useful as a side-by-side reference for what `cds-data-federation` composes underneath.

---

## Mental model: the consumption view is the contract

One principle anchors the toolkit:

> The CDS projection declares the **schema** — what fields, what shape, what renames. The `@federation.*` annotation declares the **runtime behavior** — delegate vs. replicate, optional cache, opt-in CUD.

```cds
@federation.delegate
entity Airports as projection on flightsRemote.Airports {
    ID            as code,        // e.g. 'FRA'
    name          as fullName,
    city,
    country
};
```

From this single projection the scanner derives:

- **Source service / entity** — `sap.capire.flights.data.Airports`.
- **Projected columns** — the four fields above are the upper bound for `$select` on every remote call.
- **Bidirectional rename mapping** — `localToRemote` (e.g. `code → ID`, `fullName → name`) for outbound queries, `remoteToLocal` for inbound responses, derived from the `as` clauses.
- **Strategy** — `delegate` vs. `replicate`.

A client query `GET /travel/Airports?$filter=code eq 'FRA'&$select=code,fullName,city` translates to `$filter=ID eq 'FRA'&$select=ID,name,city` on xflights. The rename map also flows through `$orderby`, `$expand`, navigation filters, and CUD payloads.

---

## What each package contributes

### `cds-data-federation`

Two annotations on consumption views, plus an optional `cache` option:

```cds
// Live proxy.
@federation.delegate
entity Airlines as projection on flightsRemote.Airlines { ... };

// Live proxy + 30-second response cache.
@federation.delegate: { cache: { ttl: 30000 } }
entity HotAirlines as projection on flightsRemote.Airlines { ... };

// Live proxy + opt-in CUD (create, update, delete, or all via writable: true).
@federation.delegate: { update: true }
entity EditableAirlines as projection on flightsRemote.Airlines { ... };

// Scheduled delta sync into the local DB.
@federation.replicate: { schedule: 600000 }
entity ReplicatedFlights as projection on flightsRemote.Flights { ... };
```

Capabilities handled inside the delegate handler:

- `$filter` (comparison operators, logical operators, string functions, lambda operators `any()` / `all()`), `$orderby`, `$select`, `$top`, `$skip`, `$count`, `$search` — all with renames.
- Cross-service `$expand` in all four topologies (local → remote, remote → local, same-provider, cross-provider) — see [Cross-Service Scenarios](https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios).
- Cross-service navigation filters — e.g. `$filter=airline/name eq 'Lufthansa'` on a local entity with an association to a federated one.
- Static `where` clauses extracted from the projection and injected into every remote query.
- Read-only by default. CUD opt-in per operation (`writable`, `create`, `update`, `delete`). Disabled operations return HTTP 405.
- OData V2, OData V4, HCQL for delegate; same plus plain REST (offset / cursor / page pagination) for replicate.

Caching is orthogonal to the strategy:

- `cache.strategy: 'response'` (default) — TTL-keyed response cache via [`cds-caching`](https://github.com/mikezaschka/cds-caching).
- `cache.strategy: 'entity'` — full-entity SQLite snapshot refreshed on TTL miss, backed by the engine.

The next post in this series is dedicated to this package.

### `cds-data-pipeline`

The engine is a scheduled, traceable `READ → MAP → WRITE` primitive between exactly one source and one target. Use it directly when the source is not best modeled as a federated consumption view — moving data between two CAP services, scheduled REST ingestion into HANA Cloud, or a one-off backfill driven from an action handler.

```javascript
const pipelines = await cds.connect.to('DataPipelineService');

await pipelines.addPipeline({
    name: 'FlightSync',
    source: { service: 'flights', entity: 'sap.capire.flights.data.Flights' },
    target: { service: 'db',      entity: 'travel.ReplicatedFlights' },
    schedule: 600000
});
```

The engine derives the pipeline's `kind` (`replicate` / `materialize` / `move`) from the config shape — entity source plus `db` target gives `replicate`, query-shape source gives `materialize`, non-`db` target gives `move`. See the [inference rules](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference).

What the engine contributes:

- **Adapters** for OData V2, OData V4, HCQL, REST (pluggable pagination), CQN. `BaseAdapter` for custom sources.
- **Retry** via `withRetry()` — exponential backoff with jitter, skip-4xx default policy. Same primitive used by every remote call inside the engine and federation.
- **Idempotency** — `UPSERT.into(entity).entries(records)` for entity-shape pipelines; tracker-guarded `INSERT` for query-shape.
- **Concurrency guard** — optimistic `UPDATE` on the `plugin_data_pipeline_Pipelines` tracker entity. Overlapping runs return early.
- **Async-generator streaming** — large datasets stream record-by-record; the engine never holds the full dataset in memory.
- **Event hooks** — `before/on/after('PIPELINE.READ' | 'PIPELINE.MAP' | 'PIPELINE.WRITE', name, fn)` for per-phase transformations.
- **Management OData service** at `/pipeline` — `Pipelines`, `PipelineRuns`, and action endpoints for `run`, `flush`, `status`.

### `cds-data-materialization`

`@materialize.snapshot` runs a CQN query (typically a `group by` projection) on a schedule and persists the result set into a snapshot table. Conceptually a materialized view at the application layer, with the same observability primitives as the rest of the toolkit.

```cds
@materialize.snapshot: { schedule: 3600000, mode: 'full' }
entity FlightsByAirline as
  select from ReplicatedFlights {
      airline.ID          as airlineId,
      count(*)            as flightCount,
      avg(price)          as avgPrice,
      sum(occupied_seats) as totalSeats
  }
  group by airline.ID;
```

The plugin compiles the projection into a CQN `source.query`, derives `kind: 'materialize'`, and registers a pipeline on the engine. The result is a local table you can query, join, or expose like any other entity. Pairs naturally with `@federation.replicate`: stage remote data locally, then materialize rollups on top — see the [stage-then-aggregate](https://mikezaschka.github.io/cds-data/materialization/concepts/stage-then-aggregate) concept page.

---

## Where this sits in the landscape

`cds-data` is **application-layer** integration: the CAP service owns the integration contract. The space around it is active, with options at three different layers:

**Database layer.** [HANA synonyms](https://cap.cloud.sap/docs/advanced/hana#native-hana-features) (`.hdbsynonym`) alias a table or view in another HANA schema — common when an HDI container is paired with an S/4HANA CDS view schema. [HANA Smart Data Access](https://help.sap.com/docs/SAP_HANA_PLATFORM/6b94445c94ae495c83a19646e7c3fd56/6ce5a8dc7c0f44e28f12ff09db93b45c.html) provides virtual tables federating remote HANA, MSSQL, Oracle, Postgres into the HANA query engine. Pick these when the integration boundary lives in the database, the queries stay within HANA, and native joins and pushdown are the point.

**Platform layer.** [SAP Business Data Cloud](https://www.sap.com/products/data-cloud.html) (the umbrella covering [Datasphere](https://help.sap.com/docs/SAP_DATASPHERE), Databricks integration, Analytics Cloud, Joule agents). [SAP Cloud Integration](https://help.sap.com/docs/integration-suite) (iPaaS — pick when transformation, B2B/EDI, A2A messaging is the deliverable). [SAP Graph](https://help.sap.com/docs/SAP_GRAPH) (semantic federation API over the One Domain Model across S/4HANA, SuccessFactors, Ariba, Concur). [SAP Master Data Integration](https://help.sap.com/docs/SAP_MASTER_DATA_INTEGRATION) (master-data distribution across SAP cloud apps, ODM-aligned with Graph). [SAP Event Mesh](https://help.sap.com/docs/SAP_EM) (CloudEvents transport — complementary to both delegate and replicate). Generic CDC / ETL — [Debezium](https://debezium.io/), [Airflow](https://airflow.apache.org/), [dbt](https://www.getdbt.com/) — pick when heterogeneous pipelines across many consumers are the deliverable.

**Application layer.** The CAP reference samples listed above, [`cds-caching`](https://github.com/mikezaschka/cds-caching) for response-level caching, and [`@cap-js-community/common`](https://github.com/cap-js-community/common) for the Replication Cache pattern — sit at the same layer as `cds-data`. Pick the toolkit when the integration contract belongs in your CAP app (renames, cross-service `$expand`, opt-in CUD, scheduled sync with tracker observability); the [comparison matrix](https://mikezaschka.github.io/cds-data/federation/reference/comparison) lists every alternative row-by-row.

The choice across layers is rarely binary. A common deployment pattern combines them: an SAP Graph endpoint as the federated `@federation.delegate` source, [Event Mesh](https://help.sap.com/docs/SAP_EM) as the transport for change-driven refresh on top of `@federation.replicate`, and HANA Cloud as the local DB with HANA-native indices for the analytics view.

---

## Getting hands-on

Two runnable demos live under [`examples/`](https://github.com/mikezaschka/cds-data/tree/main/examples) in the repository. Each boots in a single command and aggregates four CAP / REST servers behind a Fiori launchpad:

- **[Sales Intelligence Workbench](https://github.com/mikezaschka/cds-data/tree/main/examples/sales-intel)** — Northwind V4 + V2 fused with a local CAP provider and a REST provider. Headline demo for the federation + pipeline monitor:
  ```bash
  git clone https://github.com/mikezaschka/cds-data.git
  cd cds-data && npm install
  bash examples/sales-intel/start-all.sh
  # → http://localhost:4005/launchpage.html
  ```
- **[Movies & Streaming](https://github.com/mikezaschka/cds-data/tree/main/examples/consumer)** — delegate, response cache, replicate, REST-sourced analytics:
  ```bash
  npm run examples:start
  # → http://localhost:4004/launchpage.html
  ```

Every tile maps to one of the patterns documented under [getting-started](https://mikezaschka.github.io/cds-data/federation/getting-started/) and exercised by the Jest suites under `packages/*/test/`.

---

## What's next

The follow-up post goes deep on `cds-data-federation`: a strategy-by-strategy comparison against [HANA SDA](https://help.sap.com/docs/SAP_HANA_PLATFORM/6b94445c94ae495c83a19646e7c3fd56/6ce5a8dc7c0f44e28f12ff09db93b45c.html), [Datasphere Replication Flow](https://help.sap.com/docs/SAP_DATASPHERE), [SAP Graph](https://help.sap.com/docs/SAP_GRAPH), the [xtravels reference sample](https://github.com/capire/xtravels), the [Risk Management ext-service branch](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui), [`@cap-js-community/common`](https://github.com/cap-js-community/common), and [`cds-caching`](https://github.com/mikezaschka/cds-caching) — plus a worked travel-extension demo on top of [xflights](https://github.com/capire/xflights). The setup is shown twice: once as a hands-on walkthrough, once as a single agent prompt that produces the same project end-to-end.

→ **[Part 2: cds-data-federation in depth](./02-cds-data-federation-deep-dive.md)**

---

## Links

| Resource | URL |
|---|---|
| Documentation portal | https://mikezaschka.github.io/cds-data/ |
| Federation guide | https://mikezaschka.github.io/cds-data/federation/ |
| Pipeline guide | https://mikezaschka.github.io/cds-data/pipeline/ |
| Materialization guide | https://mikezaschka.github.io/cds-data/materialization/ |
| Federation comparison matrix | https://mikezaschka.github.io/cds-data/federation/reference/comparison |
| Terminology page | https://mikezaschka.github.io/cds-data/federation/concepts/terminology |
| Inference rules | https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference |
| `cds-data-federation` on npm | https://www.npmjs.com/package/cds-data-federation |
| `cds-data-pipeline` on npm | https://www.npmjs.com/package/cds-data-pipeline |
| `cds-data-materialization` on npm | https://www.npmjs.com/package/cds-data-materialization |
| Source repo (monorepo) | https://github.com/mikezaschka/cds-data |
| CAP Service Integration guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation guide | https://cap.cloud.sap/docs/guides/integration/data-federation |
| The Calesi Pattern | https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern |
| `@capire/xflights` (provider sample) | https://github.com/capire/xflights |
| `@capire/xtravels` (consumer sample) | https://github.com/capire/xtravels |
