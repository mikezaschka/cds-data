# Programmatic API

The pipeline engine is a CDS service you connect to and drive from code. This page is the reference for the public `DataPipelineService` API: registering pipelines, running them, managing schedules and overrides, and registering event hooks.

The engine itself has **no OData surface** (`@protocol: 'none'`) — for the HTTP management API, see [Management service](./management-service.md). When you use `@federation.replicate` or `@materialize.snapshot`, the annotation plugins call `addPipeline` for you; you only touch this API directly for programmatic pipelines or event hooks.

## Connecting

```javascript
const pipelines = await cds.connect.to('datapipeline')
// 'DataPipelineService' is an accepted alias
```

Connect inside `cds.on('served', …)` in `server.js`, after the model is loaded.

## `addPipeline(config)`

Registers a pipeline: validates and normalizes the config, initializes its tracker row, starts its schedule (if any), and optionally runs an initial load. Returns once registration is complete (or, with `preload.wait`, once the initial load finishes).

```javascript
await pipelines.addPipeline({
  name: 'NorthwindProducts',
  source: { service: 'northwind', entity: 'Products' },
  target: { entity: 'my.app.LocalProducts' },
  mode: 'full',
  schedule: 600_000,
})
```

You do **not** pass a `kind` — the engine derives the shape (replicate / materialize / move) from the config. See [Inference rules](/pipeline/guide/concepts/inference).

### Top-level options

