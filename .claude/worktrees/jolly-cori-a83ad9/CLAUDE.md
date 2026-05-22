# cds-data-federation — AI Assistant Context

This file is the entry-point context for AI assistants (Claude in Cursor, Claude Code, etc.) working on this project. Read it first before making changes.

---

## What this project is

**`cds-data-federation`** is a SAP CAP plugin that automates data integration with remote services. Two strategies, declared via CDS annotations:

| Annotation | Behavior |
|---|---|
| `@federation.delegate` | Transparent live proxy: reads forwarded to remote. Writes (CUD) opt-in via annotation flags; read-only by default. |
| `@federation.replicate` | Scheduled sync: copies remote data into the local database for offline access, analytics, full SQL. |

Both strategies support optional response caching via `cds-caching` (peer dependency).

The plugin started as `cds-data-replication` (a replication-only prototype) and evolved into a federation toolkit. The git folder is still `cds-data-replication` for historical reasons; the npm package and namespace are `cds-data-federation` / `plugin.data_federation`.

---

## Terminology

**"Federation" in this plugin** means: integrating remote service models into the consumer's data model and providing strategies for how that remote data is accessed at runtime. The consumption view (`entity X as projection on remote.Y`) is the federation contract — it declares *what* remote data participates. The `@federation.*` annotation declares *how* it is accessed (delegate, replicate, optionally cached).

This follows the **broader industry definition** of data federation:

> "Data Federation is a data management technique that makes multiple data sources appear as a single one." — Denodo

It intentionally diverges from **CAP's narrower usage**, where "data federation" specifically means replicating remote data into local tables for "close access" (SQL joins), and "delegation" is a separate sibling concept (live forwarding). In CAP's CaLeSi guide, the "Integration Logic" section lists Data Federation, Delegation, Navigation, and Expands as peer patterns under the umbrella of "Integration."

Our plugin collapses delegation and federation into one annotation namespace because, from the developer's perspective, the intent is the same: "I need this remote entity's data available in my application." The strategy choice is a runtime concern.

| Term | CAP (CaLeSi) meaning | Plugin meaning | Alignment |
|---|---|---|---|
| **Integration** | Umbrella: all remote service work | Not used as primary term | OK — plugin sits under integration |
| **Federation** | Replication for local "close access" | Umbrella: delegate + replicate + cache | Intentionally broader (industry convention) |
| **Delegation** | Live forwarding: `req => remote.run(req.query)` | `@federation.delegate` | Aligned |
| **Navigation** | Path expressions traversing associations (e.g., `buyer/name`) | `translateNavigationFilters()` | Aligned |
| **Replication** | Mechanism: copy remote data to local DB | `@federation.replicate` | Aligned |
| **Expand** | `$expand` across service boundaries | Scenarios A (remote→remote), B (local→remote), C (remote→local) | Aligned |
| **Caching** | No CAP-native concept | Cross-cutting option via `cds-caching` | No conflict |

For the full analysis, see [`docs/concepts/terminology.md`](./docs/concepts/terminology.md).

---

## Core concept: consumption views

The CDS projection IS the federation contract. The `@federation.*` annotation declares **runtime behavior**; the projection declares **schema** (what fields, what shape, what renames).

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

// 1. Wildcard — all fields, no renames (simplest case)
@federation.delegate
entity Customers as projection on remote.Customers;

// 2. Column restriction + field renames
//    Remote: ID, name, category, price, currency, stock, modifiedAt (7 fields)
//    Local:  productId, productName, category, unitPrice, currency   (5 fields)
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,      // rename: remote `ID` → local `productId`
    name  as productName,    // rename
    category,                 // keep
    price as unitPrice,      // rename
    currency
    // remote fields `stock`, `modifiedAt` are NOT projected → never fetched
};

// 3. Field + association renames
//    Enables remote→remote $expand: $expand=buyer translates to $expand=customer
@federation.delegate
entity Orders as projection on remote.Orders {
    ID        as orderId,
    customer  as buyer,      // rename association
    product   as item,       // rename association
    quantity,
    total     as amount,
    status,
    orderDate as placedOn,
    modifiedAt
};

// 4. Entity-level rename — same remote data, different local purpose
//    Remote "Customers" → local "Suppliers"
//    In a procurement context, the same companies are "suppliers" not "customers"
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID      as supplierId,
    name    as companyName,
    city    as headquarters,
    country as region,
    email   as contactEmail
};
```

The test consumer model demonstrates four distinct consumption view patterns. From each, the plugin infers:
- **Source service / entity** from the `projection on remote.X` clause
- **Projected columns** for `$select` restriction (bandwidth optimization)
- **Bidirectional rename mapping** (`localToRemote` / `remoteToLocal`) from `as` clauses
- **Strategy** from the annotation name

A delegate query against `Products` translates `$filter=unitPrice gt 100` to `$filter=price gt 100` on the remote, then maps `price` → `unitPrice` in the response. A query against `Suppliers` translates `$filter=companyName eq 'Acme'` to `$filter=name eq 'Acme'` on the remote Customers entity.

**Principle:** "The consumption view is the schema contract. The annotation is the runtime behavior."

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
                                   viewMappingRegistry is only needed for Scenario B
                                   (local→remote $expand resolution).

  delegation/                      Delegate strategy — functional modules, no classes.
    index.js                       Orchestration: registerFederationHandlers().
                                   Builds per-service federatedMap, defers handler
                                   registration, wires Scenario B expand resolvers.
    service-resolution.js          findServingService(), findEntityNameInService().
    handler-registration.js        registerDelegateHandler(), registerCachedDelegateHandler().
                                   Uses CAP-native remote.run(req.query) — CAP handles
                                   all query translation and result mapping automatically.
                                   Wraps with cds-caching when cache option is set.
    expand-local-to-remote.js      Scenario B: registerLocalExpandResolvers().
                                   Batch-fetch + stitch for local→remote $expand.
                                   Supports composite keys, to-many (array grouping),
                                   nested expand, excluding columns, $top/$skip per-parent.
                                   Also wires remote navigation + lambda filter resolution.
    expand-remote-to-local.js      Scenario C: buildLocalAssocInfo(), splitLocalExpands(),
                                   resolveRemoteToLocalExpands().
                                   Remote→local $expand resolution.
    lambda-filters.js              Scenario C filters: resolveLocalLambdaFilters().
                                   Pre-resolves local lambda/exists against local DB.
    navigation-translation.js      buildAssocTargetMappings(), translateNavigationFilters().
                                   Translates renamed assoc names in $filter nav paths.
    remote-navigation-filters.js   Scenario B filters: resolveRemoteNavigationFilters().
                                   Pre-resolves cross-service nav path filters by
                                   querying remote, rewriting to FK IN on local table.
    cross-service-navigation.js    Cross-service navigation (4.2.12):
                                   resolveLocalToRemoteNavigation() for N1 (local→remote),
                                   rewriteRemoteToLocalNavigation() for N2 (remote→local).
    remote-query.js                containsLambda(), runDirectRemoteQuery(),
                                   propagateRemoteError().
                                   Direct remote query bypass for lambda/staticWhere cases.

  DataReplicationService.js        Orchestrates replicate strategy. Extends cds.Service.
                                   addReplication() / run() / scheduleJobs().
                                   Registers a single on('REPLICATE.{READ,MAP,WRITE}')
                                   router that dispatches to per-replication default
                                   handlers kept in internal _defaults maps.
  replication-service.cds          Stub service definition (`service DataReplicationService;`)
                                   so CAP auto-wires the JS implementation and
                                   `cds.connect.to('DataReplicationService')` works.

  lib/
    DataReplication.js             Per-replication execution engine.
                                   Concurrency guard via optimistic UPDATE on Federations table.
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

  data-replication-management-service.cds/.js
                                   OData service exposing Federations + ReplicationRuns,
                                   plus run/flush/status actions.

index.cds                          CDS model:
                                   - aspects: replicated, multiSourced
                                   - types:   FederationStrategy, ReplicationMode, RunStatus
                                   - entities: Federations, ReplicationRuns
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
       │    └─ extract viewMapping (projectedColumns + localToRemote + remoteToLocal)
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
       └─ DataReplicationService.addReplication()
```

