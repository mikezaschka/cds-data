# Consumption-view vocabulary in `cds-data-pipeline` engine docs

**Status:** Graduated — superseded by [ADR 0007](../decisions/0007-infer-pipeline-intent-from-config-shape.md)
**Created:** 2026-04-19
**Promoted to:** [ADR 0007 — Infer pipeline intent from configuration shape](../decisions/0007-infer-pipeline-intent-from-config-shape.md) (2026-04-19)
**Related:** [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md), [ADR 0004](../decisions/0004-scope-cqn-adapter-to-cds-data-replication.md), [ADR 0006](../decisions/0006-per-plugin-published-surface.md)

## Resolution

Adopted a variant of **Option B**. Rather than introducing a new glossary term (Option C) or embracing the federation vocabulary (Option A), ADR 0007 removes the `kind` discriminator from the engine's public `addPipeline` API entirely and replaces kind-based prose with **shape-based** terminology:

- *entity-shape read* — `source.entity` (or `rest.path` for REST) ⇒ row-preserving, one-to-one on the key.
- *query-shape read* — `source.query` ⇒ derived / aggregated snapshot.

The two `addPipeline` error strings that used to invoke "the consumption-view contract" now justify the same constraints in engine-native shape terms (see [`packages/cds-data-pipeline/spec/concepts/inference.md`](../../../packages/cds-data-pipeline/spec/concepts/inference.md)). The engine doc set was refactored:

- `docs/kinds/` renamed to `docs/recipes/`; added `recipes/replicate.md` and `recipes/move-to-service.md` alongside the rewritten `recipes/materialize.md`.
- `concepts/inference.md` added as the canonical source of the inference table and registration-time validation matrix.
- `integration/cqn.md`, `reference/features.md`, `reference/management-service.md`, `index.md`, and `concepts/terminology.md` all rewritten to use entity-shape / query-shape terminology and to point at `concepts/inference.md` instead of a kind taxonomy.

This honors [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md)'s "neutral primitive" framing without creating a third term to maintain, and also resolves the open question about `kind: 'move'` inheriting the same vocabulary — all three derived kinds now share one shape vocabulary.

The original exploration is preserved below for historical context.

---

## Trigger

[`docs/pipeline/guide/sources/cqn.md:61`](../../../docs/pipeline/guide/sources/cqn.md) justifies rejecting `source.query` for `kind: 'replicate'` by invoking "the consumption-view contract":

> `source.query` is rejected for `kind: 'replicate'`. Row-preserving replication takes its shape from the projection; arbitrary CQL would bypass the consumption-view contract.

But [`packages/cds-data-pipeline/spec/concepts/index.md:8`](../../../packages/cds-data-pipeline/spec/concepts/index.md) and [`terminology.md:3`](../../../packages/cds-data-pipeline/spec/concepts/terminology.md) explicitly disclaim that vocabulary:

> These pages are engine-scoped; annotation-level concepts (federation, delegation, **consumption views**) live on the sibling `cds-data-federation` site.

And [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) §"Sibling plugin family" says the engine "has no annotations of its own … the primitive is neutral; declarative sugar layers on top."

So the engine's own reference docs tell users to look elsewhere for consumption views, while the integration / kinds / features pages and the `addPipeline` error strings reach straight into that vocabulary as load-bearing justification. A consumer calling `addPipeline({ kind: 'replicate', source: { kind: 'cqn', entity: 'X' } })` with no `@federation.*` anywhere in their app gets an error message pointing at a concept that, per the engine's own concept docs, is not part of the engine's vocabulary.

The leak is broader than one line — `rg 'consumption[- ]view' packages/cds-data-pipeline` finds it in:

- [`docs/integration/cqn.md`](../../../docs/pipeline/guide/sources/cqn.md) (lines 16, 61)
- [`docs/kinds/materialize.md`](../../../docs/pipeline/kinds/materialize.md) (line 5)
- [`docs/reference/features.md`](../../../docs/pipeline/reference/features.md) (line 14)
- [`srv/DataPipelineService.js`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js) (two `addPipeline` error strings)
- [`srv/adapters/CqnAdapter.js`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js) (class JSDoc, `_readReplicate` comment)

## Non-goals

- **Not proposing to change the engine's behavior.** `source.query` stays rejected for `kind: 'replicate'`; the kind split from [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) and [ADR 0004](../decisions/0004-scope-cqn-adapter-to-cds-data-replication.md) stands.
- **Not proposing to rename or remove the internal `config.viewMapping` plumbing** used by [`CqnAdapter._readReplicate`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js) to carry `projectedColumns` from the federation scanner. That's an internal config shape; the federation side fills it, the engine consumes it. Any rename there is out of scope for this note.
- **Not a low-redundancy / [ADR 0006](../decisions/0006-per-plugin-published-surface.md) audit.** Just the one concept.

## Options

- **Option A — Keep "consumption-view contract" as engine vocabulary.** Add a short glossary entry for it under `packages/cds-data-pipeline/spec/concepts/terminology.md` and delete the disclaim in `concepts/index.md`. *Pro:* zero churn in the integration / kinds pages; continuity with federation docs; one term for both worlds. *Con:* contradicts [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md)'s "neutral primitive" framing; a user who writes programmatic `addPipeline(...)` with no federation dep has never heard of "consumption views" and now has to learn the federation term to read the engine error.

- **Option B — Restate the constraint in engine-native terms.** Drop "consumption-view contract" from all five engine surfaces; replace with shape-of-entity reasoning: "row-preserving replication copies one source row to one target row on the key. Arbitrary CQL (`GROUP BY`, `DISTINCT`, joins, computed columns) breaks the 1:1 guarantee — use `kind: 'materialize'` for that shape." *Pro:* aligns with "engine has no annotations"; the error message is readable by someone who has never installed `cds-data-federation`; honors the existing `concepts/index.md` disclaim rather than contradicting it. *Con:* small loss of continuity for readers coming from the federation site; touches five files + two error strings.

- **Option C — Coin an engine-level term and use it consistently.** Introduce something like "schema projection" or "row-shape contract" as the engine's neutral name for "the source-entity shape, optionally column-restricted via `viewMapping`." Engine docs use the new term; federation docs say "a consumption view satisfies the engine's schema-projection contract." *Pro:* gives each package its own concept name, keeps the mapping honest across packages, matches [ADR 0006](../decisions/0006-per-plugin-published-surface.md) per-plugin published surface discipline. *Con:* a third term to maintain; needs a name everyone agrees on; more refactor than B because federation docs also update.

## Open questions

- Do the two `addPipeline` error strings in [`DataPipelineService.js`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js) count as published surface? They fire at registration time; any engine user sees them on misconfiguration, independent of whether `cds-data-federation` is installed. Treating them as engine-published would argue against Option A.
- Is the same leak present in the [`kinds/materialize.md`](../../../docs/pipeline/kinds/materialize.md) wording ("the consumption-view contract … cannot express GROUP BY"), or is that phrasing acceptable because it only references the other kind by contrast? Symmetric fix or cqn-local?
- Under Option C, is there already a better term buried in the adapter code? `config.viewMapping.projectedColumns` + `config.viewMapping.isWildcard` feels like it's groping toward one — maybe `projection shape` or just `projection` (with a glossary disambiguation against CDS `projection on`).
- Does this interact with future `kind: 'move'` docs? If the `move` kind also reads from an entity, it will inherit the same schema-vs-query question — another reason to pick a term that is kind-agnostic (Option B or C) rather than federation-flavored (Option A).
