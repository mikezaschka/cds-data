# Infer pipeline intent from config shape; remove `kind` discriminator

**Scope:** API-surface refactor per [ADR 0007](../decisions/0007-infer-pipeline-intent-from-config-shape.md). Removes the required `kind` field from `addPipeline(...)`; derives pipeline behavior from `source.query` / `source.entity` + target service kind. [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) is partially superseded — §"The kind taxonomy" and the `kind` argument in §"API renames" are what goes away; all other ADR 0005 content (engine rename, positioning, scope boundaries, sibling plugin family, event namespace, tracker entities) remains in force.

**Status:** Proposed — awaiting approval before Phase 3.

Phase 1 research summary lives in the session that produced [ADR 0007](../decisions/0007-infer-pipeline-intent-from-config-shape.md); this plan is the executable form of the ADR's §"Follow-up work (checklist)", adjusted for the pre-existing code realities documented in §Approval points below.

---

## Overview

Three questions converge on the same refactor:

1. The `kind` enum duplicates information the user already supplies (`source.query` vs. `source.entity`; `target.service` kind).
2. `replicate` vs. `move` overlap on read semantics — the real axis is the target's write primitive, not the pipeline's kind.
3. The current "consumption-view contract" wording in engine-level docs and error strings violates the engine's own "no annotation concepts" framing ([`packages/cds-data-pipeline/spec/concepts/index.md:8`](../../../packages/cds-data-pipeline/spec/concepts/index.md)).

[ADR 0007](../decisions/0007-infer-pipeline-intent-from-config-shape.md) resolves all three at once: drop `kind` from the public API; rewrite the registration validator around config shape; rename the engine's docs from `kinds/` to `recipes/`; retire the kind-based error strings.

**One deliberate scope cut vs. the ADR-as-written:** three validation rows in ADR 0007 §"Registration-time validation matrix" depend on a TargetAdapter capability abstraction that does not exist in the codebase today. See Approval §A.1 — those rows stay documented in the ADR as forward-looking but are not implemented in this PR.

**Non-feature work.** No user-visible capability is added. Acceptance bar is **equivalent behavior with a simpler API**:

- Existing `@federation.replicate` entities continue to register and run identically (scanner drops one field from its one call).
- Materialize pipelines registered programmatically behave identically (`_isMaterialize` becomes shape-based; downstream branch unchanged).
- Pipelines tracker rows, `PipelineRuns`, management-service OData shape — all unchanged externally.
- Startup log line becomes shape-based and strictly more informative per ADR 0007 §"Observability compensation".

---

## Pre-existing code vs. ADR-text expectations

Six places where the ADR's wording needs sharpening before implementation. Surfaced as Approval points §A.1 – §A.6:

1. **§A.1 — Target-adapter capability validation.** ADR 0007 §"Registration-time validation matrix" rows 6, 7, 8 reference `target adapter advertises supportsKeyAddressableWrites` / `supportsBatchDelete` / `supportsBatchInsert`. The codebase has no TargetAdapter base class and no capability flags — [`Pipeline._defaultWriteHandler`](../../../packages/cds-data-pipeline/srv/lib/Pipeline.js) hard-codes `cds.connect.to('db')` + UPSERT or INSERT. Implementing those three rows requires first introducing a target-adapter capability layer (separate concern, aligned with [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md)). **Approval point: defer rows 6–8 to a follow-up ADR**; mark them as `Planned — unlocked when target-adapter capability layer lands` in the rewritten matrix. Implement the other 5 rows (ambiguous source, missing source, query + delta mode, query + delta.mode timestamp/key/datetime-fields, partial-refresh without slice).

2. **§A.2 — Internal `config.kind` field under the refactor.** The ADR says `Pipelines.kind` becomes derived (`inferredKind`) for management-UI filtering. Internally, `Pipeline._ensureTracker` writes `config.kind` into the tracker row and the legacy backfill path checks `!existing.kind && this.config.kind`. Two options:
   - (a) Rename internal `config.kind` → `config.inferredKind`; update every consumer.
   - (b) Keep internal field name `config.kind` as the **derived** value (computed in `_normalizeConfig` from source shape + target kind); no code diff at consumption sites beyond the two discrimination points.
   
   **Approval point: option (b).** Minimal diff; internal field, not user-facing; JSDoc clarifies it's derived. The CDS column stays named `kind`.

3. **§A.3 — `Pipeline._isMaterialize()` rename.** The method name references the kind. Under shape-based logic, the check is "does this pipeline rebuild the target as a snapshot?" — true iff `config.source.query` is present. **Approval point: rename to `_isSnapshotWrite()`.** More accurate at the call sites (`_fullSync` guard against wiping the target twice; `_defaultWriteHandler` choosing INSERT vs. UPSERT).

