---
name: pipeline-hooks
description: Registers cds-data-pipeline event hooks on DataPipelineService. Use when customizing PIPELINE.READ, PIPELINE.MAP, PIPELINE.WRITE, filtering records, or extending pipeline behavior without forking the engine.
---

# Pipeline event hooks

## Lifecycle

```
PIPELINE.START → PIPELINE.READ → (PIPELINE.MAP_BATCH → PIPELINE.WRITE_BATCH)* → PIPELINE.DONE
```

Aliases: `PIPELINE.MAP` / `PIPELINE.WRITE` for batch handlers.

## Registration API

Use CAP's standard handler API scoped by pipeline name:

```javascript
const pipelines = await cds.connect.to('DataPipelineService');

pipelines.before('PIPELINE.MAP', 'LocalProducts', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => r.active);
});

pipelines.after('PIPELINE.DONE', 'LocalProducts', async (req) => {
    // post-run notification, cache invalidation, etc.
});
```

Pipeline name matches `addPipeline({ name: '...' })` or the federated entity name for `@federation.replicate` bindings.

## Federation-bound pipelines

When using `@federation.replicate`, consumers do not call `addPipeline` directly, but hooks still work:

```javascript
pipelines.before('PIPELINE.MAP', 'ReplicatedProducts', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});
```

## Anti-patterns

❌ **Wrong** — parallel custom hook system outside `DataPipelineService`.

✅ **Correct** — `before` / `on` / `after` on `PIPELINE.*` events.

❌ **Wrong** — synchronous outbox for CUD-like side effects that break request/response contracts in delegate flows.

✅ **Correct** — hooks for in-process MAP/WRITE transforms; use outbox only for fire-and-forget notifications.

❌ **Wrong** — SELECT-then-INSERT/UPDATE in custom WRITE handlers.

✅ **Correct** — use UPSERT patterns the engine provides; transform in MAP.

## Docs

- Event hooks recipe: https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/event-hooks.html
