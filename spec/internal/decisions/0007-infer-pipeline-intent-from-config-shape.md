# 7. Infer pipeline intent from source/target shape; remove `kind` discriminator

**Date:** 2026-04-19
**Status:** Accepted
**Supersedes:** [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) §"The kind taxonomy" and the `kind` argument in §"API renames". All other sections of [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) — engine package rename, positioning statement, scope boundaries, sibling plugin family, monorepo layout — **remain in force**.

## Context

[ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) repositioned the engine as `cds-data-pipeline` and introduced a required `kind` discriminator on every `addPipeline(...)` call with three values:

| `kind` | Semantic | Status in v1.0 |
|---|---|---|
| `replicate` | 1:1 row-preserving copy | Implemented |
| `materialize` | Derived / aggregated snapshot driven by `source.query` | Validation-only |
| `move` | Forward output to a non-`db` target | Validation-only |

The enum is enforced at [`DataPipelineService.js:8,157-173`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js), persisted in [`Pipelines.kind`](../../../packages/cds-data-pipeline/db/index.cds), and passed explicitly by the federation scanner at [`pipeline-binding.js:33`](../../../packages/cds-data-federation/srv/pipeline-binding.js).

Review of the taxonomy was triggered by [`ideas/consumption-view-vocabulary-in-pipeline-docs.md`](../ideas/consumption-view-vocabulary-in-pipeline-docs.md), which observed that engine-level docs and `addPipeline` error strings invoke the federation-layer "consumption-view contract" to justify `kind: 'replicate'` rejecting `source.query`. That triggered the deeper question: **does `kind` discriminate anything the user's config doesn't already discriminate?**

### Observations that shifted the analysis

1. **`replicate` and `move` have identical read semantics.** Both are row-preserving, both support `timestamp`/`key` delta. The only real differentiator is which write primitive the target adapter exposes — CQN `UPSERT.into(entity)` (for `db` / CQN-native services) vs. PUT-by-key-with-404-fallback (OData) vs. user-supplied `writeBatch` (REST). That is a target-adapter classification, not a pipeline-semantic classification.

2. **The enum conflates two orthogonal axes.** *Read shape* (entity vs. query) and *target write primitive* (UPSERT vs. non-UPSERT) are independent. Collapsing them onto a single enum creates an overlap (`replicate` vs. `move`) and leaves a missing cell — "query-shape read to a non-`db` target" ("materialize to a reporting service") has no home in the three-kind taxonomy.