4. **§A.4 — Existing test file rewrite strategy.** [`test/pipeline-validation.test.js`](../../../test/pipeline-validation.test.js) has 7 tests — 2 become obsolete (`throws when kind is missing`, `rejects unknown kind values`), 5 need rewriting to exercise shape-based contradictions instead of kind-based ones. **Approval point: rewrite in place.** Delete the 2 obsolete tests; rewrite the other 5; add 3–4 new tests for the positive-inference path (`infers delta for entity-shape`, `infers full for query-shape`, `populates inferredKind`). Keep `[4.6.3]` test-ID prefixes on the CQN-related tests — the requirement is unchanged.

5. **§A.5 — Observability log-line composition.** ADR 0007 §"Observability compensation" specifies:
   ```
   [cds-data-pipeline] registered 'OrdersCopy' — entity-shape from reporting.Orders → db.ArchivedOrders, mode=delta(timestamp modifiedAt), adapter=CqnAdapter
   ```
   The current log fires at `DataPipelineService.js:64` **after** `Pipeline.init()` — so `pipeline.adapter.constructor.name` is available. Field composition:
   - shape: `config.source.query ? 'query-shape' : 'entity-shape'`
   - source ref: `config.source.entity || '<query>'`
   - target ref: `config.target.service || 'db'` + `'.' + config.target.entity`
   - mode phrase: `mode + '(' + delta.mode + (delta.field ? ' ' + delta.field : '') + ')'` (omit parens when mode is full)
   - adapter: `pipeline.adapter?.constructor?.name || '<unresolved>'`
   
   **Approval point: accept the composition above**; compose the string in `DataPipelineService.addPipeline` after `pipeline.init()` returns.

6. **§A.6 — Docs surface for inference rules + validation matrix.** ADR 0007 §"Follow-up work" task 6 says "either in `concepts/terminology.md` or a new `concepts/inference.md`." **Approval point: new `concepts/inference.md`.** Keeps `terminology.md` narrow (existing purpose: define pipeline, source, target, mode, delta, tracker, event namespace); the inference rules + validation matrix warrant their own page. `terminology.md` loses the three-row kind-taxonomy table and gains a one-line pointer to `inference.md`.

---

## Affected files

