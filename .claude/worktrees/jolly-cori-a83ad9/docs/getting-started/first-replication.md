# First Replication

This walkthrough copies remote data into your local database on a schedule. Afterwards, queries run fully locally — joinable, aggregatable, offline-capable.

## When to replicate instead of delegate

| You want | Pick |
|---|---|
| Up-to-the-second data | [Delegate](first-delegation.md) |
| Joins across remote data and local data in SQL | Replicate |
| Aggregations / analytics on remote data | Replicate |
| Resilience against remote outages | Replicate |
| Writes that must land in the system of record | [Delegate](first-delegation.md) (writable) |

## 1. Declare a replicate consumption view

```cds title="srv/external-service.cds"
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

service ExternalService {

    @federation.replicate: { schedule: 600000, delta: { field: 'LastChangeDateTime' } }
    entity ReplicatedPartners as projection on remote.A_BusinessPartner {
        BusinessPartner         as ID,
        BusinessPartnerFullName as name,
        BusinessPartnerCategory as category,
        LastChangeDateTime
    };

}
```

- `schedule: 600000` — re-sync every 10 minutes via `cds.spawn`. Omit for manual-only mode.
- `delta: { field: 'LastChangeDateTime' }` — only fetch records modified since the last successful run.
- The plugin turns this projection into a **local table** (`@cds.persistence.skip: false`, `@cds.persistence.table`).

## 2. Let the plugin create the tracker tables

The plugin ships with CDS aspects for its own tracking tables (`plugin.data_federation.Federations`, `plugin.data_federation.ReplicationRuns`). They're created on first deployment alongside your schema — no manual migration needed.

## 3. Boot the app

```bash
cds watch
```

On startup you'll see something like:

```
[cds-data-federation] scheduled replication ReplicatedPartners (every 600000ms)
[cds-data-federation] REPLICATE.READ ReplicatedPartners — initial full sync
[cds-data-federation] REPLICATE.WRITE ReplicatedPartners — 1234 records upserted
```

## 4. Query the local table

After the first sync:

```http
GET /external/ReplicatedPartners?$filter=category eq 'Z001'&$orderby=name
```

This is a plain local SQL query. Join with other local tables, aggregate, filter — everything SQL supports.

## Manual triggers and management

The plugin exposes an OData management service at `/federation`:

```http
POST /federation/run
Content-Type: application/json

{ "name": "ReplicatedPartners", "mode": "full" }
```

See [Reference → Management Service](../reference/management-service.md) for all management endpoints.

## What you get for free

- Idempotent `UPSERT` writes — re-runs produce no duplicates.
- Concurrency guard — overlapping runs are detected via an optimistic `UPDATE` on the tracker table and return early.
- Retry with exponential backoff + jitter (skips 4xx by default).
- Async generator streaming — large datasets are never loaded fully into memory.
- Three delta modes (`timestamp`, `key`, `datetime-fields`).
- REST adapter with `offset` / `cursor` / `page` pagination — see [Integration → REST Adapter](../integration/rest.md).

## Extending the pipeline

Hook into the `REPLICATE.READ` / `REPLICATE.MAP` / `REPLICATE.WRITE` phases via the standard CAP service API:

```javascript
const federation = await cds.connect.to('DataReplicationService');

federation.before('REPLICATE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});
```

See the [programmatic API reference](../reference/management-service.md#programmatic-api) for the full hook signature.

## Next steps

- [First Cache](first-cache.md) — add caching on top of delegate or replicate.
- [Reference → Management Service](../reference/management-service.md) — Federations / ReplicationRuns OData endpoints.
- [Integration → REST Adapter](../integration/rest.md) — replicate from services without a CDS model.