### CAP native delegation vs. plugin value-add

CAP's runtime **automatically handles** the full query translation pipeline when you
call `remote.run(req.query)` on a consumption view projection chain. This is documented
in the [CaLeSi guide under "Automatic Query Translation"](https://cap.cloud.sap/docs/guides/integration/calesi#delegation)
and demonstrated in SAP's official [xtravels sample](https://github.com/capire/xtravels):

```js
this.on('READ', Customers, req => s4.run(req.query))
```

**What CAP does natively** (no plugin code needed):
- Column rename translation in `$select`, `$filter`, `$orderby` (via `as` clauses in the CDS projection)
- Column restriction to projected fields only (bandwidth optimization)
- `$expand` forwarding within the same remote service (Scenario A)
- Result structure transformation back to the consumer's local schema
- `$count`, `$top`, `$skip` passthrough

**What this plugin adds on top:**
1. **Declarative handler registration** — annotate `@federation.delegate` and the `on('READ')` handler
   is registered automatically for every annotated entity. No manual service implementation needed.
   Compare with SAP's [risk-management sample](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js)
   which requires ~100 lines of manual handler code for the same patterns.
2. **Navigation path filter translation** — CAP does not translate renamed association names in
   `$filter` navigation paths (e.g., `buyer/name` where `buyer` is renamed from `customer`). The plugin's
   `translateNavigationFilters()` pre-translates these before forwarding to the remote service.
3. **Local→remote $expand resolution (Scenario B)** — when a LOCAL entity has an association to a
   FEDERATED entity and the client requests `$expand`, CAP cannot resolve this across service boundaries.
   The plugin's `registerLocalExpandResolvers()` strips federated expand items, executes the local query,
   batch-fetches remote data in a single call, and stitches results. This requires the viewMappingRegistry
   with `localToRemote`/`remoteToLocal` dictionaries for manual field mapping.
4. **Remote→local $expand resolution (Scenario C)** — when a FEDERATED entity has a backlink
   association to a LOCAL entity, the plugin strips local expand items, forwards the remote query,
   queries local data separately, and stitches. Unlike the risk-management sample's manual handler,
   the plugin handles both single records and lists (no "expand only allowed for one record" limitation).
5. **Static `where` clause in projections** — CAP's [old "Consuming Services" docs](https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features)
   explicitly list `where` conditions in projections as **not supported** for remote services. The plugin
   extracts `projection.where` from the CSN at model load time and injects it into every remote query
   via `runDirectRemoteQuery()`. This enables patterns like `entity ActiveCustomers as projection on
   remote.Customers where blocked = false` that CAP alone cannot resolve for delegate entities.
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

### Local→remote $expand (Scenario B)

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

---

## Test architecture

Tests run against **real** local CAP providers — not mocks. Three test apps plus the consumer:

### Protocol support for delegation

| Protocol | `cds.requires` kind | Delegation support | Notes |
|---|---|---|---|
| OData V4 | `odata` | Full | CAP-native CQN translation. Default. |
| OData V2 | `odata-v2` | Full | CAP-native CQN translation. V2 returns decimals/counts as strings. |
| HCQL | `hcql` | Full | CAP-native protocol (xtravels sample). |
| REST | `rest` | **Not supported** | CAP does not translate CQN to REST. Use `@federation.replicate` + RestAdapter. |

### Test providers

| Provider | Port | Protocol | Entities | Purpose |
|---|---|---|---|---|
| ProviderService (V4) | 4444 | OData V4 | Customers, Products, Orders | Primary delegation target |
| ProviderService (V2) | 4444 | OData V2 | Same as above | V2 protocol testing (via `@cap-js-community/odata-v2-adapter`) |
| InventoryService | 4445 | OData V4 | Warehouses, StockLevels | Second provider for multi-service mashup |
| RestProvider | 4446 | REST (JSON) | Customers, Products | REST replication target (plain Express, no CAP) |

### Test file structure

```
test/
  provider/                        OData V4 + V2 provider on port 4444
    db/schema.cds                  Customers, Products, Orders, Addresses (composite key)
    db/data/*.csv                  5 customers, 5 products, 6 orders, 6 addresses
    srv/provider-service.cds       ProviderService exposing all entities
    package.json                   Includes @cap-js-community/odata-v2-adapter

  inventory/                       OData V4 provider on port 4445
    db/schema.cds                  Warehouses, StockLevels
    db/data/*.csv                  3 warehouses, 6 stock levels
    srv/inventory-service.cds      InventoryService exposing all entities
    package.json                   Independent npm workspace

  consumer/                        App under test
    db/schema.cds                  Local entities (Reviews, Bookmarks, LightBookmarks,
                                   AddressNotes, ProductCategories, InventoryReports) +
                                   15 delegate consumption views + 3 cached:
                                     V4: Customers, Products, Orders, Suppliers
                                     V2: CustomersV2, ProductsV2, OrdersV2, SuppliersV2
                                     Patterns: CustomersLight (excluding), ActiveCustomers (where),
                                       ElectronicsProducts (where+renames), OrderFlat (flatten),
                                       ReviewsEnriched (cross-service paths)
                                     Inventory: Warehouses, StockLevels
                                     Cached: CachedCustomers (TTL), CachedProducts (TTL+tags+renames),
                                       CachedOrders (dynamic tags + custom cache service)
                                     Replicate: ReplicatedCustomers (wildcard),
                                       ReplicatedProducts (renames)
                                     REST Replicate: ReplicatedRestCustomers (explicit source,
                                       REST adapter with offset pagination + deltaParam)
    db/data/*.csv                  Seed data for local entities
    srv/external/ProviderService.csn    V4 provider model
    srv/external/ProviderServiceV2.csn  V2 provider model (same entities, different service name)
    srv/external/InventoryService.csn   Inventory provider model
    srv/consumer-service.cds       ConsumerService projecting all entities + OrderSummary
                                     (higher-level flattened view defined at service level)
    package.json                   Connects to 4 remote services (3 OData + 1 REST)

  rest-provider/                   Plain REST provider on port 4446
    server.js                      Express app: GET /api/customers, /api/products
                                     Supports ?limit=&offset= pagination, ?modifiedSince= delta

  setup.js                         Starts/stops all provider processes
                                   startProvider()/startInventoryProvider()/startRestProvider()

  delegation.test.js               Parameterized V4+V2 test generator for protocol-agnostic coverage
  replication.test.js              27 passing + 2 skipped replication tests (Phase 4+5)
  unit.test.js                     Unit tests for retry, scanner (no I/O)
```

**Test categories in `delegation.test.js`:**

Tests use a **parameterized test generator** that runs the same suite against both OData V4 and V2.
V4 entities: Customers, Products, Orders, Suppliers.
V2 entities: CustomersV2, ProductsV2, OrdersV2, SuppliersV2.

| Category | Status | Notes |
|---|---|---|
| **Parameterized (V4+V2)** | | |
| Basic READ delegation | passing | Customers (wildcard), Products (renames), Suppliers (entity-level rename) |
| $filter with renames | passing | CAP handles via projection chain. V4+V2. |
| $filter operators (ne, ge, le, or, not, startswith, endswith) | passing | Standard OData filter operators. V4+V2. |
| String functions (contains, tolower, toupper) | passing | Including tolower/toupper on renamed fields. V4+V2. |
| $orderby with renames | passing | CAP handles via projection chain. V4+V2. |
| $select with renames | passing | V4+V2. |
| $top / $skip passthrough | passing | V4+V2. |
| $count passthrough | passing | `Number()` for V2 string counts. V4+V2. |
| $expand Scenario A (remote→remote) | A1-A7 passing | To-one, to-many, multi, nested, $select in expand. V4+V2. |
| $expand options ($filter/$orderby/$top/$skip in expand) | passing (V4 only) | V2 doesn't support nested expand options. `;` separator for combined options. |
| Combined query parameters | passing | $filter + $orderby + $top + $select + $expand. V4+V2. |
| Error propagation | passing | 404 for non-existent keys, error details in body. V4+V2. |
| **V4-only** | | |
| $filter with navigation paths | passing | Plugin translates assoc renames (buyer→customer) in nav paths |
| Lambda operators (any/all) | passing (+1 skip) | any() and all() on to-many. Scenario C lambda via resolveLocalLambdaFilters. Scenario B lambda (cross-service to-many) skipped. |
| Scenario B: navigation path $filter | passing | Cross-service nav path filter via resolveRemoteNavigationFilters(). Query splitting: remote query → FK IN rewrite. Combined with local filter + $expand. |
| $expand Scenario B (local→remote) | B1-B14 passing | Plugin: batch-fetch + stitch, cross-provider, nested expand w/ recursive rename (B7), excluding bandwidth fix (B8), composite keys (B9), to-many array grouping (B10), $top per-parent (B11), $filter in to-many expand (B12), lambda any() cross-service (B13-B14) |
| $expand Scenario C (remote→local) | C1-C4 + options passing | $filter/$orderby/$top in expand. Per-parent limiting for $top. |
| Consumption view: excluding columns | passing | CustomersLight — excluded fields absent from response |
| Consumption view: static where clause | passing | Plugin extracts `projection.where` and injects into remote query. Tested: basic, $count, $orderby, combined $filter, renames. |
| Consumption view: flatten associations | skipped | OData protocol limitation. Works only with HCQL. |
| Consumption view: higher-level views | skipped | Same OData limitation. 2-level projection chain. |
| Consumption view: cross-service paths | skipped | Requires data federation (replication). |
| Multi-provider: Inventory | passing | Warehouses + StockLevels from second provider |
| Mixed protocol (V4 + V2) | passing | Same data queried via both protocols in same test |
| **CQL (V4)** | | |
| CQL: SELECT.one | passing | Returns single object, not array |
| CQL: .columns() / projection functions | passing | Explicit column selection, array form, renamed fields, arrow syntax |
| CQL: .where() basic + nested | passing (+1 skip) | eq, >=, <=, !=, in, boolean, AND, OR, range. `like` skipped. |
| CQL: .orderBy() / .limit() | passing | asc, desc, renames, multiple columns, pagination with offset |
| CQL: Combined clauses | passing | .columns + .where + .orderBy + .limit pipeline |
| CQL: SELECT.distinct | skipped | OData has no DISTINCT; CAP's cqn2odata rejects it |
| CQL: Entity-level rename | passing | Suppliers via CQL |
| CQL: SELECT.from key shortcut | passing | `SELECT.from(Entity, key)` returns single object |
| CQL: Expand Scenarios A/B/C | passing | All three scenarios via projection functions |
| CQL: cds.ql tagged templates | passing | Filters, expands, ordering via template literals |
| **CQL (V2-backed entities)** | | |
| CQL V2: Basic queries | passing | CustomersV2, ProductsV2, OrdersV2, SuppliersV2 |
| CQL V2: Combined clauses | passing | .columns + .where + .orderBy + .limit on V2 entities |
| CQL V2: Expand Scenario A | passing | OrdersV2 → buyer via CQL |
| **Caching (via cds-caching)** | | |
| Cache hit/miss | passing | C1-C4: first request miss, second hit, different $filter/$select = separate entries |
| TTL expiration | passing | C5: CachedCustomers (5s TTL), verify entry expires after TTL |
| Cache with renames | passing | C6-C7: CachedProducts with renamed fields, $filter on renames |
| Tag-based invalidation | passing | C8: static tag, C9: auto entity tag, C10: cross-entity isolation, C11: dynamic data-based tags |
| Custom cache service | passing | C12: CachedOrders uses longTermCache, C13: service isolation |
| Cache clear | passing | C14: cache.clear() invalidates all entries for that service |
| $expand with cache | passing | C15: Scenario A expand cached and served from cache |
| **CRUD delegation (V4)** | | |
| CREATE/UPDATE/DELETE (writable entities) | passing | Customers (wildcard), Products (renames). Full CUD round-trip with read-back verification. |
| Read-only entity rejects writes | passing | Suppliers/Orders (no write flags) return 405 for POST/PATCH/DELETE |
| Selective write flags | passing | WritableCustomersNoDelete: CREATE+UPDATE succeed, DELETE returns 405 |
| Remote error propagation on invalid CREATE | passing | Invalid payload returns >= 400 |
| **Cross-service navigation (V4)** | | |
| N1: Local → remote navigation (Reviews/product) | passing | `GET /Reviews(id)/product` — reads local FK, delegates to remote with rename mapping. |
| N2: Remote → local navigation (Customers/bookmarks) | passing | `GET /Customers('C001')/bookmarks` — rewrites navigation CQN to FK-filtered local query. |
| N3: Navigation with $select on target | passing | `GET /Reviews(id)/product?$select=productName,category` — navigation + column restriction. |
| N4: Remote → local navigation with $filter | passing | `GET /Customers('C001')/bookmarks?$filter=label eq 'VIP customer'` — navigation + filter on local target. |
| N5: Local → remote navigation: Bookmarks/customer (wildcard) | passing | `GET /Bookmarks(id)/customer` — wildcard projection, no renames. |
| **Discovery** | | |
| $apply (aggregation) | skipped | CAP rejects `.groupBy` for remote services. Not supported. |
| $search | passing | CAP forwards `$search` to remote OData service. Searches all string columns by default. |
| **Replication (Phase 4)** | | |
| Full sync (wildcard + renames) | R1-R4 passing | Truncate + replicate all records, idempotent UPSERT, renamed fields mapped |
| Delta sync | R5-R7 passing | lastSync tracking, timestamp-based delta filter, UPSERT on re-run |
| Statistics tracking | R8-R9 passing | Tracker stats (created counts), ReplicationRuns records |
| Concurrency guard | R10 passing | Sequential runs succeed after completion |
| Local data queries | R11-R15 passing | $filter, $orderby, $select, $count, $top/$skip on replicated tables |
| Manual trigger + flush | R16-R17 passing | run() API, clear() resets data and tracker |
| MAP phase hooks | R18-R19 passing | before.MAP filter, after.MAP enrich |
| Management API (OData) | skipped | OData routing for management service entities (tracker, runs) |
| **Adapter architecture (Phase 5)** | | |
| OData adapter delta modes | R22-R24 passing | Full mode, timestamp delta filter, viewMapping column restriction |
| REST adapter full sync | R25-R26 passing | Full sync via srv.send(), correct field values from REST response |
| REST adapter delta sync | R27 passing | Delta param (modifiedSince) passed as URL parameter |
| REST adapter local queries | R28 passing | Replicated REST data queryable via CQL ($filter, $orderby) |
| REST adapter idempotency | R29 passing | Repeated full sync produces no duplicates |
| Server-driven paging (replicate) | R30 passing | OData adapter keeps paging until remote returns empty; provider caps at 2 rows via `@cds.query.limit` |
| Server-driven paging (delegate) | passing | Auto-loops remote when it caps below requested `$top`; respects client `$top`, preserves `@odata.count` |

Run tests:
```bash
npx jest --runInBand --verbose --forceExit --roots test/
# or by pattern:
npx jest --runInBand --forceExit --roots test/ --testNamePattern "B4:"
```

All providers auto-start in `beforeAll`. If they linger from a previous run:
```bash
kill $(lsof -ti:4444) $(lsof -ti:4445) $(lsof -ti:4446)
```

---

## Example apps

`examples/` holds **manually runnable** demo apps complementary to `test/`. Same federation patterns, but:

- Persistent SQLite (`examples/consumer/db.sqlite`) so clicks through the UI persist across restarts.
- Fiori Elements UIs + a `sap.ushell` sandbox launchpad so the features are clickable, not just query-able.
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
      placeholder/webapp/    stub app for the "Replication Management (coming soon)" tile
  regen-csn.js               recompiles provider + inventory + licensing into external CSN
  start-all.sh               starts all four servers; Ctrl+C stops everything
```

Feature-to-entity mapping (movies demo):

- Delegate wildcard read-only → `Movies`, `Genres`
- Delegate writable (full CUD) → `Actors`
- Delegate selective writable (update only) → `Directors`
- Delegate + field renames → `Films`
- Delegate + entity rename + V2 → `LicensedMovies`
- Delegate + static `where` → `AwardWinningMovies`
- Delegate + `excluding` → `MoviesLight`
- Cached delegate → `TrendingMovies` (TTL 60s)
- Second-provider delegate → `StreamingManifests`, `Regions`
- Replicate V4 → `ReplicatedMovies`
- Replicate REST → `ReplicatedBoxOffice`
- Local + Scenario B (`$expand=movie`) → `Watchlists`, `Reviews`, `Bookmarks`
- Scenario C backlink (`Movies(...)/reviews`) → `Movies.reviews`/`Movies.bookmarks`

### Role: showcase, not source of truth

Tests in `test/` remain the correctness source of truth. `examples/` is for **manual exploration** and demos. The consumer model intentionally gives every federation pattern *one* obvious showcase — don't pile additional variants onto the same entity. The launchpad's value is that every tile works and tells a clear story. Features that expand the test matrix don't always need a new tile.

### Maintenance rule

When a new **user-visible** feature lands (new annotation option, new adapter, new query capability surfaced through OData, new management action), update `examples/consumer`:

1. Add or adjust the consumption view in `examples/consumer/db/schema.cds`.
2. Expose it in `examples/consumer/srv/consumer-service.cds`.
3. If the entity is visible in the UI, add or update `UI.LineItem` / `UI.HeaderInfo` / `UI.FieldGroup` annotations in `examples/consumer/srv/consumer-service-ui.cds`.
4. If a new FE app is warranted, edit `examples/consumer/app/_generate-fe-apps.js` (append an entry), rerun `node examples/consumer/app/_generate-fe-apps.js`, and add a tile in `examples/consumer/app/launchpage.html`.
5. If you changed provider/inventory schemas, rerun `npm run examples:regen-csn` so the consumer's external CSN snapshots are up to date.
5. Verify `npm run examples:start` boots cleanly and the affected tile renders.

This is enforced by `.claude/commands/implement-feature.md` Phase 5 and by the `maintain-examples` Cursor skill. Don't let `examples/` drift from the feature set — the launchpad is the user-facing showcase.

### Regenerating FE apps

The 8 Fiori Elements apps have an identical shape and are generated from a single config by `app/_generate-fe-apps.js`. To add, rename, or remove an app, edit the `APPS` array in that script and rerun it.

---

## Conventions to follow

### Annotation naming

- **`@federation.delegate`** and **`@federation.replicate`** (NOT `@cds.federated` — that namespace belongs to SAP).
- Strategies are explicit annotation names, not options on a single annotation. Easier to scan visually in CDS models.
- Cache is an **option** on either annotation, never a strategy of its own:
  ```cds
  @federation.delegate: { cache: { ttl: 60000 } }
  ```
- **CUD (write) capabilities** are opt-in via annotation flags. Default is read-only (safe).
  - `writable: true` enables all three operations (CREATE, UPDATE, DELETE)
  - Individual flags `create`, `update`, `delete` for selective control
  - Individual flags override `writable` when both are present
  - Resolution: `create = options.create ?? options.writable ?? false` (same for update/delete)
  - `resolveWriteFlags()` in `annotation-scanner.js` implements this logic
  ```cds
  // Read-only (default — no CUD handlers registered, @readonly enforced)
  @federation.delegate
  entity Customers as projection on remote.Customers { * };

  // All CUD enabled (shorthand)
  @federation.delegate: { writable: true }
  entity Products as projection on remote.Products { ... };

  // Selective: create + update, no delete
  @federation.delegate: { create: true, update: true }
  entity Partners as projection on remote.Partners { ... };

  // Shorthand + override: writable but no delete
  @federation.replicate: { writable: true, delete: false, schedule: '*/10 * * * *' }
  entity Orders as projection on remote.Orders { ... };
  ```
  The annotation scanner enforces `@readonly` on entities with no write flags and strips it from entities with any write flag. For partially writable entities, disabled operations get explicit rejection handlers (405).

  **Why read-only by default:** SAP's [xtravels](https://github.com/capire/xtravels) reference app marks all remote entities `@readonly` (Customers from S/4, Flights/Supplements from xflights). Remote data is reference data — value helps for local entities. Write capability is a deliberate design choice (transparent proxy, self-service portal, unified API layer), not a default. The plugin enforces this by actively setting `@readonly` on delegate entities with no write flags.

  **CUD is synchronous, not outboxed:** CUD forwarding uses `remote.run(req.query)` directly. The client expects the remote's response (201 with created entity, 200 with updated entity, 204 on delete). OData and Fiori Elements depend on this request-response contract. `cds.outboxed()` defers execution and returns no result — it is for fire-and-forget side effects (business event notification, cache invalidation, background sync), not CUD proxy. See xtravels: it uses `cds.outboxed(xflights)` only for the `BookingCreated` domain event, never for CUD.

### Annotations apply only to consumption views

`@federation.delegate` and `@federation.replicate` are valid **only on a CDS projection of the form `entity X as projection on remote.Y`**. The projection is the federation contract: source service, source entity, projected columns, and bidirectional rename mapping are all inferred from it by `buildConfigFromAnnotation()` in `srv/annotation-scanner.js`:

```js
// srv/annotation-scanner.js
if (!explicitSource && !inferredSource) {
    LOG.warn(`Cannot resolve source for @federation.${strategy} entity '${entityName}'. Skipping.`)
    return null
}
```

What this rules out:

- **Annotating an imported service entity directly** — `annotate ReviewsService.Reviews with @federation.delegate;` has no projection, so the scanner cannot infer columns or renames. Always wrap in a consumption view.
- **Using plain entities as federation targets** — any entity without an `as projection on <remoteService>.<remoteEntity>` clause is skipped.

The one escape hatch is the explicit `options.source` option, and it is **only** for REST services that have no CDS model (the scanner has no way to infer a source from OData metadata for a REST target):

```cds
@federation.replicate: {
  source: 'RestProvider',
  rest: { path: '/api/customers', pagination: { type: 'offset', pageSize: 100 } }
}
entity ReplicatedRestCustomers { key ID: String(10); name: String(100); ... };
```

Do **not** use `options.source` as a general workaround for OData services — it bypasses source inference but also skips the viewMapping extraction needed for Scenario B, renames, and column restriction. For OData, always project on the imported service.

### CQN safety

- Always use `cds.ql.clone(query)` before modifying a CQN object. The query is shared across the request pipeline; in-place mutation causes nondeterministic bugs.
- The delegate handler passes `req.query` directly to `remote.run()` — CAP handles the translation internally without mutating the original query.

### Replication pipeline events

- Pipeline phases are dispatched as `REPLICATE.READ`, `REPLICATE.MAP`, `REPLICATE.WRITE` — never `READ`/`WRITE` alone (those are CAP CRUD aliases).
- Register hooks via the standard CAP API: `srv.before/on/after(event, replicationName, handler)`.
- `before` and `on` hooks receive `(req)`. `after` hooks receive `(results, req)` per CAP convention — for non-READ events `results` is usually `undefined`, so mutate state on the second arg.
- Multiple hooks for the same `(event, path)` run in parallel via `Promise.all`. For ordering, use `srv.prepend(() => srv.before(...))`.
- `DataReplicationService.run()` is overloaded: `run(name, mode?, trigger?)` triggers a replication; `run(fn)` / `run(query)` falls through to `cds.Service`'s transactional wrapper (required so `srv.dispatch()` works). When extending the service, preserve this overload.

### Idempotency

- Replicate writes use `UPSERT.into(entity).entries(records)` (CQL, supported on SQLite + HANA).
- Never use the SELECT-then-INSERT/UPDATE pattern (the original prototype had bugs from this; UPSERT eliminates them).

### Retry

- Use `withRetry(fn, { maxRetries, baseDelay, retryOn })` from `srv/lib/retry.js`.
- `retryOn` defaults to "skip 4xx, retry everything else" — match this convention. Don't retry auth failures (401/403) or bad requests (400).

### Concurrency

- Replicate jobs use optimistic locking via UPDATE on the `Federations` tracker table:
  ```js
  UPDATE("plugin_data_federation_Federations").set({ status: 'running' })
    .where({ name, status: { '!=': 'running' } })
  ```
- If `affectedRows === 0`, another run is in progress — return early, don't queue.

### Error handling

- Surface remote service errors with context (HTTP status, remote entity name).
- Don't swallow errors silently. Use `LOG.warn` or `LOG.error` with `cds.log('cds-data-federation')`.

### Logging

- Use `cds.log('cds-data-federation')` consistently. Don't `console.log`.
- `LOG.debug` for verbose details (annotation matches, handler registrations).
- `LOG.info` for one-time summary ("Discovered 3 @federation.* entities").
- `LOG.warn` for unexpected-but-recoverable (e.g., cds-caching missing → fall back to delegate).
- `LOG.error` for failures.

---

## Implementation status

**Done (Phase 1-3):**
- Annotation scanner with view mapping registry
- Delegate strategy using CAP-native `remote.run(req.query)` — CAP handles all query
  translation ($select, $filter, $orderby, $expand, column restriction, result mapping)
  automatically through the CDS projection chain
- Replicate strategy with UPSERT, concurrency guard, retry
- Cache integration via `cds-caching` (optional peer dep): configurable TTL, configurable cache
  service (`service` option, default `'caching'`), auto-tag `federation:<entityName>`, static string
  tags, dynamic data-based tags (`{ data, prefix }`), template tags (`{ template }`), tag-based
  invalidation via `cache.deleteByTag()`, custom cache service isolation
- Remote→remote $expand Scenario A (A1-A7 — to-one, to-many, multi, nested, $select in expand)
  all handled natively by CAP via query forwarding
- Local→remote $expand resolution (Scenario B1-B6 — batch-fetch + stitch, manual mapping)
  including cross-provider B4-B6 (InventoryReports → product from Provider + warehouse from Inventory)
- Entity-level rename via consumption views (Suppliers — same remote, different local purpose)
- OData V2 delegation with full parity: parameterized test suite runs all query capability
  tests against both V4 and V2 via CustomersV2, ProductsV2, OrdersV2, SuppliersV2
- Multi-provider delegation: consumer queries two independent OData V4 providers
- Test infrastructure with 3 real providers (V4, V2, Inventory) + consumer app
- Navigation path filter translation for renamed associations in $filter
  (e.g., `buyer/name` → `customer/name` via `translateNavigationFilters()`)
- Comprehensive $filter operator tests (ne, ge, le, or, not, startswith, endswith)
- String function tests: contains, startswith, endswith, tolower, toupper (V4+V2)
- Navigation path filter tests (contains, boolean, combined, cross-assoc)
- Cross-service navigation path $filter (Scenario B): `resolveRemoteNavigationFilters()` in
  `remote-navigation-filters.js` pre-resolves filters like `$filter=product/productName eq 'X'`
  on local entities by querying the remote service for matching keys and rewriting to FK IN
  filters. Handles comparison operators and combined local+remote filters.
- Lambda operators (any/all) working for Scenario A (V4 only), Scenario B
  (via resolveRemoteLambdaFilters in expand-local-to-remote.js), and Scenario C
  (via resolveLocalLambdaFilters)
- $filter/$orderby/$top/$skip within $expand (V4 only; V2 doesn't support nested expand options)
- Scenario C (remote→local $expand) implemented and tested (C1-C4) with $filter/$orderby/$top in expand
  ($top uses per-parent limiting during stitching phase)
- Consumption view patterns tested: excluding columns (CustomersLight), static where clause
  (plugin enhancement — extracts `projection.where` and injects into remote query via
  `runDirectRemoteQuery()`), flatten associations (OData limitation), higher-level views
  (OData limitation), cross-service paths (limitation)
- Error propagation tested for V4+V2 (404 for non-existent keys, error details in body)
- Comprehensive CQL/cds-ql test suite: SELECT.one, .columns(), .where() (basic + nested),
  .orderBy(), .limit(), combined clauses, SELECT.distinct, entity-level renames, key shortcuts,
  projection functions (arrow syntax), $expand via CQL for all 3 scenarios (A/B/C),
  cds.ql tagged template literals with postfix projections
- CQL via V2-backed entities: SELECT.from, .where, .orderBy, combined clauses,
  $expand Scenario A via CQL on V2 entities
- CQL limitations on OData remote services documented: `like` operator not supported
  (OData $filter has no `like` keyword), `SELECT.distinct` not supported (CAP's cqn2odata rejects it),
  `$apply`/`.groupBy()` not supported (CAP rejects for remote services)
- `$search` forwarding works: CAP forwards `$search` to remote OData service, searches all string
  columns by default (no `@cds.search` annotation required)
- Delegate caching via `cds-caching`: configurable TTL, configurable cache service name,
  auto-tag `federation:<entityName>`, static/dynamic tag-based invalidation, response caching
  with correct cache keys for different $filter/$select/$orderby queries (15 integration tests)
- Annotation-driven CUD forwarding: opt-in via `writable: true` (shorthand for all) or individual
  `create`, `update`, `delete` flags. `resolveWriteFlags()` resolves precedence (individual overrides
  shorthand). Read-only entities get `@readonly` enforced; partially writable entities register
  explicit 405 rejection handlers for disabled operations. Tested: full CRUD round-trip with
  read-back, read-only rejection (405), selective flags (create+update but not delete).
- Cross-service navigation (4.2.12) implemented in `cross-service-navigation.js`:
  (a) local→remote: `resolveLocalToRemoteNavigation()` reads local FK, queries remote with
  rename mapping, returns mapped result. Wired into delegate handler (handler-registration.js).
  (b) remote→local: `rewriteRemoteToLocalNavigation()` rewrites navigation CQN to FK-filtered
  local query. Wired into local expand resolver (expand-local-to-remote.js).
  5 tests passing (N1-N5): local→remote, remote→local, $select, $filter, wildcard.
- 309 tests passing delegation + 31 unit + 10 write flags, 6 skipped delegation
  (like, distinct, apply, flatten, higher-level flatten, cross-service paths, Scenario B lambda (to-many))
- Replication strategy end-to-end (Phase 4): DataReplication pipeline runs on CAP's
  native `cds.Service` dispatch. `DataReplicationService extends cds.Service` and is
  auto-wired from `srv/replication-service.cds` so `cds.connect.to('DataReplicationService')`
  resolves. Pipeline events are namespaced — `REPLICATE.READ`, `REPLICATE.MAP`,
  `REPLICATE.WRITE` — to avoid collision with CAP's CRUD aliases. `DataReplication._deltaSync()`
  builds `cds.Request` instances and calls `srv.dispatch(req)`; `req.reply` is set
  before dispatch to force interceptor-chain semantics. Per-replication default
  handlers are stored in internal `_defaults` maps and invoked from a single
  service-level `on('REPLICATE.*')` router. User hooks register via the standard
  `srv.before/on/after(event, replicationName, handler)` API and compose through
  CAP's native before → on → after chain. `after` hooks receive `(results, req)` per
  CAP convention — read/write state on the second arg. Default READ handler
  delegates to adapter factory; default MAP handler applies `remoteToLocal` rename
  mapping; default WRITE handler uses `UPSERT.into(entity).entries()` for idempotent
  local DB writes. Tracker tables (Federations, ReplicationRuns) created
  programmatically as fallback when management service is not loaded.
  Test entities: ReplicatedCustomers (wildcard, excluding orders association for persistence),
  ReplicatedProducts (5-of-7 column restriction + renames: ID→productId, name→productName,
  price→unitPrice). 19 replication tests passing (R1-R19), 2 skipped (management API OData routing).
- Adapter architecture (Phase 5): Adapter factory auto-selects ODataAdapter or RestAdapter
  based on `cds.requires` service `kind`. ODataAdapter: CQL batch reads with viewMapping
  column restriction, 3 delta modes (timestamp/key/datetime-fields), `cds.ql.clone()` +
  `withRetry`. RestAdapter: `srv.send()` with offset/cursor/page pagination, `deltaParam`
  URL parameter, `dataPath` response extraction, `withRetry`. Annotation scanner supports
  explicit `source` option for REST services without CDS model. Test infrastructure includes
  REST provider on port 4446. ReplicatedRestCustomers entity with REST-specific annotation
  config. 8 new tests (R22-R29): OData delta modes + REST full/delta sync.
- Nested `$expand` in Scenario B: `buildInnerColumns()` forwards inner expand items (with
  translated association names) to the remote batch-fetch query. `mapResultWithNestedExpands()`
  recursively maps expanded association values using `viewMappingRegistry` — e.g., when
  `Bookmarks?$expand=customer($expand=orders)`, the inner `orders` results get the consumer's
  Orders renames applied (ID→orderId, total→amount, etc.). `mapFlatWithFKs()` also handles
  FK column renames (customer_ID→buyer_ID) by detecting the association prefix pattern.
- Excluding columns bandwidth fix (4.1.5): `extractViewMapping()` now records `excludedColumns`
  from `projection.excluding` in the CSN. `resolveFederatedExpand()` uses this to build an
  explicit `$select` that omits excluded fields from the remote batch-fetch, fixing the
  over-fetch issue for Scenario B entities with `excluding` projections. Tested via
  `LightBookmarks` → `CustomersLight` (B8).
- Composite key associations in Scenario B: `resolveFederatedExpand()` now supports multi-key
  associations by collecting FK tuples and building OR chains of AND conditions for the remote
  query (OData doesn't support tuple-based IN). Lookup uses JSON-stringified composite keys.
  Tested via `AddressNotes` → `CustomerAddresses` (B9: custId + addressType with renames).
- To-many Scenario B expand: `resolveFederatedToManyExpand()` handles unmanaged to-many
  associations (parsed from `on` condition) by querying remote with FK IN filter, grouping
  results into arrays, and stitching. Supports `$top`/`$skip` per-parent limiting.
  Tested via `ProductCategories` → `Products` (B10: array grouping, B11: $top, B12: $filter).
- Scenario B lambda (`any()`/`all()`): `resolveRemoteLambdaFilters()` detects `exists`
  expressions referencing federated to-many associations, queries the remote for matching
  join values, and rewrites to a local IN filter. Uses CQN `list` syntax for SQLite
  compatibility. Tested via B13 (any with match) and B14 (any no matches).
- Server-driven paging (transparent to clients): when the remote OData service caps
  response size below the requested `$top` (e.g. Northwind's 20-row default), the
  delegate handler auto-loops the remote via `$top`/`$skip` until the client's requested
  rows are collected or the remote returns empty. `srv/delegation/paged-remote-query.js`
  exports `runPagedRemoteQuery(remote, query, { pageSize, maxPages })`, wired into both
  `registerDelegateHandler` + `registerCachedDelegateHandler` and `runDirectRemoteQuery`.
  `@odata.count` is preserved from the first batch. The OData replication adapter was
  also fixed (the previous `batch.length === batchSize` stop condition silently truncated
  when the remote capped below `batchSize`; now it stops only on an empty batch).
  Tested via 5 delegation tests + R30 replication test against a provider entity
  annotated with `@cds.query.limit: { max: 2 }`.
- 350 tests passing total, 9 skipped

**Not started (Phase 6+):**
- Event-driven sync via `cds.outboxed()` + CAP messaging (business event subscriptions per 4.8.3, not CUD proxy)
- CQN adapter
- Fiori Elements monitoring UI
- OData routing for replicated entities (currently local-only via CQL; OData GET returns 404)
- Soft-delete propagation, reconciliation mode, dry-run mode
- Entity ordering for referential integrity

For the full feature matrix and roadmap, see [`docs/reference/requirements.md`](./docs/reference/requirements.md).
For the cross-service $expand design, see [`docs/concepts/expand-scenarios.md`](./docs/concepts/expand-scenarios.md).

---

## Key references

| Topic | Where |
|---|---|
| Full requirements + status | [`docs/reference/requirements.md`](./docs/reference/requirements.md) |
| $expand concept (3 scenarios) | [`docs/concepts/expand-scenarios.md`](./docs/concepts/expand-scenarios.md) |
| Service query execution (dispatch pipeline) | [`docs/concepts/service-query-execution.md`](./docs/concepts/service-query-execution.md) |
| Published documentation site | https://mikezaschka.github.io/cds-data-federation/ |
| CAP CaLeSi (consumption views, delegation) | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation | https://cap.cloud.sap/docs/guides/integration/data-federation |
| `cds-caching` (peer dep) | https://github.com/mikezaschka/cds-caching |

---

## Working with this project from another tool (Cursor, etc.)

If you're using Cursor with the Claude plugin or a similar AI tool, follow this workflow:

### 1. Always read this file first

Tell the AI: "Read `CLAUDE.md` before doing anything." This file is the canonical entry point.

### 2. For deeper context, read in this order

1. `CLAUDE.md` (this file) — overall picture
2. `docs/reference/requirements.md` — feature matrix, status, comparison
3. `docs/concepts/expand-scenarios.md` — current focus area (cross-service $expand)
4. `docs/concepts/service-query-execution.md` — how queries route through services vs. DB
5. `srv/delegation/` (start with `index.js`) and `srv/annotation-scanner.js` — core code
6. `test/delegation.test.js` — what's tested and what's not

### 3. Workflow for adding a new feature

Use the `/implement-feature` slash command in Claude Code to enforce this workflow automatically. Manual steps:

1. **Find the feature in `docs/reference/requirements.md`** — features are numbered (e.g., 4.2.5) with priority and status.
2. **Set status to `In progress`** in `docs/reference/requirements.md`.
3. **For medium/large features, write a plan doc** — create `docs/internal/plans/<feature-name>.md` with: overview, affected files, task checkboxes, test strategy. Review before implementing.
4. **Check the relevant test file** — find a skipped test for the feature; if none exists, write one first (`it.skip(...)`).
5. **Implement** — keep changes minimal and surgical. The codebase is small; don't add abstractions until they're needed twice.
6. **Unskip the test and run it:**
   ```bash
   npx jest --runInBand --forceExit --roots test/ --testNamePattern "your test name"
   ```
7. **Run the full suite to check for regressions:**
   ```bash
   npx jest --runInBand --verbose --forceExit --roots test/
   ```
8. **Update documentation (all surfaces):**
   - `docs/reference/requirements.md` — set status to `Implemented`, update the Progress Summary table counts
   - `README.md` — if user-visible (new annotation option, adapter, query capability, event hook, management action, protocol), add/adjust the relevant line. Keep it compressed — one bullet or table row.
   - `CLAUDE.md` — if architecturally significant, update the relevant section
   - `docs/` — if user-visible, update the relevant section on the documentation site (annotation options in `reference/annotations.md`, integration guides, concepts). Published at https://mikezaschka.github.io/cds-data-federation/
   - Move plan doc to `docs/internal/plans/completed/` if one was created
9. **Commit** — use conventional commit format (`feat:` for new features, `fix:` for bug fixes).

### 4. Workflow for fixing a bug

1. **Reproduce with a failing test** — if the bug isn't covered by an existing test, add one.
2. **Inspect runtime state** — for CAP-specific issues, use this pattern to dump CSN / runtime info:
   ```js
   node -e "
   const cds = require('@sap/cds');
   cds.test('test/consumer/');
   setTimeout(async () => {
       const srv = cds.services['ConsumerService'];
       // ... inspect srv.entities, cds.model.definitions, etc.
       process.exit(0);
   }, 3000);
   "
   ```
3. **Fix and verify** — run the failing test, then the full suite.

### 5. CDS quirks to know about

- **CSN `ref` arrays**: can be either `["Service.Entity"]` (single dot-separated) or `["Service", "Entity"]` (segmented). Always join then split, e.g., `ref.join('.').split('.')`.
- **`@cds.persistence.skip`** on projections: if extending an external entity, you must explicitly set this to `false` to get a local table. The annotation scanner does this automatically for `@federation.replicate`.
- **Annotations propagate to service projections**: when `ConsumerService.X as projection on consumer.X` is compiled, `@federation.*` (and all other annotations) are inherited onto the service entity. Without filtering, the scanner would process the service-level projection a second time — registering a duplicate replication config *and* forcing `cds deploy` to emit the service entity as a standalone table instead of a view over the real data. `scanAnnotations` guards against this by checking whether an entity's direct projection source already carries `@federation.*` and skipping such derived surfaces.
- **`$expand` is embedded in `req.query.SELECT.columns`** as objects with `.expand` property — NOT a separate property on SELECT. Filter columns by `.expand` to find them.
- **`service.prepend(fn)`** registers a handler that runs BEFORE existing handlers. Required so the federation handler runs before CAP's default DB dispatcher.
- **`cds.connect.to(name)`** with `kind: 'odata'` requires `@sap-cloud-sdk/http-client` and `@sap-cloud-sdk/resilience` as devDependencies.
- **`cds.test()` and Jest workspaces**: `cds.test()` must be called at module top-level (not inside `beforeAll`). Two test files calling `cds.test()` with the same path can conflict — run them separately or use `--testPathPattern`.

#### CQL features not supported on OData remote services

When using `cs.run(SELECT.from(...))` or `cds.ql` against `@federation.delegate` entities, the CQL query is translated to an OData URL by CAP's `cqn2odata` serializer. Several CQL features have no OData equivalent and will fail:

| CQL Feature | Error | Workaround |
|---|---|---|
| `.where({ field: { like: '%X%' } })` | `Parsing URL failed ... Expected "eq", "ge", ...` — OData `$filter` has no `like` keyword | Use OData string functions via HTTP URL: `$filter=contains(name,'X')`, `startswith(...)`, `endswith(...)`. No CQL QBE equivalent exists for these functions. |
| `SELECT.distinct.from(...)` | `Feature not supported: SELECT statement with .distinct` — CAP explicitly rejects it | Use `$apply=groupby((field))` via HTTP URL, or deduplicate in application code. |
| `.groupBy()` / `.having()` / `$apply` | `Feature not supported: SELECT statement with .groupBy` — CAP rejects for remote services. `$apply` via HTTP URL also fails (CAP parses it into `.groupBy` internally). | Aggregate in application code, or use a replicated entity with local SQL. |
| `forUpdate()` / `forShareLock()` | Locking is a database concept | Use ETags for optimistic concurrency on OData services. |
| `pipeline()` / `stream()` / `foreach()` | Only implemented by `DatabaseService` | Fetch full result set and iterate in memory. |

These are **CAP platform limitations** when routing CQL to OData, not plugin-specific issues. All standard CQL features (`SELECT.one`, `.columns()`, `.where()` with eq/ne/gt/ge/lt/le/in/and/or, `.orderBy()`, `.limit()`, projection functions, `$expand` via nested projections, `cds.ql` tagged templates) work correctly through the delegation pipeline.

### 6. What NOT to do

- **Don't reintroduce `@cds.federated`** — it's reserved for future SAP use. We use `@federation.*`.
- **Don't add a "cache" strategy** — caching is an option (`cache: { ttl }`) on `delegate` or `replicate`, not a peer.
- **Don't bypass `withRetry`** in adapter calls. All remote I/O goes through it.
- **Don't mutate `req.query`** in handlers. Always build a fresh query or `cds.ql.clone()`.
- **Don't write tests that mock the provider service** — use the real `test/provider` CAP app via `setup.js`. Mocking gives false confidence; the real OData translation has subtleties (`@odata.count`, OData v2 timestamp format, etc.) that mocks miss.
- **Don't unskip multiple tests at once** without implementing them. The convention is one test → fail → implement → pass → next test.
- **Don't add `console.log`** — use `cds.log('cds-data-federation')`.
- **Don't use `cds.outboxed()` for CUD forwarding** — CUD is synchronous `remote.run(req.query)`. The outbox defers execution and returns no result, breaking OData's request-response contract. It belongs in fire-and-forget scenarios: business event notification, cache invalidation, background sync.
- **Don't make federated entities writable by default** — the annotation scanner enforces `@readonly` on entities without write flags. This is intentional and matches SAP's reference patterns (xtravels). Always require explicit opt-in via `writable` / `create` / `update` / `delete`.
- **Don't let `README.md` drift from `docs/reference/requirements.md`** — any feature that moves to "Implemented" must be reflected in the README's feature matrix or annotation reference. The README is the user-facing summary; treat it as part of the feature, not as documentation to update later.
- **Don't let the documentation site drift either** — user-visible features must also land in the relevant `docs/` page (annotation reference, integration guide, or concept). The site is published to GitHub Pages from `docs/`; see `mkdocs.yml` for structure and `.github/workflows/docs.yml` for the deploy.
- **Don't let `examples/` drift from features** — user-visible capabilities (new annotation options, adapters, query capabilities reachable via OData, management actions) must also land in `examples/consumer`. The launchpad is the interactive showcase; a broken tile or missing demo for a documented feature is as bad as broken docs. See "## Example apps" for the maintenance checklist.

### 7. Useful prompts for the AI

- *"Read CLAUDE.md, then look at how delegate handlers work and add support for [feature]."*
- *"Test [N] is skipped. Read the test, understand what it expects, implement the minimal change to make it pass without breaking other tests."*
- *"There's a bug in [file]. Reproduce it with a test first, then fix it."*
- *"Update docs/reference/requirements.md to reflect that [feature] is now Implemented."*
