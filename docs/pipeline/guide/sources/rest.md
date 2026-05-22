# REST Adapter

REST (plain JSON over HTTP) services have no CDS model. CAP cannot translate CQN queries to REST URL conventions — they vary per service. The REST adapter therefore addresses its source by **path** rather than by entity reference: you point it at the endpoint, describe the pagination shape, and it pulls batches on a schedule into a target entity on the local database.

## Configuring a REST source

In `cds.requires`:

```json title="package.json"
{
  "cds": {
    "requires": {
      "RestProvider": {
        "kind": "rest",
        "credentials": {
          "url": "https://api.example.com",
          "headers": { "Authorization": "Bearer ..." }
        }
      }
    }
  }
}
```

Unlike OData, REST services have no `model:` entry — there is nothing for CAP to compile.

## Registering a REST pipeline

The pipeline addresses the source via `config.rest.path` instead of `source.entity`. `rest.path` alone is enough to mark the pipeline as entity-shape (see [Inference rules](../concepts/inference.md#registration-validation-matrix)).

```javascript
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'ReplicatedRestCustomers',
        source: { service: 'RestProvider' },
        target: { entity: 'db.ReplicatedRestCustomers' },
        rest: {
            path: '/api/customers',
            pagination: { type: 'offset', pageSize: 100 },
            deltaParam: 'modifiedSince',
            dataPath: 'results',
        },
        delta: { field: 'modifiedAt' },
        schedule: 600000,
    });
};
```

The target entity is a plain local table:

```cds
namespace db;

@cds.persistence.table
entity ReplicatedRestCustomers {
    key ID         : String(10);
        name       : String(100);
        email      : String(100);
        country    : String(3);
        modifiedAt : Timestamp;
}
```

The adapter reads records from the configured path, maps them by key, and upserts them into `db.ReplicatedRestCustomers`.

## Pagination types

| `type` | How it works | Required config |
|---|---|---|
| `offset` | `?offset=0&limit=100`, `?offset=100&limit=100`, … | `pageSize` |
| `page` | `?page=1&pageSize=100`, `?page=2&pageSize=100`, … | `pageSize` |
| `cursor` | Response includes a next-cursor value; adapter follows it until empty. | `pageSize`, `cursorParam`, `cursorPath` |

### Offset pagination example

```javascript
rest: {
    path: '/api/customers',
    pagination: { type: 'offset', pageSize: 100 },
}
```

Generates requests:

```
GET /api/customers?offset=0&limit=100
GET /api/customers?offset=100&limit=100
...
```

### Page pagination example

```javascript
rest: {
    path: '/api/customers',
    pagination: { type: 'page', pageSize: 50 },
}
```

Generates:

```
GET /api/customers?page=1&pageSize=50
GET /api/customers?page=2&pageSize=50
...
```

### Cursor pagination example

```javascript
rest: {
    path: '/api/events',
    pagination: {
        type: 'cursor',
        pageSize: 100,
        cursorParam: 'after',
        cursorPath: 'meta.nextCursor',
    },
}
```

First request: `GET /api/events?limit=100`. Each response includes `{ meta: { nextCursor: '...' } }` at the specified path; the adapter follows it until the field is absent or empty.

## Delta sync

The REST adapter supports `delta.mode: 'timestamp'` (the default). It adds a URL query parameter — named by `rest.deltaParam` — carrying the last successful run's `lastSync` watermark:

```javascript
rest: {
    path: '/api/customers',
    pagination: { type: 'offset', pageSize: 100 },
    deltaParam: 'modifiedSince',
},
delta: { field: 'modifiedAt' },
mode: 'delta',
```

Generates (after the first full sync):

```
GET /api/customers?offset=0&limit=100&modifiedSince=2026-04-17T12:00:00Z
```

The `deltaParam` name is service-specific — set it to whatever query parameter your service uses (`since`, `after`, `modifiedAfter`, etc.).

## `dataPath`

Many REST services wrap their record arrays in an envelope:

```json
{
  "results": [ { "ID": "C001", ... }, ... ],
  "totalCount": 1234,
  "meta": { "nextCursor": "..." }
}
```

Set `rest.dataPath: 'results'` to tell the adapter where the records live. Omit it if the response body is the array directly.

## Headers and auth

Any headers configured on the `cds.requires.<service>.credentials` block (or supplied via CAP's destination binding) are applied automatically. Any auth mechanism that works for plain `cds.connect.to('RestProvider').send(...)` works here — OAuth tokens, API keys, CSRF headers, etc.

## Mapping REST fields to target columns

Response field names must match the target entity's field names, or a `PIPELINE.MAP_BATCH` hook must translate:

```javascript
pipelines.on('PIPELINE.MAP_BATCH', 'ReplicatedRestCustomers', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(r => ({
        ID:         r.customer_id,
        name:       r.full_name,
        email:      r.email_address,
        country:    r.country_code,
        modifiedAt: r.updated_at,
    }));
});
```

See [Reference → Management Service → Event hooks](../../reference/management-service.md#event-hooks) for the full hook surface.

## Limitations

- **Entity-shape only.** Query-shape (materialize) pipelines require an adapter capable of executing a SELECT CQN; REST is replicate-only.
- **No typed response mapping.** Field names in the REST response must match the target entity's field names exactly, or a custom `PIPELINE.MAP_BATCH` hook must translate.
- **No server-side filtering beyond delta.** The adapter reads the full (paginated) dataset modulo the delta param. Server-side `$filter` equivalents would require custom request shaping via hooks.

## See also

- [Reference → Management Service](../../reference/management-service.md) — hook into READ / MAP / WRITE phases.
- [Sources → OData adapter](odata.md) — for services with a CDS model.
- [Concepts → Inference rules](../concepts/inference.md) — why `rest.path` counts as an entity-shape signal.
