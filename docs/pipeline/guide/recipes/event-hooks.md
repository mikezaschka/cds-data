# Event hooks (CAP-style)

**When to pick this recipe:** you need to customize a pipeline's behaviour in one or two lines — filter source rows, enrich mapped rows, stamp an audit column, publish a message after a successful write, react to run completion — and a full custom adapter would be overkill. `DataPipelineService` is a standard `cds.Service`, so the CAP-native `srv.before / on / after(event, pipelineName, handler)` API plugs straight into every phase.

This is the classic CAP pattern applied to the `PIPELINE.*` namespace — the lightest-weight extension point, with no class and no registration beyond `cds.connect.to('DataPipelineService')`.

## Hook surface at a glance

Five events fire per run. Two bracket the run (once), one sets up the source stream (once), and two fire per batch.

| Event | Fires | `req.data` |
|---|---|---|
| `PIPELINE.START` | Once per run, before READ | `runId`, `mode`, `trigger`, `config`, `tracker` |
| `PIPELINE.READ` | Once per run, before batch iteration | `runId`, `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `PIPELINE.MAP_BATCH` | Once per batch | `runId`, `batchIndex`, `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `PIPELINE.WRITE_BATCH` | Once per batch, after MAP_BATCH | `runId`, `batchIndex`, `targetRecords` (handler writes and sets `statistics`) |
| `PIPELINE.DONE` | Once per run, success or failure | `runId`, `status`, `mode`, `trigger`, `startTime`, `endTime`, `statistics`, `error?` |

`runId` is carried on every event's payload so handlers can correlate across phases — it's also the primary key on `PipelineRuns`.

Two semantic rules govern composition:

- **`on` replaces the built-in default.** Default `on` handlers exist for `PIPELINE.READ`, `PIPELINE.MAP_BATCH`, and `PIPELINE.WRITE_BATCH`; a user `on` takes over that slot entirely. `PIPELINE.START` and `PIPELINE.DONE` have no default — consumers add behaviour via any of `before` / `on` / `after`.
- **`before` and `after` layer on top.** They compose with whatever `on` handler is active (default or user-supplied). Use them whenever you want to extend rather than replace.

