# OData V2 / V4

The OData adapter reads entity-shape sources over OData V4, OData V2, or HCQL. It is selected automatically from the connected service's `kind`, or explicitly via `source.kind` on the pipeline config.

| Source `cds.requires.<service>.kind` | Adapter | Notes |
|---|---|---|
| `odata` (OData V4) | `ODataAdapter` | CAP-native CQN translation. Default. All three delta modes supported. |
| `odata-v2` | `ODataAdapter` | CAP-native; V2 returns decimals and `$count` as strings, which CAP converts. Provider apps exposing V2 typically use `@cap-js-community/odata-v2-adapter`. |
| `hcql` | `ODataAdapter` | SAP's Cloud Query Language protocol (e.g., xtravels sample). No gaps versus OData V4 for pipeline purposes. |
| `rest` | `RestAdapter` | Different adapter. See [REST adapter](rest.md). |

## Configuring an OData source

Declare the remote service in `cds.requires` as usual:

```json title="package.json"
{
  "cds": {
    "requires": {
      "API_BUSINESS_PARTNER": {
        "kind": "odata",
        "model": "./srv/external/API_BUSINESS_PARTNER",
        "credentials": { "url": "https://..." }
      }
    }
  }
}
```

Then register a pipeline against it:

```javascript
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'BusinessPartners',
        source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
        target: { entity: 'db.BusinessPartners' },
        delta: { mode: 'timestamp', field: 'modifiedAt' },
        schedule: 600000, // every 10 minutes
    });
};
```

Column restriction and `where` clauses flow through the standard CAP CQN-to-OData translation.

## Shape the target with a consumption view

The idiomatic CAP pattern for data federation is a **consumption view** — a local projection on the imported remote entity, annotated with `@cds.persistence.table` so CAP materializes it as a local table. The projection doubles as the target schema, column restriction, rename mapping, and filter predicate, all in one CDS declaration:

```cds
using { S4 } from '../srv/external/API_BUSINESS_PARTNER';

@cds.persistence.table
entity Customers as projection on S4.A_BusinessPartner {
    BusinessPartner as ID,
    PersonFullName  as Name,
    LastChangeDate  as modifiedAt,
} where BusinessPartnerCategory = '1';
```

Point the pipeline's `target.entity` at this view. If you **omit** `viewMapping`, the engine infers `projectedColumns` and `remoteToLocal` from the CDS projection; a static `where` on the view is AND-combined into the READ query (except when OData delta uses `datetime-fields`, which uses a string filter fragment).

```javascript
await pipelines.addPipeline({
    name: 'Customers',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.Customers' },
    delta: { mode: 'timestamp', field: 'LastChangeDate' },
});
```

The OData adapter honours `viewMapping.projectedColumns` on the `$select` it sends to the remote, so only the projected columns are pulled across the wire. The default `PIPELINE.MAP_BATCH` handler applies `viewMapping.remoteToLocal` to rename fields on each batch.

See [Concepts → Consumption views](../concepts/consumption-views.md) and the capire [CAP-level Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation) for the broader pattern. Consumption views are optional — you can also pass a fully-matching target table and no `viewMapping` — but they are the recommended default because they keep the target schema, the column selection, and the rename map in a single place.

## Delta modes

| Delta mode | Watermark | Filter shape |
|---|---|---|
| `timestamp` | `tracker.lastSync` (ISO timestamp) | `$filter=<field> gt <lastSync>` on `delta.field` (default `modifiedAt`). |
| `key` | `tracker.lastKey` (key value) | Filter + `$orderby` anchored on the configured key; paginated forward until the remote returns empty. |
| `datetime-fields` | Per-field timestamps in a composite watermark | Multi-field OR-filter for sources exposing several independently updated timestamps. |

All three are implemented for both OData V4 and V2.

## Server-driven paging

Some OData services cap the number of rows returned per request regardless of `$top` — Northwind, for example, returns at most 20 rows per page and signals the next page via `@odata.nextLink`. The adapter pages by `$top` / `$skip` (using `source.batchSize`, default `1000`) and keeps paging until the remote returns an empty batch, so a smaller server-enforced cap is handled transparently.

## CQL / CQN features supported on remote services

Everything supported by CAP's own `cqn2odata` translator works — notably:

- `$filter` operators: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`, `and`, `or`, `not`.
- String functions: `contains`, `startswith`, `endswith`, `tolower`, `toupper`.
- `$orderby`, `$select`, `$top`, `$skip`, `$count`, `$search`.

### What doesn't work on remote services

These are CAP-platform limitations surfaced through the OData adapter:

| Feature | Why | Workaround |
|---|---|---|
| `.where({ field: { like: '%X%' } })` | OData `$filter` has no `like` keyword. | Use `contains(...)`, `startswith(...)`, `endswith(...)` via HTTP `$filter`. |
| `SELECT.distinct` | CAP's `cqn2odata` rejects `.distinct`. | Deduplicate in a `PIPELINE.MAP_BATCH` hook, or replicate and query the local copy. |
| `.groupBy()` / `.having()` / `$apply` | CAP rejects aggregation on remote services. | Aggregate in-app (a materialize-shape pipeline against a local copy), or replicate and use local SQL. |
| `forUpdate()` / `forShareLock()` | DB concept, not OData. | Use ETags for optimistic concurrency. |
| `pipeline()` / `stream()` / `foreach()` | Only implemented by `DatabaseService`. | Fetch the full result set via paginated batches. |

## V2-specific limitations

| Feature | V2 behavior |
|---|---|
| Nested `$expand` options (`$filter`, `$orderby`, `$top`, `$skip` inside an expand) | **Not supported** by the V2 protocol itself. These work on V4 only. |
| `$count` | Returned as a string on the wire; surfaced as `Number`. |
| Decimals | Returned as strings on the wire; CAP handles conversion. |

## Authentication

The adapter does not touch credential handling. Use CAP's standard mechanisms:

- `credentials` block in `cds.requires.<service>`.
- SAP Cloud SDK destination binding (BTP).
- JWT principal propagation.
- Service bindings via `~/.cds-services.json` for local development.

Any auth setup that works with plain `cds.connect.to(...)` + `srv.run(...)` works transparently through the adapter — there is no intermediary.

## See also

- [Sources → REST adapter](rest.md) — services without a CDS model.
- [Sources → CQN adapter](cqn.md) — in-process CAP services and `cds.requires` DB bindings.
- [Concepts → Terminology](../concepts/terminology.md) — delta strategies in detail.
- [Reference → Management Service](../../reference/management-service.md) — programmatic `addPipeline` API.
