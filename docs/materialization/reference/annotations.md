# Annotations

::: warning Experimental — not yet released
`cds-data-materialization` is **experimental** and **not yet published to npm**. The `@materialize.snapshot` surface documented here may still change before the first release.
:::

## `@materialize.snapshot`

Marks an entity as a persisted snapshot rebuilt from an aggregation-shaped projection.

```cds
@materialize.snapshot: {
  schedule : '0 2 * * *',   // optional — passed to addPipeline
  refresh  : 'full',         // optional — v1 supports 'full' only
  name     : 'MyPipeline',   // optional — defaults to entity name
  source   : { service: 'db' }  // required when from ref is not Service.Entity
}
entity DailyRevenue as projection on Orders {
  key customerId,
  sum(amount) as totalAmount : Decimal(15, 2)
}
group by customerId;
```

### Options

| Option | Required | Description |
|---|---|---|
| `schedule` | No | Cron or interval string for `addPipeline` (engine scheduling) |
| `refresh` | No | Default `full` — rebuild entire snapshot each run |
| `preload` | No | `true` (or `{ mode, wait }`) builds the first snapshot at server startup instead of waiting for the first scheduled tick. `wait: true` blocks boot until it finishes. |
| `name` | No | Pipeline tracker name (default: entity name) |
| `source.service` | Sometimes | `cds.requires` key that runs the aggregate query (`db`, in-process service, …) |

Flattened CSN keys (`@materialize.snapshot.source.service`, …) are supported the same way as `@federation.replicate` options.

### Validation

- Projection must include `group by` or aggregate functions (`sum`, `count`, `min`, `max`, `avg`).
- Cannot combine with `@federation.*` on the same entity.
- Source `requires` kind must be CQN-native — not `odata` / `rest` for the aggregate read. **Replicate first**, then materialize locally.
- `refresh: 'partial'` from annotation is rejected in v1 (use programmatic `refresh.slice` on the engine until a future release).

### Compiler subset (v1)

Supported on the projection:

- Single-entity `projection on`
- Standard aggregates with `as` aliases
- `group by` on projected keys
- Optional static `where` on the projection (when present in CSN)

Rejected at scan time: path expressions in SELECT, expand/join columns, cross-source joins inside one materialization.

## `materialized` aspect

```cds
using { plugin.data_materialization as materialization } from 'cds-data-materialization';

entity DailyRevenue : materialization.materialized {
  key customerId : String(10);
  totalAmount    : Decimal(15, 2);
}
```

Adds `lastMaterializedAt` and `lastMaterializedBy` on insert (optional).
