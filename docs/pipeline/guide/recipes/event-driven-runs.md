# Event-driven pipeline runs (ADR 0009)

**When to pick this recipe:** you already have (or plan) a **batch** pipeline for catch-up and initial load, and you also receive **change notifications** — CAP messaging, CloudEvents from SAP S/4HANA, SAP Event Mesh — that should upsert or delete individual rows **without** corrupting the batch delta watermark.

The engine reuses the same pipeline name, `viewMapping`, target adapter, and MAP/WRITE path. Event micro-runs are observable in `PipelineRuns` with `trigger: event`.

::: info Not the same as event hooks
[Event hooks](event-hooks.md) customize phases via `before` / `on` / `after` on `PIPELINE.*`. **Event-driven runs** enter through `DataPipelineService.execute` / `executeEvent` with a nested **`event`** object. You can combine both on the same pipeline.
:::

## Prerequisites

- A working **entity-shape** batch pipeline (see [Built-in replicate](built-in-replicate.md)).
- Query-shape (materialize) pipelines are **rejected** for event execute in v1.

## API surface

### `execute` extension

```javascript
await pipelines.execute('Shipments', {
    trigger: 'event',
    event: {
        read: 'key',           // or 'payload'
        action: 'upsert',      // or 'delete' (requires read: 'key' + keys)
        keys: { ID: '...' },   // source-side field names
        payload: { ... },      // source-shaped row(s) when read: 'payload'
    },
})
```

### `executeEvent` alias

Defaults `trigger: 'event'` and `event.action: 'upsert'`:

```javascript
await pipelines.executeEvent('Shipments', {
    event: { read: 'key', keys: { ID: shipmentId } },
})
```

Programmatic `execute` / `executeEvent` is the **primary** entry point in v1. `POST /pipeline/execute` with `trigger: 'event'` but **no** structured `event` payload is label-only and must not be used for real ingestion.

## Read strategies

| `event.read` | READ phase | Remote I/O |
|---|---|---|
| **`key`** | One-shot read from `source.entity` with `event.keys`, merged with the same `staticWhere` as batch | Yes — single SELECT/OData read |
| **`payload`** | Synthetic batch from `event.payload` | No — payload must already be source-shaped |

**Keys use source-side names** (remote / OData field names before MAP). If your notification carries a business id, map it to the primary key fields of `source.entity` in your handler.

## Write intent (`event.action`)

| Action | Behaviour |
|---|---|
| **`upsert`** (default) | Same MAP/WRITE as batch |
| **`delete`** | Removes target row(s) by key (maps through `viewMapping.remoteToLocal`; respects `sourced` origin if configured) |

`delete` with `read: 'payload'` is rejected in v1.

## Watermark policy

Successful **event** runs **do not** update `Pipelines.lastSync` or `lastKey` used for **batch** delta. Batch `execute` without an `event` object is unchanged.

Verify in the monitor: after an event run, `lastSync` stays at the last batch run time while new rows appear in `PipelineRuns` with `trigger: event`.

## Subscription pattern

Register messaging (or in-process service events) in your consumer and delegate to the pipeline:

```javascript
const cds = require('@sap/cds')

cds.on('served', async () => {
    const messaging = await cds.connect.to('messaging')
    const pipelines = await cds.connect.to('DataPipelineService')

    messaging.on('logistics.LogisticsService.ShipmentKeyTest', async (msg) => {
        const { ID } = msg.data
        await pipelines.executeEvent('Shipments', {
            event: { read: 'key', action: 'upsert', keys: { ID } },
        })
    })
})
```

Static scope from the consumption projection (`where` → `viewMapping.staticWhere`) applies to **`read: 'key'`** the same as batch — do not duplicate filters in JS.

## Validation (v1)

- `source.query` present → event execute rejected.
- `event.read` must be `'key'` or `'payload'`.
- `read: 'key'` requires non-empty `event.keys`.
- `read: 'payload'` with `upsert` requires `event.payload`.
- Event micro-runs with `async: true` and `engine: 'queued'` are rejected.

## Runnable example

[Example 07 — Event-driven runs](https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-pipeline/examples/07-event-driven-runs) — shared LogisticsService emit actions, file-based messaging bridge, batch baseline + key/payload/delete scenarios.

## See also

- [Change history and pipeline replication](../concepts/change-tracking-and-pipeline.md) — batch delta vs event micro-runs
- [Built-in replicate](built-in-replicate.md) — batch twin
- [Event hooks](event-hooks.md) — phase customization
- [Management Service](/pipeline/reference/management-service)
