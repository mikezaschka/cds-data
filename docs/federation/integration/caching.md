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

### Where the entity cache is stored

The snapshot table needs a datastore. You do **not** pick it on the annotation — the storage is chosen **globally** and auto-detected at startup. There are two modes:

| Mode | When | Storage |
|---|---|---|
| **Primary `db`** (default) | No dedicated datastore configured | Cache tables (`plugin.data_federation.entity_cache.*`) are created in your app's `db`. Under CAP MTX that `db` is already per-tenant. Typical in dev/tests. |
| **Dedicated SQLite files** | A dedicated datastore is detected | One **SQLite file per tenant**, separate from application tables. Recommended for production. |

The plugin switches to per-tenant files as soon as **any** of these is present in your config (existence is the trigger — there is no on/off flag):

- `cds.requires.'federation-entity-cache'`, **or**
- `cds.requires.<name>` where `<name>` is `cds-data-federation.entityCache.serviceName`, **or**
- `cds-data-federation.entityCache.urlTemplate`.

### Assigning the service

**Option A — conventional name (simplest).** Declaring the service is all it takes:

```json
"federation-entity-cache": { "kind": "sqlite" }
```

Files are named `federation-entity-cache-{tenant}.sqlite` in the project root.

**Option B — your own service name.** Point the plugin at it with `entityCache.serviceName`:

```json
{
  "MyEntityCache": { "kind": "sqlite" },
  "cds-data-federation": {
    "entityCache": { "serviceName": "MyEntityCache" }
  }
}
```

**Option C — control file naming / location** (keeps the default `federation-entity-cache` service name):

```json
"cds-data-federation": {
  "entityCache": {
    "urlTemplate": "caches/fed-{tenant}.sqlite",
    "baseDir": ".",
    "defaultTenant": "default"
  }
}
```

::: tip The file path is computed per tenant
The plugin does not simply connect to a static `credentials.url`. For each tenant it substitutes `{tenant}` and connects with an explicit file path, deploying the cache schema into that file on first use. The template is resolved in this order: `entityCache.urlTemplate` → the service's `credentials.url` **if it contains `{tenant}`** → the default `federation-entity-cache-{tenant}.sqlite`. The `{tenant}` value comes from `cds.context.tenant`, or `entityCache.defaultTenant` (default `'default'`) in single-tenant dev.
:::

::: warning `cache.service` does not apply here
The `cache.service` option is **`strategy: 'response'` only** — it names a [`cds-caching`](https://github.com/mikezaschka/cds-caching) instance. For `strategy: 'entity'` there is no per-annotation way to route one entity to a specific store; storage selection is global via `cds.requires` as described above.
:::

If the resolved datastore (or `cds-data-pipeline`) can't be reached at startup, entity caching is **disabled with a warning** and those entities fall back to live delegation.

### Global entity-cache options

Tune the entity cache globally under `cds.requires` → `cds-data-federation` → `entityCache`. These apply to every `strategy: 'entity'` delegate; the ones marked *overridable* can be set per annotation (see [Annotations → Cache option](../reference/annotations.md#cache-option)).

| Option | Type / default | What it does |
|---|---|---|
| `size` | bytes — `10 MB` dev / `100 MB` prod | Max cached bytes **per tenant**. Snapshots are pruned once the total exceeds this. `0` disables the size cap. |
| `ttl` | ms — `1_800_000` (30 min) | Default freshness window; a negative value means "never expire once loaded". *Overridable* via `cache.ttl`. |
| `check` | ms — `60_000` | Interval of the background prune timer. `0` disables periodic pruning. |
| `stats` | ms — `300_000` | Interval of the background stats-logging timer. `0` disables it. |
| `prune` | boolean — `true` | Master switch for size-based pruning. |
| `preload` | boolean — `false` | Warm every entity cache at startup instead of on first miss. *Overridable.* |
| `wait` | boolean — `true` | On a cold miss, block the request until the snapshot loads. `false` = kick off a background reload and serve a live delegate read meanwhile. *Overridable.* |
| `validate` | boolean — `true` | After a reload, validate the cached row count against the remote. *Overridable.* |
| `search` | boolean — `true` | Answer `$search` queries from the cache. `false` = forward `$search` to the live remote. *Overridable.* |
| `measure` | boolean — `false` | Emit per-query timing comparisons (cache vs. remote fallback) for diagnostics. |
| `staticUrlTemplate` | string — `federation-entity-cache-static.sqlite` | File name for the shared, tenant-independent cache used by entities annotated `cache.static: true`. |

Storage-location options (`serviceName`, `urlTemplate`, `baseDir`, `defaultTenant`) are covered under [Where the entity cache is stored](#where-the-entity-cache-is-stored).

```json
"cds": {
  "requires": {
    "federation-entity-cache": { "kind": "sqlite" },
    "cds-data-federation": {
      "entityCache": {
        "ttl": 900000,
        "size": 52428800,
        "preload": true,
        "wait": false
      }
    }
  }
}
```

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

**Tenant scope:** When `cds.requires.'federation-entity-cache'` (or `cds-data-federation.entityCache.urlTemplate`) is configured, each CAP tenant gets its **own SQLite file** — default pattern `federation-entity-cache-{tenant}.sqlite`. There is no shared `tenantId` column. Single-tenant dev uses `entityCache.defaultTenant` (default `'default'`). See [Integration → Multi-Tenancy](./multitenancy.md).

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
| Storage | Memory / Redis / cache service | SQLite (`db` or `federation-entity-cache`) | Main application SQL table |
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