See [Reference → Management Service → Event hooks](../../reference/management-service.md#event-hooks) for the authoritative signature table.

## `PIPELINE.START`

Fires once per run after the concurrency guard acquires the tracker lock and the `PipelineRuns` row is inserted, just before the source stream is opened. Use for run-level setup, trace correlation, or vetoing a run.

### `before` — veto a run

```javascript
pipelines.before('PIPELINE.START', 'BusinessPartners', async (req) => {
    if (await maintenanceWindowActive()) {
        req.reject(503, 'Maintenance window active — skipping pipeline run');
    }
});
```

Rejecting the START request aborts the run before any READ happens. The tracker row transitions to `failed` with the rejection message and `PIPELINE.DONE` still fires with `status: 'failed'`.

### `after` — attach a correlation id

```javascript
pipelines.after('PIPELINE.START', 'BusinessPartners', async (_results, req) => {
    const span = tracer.startSpan(`pipeline.${req.data.pipeline}`, {
        attributes: { 'pipeline.runId': req.data.runId, 'pipeline.mode': req.data.mode },
    });
    spans.set(req.data.runId, span);
});
```

Pair with `after('PIPELINE.DONE', ...)` to close the span.

## `PIPELINE.READ`

Fires once per run. The default `on` resolves the source adapter and assigns `req.data.sourceStream = adapter.readStream(tracker)`. Rarely overridden — a custom transport belongs in a [custom source adapter](custom-source-adapter.md) so it can be reused across pipelines.

### `before` — tweak config or inspect the tracker

```javascript
pipelines.before('PIPELINE.READ', 'BusinessPartners', async (req) => {
    if (process.env.REPLAY_FROM) {
        req.data.config = {
            ...req.data.config,
            delta: { ...req.data.config.delta, lastSync: process.env.REPLAY_FROM },
        };
    }
});
```

`req.data.config` is the live config passed into the READ dispatch, so mutating it (or assigning a cloned override) steers the adapter without touching the stored tracker row.

### `after` — wrap the stream

```javascript
pipelines.after('PIPELINE.READ', 'BusinessPartners', async (_results, req) => {
    const upstream = req.data.sourceStream;
    req.data.sourceStream = (async function* () {
        let batches = 0;
        for await (const batch of upstream) {
            batches += 1;
            cds.log('pipeline').info(`batch ${batches} · ${batch.length} rows`);
            yield batch;
        }
    })();
});
```

Wrap the async iterable before MAP_BATCH pulls from it — useful for per-batch logging, throttling, or teeing rows into a debug sink.

## `PIPELINE.MAP_BATCH`

Fires once per batch. The default `on` applies `config.viewMapping.remoteToLocal` renames, stamps the multi-source `origin` if the target mixes in `sourced`, and shallow-clones every record into `req.data.targetRecords`. This is the event you override most often.

### `before` — filter source rows

```javascript
pipelines.before('PIPELINE.MAP_BATCH', 'BusinessPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});
```

Cheapest way to drop records — the default mapper will only see rows that survive the filter.

### `on` — full custom mapping

```javascript
pipelines.on('PIPELINE.MAP_BATCH', 'BusinessPartners', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(record => ({
        ID: record.BusinessPartner,
        name: record.BusinessPartnerFullName,
        sourceService: req.data.source.service,
    }));
});
```

Replacing the default is the right choice when the rename map would be more code than an inline transform, or when the target shape diverges structurally from the source.

### `after` — enrich the mapped batch

```javascript
pipelines.after('PIPELINE.MAP_BATCH', 'BusinessPartners', async (_results, req) => {
    req.data.targetRecords = req.data.targetRecords.map(r => ({
        ...r,
        classification: classify(r),
    }));
});
```

Layer on top of the default (or your own `on`) to add computed columns, hash rows for change detection, or attach enrichment looked up from another service.

## `PIPELINE.WRITE_BATCH`

Fires once per batch, after MAP_BATCH. The default `on` delegates to the resolved target adapter — `DbTargetAdapter.writeBatch` for local DB targets, `ODataTargetAdapter.writeBatch` for remote OData targets, or your custom adapter.

### `before` — normalize or stamp

```javascript
pipelines.before('PIPELINE.WRITE_BATCH', 'BusinessPartners', async (req) => {
    const now = new Date().toISOString();
    for (const row of req.data.targetRecords) {
        row.ingestedAt = now;
    }
});
```

Use for last-mile concerns that belong at the write boundary: audit columns, tenant stamping, final dedup.

### `on` — as a target-adapter alternative

This is the original motivation for surfacing write hooks: a one-off forwarding with no reusable adapter class. You still point the pipeline at a DB staging target so the default `DbTargetAdapter` drives `truncate` / `deleteSlice`, but the per-batch write is replaced by your handler.

```javascript
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'OrdersToReportingInline',
        source: { service: 'OrdersService', entity: 'Orders' },
        target: { entity: 'db.OrderFactsStaging' },
        mode: 'delta',
    });

    pipelines.on('PIPELINE.WRITE_BATCH', 'OrdersToReportingInline', async (req) => {
        const reporting = await cds.connect.to('ReportingService');
        const rows = req.data.targetRecords;
        await reporting.send({ event: 'OrderFacts.upsertBatch', data: { rows } });
        req.data.statistics = { created: rows.length, updated: 0, deleted: 0 };
    });
};
```

What happens at runtime:

1. Schedule fires, `PIPELINE.START` and `PIPELINE.READ` run, then batch iteration begins.
2. For each batch, `PIPELINE.MAP_BATCH` then `PIPELINE.WRITE_BATCH` fire. Your `on` handler runs instead of the default target adapter's `writeBatch` — the staging table is never actually written to.
3. The handler must set `req.data.statistics = { created, updated, deleted }` — the tracker reads those counts for per-run history.
4. If `mode: 'full'`, `DbTargetAdapter.truncate(target)` is still called against the staging table before the first batch. If you don't want that, point the target at a throwaway table or use a [custom target adapter](custom-target-adapter.md) instead.

When to prefer a [custom target adapter](custom-target-adapter.md) instead:

- **The forwarding will be reused.** An adapter is a class; a hook is inline code bound to one pipeline name.
- **You need capability gating.** A custom adapter can declare `batchInsert: false` and have `addPipeline` reject `source.query` at registration; a hook can only blow up at runtime.
- **You need `truncate` / `deleteSlice` to go somewhere sensible.** A hook leaves those on the default DB adapter pointing at whatever `target.entity` is. An adapter owns the clear path too.

Stick with the write hook when the forwarding is one-off (prototype, debug dump, migration) or when you specifically want to **compose** with the default `DbTargetAdapter` — e.g. write to a staging table *and* publish an event (`before` hook to enrich, `after` hook to publish, default `on` untouched).

### `after` — publish metrics or per-batch side-effects

```javascript
pipelines.after('PIPELINE.WRITE_BATCH', 'BusinessPartners', async (_results, req) => {
    const messaging = await cds.connect.to('messaging');
    await messaging.emit('BusinessPartners.batchWritten', {
        runId: req.data.runId,
        batchIndex: req.data.batchIndex,
        count: req.data.targetRecords.length,
        stats: req.data.statistics,
    });
});
```

Runs after the default (or overriding) write has committed — safe place to fan out notifications or record metrics once persistence is confirmed.

## `PIPELINE.DONE`

Fires once per run — on both success and failure — after the tracker row is finalized. Canonical hook for end-of-run notifications. Works uniformly for sync, async-spawn, async-queued, and scheduled runs.

### `after` — react to a completed run

```javascript
pipelines.after('PIPELINE.DONE', 'BusinessPartners', async (_results, req) => {
    const { runId, status, statistics, error } = req.data;
    const messaging = await cds.connect.to('messaging');

    if (status === 'completed') {
        await messaging.emit('BusinessPartners.runCompleted', { runId, statistics });
    } else {
        await messaging.emit('BusinessPartners.runFailed', { runId, error });
    }
});
```

`req.data.status` is `'completed'` or `'failed'`. On failure, `req.data.error` carries `{ message }` and the original error still propagates out of `pipelines.execute(...)` (or lands on the async `done` promise's rejection).

### `after` — close a trace span

```javascript
pipelines.after('PIPELINE.DONE', 'BusinessPartners', (_results, req) => {
    const span = spans.get(req.data.runId);
    if (!span) return;
    span.setAttributes({
        'pipeline.status': req.data.status,
        'pipeline.created': req.data.statistics.created,
        'pipeline.updated': req.data.statistics.updated,
    });
    span.end();
    spans.delete(req.data.runId);
});
```

Pair with `after('PIPELINE.START', ...)` to bracket the run with trace instrumentation.

## Ordering and composition

::: info Signature convention
Per CAP convention: `before` and `on` hooks receive `(req)`; `after` hooks receive `(results, req)`. For non-READ events `results` is usually `undefined`, so `after` hooks should read and mutate state on the second argument (`req.data`).
:::

::: info Ordering
Multiple hooks for the same `(event, path)` run in parallel. For sequential ordering, register with `srv.prepend(() => srv.before(...))`.
:::

## See also

- [Recipes → Custom source adapter](custom-source-adapter.md) — the reusable alternative when a `PIPELINE.READ` override would otherwise get copied across pipelines.
- [Recipes → Custom target adapter](custom-target-adapter.md) — the reusable, capability-gated alternative to a `PIPELINE.WRITE_BATCH` override.
- [Reference → Management Service → Event hooks](../../reference/management-service.md#event-hooks) — authoritative signature and `req.data` reference.
- [Concepts → Terminology → Event namespace](../concepts/terminology.md#event-namespace) — `PIPELINE.*` hook semantics.
