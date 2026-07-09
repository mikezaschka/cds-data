# Example 01 — Replicate from OData V4

**What this shows:** entity-shape replicate from a remote OData V4 service into a local DB table, using a consumption view + `viewMapping`. This is the canonical `cds-data-pipeline` recipe — see [docs/guide/recipes/built-in-replicate.md](../../docs/guide/recipes/built-in-replicate.md).

**Source:** the bundled [LogisticsService](../_providers/logistics-service/) (CAP OData V4, `:4455`).
**Target:** local SQLite table `example01.Shipments`.
**Pipeline name:** `Shipments`.

## Run it

```bash
bash examples/01-replicate-odata/start.sh
```

- OData of the local replica: <http://localhost:4101/odata/v4/example/Shipments>
- Pipeline Console: <http://localhost:4101/pipeline-console/>
- Management API: <http://localhost:4101/pipeline/Pipelines>

Stop with Ctrl+C.

## The three moving parts

1. **Consumption view** in [db/schema.cds](db/schema.cds) — a `projection on LogisticsService.Shipments` annotated with `@cds.persistence.table`. The projection defines the local schema, the column subset pulled from the remote, and the rename map (`ID → id`, `carrier.code → carrierCode`).
2. **Pipeline registration** in [server.js](server.js) — `addPipeline({ name, source, target, delta, viewMapping, schedule })`. `source.service` points at the `cds.requires` entry for LogisticsService; `target.entity` names the consumption view.
3. **Management reuse** in [package.json](package.json) — `management.reuse.api` exposes `/pipeline/`; `management.reuse.console` serves the plugin Pipeline Console at `/pipeline-console/`.

## Watch it work

Run [http/10-run-and-query.http](http/10-run-and-query.http) top to bottom with the VS Code REST Client extension:

1. `POST /pipeline/execute` with `mode: 'delta'` — first run copies every row from the provider (no watermark yet). Subsequent runs only pull rows where `modifiedAt > tracker.lastSync`.
2. `GET /odata/v4/example/Shipments` — the rows came from the remote but the request never hits the provider.
3. A second `POST /pipeline/execute` — UPSERT keeps the table idempotent, zero duplicates.
4. `POST /pipeline/execute` with `mode: 'full'` — truncates and replays. Useful after source-schema changes.

## Configuration highlights

- **Delta mode.** `delta: { mode: 'timestamp', field: 'modifiedAt' }` — row-delta based on the provider's `modifiedAt` column. If the source had no such column, swap to `mode: 'key'` with the primary key, or `mode: 'full'` for unconditional refresh.
- **`viewMapping.remoteToLocal`.** Mirrors the consumption view aliases. The built-in `PIPELINE.MAP_BATCH` handler reads this map and renames each batch of rows on the fly — no custom hook required. Drop this block entirely when remote and local columns match 1:1.
- **`schedule: 60_000`.** In-process `cds.spawn({ every: 60_000 })` — fires every 60 s on every app instance. For scaled deployments use `{ every: '10m', engine: 'queued' }` (persistent task queue) or omit `schedule` and drive runs externally via BTP Job Scheduling Service / Kubernetes CronJob.

## Pipeline Console

Open <http://localhost:4101/pipeline-console/>. You should see one row for `Shipments` with `status=idle`, `mode=delta`, and the last run's statistics. Select the pipeline to inspect run history in the detail pane.

## See also

- [Concepts → Consumption views](../../docs/guide/concepts/consumption-views.md) — why `@cds.persistence.table` + projection + viewMapping is the recommended pattern.
- [Sources → OData](../../docs/guide/sources/odata.md) — OData V2 / V4 adapter details.
- [Targets → Local DB](../../docs/guide/targets/db.md) — `DbTargetAdapter` semantics.
- [Example 06 — Event hooks](../06-event-hooks/) — layers `before` / `after` hooks on this same pipeline.