| Group | Files | Change |
|---|---|---|
| ADR banner | [`spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md`](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) | Add partial-supersession banner at top naming ADR 0007 and the two affected sections (§"The kind taxonomy", `kind` arg in §"API renames"). |
| Engine code | [`packages/cds-data-pipeline/srv/DataPipelineService.js`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js) | Remove `VALID_KINDS`, `VALID_MATERIALIZE_DELTA_MODES`. Remove `kind` from public `addPipeline(config)` signature. Rewrite `_validateConfig` + `_validateSource` around the 5 implementable matrix rows (Approval §A.1). Replace `config.kind`-based defaults in `_normalizeConfig` with `config.source.query`-based defaults. Compose the shape-based startup log line per Approval §A.5. `VALID_SOURCE_KINDS` untouched. |
| Engine code | [`packages/cds-data-pipeline/srv/lib/Pipeline.js`](../../../packages/cds-data-pipeline/srv/lib/Pipeline.js) | Rename `_isMaterialize` → `_isSnapshotWrite` (Approval §A.3); body becomes `return !!this.config.source.query`. Update 2 call sites (`_fullSync` guard; `_defaultWriteHandler`). `_defaultWriteHandler`: change `config.kind === 'materialize'` → `!!config.source.query`. `_ensureTracker` keeps writing `kind: this.config.kind` (Approval §A.2 — derived, not user-input). Legacy backfill block (lines 329–333) unchanged. |
| Engine code | [`packages/cds-data-pipeline/srv/adapters/CqnAdapter.js`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js) | `readStream` branching: `this.config.kind === 'materialize'` → `!!this.config.source.query`. Rename private helpers `_readReplicate` → `_readEntityShape`, `_readMaterialize` → `_readQueryShape`. Rewrite JSDoc block (lines 5–22) around config shape + ADR 0007. Error strings in `_readMaterialize` drop `kind: 'materialize'` wording in favor of `source.query`. |
| Engine code | [`packages/cds-data-pipeline/srv/adapters/factory.js`](../../../packages/cds-data-pipeline/srv/adapters/factory.js) | One doc-comment update: line 11 reference `ADR 0005 §"The kind taxonomy"` → `ADR 0007 §"Inference rules"` (or drop the ADR reference entirely, since the factory routes by `source.kind` independently of pipeline shape). |
| Engine CDS | [`packages/cds-data-pipeline/db/index.cds`](../../../packages/cds-data-pipeline/db/index.cds) | `PipelineKind` type doc comment (lines 7–14): rewrite to say the enum is **derived** at registration from config shape, not user-supplied. No schema change; `Pipelines.kind` column stays. |
| Federation seam | [`packages/cds-data-federation/srv/pipeline-binding.js`](../../../packages/cds-data-federation/srv/pipeline-binding.js) | Drop `kind: 'replicate'` from the `addPipeline` call (line 33). Drop `kind: 'replicate'` mention from JSDoc (line 10). One-file, two-line change. |
| Engine docs | [`docs/pipeline/kinds/`](../../../docs/pipeline/) → `docs/pipeline/recipes/` | `git mv` directory. Rename `kinds/materialize.md` → `recipes/materialize.md`; rewrite intro paragraph + remove `kind: 'materialize'` wording. Add `recipes/replicate.md` + `recipes/move-to-service.md` (brief; the detailed behavior stays in `integration/cqn.md` / `odata.md` / `rest.md`). |
| Engine docs | [`packages/cds-data-pipeline/spec/concepts/terminology.md`](../../../packages/cds-data-pipeline/spec/concepts/terminology.md) | Remove the three-row kind-taxonomy table (lines 13–20). Replace with one-sentence pointer to `concepts/inference.md`. Update `PIPELINE.MAP` table note that references `@federation.replicate` — remove "for `replicate` pipelines bound from `@federation.replicate` annotations"; keep the cross-ref to federation. |
| Engine docs | `packages/cds-data-pipeline/spec/concepts/inference.md` (new) | Approval §A.6. Contains: inference rules table from ADR 0007 §"Inference rules"; validation matrix from §"Registration-time validation matrix" (5 rows implemented + 3 forward-looking marked `Planned`); examples (entity-shape replicate, query-shape materialize, entity-shape to non-db target). Link back to ADR 0007 for reasoning. |
| Engine docs | [`docs/pipeline/guide/sources/cqn.md`](../../../docs/pipeline/guide/sources/cqn.md) | Rewrite around shape, not kind. Drop all "consumption-view contract" prose (lines 16, 61). Rewrite the `## kind: 'replicate'` / `## kind: 'materialize'` section headings as `## Entity-shape read (row-preserving)` / `## Query-shape read (derived snapshot)`. Update code samples to drop the `kind:` arg and explain inference. Rewrite "Constraints" subsections in shape-based terms. |
| Engine docs | [`docs/pipeline/reference/features.md`](../../../docs/pipeline/reference/features.md) | Line 14 rewrite: drop "serves both `kind: 'replicate'` ... and `kind: 'materialize'`" → "serves both entity-shape (row-preserving) and query-shape (derived snapshot) reads based on whether `source.query` is supplied." |
| Engine docs | [`docs/pipeline/index.md`](../../../docs/pipeline/index.md) | Code sample at line 17: drop `kind: 'replicate',`. "Pipeline kinds" card heading → "Pipeline recipes"; body rewritten in recipe terms with link to `recipes/` folder. |
| Engine docs | [`docs/pipeline/reference/management-service.md`](../../../docs/pipeline/reference/management-service.md) | Line 3 prose "routes every `@federation.replicate` entity through this service as `kind: 'replicate'`" → drop the kind phrasing; pipelines seen here cover both programmatic and federation-originated bindings (period). Line 112 code sample: drop `kind: 'replicate',`. Line 154 external link text: drop `kind: 'replicate'` from the anchor text. |
| Engine docs | [`packages/cds-data-pipeline/spec/concepts/index.md`](../../../packages/cds-data-pipeline/spec/concepts/index.md) | Add a card pointing at the new `inference.md`. The existing disclaim about federation/consumption-view concepts stays. |
| Engine docs | [`packages/cds-data-pipeline/mkdocs.yml`](../../../packages/cds-data-pipeline/mkdocs.yml) | No nav entry for `kinds/` currently exists (verified). Add `concepts/inference.md` to the concepts nav; add `recipes/` section. |
| Idea graduation | [`spec/internal/ideas/consumption-view-vocabulary-in-pipeline-docs.md`](../ideas/consumption-view-vocabulary-in-pipeline-docs.md) | `Status: Exploring` → `Status: Promoted`. Fill `Promoted to: ADR 0007`. Add a short "## Resolution" section noting Option B's engine-native reasoning is the path taken as a side-effect of removing the kind discriminator — not the vocabulary question per se, but its mechanical resolution. |
| Requirements tracker | [`spec/reference/requirements.md`](../../reference/requirements.md) line 3 | Rewrite amendment banner: drop the "pipelines carry a required `kind: 'replicate' \| 'materialize' \| 'move'` discriminator" sentence; replace with an ADR 0007 reference clarifying intent is inferred from config shape, recipes (replicate / materialize / move-to-service) are the documented categories, and `kind` is a derived column on `Pipelines` rather than a user input. |
| Requirements tracker | [`spec/reference/requirements.md`](../../reference/requirements.md) Req 4.6.3 | Rewrite Req 4.6.3 language: drop `kind: 'replicate'` / `kind: 'materialize'` phrasing; describe the CQN adapter as serving entity-shape and query-shape reads, routed by `source.kind: 'cqn'`. No priority / status change. |
| Contributor primer | [`CLAUDE.md`](../../../CLAUDE.md) §"What this project is" | Rewrite the kind-mention sentence ("Each registered pipeline carries a required `kind` — currently `replicate` is implemented; `materialize` and `move` are planned (status-only in v1.0)"). Replace with one sentence: "Pipeline intent is inferred from the config shape (`source.query` vs. `source.entity`; `target.service` kind); see ADR 0007." |
| Contributor primer | [`AGENTS.md`](../../../AGENTS.md) | `grep kind` returned no hits — no change required. (Verified during Phase 1.) |
| Tests | [`test/pipeline-validation.test.js`](../../../test/pipeline-validation.test.js) | Rewrite per §Task 3 + Approval §A.4. |
| Tests | `test/pipeline.test.js` + adapter/integration tests | Grep for `kind: 'replicate'` / `kind: 'materialize'` in `test/` and drop the arg where it appears. |
| Examples | [`examples/`](../../../examples/) | No `addPipeline({ kind, ... })` calls in `examples/` — Phase 1 grep confirmed zero matches. Check examples `*.md` files for `kind:` literal in code blocks. |

