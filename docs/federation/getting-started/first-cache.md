# First Cache

Caching is an **option** on `@federation.delegate` (and optionally `@federation.replicate`), never a strategy of its own. Pick a **`cache.strategy`**:

| Strategy | Best for | Peer dependencies |
|---|---|---|
| **`response`** (default) | The same OData query repeats often | [`cds-caching`](https://github.com/mikezaschka/cds-caching) |
| **`entity`** | Fiori list pages with changing `$filter` / `$orderby` on one entity | [`cds-data-pipeline`](/pipeline/), `@cap-js/sqlite` |

See [Integration → Caching](../integration/caching.md) for the full trade-off table and limitations.

## Response cache (`strategy: 'response'`)

### Prerequisite

```bash
npm add cds-caching
```

If `cds-caching` is missing, **`strategy: 'response'`** is skipped with a warning — delegation still works.

### Annotation

```cds
@federation.delegate: { cache: { ttl: 60000 } }
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};
```

After boot:

1. First request → cache miss → remote call → response stored with TTL.
2. Subsequent **identical** requests → cache hit (same `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$expand`).
3. After TTL expires → cold miss again.

## Entity cache (`strategy: 'entity'`)

Use this when users drive many different filters and sort orders against the same delegated entity — one remote full read covers all query variants until TTL.

### Prerequisites

```bash
npm add cds-data-pipeline @cap-js/sqlite
```

Register the pipeline service in `cds.requires` (same as [First Replication](first-replication.md)). For production, add a **secondary** SQLite datastore so cache tables stay out of your application `db`:

```json
"FederationEntityCache": {
  "kind": "sqlite",
  "credentials": { "url": "federation-entity-cache.sqlite" }
}
```

Omit `FederationEntityCache` to attach cache tables to the primary **`db`** service (fine for local dev and tests).

### Annotation

```cds
@federation.delegate: {
  cache: {
    strategy: 'entity',
    ttl: 300000,
    batchSize: 1000
  }
}
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};
```

After boot:

1. First READ on this entity (within TTL) → pipeline loads the **full projected dataset** from the remote into SQLite (scoped by CAP tenant context).
2. Subsequent READs with **any** `$filter` / `$orderby` / `$select` → served from SQLite until TTL expires.
3. Pipeline or SQLite errors → logged and the handler falls back to live delegation.

Rows are keyed by a synthetic `tenantId` column (`cds.context.tenant` / `cds.context.user.tenant`, else shared empty tenant).

## Tag-based invalidation (response strategy)

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

## Custom cache service (response strategy)

By default, the plugin uses the `caching` service. To route specific entities to a different cache instance (e.g., a longer-TTL cache for rarely-changing data):

```cds
@federation.delegate: { cache: { ttl: 3600000, service: 'longTermCache' } }
entity Countries as projection on remote.Countries;
```

Configure `longTermCache` in your `cds.requires` and give it whatever store you want — memory, Redis, or a custom implementation.

## Response cache semantics at a glance

| What | How |
|---|---|
| Key | Hash of `(entity, $filter, $select, $orderby, $top, $skip, $expand)` |
| Expiry | TTL from the annotation |
| Invalidation | `cache.deleteByTag('federation:<entity>')`, custom tags, or `cache.clear()` |
| Scope | Per `cds-caching` service instance |

## When NOT to cache

- **Writable entities** — neither strategy auto-invalidates on CUD. For `response`, use tags; for `entity`, trigger a pipeline refresh or shorten TTL.
- **Personal / per-user data** — `response` shares keys unless `cds-caching` is configured for user scope; `entity` scopes rows by CAP tenant context only.
- **Cross-entity mashups** — stitched `$expand` results are not cached as a unit; each delegated leg resolves independently.
- **Data that must be immediate** — even a short TTL may be too long (live dashboards, financial positions).

When you need joinable local copies and analytics, use `@federation.replicate` instead — the main `db` table is the durable local copy.

## Next steps

- [Integration → Caching](../integration/caching.md) — strategy comparison, `FederationEntityCache` setup, MVP limitations.
- [Reference → Annotations](../reference/annotations.md) — full `cache` option schema.
