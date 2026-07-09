---
name: add-pipeline
description: Registers cds-data-pipeline jobs via addPipeline with correct source and target shapes. Use when creating replicate, materialize, or move-to-service pipelines, configuring delta sync, schedules, or REST/OData sources.
---

# addPipeline

## Entity-shape replicate (most common)

```javascript
await pipelines.addPipeline({
    name: 'LocalProducts',
    source: { service: 'northwind', entity: 'northwind.Products' },
    target: { entity: 'db.LocalProducts' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
    schedule: 600_000,
});
// Inferred: entity-shape, mode=delta, DbTargetAdapter
```

Model the target as a consumption view with `@cds.persistence.table`:

```cds
@cds.persistence.table
entity LocalProducts as projection on northwind.Products {
    ProductID, ProductName, UnitPrice
} where Discontinued = false;
```

## Query-shape materialize

```javascript
await pipelines.addPipeline({
    name: 'DailyCustomerRevenue',
    source: {
        service: 'db',
        query: SELECT.from('sales.Orders')
            .columns('customerId', { func: 'sum', args: [{ ref: ['amount'] }], as: 'totalAmount' })
            .groupBy('customerId'),
    },
    target: { entity: 'db.DailyCustomerRevenue' },
    schedule: '0 2 * * *',
});
// Inferred: query-shape, mode=full
```

Prefer `@materialize.snapshot` on a CDS projection when the aggregate is declarative — see `cds-data-materialization`.

## Inference rules (summary)

| Config | Read shape | Defaults |
|---|---|---|
| `source.query` only | Query-shape | `mode: 'full'` |
| `source.entity` or `rest.path` | Entity-shape | `mode: 'delta'`, `delta.field: 'modifiedAt'` |
| Both query and entity | Error | — |
| Neither | Error | — |

**Do not pass `kind`** — intent is derived from shape.

## Run retention (optional)

When global housekeeping is enabled in `cds.requires.datapipeline.housekeeping`, override counts per pipeline:

```javascript
await pipelines.addPipeline({
    name: 'HighVolumeOrders',
    source: { service: 'OrdersService', entity: 'Orders' },
    target: { entity: 'db.ArchivedOrders' },
    retention: { retentionDays: 30, maxRuns: 200 },
});
```

See [Run housekeeping](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/housekeeping.html).

## Initial load on startup (optional)

`preload` runs one sync right after registration so the target is not empty
between boot and the first scheduled tick. Independent of `schedule`.

```javascript
// Background initial load (does not block boot), uses the pipeline's mode.
await pipelines.addPipeline({
    name: 'LocalProducts',
    source: { service: 'northwind', entity: 'northwind.Products' },
    target: { entity: 'db.LocalProducts' },
    schedule: 600_000,
    preload: true,
});

// Force a full initial load and block boot until it finishes.
await pipelines.addPipeline({
    name: 'LocalProducts',
    source: { service: 'northwind', entity: 'northwind.Products' },
    target: { entity: 'db.LocalProducts' },
    preload: { mode: 'full', wait: true },
});
```

| `preload` | Behavior |
|---|---|
| `false` / omitted | No startup run (default). |
| `true` | Background run (`async`), pipeline's effective mode, boot not blocked. |
| `{ mode, wait }` | `mode` overrides the run mode; `wait: true` blocks `addPipeline` until the run finishes (failure propagates). |

Preload runs record `trigger: 'preload'` in `PipelineRuns`. A disabled pipeline skips its preload.

## REST source

```javascript
source: {
    service: 'RestProvider',
    rest: {
        path: '/api/items',
        pagination: { type: 'offset', pageSize: 100 },
        deltaParam: 'modifiedSince',
        dataPath: 'results',
    },
},
```

## Anti-patterns

❌ **Wrong**:

```javascript
await pipelines.addPipeline({ kind: 'replicate', name: 'X', ... });
```

✅ **Correct** — omit `kind`; use shape-appropriate `source` / `target`.

❌ **Wrong** — `source.query` + `mode: 'delta'`.

✅ **Correct** — snapshots rebuild fully; use entity-shape for row delta.

❌ **Wrong** — `target.service: 'RemoteOData'` without `target.adapter`.

✅ **Correct** — implement [custom target adapter](https://mikezaschka.github.io/cds-data/pipeline/guide/targets/custom.html) or write to `db`.

## Docs

- Inference: https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference.html
- OData source: https://mikezaschka.github.io/cds-data/pipeline/guide/sources/odata.html
