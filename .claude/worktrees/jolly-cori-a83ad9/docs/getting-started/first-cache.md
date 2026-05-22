# First Cache

Adding response caching to a federated entity is a one-line change. Caching is an **option** on either strategy, never a strategy of its own.

## Prerequisite: install cds-caching

```bash
npm add cds-caching
```

`cds-caching` is an optional peer dependency. If it's missing, `cache: { ... }` options are silently ignored with a warning — your annotations still work, they just don't cache.

## 1. Add `cache` to the annotation

```cds
@federation.delegate: { cache: { ttl: 60000 } }
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};
```

That's it. After boot:

1. First request → cache miss → remote call → response stored with TTL.
2. Subsequent identical requests → cache hit → served from memory / Redis / whatever `cds-caching` is wired to.
3. After 60 seconds → TTL expires → next request is a miss again.

Identical means same `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$expand` combination. Different query parameters produce different cache keys.

## 2. Tag-based invalidation

Every federated entity gets an automatic tag `federation:<entityName>`:

```javascript
const cache = await cds.connect.to('caching');
await cache.deleteByTag('federation:Partners');
```

Add your own tags for finer-grained invalidation:

```cds
@federation.delegate: { cache: {
    ttl: 60000,
    tags: ['partners-page',
           { data: 'category', prefix: 'cat-' }]  // dynamic, per-record
} }
entity Partners as projection on remote.A_BusinessPartner { ... };
```

## 3. Custom cache service

By default, the plugin uses the `caching` service. To route specific entities to a different cache instance (e.g., a longer-TTL cache for rarely-changing data):

```cds
@federation.delegate: { cache: { ttl: 3600000, service: 'longTermCache' } }
entity Countries as projection on remote.Countries;
```

Configure `longTermCache` in your `cds.requires` and give it whatever store you want — memory, Redis, or a custom implementation.

## Cache semantics at a glance

| What | How |
|---|---|
| Key | Hash of `(entity, $filter, $select, $orderby, $top, $skip, $expand)` |
| Expiry | TTL from the annotation |
| Invalidation | `cache.deleteByTag('federation:<entity>')`, custom tags, or `cache.clear()` |
| Scope | Per-service cache instance (different cache services are isolated) |

## When NOT to cache

- **Writable entities** — cache invalidation across all possible filter combinations is hard. Consider delegating the cache concern to the remote service's own ETag / `Cache-Control` headers.
- **Personal / per-user data** — unless you wire `cds-caching` to produce user-scoped cache keys, cached responses are shared across users.
- **Data that must be immediate** — even a 5-second TTL is too long for some use cases (live dashboards, financial positions).

For these, use `@federation.replicate` instead — the copy in the local DB is effectively "the cache" and you control refresh directly.

## Next steps

- [Integration → cds-caching](../integration/caching.md) — all tag patterns, custom cache services, eviction strategies.
- [Reference → Annotations](../reference/annotations.md) — full `cache` option schema.
