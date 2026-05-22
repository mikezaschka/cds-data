# cds-data-materialization — annotation plugin for materialized snapshots

**Status:** Promoted
**Created:** 2026-04-19
**Promoted to:** [ADR 0009](../decisions/0009-cds-data-materialization-plugin.md)
**Related:** [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) (`kind: 'materialize'` on pipeline engine), [ADR 0004](../decisions/0004-scope-cqn-adapter-to-cds-data-replication.md) (CQN adapter use case 1 — aggregated rollup), [`cds-caching`](https://github.com/mikezaschka/cds-caching) (composition precedent), [Req 4.6.3](../../reference/requirements.md) (CQN adapter)

## Trigger

[ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) carves out `kind: 'materialize'` on the `cds-data-pipeline` engine: an aggregated / derived / snapshotted target built by running a source query (typically `GROUP BY` + aggregates) on a schedule. The v1 path to use it is programmatic:

```js
await pipeline.addPipeline({
  kind: 'materialize',
  name: 'DailyCustomerRevenue',
  schedule: '0 2 * * *',
  source: { service: 'SalesService', query: () => SELECT.from('SalesService.Orders').columns(/* ... */).groupBy('customer_id') },
  target: { service: 'db', entity: 'DailyCustomerRevenue' },
})
```

This is concise but imperative. The pattern matches `@federation.replicate` exactly: a declarative annotation on a CDS projection could replace the boilerplate and make materializations discoverable from the model alongside other federated / replicated entities.

## What a declarative annotation might look like

```cds
@materialize.snapshot: { schedule: '0 2 * * *', refresh: 'full' }
entity DailyCustomerRevenue as projection on SalesService.Orders {
  key customer_id as customerID,
  sum(amount)     as totalAmount : Decimal(15, 2),
  count(*)        as orderCount  : Integer,
  max(modifiedAt) as lastActivity: Timestamp,
} group by customer_id;
```

The scanner walks `@materialize.snapshot`, validates the projection is aggregation-shaped (`group by` present, or derived columns, or `distinct`), derives the source query from the projection, and calls `cds.connect.to('DataPipelineService')` → `addPipeline({ kind: 'materialize', ... })` under the hood. Exactly mirrors how `cds-data-federation` consumes the engine for `kind: 'replicate'`.

## Why a separate plugin

Follows the same argument as [ADR 0003](../decisions/0003-split-plugin-into-replication-and-federation.md) / [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md):

- One concern per plugin ([`CLAUDE.md`](../../../CLAUDE.md) §Conventions, Calesi pattern).
- Engine is pattern-agnostic; annotation plugins layer declarative sugar per kind.
- Users who don't want materialization don't install it.
- Decouples materialization's annotation evolution from federation's.

The shape is deliberately parallel to `cds-data-federation`: peer-dep on `cds-data-pipeline` + optional peer-dep on `cds-caching`. Installing both `cds-data-federation` and `cds-data-materialization` alongside `cds-data-pipeline` is explicitly supported — each owns its own annotation namespace (`@federation.*` vs. `@materialize.*`).

## Open questions

1. **Annotation namespace.** `@materialize.*` reads well but overlaps conceptually with CDS `@readonly` / persistence annotations. Alternatives: `@snapshot`, `@derived`, `@rollup`. `@materialize.snapshot` is the current working name because it matches the SQL term ("materialized view / materialized snapshot") and parallels `@federation.replicate`.
2. **Refresh strategies.** v1 covers `refresh: 'full'` (TRUNCATE + INSERT). Open: `refresh: 'partial'` with a user-supplied closure that narrows the source query to a slice (e.g. last N days), then DELETE + INSERT that slice on the target. Everything else (incremental aggregation maintenance, deletes propagating through aggregates) is hard and probably out of scope.
3. **Composition with `@federation.replicate`.** Can a materialization have a *replicated local* entity as its source (stage-then-aggregate)? Probably yes and it falls out for free — the source is a local CDS entity and the engine doesn't care. Needs a doc section, not implementation work.
4. **Trigger model.** Schedule is the obvious trigger. Open: event-triggered materialization (e.g. "recompute when `Orders` changes significantly"). Probably v2. Phase 6 (event-driven sync) may fold this in.
5. **Relationship to CDS views.** CDS analytical views (`@Analytics.*`) exist and are served runtime by the database. This plugin is for *persisted* snapshots — materially different when you want point-in-time stability (yesterday's totals stay frozen) or when the source is across services (a view can't cross `cds.requires` boundaries).
6. **Where does partial-refresh idempotency live?** The engine offers UPSERT idempotency per [Req 4.4.4](../../reference/requirements.md). For full-refresh materialization the guarantee is trivially met (each run rewrites the whole snapshot). For partial-refresh it depends on the slice closure being deterministic — a contract this plugin must document.

## Non-goals

- No DSL for aggregation — the CDS projection syntax *is* the DSL.
- No cross-source joins inside the materialization ([ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) §"Explicit scope boundaries").
- Not a replacement for CDS analytical views — those stay database-native, this is for persisted snapshots.
- No incremental aggregation maintenance in v1.

## Initial reaction

Worth doing — but *only after* `cds-data-pipeline` v1 has shipped `kind: 'materialize'` and has at least one real-world user proving the programmatic shape holds up. Too early to commit to the annotation syntax today. This stub exists to anchor the discussion; the concrete ADR (number pending) comes after v1 of the engine.