---

## Tasks

Execution order. Each block is roughly one commit-sized unit, but the whole PR ships as a single commit per the implement-feature command (one atomic refactor).

### 1. ADR 0005 supersession banner (docs-only; 1 file)

- [ ] 1.1 Add a banner to the top of [`spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md`](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) under the existing `Supersedes` / `Amends` lines:
  > **Partially superseded 2026-04-19 by [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md).** §"The kind taxonomy" and the `kind` argument in §"API renames" are superseded. All other sections — engine rename, positioning statement, scope boundaries, sibling plugin family, event namespace (`PIPELINE.*`), tracker entities (`Pipelines` / `PipelineRuns`), service class rename (`DataPipelineService`), management path (`/pipeline`) — remain in force.

### 2. Engine validation rewrite (code-only; 1 file, ~80 LoC)

- [ ] 2.1 In [`DataPipelineService.js`](../../../packages/cds-data-pipeline/srv/DataPipelineService.js), remove constants `VALID_KINDS` (line 8) and `VALID_MATERIALIZE_DELTA_MODES` (line 9). Keep `VALID_SOURCE_KINDS` (line 10) unchanged — unrelated concern (source transport).
- [ ] 2.2 Rewrite `_validateConfig` + `_validateSource` around the 5 implementable matrix rows (Approval §A.1):
    1. `source.query` AND `source.entity` both set → Error ("ambiguous source shape; set one of source.query or source.entity, not both")
    2. neither `source.query` nor `source.entity` → Error ("missing source shape; set either source.entity for entity-shape reads or source.query for query-shape reads")
    3. `source.query` + `mode: 'delta'` → Error ("row-delta requires entity-shape source (source.entity); query-shape reads use mode: 'full' or 'partial-refresh'")
    4. `source.query` + `delta: { mode: 'timestamp' \| 'key' \| 'datetime-fields' }` → Error ("delta.mode '\<value\>' requires entity-shape source; query-shape reads do not support row-delta")
    5. `source.entity` + `mode: 'partial-refresh'` without `refresh.slice` closure → Error ("partial-refresh requires refresh.slice: (tracker) => \<CQN predicate\>")
  
  Preserve the CQN-adapter-specific validation in `_validateSource` (`source.kind === 'cqn'` branch): keep the "source.entity or source.query must be present when source.kind is 'cqn'" check — it's now a consequence of rules 1 and 2 above, applied with adapter-specific wording.
  
  Each error message references ADR 0007 in the final clause.

- [ ] 2.3 Remove the required-`kind` check (`!kind` at line 161) and the unknown-`kind` check (lines 168–173).
- [ ] 2.4 Rewrite `_normalizeConfig` default logic:
  - Line 251 `kind: config.kind` → compute derived kind: `inferredKind: deriveKind(config)` where `deriveKind` returns `'materialize'` if `config.source.query`, `'move'` if `config.target.service && config.target.service !== 'db'`, else `'replicate'`. Store on the internal field name `kind` (Approval §A.2) so downstream consumers in `Pipeline.js` keep working.
  - Line 262 `mode: config.mode || (config.kind === 'materialize' ? 'full' : 'delta')` → `mode: config.mode || (config.source.query ? 'full' : 'delta')`.
  - Line 264 `mode: config.kind === 'materialize' ? 'full' : 'timestamp'` → `mode: config.source.query ? 'full' : 'timestamp'`.
  - Line 280 `} else if (config.kind === 'materialize') {` → `} else if (config.source.query) {`.

