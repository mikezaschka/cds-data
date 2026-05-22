# Terminology

The vocabulary `cds-data-pipeline` uses.

---

## Pipeline

A **pipeline** is a linear `READ → MAP → WRITE` job between exactly one source and one target, with built-in tracker, retry, concurrency guard, and event hooks. Pipelines are registered programmatically via `cds.connect.to('DataPipelineService').addPipeline({ ... })` and scheduled (periodic) or triggered (one-shot).

Pipeline behaviour — row-preserving copy vs. aggregated snapshot vs. cross-service move — is **inferred from the config shape**. See [Inference rules](inference.md) for the full table and the configs that are rejected at registration. The three recipe names (**replicate**, **materialize**, **move-to-service**) are doc-level use-case labels — they describe common combinations of read shape and target destination, but they are not a field on `addPipeline(...)` or a column on the tracker.

---

## Source and target

Every pipeline has **one source** and **one target**.

- **Source** — a service (identified by a `cds.requires` key) plus an entity name, optionally with a CQN `query` closure that replaces entity-based reading with a custom SELECT. Source adapters bridge the service's transport (OData V4 / V2, REST, or a custom adapter) to a uniform streaming contract the plugin consumes.
- **Target** — a service plus an entity name, typically a DB entity (`@cds.persistence.table`). The WRITE phase is dispatched through a [target adapter](../targets/index.md): the built-in [`DbTargetAdapter`](../targets/db.md) handles the common case (`target.service` unset or `'db'`); the built-in [`ODataTargetAdapter`](../targets/odata.md) handles remote OData services; everything else is covered by a [custom target adapter](../targets/custom.md) or a [`PIPELINE.WRITE_BATCH` event hook](../recipes/event-hooks.md#on-as-a-target-adapter-alternative). For replicate pipelines the target is most idiomatically a **consumption view** — a local `projection on <remote.Entity>` that also carries the column selection and rename mapping (see [Consumption views](consumption-views.md)).

---

## Mode

**Mode** controls how the pipeline decides what to read and what to write.

| Mode | Read | Write |
|---|---|---|
| `full` | Read all rows from source. | Truncate target, then upsert fresh rows. Multi-source-aware truncate preserves rows from other pipelines writing to the same target. |
| `delta` | Read only rows changed since the last successful run (using the source adapter's delta strategy). | Upsert the delta batch. No truncate. |
| `partial-refresh` | Read a query-shaped slice of rows. | Replace the slice, leave other rows alone. |

Entity-shape pipelines default to `delta`; query-shape pipelines default to `full`. See [Inference rules](inference.md) for the full defaults table.

---

## Delta strategy

How the source adapter discovers changes. The engine hands the adapter a **tracker** carrying the last known watermark; the adapter returns all rows newer than that watermark.

| Strategy | Watermark | Adapter responsibility |
|---|---|---|
| **timestamp** | `lastSync` timestamp | Issue a `$filter=modifiedAt gt <lastSync>` (or REST equivalent). Adapter chooses the comparison field via options. |
| **key-based** | `lastKey` primary key value | Issue a filter/pagination anchored on the sort key so rows past the anchor are returned in order. |
| **datetime-fields** | Per-field timestamps in a composite watermark | For sources exposing multiple independently updated timestamps. |

All three are implemented for OData V4 and V2. REST supports `timestamp` via configurable `delta` query params.

---

## Tracker

`Pipelines` and `PipelineRuns` are the two tracker entities exposed by the management OData service.

- **Pipelines** — one row per registered pipeline. Carries source / target references, current `mode`, `lastSync`, `lastKey`, cumulative statistics, and status. Behaviour is inferred from the current config at registration (see [Inference rules](inference.md)).
- **PipelineRuns** — one row per invocation. Carries start / end timestamps, trigger type, per-phase statistics (`created` / `updated` / `deleted` / `skipped`), mode, and any error context for failed runs.

See the [Management Service reference](../../reference/management-service.md) for the OData shape and available actions.

---

## Event namespace

Pipeline event hooks use the `PIPELINE.*` namespace. Five events bracket each run:

| Event | Cardinality | When it fires |
|---|---|---|
| `PIPELINE.START` | once | After the concurrency guard acquires the tracker lock, before READ. Run-level setup, veto, trace correlation. |
| `PIPELINE.READ` | once | Around the READ phase. Default handler resolves the source adapter and produces an async iterable (`sourceStream`) the engine iterates. |
| `PIPELINE.MAP_BATCH` | per batch | Around the transformation phase between read and write. Field renames are applied here via `config.viewMapping.remoteToLocal` when supplied by the caller; user `PIPELINE.MAP_BATCH` hooks can override or extend the mapping. |
| `PIPELINE.WRITE_BATCH` | per batch | Around the UPSERT (or adapter-specific write) into the target entity. |
| `PIPELINE.DONE` | once | After the tracker row is finalized. Fires on both success and failure; `req.data.status` discriminates. Canonical hook for end-of-run notifications. |

Every payload carries `runId` so handlers can correlate across phases; `MAP_BATCH` and `WRITE_BATCH` additionally carry `batchIndex` (0-based). Register handlers via the standard CAP pattern:

```javascript
srv.before('PIPELINE.WRITE_BATCH', 'MyPipeline', (req) => { /* ... */ });
srv.on('PIPELINE.MAP_BATCH', 'MyPipeline', async (req, next) => {
  const rows = await next();
  return rows.filter(r => r.active);
});
srv.after('PIPELINE.DONE', 'MyPipeline', (_results, req) => { /* notify */ });
```
