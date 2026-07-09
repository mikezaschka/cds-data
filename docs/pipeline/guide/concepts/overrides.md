# Configuration overrides

Coded `addPipeline({ ... })` remains the source of truth for **structure** (source entity/service, target, adapters, query closures, view mapping). Tunable operational knobs can be **overridden at runtime** through the management API and the Pipeline Console. Overrides are persisted in the tracker and re-applied after every process restart — because pipelines always re-register from code on boot, the engine loads the stored JSON delta in `_ensureTracker` and layers it onto the fresh coded baseline.

```
coded addPipeline(config)
        │
        ▼
  baseConfig  (normalized, in-memory + tracker.baseConfig)
        │
        │  deep-merge with
        ▼
  overrides   (tracker.overrides JSON)
        │
        ▼
  effective = Pipeline.config  (what runs actually use)
```

## Overridable fields

| Path | Effect |
|---|---|
| `enabled` | Pause scheduled ticks (`false`); manual `start` / `execute` still run |
| `mode` | Default run mode (`delta` / `full` / `partial-refresh`) |
| `schedule` | Interval (ms / time string), cron, and `engine` (`spawn` \| `queued`) |
| `retention.retentionDays` / `retention.maxRuns` | Per-pipeline run-history retention (requires global `housekeeping` config). See [Run housekeeping](housekeeping.md). |
| `delta.mode` / `delta.field` / `delta.dateField` / `delta.timeField` | Watermark strategy for entity-shape reads |
| `source.batchSize` / `source.delay` / `source.maxRetries` / `source.retryDelay` | Paging and retry tuning |
| `flags` | Entity-cache truncate flags |
| `description` | UI label |

Anything else is rejected (`source.entity`, `target.*`, `viewMapping`, `source.query`, `refresh.slice`, custom adapters, …). Structural changes require a code change and redeploy.

## Live schedule changes

| Engine | Live stop/restart without process restart? |
|---|---|
| `spawn` (interval) | Always — `clearInterval` + restart |
| `queued` (cron / CAP Event Queues) | Only when the runtime supports named-task `unschedule` (CDS 10+). On CDS 9 anonymous queues, change requires restart (or switch to `spawn`). |

`configView().meta.scheduleLiveChangeSupported` surfaces this per pipeline so the console can warn before a doomed call.

## API surface

On `DataPipelineService` (programmatic) and bound on `/pipeline/Pipelines(...)`:

- `setOverrides(patch)` / `clearOverrides(keys?)` — merge or clear the JSON delta
- `setEnabled(boolean)` — convenience for the pause toggle
- `setSchedule({ every, cron, engine })` / `clearSchedule()` — schedule overrides (persisted)
- `configView()` — `{ base, overrides, effective, fields[], meta }` for the coded-vs-override-vs-effective diff

See [Management Service](../../reference/management-service.md) for OData payloads and [Pipeline Console](../pipeline-console.md) for the UI.