- [ ] 2.5 Rewrite the registration log line at `addPipeline` (line 64) per Approval §A.5. Compose **after** `pipeline.init()` succeeds so `pipeline.adapter?.constructor?.name` is resolvable.

- [ ] 2.6 Remove `kind` from the documented public API in the class JSDoc. (If there is inline JSDoc on `addPipeline`, rewrite to say "config shape — see ADR 0007 / inference.md".)

### 3. Validation tests rewrite (test-first; 1 file, full rewrite)

- [ ] 3.1 Before touching engine code, write tests first (test-first convention). In [`test/pipeline-validation.test.js`](../../../test/pipeline-validation.test.js):
  - Delete tests: `throws when kind is missing`, `rejects unknown kind values`.
  - Rewrite 5 existing tests to assert shape-based errors instead of kind-based errors:
    - `throws when kind: 'replicate' is given with source.query` → `rejects source.query + mode: 'delta'` AND `rejects source.query + source.entity both set (ambiguous)`.
    - `[4.6.3] rejects source.kind: 'cqn' on kind: 'replicate' when source.query is supplied` → `[4.6.3] rejects source.kind: 'cqn' with both source.query and source.entity`.
    - `[4.6.3] rejects source.kind: 'cqn' on kind: 'materialize' without source.query` → `[4.6.3] rejects source.kind: 'cqn' with neither source.query nor source.entity`.
    - `[4.6.3] rejects partial refresh without an explicit slice closure` → keep almost verbatim; drop the `kind: 'materialize'` arg.
    - `rejects kind: 'materialize' with a non-allowed delta.mode` → `rejects source.query + delta.mode: 'timestamp'` (and separate cases for `'key'` and `'datetime-fields'`).
  - Add positive-inference tests:
    - `infers mode: 'delta' for entity-shape source (source.entity, no source.query)` — after `addPipeline`, read the `Pipelines` row and assert `mode: 'delta'`.
    - `infers mode: 'full' for query-shape source (source.query)` — same, assert `mode: 'full'`.
    - `populates Pipelines.kind as 'replicate' for entity-shape + db target`.
    - `populates Pipelines.kind as 'materialize' for query-shape`.
    - `populates Pipelines.kind as 'move' for entity-shape + non-db target.service`.
  - Add log-assertion test (optional; scope permits): assert the registration log line contains the expected shape keyword. Use `sinon.spy` on `cds.log('cds-data-pipeline').info` or equivalent. If this is awkward to wire in the test harness, skip and verify manually in Phase 4.

- [ ] 3.2 Run the rewritten suite — expect failures (the engine still enforces `kind`). Record the failure list.
- [ ] 3.3 Execute Task 2 (engine rewrite). Re-run. Fix until green.

  Validation command for this task:
  ```
  npx jest --runInBand --forceExit --roots test/ --testNamePattern "DataPipelineService.addPipeline — validation"
  ```

### 4. Pipeline.js shape-based discrimination (code-only; 1 file, ~10 LoC)

- [ ] 4.1 Rename `_isMaterialize` → `_isSnapshotWrite`; body becomes `return !!this.config.source?.query`. Update docstring.
- [ ] 4.2 Update the two call sites (`_fullSync` line 107; `_defaultWriteHandler` line 299). Comment at line 294–298 rewrites: replace "Materialize rebuilds ..." with "Query-shape pipelines rebuild the (slice of the) snapshot from scratch each run — `_prepareMaterializeTarget()` has already cleared the target inside the pipeline's tx, so an INSERT is both sufficient and correct. For entity-shape pipelines we keep UPSERT for idempotency across re-runs (Req 4.4.4)."
- [ ] 4.3 Leave `_ensureTracker` untouched beyond verifying `this.config.kind` is populated by the derived inference (Task 2.4). The legacy backfill block (lines 329–333) still works against the derived value.

### 5. CqnAdapter shape-based branching (code-only; 1 file, ~30 LoC)

- [ ] 5.1 In [`CqnAdapter.js`](../../../packages/cds-data-pipeline/srv/adapters/CqnAdapter.js), rename `_readReplicate` → `_readEntityShape` and `_readMaterialize` → `_readQueryShape`. Rewrite the JSDoc block (lines 5–22) around config shape — drop the `kind: 'replicate'` / `kind: 'materialize'` vocabulary, reference ADR 0007 + `concepts/inference.md`.
- [ ] 5.2 Rewrite `readStream` branching: `const kind = this.config.kind; if (kind === 'materialize') { yield* ...` → `if (this.config.source?.query) { yield* this._readQueryShape(tracker); return; } yield* this._readEntityShape(tracker)`.
- [ ] 5.3 Update error strings inside `_readQueryShape` (the ex-`_readMaterialize`) — drop `kind: 'materialize'` literal in favor of `source.query`. E.g. line 87 `CqnAdapter: kind: 'materialize' requires source.query to be a closure returning a CQN SELECT.` → `CqnAdapter: source.query must be a closure returning a CQN SELECT (query-shape pipelines only).`
- [ ] 5.4 [`factory.js`](../../../packages/cds-data-pipeline/srv/adapters/factory.js) line 11 comment: drop the `ADR 0005 §"The kind taxonomy"` reference; re-ground in `source.kind` as the explicit discriminator (the factory never cared about pipeline kind — only source kind).

