# Terminology: Federation, Delegation, Replication & Caching

::: tip Shared glossary
The base vocabulary (pipeline, source/target, mode, delta, federation, delegation, replication, consumption view, caching) is defined once in the [shared Terminology](/concepts/terminology). This page adds the **federation-specific** depth: the industry and CAP alignment, the Calesi pattern, and the naming rationale.
:::

This document defines the key terms used by `cds-data-pipeline` and `cds-data-federation`, explains how they relate to SAP CAP's official definitions and to the broader industry, and provides the rationale for our naming choices.

---

## What "federation" means in this plugin

**Federation means: integrating remote service models into the consumer's data model and providing strategies for how that remote data is accessed at runtime.**

The developer declares two things:

1. **What** to federate — a CDS consumption view (`entity X as projection on remote.Y`) that defines the schema contract: which remote fields, what shape, what renames.
2. **How** to access it — a `@federation.*` annotation that selects the runtime strategy: delegate (live), replicate (scheduled sync), optionally with caching.

From the developer's perspective, the intent is always the same: "I need this remote entity's data available in my application." Whether that data is fetched live or replicated locally is a runtime concern, not a modeling concern.

### Pipeline, replication, materialization, movement — four distinct ideas

The engine package ([`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline)) talks about **pipelines**, not replications; replication is one specific *shape* of pipeline. The engine **derives** each pipeline's `kind` from the configuration shape — consumers do not pass `kind` to `addPipeline`. The four terms are deliberately narrow:

| Term | Meaning | Status |
|---|---|---|
| **Pipeline** | A linear `READ → MAP → WRITE` job between exactly one source and one target, with built-in tracker, retry, concurrency guard, and event hooks. This is what `cds-data-pipeline` provides. Every pipeline carries a *derived* `kind`, inferred at registration time. | Engine primitive. |
| **Replication** (derived `kind: 'replicate'`) | Entity-shape read + row-preserving UPSERT: `source.entity` (or `rest.path` for REST) to a db target. One source row produces one target row on the key. | Implemented in v1.0. |
| **Materialization** (derived `kind: 'materialize'`) | Query-shape read + snapshot write: target is rebuilt from a user-supplied CQN `source.query` (projections, joins, `GROUP BY`, computed columns). Writes are `full` or `partial-refresh`. | Planned in v1.0 (validation-only). |
| **Movement** (derived `kind: 'move'`) | Entity-shape read forwarded to a non-database target (message bus, object store, external HTTP endpoint) — `target.service` is anything other than `'db'`. | Planned in v1.0 (validation-only). |

See the engine site's [inference rules](/pipeline/guide/concepts/inference) page for the full derivation table and registration-time validation matrix.

### Federation, pipelines, and replication sit at different layers

**Federation** is the declarative, remote-service integration layer: consumption views, `@federation.*` annotations, cross-service `$expand` and navigation, CUD forwarding. **The pipeline engine** is the underlying scheduled job runtime — source adapters, delta tracking, retry, the `Pipelines` / `PipelineRuns` tracker, and the management service.

The federation plugin (`cds-data-federation`) composes the pipeline engine (`cds-data-pipeline`) to implement `@federation.replicate` — each annotated entity becomes one entity-shape `addPipeline({ ... })` call via `packages/cds-data-federation/srv/pipeline-binding.js`, and the engine derives `kind: 'replicate'` from the config. The engine does not depend on federation and can be used standalone — either programmatically via `cds.connect.to('DataPipelineService').addPipeline({ ... })` or from any other plugin layered on top of it.

---

## Industry context

The broader data industry defines data federation as follows:

> "Data Federation is a data management technique that **makes multiple data sources appear as a single one**."
> — Denodo (data virtualization vendor)

> "Data federation creates a **virtual, unified view of disparate data sources** without moving data. Instead of copying data into a centralized repository, the federation layer sits on top of your existing systems and queries them directly."
> — Fivetran

Key characteristics of data federation in the industry:

- **Unified access** — multiple heterogeneous sources queried through a single interface
- **Transparency** — the consumer does not need to know where data physically resides
- **Strategy-agnostic** — implementations range from live virtual queries to materialized views to full replication; the term covers all of them
- **Middleware-driven** — a federation layer handles query translation, schema mapping, and result assembly

Our plugin follows this definition: the CDS consumption view is the unified interface, the plugin is the middleware layer, and delegate/replicate are the implementation strategies.

---

## 'Calesi' — CAP-level Service Interfaces

> 'Calesi' stands for CAP-level Service Interfaces, and refers to the
> increasing numbers of BTP platform services which offer a CAP-level
> client library. — [Core Concepts › The Calesi Pattern][calesi]

> Essentially, the 'Calesi' pattern is about encapsulating any external
> communication within a CAP-service-based interface, so that the actual
> consumption and/or implementation benefits from the related advantages,
> such as agnostic consumption, intrinsic extensibility, automatic mocking,
> and so on. — [Core Concepts › The Calesi Pattern][calesi]

[calesi]: https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern

SAP provides first-party Calesi plugins for platform services (Attachments,
Audit Log, Notifications, Telemetry, ...). The [CAP-Level Service
Integration guide][integration-calesi] applies the same pattern to **remote
data services** — the problem space this plugin targets.

**`cds-data-federation` is a Calesi plugin for remote data services.**
It encapsulates outbound OData/REST calls behind a CAP service interface,
exposes two strategies (`@federation.delegate` and `@federation.replicate`),
and benefits from the pattern's guarantees: agnostic consumption
(`cds.connect.to`), intrinsic extensibility (before/on/after event
handlers), and automatic mocking (CAP mocks the remote out of the box).

[integration-calesi]: https://cap.cloud.sap/docs/guides/integration/calesi

---

## CAP's definitions (Service Integration guide)

SAP's [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) applies the Calesi pattern to remote data services and defines these terms as **peer concepts** under the umbrella of "Integration Logic":

### Integration

The top-level umbrella. The Service Integration guide covers the full lifecycle of working with remote services: importing APIs, creating consumption views, writing integration logic, events, and messaging.

### Data Federation

CAP has a dedicated guide: [CAP-level Data Federation](https://cap.cloud.sap/docs/guides/integration/data-federation). The meaning is specific:

> "Relying on live calls to remote services per row is clearly not an option. Instead, we'd rather ensure that data required in close access is really available locally, so it can be joined with own data using SQL JOINs. **This is what data federation is all about.**"

CAP's `@federated` annotation marks entities for **local replication** so their data is "in close access." The implementation pattern: `@cds.persistence.table` + UPSERT-based replication.

### Delegation

> "Even with data federation in place, there are still several scenarios where we need to reach out to remote services on demand. Value helps are a prime example."

Implementation: `this.on('READ', Customers, req => s4.run(req.query))` — forwarding a query live to a remote service. CAP emphasizes "Automatic Query Translation" as the key capability: field names are translated through the CDS projection chain.

### Navigation

> "The term 'navigation' commonly refers to **traversing associations between entities** in queries. In CAP, this is typically expressed using **path expressions along (chains of) associations** — e.g., `flight.origin.name` — which can show up in all query clauses (select, from, where, order by, and group by)."

When navigation paths cross service boundaries, queries must be split manually.

### Expands

`$expand` across service boundaries. See [Cross-Service Scenarios](./cross-service-scenarios.md) for the canonical reference. Four topologies:
- **Delegated expand** (formerly Scenario A): both entities on the same remote — CAP handles natively
- **Cross-service expand: local → remote** (formerly Scenario B): local entity expands to remote — plugin adds batch-fetch + stitch
- **Cross-service expand: remote → local** (formerly Scenario C): remote entity expands to local — plugin adds reverse fetch against local DB
- **Cross-service expand: cross-provider**: local entity expands to targets on *different* remote providers — plugin issues one batch-fetch per provider

In all four cases the remote side is `@federation.delegate`. `@federation.replicate` entities participate only as the local side — after replication they are ordinary local tables, indistinguishable from plain local entities at query time. There are no `@federation.replicate`-only scenarios.

### Caching

CAP has **no native caching** for remote service responses or replicated data. No TTL, no LRU, no cache invalidation. Every remote call hits the network unless you add caching yourself.

---

## How our terms map to CAP's terms

| Term | CAP (Service Integration guide) definition | Our plugin's definition | Alignment |
|---|---|---|---|
| **Integration** | Umbrella for all remote service work (APIs, events, messaging) | Not used as primary term; plugin sits under integration | No conflict |
| **Federation** | Narrow: replication for local "close access" (SQL joins) | Broad: integrating remote models + all access strategies | Intentionally broader |
| **Delegation** | Live forwarding: `req => remote.run(req.query)` | `@federation.delegate` — same behavior | Aligned |
| **Navigation** | Path expressions traversing associations in queries | `translateNavigationFilters()` — same concept | Aligned |
| **Replication** | Mechanism: copy remote data to local DB via UPSERT | `@federation.replicate` — same mechanism | Aligned |
| **Expand** | `$expand` across service boundaries | See [Cross-Service Scenarios](./cross-service-scenarios.md) — delegated expand uses `@federation.delegate` on both sides; cross-service expand (local → remote / remote → local / cross-provider) uses `@federation.delegate` on the remote side with any local entity (including `@federation.replicate`) on the other | Aligned |
| **Caching** | No CAP-native concept exists | Cross-cutting option: `cache.strategy: 'response'` via `cds-caching`, or `cache.strategy: 'entity'` (SQLite + pipeline) | No conflict |

### Annotation: `@federated` (CAP sample) vs `@federation.*` (this plugin)

CAP's [Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation) and the [xtravels sample](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) introduce a `@federated` annotation (no dot, no strategy) used purely as a marker. A ~20-line `data-federation.js` in the sample walks the CSN, marks `@federated` entities as persistence tables, and implements a naive `modifiedAt`-based polling replication:

```cds
@federated entity Customers as projection on S4.A_BusinessPartner { ... };
```

This is conceptually similar to — but intentionally much smaller than — our `@federation.*` namespace.

| Aspect | CAP `@federated` (sample) | `@federation.*` (this plugin) |
|---|---|---|
| Namespace | Top-level annotation (adjective) | Dotted namespace (`delegate` / `replicate` as strategy suffixes) |
| Ownership | CAP sample code (not a runtime built-in) | This plugin |
| Strategy | Implicit: replication only | Explicit: `delegate` or `replicate` at the annotation site |
| Options | None | `cache`, `writable` / `create` / `update` / `delete`, `schedule`, `mode`, `batchSize`, `source` |
| Delta modes | `modifiedAt`-only polling | `timestamp` / `key` / `datetime-fields` via adapter |
| Adapters | OData / HCQL (CAP-native) | OData v2/v4, REST (with pagination + delta URL param), pluggable BaseAdapter |
| Resilience | None | `withRetry()` with exponential backoff + skip-4xx, concurrency guard via optimistic UPDATE |
| Hooks | None | `before/on/after('PIPELINE.READ'|'MAP'|'WRITE', name, fn)` — composable pipeline |
| Observability | None | `Pipelines`, `PipelineRuns` entities + management OData service |
| View mapping | Verbatim replication | Scanner extracts `localToRemote`/`remoteToLocal`; MAP phase renames fields |
| Delegation | Not covered | `@federation.delegate` with cross-service `$expand` (see [Cross-Service Scenarios](./cross-service-scenarios.md)), cross-service navigation, static where, CUD forwarding |

There is **no technical collision**: `@federated` and `@federation.delegate` / `@federation.replicate` are distinct identifiers in distinct namespaces. Annotation names stay compatible if a project uses both (e.g. during migration). If CAP promotes `@federated` from sample code to a runtime built-in, we will reassess alignment at that point — possibly by recognising `@federated` on a consumption view as a synonym for `@federation.replicate` with defaults.

---

## Why "federation" as umbrella (not "integration")

We considered two naming options:

### Option A: `cds-data-federation` with `@federation.*` (chosen)

- Follows the **industry convention** where "data federation" = unified access across heterogeneous sources, regardless of strategy
- CAP's own `@federated` annotation is close in spirit — the xtravels sample treats it as "this data should be transparently available regardless of where it lives"
- `@federation.delegate` and `@federation.replicate` read naturally: "this entity participates in data federation, using strategy X"
- The namespace `@federation.*` is cleanly separated from CAP's `@federated` (namespace vs. adjective)
- The package name `cds-data-federation` communicates scope clearly

### Option B: `cds-data-integration` with `@integration.*` (rejected)

- Would align with CAP's top-level umbrella term
- But "integration" is too broad — it covers events, messaging, outbox, etc.
- The plugin focuses specifically on **data access patterns** (read delegation + replication), not the full integration spectrum
- Risk of colliding with future CAP-owned `@integration.*` annotations

### The intentional divergence

In the Service Integration guide, "Data Federation" and "Delegation" are **sibling sections** under "Integration Logic." Our plugin makes delegation a **strategy within** federation. This is intentional:

- From the developer's perspective, the decision is: "I have a remote entity in my model. How should I access its data?" The answer is `@federation.delegate` or `@federation.replicate`.
- Separating them into different annotation namespaces would force the developer to think about conceptual categories instead of practical choices.
- The consumption view is the constant; the strategy is the variable.

---

## Annotation design

```
@federation.delegate                              — live proxy (industry "federation")
@federation.delegate: { cache: { ttl: 60000 } }  — live proxy + response caching
@federation.replicate                             — scheduled sync (CAP "data federation")
@federation.replicate: { schedule: '*/10 * * * *', cache: { ttl: 300000 } }
```

Design principles:

- **Strategy is the annotation name**, not an option — `@federation.delegate` vs `@federation.replicate`. Easy to scan visually in CDS models.
- **Caching is an option**, not a strategy — it can be applied to either strategy. Caching is orthogonal to how data is accessed.
- **No `@cds.federated`** — that namespace belongs to SAP. We use `@federation.*` to stay in our own namespace.

---

## Summary for presentation

**One-liner:** Federation = integrating remote models into your data model + choosing how to access them.

**Three-part model:**

| | What | How | Annotation |
|---|---|---|---|
| **Schema** | Consumption view defines fields, shape, renames | CDS projection: `entity X as projection on remote.Y { ... }` | (modeling, no annotation needed) |
| **Strategy** | Live proxy or local sync | `delegate` = forward query; `replicate` = scheduled UPSERT | `@federation.delegate` / `@federation.replicate` |
| **Caching** | Optional read accelerator | **`response`**: TTL cache keyed by query signature (`cds-caching`). **`entity`**: full-entity SQLite snapshot refreshed on TTL miss (`cds-data-pipeline`). Orthogonal to delegate vs replicate. | `{ cache: { ttl, strategy } }` |

**Relationship to CAP terminology:**

```
CAP "Integration" (umbrella)
 ├── Data Federation (replication for close access)  ─┐
 ├── Delegation (live forwarding)                     ├── Our @federation.* (unified)
 ├── Navigation (association path traversal)          │   delegate = CAP delegation
 ├── Expands ($expand across services)                │   replicate = CAP data federation
 └── Outboxed Emits (async events)                   ─┘
```

**Why this naming works:**
1. Matches the industry definition of data federation (Denodo, Fivetran, Oracle)
2. Developer-centric: one annotation namespace, strategy as the only choice
3. Internal terms (delegate, replicate, navigation, expand) all align with CAP
4. Clean separation from CAP's `@federated` and `@cds.*` namespaces

---

## References

| Resource | URL |
|---|---|
| Service Integration guide (CAP-Level Service Integration) | https://cap.cloud.sap/docs/guides/integration/calesi |
| The Calesi Pattern (CAP-level Service Interfaces) | https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern |
| CAP-level Data Federation | https://cap.cloud.sap/docs/guides/integration/data-federation |
| Denodo: Data Federation Definition | https://www.denodo.com/en/glossary/data-federation-definition-importance-best-practices |
| Fivetran: What is Data Federation? | https://www.fivetran.com/learn/data-federation |
| xtravels sample (data-federation.js) | https://github.com/capire/xtravels/blob/main/srv/data-federation.js |
