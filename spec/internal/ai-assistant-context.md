# AI Assistant Context (deep)

This page is the detailed counterpart to [`CLAUDE.md`](https://github.com/mikezaschka/cds-data/blob/main/CLAUDE.md). Start there for the mental model, terminology, and the "don'ts" list. This page covers:

- [Architecture](#architecture) — module tree, plugin lifecycle, CAP-native vs. plugin value-add.
- [Test architecture](#test-architecture) — providers, test file layout, test categories.
- [Example apps](#example-apps) — the movies launchpad, its role, and the maintenance checklist.
- [Conventions](#conventions) — expanded rationale for the summary entries in `CLAUDE.md`.
- [CDS quirks](#cds-quirks-to-know-about) — the surprises you need to know about.
- [CQL-on-OData limitations](#cql-features-not-supported-on-odata-remote-services) — what `cds.ql` cannot do against delegate entities.
- [Internal research, ADRs, plans](#internal-research) — links into `spec/internal/`.

Facts here are not repeated in `CLAUDE.md`, nor in [`spec/concepts/`](../concepts/) or [`docs/reference/`](../reference/). If a topic has a canonical doc in `spec/concepts/` or `docs/reference/`, this page links to it rather than restating it.

---

## Architecture

```
cds-plugin.js                      Entry point. Lifecycle hooks:
                                     cds.on('loaded')  → scanAnnotations()
                                     cds.once('served')→ registerFederationHandlers()

srv/
  annotation-scanner.js            Scans CSN for @federation.* annotations.
                                   Returns { configs, viewMappingRegistry }.
                                   Filters out derived service-level projections
                                   (whose source entity already carries @federation.*)
                                   to prevent duplicate configs and keep service
                                   projections emitting as views instead of tables.
                                   viewMappingRegistry is only needed for cross-service
                                   expand: local → remote (local→remote $expand resolution).

  delegation/                      Delegate strategy — functional modules, no classes.
    index.js                       Orchestration: registerFederationHandlers().
                                   Builds per-service federatedMap, defers handler
                                   registration, wires local→remote expand resolvers.
    service-resolution.js          findServingService(), findEntityNameInService().
    handler-registration.js        registerDelegateHandler(), registerCachedDelegateHandler().
                                   Uses CAP-native remote.run(req.query) — CAP handles
                                   all query translation and result mapping automatically.
                                   Wraps with cds-caching when cache option is set.
    expand-local-to-remote.js      Cross-service expand: local → remote.
                                   Batch-fetch + stitch for local→remote $expand.
                                   Supports composite keys, to-many (array grouping),
                                   nested expand, excluding columns, $top/$skip per-parent.
                                   Also wires remote navigation + lambda filter resolution.
    expand-remote-to-local.js      Cross-service expand: remote → local.
                                   buildLocalAssocInfo(), splitLocalExpands(),
                                   resolveRemoteToLocalExpands().
    lambda-filters.js              Cross-service expand: remote → local filters:
                                   resolveLocalLambdaFilters().
                                   Pre-resolves local lambda/exists against local DB.
    navigation-translation.js      buildAssocTargetMappings(), translateNavigationFilters().
                                   Translates renamed assoc names in $filter nav paths.
    remote-navigation-filters.js   Cross-service expand: local → remote filters:
                                   resolveRemoteNavigationFilters(). Pre-resolves
                                   cross-service nav path filters by querying remote,
                                   rewriting to FK IN on local table.
    cross-service-navigation.js    Cross-service navigation (4.2.12):
                                   resolveLocalToRemoteNavigation() for local → remote,
                                   rewriteRemoteToLocalNavigation() for remote → local.
                                   Both directions assume the remote side is
                                   @federation.delegate; the local side may be a plain
                                   local entity or @federation.replicate (indistinguishable
                                   at query time). Canonical reference:
                                   ../concepts/cross-service-scenarios.md
    remote-query.js                containsLambda(), runDirectRemoteQuery(),
                                   propagateRemoteError().
                                   Direct remote query bypass for lambda/staticWhere cases.
    paged-remote-query.js          runPagedRemoteQuery(remote, query, { pageSize, maxPages }).
                                   Auto-loops remote $top/$skip until the client's rows
                                   are satisfied or the remote returns empty. Preserves
                                   @odata.count from the first batch.

  entity-cache/                    ADR 0010 — `cache.strategy: 'entity'`.
    EntityCacheDbResolver.js       Per-tenant SQLite file resolution + deploy.
    entity-cache-binding.js        Binds pipelines; passes tenant via execute opts.
    cache-schema.js / query-rewrite.js

  multitenancy/                    MTX integration (4.15).
    tenant-provider.js             listSubscribedTenants() for scheduler fan-out.
    mtx-hooks.js                   Optional subscribe/unsubscribe hooks.
    resolve-request-tenant.js      Tenant from req.user / auth.users / context.

  DataPipelineService.js        Orchestrates pipeline execution (packages/cds-data-pipeline/srv/).
                                   Extends cds.Service. addPipeline({ kind, ... }) / run() /
                                   scheduleJobs(). Registers a single
                                   on('PIPELINE.{READ,MAP,WRITE}') router that dispatches
                                   to per-pipeline default handlers kept in internal
                                   _defaults maps. `kind` is required (ADR 0005).
  pipeline-service.cds             Stub service definition (`service DataPipelineService;`)
                                   so CAP auto-wires the JS implementation and
                                   `cds.connect.to('DataPipelineService')` works.

  lib/
    Pipeline.js                    Per-pipeline execution engine.
                                   Concurrency guard via optimistic UPDATE on Pipelines table.
                                   READ → MAP → WRITE pipeline dispatched through
                                   cds.Service: constructs cds.Request instances and
                                   calls srv.dispatch(req); user hooks compose via
                                   CAP's native before → on → after chain.
    retry.js                       withRetry() utility — exponential backoff + jitter,
                                   skip 4xx by default.

  adapters/
    factory.js                     createAdapter(config) — auto-selects adapter by service kind.
    BaseAdapter.js                 Abstract contract: readStream(tracker) async generator.
    ODataAdapter.js                OData v2/v4. CQL batch reads with delta modes
                                   (timestamp/key/datetime-fields), viewMapping column
                                   restriction, withRetry.
    RestAdapter.js                 REST. srv.send() with pagination (cursor/offset/page),
                                   deltaParam URL filtering, dataPath extraction, withRetry.

  DataPipelineManagementService.cds/.js
                                   OData service at /pipeline exposing Pipelines +
                                   PipelineRuns plus run/flush/status actions. Lives in
                                   packages/cds-data-pipeline/srv/.

packages/cds-data-pipeline/db/index.cds
                                   Engine CDS model:
                                   - types:    PipelineKind, ReplicationMode, RunStatus, RunTrigger
                                   - entities: Pipelines (with kind), PipelineRuns
                                   namespace: plugin.data_pipeline

packages/cds-data-federation/index.cds
                                   Federation-side CDS:
                                   - aspect replicated (lastReplicatedAt/By)
                                   namespace: plugin.data_federation
```

### Plugin lifecycle

```
cds.on('loaded', csn)
  └─ scanAnnotations(csn)
       ├─ for each entity with @federation.delegate or @federation.replicate:
       │    ├─ resolve source: explicit options.source (REST) or infer from projection (OData)
       │    ├─ verify source is kind:'service' (skip for explicit REST sources)
       │    ├─ for replicate: set @cds.persistence.table + skip:false
       │    └─ extract viewMapping (projectedColumns + localToRemote + remoteToLocal + excludedColumns + staticWhere)
       └─ return { configs, viewMappingRegistry }

cds.once('served')
  ├─ registerFederationHandlers(nonReplicateConfigs, viewMappingRegistry)
  │    ├─ for each delegate config:
  │    │    ├─ findServingService() — match by app-service kind, by entity ref
  │    │    └─ registerDelegateHandler() on that service
  │    └─ registerLocalExpandResolvers() for each service:
  │         └─ for each LOCAL entity with associations to federated entities,
  │            register on('READ') that splits federated $expand items, fetches
  │            local data, batch-fetches federated data, stitches results
  └─ for each replicate config:
       └─ DataPipelineService.addPipeline()
```

### CAP native delegation vs. plugin value-add

CAP's runtime **automatically handles** the full query translation pipeline when you
call `remote.run(req.query)` on a consumption view projection chain. This is documented
in the [Service Integration guide under "Automatic Query Translation"](https://cap.cloud.sap/docs/guides/integration/calesi#delegation)
and demonstrated in SAP's [xtravels sample](https://github.com/capire/xtravels):

```js
this.on('READ', Customers, req => s4.run(req.query))
```

**What CAP does natively** (no plugin code needed):

- Column rename translation in `$select`, `$filter`, `$orderby` (via `as` clauses in the CDS projection)
- Column restriction to projected fields only (bandwidth optimization)
- `$expand` forwarding within the same remote service (**Delegated expand**)
- Result structure transformation back to the consumer's local schema
- `$count`, `$top`, `$skip` passthrough

**What this plugin adds on top:**

1. **Declarative handler registration** — annotate `@federation.delegate` and the `on('READ')` handler is registered automatically. Compare with SAP's [risk-management sample](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js), which requires ~100 lines of manual handler code for the same patterns.
2. **Navigation path filter translation** — CAP does not translate renamed association names in `$filter` navigation paths (e.g., `buyer/name` where `buyer` is renamed from `customer`). `translateNavigationFilters()` pre-translates these before forwarding.
3. **Cross-service expand: local → remote** — when a local entity has an association to a federated entity and the client requests `$expand`, CAP cannot resolve this across service boundaries. `registerLocalExpandResolvers()` strips federated expand items, executes the local query, batch-fetches remote data in a single call, and stitches results.
4. **Cross-service expand: remote → local** — when a federated entity has a backlink association to a local entity, the plugin strips local expand items, forwards the remote query, queries local data separately, and stitches. Unlike the risk-management sample's manual handler, this works for both single records and lists.
5. **Static `where` clause in projections** — CAP's [old "Consuming Services" docs](https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features) explicitly list `where` conditions as **not supported** for remote services. The plugin extracts `projection.where` at model load and injects it via `runDirectRemoteQuery()`.
6. **Optional response caching** via `cds-caching` with per-entity TTL configuration.

### Delegate handler (simplified)

```
GET /consumer/Products?$filter=unitPrice gt 100
       │
       ▼
ConsumerService.on('READ', 'Products', handler)  ◀── registered by plugin
       │
       └─ remote.run(req.query)
            CAP resolves the projection chain automatically:
              ConsumerService.Products → consumer.Products → ProviderService.Products
            Translates: unitPrice → price in $filter, $select, $orderby
            Maps results back: price → unitPrice
            Restricts $select to projected columns only
```

### Cross-service expand: local → remote (simplified)

```
GET /consumer/Reviews?$expand=product   (Reviews is local, Products is delegated)
       │
       ▼
LocalExpandResolver on('READ', 'Reviews', handler)
       │
       ├─ inspect req.query.SELECT.columns for federated expand items
       ├─ split: stripped expand items + remaining columns + required FK columns
       ├─ next() → execute local SQL (without the broken expand)
       │
       └─ for each stripped expand:
            └─ resolveFederatedExpand(records, expandItem, assoc)
                 ├─ collect distinct FK values
                 ├─ remote.run(SELECT ... WHERE remoteKey IN (fkValues))  ← single batch call
                 ├─ map remote field names to local
                 └─ stitch each remote record into rec[assocName]
```

See [`spec/concepts/cross-service-scenarios.md`](../concepts/cross-service-scenarios.md) for the canonical reference with all three expand directions and both navigation directions.

---

## Test architecture

Tests run against **real** local CAP providers — not mocks. Three test apps plus the consumer.

### Protocol support for delegation

| Protocol | `cds.requires` kind | Delegation support | Notes |
|---|---|---|---|
| OData V4 | `odata` | Full | CAP-native CQN translation. Default. |
| OData V2 | `odata-v2` | Full | CAP-native CQN translation. V2 returns decimals/counts as strings. |
| HCQL | `hcql` | Full | CAP-native protocol (xtravels sample). |
| REST | `rest` | **Not supported** | CAP does not translate CQN to REST. Use `@federation.replicate` + RestAdapter. |

### Test harness (package-local)

There is **no** root `test/` tree. Each npm workspace owns fixtures and specs:

| Package | Path | README |
|---|---|---|
| `cds-data-pipeline` | [`packages/cds-data-pipeline/test/`](../../packages/cds-data-pipeline/test/) | [`test/README.md`](../../packages/cds-data-pipeline/test/README.md) |
| `cds-data-federation` | [`packages/cds-data-federation/test/`](../../packages/cds-data-federation/test/) | [`test/README.md`](../../packages/cds-data-federation/test/README.md) |

Fixture OData/REST servers use **dynamic ports** (`test/support/setup.js` in each package). `beforeAll` must call `startProvider()` (and siblings) **before** `cds.test(...)` in integration specs so `cds.env.requires` URLs are patched first.

Federation integration tests are split by scenario under `test/integration/` (`delegate/`, `expand-local-to-remote/`, `caching/`, `cud/`, …). Engine replicate/adapter depth lives only under `cds-data-pipeline/test/integration/`.

Tests that map 1:1 to a requirement use the `it('[<id>] ...')` prefix. Index: [`spec/reference/test-mapping.md`](../reference/test-mapping.md) — regenerate with `npm run sync:requirements`.

Run from the monorepo root:

```bash
npm test                              # both workspaces, serial
npm run test -w cds-data-pipeline
npm run test -w cds-data-federation
npm run test -w cds-data-federation -- --testNamePattern "\\[4\\.2\\.5\\] B4"
```

---

## Example apps

[`examples/`](https://github.com/mikezaschka/cds-data/tree/main/examples) holds **manually runnable** demo apps complementary to `test/`. Same federation patterns, but:

- Persistent SQLite (`examples/consumer/db.sqlite`) so clicks through the UI persist across restarts.
- Fiori Elements UIs + a `sap.ushell` sandbox launchpad so features are clickable, not just query-able.
- Startable via `npm run examples:start` (wraps `examples/start-all.sh`).

### Structure

```
examples/
  provider/                  :4444 — Studio provider
                               ProviderService V4 (Movies, Genres, Directors, Actors, Castings)
                               LicensingService V2 (Titles, TerritoryLicenses)
  inventory/                 :4445 — Streaming CDN
                               StreamingService V4 (Regions, StreamingManifests)
  rest-provider/             :4446 — Box-office REST (offset pagination + modifiedSince delta)
  consumer/                  App under test on :4004
    db/schema.cds            movie-themed consumption views + local entities
    srv/consumer-service.cds service exposing delegate/cached/replicate entities
    srv/consumer-service-ui.cds   UI.LineItem/HeaderInfo/Facets/FieldGroup annotations
    srv/external/*.csn       regenerated from provider+inventory via examples/regen-csn.js
    app/
      launchpage.html        sap.ushell sandbox shell
      _generate-fe-apps.js   regenerates the FE app skeletons
      <entity>/webapp/       one FE List Report / Object Page per entity
      (pipeline monitoring is the plugin's Pipeline Console at /pipeline-console/ via management.reuse.console — no local FE app)
  regen-csn.js               recompiles provider + inventory + licensing into external CSN
  start-all.sh               starts all four servers; Ctrl+C stops everything
```

### Feature-to-entity mapping

| Capability | Entity |
|---|---|
| Delegate wildcard read-only | `Movies`, `Genres` |
| Delegate writable (full CUD) | `Actors` |
| Delegate selective writable (update only) | `Directors` |
| Delegate + field renames | `Films` |
| Delegate + entity rename + V2 | `LicensedMovies` |
| Delegate + static `where` | `AwardWinningMovies` |
| Delegate + `excluding` | `MoviesLight` |
| Cached delegate | `TrendingMovies` (TTL 60s) |
| Second-provider delegate | `StreamingManifests`, `Regions` |
| Replicate V4 | `ReplicatedMovies` |
| Replicate REST | `ReplicatedBoxOffice` |
| Local + cross-service expand: local → remote (`$expand=movie`) | `Watchlists`, `Reviews`, `Bookmarks` |
| Cross-service expand: remote → local (`Movies(...)/reviews`) | `Movies.reviews` / `Movies.bookmarks` backlinks |

### Role: showcase, not source of truth

Package tests remain the correctness source of truth. `examples/` is for **manual exploration** and demos. The consumer model intentionally gives every federation pattern *one* obvious showcase — don't pile additional variants onto the same entity. Features that expand the test matrix don't always need a new tile.

### Maintenance checklist

When a new **user-visible** feature lands (new annotation option, new adapter, new query capability surfaced through OData, new management action), update `examples/consumer`:

1. Add or adjust the consumption view in `examples/consumer/db/schema.cds`.
2. Expose it in `examples/consumer/srv/consumer-service.cds`.
3. If the entity is visible in the UI, add or update `UI.LineItem` / `UI.HeaderInfo` / `UI.FieldGroup` annotations in `examples/consumer/srv/consumer-service-ui.cds`.
4. If a new FE app is warranted, edit `examples/consumer/app/_generate-fe-apps.js` (append an entry), rerun `node examples/consumer/app/_generate-fe-apps.js`, and add a tile in `examples/consumer/app/launchpage.html`.
5. If you changed provider/inventory schemas, rerun `npm run examples:regen-csn` so the consumer's external CSN snapshots are up to date.
6. Verify `npm run examples:start` boots cleanly and the affected tile renders.

This is enforced in [`.claude/commands/implement-feature.md`](https://github.com/mikezaschka/cds-data/blob/main/.claude/commands/implement-feature.md) Phase 5 and covered by the `/review` checklist. The launchpad is the user-facing showcase — a broken tile or missing demo for a documented feature is as bad as broken docs.

### Regenerating FE apps

The 8 Fiori Elements apps have an identical shape and are generated from a single config by `app/_generate-fe-apps.js`. To add, rename, or remove an app, edit the `APPS` array in that script and rerun it.

---

## Conventions

The short-form versions live in [`CLAUDE.md`](https://github.com/mikezaschka/cds-data/blob/main/CLAUDE.md) §Conventions. Expanded rationale and edge cases follow.

### Annotation naming

- `@federation.delegate` and `@federation.replicate` (not `@cds.federated` — reserved for SAP).
- Strategies are explicit annotation names, not options on a single annotation. Easier to scan visually in CDS models.
- Cache is an **option** on either annotation, never a strategy of its own: `@federation.delegate: { cache: { ttl: 60000 } }`.

### CUD opt-in (write capabilities)

- Default is **read-only** (safe). The scanner enforces `@readonly` on delegate entities without write flags; partially writable entities register explicit 405 rejection handlers for disabled operations.
- `writable: true` enables all three operations (CREATE, UPDATE, DELETE).
- Individual `create`, `update`, `delete` flags for selective control. Individual flags **override** `writable` when both are present.
- Resolution: `create = options.create ?? options.writable ?? false` (same for update/delete). `resolveWriteFlags()` in `annotation-scanner.js` implements this.
- **Why read-only by default:** SAP's [xtravels](https://github.com/capire/xtravels) reference app marks all remote entities `@readonly` (Customers from S/4, Flights/Supplements from xflights). Remote data is reference data — write capability is a deliberate design choice, not a default.
- **CUD is synchronous, not outboxed:** CUD forwarding uses `remote.run(req.query)` directly. The client expects the remote's response (201 / 200 / 204). `cds.outboxed()` defers execution and returns no result — it breaks OData's request/response contract. Use the outbox only for fire-and-forget side effects (business event notification, cache invalidation, background sync). xtravels uses `cds.outboxed(xflights)` only for the `BookingCreated` domain event, never for CUD proxy.

### Annotations only on consumption views

`@federation.delegate` and `@federation.replicate` are valid **only on a CDS projection of the form `entity X as projection on remote.Y`**. The projection is the federation contract: source service, source entity, projected columns, and bidirectional rename mapping are all inferred from it by `buildConfigFromAnnotation()` in `srv/annotation-scanner.js`.

What this rules out:

- **Annotating an imported service entity directly** (`annotate ReviewsService.Reviews with @federation.delegate;`) — no projection, so no inferred columns or renames. Always wrap in a consumption view.
- **Plain entities as federation targets** — any entity without `as projection on <remoteService>.<remoteEntity>` is skipped.

The one escape hatch is explicit `options.source`, and it is **only** for REST services that have no CDS model:

```cds
@federation.replicate: {
    source: 'RestProvider',
    rest: { path: '/api/customers', pagination: { type: 'offset', pageSize: 100 } }
}
entity ReplicatedRestCustomers { key ID: String(10); name: String(100); ... };
```

Do **not** use `options.source` as a general workaround for OData — it bypasses source inference and skips viewMapping extraction (which is needed for cross-service expand: local → remote, renames, and column restriction).

### CQN safety

- Always use `cds.ql.clone(query)` before modifying a CQN object. The query is shared across the request pipeline; in-place mutation causes nondeterministic bugs.
- The delegate handler passes `req.query` directly to `remote.run()` — CAP handles translation internally without mutating the original query.

### Replication pipeline events

- Pipeline phases are dispatched as `PIPELINE.READ`, `PIPELINE.MAP`, `PIPELINE.WRITE` — never `READ`/`WRITE` alone (those are CAP's CRUD aliases).
- Register hooks via the standard CAP API: `srv.before/on/after(event, replicationName, handler)`.
- `before` and `on` hooks receive `(req)`. `after` hooks receive `(results, req)` per CAP convention — for non-READ events `results` is usually `undefined`, so mutate state on the second arg.
- Multiple hooks for the same `(event, path)` run in parallel via `Promise.all`. For ordering, use `srv.prepend(() => srv.before(...))`.
- `DataPipelineService.run()` is overloaded: `run(name, mode?, trigger?)` triggers a replication; `run(fn)` / `run(query)` falls through to `cds.Service`'s transactional wrapper (required so `srv.dispatch()` works). When extending the service, preserve this overload.

### Idempotency

- Replicate writes use `UPSERT.into(entity).entries(records)` (CQL, supported on SQLite + HANA).
- Never the SELECT-then-INSERT/UPDATE pattern. The original prototype had bugs from this; UPSERT eliminates them.

### Retry

- Use `withRetry(fn, { maxRetries, baseDelay, retryOn })` from `srv/lib/retry.js`.
- `retryOn` defaults to "skip 4xx, retry everything else". Don't retry auth failures (401/403) or bad requests (400).

### Concurrency

- Pipeline jobs use optimistic locking via UPDATE on the `Pipelines` tracker table:
  ```js
  UPDATE("plugin_data_pipeline_Pipelines").set({ status: 'running' })
    .where({ name, status: { '!=': 'running' } })
  ```
- If `affectedRows === 0`, another run is in progress — return early, don't queue.

### Error handling

- Surface remote service errors with context (HTTP status, remote entity name).
- Don't swallow errors silently. Use `LOG.warn` or `LOG.error` with `cds.log('cds-data-federation')`.

### Logging

- Use `cds.log('cds-data-federation')` consistently. Never `console.log`.
- `LOG.debug` for verbose details (annotation matches, handler registrations).
- `LOG.info` for one-time summary ("Discovered 3 @federation.* entities").
- `LOG.warn` for unexpected-but-recoverable (e.g., `cds-caching` missing → fall back to delegate).
- `LOG.error` for failures.

### Documentation: low-redundancy rule

A given fact lives in exactly one place; other surfaces cross-reference. This is what keeps `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/project.mdc` functioning as thin pointers instead of drifting into inconsistent mini-books.

**The only allowed exception is internal ↔ external duplication.** Internal (this file, `spec/internal/**`) and external (`README.md`, `spec/concepts/**`, `examples/**`) docs serve different audiences and are allowed to restate each other. Within the internal world and within the external world, duplication is a bug.

How this shapes contributions:

- **Requirement text** lives in `spec/reference/requirements.md`. ADRs, ideas, and concept docs link to requirement IDs; they never restate the requirement body.
- **Scenario names and definitions** live in `spec/concepts/cross-service-scenarios.md`. Tests, ADRs, and code comments reference the canonical name; they never redefine it. See [`spec/concepts/terminology.md`](../concepts/terminology.md) for delegation / replication / federation definitions — same rule applies.
- **Conventions** have a short-form pointer in `CLAUDE.md` §Conventions and the expanded rationale in this file's `## Conventions` section. Don't split a convention across three surfaces; extend one of these two.
- **Architecture diagrams and flowcharts** live in this file's "Delegate handler (simplified)" / "Cross-service expand" sections and in `spec/concepts/**`. Never inline the same diagram in an ADR — link to the section.
- **MCP usage instructions** live in [`CLAUDE.md`](../../CLAUDE.md#mcp-servers) (summary) and in the individual command files (`.claude/commands/fix-bug.md` Phase 2, `.claude/commands/discuss-architecture.md` Phase 1). Do not also document them in workflow READMEs.

The [`/review`](../../.claude/commands/review.md) command enforces this mechanically (Req-5). The [`/brainstorm`](../../.claude/commands/brainstorm.md) and [`/deprecate`](../../.claude/commands/deprecate.md) commands end with reminders to link rather than quote.

---

## CDS quirks to know about

- **CSN `ref` arrays** can be either `["Service.Entity"]` (single dot-separated) or `["Service", "Entity"]` (segmented). Always join then split, e.g., `ref.join('.').split('.')`.
- **`@cds.persistence.skip`** on projections: if extending an external entity, you must explicitly set this to `false` to get a local table. The annotation scanner does this automatically for `@federation.replicate`.
- **Annotations propagate to service projections** — when `ConsumerService.X as projection on consumer.X` is compiled, `@federation.*` (and all other annotations) are inherited onto the service entity. Without filtering, the scanner would process the service-level projection a second time, registering a duplicate replication config *and* forcing `cds deploy` to emit the service entity as a standalone table instead of a view over the real data. `scanAnnotations` guards against this by checking whether an entity's direct projection source already carries `@federation.*` and skipping such derived surfaces.
- **`$expand` is embedded in `req.query.SELECT.columns`** as objects with `.expand` property — NOT a separate property on SELECT. Filter columns by `.expand` to find them.
- **`service.prepend(fn)`** registers a handler that runs BEFORE existing handlers. Required so the federation handler runs before CAP's default DB dispatcher.
- **`cds.connect.to(name)`** with `kind: 'odata'` requires `@sap-cloud-sdk/http-client` and `@sap-cloud-sdk/resilience` as devDependencies.
- **`cds.test()` and Jest workspaces** — `cds.test()` must be called at module top-level (not inside `beforeAll`). Two test files calling `cds.test()` with the same path can conflict; run them separately or use `--testPathPattern`.

### CQL features not supported on OData remote services

When using `cds.ql` against `@federation.delegate` entities, the CQL query is translated to an OData URL by CAP's `cqn2odata` serializer. Several CQL features have no OData equivalent and will fail:

| CQL Feature | Error | Workaround |
|---|---|---|
| `.where({ field: { like: '%X%' } })` | `Parsing URL failed ... Expected "eq", "ge", ...` — OData `$filter` has no `like` keyword | Use OData string functions via HTTP URL: `$filter=contains(name,'X')`, `startswith(...)`, `endswith(...)`. No CQL QBE equivalent exists for these functions. |
| `SELECT.distinct.from(...)` | `Feature not supported: SELECT statement with .distinct` — CAP explicitly rejects it | Use `$apply=groupby((field))` via HTTP URL, or deduplicate in application code. |
| `.groupBy()` / `.having()` / `$apply` | `Feature not supported: SELECT statement with .groupBy` — CAP rejects for remote services. `$apply` via HTTP URL also fails (CAP parses it into `.groupBy` internally). | Aggregate in application code, or use a replicated entity with local SQL. |
| `forUpdate()` / `forShareLock()` | Locking is a database concept | Use ETags for optimistic concurrency on OData services. |
| `pipeline()` / `stream()` / `foreach()` | Only implemented by `DatabaseService` | Fetch full result set and iterate in memory. |

These are **CAP platform limitations** when routing CQL to OData, not plugin-specific issues. All standard CQL features (`SELECT.one`, `.columns()`, `.where()` with eq/ne/gt/ge/lt/le/in/and/or, `.orderBy()`, `.limit()`, projection functions, `$expand` via nested projections, `cds.ql` tagged templates) work correctly through the delegation pipeline.

---

## Internal research

Background investigations that shaped the design:

- [CAP Built-in Analysis](research/cap-builtin-analysis.md) — what CAP offers natively for federation / delegation / replication and the manual patterns this plugin automates.
- [Replication Cache Analysis](research/replication-cache-analysis.md) — deep dive on `@cap-js-community/common`'s Replication Cache.
- [Change Tracking Analysis](research/change-tracking-analysis.md) — whether `@cap-js/change-tracking` adds value for delegate / replicate strategies, and where it genuinely complements the plugin.

## Architectural decisions

- [ADR 0001 — Replication Service extends `cds.Service`](decisions/0001-replication-service-extends-cds-service.md)

## Completed plans

- [Migrate replication service to `cds.Service`](plans/completed/migrate-replication-service-to-cds-service.md)
