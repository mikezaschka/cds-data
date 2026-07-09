# Annotations

All federation behavior is declared inline on the annotation: `@federation.<strategy>: { ... }`.

## `@federation.delegate`

Transparent live proxy. Reads (and optionally writes) are forwarded to the remote service at request time.

```cds
@federation.delegate
entity Customers as projection on remote.Customers;
```

## `@federation.replicate`

Scheduled sync that copies remote data into the local database.

```cds
@federation.replicate: { schedule: 600000 }
entity ReplicatedCustomers as projection on remote.Customers;
```

## Common options

Apply to both strategies.

| Option | Type | Description |
|---|---|---|
| `source` | string | Explicit remote service name. Required for REST; inferred from the projection for OData. |
| `cache` | object | Enables read caching (`strategy: 'response'` via cds-caching, optional `strategy: 'entity'` via SQLite pipeline). See [Cache option](#cache-option). |

## Delegate-only options

| Option | Type | Description |
|---|---|---|
| `writable` | boolean | Shorthand for `create: true, update: true, delete: true`. Read-only by default. |
| `create` | boolean | Enable CREATE. Overrides `writable`. Disabled = HTTP 405. |
| `update` | boolean | Enable UPDATE. Overrides `writable`. Disabled = HTTP 405. |
| `delete` | boolean | Enable DELETE. Overrides `writable`. Disabled = HTTP 405. |

### Read-only by default

Entities with no write flags get `@readonly` enforced by the plugin — matching SAP's [xtravels](https://github.com/capire/xtravels) reference pattern. Remote data is reference data; write capability is an explicit design choice (transparent proxy, self-service portal, unified API layer), not a default.

### Examples

```cds
// All CUD enabled (shorthand)
@federation.delegate: { writable: true }
entity Products as projection on remote.Products { ... };

// Selective: create + update, no delete
@federation.delegate: { create: true, update: true }
entity Partners as projection on remote.Partners { ... };

// Shorthand + override: writable but no delete
@federation.delegate: { writable: true, delete: false }
entity Orders as projection on remote.Orders { ... };
```

## Replicate-only options

| Option | Type | Description |
|---|---|---|
| `mode` | `'full'` \| `'delta'` | Default `'delta'`. `'full'` truncates and re-reads everything each run. |
| `schedule` | number (ms) | Interval for `cds.spawn`. Omit for manual-only mode. |
| `preload` | boolean \| object | Run an initial sync at server startup. See [Initial load on startup](#initial-load-on-startup). |
| `delta` | object | `{ field, mode }`. `field` defaults to `'modifiedAt'`; `mode` to `'timestamp'`. |
| `batchSize` | number | Rows to request per remote page (OData adapter). Default `1000`. The adapter keeps paging via `$skip` until the remote returns empty, so if the remote enforces a smaller cap (e.g. Northwind's 20-row default) all rows are still captured — `batchSize` is a *requested* page size, not a hard upper bound. |
| `rest` | object | REST adapter config. See [REST config](#rest-config). |

### Delta modes

| Mode | How |
|---|---|
| `'timestamp'` | Compare `field` value to last successful run's high-watermark. Default. |
| `'key'` | Compare primary-key value (useful for monotonically-increasing IDs). |
| `'datetime-fields'` | Treat `field` as a composite of separate date + time fields (OData V2 pattern). |

### Initial load on startup

By default a scheduled replicate does not run until the first `schedule` interval
elapses, so the local table is empty between boot and that first tick. Set
`preload` to run one sync right after registration on server startup:

```cds
// Boolean: initial load in the background (does not block boot).
@federation.replicate: { schedule: 600000, preload: true }
entity ReplicatedCustomers as projection on remote.Customers;

// Object form: force a full initial load and block boot until it finishes.
@federation.replicate: {
    schedule: 600000,
    preload: { mode: 'full', wait: true }
}
entity ReplicatedProducts as projection on remote.Products;
```

| Field | Type | Description |
|---|---|---|
| `preload` | boolean | `true` runs a background initial load at startup using the replicate `mode`. |
| `preload.mode` | `'full'` \| `'delta'` | Override the run mode for the initial load only. |
| `preload.wait` | boolean | `true` blocks startup until the initial load completes; a failure then fails boot. Default `false` (background, non-blocking). |

`preload` works with or without `schedule`. A disabled pipeline (paused) skips its preload run.

### REST config

For services without a CDS model. Requires `source: '<rest-service-name>'`.

```cds
@federation.replicate: {
    source: 'RestProvider',
    delta: { field: 'modifiedAt' },
    rest: {
        path: '/api/customers',
        pagination: { type: 'offset', pageSize: 100 },
        deltaParam: 'modifiedSince',
        dataPath: 'results'
    }
}
entity ReplicatedRestCustomers { key ID: String(10); name: String(100); ... };
```

| Field | Type | Description |
|---|---|---|
| `path` | string | URL path under the service. |
| `pagination.type` | `'offset'` \| `'cursor'` \| `'page'` | Pagination flavor. |
| `pagination.pageSize` | number | Records per page. |
| `pagination.cursorParam` | string | For `'cursor'` — query param carrying the next-cursor value. |
| `pagination.cursorPath` | string | For `'cursor'` — JSON path in response pointing to the next cursor. |
| `deltaParam` | string | Query parameter name used for delta sync filter. |
| `dataPath` | string | JSON path to the array of records (omit if the response body is the array). |

See the [cds-data-pipeline REST adapter](/pipeline/guide/sources/rest) for worked examples of each pagination type.

## Cache option

Read caching on `@federation.delegate` (and optionally `@federation.replicate`). Two strategies:

```cds
@federation.delegate: { cache: {
    strategy: 'response',                   // optional: 'response' (default, cds-caching) | 'entity' (SQLite)
    ttl: 60000,                             // milliseconds
    batchSize: 1000,                        // optional, entity pipelines only — OData READ batch page size
    service: 'longTermCache',               // optional ('response'), defaults to 'caching'; ignored when strategy:'entity'
    tags: ['static-tag',                    // static string
           { data: 'orderId', prefix: 'order-' },   // dynamic, data-based
           { value: 'order-data' },         // wrapped static tag
           { template: '...' }]             // template tag
} }
```

| Field | Type | Description |
|---|---|---|
| `strategy` | `'response'` \| `'entity'` | **`response`** (default) — wrap the remote READ with [`cds-caching`](https://github.com/mikezaschka/cds-caching) keyed by query signature (`$filter`, `$select`, …). **`entity`** — fill a secondary SQLite table per full remote entity read (`cds-data-pipeline`), serve any CQN from SQLite until TTL. |
| `ttl` | number (ms) | Entry lifetime (`response`), or freshness window (`entity`). |
| `batchSize` | number | OData source batch page size when `strategy: 'entity'`. Defaults to pipeline default (1000). |
| `service` | string | Name of the `cds-caching` instance when `strategy: 'response'`. Ignored for `entity`. |
| `tags` | array | Static strings, dynamic data tags, value wrappers, or template tags (`response` only). |
| `tenantScoped` | boolean | Under CAP multitenancy, a `tenant-<tenant>-entity-<entity>` tag is added to `response` caches automatically. Set `false` to opt out. See [Multi-Tenancy](../integration/multitenancy.md). |

#### Entity-strategy options

These apply only to `strategy: 'entity'` and override the matching global [`entityCache` option](../integration/caching.md#global-entity-cache-options).

| Field | Type | Description |
|---|---|---|
| `preload` | boolean | Warm this entity's snapshot at server startup instead of on first miss. |
| `static` | boolean | Store the snapshot in a single **tenant-independent** file (`entityCache.staticUrlTemplate`) instead of one per tenant — for reference data shared across tenants. |
| `group` | string | Group name for coordinated invalidation of several entity caches together. |
| `wait` | boolean | On a cold miss, block the request until the snapshot loads (`true`) or serve a live delegate read while it reloads in the background (`false`). |
| `validate` | boolean | Validate the cached row count against the remote after each reload. |
| `search` | boolean | Answer `$search` queries from the cache (`true`) or forward them to the live remote (`false`). |

Auto-applied tag: `federation:<entityName>` — use for entity-wide invalidation via `cache.deleteByTag('federation:Customers')`.

If `cds-caching` is not installed, **`strategy: 'response'`** caching is silently ignored with a warning. **`strategy: 'entity'`** requires **`cds-data-pipeline`** (`@cap-js/sqlite` when you target SQLite): cache tables bind to **`db`** by default, or **`cds.requires.FederationEntityCache`** once you declare a secondary datastore; reload/SQL failures fall back to live delegation.

See [Integration → cds-caching](../integration/caching.md) for tag patterns, custom-cache-service setup, and the `response` vs. `entity` trade-off table.

## Server-driven paging (delegate)

Remote OData services that enforce a per-request cap below the client's requested `$top` (for example Northwind returns at most 20 rows per request regardless of `$top`) are handled transparently. The delegate handler auto-loops the remote via `$top` / `$skip` until either the client's requested rows are collected or the remote returns an empty batch. `@odata.count` from the first batch is preserved so OData clients still see the correct total.

There is no annotation option to enable or tune this — it is always on for `@federation.delegate` reads. Internal defaults: `pageSize = 1000` (rows per remote request), `maxPages = 1000` (safety cap — about 1M rows maximum per client request).

## Full example

```cds
using { ProviderService as remote } from './external/ProviderService';

service MyService {

    // Plain delegate, read-only, no cache
    @federation.delegate
    entity Customers as projection on remote.Customers;

    // Writable delegate with cache
    @federation.delegate: { writable: true, cache: { ttl: 5000 } }
    entity Products as projection on remote.Products {
        ID    as productId,
        name  as productName,
        price as unitPrice,
        currency
    };

    // Scheduled replicate with delta
    @federation.replicate: {
        schedule: 600000,
        delta: { field: 'modifiedAt', mode: 'timestamp' }
    }
    entity ReplicatedCustomers as projection on remote.Customers;

    // Selective CUD
    @federation.delegate: { create: true, update: true }
    entity Partners as projection on remote.Partners { ... };

}
```

## See also

- [Concepts → Consumption Views](../concepts/consumption-views.md) — what the projection declares vs. what the annotation declares.
- [Reference → Features](features.md) — consumer-facing capability overview.
- [cds-data-pipeline Management Service](/pipeline/reference/management-service) — OData endpoints and programmatic API for pipelines bound to `@federation.replicate` entities.
