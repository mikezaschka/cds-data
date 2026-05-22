# Caching Federated Entities

Delegates can attach a `cache` block to either:

1. **`cache.strategy: 'response'`** (default) — provided by [`cds-caching`](https://github.com/mikezaschka/cds-caching), an optional peer dependency.
2. **`cache.strategy: 'entity'`** — built into `cds-data-federation`; stores a **full remote projection** snapshot in **secondary SQLite** via **`cds-data-pipeline`**, then satisfies arbitrary READ CQNs from SQLite until TTL.

## cds-caching (response strategy — default)

```bash
npm add cds-caching
```

When `cds-caching` is missing, **`strategy: 'response'`** cannot run — the federation logs a warning and serves live delegate reads. **`strategy: 'entity'`** does not need `cds-caching`.

### Basic usage (response)

```cds
@federation.delegate: { cache: { ttl: 60000 } }
entity Customers as projection on remote.Customers;
```

- First request for a given query → cache miss → remote call → response stored with TTL.
- Subsequent **identical** requests → cache hit (same `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$expand`).
- TTL expiry → cold miss again.

## Entity strategy (`cache.strategy: 'entity'`)

Mimics the **Replication Cache** pattern from `@cap-js-community/common` without importing that package: warm a local SQLite replica of the delegated entity and answer **changing** OData filters/orderings locally within TTL.

Requires:

```bash
npm add cds-data-pipeline @cap-js/sqlite
```

And **`cds.requires.FederationEntityCache`** (recommended for production) — separate `kind: sqlite` datastore so cache tables don't sit beside application tables:

```json
"FederationEntityCache": {
  "kind": "sqlite",
  "credentials": { "url": "federation-entity-cache.sqlite" }
}
```

Omit it to reuse the project's primary **`db`** service (typical in dev/tests; `@cap-js/sqlite` deploy picks up synthesized `plugin.data_federation.entity_cache.*` definitions).

### Annotation example

```cds
@federation.delegate: {
  cache: {
    strategy: 'entity',
    ttl: 300000,
    batchSize: 1000       // OData READ paging batch (optional)
  }
}
entity Customers as projection on remote.Customers;
```

### Behaviour

| Concern | `strategy: 'response'` | `strategy: 'entity'` |
|---|---|---|
| Granularity | Exact query repetition | Whole entity snapshot: different `$filter` / `$orderby` per request remain SQLite-sourced until TTL expires |
| Backend | cds-caching (memory/redis/…) | CAP SQLite secondary DB |
| Initial cost | Remote call proportional to `$top`/params | Remote full-row read (projection columns) batches until drained |
| Miss trigger | TTL or key eviction | TTL **or** failed SQLite READ (falls through to live delegate once) |

**Tenant scope (ADR 0010):** When `cds.requires.FederationEntityCache` (or `cds-data-federation.entityCache.urlTemplate`) is configured, each CAP tenant gets its **own SQLite file** — default pattern `federation-entity-cache-{tenant}.sqlite`. There is no shared `tenantId` column. Single-tenant dev uses `entityCache.defaultTenant` (default `'default'`). See [Integration → Multi-Tenancy](./multitenancy.md).

**Fallback:** Any SQLite or pipeline failure is logged at `warn`; the delegate handler falls back to the normal `remote.run` path.

### Limitations (MVP)

- Cross-service **`$expand` / batch navigations that fetch through the delegate shim** remain on the delegate code path (`expand-local-to-remote`).
- Entities with **static projection `where`**, **lambda-heavy filters routed to `runDirectRemoteQuery`**, or **same-service OData `$expand` on the delegated entity** still bypass SQLite and forward directly to the remote.
- Explicit **REST-only** federation (`options.source`) without CSN-backed source entities is skipped at model inject time until a fuller schema story exists.

## Response cache semantics (`strategy: 'response'` — cds-caching)

| What | How |
|---|---|
| Key | Hash of `(entity, $filter, $select, $orderby, $top, $skip, $expand)` |
| Expiry | TTL from the annotation |
| Invalidation | `cache.deleteByTag('federation:<entity>')`, custom tags, or `cache.clear()` |
| Scope | Per-service cache instance — different cache services are isolated |

## Tags

Every federated entity automatically gets a `federation:<entityName>` tag. Add custom tags for finer-grained invalidation.

### Static string tags

```cds
@federation.delegate: { cache: {
    ttl: 60000,
    tags: ['reference-data', 'customers-api']
} }
entity Customers as projection on remote.Customers;
```

### Wrapped static tags

Equivalent to strings — useful when mixing with other tag forms in one array:

```cds
tags: [{ value: 'reference-data' }]
```

### Dynamic, data-based tags

The tag is derived from a record field at cache-write time, with an optional prefix:

```cds
@federation.delegate: { cache: {
    ttl: 60000,
    tags: [{ data: 'category', prefix: 'cat-' }]
} }
entity Products as projection on remote.Products;
```

A response containing a record with `category: 'Z001'` gets tagged `cat-Z001`. Invalidate all entries touching a category:

```javascript
await cache.deleteByTag('cat-Z001');
```

### Template tags

Full control via a template string:

```cds
tags: [{ template: 'tenant-{{tenant}}-entity-{{entity}}' }]
```

Template variables available: `tenant`, `entity`, and any other context the request exposes.

Under CAP multitenancy (`cds.requires.multitenancy` or `cds-data-federation.multitenancy.active`), a `tenant-{{tenant}}-entity-{{entity}}` tag is injected automatically unless `cache.tenantScoped: false`. See [Multi-Tenancy](./multitenancy.md).

## Custom cache services

By default, caching goes through the `caching` service. To route specific entities to a different cache instance (e.g., longer TTL, isolated from main cache):

```cds
@federation.delegate: { cache: { ttl: 3600000, service: 'longTermCache' } }
entity Countries as projection on remote.Countries;
```

Configure `longTermCache` in your `cds.requires` block following `cds-caching`'s own conventions.

## Invalidation

```javascript
const cache = await cds.connect.to('caching');

// Entity-wide
await cache.deleteByTag('federation:Customers');

// Custom tag
await cache.deleteByTag('reference-data');

// Everything in this cache instance
await cache.clear();
```

## Cache + delegate + CUD

When a writable delegate entity is updated, the cache is **not** invalidated automatically. Manual invalidation is required:

```javascript
this.after(['CREATE', 'UPDATE', 'DELETE'], 'Customers', async () => {
    await cache.deleteByTag('federation:Customers');
});
```

This is a deliberate design choice — blanket auto-invalidation on any write would make caching pointless for writable entities. Use custom data-based tags if you need surgical invalidation (e.g., invalidate only cache entries for the affected customer ID).

## Cache + replicate (response strategy only)

Caching on replicate annotations caches the **local SQL query result**, not the remote call. It's effectively a query-result cache in front of the local database — rarely useful, since local SQL is already fast.

In most cases, replicate without caching is the right choice; the local DB is the cache.

## When to pick which strategy

| | `response` | `entity` | `@federation.replicate` |
|---|---|---|---|
| Storage | Memory / Redis / cache service | SQLite (`db` or `FederationEntityCache`) | Main application SQL table |
| Cache hit | Exact same query | Any query on the entity | N/A — always local SQL |
| First-access cost | One remote call for that query | One remote full-entity read | One bulk sync per schedule |
| Joins with local data | No | No | Yes |
| Analytics / aggregations | No | No (separate store) | Yes |
| Invalidation | Tags / TTL | TTL (re-run pipeline on miss) | Schedule / manual pipeline run |
| Offline resilience | Until TTL | Until TTL | Full — local table always available |

For writable delegates, neither cache strategy auto-invalidates on CUD — plan manual invalidation or shorter TTL.

## See also

- [cds-caching documentation](https://github.com/mikezaschka/cds-caching) — response strategy backend.
- [cds-data-pipeline](/pipeline/) — engine used by `@federation.replicate` and `cache.strategy: 'entity'`.
- [Reference → Annotations](../reference/annotations.md#cache-option) — full `cache` option schema.
- [Getting Started → First Cache](../getting-started/first-cache.md) — hands-on example.
- [Integration → Multi-Tenancy](./multitenancy.md) — per-tenant SQLite files and MTX hooks.
