# Management Service

`cds-data-pipeline` exposes an OData service at `/pipeline` for inspecting and controlling registered pipelines at runtime. Every pipeline registered via `addPipeline(...)` surfaces here with its tracker state, run history, and manual-trigger actions.

## Tracker schema

The tracker tables are exposed as a CDS model under namespace `plugin.data_pipeline`. They are materialized by `cds deploy` (SQLite) or the HDI deployer (HANA) — the plugin performs no runtime DDL.

```cds
namespace plugin.data_pipeline;

using { cuid } from '@sap/cds/common';

type ReplicationMode : String enum { delta; full; }
type RunStatus : String enum { idle; running; failed; }
type RunTrigger : String enum { manual; scheduled; external; event; }

@cds.persistence.table
entity Pipelines {
    key name       : String;
        source     : LargeString;         // JSON serialized source config
        target     : LargeString;         // JSON serialized target config
        mode       : ReplicationMode;
        lastSync   : Timestamp;
        lastKey    : String;
        status     : RunStatus default 'idle';
        errorCount : Integer default 0;
        lastError  : String;
        statistics : {
            created : Integer default 0;
            updated : Integer default 0;
            deleted : Integer default 0;
        };
        runs       : Composition of many PipelineRuns on runs.pipeline = $self;
}

@cds.persistence.table
entity PipelineRuns : cuid {
    pipeline   : Association to one Pipelines;
    status     : RunStatus;
    startTime  : Timestamp;
    endTime    : Timestamp;
    trigger    : RunTrigger;
    mode       : ReplicationMode;
    error      : LargeString;
    statistics : {
        created : Integer default 0;
        updated : Integer default 0;
        deleted : Integer default 0;
    };
}
```

The management OData service (`DataPipelineManagementService`, served at `/pipeline`) projects both tracker entities read-only. `Pipelines` also exposes **bound** actions: `start` (same semantics as `execute`, but keyed from the entity instance), `setSchedule` / `clearSchedule` for in-process `cds.spawn({ every })` intervals (not for `schedule.engine: 'queued'`), and the unbound actions `execute` and `flush`, plus the `status` function.

### Pipeline Console

The plugin ships a pre-built **Pipeline Console** UI (flexible column layout) that targets this OData service. Mount it from the npm package at `/pipeline-console` using CAP reuse-and-compose — see [Pipeline Console](../guide/pipeline-console.md).

The plugin ships **no** `@(requires: ...)` annotations on this service. Your application decides how `/pipeline` is secured: annotate projections and operations in consumer CDS, define XSUAA scopes and role templates in `xs-security.json`, use the application router, or a combination.

The full CDS (including `Common.ValueList` on the `start` parameters) is in the npm package at `srv/DataPipelineManagementService.cds`. Value-help rows for `PipelineRunModes` / `PipelineRunTriggers` are returned by `srv/DataPipelineManagementService.js` and are not stored in the database.

### Securing `/pipeline` in your app

After you add scopes and roles (for example a dedicated “pipeline runner” scope for schedulers), attach CAP authorization hints only in **your** model — for example annotate the projections that the plugin exposes:

```cds
using from 'cds-data-pipeline/srv/DataPipelineManagementService';

annotate DataPipelineManagementService.Pipelines with @(requires: 'authenticated-user');
annotate DataPipelineManagementService.PipelineRuns with @(requires: 'authenticated-user');
```

Use the same idea for mutating operations (`execute`, `start`, `flush`, `setSchedule`, `clearSchedule`) and for `status` as your threat model requires. Depending on your CAP version, that may be additional `annotate` targets, an `extend service` block, or app-level enforcement only.

## Entities

### `Pipelines`

One record per registered pipeline. Holds the tracker state used by the concurrency guard and delta sync.

```http
GET /pipeline/Pipelines
```

| Field | Description |
|---|---|
| `name` | Pipeline name (often the target entity name). |
| `source` | JSON-serialized source config (`service`, `entity`, `kind`, pagination, delta). Function values (`source.query`) are serialized as the marker string `"[Function]"`. |
| `target` | JSON-serialized target config (`service`, `entity`). |
| `mode` | Effective run mode — `delta` or `full`. |
| `lastSync` | ISO timestamp of the last successful run (delta watermark for timestamp mode). |
| `lastKey` | High-watermark key value for `key` delta mode. |
| `status` | `idle` \| `running` \| `failed`. The concurrency guard flips this to `running`; parallel trigger attempts are rejected. |
| `errorCount` | Cumulative count of failed runs since the last successful one. |
| `lastError` | Last error message (truncated). |
| `statistics` | Cumulative `created` / `updated` / `deleted` counts across all runs. |

### `PipelineRuns`

One record per execution — success or failure.

```http
GET /pipeline/PipelineRuns?$filter=pipeline_name eq 'BusinessPartners'&$orderby=startTime desc
```

