# REST Adapter

REST (plain JSON over HTTP) services have no CDS model. CAP cannot translate CQN queries to REST URL conventions — they vary per service. For that reason, REST is **replicate-only**: the plugin pulls data from the REST endpoint on a schedule and writes to the local database, after which normal CAP queries run against the local tables.

## Configuring a REST service

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

Unlike OData, REST services have no `model:` entry — there's nothing for CAP to compile.

## Annotating the consumption entity

Because there's no CDS model, the `projection on remote.X` clause is replaced by a **plain entity declaration** plus an explicit `source: '<service-name>'`:

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
entity ReplicatedRestCustomers {
    key ID      : String(10);
        name    : String(100);
        email   : String(100);
        country : String(3);
        modifiedAt : Timestamp;
}
```

The plugin reads records from the configured path, maps them by key, and upserts them into the local `ReplicatedRestCustomers` table.

## Pagination types

| `type` | How it works | Required config |
|---|---|---|
| `offset` | `?offset=0&limit=100`, `?offset=100&limit=100`, ... | `pageSize` |
| `page` | `?page=1&pageSize=100`, `?page=2&pageSize=100`, ... | `pageSize` |
| `cursor` | Response includes a next-cursor value; plugin follows it until empty. | `pageSize`, `cursorParam`, `cursorPath` |

### Offset pagination example

```cds
rest: {
    path: '/api/customers',
    pagination: { type: 'offset', pageSize: 100 }
}
```

Generates requests:

```
GET /api/customers?offset=0&limit=100
GET /api/customers?offset=100&limit=100
...
```

### Page pagination example

```cds
rest: {
    path: '/api/customers',
    pagination: { type: 'page', pageSize: 50 }
}
```

Generates:

```
GET /api/customers?page=1&pageSize=50
GET /api/customers?page=2&pageSize=50
...
```

### Cursor pagination example

```cds
rest: {
    path: '/api/events',
    pagination: {
        type: 'cursor',
        pageSize: 100,
        cursorParam: 'after',
        cursorPath: 'meta.nextCursor'
    }
}
```

First request: `GET /api/events?limit=100`. Each response includes `{ meta: { nextCursor: '...' } }` at the specified path; the plugin follows it until the field is absent or empty.

## Delta sync

REST adapter's delta mode adds a URL query parameter filter to each request:

```cds
rest: {
    path: '/api/customers',
    pagination: { type: 'offset', pageSize: 100 }
},
delta: { field: 'modifiedAt' },
mode: 'delta'
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

Set `dataPath: 'results'` to tell the plugin where the records live. Omit it if the response body is the array directly.

## Headers and auth

Any headers configured on the `cds.requires.<service>.credentials` block (or supplied via CAP's destination binding) are applied automatically. The plugin uses `srv.send()` internally, so any mechanism that works for plain `cds.connect.to('RestProvider').send(...)` works here — OAuth tokens, API keys, CSRF headers, etc.

## Limitations

- **No delegation.** REST is replicate-only.
- **No typed response mapping.** Field names in the REST response must match the entity's field names exactly (or use a custom `REPLICATE.MAP` hook to translate — see [Management Service → Programmatic API](../reference/management-service.md#programmatic-api)).
- **No server-side filtering beyond delta.** The plugin reads the full (paginated) dataset, modulo delta. Server-side `$filter` equivalents would require custom request shaping via hooks.

## See also

- [Getting Started → First Replication](../getting-started/first-replication.md) — end-to-end replicate walkthrough (OData variant).
- [Reference → Annotations](../reference/annotations.md#rest-config) — full `rest` option schema.
- [Reference → Management Service](../reference/management-service.md) — hook into READ / MAP / WRITE phases.
