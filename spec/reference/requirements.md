# cds-data-pipeline + cds-data-federation: Requirements & Technical Design

> **Amended 2026-04-19 by [ADR 0005](../internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md) and [ADR 0007](../internal/decisions/0007-infer-pipeline-intent-from-config-shape.md); 2026-05-22 by [ADR 0009](../internal/decisions/0009-cds-data-materialization-plugin.md).** The engine package is named **`cds-data-pipeline`** (was `cds-data-replication` in [ADR 0003](../internal/decisions/0003-split-plugin-into-replication-and-federation.md)). Pipeline intent (`replicate` / `materialize` / `move`) is **derived** from the config shape — consumers do not pass `kind` to `addPipeline`. Entity-shape pipelines and query-shape pipelines (CQN adapter [4.6.3](#463-cqn-adapter----single-adapter-serving-both-read-shapes-entity-shape-reads-row-preserving-copy-from-cqn-native-cdsrequires-services--secondary-db-cap-wrapped-legacy-db-and-query-shape-reads-derivedaggregated-snapshot-built-from-a-user-supplied-sourcequery-closure-read-shape-is-inferred-from-the-config-see-adr-0007-infer-pipeline-intent-from-config-shape-transport-is-routed-via-sourcekind-cqn-on-the-adapter-factory-see-adr-0004-scope-cqn-adapter-to-cds-data-replication-adr-0005-reposition-engine-as-cds-data-pipeline-and-docspipelineintegrationcqnmd)) are **Implemented** on the engine; `move` to non-`db` targets remains largely **Planned** (§4.17). The annotation plugin **`cds-data-materialization`** (§4.18) adds `@materialize.snapshot` on top of the engine. Where this document says `Replicate Strategy`, read *entity-shape pipeline*. Where it says `Materialize Strategy`, read *query-shape pipeline* or the annotation plugin as scoped in each row.

## Context

This project started as an initial prototype of a SAP CAP plugin for data replication (`cds-data-replication`, v0.1.0). The goal is to evolve this into the **`cds-data-pipeline` + `cds-data-federation`** pair — a scheduled pipeline engine plus a declarative annotation plugin for remote data integration, spanning live delegation through full replication. This fills the gap that CAP's own documentation identifies between federation (live queries) and local data availability.

The plugin composes with the author's existing [`cds-caching`](https://github.com/mikezaschka/cds-caching) plugin for optional response caching on any strategy.

---

## 1. Vision & Principles

### 1.1 Vision

A unified, declarative CAP plugin for remote data federation -- making it as easy as adding `@federation.delegate` or `@federation.replicate` to an entity to get transparent delegation or full replication, with optional caching on either.

### 1.2 Federation Strategies

| Strategy | Annotation | Behavior | Use Case |
|---|---|---|---|
| **`delegate`** | `@federation.delegate` | Transparent live proxy to remote service. Auto-handles `$expand`, `$filter`, `$orderby`, `$select` without manual coding. | Real-time data, low volume, simple queries |
| **`replicate`** | `@federation.replicate: { schedule: '*/10 * * * *' }` | Copy to local DB on schedule. Full SQL capabilities, offline access, AI/vector search. | Dashboards, analytics, cross-system joins, offline |

### 1.3 Caching (Cross-Cutting Capability)

Caching is **not a strategy** — it covers **response caching** (`cds-caching`) and optionally **entity-level caching** (`cache.strategy: 'entity'`, SQLite + `cds-data-pipeline`):

| Applied to | Annotation | What gets cached |
|---|---|---|
| **`delegate`** | `@federation.delegate: { cache: { ttl: 60000 } }` (`strategy: 'response'` default) | The remote OData response for identical query signatures. |
| **`delegate`** | `@federation.delegate: { cache: { strategy: 'entity', ttl: 600000 } }` | A full-remote-entity SQLite snapshot keyed by `{ tenantId, projected columns }`; any read query variant hits SQLite until TTL. |
| **`replicate`** | `@federation.replicate: { cache: { ttl: 300000 } }` | The local DB query result. Avoids repeated SQL queries against replicated data. |

**Scope:** Neither cache covers merged cross-entity/`$expand` results at the mashup stitch layer (`$expand`/Scenario B stitched responses). When caching applies, each federated READ path resolves independently (`cds-caching` per handler or entity-cache SQLite per delegated entity).

**Dependency:** `cds-caching` is optional for `strategy: 'response'`. **`strategy: 'entity'`** requires `cds-data-pipeline`, `@cap-js/sqlite`, and a configured secondary SQLite service (default entry `cds.requires.FederationEntityCache`).

### 1.4 Design Principles

| Principle | Description |
|---|---|
| **CDS-native** | Follows CAP conventions: annotations, `cds.env` config, lifecycle hooks, CQL/CQN queries. Feels like a natural part of CAP, not bolted on. |
| **Declarative first, programmatic second** | Simple cases solved with `@federation.delegate` / `@federation.replicate` annotations; complex cases with programmatic API and event hooks. |
| **Composable** | Leverages **`cds-caching`** for optional per-query response caching (`cache.strategy: 'response'`, default) and **`cds-data-pipeline`** with a secondary SQLite service for **`cache.strategy: 'entity'`**. Caching is orthogonal to delegation vs replicate. |
| **Protocol-agnostic** | Source adapters abstract OData v2/v4, REST, RFC, and CQN behind a uniform interface. |
| **Streaming & memory-safe** | Async generator-based batch streaming for replication. Never load full datasets into memory. |
| **Idempotent & resilient** | UPSERT semantics, checkpoint-based resume, retry with backoff. Safe to re-run at any point. |
| **Observable** | Built-in tracking (runs, statistics, errors) with a management API. First-class logging via `cds.log`. |
| **Extensible** | Event hooks (before/on/after for READ, MAP, WRITE), custom adapters, custom delta strategies. |
| **Read-only by default** | Federated entities are read-only unless explicitly opted in via `writable` / `create` / `update` / `delete` annotation flags. Matches SAP's [xtravels](https://github.com/capire/xtravels) reference app where remote entities are `@readonly` value helps. Write capability is an explicit, auditable decision. |

### 1.5 Relation to CAP Built-ins

CAP's [Services & Platform Integration](https://cap.cloud.sap/docs/guides/integration/) guides document the native building blocks this plugin composes and the manual patterns it automates. Three guides are directly relevant:

| CAP Guide | Relationship to this plugin |
|---|---|
| [Reuse & Compose — Service Integration](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#service-integration) | Documents the "embed vs. integrate" decision for reused packages. When an imported service (e.g. `@capire/reviews`) is configured in `cds.requires` with `kind: odata, model: '@capire/reviews'`, it runs as a separate microservice — **this is the precondition our plugin operates on**. The guide's `CatalogService.prepend('READ', 'Books/reviews', ...)` example is exactly what the plugin's [cross-service expand: local → remote](../concepts/cross-service-scenarios.md#cross-service-expand-local--remote) and [cross-service navigation](../concepts/cross-service-scenarios.md#cross-service-navigation-local--remote) resolve automatically for any consumption view. |
| [CAP-level Data Federation](https://cap.cloud.sap/docs/guides/integration/data-federation) | Introduces the sample-level `@federated` annotation and ships a ~20-line reference [`data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) (polling-based delta using `modifiedAt`). This is the **MVP** of what `@federation.replicate` does. Our plugin supersedes it with: multiple delta modes (timestamp/key/datetime-fields), REST adapter with pagination, concurrency guard, retry with exponential backoff, pipeline events (`PIPELINE.READ/MAP/WRITE`) + user hooks, management API (`Pipelines`, `PipelineRuns`), view-mapping-aware MAP phase, status tracking, and per-run statistics. |
| [Inner-Loop Development](https://cap.cloud.sap/docs/guides/integration/inner-loops) | Orthogonal. `cds mock`, `cds watch` auto-bindings via `~/.cds-services.json`, `cds repl`, npm workspaces, and proxy packages all work alongside the plugin unchanged. Application developers can mock remote services during development and the plugin transparently switches between mocked and real remote services based on the active `cds.requires` bindings. |

**Annotation naming:** The CAP sample uses `@federated` (no dot, no strategy). We use `@federation.delegate` / `@federation.replicate` — separate identifiers in different namespaces, so there is no technical collision. The dotted form makes the strategy choice explicit at the annotation site and leaves room for additional options (`cache`, `writable`, `schedule`, `mode`). If CAP promotes `@federated` from a sample pattern to a built-in in a future release, we will reassess alignment at that point.

**Scope constraint:** `@federation.*` annotations apply only to **consumption views** — CDS projections of the form `entity X as projection on remote.Y`. The projection is the federation contract (what data, what shape, what renames). Annotating an imported entity directly (`annotate ReviewsService.Reviews with @federation.delegate`) is not supported because the annotation scanner resolves the source via the projection chain. Use `options.source` only as the escape hatch for REST services that lack a CDS model.

---

## 2. Key Use Cases

### When to use `delegate`
| Use Case | Why |
|---|---|
| **Live master data lookups** | Always need the latest value (e.g., currency rates, user profiles) |
| **Low-volume reads** | Not worth replicating; direct call is fast enough |
| **Write-back scenarios** | Need to pass through mutations to the remote service |
| **Remote authorization required** | The remote system must evaluate its own user permissions (e.g., S/4HANA authority checks). Delegation forwards the user context; replication bypasses it. |

### When to add `cache` to delegate
| Use Case | Why |
|---|---|
| **Rate-limited APIs** | Source has quotas; caching reduces call frequency |
| **Repeated reads of same data** | Multiple users/requests hitting the same remote entity |
| **Acceptable staleness** | Data doesn't change frequently; TTL-based freshness is fine |

### When to use `replicate`
| Use Case | Why |
|---|---|
| **Dashboard / analytics** | Complex aggregations, joins, sorting require full SQL -- not possible via remote OData |
| **Offline / resilience** | Application must serve data when source is down |
| **AI / vector search** | Extend replicated data with HANA vector embeddings for semantic search |
| **Cross-system joins** | Join remote entities with local data in a single SQL query |
| **Multi-source consolidation** | Merge same entity type from multiple S/4 systems into one table |
| **Data enrichment** | Add computed fields, classifications, or ML predictions |
| **Lift extension limits** | Remote entities can only be extended with virtual elements, calculated fields, and unmanaged associations ([Service Integration docs](https://cap.cloud.sap/docs/guides/integration/calesi)). Replicating removes these constraints -- the local table supports full schema extensions. |

### Strategy trade-offs: Delegate vs. Replicate

Based on the [old "Consuming Services" guide](https://cap.cloud.sap/docs/guides/services/consuming-services#transient-access-vs-replication) and practical experience:

| Feature | Delegate (Transient) | Replicate (Local Copy) |
|---|---|---|
| **Filter on local OR remote fields** | Yes | Yes |
| **Filter on local AND remote fields (same request)** | **No** -- requires cross-service query splitting | Yes -- both are local SQL |
| **SQL JOINs with local entities** | **No** -- different data sources | Yes -- same database |
| **Flatten associations** | **No** -- OData protocol limitation | Yes -- local SQL can denormalize |
| **User permissions from remote system** | **Yes** -- request carries user context to remote | **No** -- replicated data bypasses remote auth. Security-sensitive data may need additional local authorization rules or row-level filtering to compensate. |
| **Data freshness** | Live (always current) | Stale (until next sync) |
| **Performance** | Network-dependent (latency per request) | Local SQL (fast) |
| **Offline availability** | **No** -- depends on remote uptime | **Yes** -- serves from local DB |
| **Aggregation / $apply** | **No** -- CAP rejects `.groupBy` for OData remotes | Yes -- full SQL capabilities |
| **AI / Vector search** | **No** -- remote OData has no vector support | Yes -- extend with HANA embeddings |

---

## 3. Core Concept: Consumption Views

The **consumption view** (a CDS projection on a remote entity) is the central building block of federation. It serves as both the schema contract and the federation configuration:

```cds
@federation.delegate
entity Customers as projection on remote.A_BusinessPartner {
    BusinessPartner as ID,              // rename: remote field → local name
    BusinessPartnerFullName as name,    // rename
    City,                               // keep as-is
    Country                             // keep as-is
    // 46 other remote fields: implicitly excluded
};
```

From this single CDS definition, the plugin infers everything:

| What | Inferred from |
|---|---|
| Source service | `remote` (from `projection on remote.A_BusinessPartner`) |
| Source entity | `A_BusinessPartner` |
| Fields to fetch | `BusinessPartner, BusinessPartnerFullName, City, Country` (only projected columns) |
| Field mapping | `BusinessPartner → ID`, `BusinessPartnerFullName → name` (from `as` renames) |
| Strategy | From annotation: `@federation.delegate` or `@federation.replicate` |

**The principle:** The consumption view defines *what* data and *what shape*. The `@federation.*` annotation defines *how* to get it (strategy, schedule, cache TTL). This aligns with CAP's "what, not how" philosophy ([Service Integration guide: Consumption Views](https://cap.cloud.sap/docs/guides/integration/calesi)).

**For delegate:** CAP's runtime automatically translates queries through the CDS projection chain when `remote.run(req.query)` is called — including column renames, column restriction, $filter, $orderby, $expand, and result mapping. No manual query rewriting is needed in the plugin. See [Service Integration guide: Automatic Query Translation](https://cap.cloud.sap/docs/guides/integration/calesi#delegation).

**For replicate:** The plugin fetches only the projected source fields during READ, applies the rename mapping during MAP, and writes the renamed fields during WRITE. No separate "declarative field mapping" configuration is needed — the projection IS the mapping.

**How it works at runtime (delegate):**
- `$select=ID,name` on the local view → CAP translates to `$select=BusinessPartner,BusinessPartnerFullName` on the remote
- `$filter=name eq 'Acme'` → CAP translates to `$filter=BusinessPartnerFullName eq 'Acme'`
- `$orderby=name` → CAP translates to `$orderby=BusinessPartnerFullName`
- Results are automatically mapped back: `BusinessPartner` → `ID`, `BusinessPartnerFullName` → `name`
- Replication only stores the 4 projected fields, not all 50+ from the remote

---

## 4. Feature Requirements

**Maintenance rule:** When a requirement moves to "Implemented", also update [README.md](https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-federation/README.md) to reflect the new user-visible capability (annotation option, feature matrix entry, protocol support, or example). The README is the glanceable user-facing summary; this document remains the full spec.

**Priority levels:**

| Priority | Meaning | Guideline |
|---|---|---|
| **P0** | Must-have | Core functionality. The plugin is incomplete without it. Required for the current phase. |
| **P1** | Should-have | Important for real-world use. Planned for the next 1-2 phases. |
| **P2** | Nice-to-have | Useful but not blocking. Future phases or opportunistic. |

**Status values:** `Implemented` | `In progress` | `Not started` | `Not supported (reason)` | `Removed (reason)`

### Progress Summary

| Section | Total | Done | In Progress | Not Started | N/A |
|---|---|---|---|---|---|
| 4.1 Consumption Views | 7 | 6 | 0 | 0 | 1 |
| 4.2 Delegate Strategy | 13 | 11 | 0 | 1 | 1 |
| 4.3 Caching | 8 | 7 | 0 | 1 | 0 |
| 4.4 Replicate Strategy | 7 | 4 | 0 | 3 | 0 |
| 4.5 Annotation Config | 5 | 4 | 0 | 1 | 0 |
| 4.6 Source Adapters | 7 | 6 | 0 | 1 | 0 |
| 4.7 Data Transformation | 4 | 4 | 0 | 0 | 0 |
| 4.8 Scheduling & Triggers | 6 | 2 | 0 | 4 | 0 |
| 4.9 CQL Safety | 1 | 1 | 0 | 0 | 0 |
| 4.10 Resilience | 11 | 3 | 1 | 7 | 0 |
| 4.11 Observability | 8 | 5 | 1 | 2 | 0 |
| 4.12 Security | 3 | 1 | 0 | 2 | 0 |
| 4.13 Management API | 5 | 4 | 0 | 1 | 0 |
| 4.14 Configuration | 5 | 4 | 1 | 0 | 0 |
| 4.15 Multi-Tenancy | 2 | 2 | 0 | 0 | 0 |
| 4.16 Example Apps | 5 | 4 | 0 | 1 | 0 |
| 4.17 Target Adapters (Pipeline WRITE Phase) | 8 | 1 | 0 | 7 | 0 |
| **Total** | **105** | **69** | **3** | **31** | **2** |

### 4.1 Consumption View Processing

**Note:** For the delegate strategy, CAP's runtime handles column extraction, rename mapping, and column restriction automatically through the CDS projection chain. The `extractViewMapping()` in the annotation scanner is only needed for Scenario B (local→remote $expand resolution) and for the replicate strategy's MAP phase.

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.1.1 | **Column extraction** -- extract projected columns from the consumption view. For delegate: CAP handles this natively. For replicate: used in MAP phase. For Scenario B: used in batch-fetch. | P0 | Implemented |
| 4.1.2 | **Field rename mapping** -- extract `as` renames and build bidirectional mapping table (local ↔ remote). For delegate: CAP handles this natively. For Scenario B and replicate: used for manual mapping. | P0 | Implemented |
| 4.1.3 | **Flatten associations** -- support `customer.name as buyerName` style flattening in projections. The CDS compiler produces multi-segment `ref` arrays (e.g., `["customer", "name"]`) which the plugin's `extractViewMapping()` does not currently handle (it only reads `ref[0]`). At runtime, this is blocked by an **OData protocol limitation**: OData cannot express denormalized/flattened fields in `$select` or `$expand`. Service Integration docs: "OData doesn't support denormalization." Works only with HCQL (CAP's native protocol). Tested via `OrderFlat` entity; test skipped with documented limitation. | P1 | Not supported (OData limitation) |
| 4.1.4 | **Wildcard projection** -- when the projection uses `{ * }`, fetch all fields (no column restriction). For delegate: CAP handles this natively. | P0 | Implemented |
| 4.1.5 | **Exclude columns** -- support `excluding { field1, field2 }` in projections to explicitly exclude fields from remote fetch. For delegate: CAP handles this natively via the projection chain. For Scenario B: `extractViewMapping()` now records `excludedColumns` from `projection.excluding` in the CSN. `resolveFederatedExpand()` uses this to build an explicit `$select` that omits excluded fields from the remote batch-fetch. Tested via `LightBookmarks` → `CustomersLight` (excluding `email`, `modifiedAt`). | P1 | Implemented |
| 4.1.6 | **Static where clause** -- support `where condition` in consumption view projections to apply a permanent filter to all queries. The annotation scanner extracts `projection.where` from the CSN and stores it as `staticWhere` in the view mapping. The delegate handler detects `staticWhere` and routes through `runDirectRemoteQuery()`, which injects the static filter (already in remote field names) into the remote CQN after local→remote field translation. This correctly handles both wildcard projections (`ActiveCustomers where blocked = false`) and restricted projections with non-projected filter fields (`ElectronicsProducts where category = 'Electronics'`). Tested with: basic filtering, $count, $orderby, combined client $filter + static where, renames + static where. **Note:** CAP's [old "Consuming Services" docs](https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features) explicitly list `where` conditions in projections as "not supported" for remote services. This is a plugin value-add beyond CAP's native capabilities. | P1 | Implemented |
| 4.1.7 | **Entity-level rename** -- project a remote entity under a completely different local name and domain purpose (e.g., remote `Customers` as local `Suppliers` with fully renamed fields). CAP handles the full query translation and result mapping natively through the projection chain. Tested via `Suppliers` (V4) and `SuppliersV2` (V2). | P0 | Implemented |

### 4.2 Delegate Strategy

**CAP native capabilities:** CAP's runtime automatically translates queries through the CDS projection chain when using `remote.run(req.query)`. This includes column rename translation ($select, $filter, $orderby), column restriction to projected fields, $expand forwarding within the same remote service, and result structure transformation. See [Service Integration guide: Automatic Query Translation](https://cap.cloud.sap/docs/guides/integration/calesi#delegation). The delegate handler leverages this directly -- no manual query rewriting needed.

**What this plugin adds:** (1) Declarative handler registration via `@federation.delegate`, (2) Local→remote `$expand` resolution (Scenario B), (3) Optional response caching via `cds-caching`, (4) Optional entity-level SQLite cache via `@federation.delegate: { cache: { strategy: 'entity' } }` + secondary SQLite + pipelines.

**Protocol support for delegation:**

| Protocol | `cds.requires` kind | Delegation | Replication | Notes |
|---|---|---|---|---|
| OData V4 | `odata` | Supported | Supported | CAP-native CQN translation. Default and recommended. |
| OData V2 | `odata-v2` | Supported | Supported | CAP-native CQN translation. Provider needs `@cap-js-community/odata-v2-adapter`. OData V2 is deprecated by SAP; prefer V4. |
| HCQL | `hcql` | Supported | Supported | CAP's native protocol (used in xtravels sample). |
| REST | `rest` | **Not supported** | Supported (via RestAdapter) | CAP does not translate CQN to REST. `remote.run(req.query)` fails. Use `@federation.replicate` instead. |

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.2.1 | **Transparent READ proxy** -- intercept `on('READ')` via `service.prepend()`, forward query to remote service via `remote.run(req.query)`. CAP handles all query translation automatically through the projection chain. | P0 | Implemented |
| 4.2.2 | **Query translation via rename mapping** -- `$select`, `$filter`, `$orderby` translation from local to remote field names. CAP handles this natively via the projection chain. | P0 | Implemented |
| 4.2.3 | **Column-restricted fetch** -- consumption view projects specific columns → remote `$select` is restricted automatically. CAP handles this natively via the projection chain. | P0 | Implemented |
| 4.2.4 | **Result mapping** -- remote field names mapped back to local names in the response. CAP handles this natively via the projection chain. | P0 | Implemented |
| 4.2.5 | **Cross-service $expand resolution (Scenario B)** -- when a local entity `$expand`s to a federated entity, the plugin collects foreign keys from local results, batch-fetches from remote in a single call, and stitches results. CAP cannot resolve this across service boundaries ([Service Integration guide: Navigation & Expands](https://cap.cloud.sap/docs/guides/integration/calesi)). (main: local / `@federation.replicate`; target: `@federation.delegate`) | P0 | Implemented |
| 4.2.6 | **$filter / $orderby / $select / $expand passthrough** -- all query parameters forwarded and translated by CAP's projection chain. Includes remote→remote $expand (Scenario A). CAP handles this natively. | P0 | Implemented |
| 4.2.7 | **Navigation path filter translation** -- when `$filter` uses a navigation path through a renamed association (e.g., `buyer/name` where `buyer` is renamed from `customer`), CAP does not translate the association name. The plugin's `translateNavigationFilters()` pre-translates same-service navigation paths before forwarding. Cross-service navigation (local→remote, Scenario B) uses `resolveRemoteNavigationFilters()` to query the remote service for matching keys and rewrite the navigation filter to a local FK IN filter. Lambda operators (`any`/`all`) on cross-service to-many associations use `resolveRemoteLambdaFilters()` in `expand-local-to-remote.js`. | P1 | Implemented (same-service + Scenario B to-one + Scenario B lambda) |
| 4.2.8 | **Error propagation** -- surface remote service errors with context (HTTP status, message, remote entity) | P0 | Implemented (V4+V2) |
| 4.2.8a | **Server-driven paging** -- when the remote OData service caps a single response below the client's requested `$top` (e.g. Northwind's 20-row default), the delegate handler auto-loops the remote via `$top`/`$skip` until the client's rows are satisfied or the remote returns empty. Preserves `@odata.count` from the first batch. Implemented in `srv/delegation/paged-remote-query.js` and wired into both plain and cached delegate handlers plus `runDirectRemoteQuery` (static-`where` / lambda paths). Transparent to the client. | P0 | Implemented |
| 4.2.9 | **Fallback to stale data** -- if a remote call fails and cached or replicated data exists, serve stale data with a warning header instead of failing the request. The fallback chain: (1) try remote service, (2) if failed and cache exists, serve expired cache entry with `Warning: 110 - "Response is Stale"` header, (3) if no cache but entity is also replicated locally, serve replicated data with staleness warning, (4) if none available, propagate the error. The [SAP risk-management Java sample](https://cap.cloud.sap/docs/guides/services/consuming-services#resilience) demonstrates this pattern with `ResilienceDecorator`: try remote, fall back to local DB on failure. For delegate+cache entities, `cds-caching` could expose an `allowStale` option. For delegate entities that have a replicated twin, the fallback would query the local table. | P1 | Not started |
| 4.2.10 | **Annotation-driven CUD forwarding** -- opt-in CREATE/UPDATE/DELETE forwarding to the remote service via annotation flags. Default is read-only (safe). `writable: true` enables all three; individual `create`, `update`, `delete` flags for selective control (individual flags override `writable`). Read-only entities get `@readonly` enforced by the scanner; partially writable entities register explicit rejection handlers for disabled operations. Works consistently across both `delegate` and `replicate` strategies -- for replicate, a successful CUD additionally triggers an immediate single-record sync to the local table. | P1 | Implemented |
| 4.2.11 | **~~Write-through via transactional outbox~~** -- Removed. CUD forwarding (4.2.10) is inherently synchronous: the client expects the remote's response (201/200/204). `cds.outboxed()` defers execution and returns no result, breaking OData's request-response contract and Fiori Elements' expectations. The outbox pattern belongs in fire-and-forget scenarios: event-driven sync (3.7.3), post-write cache invalidation (4.3.5), and replicate-strategy single-record sync after CUD. See [xtravels](https://github.com/capire/xtravels): it uses `cds.outboxed(xflights)` for domain event notification (`BookingCreated`), never for CUD proxy. | -- | Removed (by design) |
| 4.2.12 | **Cross-service navigation resolution** -- when an OData client navigates across a local/remote boundary (e.g., `GET /Reviews(id)/product` where Reviews is local and product is delegated — [cross-service navigation: local → remote](../concepts/cross-service-scenarios.md#cross-service-navigation-local--remote) — or `GET /Customers('C001')/bookmarks` where Customers is delegated and bookmarks is local — [cross-service navigation: remote → local](../concepts/cross-service-scenarios.md#cross-service-navigation-remote--local)), the plugin detects the multi-segment `from.ref` in the CQN and resolves it. This is distinct from `$expand` — navigation follows an association path and returns the **target** entity directly. Fiori Elements generates navigation URLs when users click links from list pages to detail pages. Two sub-cases: (a) local→remote (`resolveLocalToRemoteNavigation`, entry: local / `@federation.replicate`; target: `@federation.delegate`): read local FK, delegate to remote with rename mapping; (b) remote→local (`rewriteRemoteToLocalNavigation`, entry: `@federation.delegate`; target: local / `@federation.replicate`): extract source key from `from.ref[0].where`, rewrite CQN to FK-filtered local query. Supports `$select` on target (N3) and `$filter` on local target (N4). Implemented in `cross-service-navigation.js`, wired into delegate handler and local expand resolver. | P1 | Implemented |

#### Query Capability Matrix

Support status of OData query features across federation scenarios. **Local** = entity in consumer DB. **Delegate (A)** = entity proxied to a single remote via `remote.run(req.query)`, all associations within same remote. **Mashup (B)** = local entity with `$expand` to remote (plugin batch-fetch + stitch). **Mashup (C)** = remote entity with `$expand` to local (plugin: strip local expand items, forward remote, query local DB, stitch results).

All Delegate (A) tests run against both OData V4 and V2 via a parameterized test generator, unless noted as "V4 only".

| Capability | Local | Delegate (A) | Mashup (B) | Mashup (C) |
|---|---|---|---|---|
| **Basic $filter** (eq, ne, gt, ge, lt, le, and, or, not) | Yes | Yes (V4+V2, CAP-native) | Yes (local filter only) | Yes |
| **String functions** (contains, startswith, endswith) | Yes | Yes (V4+V2, CAP-native) | Partial (local only) | Yes |
| **String functions** (tolower, toupper) | Yes | Yes (V4+V2, CAP-native) | N/A | Yes |
| **Navigation path $filter** (e.g., `buyer/name eq 'X'`) | Yes (SQL JOINs) | Yes (V4 only, plugin translates assoc renames) | Yes (V4, plugin query splitting via resolveRemoteNavigationFilters) | N/A |
| **Lambda operators** (any/all on to-many) | Yes | Yes (V4 only, plugin workaround) | Yes (resolveRemoteLambdaFilters, cross-service query splitting) | Partial (resolveLocalLambdaFilters) |
| **$filter in $expand** | Yes | Yes (V4 only, nested options not supported in V2) | Yes | Yes |
| **$orderby in $expand** | Yes | Yes (V4 only, non-renamed fields) | Yes | Yes |
| **$top in $expand** | Yes | Yes (V4 only) | Yes (per-parent limiting for to-many) | Yes (per-parent limiting) |
| **$skip in $expand** | Yes | Yes (V4 only, `;` separator) | Yes (per-parent for to-many) | N/A |
| **$expand** | Yes | Yes (V4+V2, CAP-native, Scenario A) | Yes (plugin batch-fetch + stitch) | Yes (plugin: strip local, forward remote, query local, stitch) |
| **Nested $expand** (e.g., `$expand=a($expand=b)`) | Yes | Yes (V4+V2, CAP-native) | Yes (inner expands forwarded to remote, recursive rename mapping) | N/A |
| **Cross-service navigation** (`/A(key)/b`) | Yes (SQL JOINs) | N/A (same-service) | Yes (local→remote: plugin reads FK + delegates) | Yes (remote→local: plugin rewrites to FK filter) |
| **$apply (aggregation)** | Yes | **No** (CAP rejects `.groupBy` for remote services) | N/A | N/A |
| **$search** | Yes | Yes (V4, CAP forwards to remote) | N/A | N/A |
| **CQL: SELECT.one** | Yes | Yes (V4+V2) | N/A | N/A |
| **CQL: .columns() / projection functions** | Yes | Yes (V4+V2, renamed fields work) | N/A | N/A |
| **CQL: .where() (eq, !=, >=, <=, in, boolean, AND, OR)** | Yes | Yes (V4+V2, CAP-native, renames work) | N/A | N/A |
| **CQL: .where() with `like`** | Yes | **No** (OData has no `like` keyword) | N/A | N/A |
| **CQL: .where() tagged templates** | Yes | Yes (V4+V2) | N/A | N/A |
| **CQL: .orderBy()** | Yes | Yes (V4+V2, renamed fields work) | N/A | N/A |
| **CQL: .limit()** | Yes | Yes (V4+V2) | N/A | N/A |
| **CQL: SELECT.distinct** | Yes | **No** (OData has no DISTINCT) | N/A | N/A |
| **CQL: SELECT.from key shortcut** | Yes | Yes (V4+V2) | N/A | N/A |
| **CQL: $expand via projection functions** | Yes | Yes (V4+V2, Scenario A) | Yes (Scenario B) | Yes (Scenario C) |
| **CQL: cds.ql tagged template literals** | Yes | Yes (V4+V2, filters, expands, ordering) | N/A | N/A |
| **CQL: .groupBy() / .having()** | Yes | **No** (OData uses $apply) | N/A | N/A |
| **CQL: forUpdate() / forShareLock()** | Yes | **No** (locking N/A for OData) | N/A | N/A |
| **CQL: stream() / pipeline() / foreach()** | Yes | **No** (DatabaseService only) | N/A | N/A |

#### Consumption View Pattern Matrix

| Pattern | Status | Notes |
|---|---|---|
| **Wildcard projection** (`*`) | Implemented | All remote fields projected. V4+V2. |
| **Column restriction + renames** (`as` clauses) | Implemented | CAP-native query translation. V4+V2. |
| **Entity-level rename** (different local purpose) | Implemented | Same remote, different domain context. V4+V2. |
| **Excluding columns** (`excluding { ... }`) | Implemented | Excluded fields absent from response. V4. |
| **Static where clause** (`where condition`) | Implemented | Plugin extracts `projection.where` and injects into remote query via `runDirectRemoteQuery()`. Supports wildcard + restricted projections. |
| **Flatten associations** (path expressions) | **Not supported** | OData protocol limitation. Service Integration guide: "OData doesn't support denormalization." Works only with HCQL. |
| **Higher-level flattened view** (service-level projection with path expressions) | **Not supported** | Same OData limitation. 2-level projection chain does not resolve path expressions for OData. |
| **Cross-service path expressions** (local → remote via association) | **Not supported** | `@cds.persistence.skip` on delegate target prevents SQL compilation of cross-service paths. Requires data federation (replication). |
| **Redirected associations** (`redirected to`) | Expected to work | CAP handles `redirected to` in the projection chain before `remote.run(req.query)` is called. The plugin does not interfere with association resolution. Untested but expected to work for Scenario A (same-remote); the [old "Consuming Services" docs](https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features) list it as supported. Common in S/4HANA integration where `A_BusinessPartner` has many related entities that need re-targeting. |
| **Mixin associations** (backlink on remote entity) | Implemented | e.g., `risks : Association to many Risks on risks.supplier = $self` on a delegate entity. Used for Scenario C (remote→local $expand). |

#### Known Limitations in Expand Options

| Issue | Detail |
|---|---|
| **Renamed fields in expand $orderby** | Within `$expand=orders($orderby=...)`, renamed field names fail. Consumer URL parser requires local names, but remote service requires remote names. CAP does not translate renames inside nested expand options. Use non-renamed fields. |
| **V2 nested expand options** | OData V2 does not support `$filter`, `$orderby`, `$top`, `$skip` within `$expand(...)`. These options are silently ignored by the V2 adapter. |

### 4.3 Caching

Caching options on `@federation.delegate` combine **response-level** caches ([`cds-caching`](https://github.com/mikezaschka/cds-caching), default) with an optional **`cache.strategy: 'entity'`** path (SQLite + `cds-data-pipeline`).

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.3.1 | **Cache wrapper** -- wrap delegate or replicate handler with `cds-caching`'s `cache.rt.run(req, handler, { ttl })` when `cache` option is present | P0 | Implemented (delegate only) |
| 4.3.2 | **TTL configuration** -- per-entity TTL via `@federation.delegate: { cache: { ttl: 60000 } }` | P0 | Implemented |
| 4.3.3 | **Tag-based invalidation** -- auto-tag `federation:<entityName>`, static string tags, dynamic data-based tags (`{ data, prefix }`), template tags (`{ template }`) via `cds-caching` | P1 | Implemented |
| 4.3.4 | **Backend flexibility** -- in-memory for dev, Redis for production. Implemented via `cds-caching` peer dependency. | P0 | Implemented |
| 4.3.5 | **Cache-aside on write** -- invalidate cache entries when remote data changes (e.g., after replication run or event) | P1 | Not started |
| 4.3.6 | **Graceful degradation** -- if `cds-caching` not installed, silently skip caching and log a warning | P0 | Implemented |
| 4.3.7 | **Configurable cache service** -- `service` option to target a specific `cds.requires` entry (default: `'caching'`), enables multiple cache backends per app | P1 | Implemented |
| 4.3.8 | **Entity-level delegate cache** (`cache.strategy: 'entity'`) — on TTL miss run `cds-data-pipeline` (`delta` with OData `delta.mode: 'none'`) to refill a secondary SQLite service (default `FederationEntityCache`); **one SQLite file per tenant** when `FederationEntityCache` / `entityCache.urlTemplate` is configured (ADR 0010 — no `tenantId` column). Subsequent READ CQNs (`$filter`, `$orderby`, …) query SQLite. Default `strategy: 'response'` keeps prior cds-caching behavior. Fallback to live delegate on pipeline/cache errors. REST sources without CDS entity model skipped at scan time until explicit support. Cross-service expands that fetch delegated associations still hit the delegate path in MVP. Tests: `[4.3.8] EC1`, `[4.3.8] EC2`. | P1 | Implemented |

### 4.4 Replicate Strategy (Core Engine)

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.4.1 | **Full sync** -- truncate target (respecting multi-source), then replicate all records | P0 | Implemented |
| 4.4.2 | **Delta sync** -- timestamp-based, key-based, or delta-token-based incremental replication | P0 | Implemented (timestamp, key, datetime-fields via adapter) |
| 4.4.3 | **Streaming batch reads** -- async generator yielding configurable-size batches, requesting only projected columns (from 4.1.1) | P0 | Implemented |
| 4.4.4 | **UPSERT writes** -- idempotent create-or-update using CQL `UPSERT` | P0 | Implemented |
| 4.4.5 | **Soft-delete propagation** -- detect and replicate deletions from source (tombstone or diff) | P1 | Not started |
| 4.4.6 | **Reconciliation mode** -- periodic full comparison to detect drift without full reload | P2 | Not started |
| 4.4.7 | **Dry-run mode** -- preview what would be replicated (counts, sample records) without writing | P2 | Not started |

### 4.5 Annotation-Driven Configuration

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.5.1 | **`@federation.delegate` / `@federation.replicate` annotations** -- runtime behavior only (schedule, cache). Strategy is explicit from annotation name. Schema is defined by the consumption view. | P0 | Implemented |
| 4.5.2 | **Auto-persistence** -- for `replicate` strategy, auto-set `@cds.persistence.table: true` and `@cds.persistence.skip: false` at model load time (via `cds.on('loaded')`) | P0 | Implemented |
| 4.5.3 | **Annotation options** -- `@federation.replicate: { mode: 'delta', schedule: '*/10 * * * *', batchSize: 500, cache: { ttl: 60000 } }` | P1 | Implemented |
| 4.5.4 | **Source inference** -- derive source service and entity from the projection's `as projection on` clause, or explicit `source` option for REST services without CDS model | P0 | Implemented |
| 4.5.5 | **Entity ordering** -- respect referential integrity by replicating parent entities before children (infer from associations or allow explicit ordering) | P1 | Not started |

**Separation of concerns:** The consumption view defines the schema contract (what data, what shape, field mapping). The annotation defines runtime behavior (how to get it):

```cds
using { API_BUSINESS_PARTNER as bp } from '../srv/external/API_BUSINESS_PARTNER';

// Schema: consumption view maps remote to local domain
// Runtime: delegate -- live proxy
@federation.delegate
entity Addresses as projection on bp.A_BusinessPartnerAddress {
    BusinessPartner as customerID,    // rename for local domain
    AddressID as ID,                  // rename
    CityName as city,                 // rename
    PostalCode as zip                 // rename
};

// Schema: only 2 fields needed
// Runtime: delegate + cache (5-min TTL)
@federation.delegate: { cache: { ttl: 300000 } }
entity Countries as projection on bp.A_Country {
    Country as code,
    CountryName as name
};

// Schema: 4 fields with renames
// Runtime: replicate with delta sync every 10 min
@federation.replicate: { mode: 'delta', schedule: '*/10 * * * *' }
entity BusinessPartners as projection on bp.A_BusinessPartner {
    BusinessPartner as ID,
    BusinessPartnerFullName as name,
    City as city,
    modifiedAt
};
```

### 4.6 Source Adapters (Replicate Strategy)

For **delegation**, no adapters are needed -- CAP's `remote.run(req.query)` handles OData V4/V2 natively. Adapters are only used by the **replicate** strategy for manual batch reads.

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.6.1 | **OData v2/v4 adapter** -- batch reads with `$select` restricted to projected columns, `$filter` for delta (timestamp/key/datetime-fields modes), `$top/$skip` pagination. Handles V2-specific timestamp format quirks. Wired via adapter factory. | P0 | Implemented |
| 4.6.1a | **Server-driven paging (replicate)** -- adapter keeps paging via `$skip` until the remote returns an empty batch, even when the remote enforces a per-request cap below the requested `batchSize` (e.g. Northwind's 20-row default). | P0 | Implemented |
| 4.6.2 | **REST adapter** -- cursor/offset/page pagination via `srv.send()`, configurable delta URL parameter, `dataPath` extraction from nested responses, `withRetry`. Explicit `source` in annotation. **Replication only** -- delegation not possible because CAP does not translate CQN to REST. | P0 | Implemented |
| 4.6.3 | **CQN adapter** -- single adapter serving both read shapes: *entity-shape* reads (row-preserving copy from CQN-native `cds.requires` services — secondary DB, CAP-wrapped legacy DB) and *query-shape* reads (derived/aggregated snapshot built from a user-supplied `source.query` closure). Read shape is inferred from the config (see [ADR 0007](../internal/decisions/0007-infer-pipeline-intent-from-config-shape.md)); transport is routed via `source.kind: 'cqn'` on the adapter factory. See [ADR 0004](../internal/decisions/0004-scope-cqn-adapter-to-cds-data-replication.md), [ADR 0005](../internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md), and [`docs/pipeline/guide/sources/cqn.md`](../../docs/pipeline/guide/sources/cqn.md). | P1 | Implemented |
| 4.6.4 | **Custom adapter base class** -- documented interface for user-defined adapters (`readStream(tracker)` async generator contract) | P1 | Implemented (BaseAdapter) |
| 4.6.5 | **Adapter factory** -- auto-selects ODataAdapter or RestAdapter based on remote service `kind` (`odata`/`odata-v2` vs `rest`). Wired into `DataReplication._defaultReadHandler`. | P0 | Implemented |
| 4.6.6 | **OData delta tokens** -- support `$deltatoken` / `$deltalink` for OData-native change tracking | P2 | Not started |

### 4.7 Data Transformation (MAP Phase, Replicate Strategy)

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.7.1 | **Event hooks** -- `before/on/after('MAP')` for custom transformation logic | P0 | Implemented |
| 4.7.2 | **Projection-based field mapping** -- apply rename mapping from consumption view (4.1.2) during MAP phase. Remote field `BusinessPartnerFullName` becomes local field `name`. Replaces the need for separate declarative field mapping config. | P0 | Implemented |
| 4.7.3 | **Record filtering** -- skip/include records during MAP phase | P1 | Implemented (via hooks) |
| 4.7.4 | **Enrichment** -- auto-populate `replicated` aspect fields (lastReplicatedAt, lastReplicatedBy) | P0 | Implemented |

### 4.8 Scheduling & Triggers (Replicate Strategy)

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.8.1 | **Cron scheduling** -- periodic replication via `cds.spawn` with cron expressions. Currently uses millisecond intervals. | P0 | Implemented |
| 4.8.2 | **Manual trigger** -- programmatic `run()` API and OData action with configurable `blockSize`/`maxCount` params | P0 | Implemented |
| 4.8.3 | **Event-driven single-record sync** -- subscribe to SAP Business Events / CloudEvents (e.g., `sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1`) to trigger per-record replication. Use `cds.outboxed()` transactional outbox pattern for reliable event delivery with automatic retry ([Service Integration guide: Transactional Outbox](https://cap.cloud.sap/docs/guides/integration/calesi)). | P1 | Not started |
| 4.8.4 | **Initial load on startup** -- option to run full sync when the application starts | P1 | Not started |
| 4.8.5 | **On-read trigger** -- lazy replication on first access (with TTL-based staleness check) | P2 | Not started |
| 4.8.6 | **Dynamic destination override** -- allow runtime specification of source system destination (enables same replication config against different S/4 instances) | P1 | Not started |

### 4.9 CQL Safety

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.9.1 | **Clone queries before modification** -- always use `cds.ql.clone(query)` before modifying CQN objects to prevent side effects across the event pipeline. Critical in the replicate READ phase where `req.query.where` is modified in-place for delta filtering ([Service Integration guide: CQN Object Inspection](https://cap.cloud.sap/docs/guides/integration/calesi)). | P0 | Implemented |

### 4.10 Resilience & Data Integrity

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.10.1 | **Retry with exponential backoff** -- configurable retry policy for transient failures (all strategies) | P0 | Implemented |
| 4.10.2 | **Checkpoint/resume** -- resume from last successful batch position after failure (replicate) | P0 | In progress (lastKey tracking exists, full resume not yet wired) |
| 4.10.3 | **Concurrency guard** -- prevent parallel runs of the same replication (lock via DB status) | P0 | Implemented |
| 4.10.4 | **Circuit breaker** -- stop retrying after N consecutive failures, require manual reset | P1 | Not started |
| 4.10.5 | **Rate limiting** -- respect API quotas with configurable request throttling (all strategies) | P1 | Not started |
| 4.10.6 | **Transactional batches** -- configurable: per-batch or full-run transaction scope (replicate) | P0 | Implemented |
| 4.10.7 | **Stale lock detection** -- auto-release stuck "running" status after configurable timeout | P1 | Not started |
| 4.10.8 | **Dead-letter queue** -- isolate permanently failed batches/records for later analysis | P1 | Not started |
| 4.10.9 | **Graceful degradation** -- serve stale data when source is unavailable; mark data as stale but don't fail reads. For replicate strategy: if a scheduled sync fails, the local table still serves the last-synced data — no additional code needed. For delegate strategy: see 4.2.9 (fallback to cached/replicated data on remote failure). The staleness indicator could be a response header (`Warning: 110`) or a metadata annotation on the response (`@stale: true, @lastSynced: '...'`). | P1 | Not started |
| 4.10.10 | **Multi-source conflict resolution** -- configurable strategy (last-write-wins, source-priority, custom handler) when multiple sources replicate into the same target entity | P1 | Not started |
| 4.10.11 | **Schema evolution handling** -- detect source schema changes and handle gracefully (log warning, skip unknown fields) | P2 | Not started |

### 4.11 Tracking & Observability

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.11.1 | **Federation tracker** -- persist name, source, target, mode, lastSync, lastKey, status per replication | P0 | Implemented |
| 4.11.2 | **Run history** -- individual run records with start/end, trigger, mode, statistics, error | P0 | Implemented |
| 4.11.3 | **Statistics** -- created/updated/deleted/skipped counts per run and cumulative | P0 | Implemented |
| 4.11.4 | **Structured logging** -- use `cds.log` with levels and structured context | P0 | In progress (basic logging exists, structured context incomplete) |
| 4.11.5 | **CAP telemetry integration** -- emit OpenTelemetry spans for replication runs | P2 | Not started |
| 4.11.6 | **Request-level tracking** -- optional per-batch tracking with source/target data snapshots | P1 | Implemented |
| 4.11.7 | **Anomaly detection** -- detect unexpected volume changes or error spikes; emit warning | P2 | Not started |
| 4.11.8 | **Cache hit/miss metrics** -- leverage `cds-caching`'s built-in statistics for cache monitoring. Implemented via cds-caching peer dependency. | P1 | Implemented |

### 4.12 Security

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.12.1 | **Credential isolation** -- each federation target uses its own service credentials via `cds.requires`. Implemented via CAP's native `cds.connect.to()` credential management. | P0 | Implemented |
| 4.12.2 | **Sensitive data filtering** -- annotation to exclude fields from replication (e.g., `@federation.exclude`) | P1 | Not started |
| 4.12.3 | **Audit trail** -- log who triggered each replication and what changed (leverage CAP audit logging) | P2 | Not started |

### 4.13 Management API

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.13.1 | **OData service** -- expose federations, runs, and statistics as read-only OData entities | P0 | Implemented |
| 4.13.2 | **`run` action** -- trigger a replication run via API | P0 | Implemented |
| 4.13.3 | **`flush` action** -- clear replicated/cached data for a specific federation | P0 | Implemented |
| 4.13.4 | **`status` function** -- get current status of a federation | P0 | Implemented |
| 4.13.5 | **Fiori Elements UI** -- optional monitoring dashboard (annotations-driven) | P2 | Not started |

### 4.14 Configuration

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.14.1 | **Annotation-driven** (`@federation.delegate` / `@federation.replicate`) -- zero-config for standard scenarios | P0 | Implemented |
| 4.14.2 | **`cds.env` config** -- `cds.requires.cds-data-federation` in package.json/.cdsrc.json | P0 | In progress (basic config works, full option surface incomplete) |
| 4.14.3 | **Programmatic API** -- `addPipeline()` for dynamic runtime configuration | P1 | Implemented |
| 4.14.4 | **Profile-based config** -- `[development]` / `[production]` overrides. Implemented via CAP's native `cds.env` profile mechanism. | P1 | Implemented |
| 4.14.5 | **Sensible defaults** -- delegate strategy, batch size 1000, delta mode for replicate, 10-min schedule, auto-retry 3x | P0 | Implemented |

### 4.15 Multi-Tenancy

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.15.1 | **Tenant-aware replication** — scheduled pipeline runs fan out per subscribed tenant; entity-cache SQLite uses separate files per tenant; MTX subscribe/unsubscribe hooks (opt-in). Tests: `[4.3.8] EC2`, `[4.15.1]`. | P2 | Implemented |
| 4.15.2 | **Tenant-specific config** — `cds.env.requires['cds-data-federation'].multitenancy.tenants.<id>.replicate.<entity>` overrides for `mode` / `trigger`. Tests: `[4.15.2]`. | P2 | Implemented |

### 4.16 Example Apps

Manual-run example apps under `examples/` that complement the Jest tests in `test/`. They are the showcase for the plugin: each major feature has a runnable app with a Fiori Elements UI and seed data, aggregated in a ushell sandbox launchpad. The demo models a small movies-and-streaming platform so every strategy has an obvious narrative.

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.16.1 | **Example providers** -- `examples/provider` (Studio V4: Movies, Genres, Directors, Actors, Castings + Licensing V2: Titles, TerritoryLicenses on :4444), `examples/inventory` (StreamingService on :4445), `examples/rest-provider` (Box-office REST on :4446); start via `npm run examples:start` | P1 | Implemented |
| 4.16.2 | **Example consumer model** -- `examples/consumer` with one consumption view per feature (Movies, TrendingMovies, AwardWinningMovies, Films, Actors, Directors, LicensedMovies, StreamingManifests, Watchlists, Reviews, ReplicatedMovies, ReplicatedBoxOffice) across all three providers; persistent SQLite so UI CRUD survives restarts | P1 | Implemented |
| 4.16.3 | **Fiori Elements apps** -- one List Report / Object Page per demonstrated entity, driven by `consumer-service-ui.cds` annotations (including `@UI.IsImageURL` for poster art and Scenario-C facets for Reviews/Bookmarks on the Movies Object Page) | P1 | Implemented |
| 4.16.4 | **Launchpad** -- `examples/consumer/app/launchpage.html` aggregates all FE apps in a `sap.ushell` sandbox following the risk-management sample pattern; reserves a placeholder tile for 4.16.5 | P1 | Implemented |
| 4.16.5 | **Management UI** -- Fiori Elements UI over `DataPipelineManagementService` (Pipelines, PipelineRuns) with actions to trigger runs and flush state | P2 | Not started |

**Maintenance rule:** whenever a user-visible feature lands (new annotation option, new adapter, new query capability reachable via OData, new management action), update `examples/consumer` alongside `test/consumer`, and wire the new surface into `consumer-service-ui.cds` + a FE app if it exposes new user-accessible behavior. Verify `npm run examples:start` still boots cleanly and the affected tile renders. This is enforced by `.claude/commands/implement-feature.md` Phase 5.

### 4.17 Target Adapters (Pipeline WRITE Phase)

Symmetric to §4.6 (source adapters, READ phase). The WRITE phase currently hard-codes `cds.connect.to('db')` + `INSERT`/`UPSERT` in [`Pipeline._defaultWriteHandler`](../../packages/cds-data-pipeline/srv/lib/Pipeline.js). A `TargetAdapter` capability layer generalises that to arbitrary `target.service` kinds (other CAP services, OData remotes, REST backends, CQN-native services) and unlocks the three registration-time validation rows deferred by [ADR 0007 §"Registration-time validation matrix"](../internal/decisions/0007-infer-pipeline-intent-from-config-shape.md) (rows 6–8).

Status context: the idea is documented in [`ideas/service-to-service-data-movement.md`](../internal/ideas/service-to-service-data-movement.md) and promoted to the `kind: 'move'` recipe in [ADR 0005](../internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md). The contract itself is defined by [ADR 0008](../internal/decisions/0008-target-adapter-capability-layer.md) (`BaseTargetAdapter` with per-adapter idempotency guarantees, four built-in adapters, config-closure REST shape).

| # | Feature | Priority | Status |
|---|---|---|---|
| 4.17.1 | **`BaseTargetAdapter` contract** -- documented interface for user-defined and built-in target adapters. Contract: `writeBatch(records, tracker, ctx)` (idempotent per-batch), `deleteBatch(keys, tracker, ctx)` (optional), `truncate(tracker, ctx)` (optional — used by full-refresh mode). Symmetric to `BaseAdapter.readStream(tracker)` in §4.6.4. | P1 | Not started |
| 4.17.2 | **Capability flag declaration** -- each adapter declares `supportsKeyAddressableWrites` (enables `mode: 'delta'`), `supportsBatchDelete` / `supportsTruncate` (enables `mode: 'full'`), `supportsBatchInsert` (enables `source.query` snapshot writes). Consumed by `_validateConfig` to produce config-grounded registration errors per [ADR 0007 rows 6–8](../internal/decisions/0007-infer-pipeline-intent-from-config-shape.md). | P1 | Not started |
| 4.17.3 | **DB target adapter** -- default for `target.service: 'db'`. Implements `writeBatch` via `INSERT.into` (for `source.query` shape) or `UPSERT.into` (for `source.entity` shape), mirroring the current default write handler. Advertises `supportsKeyAddressableWrites`, `supportsBatchInsert`, `supportsTruncate`. Preserves today's Req 4.4.4 semantics. | P0 | Implemented (as `_defaultWriteHandler`; to be lifted into `DbTargetAdapter`) |
| 4.17.4 | **OData target adapter** -- `target.service` kinds `odata` / `odata-v2`. `writeBatch` = PUT-by-key with 404 → POST fallback (per-record idempotency). `deleteBatch` = DELETE-by-key. Batched via OData `$batch` where available; falls back to sequential with `withRetry`. Capabilities: `supportsKeyAddressableWrites: true`, `supportsBatchInsert: false` (no server-side snapshot write). **No server-side UPSERT** — per-record error handling required. | P1 | Not started |
| 4.17.5 | **REST target adapter** -- `target.service` kind `rest`. User-supplied `writeBatch(records)` closure on the `target` config (symmetric to `source.query` in §4.6.3). No implicit idempotency; the user owns the write semantics. `deleteBatch` similarly user-supplied. Capabilities: declared by the user on the config. Explicit `source` / `target` in annotation (no CAP model needed). **Movement only** — like the source-side REST adapter, CAP does not translate CQN to REST. | P1 | Not started |
| 4.17.6 | **CQN target adapter** -- for CQN-native `cds.requires` services (secondary DB, CAP-wrapped legacy DB, sibling CAP service). Uses `UPSERT.into` / `DELETE.from` against `target.service.run(cqn)`. Capabilities match the DB adapter. Enables service-to-service replication between two CAP services with identical semantics to a local-DB target. See [ADR 0004](../internal/decisions/0004-scope-cqn-adapter-to-cds-data-replication.md) for the source-side twin. | P1 | Not started |
| 4.17.7 | **Target adapter factory** -- auto-selects adapter by `target.service` kind (analogous to §4.6.5). Wired into `Pipeline._defaultWriteHandler` which replaces its hard-coded `cds.connect.to('db')` with `factory.resolve(config.target).writeBatch(...)`. Custom targets register via `cds.requires` kind; unknown kinds throw at registration time. | P1 | Not started |
| 4.17.8 | **Capability-validated registration** -- engine compares `mode` / `source.query` / `delta` against the resolved target adapter's capability flags and rejects incoherent combinations at registration. Implements [ADR 0007 validation matrix rows 6–8](../internal/decisions/0007-infer-pipeline-intent-from-config-shape.md) (unblocked by this section): `mode: 'delta'` against a target without `supportsKeyAddressableWrites`; `mode: 'full'` against a target without `supportsTruncate`; `source.query` against a target without `supportsBatchInsert`. | P1 | Not started |

**Scope boundaries (not this section):**

- **Not a transformation layer.** The MAP phase (§4.7) owns local→remote field mapping for outbound writes. Target adapters only know how to write a mapped batch.
- **Not delete propagation.** Req 4.4.5 (soft-delete propagation) remains open even for the DB target; propagating deletes to a remote target is strictly harder and deliberately deferred.
- **Not conflict resolution.** Once `target.service !== 'db'`, the pipeline no longer owns target state. Concurrency with external writers is the user's responsibility; this is called out in `recipes/move-to-service.md` and in the idempotency contract each adapter publishes.

### 4.18 Materialize Strategy (Annotation Plugin)

Declarative snapshots via [`cds-data-materialization`](../../packages/cds-data-materialization/). Composes `cds-data-pipeline` query-shape pipelines (`source.query` inferred from aggregation-shaped CDS projections). See [ADR 0009](../internal/decisions/0009-cds-data-materialization-plugin.md) and [`spec/internal/research/materialize-projection-csn.md`](../internal/research/materialize-projection-csn.md).

| # | Feature | Priority | Status |
|---|---|---|---|
| M-1 | **`cds-data-materialization` package** — npm workspace sibling; peer-dep `cds-data-pipeline` | P0 | Implemented |
| M-2 | **`@materialize.snapshot` annotation** — `schedule`, `refresh`, `name`, `source.service`; flattened CSN keys | P0 | Implemented |
| M-3 | **Projection → `source.query` compiler** — walks CSN `projection.columns` / `groupBy` / `where`; no public `options.query` | P0 | Implemented |
| M-4 | **Pipeline binding** — `addPipeline` with `source.kind: 'cqn'` + compiled query | P0 | Implemented |
| M-5 | **Registration validation** — aggregation shape, no `@federation.*`, CQN-native source, fail-loud if engine missing | P0 | Implemented |
| M-6 | **`materialized` aspect** — `lastMaterializedAt` / `lastMaterializedBy` (opt-in on targets) | P1 | Implemented |
| M-7 | **Tests** — unit (compiler) + thin integration (binding + execute) | P0 | Implemented |
| M-8 | **Published surface** — README, [`docs/materialization/`](../../docs/materialization/), VitePress nav | P0 | Implemented |
| M-9 | **ADR 0009 + requirements §4.18** | P0 | Implemented |
| M-10 | **Example** — materialize fixture or docs walkthrough | P1 | Implemented |

**v1 exclusions:** `refresh: 'partial'` from annotation (M-11); OData/REST aggregate sources; `@federation.*` on same entity; cross-source joins in one materialization.

---

## 5. Technical Architecture

### 5.1 Plugin Lifecycle

```
1. cds.on('loaded', csn)     -- Scan for @federation.delegate / @federation.replicate annotations
                                 Extract consumption view metadata:
                                   - projected columns
                                   - field rename mapping (local ↔ remote)
                                 For 'replicate': set @cds.persistence.table + @cds.persistence.skip: false
                                 Build federation configs with view metadata

2. cds.once('served')        -- For each annotated entity:
                                 'delegate': register on('READ') proxy with rename-aware query translation
                                              optionally wrap with cds-caching if cache option present
                                 'replicate': initialize DataPipelineService with column/rename config
```

### 5.2 Component Overview

```
cds-plugin.js                        -- Entry point, lifecycle hooks
  |
  +-- AnnotationScanner              -- Scans @federation.*, extracts consumption view metadata
  |     |
  |     +-- ViewMetadata             -- Projected columns, rename mappings, source inference
  |
  +-- delegation/                    -- Registers delegate handlers on served entities
  |     |
  |     +-- DelegateHandler          -- Transparent proxy: remote.run(req.query)
  |     |                               CAP handles all query translation natively
  |     |                               Optionally wrapped with cds-caching for cache option
  |     |
  |     +-- LocalExpandResolver      -- Scenario B: local→remote $expand resolution
  |     |                               Batch-fetch + stitch (manual mapping needed here)
  |     |
  |     +-- cds-caching (optional)   -- Peer dependency: cache.rt.run() for response caching
  |
  +-- DataPipelineService         -- Service orchestrator for 'replicate' strategy (extends cds.Service)
  |     |
  |     +-- DataReplication[]        -- Per-replication execution engine
  |           |
  |           +-- Adapters           -- Source adapters (OData, REST, CQN, custom)
  |           |     +-- BaseAdapter
  |           |     +-- ODataAdapter   -- Uses projected columns for $select, rename for results
  |           |     +-- RestAdapter
  |           |     +-- CqnAdapter (new)
  |           |
  |           +-- EventEmitter       -- Hook system (before/on/after READ, MAP, WRITE)
  |           +-- ReplicationRequest -- Event context (data, stats, config)
  |
  +-- ManagementService              -- OData API for monitoring/control
  |
  +-- index.cds                      -- Aspect (replicated; federation-side), entities (Pipelines, PipelineRuns on the engine side)
```

### 5.3 Strategy Execution Flows

**Delegate (on READ):**
```
1. Intercept READ via service.prepend() -> on('READ', entity)
2. Connect to remote service: cds.connect.to(sourceService)
3. Forward query: remote.run(req.query)
   CAP's runtime automatically handles:
   - Resolve projection chain (e.g., ConsumerService.Products → consumer.Products → ProviderService.Products)
   - Translate $select/$filter/$orderby from local to remote field names (via `as` clauses)
   - Restrict $select to projected columns only (bandwidth optimization)
   - Forward $expand within the same remote service
   - Transform result structure back to consumer's schema
4. Return result (already in local field names)
```

**Delegate + cache (on READ):**
```
1. Intercept READ via service.prepend() -> on('READ', entity)
2. Connect to cds-caching: cds.connect.to('caching')
3. cache.rt.run(req, delegateHandler, { ttl, tags })
   - On HIT: return cached result (remote never called)
   - On MISS: call delegateHandler -> cache result -> return
```

**Replicate (scheduled):**
```
1. Acquire lock (set status = 'running', check concurrency)
2. Create ReplicationRun record
3. READ phase: Adapter.readStream() -> async generator of batches
4. MAP phase (per batch): field mapping + transformation hooks
5. WRITE phase (per batch): UPSERT into local entity + update statistics
6. Update tracker (lastSync, lastKey, statistics)
7. Release lock (set status = 'idle' or 'failed')
```

### 5.4 Dependency on `cds-caching`

`cds-caching` is an **optional peer dependency** used for the `cache` option on any strategy:
- If installed: cache wraps the entity's data access with TTL-based caching
- If not installed: cache option is silently ignored, warning logged once
- `cds-caching` handles the storage backend (in-memory, Redis, HANA, etc.), TTL, key management, and hit/miss statistics

Integration point in code:
```javascript
// In srv/delegation/handler-registration.js - delegate + cache
const cache = await cds.connect.to('caching')
const { result } = await cache.rt.run(req, delegateHandler, {
    ttl: options.cache.ttl || 60000,
    tags: options.cache.tags || []
})
return result
```

---

## 6. Comparison with Similar Tools

| Capability | cds-data-federation | CAP Built-in | @cap-js-community/common | cds-caching | Fivetran/Airbyte | SAP SLT |
|---|---|---|---|---|---|---|
| **Data Access** | | | | | | |
| Delegate (live proxy) | Yes | Manual code | No | No | No | No |
| Replicate into main DB | Yes (scheduled) | Manual code | No | No | Yes | Yes |
| Entity cache (separate store) | Yes (SQLite, `cds-data-pipeline`, `strategy: 'entity'`) | No | Yes (per-tenant SQLite) | No | No | No |
| Response cache (per query) | Yes (via `cds-caching`, default) | No | No | Yes | No | No |
| Native joins with local data | Yes (via replicate) | Manual | No | No | Yes | Yes |
| **Sync** | | | | | | |
| On-demand / lazy | Yes (`strategy: 'entity'` — first TTL-miss READ runs pipeline against secondary SQLite; also normal delegate always live) | No | Yes (first read triggers) | N/A | No | No |
| Scheduled | Yes (cron) | Manual | No | N/A | Yes | Yes |
| Delta / incremental | Yes (planned) | Manual | No | N/A | Yes (CDC) | Yes |
| Event-driven | Yes (messaging) | Manual | No | No | Webhooks | Real-time |
| **Caching** | | | | | | |
| TTL-based invalidation | Yes (`response` + `entity`) | No | Yes (entity cache) | Yes | N/A | N/A |
| Cache size limits / LRU | No | No | Yes | Depends on backend | N/A | N/A |
| Per-tenant cache isolation | Tenant column on SQLite + CAP context tenant; separate SQLite service supported | No | Yes (per-tenant SQLite) | Depends on backend | N/A | N/A |
| **Configuration** | | | | | | |
| CDS annotations | `@federation.*` | Manual | `@cds.replicate` | `@cache` | N/A | N/A |
| Field renames (consumption views) | Yes | Manual | No | N/A | Config-based | Config-based |
| Column restriction | Yes (via projection) | Manual | No | N/A | Config-based | Config-based |
| **Operational** | | | | | | |
| Custom transforms | Hook system | Code | No | No | dbt | ABAP |
| Multi-source | Yes (aspect) | No | No | N/A | Yes | Yes |
| Monitoring | OData API | None | Statistics logging | Metrics API | Dashboard | Dashboard |
| Retry / resilience | Yes (exponential backoff) | Manual | Yes (configurable retries) | N/A | Yes | Yes |
| Rate limiting | No | No | Yes (`@cds.rateLimiting`) | No | N/A | N/A |

---

## 7. Verification & Testing Strategy

Tests run against **real** local CAP providers -- not mocks. The test infrastructure includes multiple providers to cover protocol variants and multi-service mashups.

**Two parallel surfaces:**

- **`test/`** — Jest-driven. Correctness source of truth. In-memory SQLite, ephemeral providers started per run. Do not click here.
- **`examples/`** — manually runnable via `npm run examples:start`. Persistent SQLite, Fiori Elements UIs, launchpad. Use for exploratory validation and demos. See [`examples/README.md`](https://github.com/mikezaschka/cds-data/blob/main/examples/README.md) and feature 4.16.

### Test infrastructure

| Provider | Port | Protocol | Entities | Purpose |
|---|---|---|---|---|
| ProviderService (V4) | 4444 | OData V4 | Customers, Products, Orders | Primary delegation target |
| ProviderService (V2) | 4444 | OData V2 | Same as above | V2 protocol delegation testing (via `@cap-js-community/odata-v2-adapter`) |
| InventoryService | 4445 | OData V4 | Warehouses, StockLevels | Second provider for multi-service mashup |

### Test categories

| What | How |
|---|---|
| Delegate strategy (V4+V2 parameterized) | Same test suite runs against both V4 and V2 entity sets via parameterized test generator. Covers: basic READ, consumption view renames, entity-level rename, $filter (basic + operators + string functions incl. tolower/toupper), $orderby, $select, $top/$skip, $count, $expand Scenario A (delegate ↔ delegate, same provider) with $filter/$orderby/$top/$skip in expand for V4, combined parameters, error propagation |
| Navigation path $filter (V4 only) | $filter with renamed association paths, contains(), boolean, combined nav+local filters |
| Lambda operators (V4 only) | any/all on to-many associations; Scenario C lambda (delegate ↔ local) via resolveLocalLambdaFilters; Scenario B lambda (local ↔ delegate) via resolveRemoteLambdaFilters (cross-service query splitting) |
| $expand Scenario B (V4 only) | Local ↔ delegate batch-fetch + stitch, cross-provider (InventoryReports → product + warehouse; local ↔ delegate across multiple providers), $filter/$orderby in expand, nested expand with recursive rename mapping, excluding columns bandwidth restriction, composite key associations, to-many expand with array grouping + $top per-parent, lambda any() cross-service query splitting |
| $expand Scenario C (V4 only) | Delegate ↔ local: strip local expand, forward remote, query local, stitch. $filter/$orderby/$top (per-parent limiting) in expand |
| Cross-service navigation (V4 only) | N1 ([local → remote](../concepts/cross-service-scenarios.md#cross-service-navigation-local--remote), local ↔ delegate, Reviews/product), N2 ([remote → local](../concepts/cross-service-scenarios.md#cross-service-navigation-remote--local), delegate ↔ local, Customers/bookmarks), N3: nav+$select, N4: nav+$filter, N5: wildcard nav (Bookmarks/customer) |
| Consumption view patterns | Excluding columns (CustomersLight), static where clause (ActiveCustomers, ElectronicsProducts — plugin injects filter), flatten associations (OData limitation), higher-level flattened views (OData limitation), cross-service path expressions (limitation) |
| Multi-provider mashup | Queries spanning two independent providers; cross-provider Scenario B $expand (local ↔ delegate across multiple providers) |
| Mixed protocol | Same data queried via V4 and V2 in same test for consistency verification |
| CQL via application service (V4) | SELECT.one, .columns(), .where() (basic + nested), .orderBy(), .limit(), combined clauses, SELECT.distinct, entity-level renames, key shortcuts, projection functions, $expand via CQL (Scenarios A/B/C — delegate ↔ delegate / local ↔ delegate / delegate ↔ local), cds.ql tagged templates |
| CQL via V2-backed entities | SELECT.from, .where, .orderBy, combined clauses, $expand Scenario A (delegate ↔ delegate) via CQL on V2 entities |
| Delegate + cache | Hit/miss, TTL expiry, renames, static/dynamic tag invalidation, custom cache service, cache clear, $expand with cache (15 tests via cds-caching) |
| Replicate strategy | Test app replicating from OData services (existing pattern in `/test/`) |
| Annotation scanning | CDS model with both strategies; verify correct handler registration and persistence setup |
| $apply (aggregation) | **Not supported** — CAP rejects `.groupBy` for remote services ("Feature not supported: SELECT statement with .groupBy") |
| $search | Supported — CAP forwards `$search` to remote OData service; searches all string columns by default |
| Delta sync correctness | Modify source records between runs, verify only changes replicated |
| Concurrency guard | Attempt parallel runs, verify only one executes |
| Retry behavior | Mock transient failures, verify exponential backoff and resume |
| Management API | HTTP requests to OData service, verify tracker/run/stats data |
| Multi-source | Replicate same target entity from 2 sources, verify data integrity |
| Fallback | Delegate + cache serves stale data when remote fails |

---

## 8. Implementation History & Roadmap

### Completed Phases

| Phase | Completed | Key Deliverables |
|---|---|---|
| Phase 5 — Adapter Architecture | 2025-04 | Adapter factory, OData adapter (3 delta modes), REST adapter (pagination + delta), 8 tests (R22-R29) |
| Phase 4 — Replication End-to-End | 2025-03 | READ→MAP→WRITE pipeline, UPSERT writes, concurrency guard, MAP hooks, management API, 19 tests |
| Phase 3 — Test Infrastructure | 2025-02 | 3 real providers (V4, V2, Inventory), consumer app, consumption views, delegate + expand tests |
| Phase 2 — Stabilization | 2025-01 | UPSERT, retry with backoff, CSN ref parsing fix, cache as cross-cutting capability |
| Phase 1 — Foundation | 2025-01 | Rename to cds-data-federation, annotation scanner, delegate skeleton, CDS model rewrite |

### Upcoming: Phase 6 — Robustness

- CQN adapter (4.6.3)
- Entity ordering for referential integrity (4.5.5)
- Soft-delete propagation (4.4.5)
- Rate limiting (4.10.5) and circuit breaker (4.10.4)
- Stale lock detection (4.10.7)
- Schema evolution handling (4.10.11)

### Future: Phase 7 — Event-Driven & Advanced

- Event-driven single-record sync via transactional outbox + CAP messaging (4.8.3)
- OData delta token support (4.6.6)
- Dynamic destination override (4.8.6)
- Reconciliation mode (4.4.6)
- Cache-aside invalidation on write/replication (4.3.5)
- Dry-run mode (4.4.7)
- CAP telemetry integration (4.11.5)
- Fiori Elements monitoring UI (4.13.5)

---

## 9. References

### CAP Documentation
| Topic | URL | Relevant for |
|---|---|---|
| **Service Integration guide (CAP-Level Service Integration)** | https://cap.cloud.sap/docs/guides/integration/calesi | Delegate strategy, query translation, $expand across services, transactional outbox, CQN safety, mocking |
| **Data Federation** | https://cap.cloud.sap/docs/guides/integration/data-federation | `@federated` annotation, auto-persistence, replication patterns |
| **Remote Services** | https://cap.cloud.sap/docs/node.js/remote-services | `cds.connect.to()`, RemoteService API, query forwarding |
| **Using Services** | https://cap.cloud.sap/docs/guides/using-services | Service consumption, consumption views, `@cds.persistence.table` |
| **Messaging / Events** | https://cap.cloud.sap/docs/guides/messaging | CAP messaging, CloudEvents, transactional outbox |
| **CDS Plugins** | https://cap.cloud.sap/docs/plugins/ | `cds-plugin.js` pattern, auto-loading, config merging |

### Internal Concept Documents
| Topic | Path | Covers |
|---|---|---|
| **Cross-Service `$expand` and navigation** | [Cross-Service Scenarios](../concepts/cross-service-scenarios.md) | Delegated expand, cross-service expand (local → remote / remote → local / cross-provider), cross-service navigation (local → remote / remote → local), CQN expand structure, view mapping registry, caching integration, implementation phases |
| **Replication Cache Analysis** | [Replication Cache Analysis](../internal/research/replication-cache-analysis.md) | @cap-js-community/common deep dive, entity-level vs. response-level caching, enhanced comparison matrix, native entity caching design direction |
| **CAP Built-in Analysis** | [CAP Built-in Analysis](../internal/research/cap-builtin-analysis.md) | What CAP provides natively for federation, delegation, replication; manual code examples with references; gap analysis vs. cds-data-federation |

### Community & Examples
| Topic | URL | Relevant for |
|---|---|---|
| **cap-replication-demo** | https://github.com/gregorwolf/cap-replication-demo | Multi-source replication, event-driven sync, HANA vector embeddings, write-back |
| **@cap-js-community/common** | https://github.com/cap-js-community/common | `@cds.replicate` annotation, entity-level SQLite caching. See [Replication Cache Analysis](../internal/research/replication-cache-analysis.md) |
| **cds-caching** | https://github.com/mikezaschka/cds-caching | Cache integration, `cache.rt.run()` API, storage backends |
| **CAP Remote Services + Fiori Elements** (blog) | https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/ | Shows the manual approach our plugin replaces: custom RemoteService impl, manual response mapping, delegation-with-caching pattern. Three approaches (upfront loading, direct delegation, delegation+caching) map to our replicate, delegate, delegate+cache. |

### Industry Patterns
| Topic | URL | Relevant for |
|---|---|---|
| **Data Replication in Microservices** | https://www.serverion.com/uncategorized/ultimate-guide-to-data-replication-in-microservices/ | CDC patterns, conflict resolution, dead-letter queues, graceful degradation, security |
| **Debezium (CDC)** | https://debezium.io/documentation/reference/stable/architecture.html | Log-based change data capture, connector architecture |
| **Airbyte** | https://airbyte.com/data-engineering-resources/full-refresh-vs-incremental-refresh | Full vs incremental sync trade-offs |

### Key CAP APIs (quick reference)
| API | Purpose | Docs |
|---|---|---|
| `cds.connect.to(name)` | Connect to local or remote service | https://cap.cloud.sap/docs/node.js/cds-connect |
| `srv.run(query)` | Execute CQL query on service | https://cap.cloud.sap/docs/node.js/core-services#srv-run |
| `srv.send(method, path, data)` | Send request to service | https://cap.cloud.sap/docs/node.js/core-services#srv-send |
| `srv.emit(event, data)` | Emit async event | https://cap.cloud.sap/docs/node.js/core-services#srv-emit |
| `cds.outboxed(srv)` | Wrap service with transactional outbox | https://cap.cloud.sap/docs/node.js/outbox |
| `cds.ql.clone(query)` | Clone CQN query safely | https://cap.cloud.sap/docs/node.js/cds-ql#clone |
| `UPSERT.into(entity).entries(data)` | Idempotent create-or-update | https://cap.cloud.sap/docs/node.js/cds-ql#upsert |
| `cds.on('loaded', csn)` | Hook into model loading | https://cap.cloud.sap/docs/node.js/cds-server#lifecycle |
| `cds.once('served', ...)` | Hook after services bootstrapped | https://cap.cloud.sap/docs/node.js/cds-server#lifecycle |
| `service.prepend(fn)` | Register handler before defaults | https://cap.cloud.sap/docs/node.js/core-services#srv-prepend |
