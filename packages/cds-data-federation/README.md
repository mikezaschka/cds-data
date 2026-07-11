# cds-data-federation

[Documentation](/federation/) · [npm](https://www.npmjs.com/package/cds-data-federation)

The annotation-driven SAP CAP plugin for integrating external services into your application's data model — declarative, no handler code. Composes [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline) for scheduled sync.

## Scope

- `@federation.delegate` — live proxy. Reads (and optionally writes) forwarded to the remote service at request time. Cross-service `$expand`, navigation-filter rewriting, field/association renames, opt-in CUD forwarding.
- `@federation.replicate` — scheduled sync. Annotated consumption view is bound to an entity-shape pipeline on `cds-data-pipeline`; pipeline intent is derived from the config shape (see [inference rules](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference)).
- Optional delegate caching — default **`cache.strategy: 'response'`** via [`cds-caching`](https://github.com/mikezaschka/cds-caching) (`{ cache: { ttl: 60000 } }`), or **`cache.strategy: 'entity'`** for SQLite-backed full-entity snapshots (secondary `cds.requires` datasource + [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline)).
- Shipped `replicated` aspect (`lastReplicatedAt`, `lastReplicatedBy`) for consumer schemas.

## Install

```bash
# For @federation.replicate (and delegate):
npm add cds-data-federation cds-data-pipeline

# Delegate-only setups can omit the engine:
npm add cds-data-federation
```

Peer dependencies:

- `@sap/cds` >= 8 (required)
- `cds-data-pipeline` — required when you use `@federation.replicate`, **`cache.strategy: 'entity'`**, or custom pipeline hooks; loudly fails at replicate bind time if replicate is annotated but absent.
- `cds-caching` >= 1 (optional; only **`cache.strategy: 'response'`**, the default strategy)
- `@cap-js/sqlite` >= 2 (optional; only **`cache.strategy: 'entity'`** — secondary datastore + engine writes)
- `@sap-cloud-sdk/http-client` and `@sap-cloud-sdk/resilience` (required for OData remote services)

The plugin auto-activates on load via `cds-plugin.js`.

## The two strategies

| Strategy | Annotation | Behavior | Use when |
|---|---|---|---|
| Delegate | `@federation.delegate` | Transparent live proxy. Reads (and optionally writes) are forwarded to the remote service at request time. Read-only by default; CUD is opt-in per entity. | You need up-to-the-second data, writes must hit the system of record, or the remote dataset is too large to replicate. |
| Replicate | `@federation.replicate` | Scheduled sync that copies remote data into the local database. Queries afterwards run fully locally — joinable, aggregatable, offline-capable. | You need analytics, joins across sources, resilience against remote outages, or the remote service can't sustain live query load. |

## Core concept: consumption views

The CDS projection IS the federation contract. The `@federation.*` annotation declares runtime behavior; the projection declares the schema (fields, shape, renames). The plugin infers source, columns, and bidirectional rename mappings automatically.

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

// 1. Wildcard — all fields, no transformation
@federation.delegate
entity Customers as projection on remote.Customers;

// 2. Column restriction + field renames (excluded fields never fetched)
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// 3. Association renames — $expand=buyer becomes $expand=customer on the remote
@federation.delegate
entity Orders as projection on remote.Orders {
    ID        as orderId,
    customer  as buyer,
    product   as item,
    quantity,
    total     as amount,
    orderDate as placedOn
};

// 4. Entity-level rename — same remote data, different local purpose
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID    as supplierId,
    name  as companyName,
    city  as headquarters,
    email as contactEmail
};
```

A query `$filter=unitPrice gt 100` on `Products` transparently becomes `$filter=price gt 100` on the remote; results are mapped back. The same applies to `$select`, `$orderby`, `$expand`.

## Annotation reference

All options are declared inline on the annotation: `@federation.<strategy>: { ... }`.

### Common options

| Option | Type | Applies to | Description |
|---|---|---|---|
| `source` | string | both | Explicit remote service name. Required for REST; inferred from the projection for OData. |
| `cache` | object | both | Read caching wrapper. **`strategy`** optional — `'response'` (default, cds-caching) \| `'entity'` (SQLite replica via pipeline). Details in [Caching](/federation/integration/caching). |
| `writable` | boolean | delegate | Shorthand for `create: true, update: true, delete: true`. Read-only by default. |
| `create`, `update`, `delete` | boolean | delegate | Enable individual CUD operations. Individual flags override `writable`. Disabled ops return HTTP 405. |

### Cache option

```cds
@federation.delegate: { cache: {
    strategy: 'response',               // omit for cds-caching; set 'entity' for SQLite replica
    ttl: 60000,                        // milliseconds (both strategies)
    batchSize: 1000,                   // OData batch page size (`entity` strategy only — optional)
    service: 'longTermCache',          // cds-caching service name (`response` only — optional)
    tags: ['static-tag',               // cds-caching only
           { data: 'orderId', prefix: 'order-' },
           { value: 'order-data' },
           { template: '...' }]
} }
```

- **`response` strategy** relies on [`cds-caching`](https://github.com/mikezaschka/cds-caching). Auto-tag `federation:<entityName>`, invalidate via tags / `clear()`. Missing peer → warning + bypass.
- **`entity` strategy** requires `cds-data-pipeline`. Without `cds.requires.'data-federation-cache'`, cache tables attach to **`db`**; add the secondary SQLite datasource when you need physical isolation plus your own migrate/deploy tooling.

### Replicate options

| Option | Type | Description |
|---|---|---|
| `name` | string | Pipeline name shown in the management API / monitor. Defaults to the entity name. |
| `description` | string | Pipeline description shown in the management API / monitor. Defaults to `Federation replication of '<source>' into '<target>'`. |
| `mode` | `'full'` \| `'delta'` | Default `'full'`. Set `'delta'` for incremental sync. |
| `schedule` | number (ms) | Interval for `cds.spawn`. Omit for manual-only. |
| `delta` | object | `{ field, mode }`. Used only when `mode: 'delta'`. Defaults: `field: 'modifiedAt'`, `mode: 'timestamp'` (also `'key'`, `'datetime-fields'`). |
| `rest` | object | REST adapter config: `{ path, pagination: { type, pageSize }, deltaParam, dataPath }`. `type` is `offset` \| `cursor` \| `page`. |

### Examples

```cds
// Cached delegate (5s TTL)
@federation.delegate: { cache: { ttl: 5000 } }
entity CachedCustomers as projection on remote.Customers;

// Writable delegate, all CUD
@federation.delegate: { writable: true }
entity Customers as projection on remote.Customers { * };

// Selective CUD (create + update, no delete)
@federation.delegate: { create: true, update: true }
entity Partners as projection on remote.Partners { ... };

// Scheduled replicate with delta
@federation.replicate: { mode: 'delta', schedule: 600000, delta: { field: 'modifiedAt' } }
entity ReplicatedProducts as projection on remote.Products { ... };

// REST replicate (explicit source, no CDS model)
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

## What works through delegation

Query features handled transparently by the delegate handler:

- **`$filter`** with renames, comparison operators (`eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`), logical (`and`, `or`, `not`), string functions (`contains`, `startswith`, `endswith`, `tolower`, `toupper`).
- **`$orderby`, `$select`, `$top`, `$skip`, `$count`, `$search`** passthrough.
- **Lambda operators** `any()` / `all()` on to-many — including cross-service scenarios.
- **Navigation path filters** with renamed associations (e.g., `buyer/name` → `customer/name`).
- **Cross-service navigation filters**: `$filter=product/productName eq 'X'` on a local entity with an assoc to a federated entity.
- **Static `where` clause** in projections (e.g., `... where blocked = false`) injected into every remote query.
- **`excluding { ... }`** column restriction — excluded fields never fetched.
- **CQL / `cds.ql`** via the projection chain (tagged templates, `SELECT.one`, `.columns()`, `.where()`, `.orderBy()`, `.limit()`, key shortcuts).
- **Cross-service `$expand`** in all three directions — local → remote, remote → local, remote → remote. Plugin strips federated expand items, executes each side against the right service, and stitches by foreign key. Composite keys, to-many array grouping, nested expand with recursive rename, `$top`/`$skip` per-parent all supported.
- **Server-driven paging**: remote OData services that cap a single response below the client's `$top` are auto-looped via `$skip` until the client's rows are collected. `@odata.count` from the first batch is preserved.
- **CUD forwarding** (opt-in): `remote.run(req.query)` synchronous, preserves 201 / 200 / 204 contract. Disabled operations return HTTP 405.

### Protocols

| Protocol | Delegate | Replicate |
|---|---|---|
| OData V4 | yes | yes |
| OData V2 | yes | yes |
| HCQL | yes | yes |
| REST (plain JSON) | not supported (CAP does not translate CQN to REST) | yes (use `@federation.replicate` + `rest` config) |

## Composition with `cds-data-pipeline`

At `cds.on('loaded')`, the federation plugin scans CSN for `@federation.*` annotations. At `cds.once('served')` it:

1. Registers delegation handlers for `@federation.delegate` entities.
2. Resolves `DataPipelineService` from `cds-data-pipeline` and calls `addPipeline({ ... })` for each `@federation.replicate` entity via `srv/pipeline-binding.js`. The entity-shape config (`source.entity` + db target) lets the engine infer `kind: 'replicate'` and default `mode: 'full'`.

If `cds-data-pipeline` is not installed and a `@federation.replicate` config is present, boot fails fast with an actionable error message.

Consumers never interact with the pipeline engine directly when using `@federation.replicate` — the annotation is the surface. For custom MAP transformations on a federation-bound pipeline, use CAP hooks against `DataPipelineService`:

```javascript
const pipelines = await cds.connect.to('data-pipeline');
pipelines.before('PIPELINE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});
```

See the [`cds-data-pipeline` README](https://www.npmjs.com/package/cds-data-pipeline) for the full event-hook contract, the programmatic `addPipeline(...)` API (useful for non-federation sources), and the management OData service at `/pipeline`.

## Multi-tenancy (CAP MTX)

When running with `@sap/cds-mtxs`, entity-cache storage uses **one SQLite file per tenant** (configure `data-federation-cache` + `data-federation.entityCache.urlTemplate`). Scheduled `@federation.replicate` runs fan out per subscribed tenant; optional MTX subscribe hooks trigger initial sync. See [Multi-Tenancy](/federation/integration/multitenancy.md) in the docs site.

## AI assistants

This package ships agent guidance in the npm tarball:

- `node_modules/cds-data-federation/AGENTS.md` — index, decision trees, anti-patterns
- `node_modules/cds-data-federation/skills/` — task skills ([Agent Skills](https://agentskills.io) format)

To symlink skills into your agent workspace (Cursor, Claude Code, …):

```bash
npx skills-npm --include cds-data-federation
```

For live CDS model introspection, configure [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) in your project's MCP config.

## Related

- [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline) — the pipeline engine this plugin composes.
- [`cds-caching`](https://github.com/mikezaschka/cds-caching) — peer-dep caching plugin; optional, enabled by the `cache` option on either strategy.