| Option | Type / default | Notes |
|---|---|---|
| `name` | `string` **(required)** | Unique pipeline id and tracker key. |
| `description` | `string?` (max 1024 chars) | Stored on the tracker; shown in the console. |
| `source` | `object` **(required)** | Read side — see [`source`](#source). |
| `target` | `object` **(required)** | Write side — see [`target`](#target). |
| `mode` | `'delta' \| 'full' \| 'partial-refresh'` | Default: `'delta'` for entity-shape, `'full'` for query-shape. |
| `delta` | `object` | Delta detection — see [`delta`](#delta). |
| `schedule` | `number \| string \| object \| null` | Internal schedule — see [`schedule`](#schedule). Omit for manual/external runs. |
| `viewMapping` | `object` | Column/rename mapping. Inferred from the target consumption view if omitted. |
| `refresh` | `'full' \| { mode: 'partial', slice }` | Query-shape rebuild strategy; `slice` is required for partial refresh. |
| `retention` | `{ retentionDays?, maxRuns? }` | Per-pipeline run-history retention (overrides the global housekeeping policy). |
| `preload` | `boolean \| { mode?, wait? }` | Initial load at startup — see [`preload`](#preload). |
| `flags` | `object?` | Advanced integration flags (e.g. entity-cache behavior for federation). Rarely set directly. |

### `source`

| Field | Default | Purpose |
|---|---|---|
| `service` | — | Connected service name (`cds.requires` key). |
| `entity` | — | Entity-shape read. Mutually exclusive with `query`. |
| `query` | — | Query-shape read: a closure `(tracker) => SELECT …`. |
| `kind` | auto | `'cqn' \| 'odata' \| 'odata-v2' \| 'hcql' \| 'rest'`. Usually inferred from the service. |
| `adapter` | — | Custom `BaseSourceAdapter` subclass — see [Custom source adapter](/pipeline/guide/sources/custom). |
| `origin` | — | Multi-source fan-in label; requires the `sourced` aspect on the target. See [Multi-source fan-in](/pipeline/guide/recipes/multi-source). |
| `batchSize` | `1000` | Rows requested per read batch. |
| `maxRetries` | `3` | Remote I/O retries. |
| `retryDelay` | `1000` | Retry backoff (ms). |
| `delay` | `0` | Inter-batch delay (ms) for throttling. |
| `rest` | — | REST adapter config (path, pagination, `dataPath`, …). See [REST sources](/pipeline/guide/sources/rest). |

### `target`

| Field | Purpose |
|---|---|
| `entity` | Target entity fully-qualified name **(required)**. |
| `service` | `'db'` or unset → local DB (`DbTargetAdapter`); a remote OData service → `ODataTargetAdapter`; anything else needs `adapter`. |
| `kind` | Explicit selector: `'odata' \| 'odata-v2'`. |
| `adapter` | Custom `BaseTargetAdapter` subclass — see [Custom target adapter](/pipeline/guide/targets/custom). |
| `batchSize`, `keyColumns`, `maxRetries`, `retryDelay` | Write tuning (documented in [OData targets](/pipeline/guide/targets/odata)). |

### `delta`

| Field | Default | Notes |
|---|---|---|
| `mode` | `'timestamp'` (entity) / `'full'` (query) | `'timestamp'`, `'key'`, or `'datetime-fields'`. Row-delta modes apply to entity-shape reads only. |
| `field` | `'modifiedAt'` | Timestamp or key field carrying the high-watermark. |
| `dateField`, `timeField` | — | For `'datetime-fields'` mode (OData V2 pattern). |

### `schedule`

Normalized to `{ every, engine }` or no internal schedule.

| Input | Result |
|---|---|
| `undefined` / `null` / `0` / `''` | No internal schedule — run via `execute` or the management API. |
| `number` (ms) | `{ every, engine: 'spawn' }` — in-process interval. |
| time string (e.g. `'10m'`) | `{ every, engine: 'spawn' }`. |
| 5-field cron string | `{ every, engine: 'queued' }` — cross-instance single-winner. |
| `{ every, engine? }` | `engine` defaults to `'queued'` for cron, else `'spawn'`. |

See [Internal scheduling (queued)](/pipeline/guide/recipes/internal-scheduling-queued) and [External scheduling (JSS)](/pipeline/guide/recipes/external-scheduling-jss).

### `preload`

Runs an initial load right after registration, so the target is not empty between boot and the first scheduled tick.

| Input | Behavior |
|---|---|
| omitted / `false` | No startup run. |
| `true` | Background initial load in the pipeline's effective mode (does not block boot). |
| `{ mode?, wait? }` | `wait: true` blocks `addPipeline` until the load completes (a failure then fails boot). `mode` overrides the run mode for the initial load only. |

A disabled (paused) pipeline skips its preload run.

## Running pipelines

### `execute(name, options?)`

Runs a pipeline immediately.

```javascript
await pipelines.execute('NorthwindProducts', { mode: 'full' })
// fire-and-forget:
await pipelines.execute('NorthwindProducts', { async: true, engine: 'queued' })
```

| Option | Default | Values |
|---|---|---|
| `mode` | pipeline default | `'full'`, `'delta'`, `'partial-refresh'`. |
| `trigger` | `'manual'` | `'manual'`, `'scheduled'`, `'external'`, `'event'` — recorded on the run. |
| `async` | `false` | `true` returns immediately; the run continues in the background. |
| `engine` | `'spawn'` | `'spawn'` or `'queued'` (only meaningful with `async: true`). |
| `event` | — | Event-driven micro-run block: `{ read: 'key' \| 'payload', action?, keys?, payload? }`. See [Event-driven runs](/pipeline/guide/recipes/event-driven-runs). |
| `tenant` | — | Explicit tenant context. |

### `executeForTenant(tenant, name, options?)`

Runs a pipeline in a specific tenant's context. See [Multi-tenancy](/federation/integration/multitenancy).

### `executeEvent(name, options)`

Convenience wrapper for event-driven micro-runs; requires `options.event.read`. See [Event-driven runs](/pipeline/guide/recipes/event-driven-runs).

## Managing pipelines at runtime

All of these persist to the tracker as **overrides** on top of the coded baseline — they survive restarts. See [Configuration overrides](/pipeline/guide/concepts/overrides).

| Method | Purpose |
|---|---|
| `getStatus(name)` | Current tracker status (`idle` / `running` / `failed`, last run, counts). |
| `setSchedule(name, { every, cron, engine })` | Hot-replace the schedule. |
| `clearSchedule(name)` | Stop the schedule (persists `schedule: null`). |
| `isScheduleLiveChangeSupported(name)` | Whether a queued schedule can be changed live on this runtime (CDS 10+). |
| `setEnabled(name, enabled)` | Pause/resume scheduled ticks. Manual `execute` still works while paused. |
| `setOverrides(name, patch)` | Merge and persist a runtime override patch. |
| `clearOverrides(name, keys?)` | Remove override keys (all, or the listed ones). |
| `getConfigView(name)` | Returns `{ base, overrides, effective }` for the pipeline. |
| `clear(name)` | Clear the target and reset the tracker watermark. |

### Data inspector / flow metadata

These back the Pipeline Console; you can also call them directly.

| Method | Returns |
|---|---|
| `inspectData(name, opts?)` | Paged source/target preview rows (JSON). |
| `inspectCapabilities(name)` | Which inspector sides are available. |
| `getFlowMetadata(name, opts?)` | Per-pipeline data-flow graph. |
| `getLandscapeMetadata(opts?)` | All-pipelines landscape graph. |

## Event hooks

Five namespaced events bracket every run. Register handlers with the standard CAP `before` / `on` / `after` API, keyed by pipeline name.

```javascript
pipelines.before('PIPELINE.MAP_BATCH', 'NorthwindProducts', (req) => { … })
pipelines.on('PIPELINE.READ', 'NorthwindProducts', (req) => { … })
pipelines.after('PIPELINE.DONE', 'NorthwindProducts', (req) => { … })
```

| Event | When | Cardinality |
|---|---|---|
| `PIPELINE.START` | Before READ | Once per run |
| `PIPELINE.READ` | Stream setup | Once per run |
| `PIPELINE.MAP_BATCH` | After each batch is read | Per batch |
| `PIPELINE.WRITE_BATCH` | After each batch is mapped | Per batch |
| `PIPELINE.DONE` | Run finished (success or failure) | Once per run |

`PIPELINE.MAP` and `PIPELINE.WRITE` are accepted as aliases for `MAP_BATCH` / `WRITE_BATCH` at registration.

::: warning `on` replaces the default
`on('PIPELINE.MAP_BATCH', …)` and `on('PIPELINE.WRITE_BATCH', …)` **replace** the built-in mapper/writer for that pipeline. To layer behavior on top of the defaults, use `before` / `after`. The `name` must match `addPipeline({ name })` (or the federated entity name for `@federation.replicate`).
:::

For worked examples, see [Event hooks](/pipeline/guide/recipes/event-hooks).

## Plugin configuration (`cds.requires.datapipeline`)

Separate from `addPipeline` — this configures the plugin itself in `package.json`.

| Field | Purpose |
|---|---|
| `impl: 'cds-data-pipeline'` | Activates the plugin. |
| `management.reuse.api` | Mount the management OData service at `/pipeline/`. |
| `management.reuse.console` | Mount the [Pipeline Console](/pipeline/guide/pipeline-console) (implies `api`). |
| `management.inspect: false` | Disable the data inspector. |
| `housekeeping.{ retentionDays, maxRuns, schedule }` | Global `PipelineRuns` retention. See [Housekeeping](/pipeline/guide/concepts/housekeeping). |

## See also

- [Management service](./management-service.md) — the HTTP/OData equivalent of this API.
- [Features](./features.md) — capability catalog.
- [Get started](/pipeline/guide/get-started) — end-to-end walkthrough.