### 6. Federation scanner update (code-only; 1 file, 2-line change)

- [ ] 6.1 [`pipeline-binding.js`](../../../packages/cds-data-federation/srv/pipeline-binding.js) line 33: drop `kind: 'replicate',`.
- [ ] 6.2 Line 10 JSDoc: drop "as a single `addPipeline({ kind: 'replicate', ... })` call"; replace with "as a single `addPipeline(...)` call — the engine infers the entity-shape pipeline intent from the absence of `source.query`."

### 7. CDS schema doc comment (docs-only; 1 file)

- [ ] 7.1 [`db/index.cds`](../../../packages/cds-data-pipeline/db/index.cds) `PipelineKind` doc comment (lines 7–14): rewrite. Current text says the enum "Discriminates the intent of each linear READ -> MAP -> WRITE job. See ADR 0005." New text:
  > Derived discriminator for pipeline intent. **Populated by the engine at registration time** based on config shape (see ADR 0007 and `concepts/inference.md`); not a user-supplied field on `addPipeline(...)`. Retained as a column for management-UI filtering / grouping.
  > - `replicate` — entity-shape read to a db target (row-preserving UPSERT).
  > - `materialize` — query-shape read (aggregated / derived snapshot; TRUNCATE + INSERT or scoped DELETE + INSERT).
  > - `move` — entity-shape read to a non-db target.

### 8. Engine-package docs rewrite (docs-only; ~8 files)

- [ ] 8.1 `git mv docs/pipeline/kinds docs/pipeline/recipes`.
- [ ] 8.2 Rewrite `recipes/materialize.md`: retitle to "Materialize recipe (query-shape read, snapshot write)"; drop `kind:` from code samples; replace all `kind: 'materialize'` prose with `source.query` references; line 5 consumption-view sentence → "`materialize` is always paired with the [CQN adapter](../integration/cqn.md). Other adapters are not appropriate: CAP cannot translate aggregate queries across OData or REST, and entity-shape reads cannot express GROUP BY."
- [ ] 8.3 Create `recipes/replicate.md` — short page (~40 lines): one-paragraph description ("Entity-shape read, row-preserving UPSERT write. The default when you pass `source.entity` and no `source.query`."), one example, pointers to `integration/odata.md`, `integration/cqn.md`, `integration/rest.md`.
- [ ] 8.4 Create `recipes/move-to-service.md` — short page: describes entity-shape read with `target.service !== 'db'`. Note the per-target-adapter idempotency caveats from the ADR. Include a cautionary sentence: target-adapter capability declarations are not implemented in v1 (Approval §A.1); writes currently go only to `db`. Link to [`ideas/service-to-service-data-movement.md`](../../../spec/internal/ideas/service-to-service-data-movement.md) (internal) for the future target-adapter story — **keep this internal link even though it crosses the internal/external boundary**, with a note that it's internal-only, OR omit if the ADR 0006 convention rejects it. (Approval §A.7 is implicit here — if we decide no internal links from external docs, this becomes a short stub pointing only at ADR 0007.)
- [ ] 8.5 Create `concepts/inference.md` per Approval §A.6. Sections: "Inference rules" (from ADR 0007), "Registration validation" (5 implemented + 3 planned), "Recipes" (links to `recipes/replicate.md`, `recipes/materialize.md`, `recipes/move-to-service.md`), "See also → ADR 0007".
- [ ] 8.6 Rewrite [`concepts/terminology.md`](../../../packages/cds-data-pipeline/spec/concepts/terminology.md): remove the three-row kind-taxonomy table (lines 13–20); replace with a one-sentence pointer to `inference.md`. Update `PIPELINE.MAP` table row note.
- [ ] 8.7 Rewrite [`integration/cqn.md`](../../../docs/pipeline/guide/sources/cqn.md) — the full cqn.md file:
  - Drop the section headings `## kind: 'replicate'` / `## kind: 'materialize'`; replace with `## Entity-shape read (row-preserving)` / `## Query-shape read (derived snapshot)`.
  - Drop `kind:` from every code sample's `addPipeline` config.
  - Rewrite line 16 ("The consumption-view projection is the schema…") and line 61 ("arbitrary CQL would bypass the consumption-view contract") in shape-based terms. Line 16 becomes: "Entity-shape reads use the target entity's projection as the schema — column restriction, renames, and `where` clauses declared on the projection flow through the view mapping exactly as they do for the OData adapter." Line 61 becomes: "`source.query` is incompatible with entity-shape reads. If you need `source.query`, omit `source.entity`; the engine infers query-shape semantics (full/partial refresh)."
