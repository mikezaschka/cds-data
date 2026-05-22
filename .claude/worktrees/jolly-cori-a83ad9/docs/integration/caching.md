# cds-caching

Response caching for federated entities is provided by the [`cds-caching`](https://github.com/mikezaschka/cds-caching) plugin, an optional peer dependency. When present, any `@federation.*` annotation can add a `cache: { ... }` block.

## Install

```bash
npm add cds-caching
```

If `cds-caching` is missing, `cache` options are silently ignored with a warning — the federation still works, it just doesn't cache.

## Basic usage

```cds
@federation.delegate: { cache: { ttl: 60000 } }
entity Customers as projection on remote.Customers;
```

- First request for a given query → cache miss → remote call → response stored with TTL.
- Subsequent identical requests → cache hit.
- After 60 seconds → TTL expires → next request is a miss again.

"Identical" means the same `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$expand` combination. Different query parameters produce different cache keys.

## Cache semantics

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

## Cache + replicate

Caching on replicate annotations caches the **local SQL query result**, not the remote call. It's effectively a query-result cache in front of the local database — rarely useful, since local SQL is already fast.

In most cases, replicate without caching is the right choice; the local DB is the cache.

## When to pick cache over replicate

| | Cache | Replicate |
|---|---|---|
| Storage | Memory / Redis / cache service | Local SQL table |
| TTL granularity | Per cache key | Whole dataset, per schedule |
| Joins across sources | No | Yes |
| Analytics / aggregations | No | Yes |
| Writes | Forward to remote; manual invalidation | Read-only |
| Remote call load | One per cold key per TTL | One bulk call per schedule |
| Offline resilience | Some — serves until TTL expires | Full — local table always available |

## See also

- [cds-caching documentation](https://github.com/mikezaschka/cds-caching) — the underlying caching plugin.
- [Reference → Annotations](../reference/annotations.md#cache-option) — full `cache` option schema.
- [Getting Started → First Cache](../getting-started/first-cache.md) — hands-on example.