3. **`kind` is redundant with information the user already provides.**
   - `source.query` present → the user is performing a query-shape read (today's `materialize`).
   - `source.entity` present without `source.query` → the user is performing an entity-shape read (today's `replicate` or `move`).
   - `target.service` kind + the corresponding target adapter's capabilities → the user has implicitly chosen the write primitive (today's `replicate` vs. `move` distinction).

   Restating this via a required `kind` field asks the user to say the same thing twice.

4. **Industry precedent does not split out `move`.** Fivetran / Airbyte distinguish *replication* vs. *transformation*; PostgreSQL distinguishes *logical replication* vs. *materialized view*; Debezium is CDC-only. All treat the write target as a connector concern, not a pipeline-semantic concern. The `replicate` vs. `materialize` split has a clean semantic line; `move` as a peer does not.

5. **Registration-time error messages become more informative when grounded in config contradictions rather than taxonomy membership.**
   - Current kind-based error: `"addPipeline: kind: 'materialize' rejects delta.mode: 'timestamp'"` — tautological.
   - Shape-based equivalent: `"addPipeline: delta.mode: 'timestamp' requires an entity-shape source (source.entity). Your config has source.query; timestamp-delta has nothing to filter."` — explains the conflict.

### Constraints that shaped the decision

- **Pre-v1 freedom.** Nothing is published. `addPipeline({ kind, ... })` has one caller outside the engine ([`pipeline-binding.js`](../../../packages/cds-data-federation/srv/pipeline-binding.js)) and zero external users. This is the one cheap moment to remove the field.
- **Engine positioning unchanged.** [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)'s positioning statement, scope boundaries, sibling plugin family, and engine rename all stand. The engine is still a CAP-layer data pipeline primitive; this ADR changes only how *intent* is expressed on the API surface.
- **Mental model preserved via recipes.** Users still reason about *replication*, *materialization*, and *movement* — these are useful category names. They become documented recipes, not required API fields.

### The question answered in this ADR

*Should pipeline intent be declared by a required `kind` enum on `addPipeline(...)`, or inferred from the shape of `source` and `target`?*

### Options considered

| Option | Outcome | Verdict |
|---|---|---|
| **A — Drop `move` only; keep `replicate` / `materialize`.** `move` becomes a target-adapter variant of `replicate`. | Two-kind enum, clean semantic line, industry-precedent-matching. Error surface stays kind-flavored. | Rejected — preserves a redundant enum. Users still say "kind: replicate" when their config shape already declares it. |
| **B — Drop `kind` entirely; infer from config shape.** Engine introspects `source` / `target` / `mode` / `delta` and rejects incoherent combinations with config-grounded errors. Recipes (replicate / materialize / move-to-service) stay as docs anchors. | Selected. | **Selected.** |
| **C — Split `kind` into two orthogonal axes.** E.g. `source.shape: 'entity' \| 'query'` + `target.mode: 'upsert' \| 'replace' \| 'send'`. | Makes orthogonality explicit at the API surface. Doubles the user-input enum count; v1 surface commitment grows. | Rejected — same information is inferable; explicit axes are a more elaborate restatement of what shape already encodes. |
| **D — Keep three as-is; document the overlap.** | No refactor. Users have to read a paragraph to understand that `move` is a target-adapter concern. Overlap and missing cell persist. | Rejected — defers the cost; doesn't remove it. |

The selection argument:

- Options A and C both keep user-facing discriminators that duplicate information the config already contains. The removable duplication is the point of Option B.
- Option D leaves the overlap and the missing cell ("materialize to non-db target") in place, which is the surface indication that the taxonomy is wrong.
- Option B's viability hinges on two things: (1) a documented inference table, and (2) a finite registration-time validation matrix. Both are spelled out below and neither is open-ended.

## Decision

**Remove the `kind` field from the `addPipeline(...)` API. Derive pipeline behavior from the shape of `source` and `target`. Reject incoherent combinations at registration time with errors that point at the config conflict, not at a taxonomy.**

### Inference rules

```
READ flow
  source.query present     → query-shape: single-shot read of the closure's SELECT CQN result.
  source.entity present    → entity-shape: paginated `readStream(tracker)` via the source adapter.
  both present             → error (ambiguous).
  neither present          → error (missing source shape).

WRITE flow
  target.service kind + target-adapter capability declaration
    → write primitive: UPSERT (CQN/db), PUT-by-key-with-404-fallback (OData),
      user-supplied writeBatch (REST), adapter-defined (custom targets).

MODE defaults (when mode is omitted)
  entity-shape source + target adapter advertises supportsKeyAddressableWrites
                           → default mode: 'delta'
  query-shape source       → default mode: 'full'
  otherwise                → mode must be stated explicitly.
```

### Registration-time validation matrix

| Config combination | Engine response |
|---|---|
| `source.query` AND `source.entity` both set | Error — ambiguous source shape |
| neither `source.query` nor `source.entity` | Error — missing source shape |
| `source.query` + `mode: 'delta'` | Error — row-delta requires entity-shape source; use `'full'` or `'partial-refresh'` |
| `source.query` + `delta: { mode: 'timestamp' \| 'key' \| 'datetime-fields' }` | Error — timestamp/key/datetime-delta requires entity-shape source |
| `source.entity` + `mode: 'partial-refresh'` without `slice` | Error — `slice` closure required for partial-refresh |
| `mode: 'delta'` + target adapter lacks key-addressable writes | Error — target cannot UPSERT per key; use `'full'` or pick a different target |
| `mode: 'full'` + target adapter lacks batch-delete / truncate | Error — target cannot truncate for full refresh |
| `source.query` + target adapter lacks batch-insert | Error — target cannot accept snapshot writes |

Each cell maps 1:1 to a tested error in `_validateConfig`. The matrix is finite and does not grow with `kind` — new source shapes or target adapters extend the rows/columns, but the engine adds exactly one new arm per extension.

### What the user still says

Users still have the vocabulary for what they're doing:

- "I'm replicating `Orders` to a local table" — `source.entity: 'Orders'`, `target.service: 'db'`, default `mode: 'delta'`.
- "I'm materializing a nightly revenue snapshot" — `source.query: (tracker) => SELECT...groupBy(...)`, `target.service: 'db'`, default `mode: 'full'`.
- "I'm moving orders to a sibling tenant" — `source.entity: 'Orders'`, `target.service: 'sibling-tenant'`, default `mode: 'delta'`.

These are **recipe names** documented under [`docs/pipeline/recipes/`](../../../docs/pipeline/) (rename of today's `kinds/`). Each recipe page shows the config that produces that behavior and the engine's inferred defaults. Users continue to think and talk in those categories; the API simply stops requiring them to name the category.

### What stays

- Engine package name `cds-data-pipeline`; service class `DataPipelineService`; management path `/pipeline`; event namespace `PIPELINE.*`; tracker entities `Pipelines` / `PipelineRuns`. All [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) naming holds.
- Scope boundaries from [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) §"Explicit scope boundaries" — still linear, still one source and one target, still no DAGs / joins / visual modeler.
- Sibling plugin family. `cds-data-federation` continues to compose the engine via peer-dep.
- `@federation.delegate` / `@federation.replicate` annotation surface — entirely unchanged. The federation scanner drops the `kind: 'replicate'` argument from its one `addPipeline` call in [`pipeline-binding.js`](../../../packages/cds-data-federation/srv/pipeline-binding.js); nothing else shifts.
- `VALID_SOURCE_KINDS` (`cqn`, `odata`, `odata-v2`, `rest`) — unrelated to this ADR. That enum routes the source adapter; it does not discriminate pipeline semantics.
- The "consumption-view projection" view-mapping plumbing (`config.viewMapping` with `projectedColumns` / `isWildcard`) — internal config shape filled by the federation scanner, consumed by [`CqnAdapter._readReplicate`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js). Not user-facing; no rename needed.

### Observability compensation

Because behavior is now implicit in config, the engine emits a one-line startup-log summary per registration so the inference is visible without requiring users to re-derive it:

```
[cds-data-pipeline] registered 'OrdersCopy' — entity-shape from reporting.Orders → db.ArchivedOrders, mode=delta(timestamp modifiedAt), adapter=CqnAdapter
```

This replaces the current `Added pipeline 'X' (kind=replicate)` line with information that is strictly more useful.

### `Pipelines.kind` column

Retained as a **derived** column (`inferredKind: 'replicate' | 'materialize' | 'move'`), computed at registration from the config shape and persisted for management-UI filtering / grouping. Not user-input, not validated on write by the user — the engine populates it. The type stays as `PipelineKind` in [`db/index.cds`](../../../packages/cds-data-pipeline/db/index.cds) with a doc comment clarifying it is derived, not user-declared. The management OData service exposes it read-only.

This preserves dashboard ergonomics (filter by `kind eq 'materialize'`) without re-introducing the user-facing discriminator.

## Consequences

### What this enables

- **The "materialize to non-`db` target" cell exists.** A nightly aggregate pushed to a reporting service is expressible: `source.query: ...` + `target.service: 'reporting'`. The engine runs the query, the target adapter writes the snapshot. Neither `materialize` nor `move` under the old taxonomy covered this.
- **Error messages explain config contradictions**, not taxonomy membership. Shorter cognitive distance from error to fix.
- **Future target adapters add capability without proposing new kinds.** `target.service` kinds like `event-bus`, `s3`, `http-webhook` slot into the factory with their own capability flags; no `kind: 'publish'` / `kind: 'broadcast'` pressure on the enum.
- **The vocabulary leak documented in [`ideas/consumption-view-vocabulary-in-pipeline-docs.md`](../ideas/consumption-view-vocabulary-in-pipeline-docs.md) largely self-resolves.** The error strings that currently reach for "consumption-view contract" as a kind-level justification disappear along with the kind enum; they are replaced by shape-grounded messages that don't need federation vocabulary. The idea graduates to `Status: Promoted, Promoted to: ADR 0007` via this ADR.
- **Federation scanner simplifies.** One fewer field to synthesize per scanned annotation.
- **Documentation shifts to recipes.** Recipe pages model the configurations users actually assemble, instead of taxonomy pages users map onto configurations. Closer to the user's mental starting point ("I want to copy this entity").

### What we accept as trade-offs

- **Inference must be made visible.** The startup-log summary above is load-bearing, not cosmetic. Without it, users have to re-derive engine behavior from config shape when reading their own pipeline registrations. Treated as an implementation requirement, not a "nice to have."
- **[ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) §"The kind taxonomy" is superseded.** That section's table, the "kind is required on every addPipeline call" rule, and the per-kind error matrix no longer describe the engine. Add a supersession banner to [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) pointing here; keep the rest of [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) in force.
- **`Pipelines.kind` becomes derived.** The CDS type stays for back-compat but the semantic changes. Document the shift in the [`db/index.cds`](../../../packages/cds-data-pipeline/db/index.cds) doc comment and in the management-service reference.
- **Docs reorganization.** `docs/pipeline/kinds/materialize.md` becomes `docs/recipes/aggregated-snapshot.md` (or similar); `cqn.md`, `features.md`, and `concepts/terminology.md` rewrite the kind-framed paragraphs as shape-framed. Finite, touches ~6 files.
- **Requirements tracker amendment banner rewrites.** [`spec/reference/requirements.md`](../../reference/requirements.md) line 3 currently documents the kind taxonomy; Req 4.6.3 language references `kind: 'replicate'` / `kind: 'materialize'`. Rewrite these to reference recipes. Material but mechanical.
- **Forward-compat risk for genuinely new pipeline semantics.** If a future semantic does not reduce to a new source-shape or target-adapter (e.g. a CDC log-replay flow that's neither entity-shape nor query-shape reading), we may re-introduce a discriminator. We accept that bet because (a) every currently-imagined extension does reduce that way, and (b) re-introducing a field pre-v2 is cheap.

### Supersessions and amendments

- **[ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) — partially superseded.** §"The kind taxonomy" and the `kind` argument in §"API renames" are superseded by this ADR. All other sections (engine rename, positioning, scope boundaries, sibling plugin family, monorepo layout, `REPLICATE.* → PIPELINE.*` event rename, tracker renames, service class rename) **remain in force**. Add a `**Partially superseded 2026-04-19 by [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md)**` banner at the top of [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) naming the specific sections.
- **[ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) — untouched.** Already superseded by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md). Its `source.query` escape-hatch reasoning holds under this ADR — query-shape source is a defining feature of the behavior the user configures, just no longer tagged with `kind: 'materialize'`.
- **[ADR 0001](./0001-replication-service-extends-cds-service.md), [ADR 0002](./0002-separate-internal-and-published-docs.md), [ADR 0003](./0003-split-plugin-into-replication-and-federation.md), [ADR 0006](./0006-per-plugin-published-surface.md) — untouched.** None make decisions that depend on the `kind` taxonomy.

### Follow-up work (checklist — not ADR content)

Tracked for `/implement-feature` planning; no implementation in this ADR.

1. **Supersession banner on [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md).** Top-of-file banner naming this ADR and the two superseded sections explicitly.
2. **Engine refactor.**
   - Remove `VALID_KINDS` and `VALID_MATERIALIZE_DELTA_MODES` constants from [`DataPipelineService.js`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js).
   - Rewrite `_validateConfig` around the validation matrix above; one test per matrix row.
   - Remove `kind` from the `addPipeline(config)` public API.
   - Add inference into `_normalizeConfig` producing an internal `inferredKind` and `mode` default.
   - Rewrite the registration log line per §"Observability compensation".
3. **CDS schema.** Update [`db/index.cds`](../../../packages/cds-data-pipeline/db/index.cds) `PipelineKind` doc comment to say the column is derived. No schema change.
4. **Federation scanner.** Drop `kind: 'replicate'` from the `addPipeline` call in [`pipeline-binding.js`](../../../packages/cds-data-federation/srv/pipeline-binding.js) and the class JSDoc.
5. **[`CqnAdapter`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js).** Replace `this.config.kind === 'materialize'` branch in `readStream` with `this.config.source.query ? _readMaterialize : _readReplicate`. Rename branch helpers to `_readQuery` / `_readEntity` for clarity; update JSDoc.
6. **Docs reorganization, per-package.**
   - Rename [`docs/pipeline/kinds/`](../../../docs/pipeline/) → `recipes/`.
   - Rewrite [`cqn.md`](../../../docs/pipeline/guide/sources/cqn.md), [`features.md`](../../../docs/pipeline/reference/features.md), [`concepts/terminology.md`](../../../packages/cds-data-pipeline/spec/concepts/terminology.md), [`index.md`](../../../docs/pipeline/index.md) around config-shape + recipes instead of the kind taxonomy.
   - Document the inference rules and the validation matrix in [`concepts/terminology.md`](../../../packages/cds-data-pipeline/spec/concepts/terminology.md) or a new `concepts/inference.md`.
7. **Idea graduation.** [`ideas/consumption-view-vocabulary-in-pipeline-docs.md`](../ideas/consumption-view-vocabulary-in-pipeline-docs.md) → `Status: Promoted, Promoted to: ADR 0007`. Note in that file that Option B of the original idea (engine-native reasoning) is the path chosen here as a side-effect of removing the kind discriminator.
8. **Requirements tracker.** Rewrite the amendment banner at [`spec/reference/requirements.md:3`](../../reference/requirements.md). Rewrite Req 4.6.3 language to reference recipes instead of `kind` values. No requirements added or removed.
9. **[`CLAUDE.md`](../../../CLAUDE.md) / [`AGENTS.md`](../../../AGENTS.md).** The primer mentions "each registered pipeline carries a required `kind`" — rewrite to say pipeline intent is derived from config shape; recipes are documented in the engine package.
10. **Consumer example updates.** Any example in [`examples/consumer/`](../../../examples/) that passes `kind: 'replicate'` to `addPipeline` drops the arg.

### What this decision does not do

- Does not change the engine's positioning. [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)'s positioning paragraph and scope-boundary list stand.
- Does not open the door to DAGs, multi-source joins, or visual modeling. [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) §"Out of scope" is unaffected.
- Does not deprecate the recipe names. Replication, materialization, and movement remain useful vocabulary in prose and docs; they stop being API arguments.
- Does not rename anything — the [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) renames (`cds-data-pipeline`, `DataPipelineService`, `PIPELINE.*`, `Pipelines` / `PipelineRuns`, `addPipeline`) all stand.
- Does not change the `@federation.*` annotation surface. Federation users observe zero change; the scanner internally drops one field on one call.
- Does not invalidate [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md)'s two-use-case framing. The CQN adapter still serves row-preserving reads (entity-shape) and aggregated reads (query-shape); those are now config shapes rather than kind tags.

## References

- [ADR 0001](./0001-replication-service-extends-cds-service.md) — `cds.Service` extension and event dispatch (unaffected).
- [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) — CQN adapter scope and `source.query` escape hatch (reasoning preserved; no longer tagged with `kind: 'materialize'`).
- [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) — engine repositioning (partially superseded by this ADR; see §Supersessions).
- [ADR 0006](./0006-per-plugin-published-surface.md) — per-plugin published surface (unaffected).
- [`ideas/consumption-view-vocabulary-in-pipeline-docs.md`](../ideas/consumption-view-vocabulary-in-pipeline-docs.md) — triggered this discussion; graduates to `Promoted` via this ADR.
- [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — originating idea for `move`; the "service-to-service copy as first-class use case" intent survives; the "third kind" mechanism does not.
- [`packages/cds-data-pipeline/srv/DataPipelineService.js`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js) — location of `VALID_KINDS` and `_validateConfig`.
- [`packages/cds-data-pipeline/db/index.cds`](../../../packages/cds-data-pipeline/db/index.cds) — `PipelineKind` type (becomes derived).
- [`packages/cds-data-pipeline/srv/adapters/CqnAdapter.js`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js) — `readStream` branching (becomes shape-based).
- [`packages/cds-data-federation/srv/pipeline-binding.js`](../../../packages/cds-data-federation/srv/pipeline-binding.js) — one `addPipeline` call; drops the `kind` argument.
- [`spec/reference/requirements.md`](../../reference/requirements.md) — amendment banner (line 3) and Req 4.6.3 language need rewriting.