- [ ] 8.8 Rewrite [`reference/features.md`](../../../docs/pipeline/reference/features.md) line 14 per §Affected files.
- [ ] 8.9 Rewrite [`index.md`](../../../docs/pipeline/index.md): drop `kind: 'replicate',` from the code sample; rename "Pipeline kinds" card → "Pipeline recipes"; card body updated.
- [ ] 8.10 Rewrite [`reference/management-service.md`](../../../docs/pipeline/reference/management-service.md) lines 3, 112, 154 per §Affected files.
- [ ] 8.11 Update [`concepts/index.md`](../../../packages/cds-data-pipeline/spec/concepts/index.md) — add a grid card pointing at `inference.md`.
- [ ] 8.12 Update [`mkdocs.yml`](../../../packages/cds-data-pipeline/mkdocs.yml) nav: add `concepts/inference.md` under Concepts, add `recipes/` section (with the three recipe pages) between Integration and Reference.

### 9. Idea graduation (docs-only; 1 file)

- [ ] 9.1 Update [`spec/internal/ideas/consumption-view-vocabulary-in-pipeline-docs.md`](../ideas/consumption-view-vocabulary-in-pipeline-docs.md):
  - `Status: Exploring` → `Status: Promoted`.
  - Fill `Promoted to: ADR 0007`.
  - Add `## Resolution` section (short): the original three-way option (A/B/C) became moot once [ADR 0007](../decisions/0007-infer-pipeline-intent-from-config-shape.md) removed the `kind` discriminator. The kind-based error strings that were the primary carrier of "consumption-view contract" vocabulary into the engine package were rewritten as shape-based errors that don't reach for federation concepts. The remaining cqn.md prose mentioning "consumption-view projection" was reworded in shape-based terms (see Task 8.7). Option B (engine-native reasoning) is effectively the path taken — as a side-effect of the larger refactor, not as a standalone choice.

### 10. Requirements tracker + contributor primer (docs-only; 2 files)

- [ ] 10.1 [`spec/reference/requirements.md`](../../reference/requirements.md) line 3 amendment banner — rewrite per §Affected files.
- [ ] 10.2 Req 4.6.3 language — rewrite per §Affected files. No row additions; no priority or status change. `npm run sync:requirements` is a no-op for this refactor (no status flips).
- [ ] 10.3 [`CLAUDE.md`](../../../CLAUDE.md) §"What this project is" — rewrite the "each registered pipeline carries a required `kind`" sentence per §Affected files.

### 11. Examples scan (zero-code; verification only)

- [ ] 11.1 `grep -r "kind:\s*['\"]\\(replicate\\|materialize\\|move\\)['\"]" examples/` — expected to return 0 hits (verified in Phase 1). If any appear, drop the arg; otherwise this task is a no-op.
- [ ] 11.2 `grep -r "addPipeline" examples/` — expected to return 0 hits (Phase 1 verified). If any appear, update them.
- [ ] 11.3 Check `examples/consumer/README.md` and any `examples/**/*.md` for `kind:` literals in inline code blocks. Replace to align with the rewritten pipeline API.

### Non-tasks (explicitly not changing in this PR)

To keep the diff scoped, the following **stay unchanged**:

- Engine package name, npm identifier (`cds-data-pipeline`).
- Service class name (`DataPipelineService`), management service class name (`DataPipelineManagementService`), management path (`/pipeline`).
- Event namespace (`PIPELINE.READ / MAP / WRITE`).
- Tracker entity names (`Pipelines`, `PipelineRuns`), FK column names.
- `VALID_SOURCE_KINDS` (`cqn`, `odata`, `odata-v2`, `rest`) — source transport, unrelated.
- `@federation.delegate` / `@federation.replicate` annotation surface and scanner behavior (except the one-line `kind: 'replicate'` drop from `pipeline-binding.js`).
- `cds-data-federation` package / module layout; `replicated` aspect; consumption-view handling on the federation side.
- Engine `_defaultWriteHandler` hard-coded `cds.connect.to('db')` — remains DB-only; target-adapter capability layer is out of scope (Approval §A.1).
- Sibling plugin family (ADR 0005 §"Sibling plugin family") — `cds-data-materialization` and `cds-data-movement` status remain unchanged.

---

## Test strategy

Test-first per the implement-feature Phase 3 contract. Sequence:

