# Internal scheduling with the queued engine

**When to pick this recipe:** you want a schedule owned by the CAP app (not an external service), you run the app with more than one instance, and you want the schedule to survive restarts, retry on failure, and fire **only once per tick across all instances**. This is the right upgrade from `schedule: <ms>` for production-grade deployments that don't justify the operational overhead of an external scheduler.

The queued engine is backed by CAP's persistent task queue: the schedule message is stored in `cds.outbox.Messages` and dispatched exactly once per interval.

::: warning Alpha API
The underlying `.schedule()` / `.every()` API is marked experimental in the [CAP task scheduling docs](https://cap.cloud.sap/docs/node.js/queue#task-scheduling). Semantics may still change. For workloads that can't absorb churn, prefer the default `spawn` engine or an external trigger.
:::

## Engines at a glance

| Engine | Cross-instance single-winner | Persistent across restarts | Retry + dead-letter | Requires outbox table |
|---|---|---|---|---|
| `spawn` (default) | No — each instance fires | No | No | No |
| `queued` (opt-in) | Yes | Yes | Yes | Yes |
| External trigger (JSS / CronJob) | Yes | Yes | Managed by the scheduler | No |

If you only run a single app instance and tolerate best-effort scheduling, `spawn` is fine. If you run more than one instance and want predictable cadence, pick `queued` or an external trigger.

## 1. Ensure the outbox table is deployed

The queued engine stores messages in `cds.outbox.Messages`, shipped as part of `@sap/cds/srv/outbox`. In a standard CAP project layout (`db/`, `srv/`, `app/`) this is picked up automatically by `cds build`. If you override `requires.db.model` in `package.json`, add the outbox model explicitly:

```jsonc
{
  "cds": {
    "requires": {
      "db": {
        "kind": "hana",
        "model": [ "db", "srv", "@sap/cds/srv/outbox" ]
      }
    }
  }
}
```

For HANA HDI, the table is deployed by your HDI container alongside the rest of the CDS model — no extra steps beyond including the model path.

For SQLite / local dev, `cds deploy` picks it up automatically. If you see *"Messages table not found"* at runtime, the most common cause is an overridden `model` that drops the outbox path — see the CAP docs [Messages Table Not Found](https://cap.cloud.sap/docs/node.js/queue#messages-table-not-found).

## 2. Register with `engine: 'queued'`

```javascript
const cds = require('@sap/cds');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'BusinessPartners',
        source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
        target: { entity: 'db.BusinessPartners' },
        delta: { field: 'modifiedAt', mode: 'timestamp' },
        schedule: { every: '10m', engine: 'queued' },
    });
};
```

The `schedule` field accepts three shapes:

- `schedule: 600000` — milliseconds (backwards-compatible, implicit `engine: 'spawn'`).
- `schedule: { every: 600000, engine: 'spawn' }` — explicit default.
- `schedule: { every: '10m', engine: 'queued' }` — persistent task queue. `every` accepts the same duration strings as `cds.queued().schedule().every()` (`'1min'`, `'10m'`, `'1h'`, ...) as well as millisecond numbers.

## 3. How `every` behaves

The queued engine's `.every('10m')` means **10 minutes after each processing completes**, not every 10 minutes on the wall clock. Implications:

- If a pipeline run takes 3 minutes, the next tick fires 10 minutes after that completion (13 minutes wall-clock).
- Overlapping fires are impossible — the task runner will not enqueue the next tick until the previous one finishes.
- This differs from `engine: 'spawn'` (`cds.spawn({ every })`), which fires on fixed wall-clock intervals regardless of run duration. The tracker's concurrency guard protects against overlap, but you still pay for wasted fires.

For most data pipelines "every 10 min after the last run" is the desired semantic — no thundering herd, no wasted queries.

## 4. Inspect failed runs

When the CAP task runner exhausts its retry budget (`maxAttempts`, default 20, configurable via `cds.requires.queue.maxAttempts`), the schedule message lands in the dead-letter queue — it stays in `cds.outbox.Messages` with `attempts >= maxAttempts`.

Independently, every pipeline run produces a `PipelineRuns` row via the usual tracker path. So you have two complementary views:

- `GET /pipeline/PipelineRuns?$filter=status eq 'failed'&$orderby=startTime desc` — the pipeline-level view. Each scheduled attempt shows `trigger='scheduled'`.
- A dead-letter queue inspection service over `cds.outbox.Messages` — the scheduling-level view. Useful if the pipeline itself never ran (e.g. the service couldn't be connected). See the CAP docs on [Managing the Dead Letter Queue](https://cap.cloud.sap/docs/node.js/queue#managing-the-dead-letter-queue).

## 5. Ad-hoc queued runs

The same queued engine is available for one-off runs through the programmatic API, without registering a `schedule`:

```javascript
const pipelines = await cds.connect.to('DataPipelineService');
await pipelines.execute('BusinessPartners', { async: true, engine: 'queued' });
```

Semantics mirror the scheduled path — the run is enqueued via `cds.queued(srv).emit('PIPELINE.TICK', ...)` and dispatched by a single app instance. Useful when you want cross-instance single-winner semantics for a manually triggered run (e.g. a BTP JSS-fired OData action that must not double-fire across replicas).

The returned envelope omits `done` because the run may execute on another instance — there's no in-process completion signal. Subscribe via `after('PIPELINE.DONE', name, ...)` for notifications, or poll `PipelineRuns` for the terminal state.

## 6. Coexistence

- **Mixing engines per pipeline is allowed.** One pipeline can use `engine: 'spawn'`, another `engine: 'queued'`, and a third can be externally triggered (no `schedule`).
- **Don't mix internal and external on the same pipeline.** Setting `schedule` on a pipeline that an external scheduler also calls results in double-firing. The concurrency guard prevents duplicate work but wastes resources.

## See also

- [External scheduling with SAP BTP Job Scheduling Service](external-scheduling-jss.md) — when centralized BTP-native cron is the better fit.
- [Reference → Management Service](../../reference/management-service.md) — the `execute` action JSS and scripts call, plus the `RunTrigger` enum.
- [CAP docs: Queueing with `cds.queued`](https://cap.cloud.sap/docs/node.js/queue) — task queue configuration (`maxAttempts`, `timeout`, `legacyLocking`, ...).
