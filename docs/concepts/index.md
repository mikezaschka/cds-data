# The cds-data suite

`cds-data` is a set of three composable SAP CAP plugins. You usually reach for **one** of them by intent; the other two are either composed automatically or used standalone.

| Plugin | You reach for it when… | Surface |
|---|---|---|
| **[cds-data-federation](/federation/)** | You have a **remote service** entity you want available in your app — live or synced. | `@federation.delegate` / `@federation.replicate` on consumption views. |
| **[cds-data-pipeline](/pipeline/)** | You need a **scheduled, traceable `READ → MAP → WRITE`** job — from any source to any target, in code. | `cds.connect.to('data-pipeline').addPipeline({ … })` + management API + Pipeline Console. |
| **[cds-data-materialization](/materialization/)** <Badge type="warning" text="Experimental" /> | You want a **local aggregate snapshot** from a `group by` projection. | `@materialize.snapshot`. **Not yet released.** |

## How they compose

The pipeline is the engine. The two annotation plugins sit on top of it and generate pipeline registrations for you — you never call `addPipeline` yourself when you use annotations.

```
@federation.delegate ─── live proxy ──────────────▶ remote service   (no pipeline)
@federation.replicate ─┐
                       ├─▶ cds-data-pipeline ──▶ your database
@materialize.snapshot ─┘        (engine)
```

- **`@federation.replicate`** turns each annotated consumption view into one **entity-shape** pipeline (row-preserving UPSERT into a local table).
- **`@materialize.snapshot`** turns each `group by` projection into one **query-shape** pipeline (snapshot rebuild of an aggregate).
- **`cds-data-pipeline`** runs standalone too — register pipelines programmatically for any source/target the annotation layers don't cover.

Both annotation plugins declare `cds-data-pipeline` as a **peer dependency** and fail loudly at startup if it is missing.

See [Architecture](./architecture.md) for the layering in detail, and [Terminology](./terminology.md) for the exact meaning of *federation*, *delegation*, *replication*, *materialization*, and *pipeline*.

## Feature highlights per plugin

### cds-data-federation

- **Delegate** — transparent live proxy; reads forwarded to the remote, optional CUD opt-in.
- **Replicate** — scheduled sync into the local DB for offline access, analytics, and full SQL.
- **Cross-service `$expand` and navigation** — stitch local and remote entities across service boundaries.
- **Caching** — optional `response` cache ([cds-caching](https://github.com/mikezaschka/cds-caching)) or `entity` cache (SQLite snapshot via the pipeline).
- **Multi-tenancy** — per-tenant replication and entity cache under `@sap/cds-mtxs`.

→ [Federation features](/federation/reference/features) · [Annotations](/federation/reference/annotations)

### cds-data-pipeline

- **Sources** — OData V2/V4, HCQL, REST (with pagination + delta), CQN, and custom adapters.
- **Targets** — local DB (UPSERT/INSERT/truncate), remote OData, and custom adapters.
- **Delta tracking** — `timestamp`, `key`, and `datetime-fields` strategies with a persisted high-watermark.
- **Scheduling** — in-process (`spawn`), cross-instance single-winner (`queued`), or external trigger.
- **Observability** — `Pipelines` / `PipelineRuns` tracker, management OData API, and the **[Pipeline Console](/pipeline/guide/pipeline-console)** monitor UI.
- **Event hooks** — `before` / `on` / `after` for every phase (`START → READ → MAP → WRITE → DONE`).

→ [Pipeline features](/pipeline/reference/features) · [API reference](/pipeline/reference/api)

### cds-data-materialization <Badge type="warning" text="Experimental" />

- **`@materialize.snapshot`** on `group by` projections — persist scheduled rollups locally.
- Composes the pipeline for the query-shape run; stage remote data with `@federation.replicate` first, then aggregate.

→ [Materialization features](/materialization/reference/features)

## Common ground

- **[Terminology](./terminology.md)** — the shared vocabulary across all three plugins.
- **[Architecture](./architecture.md)** — the engine-vs-annotation layering and the consumption-view contract.
- **[CDS 10, HCQL and MCP](./cds-10.md)** — how the June 2026 CAP release composes with the suite.
