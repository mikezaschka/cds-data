# Replication Cache Analysis: @cap-js-community/common

This document analyzes the Replication Cache feature from [`@cap-js-community/common`](https://github.com/cap-js-community/common), how it relates to cds-data-federation's caching and replication strategies, and the design direction for building entity-level caching natively into this plugin.

---

## What @cap-js-community/common Is

[`@cap-js-community/common`](https://www.npmjs.com/package/@cap-js-community/common) is a CAP Node.js community package by Oliver Klemenz that bundles several utilities:

| Feature | Purpose |
|---|---|
| **Replication Cache** | Cache CDS service reads into tenant-aware local SQLite |
| Migration Check | Detect incompatible CDS model changes across releases |
| Rate Limiting | Per-tenant request throttling for CDS services |
| Redis Client | Redis connection broker with Sentinel support |
| Local HTML5 Repository | Dev-time proxy for local UI5 app testing |
| CDM Builder | Generate CDM JSON from apps, roles, portal content |

The **Replication Cache** is the feature relevant to cds-data-federation. The rest are independent utilities — Migration Check and Rate Limiting are worth knowing about for CAP projects in general, but don't overlap with federation concerns.

---

## How the Replication Cache Works

The Replication Cache transparently intercepts reads on a CDS service (typically the `db` service) and redirects them to a local SQLite database. The SQLite DB is populated by replicating data from the original service on first access, then serves subsequent reads within a configurable TTL.

### Plugin Lifecycle

```
npm add @cap-js-community/common @cap-js/sqlite

cds-plugin.js
  └─ if cds.env.replicationCache.plugin:
      └─ cds.replicationCache = new ReplicationCache()

ReplicationCache constructor
  └─ attach()
      ├─ cds.on('loaded') → capture model
      └─ cds.on('connect', service) → if service matches target (default: 'db'):
          ├─ find entities annotated with @cds.replicate
          ├─ require('@cap-js/sqlite') as the cache store engine
          ├─ service.prepend(() => service.on('READ', this.read))
          └─ start prune interval + stats interval
```

### Read Handler Flow

```
READ request arrives at db service
  │
  ├─ Is entity annotated with @cds.replicate?
  │   └─ No → next() (pass through to original service)
  │
  ├─ Is tenant cache active?
  │   └─ No → next()
  │
  ├─ Load cache entry for this entity + tenant
  │   ├─ Status: Ready (data exists, within TTL)
  │   │   └─ Run req.query against tenant's SQLite DB → return results
  │   │
  │   └─ Status: NotReady (no data, or TTL expired)
  │       ├─ if auto: true → trigger replication from original service
  │       │   └─ Stream all entity records into SQLite (pipe or chunked)
  │       ├─ if wait: true → block until replication completes, then query SQLite
  │       └─ if wait: false → next() (serve from original, replicate in background)
  │
  └─ On any error → next() (fall back to original service, log error)
```

### Per-Tenant SQLite Isolation

Each tenant gets its own SQLite database file:

```
temp/
  federation-cache-tenant-abc123.sqlite
  federation-cache-tenant-def456.sqlite
```

The plugin maintains a `Map<tenantId, { db: SQLiteService, entries: Map<entityRef, CacheEntry> }>`. Each cache entry tracks status, size, last-touched timestamp, and TTL.

### Size Management

When total cache size exceeds the configured limit (default 10 MB dev, 100 MB prod), LRU eviction kicks in: entries sorted by `touched` timestamp, least-recently-used cleared first until size drops below the limit. A periodic check interval (default 60s) triggers pruning.

### Annotations

```cds
@cds.replicate                        // enable for entity
@cds.replicate.ttl: 300000            // per-entity TTL (ms), overrides global default
@cds.replicate.auto: true             // auto-replicate on first read (default: true)
@cds.replicate.preload: true          // eagerly replicate on first request to any cached entity
@cds.replicate.group: 'master-data'   // group related entities for batch operations
@cds.replicate.static: true           // non-tenant-aware (shared across tenants)
```

### CDS Environment Options

```json
{
  "cds": {
    "replicationCache": {
      "plugin": true,
      "name": "db",
      "ttl": 1800000,
      "size": 10485760,
      "check": 60000,
      "auto": true,
      "wait": false,
      "deploy": true
    }
  }
}
```

Key options: `ttl` (default 30 min), `size` (max cache bytes), `check` (prune interval), `deploy` (deploy full schema to SQLite for projection support), `wait` (block reads until replication completes), `pipe` (stream replication vs. chunked).

---

## Relationship to cds-data-federation

### Three Levels of Caching in a Federation Context

When a consumer queries remote data through cds-data-federation, there are three distinct caching approaches, each solving a different problem:

**1. Response caching** — per-query-signature cache (via `cds-caching`)

```cds
@federation.delegate: { cache: { ttl: 60000 } }
entity Products as projection on remote.Products;
```

The delegate handler wraps `remote.run(query)` with `cache.rt.run()`. The cache key is derived from the request signature (URL, query parameters). An exact repeat of the same query is a cache hit. A different `$filter`, `$orderby`, or `$select` is a cache miss — even if the underlying data overlaps.

Best for: stable, repetitive query patterns. Low overhead, no schema deployment.

**2. Entity caching** — full dataset in local SQLite (what Replication Cache does)

The entire entity dataset is fetched from the remote service and stored in a local SQLite database. Any subsequent query against that entity — regardless of `$filter`, `$orderby`, `$select` — is served from the local SQLite copy within the TTL window.

Best for: entities queried in many different ways (Fiori list pages with user-driven filtering/sorting). One remote fetch covers all query patterns.

**3. Full replication** — persistent copy in main `db` (via `@federation.replicate`)

```cds
@federation.replicate
entity Products as projection on remote.Products;
```

Remote data is synced into the application's primary database on a schedule. The data becomes a first-class local entity — it participates in native CQN joins with other local entities, supports full SQL, and is available for analytics.

This is not a cache. It is a persistent local copy that enables cross-entity queries that would be impossible with delegation alone (e.g., `SELECT from Reviews left join Products` where Reviews is local and Products is remote).

### Why Replication Cache Is Not a Replacement for @federation.replicate

The Replication Cache stores data in a **separate SQLite database**, not in the application's main `db`. This means:

- No native joins between cached entities and local entities
- No cross-entity queries spanning the cache store and the main database
- Reading from the cache still requires delegation-style handler interception

Replicating into a separate store gives you a faster delegate, not a true replicate. The whole point of `@federation.replicate` is integrating remote data into the main `db` so it becomes indistinguishable from local data at the query level.

The Replication Cache is, architecturally, a **smarter caching layer for delegation** — not an alternative replication strategy.

### Where It Overlaps

For the specific pattern "I delegate to a remote service and want to speed up reads," the Replication Cache and `@federation.delegate: { cache }` are solving the same problem with different trade-offs:

| Concern | Response cache (cds-caching) | Entity cache (Replication Cache) |
|---|---|---|
| Cache granularity | Per query signature | Per entity dataset |
| Cache hit condition | Exact same query repeated | Any query on the entity |
| First request cost | One remote call (for this query) | One remote call (for ALL records) |
| Subsequent queries | Hit only if identical query | Hit for any $filter/$orderby/$select |
| Schema deployment | Not needed | Required (SQLite table definitions) |
| Storage | In-memory or Redis (serialized responses) | SQLite file (queryable relational data) |
| Tenant isolation | Depends on backend | Per-tenant SQLite file |

---

## Design Direction: Native Entity-Level Caching

Rather than integrating `@cap-js-community/common` as a dependency, cds-data-federation will implement entity-level caching natively using its own replication pipeline. The Replication Cache validates that the pattern works and is valuable — we'll build our own version with tighter integration.

### Why Build It Ourselves

**View mapping awareness.** The Replication Cache replicates data verbatim. cds-data-federation's annotation scanner already computes `localToRemote` / `remoteToLocal` field mappings from CDS projections. The entity cache can store data in the local schema directly — no mapping needed at read time.

**Consumption view schema derivation.** The SQLite table definition can be derived from the projected columns the scanner already extracts. No need for deploying the full CDS model (the Replication Cache's `deploy: true` option) or maintaining separate schema definitions.

**Unified annotation model.** One namespace (`@federation.*`) controls everything. No mixing `@cds.replicate` with `@federation.delegate` — the caching strategy is an option on the delegate annotation.

**Reuse of replication infrastructure.** The same `READ → MAP → WRITE` pipeline built for `@federation.replicate` (ODataAdapter, UPSERT writes, retry logic, concurrency guards) is reused for entity caching. Different trigger (on-demand vs. scheduled), different target (managed SQLite vs. main db), same engine.

**No extra dependencies.** `@cap-js-community/common` brings 5 runtime dependencies (commander, express, http-proxy-middleware, redis, verror) plus features unrelated to caching. `@cap-js/sqlite` would be the only additional optional peer dependency.

### Annotation Sketch

```cds
// Response-level caching (existing, via cds-caching)
@federation.delegate: { cache: { ttl: 60000 } }
entity Products as projection on remote.Products;

// Entity-level caching (new, built-in)
@federation.delegate: { cache: { strategy: 'entity', ttl: 60000 } }
entity Products as projection on remote.Products;
```

Default `strategy` is `'response'` (current behavior via `cds-caching`). Setting `strategy: 'entity'` switches to the SQLite-backed entity cache.

### Handler Flow

```
GET /consumer/Products?$filter=category eq 'Electronics'

  ConsumerService.on('READ', 'Products', handler)  ← registered by plugin
    │
    ├─ Check entity cache metadata: when was Products last replicated?
    │
    ├─ if (now - replicatedAt < ttl)  →  CACHE HIT
    │   └─ Run req.query against managed SQLite
    │       Field names are already in local schema (stored that way)
    │       Return results directly
    │
    └─ if stale or never cached  →  CACHE MISS
        ├─ Fetch ALL from remote: remote.run(SELECT.from(remoteEntity))
        ├─ Map remote field names → local (using viewMapping.remoteToLocal)
        ├─ UPSERT into managed SQLite (same UPSERT logic as @federation.replicate)
        ├─ Update metadata: replicatedAt = now
        ├─ Run req.query against managed SQLite
        └─ Return results
```

### Implementation Sequence

This builds on the replication infrastructure planned for Phase 4:

1. **Phase 4**: Implement `@federation.replicate` — scheduled bulk sync into main `db`. Builds the core replication pipeline (remote fetch, field mapping, UPSERT, retry, concurrency).

2. **Phase 5**: Add entity-level delegate caching. Reuse Phase 4's pipeline with:
   - On-demand trigger (first READ) instead of cron schedule
   - Managed SQLite target instead of main `db`
   - TTL-based invalidation with automatic re-fetch
   - Per-tenant SQLite isolation
   - Size-bounded LRU eviction

At that point the caching story is complete: `strategy: 'response'` for repetitive queries (via `cds-caching`), `strategy: 'entity'` for varied query patterns (built-in), `@federation.replicate` for native joins (into main db).

---

## Replication Cache: Capability Breakdown

The full comparison matrix across all tools lives in the [Feature Matrix](../../reference/requirements.md). This section details specifically what the Replication Cache supports, how it implements each capability, and what it does not cover.

### What It Supports

| Capability | How It Works |
|---|---|
| **Entity-level caching** | Full entity dataset replicated into per-tenant SQLite. Any CQN query (`$filter`, `$orderby`, `$select`, `$top/$skip`) served from local SQLite within TTL. |
| **On-demand replication** | First READ triggers replication from the source service. No explicit schedule or manual trigger needed (`@cds.replicate.auto: true`). |
| **TTL-based invalidation** | Per-entity TTL (`@cds.replicate.ttl`) or global default (30 min). On expiry, next read triggers re-replication. |
| **Per-tenant SQLite isolation** | Each tenant gets a separate SQLite file. Tenant ID embedded in file path. Non-tenant entities supported via `@cds.replicate.static`. |
| **LRU eviction / size limits** | Configurable max size (10 MB dev, 100 MB prod). Periodic prune interval evicts least-recently-touched entries first. |
| **Preloading** | `@cds.replicate.preload: true` eagerly replicates entity data on first request to any cached entity, not just the specific entity. |
| **Grouping** | `@cds.replicate.group` logically groups entities for coordinated replication. |
| **Streamed replication** | `pipe: true` (default) streams records from source into SQLite through a pipeline. Alternative: chunked mode with configurable chunk size. |
| **Retry** | Configurable retries for failed replications (default: 3). |
| **Statistics / monitoring** | Periodic logging of hit/miss ratio, error count, cache usage. Interval configurable via `stats` option. |
| **Transparent fallback** | On any error during cache read or replication, falls back to the original service via `next()`. Consumer never sees a cache failure. |
| **Measurement mode** | `measure: true` runs queries against both cache and original service, logs time comparison. Useful for benchmarking cache benefit. |
| **Full schema deployment** | `deploy: true` deploys the entire CDS model to SQLite, enabling queries on projections and views — not just base entities. |
| **Service-agnostic** | Caches any CDS service, not just remote services. Can cache HANA reads into SQLite for performance (e.g., read-heavy master data). |

### What It Does Not Support

| Capability | Detail |
|---|---|
| **Delegation / live proxy** | No concept of forwarding queries to a remote service. It only caches reads on a service it intercepts. |
| **Replication into main DB** | Data goes into a separate SQLite, not the application's `db`. No native joins with local entities. |
| **Field renames / column restriction** | Replicates data verbatim. Does not understand CDS projection `as` clauses or column subsetting. All source fields are cached. |
| **Consumption views** | No awareness of `projection on remote.X` patterns. The cache operates on the service-level entity definition, not a consumer-defined view. |
| **Delta / incremental sync** | Always full replication. No change tracking, no delta tokens, no CDC. Entire entity re-fetched on TTL expiry. |
| **Scheduled sync** | No cron-based scheduling. Replication is purely on-demand (triggered by reads) or preload (triggered by first request). |
| **Event-driven sync** | No integration with CAP messaging or CloudEvents for push-based invalidation. |
| **Multi-source federation** | No concept of merging data from multiple sources into a single entity. |
| **Custom transforms** | No hook system for transforming data between source and cache. Data stored as-is. |
| **Write-through** | Read-only cache. No support for writing back to the source service through the cache. |
| **Cross-entity queries** | Cannot join cached entities with non-cached entities or entities in the main DB. Each entity is cached independently. |

### Implications for cds-data-federation

The gaps above are exactly what cds-data-federation's native entity caching (Phase 5) would address by building on its own replication pipeline:

- **Field renames + column restriction** — the annotation scanner already computes `localToRemote` / `remoteToLocal` mappings. The entity cache stores data in the local schema, not verbatim.
- **Consumption view awareness** — SQLite table definitions derived from projected columns. No need for full model deployment.
- **Delta sync** — the replication pipeline (Phase 4) will support incremental sync; the entity cache can reuse that instead of always doing full re-fetch.
- **Scheduled + on-demand** — both triggers available on the same pipeline.
- **Multi-source** — the `multiSourced` aspect already handles merging from multiple remotes into one local entity.

---

## Other Features Worth Noting

### Rate Limiting

`@cap-js-community/common` includes per-service, per-tenant rate limiting via `@cds.rateLimiting`. This could be relevant in federation scenarios to protect remote services from excessive call volume. However, cds-data-federation's retry logic (`withRetry` with exponential backoff + jitter) and the caching layers already reduce remote call frequency. Rate limiting is a separate cross-cutting concern better handled at the service level.

### Migration Check

The migration check tool (`cdsmc`) detects incompatible CDS model changes between releases. Useful for any CAP project with deployed persistence, not specific to federation. Worth adopting independently if the project has HANA-deployed schemas.

---

## References

| Resource | URL |
|---|---|
| @cap-js-community/common (npm) | https://www.npmjs.com/package/@cap-js-community/common |
| @cap-js-community/common (GitHub) | https://github.com/cap-js-community/common |
| cds-caching (response-level cache) | https://github.com/mikezaschka/cds-caching |
| CAP Service Integration guide (consumption views) | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation | https://cap.cloud.sap/docs/guides/integration/data-federation |