1. **Write tests** in [`test/pipeline-validation.test.js`](../../../test/pipeline-validation.test.js) before touching engine code (Task 3).
2. **Run and expect failures**: `npx jest --runInBand --forceExit --roots test/ --testNamePattern "DataPipelineService.addPipeline — validation"`.
3. **Refactor engine code** (Tasks 2, 4, 5, 6, 7) until the test suite goes green.
4. **Run full suite** (Phase 4): `npx jest --runInBand --verbose --forceExit --roots test/` to catch regressions in `test/pipeline.test.js`, `packages/cds-data-pipeline/test/integration/` (if it still exists), `packages/cds-data-federation/test/unit/ or packages/cds-data-pipeline/test/unit/`, adapter tests, and provider tests.
5. **Run lint**: `npm run lint`.
6. **Manual verification**: boot `examples/consumer/` and confirm:
   - `@federation.replicate`-annotated entities register successfully (scanner drops the `kind` arg).
   - The new shape-based log line appears, e.g. `[cds-data-pipeline] registered 'Products' — entity-shape from ProviderService.Products → db.Products, mode=delta(timestamp modifiedAt), adapter=ODataAdapter`.
   - The management service at `/pipeline` continues to report `Pipelines.kind` as `'replicate'` for every federation-bound pipeline.

Validation commands:

```
npx jest --runInBand --forceExit --roots test/ --testNamePattern "DataPipelineService.addPipeline — validation"
npx jest --runInBand --verbose --forceExit --roots test/
npm run lint
```

---

## Approval points

Four points require explicit approval before Phase 3 starts. The plan proposes a recommendation for each; if the user disagrees, Phase 2 re-opens.

- **A.1 — Target-adapter capability validation** (rows 6–8 of ADR 0007's matrix). Proposal: defer to a follow-up ADR; implement the other 5 rows now; mark the deferred three as `Planned — unlocked when target-adapter capability layer lands` in `concepts/inference.md`.
- **A.2 — Internal `config.kind` field name.** Proposal: keep the name `kind` internally; semantics shift from user-input to derived; JSDoc clarifies.
- **A.3 — `Pipeline._isMaterialize` rename.** Proposal: rename to `_isSnapshotWrite`.
- **A.4 — Test rewrite strategy.** Proposal: rewrite `pipeline-validation.test.js` in place (delete 2 obsolete tests, rewrite 5, add 3–4 positive-inference tests). Keep `[4.6.3]` test-ID prefixes.
- **A.5 — Observability log-line composition.** Proposal: the format specified in §A.5 above, composed after `pipeline.init()` returns.
- **A.6 — Inference docs location.** Proposal: new file `packages/cds-data-pipeline/spec/concepts/inference.md`; `terminology.md` becomes a one-line pointer.

---

## Open questions

Not approval-blocking; surface during Phase 3 if they become material:

1. `cds-plugin.js` in `packages/cds-data-pipeline/` — I did not re-read it during Phase 1. If it references `kind` anywhere, add to Task 2.
2. Test-mapping regeneration (`spec/reference/test-mapping.md`) — auto-generated; run `npm run sync:requirements` after the test file rewrites to refresh.
3. `examples/sales-intel/` paths referenced in [`spec/internal/plans/reposition-as-pipeline.md`](./reposition-as-pipeline.md) — this older plan lists sales-intel paths that may or may not carry `addPipeline` calls; Task 11 greps to confirm.

---

## Post-implementation checklist (Phase 5 — documentation)

Per the implement-feature Phase 5 contract, but adapted for a refactor with no `Implemented` status flips:

1. **`spec/reference/requirements.md`** — amendment banner + Req 4.6.3 language rewritten (Task 10.1, 10.2). No status changes; `npm run sync:requirements` run anyway to regenerate Progress Summary counts in case tagging shifted.
2. **Per-package `features.md`** — [`docs/pipeline/reference/features.md`](../../../docs/pipeline/reference/features.md) line 14 rewritten (Task 8.8). Federation-scope `features.md` unchanged (refactor does not cross the binding seam — the one-line scanner update has no consumer-visible effect).
3. **README.md** — root [`README.md`](../../../README.md): check for `kind:` literal in any feature-matrix row. If present, rewrite in shape/recipe terms. `packages/cds-data-pipeline/README.md` similar check (Phase 1 didn't grep it; will during Phase 3).
4. **CLAUDE.md** — Task 10.3.
5. **Plan doc** — move this file to `spec/internal/plans/completed/infer-pipeline-intent-from-config-shape.md` after Phase 4 goes green.
6. **Examples** — no `addPipeline({ kind: ... })` calls in examples (Phase 1 verified); no UI/FE surface affected; no tile changes needed.

---

## Commit

Single conventional commit after Phase 5 doc updates are in the working tree:

```
refactor: infer pipeline intent from config shape; drop `kind` discriminator

Implements ADR 0007. Partially supersedes ADR 0005 §"The kind taxonomy"
and the `kind` argument in §"API renames".
```

Do NOT commit until Phase 4 is green AND Phase 5 doc updates are staged. Wait for user confirmation before `git commit` — this touches the public `addPipeline` signature.