| Field | Description |
|---|---|
| `ID` | Run identifier (`cuid`). |
| `pipeline` | Association to the owning `Pipelines` row (`pipeline_name` on the wire). |
| `trigger` | `manual` \| `scheduled` \| `external` \| `event`. `scheduled` is set by the in-process scheduler; `external` is set when the caller of `POST /pipeline/execute` passes `trigger: "external"` (used by BTP Job Scheduling Service, Kubernetes `CronJob`, ...). |
| `mode` | `full` \| `delta`. |
| `startTime` / `endTime` | ISO timestamps. |
| `status` | `running` \| `idle` \| `failed`. |
| `statistics` | Per-run `created` / `updated` / `deleted` counts. |
| `error` | Error payload (JSON) for failed runs. |

## Actions

### `start` (bound to `Pipelines`)

Triggers a run for the pipeline identified by the entity key (`name`). Use this shape when the client already has a `Pipelines` instance binding (for example a Fiori Elements **Start pipeline** action on the object page). `mode` and `trigger` use the tracker enums (`ReplicationMode`, `RunTrigger`). CAP still exposes OData action parameters as strings, so the UI gets **fixed-value dropdowns** via `Common.ValueList` / `ValueListWithFixedValues` on the `start` parameters, backed by the read-only, non-persisted entity sets **`PipelineRunModes`** and **`PipelineRunTriggers`** (served from static data in `DataPipelineManagementService.js`). Values outside those enums (for example `partial-refresh`) remain available only on unbound [`execute`](#execute).

```http
POST /pipeline/Pipelines('ReplicatedPartners')/DataPipelineManagementService.start
Content-Type: application/json

{
  "mode": "full",
  "trigger": "external",
  "async": true
}
```

Body properties are `mode`, `trigger`, and `async` (same meaning as in [`execute`](#execute)); the pipeline `name` comes from the URL key, not the body.

### `setSchedule` / `clearSchedule` (bound to `Pipelines`)

Control the **internal** interval registered with `addPipeline({ schedule: ... })` when using the default **spawn** engine (`cds.spawn({ every })`).

- **`setSchedule`**: pass `every` in **milliseconds** between delta runs. Replaces the current spawn timer if one exists, or starts one if the pipeline had no internal schedule in memory (for example you registered without `schedule` and add it only here — note: in-memory; process restart re-applies `addPipeline` from code only).
- **`clearSchedule`**: stops the spawn `setInterval` and clears the in-process schedule. **Not supported** for pipelines registered with `schedule.engine: 'queued'`; change those by adjusting config and restarting.

```http
POST /pipeline/Pipelines('ReplicatedPartners')/DataPipelineManagementService.setSchedule
Content-Type: application/json

{ "every": 600000 }
```

```http
POST /pipeline/Pipelines('ReplicatedPartners')/DataPipelineManagementService.clearSchedule
Content-Type: application/json

{}
```

Fiori Elements: the plugin’s [`srv/monitor-annotations.cds`](https://github.com/mikezaschka/cds-data-pipeline/blob/main/srv/monitor-annotations.cds) adds **Set internal schedule** and **Clear internal schedule** to the `Pipelines` identification (list and object page).

### `execute`

Trigger a pipeline execution. Used by scripts, tests, and external schedulers (SAP BTP Job Scheduling Service, Kubernetes `CronJob`, ...).

```http
POST /pipeline/execute
Content-Type: application/json

{
  "name": "ReplicatedPartners",
  "mode": "full",
  "trigger": "external",
  "async": true
}
```

Send `Authorization` (or any other headers your deployment expects) if you configured authentication on the management service.

| Parameter | Required | Default | Description |
|---|---|---|---|
| `name` | yes | — | Name of a pipeline registered via `addPipeline(...)`. |
| `mode` | no | `delta` (entity-shape) / `full` (query-shape) | Run mode for this invocation. |
| `trigger` | no | `manual` | Recorded as the `trigger` column on `PipelineRuns`. Whitelisted to the `RunTrigger` enum values. Use `external` for runs fired by an external scheduler so the run history is attributed correctly. |
| `async` | no | `false` | If `true`, the run is dispatched asynchronously (via `cds.spawn`) and the action returns `202 Accepted` immediately. Use this when the pipeline may exceed the caller's HTTP response window (JSS has a fixed timeout). Errors during the async run still land in `PipelineRuns`. |

See the external-trigger walkthrough at [Recipes → External scheduling with SAP BTP Job Scheduling Service](../guide/recipes/external-scheduling-jss.md).

### `flush`

Clear the local pipeline output and reset the tracker — next run will be a full sync.

```http
POST /pipeline/flush
Content-Type: application/json

{ "name": "ReplicatedPartners" }
```

### `status`

Fetch a single tracker record by name.

```http
GET /pipeline/status(name='ReplicatedPartners')
```

## Programmatic API

`DataPipelineService` is a standard `cds.Service` — resolve it via `cds.connect.to('DataPipelineService')` and register hooks via the standard CAP API.

```javascript
const cds = require('@sap/cds');

const pipelines = await cds.connect.to('DataPipelineService');

// Filter records before MAP (before hooks receive the request only)
pipelines.before('PIPELINE.MAP_BATCH', 'ReplicatedPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Custom MAP default — overrides the built-in rename mapping
pipelines.on('PIPELINE.MAP_BATCH', 'ReplicatedPartners', async (req) => {
    req.data.targetRecords = req.data.sourceRecords.map(record => ({
        ID: record.BusinessPartner,
        name: record.BusinessPartnerFullName,
        sourceService: req.data.source.service,
    }));
});

// Enrich after MAP (after hooks receive `(results, req)` per CAP convention)
pipelines.after('PIPELINE.MAP_BATCH', 'ReplicatedPartners', async (_results, req) => {
    req.data.targetRecords = req.data.targetRecords.map(r => ({
        ...r,
        classification: classify(r),
    }));
});

// Define a pipeline programmatically. Behaviour is inferred from the config
// shape (see Inference rules). `source.entity` + db target → entity-shape,
// mode 'delta', DbTargetAdapter on the write side.
await pipelines.addPipeline({
    name: 'BusinessPartners',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.BusinessPartners' },
    delta: { field: 'modifiedAt', mode: 'timestamp' },
});

// Run synchronously (blocks until the run finishes).
await pipelines.execute('BusinessPartners');

// Run asynchronously in-process — returns immediately with `{ runId, name, done }`.
const { runId, done } = await pipelines.execute('BusinessPartners', { async: true });
done.then(({ status, statistics }) => console.log(runId, status, statistics));

// Enqueue through the CAP persistent task queue — single-winner across
// app instances. No `done` because the run may execute on another instance;
// subscribe via `after('PIPELINE.DONE', ...)` for completion notifications.
await pipelines.execute('BusinessPartners', { async: true, engine: 'queued' });
```

### `execute` signature

```javascript
pipelines.execute(name, {
    mode,      // 'full' | 'delta' | 'partial-refresh'  — defaults from pipeline config
    trigger,   // 'manual' | 'scheduled' | 'external' | 'event'  (default 'manual')
    async,     // boolean — fire-and-forget when true (default false)
    engine,    // 'spawn' | 'queued' — only honored when async: true (default 'spawn')
});
```

Return envelope in all modes:

| Field | Type | When present |
|---|---|---|
| `runId` | `string` | Always. Correlates with `PipelineRuns.ID` and every `req.data.runId` in pipeline events. |
| `name` | `string` | Always. |
| `done` | `Promise<{ status, statistics }>` | Omitted only for `async: true, engine: 'queued'`. For sync calls `done` is already resolved; for async-spawn calls it's pending. Rejects on failure. Unobserved async rejections are also logged at error level. |

### Event hooks

Five events fire per run:

| Event | Fires | `req.data` contains |
|---|---|---|
| `PIPELINE.START` | Once per run, before READ | `runId`, `mode`, `trigger`, `config`, `tracker` |
| `PIPELINE.READ` | Once per run, before batch iteration | `runId`, `config`, `source`, `target` → handler sets `sourceStream` (async iterable) |
| `PIPELINE.MAP_BATCH` | Once per batch | `runId`, `batchIndex`, `sourceRecords`, `targetRecords` (handler fills `targetRecords`) |
| `PIPELINE.WRITE_BATCH` | Once per batch, after MAP_BATCH | `runId`, `batchIndex`, `targetRecords` (handler writes and sets `statistics`) |
| `PIPELINE.DONE` | Once per run, success or failure | `runId`, `status` (`'completed'` / `'failed'`), `mode`, `trigger`, `startTime`, `endTime`, `statistics`, `error?` |

Hooks register via the standard CAP API: `srv.before/on/after(event, pipelineName, handler)`. `PIPELINE.START` and `PIPELINE.DONE` have no built-in default handler — use `on` / `before` / `after` freely. `after('PIPELINE.DONE', name, handler)` is the canonical hook for end-of-run notifications and works uniformly for sync, async-spawn, async-queued, and scheduled runs.

::: info Signature convention
Per CAP convention: `before` and `on` hooks receive `(req)`; `after` hooks receive `(results, req)`. For non-READ events `results` is usually `undefined`, so `after` hooks should read and mutate state on the second argument (`req.data`).
:::

::: info Ordering
Multiple hooks for the same `(event, path)` run in parallel. For sequential ordering, register with `srv.prepend(() => srv.before(...))`.
:::

## See also

- [Pipeline Console](../guide/pipeline-console.md) — mount the pre-built UI from the npm package.
- [Reference → Features](features.md) — consumer-facing capability overview.
- [Concepts → Terminology](../guide/concepts/terminology.md) — the event namespace and tracker primitives.
- [Concepts → Inference rules](../guide/concepts/inference.md) — how `addPipeline(...)` derives behavior from the config shape.
