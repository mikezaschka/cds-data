# Built-in replicate

**When to pick this recipe:** source is a service the plugin already speaks (OData V2 / V4, REST, or a CQN-native service), target is the local DB or a remote OData service, and you want row-preserving copy — one source row produces one target row, possibly filtered, projected, renamed. No custom code.

This is the "replicate" use-case label — [Concepts → Inference rules](../concepts/inference.md) gives the formal rules. The pipeline is entity-shape because `source.entity` (or `rest.path`) is set and `source.query` is absent.

## To the local DB

### Consumption-view target

The idiomatic CAP pattern is to declare the target with a **consumption view** — a `projection on <remote.Entity>` annotated with `@cds.persistence.table`. The projection defines the target schema, column restriction, renames, and optional static `where`. At `addPipeline` time, **`viewMapping` is inferred** from that projection when you omit it (same extraction idea as `cds-data-federation`). See [Concepts → Consumption views](../concepts/consumption-views.md) and the capire [CAP-level Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation).

```cds
using { S4 } from '../srv/external/API_BUSINESS_PARTNER';

@cds.persistence.table
entity Customers as projection on S4.A_BusinessPartner {
    BusinessPartner as ID,
    PersonFullName  as Name,
    LastChangeDate  as modifiedAt,
} where BusinessPartnerCategory = '1';
```

### Pipeline registration

```javascript
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'Customers',
        source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
        target: { entity: 'db.Customers' },
        // viewMapping omitted — inferred from the consumption view on db.Customers
        delta: { field: 'LastChangeDate', mode: 'timestamp' },
        schedule: 600000, // every 10 minutes
    });
};
```

`delta.field` is the **remote** watermark field. To duplicate the mapping in code (optional):

```javascript
await pipelines.addPipeline({
    name: 'Customers',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.Customers' },
    viewMapping: {
        isWildcard: false,
        projectedColumns: ['BusinessPartner', 'PersonFullName', 'LastChangeDate'],
        remoteToLocal: {
            BusinessPartner: 'ID',
            PersonFullName:  'Name',
            LastChangeDate:  'modifiedAt',
        },
    },
    delta: { field: 'LastChangeDate', mode: 'timestamp' },
    schedule: 600000,
});
```

The source adapter is selected from the connected source service's kind (or an explicit `source.kind`):

| Source transport | Adapter | Notes |
|---|---|---|
| `kind: 'odata' \| 'odata-v2'` | `ODataAdapter` | All three delta modes supported. See [OData V2 / V4 adapter](../sources/odata.md). |
| `kind: 'rest'` | `RestAdapter` | Cursor / offset / page pagination, timestamp delta via URL params. See [REST adapter](../sources/rest.md). |
| `kind: 'cqn' \| 'postgres' \| 'hana' \| 'sqlite' \| …` | `CqnAdapter` | In-process CAP services and CQN-native DB bindings. See [CQN adapter](../sources/cqn.md). |

Target adapter selection: with `target.service` unset (or `'db'`), the default [`DbTargetAdapter`](../targets/db.md) is used. No `target.adapter` required.

## To a remote OData target

If the destination is an OData service — you are "moving" data from one CAP-visible system to another — no custom adapter is needed either. Point `target.service` at a CAP service registered with `kind: 'odata'` (or `'odata-v2'`) and [`ODataTargetAdapter`](../targets/odata.md) is used automatically.

```javascript
await pipelines.addPipeline({
    name: 'CustomersToCrm',
    source: { service: 'OrdersOData', entity: 'Orders' },
    target: {
        service: 'CrmOData',
        entity: 'Customers',
        // kind: 'odata',       // optional; auto-detected from the connected service
        // batchSize: 500,      // optional; page size for key scans + write chunks
        // keyColumns: ['ID'],  // optional; defaults to CDS model keys
    },
    mode: 'delta',
});
```

The OData target adapter routes writes through CAP's remote runtime (POST / PUT / PATCH / DELETE, with `$batch` change sets where supported) and supports `mode: 'delta'`, `mode: 'full'`, and `source.query` snapshots. OData has no bulk DELETE, so `truncate` and `deleteSlice` are `O(n)` round-trips on large targets — prefer `mode: 'delta'` for high-volume pipelines. See [Targets → OData](../targets/odata.md) for the full tuning table and known limitations.

## What happens at runtime

1. Schedule fires (or a manual `run` is dispatched via the management service).
2. `PIPELINE.READ` runs; the source adapter returns an async iterable of source batches, filtered by the delta watermark when the mode is `delta`.
3. For each batch: `PIPELINE.MAP_BATCH` applies view-mapping renames (via `viewMapping.remoteToLocal`) or any user MAP_BATCH hooks.
4. `PIPELINE.WRITE_BATCH` upserts the mapped rows into the target entity through the resolved target adapter. UPSERT is idempotent across re-runs.
5. The tracker row is updated with new `lastSync` / `lastKey` values.

## Constraints

- `source.entity` (or `rest.path` for REST sources) is required.
- `source.query` is not allowed — that signal switches into query-shape (materialize) mode. See [Built-in materialize](built-in-materialize.md).
- `mode` defaults to `'delta'`; pass `mode: 'full'` to force a wipe + full replay.

## See also

- [Concepts → Change history and pipeline replication](../concepts/change-tracking-and-pipeline.md) — `@cap-js/change-tracking` vs pipeline run semantics and DB UPSERT statistics.
- [Concepts → Consumption views](../concepts/consumption-views.md) — modeling the target as a projection on the remote entity.
- [Concepts → Inference rules](../concepts/inference.md).
- [Sources → OData V2 / V4](../sources/odata.md) · [REST](../sources/rest.md) · [CQN](../sources/cqn.md).
- [Targets → Local DB](../targets/db.md) · [OData](../targets/odata.md).
- [Reference → Management Service](../../reference/management-service.md).
