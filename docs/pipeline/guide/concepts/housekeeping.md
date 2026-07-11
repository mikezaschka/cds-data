# Run housekeeping

`cds-data-pipeline` records every pipeline execution in `plugin.data_pipeline.PipelineRuns`. Without retention, those rows accumulate indefinitely. Opt-in **housekeeping** prunes finished runs on a schedule using age- and count-based rules.

## Enable globally

Configure `housekeeping` on your `cds.requires['data-pipeline']` entry (or any requires entry with `impl: "cds-data-pipeline"`):

```json
{
  "cds": {
    "requires": {
      "data-pipeline": {
        "impl": "cds-data-pipeline",
        "housekeeping": {
          "retentionDays": 90,
          "maxRuns": 1000,
          "schedule": "0 3 * * *"
        }
      }
    }
  }
}
```

| Option | Purpose |
|---|---|
| `retentionDays` | Delete finished runs whose `endTime` is older than `now - retentionDays`. |
| `maxRuns` | Per pipeline, keep only the newest *N* finished runs (by `startTime`). |
| `schedule` | When the global sweep runs. Same shapes as pipeline `schedule`: ms number, time string (`"24h"`), 5-field cron, or `{ every, engine }`. Defaults to daily (`86400000` ms, `spawn` engine) when omitted. Cron requires `engine: 'queued'`. |

Housekeeping is **opt-in**: if neither `retentionDays` nor `maxRuns` is set, nothing is deleted and no timer is started.

Both retention axes apply when set (AND). A run must survive **both** checks to remain.

Runs with `status = 'running'` are never deleted.

## Per-pipeline override

Override the global counts for one pipeline in `addPipeline`:

```javascript
await pipelines.addPipeline({
  name: 'HighVolumeOrders',
  source: { service: 'OrdersService', entity: 'Orders' },
  target: { entity: 'db.ArchivedOrders' },
  retention: { maxRuns: 200 },
});
```

Per-pipeline `retention` overrides only the counts — the global `housekeeping.schedule` still drives the sweep timer. Values persist in the tracker `baseConfig` column and can be changed at runtime via `setOverrides` (same override mechanism as `schedule` and `delta.*`).

## Multitenancy

When `cds.env.requires['cds-data-pipeline'].multitenancy.fanOutScheduledRuns` is active, the housekeeping sweep runs once per subscribed tenant (same fan-out seam as scheduled pipeline ticks). Each tenant's tracker table is pruned in its own context.

## What is not deleted

- The `Pipelines` tracker row (pipeline configuration, cumulative statistics, watermarks).
- In-flight runs (`status = 'running'`).
- Skipped runs (never persisted — concurrency guard only).

## Related

- [Configuration overrides](overrides.md) — runtime `retention` changes via management API
- [Internal scheduling (queued engine)](../recipes/internal-scheduling-queued.md) — cron housekeeping schedules
- Management API: read-only `PipelineRuns` at `/pipeline/PipelineRuns`
