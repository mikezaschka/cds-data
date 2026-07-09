# 9. `cds-data-materialization` — annotation plugin for query-shape snapshots

**Date:** 2026-05-22
**Status:** Accepted
**Related:** [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md), [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md), [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md), [`ideas/cds-data-materialization.md`](../ideas/cds-data-materialization.md)

## Context

The `cds-data-pipeline` engine implements query-shape pipelines when `addPipeline({ source: { query: () => SELECT... } })` is supplied ([Req 4.6.3](../../reference/requirements.md)). Aggregated rollups are **materialization**, not federation ([ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md)). The programmatic recipe is documented under [`docs/pipeline/guide/recipes/built-in-materialize.md`](../../../docs/pipeline/guide/recipes/built-in-materialize.md).

Developers need the same declarative ergonomics `@federation.replicate` provides for entity-shape copies: annotate a CDS projection, get a scheduled pipeline and local table without imperative `server.js` registration.

## Decision

**Ship `cds-data-materialization` as a sibling annotation plugin** that:

1. Scans `@materialize.snapshot` on aggregation-shaped CDS projections.
2. Compiles `entityDef.projection` (columns + `groupBy` + optional `where`) into a `source.query` closure.
3. Binds each config to `cds.connect.to('DataPipelineService').addPipeline(...)` (query-shape; no `kind` argument per ADR 0007).

### Annotation surface (v1)

```cds
@materialize.snapshot: { schedule: '0 2 * * *', refresh: 'full', source: { service: 'db' } }
entity DailyCustomerRevenue as projection on SourceOrders {
  key customerId,
  sum(amount)     as totalAmount  : Decimal(15, 2),
  count(*)        as orderCount   : Integer,
  max(modifiedAt) as lastActivity : Timestamp
}
group by customerId;
```

- **Namespace:** `@materialize.snapshot` (not `@federation.*`).
- **No public `options.query` in v1** — the CDS projection is the DSL.
- **`source.service`** — required when the projection `from` ref is not `ServiceName.Entity` (e.g. projection on namespace entity `SourceOrders` with `cds.requires.db`).

### Compiler subset (v1)

Derived from CSN spike [`spec/internal/research/materialize-projection-csn.md`](../research/materialize-projection-csn.md):

| Supported | Rejected at scan |
|---|---|
| `projection on` single entity ref | Joins, subqueries, association expands in SELECT |
| `group by` on projection refs | Missing `groupBy` and no aggregate `func` columns |
| `sum` / `count` / `min` / `max` / `avg` with `as` | `@federation.*` on same entity |
| `key` on group-by column | `refresh: 'partial'` without slice (deferred M-11) |
| Static `where` on projection | OData/REST `requires` kind as aggregate source |

### Persistence

Scanner sets `@cds.persistence.table` and `@cds.persistence.skip: false` on the target entity (same pattern as `@federation.replicate`).

### Optional aspect

`plugin.data_materialization.materialized` (`lastMaterializedAt`, `lastMaterializedBy`) — user opt-in on target entities.

### Peer dependencies

- `@sap/cds` >= 8 (required)
- `cds-data-pipeline` >= 0.1.0 (required; loud error if missing)
- `cds-caching` (optional; not wired in v1)

Installing `cds-data-federation` without `cds-data-materialization` leaves `@materialize.*` inert.

## Consequences

- Requirements gain §4.18 (annotation plugin rows M-1…M-10).
- Monorepo test script runs a third workspace serially.
- Published surface per [ADR 0006](./0006-per-plugin-published-surface.md): package README + [`docs/materialization/`](../../../docs/materialization/) on the monorepo VitePress site.

## Follow-up (not v1)

- M-11: `refresh: { mode: 'partial', slice }` from annotation
- M-14: cache option on served materialized entities
- Event-triggered materialize (blocked by engine ADR 0013 for query-shape)
