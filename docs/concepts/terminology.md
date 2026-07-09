# Terminology

The shared vocabulary used across `cds-data-federation`, `cds-data-pipeline`, and `cds-data-materialization`. Plugin-specific pages link back here rather than redefining these terms.

## The suite in one sentence

> Declare **what** remote or aggregated data you need with a CDS projection, declare **how** it should be accessed with an annotation (or register a pipeline in code), and the engine handles the runtime — live proxying, scheduled sync, delta tracking, retry, and observability.

## Core engine terms

These describe `cds-data-pipeline`, the engine every scheduled job runs on.

| Term | Meaning |
|---|---|
| **Pipeline** | A linear `READ → MAP → WRITE` job between exactly one source and one target, with a built-in tracker, retry, concurrency guard, and event hooks. |
| **Source / Target** | The read side (`source.entity`, `source.query`, or a custom adapter) and the write side (`target.entity` — a DB table, remote OData, or custom adapter). |
| **Mode** | How a run writes: `delta` (only changed rows since the last watermark), `full` (re-read everything), or `partial-refresh` (rebuild a slice of a query-shape target). |
| **Delta strategy** | How "changed since last run" is detected: `timestamp`, `key`, or `datetime-fields`. Backed by a persisted high-watermark on the tracker. |
| **Tracker** | The `Pipelines` and `PipelineRuns` entities that persist pipeline state, schedules, overrides, and run history. |
| **Pipeline events** | `PIPELINE.START`, `PIPELINE.READ`, `PIPELINE.MAP`, `PIPELINE.WRITE`, `PIPELINE.DONE` — namespaced to avoid collision with CAP's CRUD aliases. |

### Pipeline shapes: replicate, materialize, move

The engine **derives** a pipeline's *shape* from its configuration — you never pass a `kind`.

| Shape | Read | Write | Composed by |
|---|---|---|---|
| **Replicate** | Entity-shape (`source.entity` / REST path) | Row-preserving UPSERT into a DB table | `@federation.replicate` |
| **Materialize** | Query-shape (`source.query` with joins / `GROUP BY`) | Snapshot rebuild (`full` / `partial-refresh`) | `@materialize.snapshot` |
| **Move** | Entity-shape | Forwarded to a non-DB target (message bus, HTTP, object store) | programmatic only |

See the pipeline [inference rules](/pipeline/guide/concepts/inference) for the full derivation matrix.

## Federation terms

These describe `cds-data-federation`, the annotation layer for remote-service integration.

| Term | Meaning |
|---|---|
| **Federation** | Integrating remote service models into your data model and choosing a runtime strategy for accessing that data. Used in the broad industry sense ("make multiple sources appear as one"), not CAP's narrower usage. |
| **Delegation** | Live forwarding of a query to a remote service — `req => remote.run(req.query)`. Exposed as `@federation.delegate`. |
| **Replication** | Copying remote data into the local DB on a schedule so it can be joined with local data in SQL. Exposed as `@federation.replicate`; composes an entity-shape pipeline. |
| **Consumption view** | A CDS projection on a remote entity (`entity X as projection on remote.Y { … }`) that declares the **schema contract**: which fields, what shape, what renames. The `@federation.*` annotation on it declares the **runtime behavior**. |
| **Cross-service `$expand` / navigation** | Traversing associations that cross a service boundary. The plugin batch-fetches and stitches the two sides. See [Cross-service scenarios](/federation/concepts/cross-service-scenarios). |
| **Caching** | An optional read accelerator, orthogonal to delegate vs replicate — not a third strategy. `response` caches exact query results ([cds-caching](https://github.com/mikezaschka/cds-caching)); `entity` caches a full local SQLite snapshot (via the pipeline). |

### The consumption view IS the contract

The CDS projection declares **schema** (fields, shape, renames). The annotation declares **runtime behavior** (delegate vs replicate, optional cache, optional CUD opt-in). From this single projection the plugin infers the source service/entity, the projected columns (for `$select` restriction), the bidirectional rename map, and the strategy. This is the principle everything else follows from — see [Consumption views](/federation/concepts/consumption-views).

## How the terms map to CAP

`cds-data` uses *federation* as the umbrella and makes *delegation* and *replication* strategies within it. CAP's [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) treats "Data Federation" and "Delegation" as sibling concepts. The mapping:

| CAP term | `cds-data` equivalent | Alignment |
|---|---|---|
| Delegation (`req => remote.run(req.query)`) | `@federation.delegate` | Same behavior |
| Data Federation (replicate for local "close access") | `@federation.replicate` | Same mechanism |
| Navigation (association path traversal) | Cross-service navigation | Aligned |
| Expand (`$expand` across services) | Cross-service expand | Aligned |
| Caching | `cache` option (no CAP-native equivalent) | Extension |

`cds-data-federation` is a **Calesi plugin** for remote data services — it encapsulates outbound OData/REST/HCQL calls behind a CAP service interface. For the full CAP-alignment discussion, the `@federated`-vs-`@federation.*` comparison, and the naming rationale, see [Federation → Terminology](/federation/concepts/terminology).

## Materialization term

| Term | Meaning |
|---|---|
| **Snapshot** | A locally-persisted aggregate rebuilt on a schedule from a `group by` projection. Exposed as `@materialize.snapshot` <Badge type="warning" text="Experimental" />; composes a query-shape pipeline. |
