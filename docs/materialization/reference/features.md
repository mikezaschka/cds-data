# Features

::: warning Experimental — not yet released
`cds-data-materialization` is **experimental** and **not yet published to npm**. Everything below is subject to change until the first release. The pipeline engine it composes (`cds-data-pipeline`) is released independently.
:::

What `cds-data-materialization` provides today. Annotation syntax is in [Annotations](annotations.md).

## Annotation plugin

| Capability | Status |
|---|---|
| `@materialize.snapshot` on aggregation-shaped projections | Implemented |
| CDS projection → `source.query` compiler (no public `options.query`) | Implemented |
| Pipeline binding to `DataPipelineService.addPipeline` | Implemented |
| `refresh: 'full'` via annotation | Implemented |
| `source: { service: 'db' }` for namespace-local sources | Implemented |
| `materialized` aspect (`lastMaterializedAt`, `lastMaterializedBy`) | Implemented |
| Fail-loud startup when `cds-data-pipeline` is missing | Implemented |
| Reject `@federation.*` on the same entity | Implemented |
| Reject OData/REST sources for aggregate reads | Implemented |

## Planned (v1.x)

| Capability | Notes |
|---|---|
| `refresh: { mode: 'partial', slice }` from annotation | Maps to engine `refresh.slice(tracker)` |
| Cache option on served materialized entity reads | Optional `cds-caching` integration |

## Engine capabilities (via cds-data-pipeline)

Materialize runs are query-shape pipelines on the engine. Tracker rows, manual `execute`, scheduling, and the management OData API are documented under [Pipeline](/pipeline/) — especially [Built-in materialize](/pipeline/guide/recipes/built-in-materialize) and [CQN source](/pipeline/guide/sources/cqn).
