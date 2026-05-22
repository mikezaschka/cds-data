# Example 06 — Event hooks (5-event envelope)

**What this shows:** layer `before` / `on` / `after` handlers on every phase of a pipeline run — `PIPELINE.START`, `PIPELINE.READ`, `PIPELINE.MAP_BATCH`, `PIPELINE.WRITE_BATCH`, `PIPELINE.DONE`. `DataPipelineService` is a standard `cds.Service`, so CAP's native hook API plugs straight in. See [docs/guide/recipes/event-hooks.md](../../docs/guide/recipes/event-hooks.md).

**Source:** `LogisticsService.Shipments` at `http://localhost:4455/odata/v4/logistics/`.
**Target:** `example06.Shipments` (mirrors example 01) + `example06.BatchMetrics` (populated by the WRITE hook).
**Pipeline name:** `Shipments`.

Pipeline configuration is intentionally a near-clone of [example 01](../01-replicate-odata/) so the interesting code is purely the hooks.

## Run it

```bash
bash examples/06-event-hooks/start.sh
```

Watch the server output for `[START]`, `[MAP]`, `[WRITE]`, `[DONE]` lines — one block per run, one `[WRITE]` per batch. Each line is emitted by a different hook.

- OData of the local replica: <http://localhost:4106/odata/v4/example/Shipments>
- Per-batch metrics: <http://localhost:4106/odata/v4/example/BatchMetrics>
- Pipeline Monitor: <http://localhost:4106/launchpage.html>

Stop with Ctrl+C.

## Hook map

| Event | Hook | Purpose |
|---|---|---|
| `PIPELINE.START` | `before` | Run-scope setup — stash a `startedAt` timestamp and batch/row counters keyed by `runId`. |
| `PIPELINE.READ` | `before` | Parameter injection — if env var `REPLAY_FROM` is set, rewrite `req.data.config.delta.lastSync` for this one run. |
| `PIPELINE.MAP_BATCH` | `before` | Source-row filter — drop rows where `status === 'pending'`. Runs *before* the built-in rename default. |
| `PIPELINE.WRITE_BATCH` | `after` | Per-batch metric — insert a `BatchMetrics` row within the pipeline's own transaction. |
| `PIPELINE.DONE` | `after` | Run summary — log duration, batch count, and final statistics; release the run-scope state. |

`req.data` carries different fields per event; see [recipes/event-hooks.md](../../docs/guide/recipes/event-hooks.md#hook-surface-at-a-glance) for the full table.

## `on` vs `before`/`after` semantics

- `on` **replaces** the built-in default for that event. `PIPELINE.READ`, `PIPELINE.MAP_BATCH`, and `PIPELINE.WRITE_BATCH` have defaults — a user `on` takes over that slot entirely. `PIPELINE.START` and `PIPELINE.DONE` have no default.
- `before` and `after` **layer** on top of whatever `on` is active (default or user). Use them whenever you want to extend rather than replace.

This example uses only `before` / `after` — every default adapter behaviour stays in effect.

## What the MAP filter does

The LogisticsService seed data includes one shipment with `status='pending'` (order 10255). The `before('PIPELINE.MAP_BATCH', ...)` hook drops it before the default MAP renames columns. Verify with:

```
GET /odata/v4/example/Shipments?$filter=status eq 'pending'
```

→ empty result. The pending row was in the source batch but never reached the target.

## What the WRITE hook does

`after('PIPELINE.WRITE_BATCH', ...)` inserts a row into `example06.BatchMetrics` using `cds.tx(req)` so the metric commits together with the pipeline batch. Rolled-back runs leave no metric trace. A real-world replacement might emit a CloudEvent, increment a Prometheus counter, or write an audit-log entry.

## Scenarios

Walk through `http/10-run-and-query.http`:

1. First run — every log stage fires; BatchMetrics has N rows for N batches.
2. Confirm filtered rows are absent.
3. Re-run — 0 writes, but the envelope (`[START]` / `[DONE]`) still fires.
4. `mode: 'full'` run — exercises the pre-sync TRUNCATE path, MAP filter re-applies.

## See also

- [Recipes → Event hooks](../../docs/guide/recipes/event-hooks.md) — full reference walkthrough covering every event, both `on` and `before/after`.
- [Reference → Management service → Event hooks](../../../docs/pipeline/reference/management-service.md#event-hooks) — signature table.
- [Example 01 — Replicate OData](../01-replicate-odata/) — the baseline pipeline this example extends.
