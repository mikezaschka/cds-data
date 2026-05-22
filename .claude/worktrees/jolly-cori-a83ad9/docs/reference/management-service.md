# Management Service

The plugin exposes an OData service at `/federation` for inspecting and controlling federations at runtime.

## Entities

### `Federations`

One record per annotated `@federation.replicate` entity. Holds the tracker state used by the concurrency guard and delta sync.

```http
GET /federation/Federations
```

Returned fields include:

| Field | Description |
|---|---|
| `name` | Replication name (entity name). |
| `status` | `idle` \| `running` \| `error`. |
| `lastSync` | ISO timestamp of the last successful run. |
| `lastDeltaValue` | High-watermark value for delta mode. |
| `statistics` | Aggregated counts (created / updated / failed) across all runs. |

### `ReplicationRuns`

One record per execution — success or failure.

```http
GET /federation/ReplicationRuns?$filter=name eq 'ReplicatedPartners'&$orderby=startedAt desc
```

| Field | Description |
|---|---|
| `ID` | Run identifier. |
| `name` | Replication name. |
| `trigger` | `schedule` \| `manual` \| `startup`. |
| `mode` | `full` \| `delta`. |
| `startedAt` / `completedAt` | ISO timestamps. |
| `status` | `running` \| `completed` \| `failed`. |
| `statistics` | Per-run created / updated / failed counts. |
| `error` | Error message for failed runs. |

## Actions

### `run`

Manually trigger a replication.

```http
POST /federation/run
Content-Type: application/json

{ "name": "ReplicatedPartners", "mode": "full" }
```

`mode` is optional (defaults to the annotation's configured mode).

### `flush`

Clear the local replicated data and reset the tracker — next run will be a full sync.

```http
POST /federation/flush
Content-Type: application/json

{ "name": "ReplicatedPartners" }
```

### `status`

Fetch a single tracker record by name.

```http
GET /federation/status(name='ReplicatedPartners')
```

## Programmatic API

`DataReplicationService` is a standard `cds.Service` — resolve it via `cds.connect.to('DataReplicationService')` and register hooks via the standard CAP API.

```javascript
const cds = require('@sap/cds');

const federation = await cds.connect.to('DataReplicationService');

// Filter records before MAP (before hooks receive the request only)
federation.before('REPLICATE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Custom MAP default — overrides the built-in rename mapping
federation.on('REPLICATE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(record => ({
        ID: record.BusinessPartner,
        name: record.BusinessPartnerFullName,
        sourceService: req.data.source.service,
    }));
});

// Enrich after MAP (after hooks receive `(results, req)` per CAP convention)
federation.after('REPLICATE.MAP', 'ReplicatedPartners', async (_results, req) => {
    req.data.targetRecords = req.data.targetRecords.map(r => ({
        ...r,
        classification: classify(r),
    }));
});

// Define a replication configuration programmatically
await federation.addReplication({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { service: 'db', entity: 'db.BusinessPartners' },
    mode: 'delta',
    delta: { field: 'modifiedAt', mode: 'timestamp' },
});

// Run on demand
await federation.run('BusinessPartners');
```

### Event hooks

Pipeline events are namespaced to avoid collision with CAP's CRUD aliases (`READ`, `WRITE`):

| Event | Fires | `req.data` contains |
|---|---|---|
| `REPLICATE.READ` | Once per run, before batch iteration | `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `REPLICATE.MAP` | Once per batch | `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `REPLICATE.WRITE` | Once per batch, after MAP | `targetRecords` (handler writes and sets `statistics`) |

Hooks register via the standard CAP API: `srv.before/on/after(event, replicationName, handler)`.

!!! note "Signature convention"
    Per CAP convention: `before` and `on` hooks receive `(req)`; `after` hooks receive `(results, req)`. For non-READ events `results` is usually `undefined`, so `after` hooks should read and mutate state on the second argument (`req.data`).

!!! note "Ordering"
    Multiple hooks for the same `(event, path)` run in parallel via `Promise.all`. If you need sequential ordering, use `srv.prepend(() => srv.before(...))`.

### Cache invalidation

```javascript
const cache = await cds.connect.to('caching');
await cache.deleteByTag('federation:Customers');
```

Every federated entity gets an auto-applied `federation:<entityName>` tag. See [Integration → cds-caching](../integration/caching.md) for custom tags.

## See also

- [Getting Started → First Replication](../getting-started/first-replication.md) — hands-on walkthrough.
- [Reference → Annotations](annotations.md) — all annotation options.
- [Reference → Feature Matrix](requirements.md) — detailed status per feature.
