# 5. Reposition engine as `cds-data-pipeline`: general-purpose CAP-layer data pipeline with kinds

**Date:** 2026-04-19
**Status:** Accepted
**Supersedes:** [ADR 0003](./0003-split-plugin-into-replication-and-federation.md), [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md)
**Amends:** [ADR 0001](./0001-replication-service-extends-cds-service.md) (event-namespace rename only)

> **Partially superseded 2026-04-19 by [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md).**
> §"The kind taxonomy" and the `kind` argument in §"API renames" are superseded — pipeline intent is inferred from the config shape (`source.query` vs. `source.entity`; `target.service` kind). All other sections — engine rename, positioning statement, scope boundaries, sibling plugin family, event namespace (`PIPELINE.*`), tracker entities (`Pipelines` / `PipelineRuns`), service class rename (`DataPipelineService`), management path (`/pipeline`) — remain in force.

## Context

The project sits pre-release (v0.1.0, never published under its current `cds-data-federation` identity; the git folder is still `cds-data-replication` per [`CLAUDE.md`](../../../CLAUDE.md) §"What this project is"). Between [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) and now, three conversations converged on the same underlying observation from different angles:

| Conversation | Question that surfaced | ADR that captured it |
|---|---|---|
| CQN adapter use cases for [Req 4.6.3](../../reference/requirements.md) | Is aggregated-rollup materialization federation? | [0003](./0003-split-plugin-into-replication-and-federation.md) — "no, federation ≠ materialization; split plugin" |
| Service-to-service target adapters | Is outbound data movement federation? | [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) Question 1 — left open |
| Is the CQN-adapter rollup example *replication*? | Row-preserving correspondence vs. derived aggregate | This ADR |

The third question is the deepest. The example in [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) §"What use case 1 looks like in application code" runs a `GROUP BY` + `SUM / COUNT / MAX` on the source and UPSERTs a per-customer snapshot. No row in the target corresponds to one row in the source; every target row is a derived aggregate of many source rows. Delta-by-`modifiedAt` is meaningless for aggregates (one new order mutates an existing target aggregate, it does not produce a new target row with a fresh timestamp). UPSERT's idempotency guarantee ([Req 4.4.4](../../reference/requirements.md)) holds only if we recompute every aggregate every run.

That's a **materialization**, not a replication. Industry tools keep the two concepts separate:

- Fivetran / Airbyte: "Replication" (ingestion, row-preserving) vs. "Transformations" (dbt, aggregation).
- PostgreSQL: logical replication vs. `CREATE MATERIALIZED VIEW`.
- Debezium: CDC, strictly row-preserving.
- CAP's own [`@federated`](https://cap.cloud.sap/docs/guides/integration/data-federation) and [xtravels `data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js): strictly row-preserving.

Meanwhile the engine's internals — the READ→MAP→WRITE phase pipeline ([ADR 0001](./0001-replication-service-extends-cds-service.md)), the `Federations`/`ReplicationRuns` tracker, `withRetry`, the concurrency guard, source adapters, cron scheduling, management OData API, event hooks — are all **pattern-agnostic**. None of them reference "replication" or "federation" or "remote" semantically. Every one of them applies equally to:

- Row-preserving copy from source to target (replication)
- Derivation / aggregation / snapshot of a source query (materialization)
- Forwarding output to a non-`db` target service (movement — the parallel question in [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md))

If the abstraction doesn't care which of these is running, the name shouldn't either. Calling the engine `cds-data-replication` (as [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) proposed) accurately reflects one of its uses and hides two others.

### The CAP-ecosystem gap

There is no CAP-layer primitive for declarative, traceable, scheduled, in-process data movement between services. The gap is directly observable:

| Layer | Tool | Position |
|---|---|---|
| Platform / inter-system | SAP Integration Suite, Cloud Integration, SDI, SLT | Out-of-process, heavy, separate deployment, enterprise governance |
| Database / infrastructure | HANA SDI, Kafka Connect, Debezium | Below the application layer |
| ETL / ELT | Fivetran, Airbyte, dbt | Out-of-process, separate product |
| Application-layer capabilities (single concern) | `cds-caching`, [`@cap-js/change-tracking`](https://github.com/cap-js/change-tracking), [`@cap-js/telemetry`](https://github.com/cap-js/telemetry) | In-process, one concern each |
| **Application-layer data movement** | — | **Gap.** Closest prior art: [xtravels `data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) (~20 lines, no tracker, no UI, no retry, no concurrency guard). |

The CAP Data Federation guide ships the xtravels sample as the recommended starting point, and every project that needs production-grade characteristics (tracker, admin UI, retry, concurrency, dead-letter, observability) graduates beyond it by building their own. That is a product-shaped gap. Filling it requires a single-concern CAP plugin whose concern is *data pipelines between services in the application layer*.

### The question answered in this ADR

*Do we ship the engine as `cds-data-replication` (narrow, row-preserving-only, per ADR 0003) and add separate sibling engines later for materialization / movement, or do we ship the engine as `cds-data-pipeline` (broad, pattern-agnostic, with explicit kind taxonomy) from day one?*

### Constraints

- **Pre-release freedom.** Nothing is published under `cds-data-federation`. One rename before v0.1.0 is ~two days of mechanical refactor plus a retelling of the project's story. One rename after v1.0.0 is prohibitive. This is the one cheap moment; after first release the window closes.
- **Composition discipline from [`CLAUDE.md`](../../../CLAUDE.md) §Conventions.** The plugin composes with `cds-caching` rather than reinventing caching. The same discipline applied one layer deeper says: the engine is a primitive, declarative consumers (federation, materialization-annotation, …) layer on top.
- **Anti-grab-bag precedent from [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) §"Side note".** The [`@cap-js-community/common`](https://github.com/cap-js-community/common) failure mode is the trajectory to avoid. "General-purpose data pipeline" is one concern, not a grab-bag — provided the scope boundaries are drawn explicitly.
- **CAP-model-awareness is the differentiator.** Positioning is above hand-coded `cds.spawn`, below Integration Suite. Not competing with iPaaS. Not a visual modeler. Not a cross-source joiner. CAP-native through and through.

### Options considered (re-opened from ADR 0003 Option C)

| Option | Name | Scope | Verdict |
|---|---|---|---|
| **A — Broaden vocabulary, keep `cds-data-replication`.** Add `kind: 'replicate' \| 'materialize' \| 'move'`; tracker and events stay in replication-flavored naming; README explains the inclusive usage. | `cds-data-replication` | Broad | Rejected — naming continues to privilege one kind over the others; future readers have to learn "replication here means something broader than elsewhere." |
| **B — Narrow `cds-data-replication` to row-preserving only.** Drop materialization / movement; add sibling engines later per need. | `cds-data-replication` + potential siblings | Narrow | Rejected — reinvents pipeline primitives (tracker, adapters, retry, events, management API) per sibling engine. Duplication without real isolation benefit. |
| **C — Rename engine to `cds-data-pipeline` with explicit kind taxonomy.** Pattern-agnostic primitive; declarative consumers ship as sibling annotation plugins. | `cds-data-pipeline` + `cds-data-federation` [+ future siblings] | Broad with hard scope boundary | **Selected.** |
| **D — Platform framing.** "CAP Data Integration Platform" with composable jobs, DAGs, cross-source joins, visual modeler. | n/a | Platform / iPaaS | Rejected — explicitly off-scope. The value is staying small, CAP-model-aware, in-process. DAGs and visual modelers belong in Integration Suite. |

The selection argument:

- Option A mis-names the engine. One-kind vocabulary will quietly bias API surface, docs tone, and future features toward replication.
- Option B duplicates the nontrivial engine primitives (tracker, adapters, management API, retry, events, scheduling) every time a sibling appears. The primitives are ~1200 LoC of tested infrastructure; duplicating them three times is worse than naming honestly and reusing.
- Option D abandons the differentiator. An iPaaS-shaped CAP plugin competes with tools that already do it better out-of-process.
- Option C reflects what the engine actually is, ships a minimal surface day one, reserves sibling plugins for declarative sugar, and has a hard upper scope boundary (no DAGs, no joins, no visual modeler, no cross-source composition).

## Decision

**Rename the engine package to `cds-data-pipeline`. Ship with an explicit `kind` taxonomy (`replicate`, `materialize`, `move`) declared up front and implemented incrementally. `cds-data-federation` continues as the annotation-layer sibling that consumes it (unchanged name, unchanged user-visible annotations). Future annotation surfaces (e.g. `cds-data-materialization`) ship as further siblings.**

### Positioning statement (for READMEs, docs/index.md, package.json description)

> `cds-data-pipeline` is a CAP application-layer plugin for declarative, traceable, scheduled data pipelines between CAP services. Each pipeline is a linear `READ → MAP → WRITE` job between exactly one source and one target, with built-in tracker, retry, concurrency guard, management OData API, and event hooks. It sits above hand-coded `cds.spawn` replication (which lacks production characteristics) and below SAP Integration Suite / SDI / SLT (which solve cross-system, cross-protocol, out-of-process problems). It does not compose pipelines, does not join across sources, does not ship a visual modeler.

### Explicit scope boundaries

**In scope (permanent):**

- Linear `READ → MAP → WRITE` job between one source and one target
- Source adapters (OData, REST, CQN, custom `BaseAdapter`)
- Scheduled execution (cron) + manual trigger + future event-driven triggers
- Tracker, runs, statistics, management OData API
- `withRetry`, concurrency guard, batching, streaming
- User event hooks (`before / on / after` for each phase)
- CAP-model-awareness throughout (CQL, CSN, `cds.requires`, `cds.connect.to`, `cds.Service`, `cds.context`)

**Out of scope (permanent — stated in positioning):**

- Multi-source joins inside the pipeline (ETL engine territory)
- DAGs, fan-in, fan-out, pipeline composition (orchestrator territory)
- Transformation DSL beyond the `MAP` event hook (dbt territory)
- Visual modeler / UI composer (iPaaS territory)
- Adapter marketplace / community-hosted adapters (integration-platform territory)
- CDC / log-based change capture (Debezium territory; below app layer)

**Out of scope for v1, maybe-later:**

- Event publishing as a sink (messaging layer — reconsider if the `move` kind's feedback justifies it)
- Archival / cold-storage movement (niche — served by `move` kind if at all, not as a separate concern)

The scope statement lives in ADR 0005 (here), the engine README, and the positioning paragraph of [`docs/index.md`](../../index.md) in lockstep, per [ADR 0002](./0002-separate-internal-and-published-docs.md) style rules.

### The kind taxonomy

Every pipeline declares a `kind`. The engine validates per-kind constraints and per-kind defaults.

| `kind` | Semantic | Delta modes | WRITE semantic | Idempotency | Typical target | v1? |
|---|---|---|---|---|---|---|
| **`replicate`** | 1:1 row-preserving copy from source to target. Each target row corresponds to exactly one source row (possibly filtered, projected, renamed). | `timestamp`, `key`, `datetime-fields`, future `deltatoken` | UPSERT on key | Strong ([Req 4.4.4](../../reference/requirements.md)) | `db` (local table) | **v1** |
| **`materialize`** | Target is derived from a source query (aggregates, joins, DISTINCT, computed columns). Each target row corresponds to a group / derivation of source rows. | `full` default; `partial-refresh` (user-defined closure over `tracker`) as escape hatch | TRUNCATE + INSERT per key-scope *or* UPSERT with per-kind caveats | Weaker — guaranteed only under full refresh | `db` (local table) | **v1.x** (stretch; may slip to v1.x if v1 demands compress) |
| **`move`** | Forward pipeline output to a non-`db` target service (other CAP service, second S/4 tenant, REST backend). May or may not stage locally. | `timestamp` / `key` if source is row-preserving; `full` otherwise | Target-adapter-specific: OData PUT-by-key with 404→POST fallback, REST user-supplied `writeBatch`, etc. | Weaker — per-target contract | non-`db` (CAP service target) | **v1.x** (addresses [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md)) |

`kind` is **required** on every `addPipeline(...)` call. The engine rejects ambiguous or kind-inconsistent configurations at registration time (e.g. `kind: 'materialize'` + `delta.mode: 'timestamp'` → hard error with explanation). Future kinds go through a new ADR.

### API renames

| Before ([ADR 0003](./0003-split-plugin-into-replication-and-federation.md)) | After (this ADR) |
|---|---|
| Engine package `cds-data-replication` | **`cds-data-pipeline`** |
| Tracker entity `Replications` (which was renamed from `Federations`) | **`Pipelines`** |
| Runs entity `ReplicationRuns` | **`PipelineRuns`** |
| Programmatic API `addReplication({...})` | **`addPipeline({ kind, ... })`** |
| Service class `DataReplicationService` (ADR 0001) | **`DataPipelineService`** |
| Service stub `cds.connect.to('DataReplicationService')` | **`cds.connect.to('DataPipelineService')`** |
| Phase event namespace `REPLICATE.READ / MAP / WRITE` (ADR 0001) | **`PIPELINE.READ / MAP / WRITE`** |
| Management service (OData) | **`DataPipelineManagementService`** (same role, renamed) |
| Default `replicated` aspect (`lastReplicatedAt`, `lastReplicatedBy`) | **`pipelined`** aspect (`lastPipelineRunAt`, `lastPipelineRunBy`) — debatable; see Consequences |

The `@federation.*` annotation surface does **not** change. `@federation.delegate` / `@federation.replicate` stay exactly as they are today. Under the hood, the federation scanner calls `addPipeline({ kind: 'replicate', ... })` on the peer-installed engine. This preserves the external API for the one federation user case that exists and avoids churning the already-documented annotation surface.

### Sibling plugin family (concretized)

```
cds-data-pipeline                  # engine (v1) — programmatic + events + tracker; no annotations of its own
  ├── cds-data-federation          # annotation plugin (v1) — @federation.delegate, @federation.replicate → kind:'replicate'
  ├── cds-data-materialization     # annotation plugin (future, if demand) — @materialize.snapshot → kind:'materialize'
  └── (cds-data-movement?)         # may not need to exist as its own plugin — programmatic API on pipeline covers it
```

- `cds-data-pipeline` has **no annotations of its own**. It is consumed programmatically (`addPipeline(...)`) or via events. This mirrors `cds-caching`'s composition discipline: the primitive is neutral; declarative sugar layers on top.
- `cds-data-federation` remains unchanged in name and user-visible annotation surface. It peer-depends on `cds-data-pipeline`.
- `cds-data-materialization` is deferred to a separate ADR and a separate repo (or later, a sibling workspace). Not shipped in v1. The stub is [`spec/internal/ideas/cds-data-materialization.md`](../ideas/cds-data-materialization.md).
- A dedicated `cds-data-movement` plugin is **probably unnecessary**. The `move` kind is reachable via the programmatic API, and service-to-service data copy is usually set up once per integration — annotation syntax wouldn't add much. Revisit only if evidence accumulates.

### Monorepo layout (refined from ADR 0003)

```
cds-data-replication/                   # repo root unchanged (GitHub repo rename deferred)
├── packages/
│   ├── cds-data-pipeline/              # engine (renamed from cds-data-replication in ADR 0003)
│   │   ├── cds-plugin.js
│   │   ├── srv/
│   │   │   ├── DataPipelineService.js
│   │   │   ├── DataPipelineManagementService.js
│   │   │   ├── adapters/               # BaseAdapter, OData, REST, Cqn, factory
│   │   │   └── lib/                    # Pipeline.js (per-job driver), retry.js, scheduler
│   │   ├── db/index.cds                # Pipelines, PipelineRuns, pipelined aspect
│   │   ├── package.json                # name: cds-data-pipeline
│   │   └── README.md
│   └── cds-data-federation/
│       ├── cds-plugin.js
│       ├── srv/
│       │   ├── annotation-scanner.js
│       │   ├── delegation/
│       │   ├── lib/ (ViewMapping.js, navigation helpers)
│       │   └── pipeline-binding.js     # renamed from replication-binding.js; still ~200 LoC
│       ├── package.json                # peerDep: cds-data-pipeline, cds-caching
│       └── README.md
├── examples/                           # consumer app — depends on both via workspace:
├── test/                               # shared harness
├── docs/                               # two top-level sections: pipeline + federation
├── package.json                        # workspaces
└── README.md                           # umbrella
```

## Consequences

### What this enables

- **Honest naming.** The engine's name reflects what it *is*, not just its first use case. Every internal concept (`Pipelines` tracker, `PipelineRuns`, `PIPELINE.*` events, `addPipeline`) reinforces the abstraction instead of a single specialization of it.
- **Fills the CAP-layer gap** identified above. A declarative, traceable, in-process data pipeline primitive that currently does not exist in the CAP ecosystem.
- **Clean semantics per kind.** Replication keeps its row-preserving / UPSERT / delta guarantees. Materialization gets its own docs about aggregation / full-refresh / escape-hatch. Movement gets its own docs about target-adapter idempotency contracts. No single abstraction carries contradictions.
- **Future-proofs adjacent discussions.** [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) Question 1 ("is service-to-service movement in scope for a federation plugin?") resolves: yes, as `kind: 'move'` on the pipeline engine, no annotation plugin required. Use case 1 of [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) (aggregated rollup) resolves: yes, as `kind: 'materialize'` with `source.query` on the pipeline engine.
- **Hard scope line.** The positioning statement + explicit out-of-scope list + "linear, one source, one target" discipline mean the engine stays small. "Pipeline" as a name has feature-creep risk; the boundary is drawn in the foundational ADR (here), the README, and the published positioning paragraph.
- **CAP ecosystem fit.** Matches the Calesi first-party pattern (`@cap-js/...` plugins, each single-concern). Peer-dep composition matches `cds-caching`. No grab-bag trajectory — each sibling plugin has one concern.

### What we accept as trade-offs

- **Engine name changes three times in the project's history.** `cds-data-replication` (Phase 1 rename to `cds-data-federation`, [requirements.md §"Implementation History"](../../reference/requirements.md)) → `cds-data-federation` (Phase 1, implicit) → `cds-data-replication` engine + `cds-data-federation` annotation ([ADR 0003](./0003-split-plugin-into-replication-and-federation.md)) → `cds-data-pipeline` engine + `cds-data-federation` annotation (this ADR). Mitigation: nothing published yet, zero external users. The ADR trail makes the reasoning traceable — each rename refined understanding, none reversed a previously shipped decision.
- **Event-namespace rename ripples into tests.** Every hook registered as `before('REPLICATE.READ', ...)` becomes `before('PIPELINE.READ', ...)`. Mechanical refactor. [ADR 0001](./0001-replication-service-extends-cds-service.md) gets an amendment note at its top-of-file.
- **Engine ships with more surface area than strictly needed for v1.** Even if v1 only implements `kind: 'replicate'`, the taxonomy is declared and `kind` is required on `addPipeline`. Rationale: forward compatibility is much cheaper to declare than to retrofit. The CDS schema for `Pipelines` includes a `kind` column day one.
- **Two declarative surfaces (federation, future materialization) rather than one.** Users who want materialization install `cds-data-pipeline` + a hypothetical future `cds-data-materialization`, the way caching users install `cds-caching`. Consistent with the composition model but an extra install step compared to a single giant plugin. Acceptable per the first-party Calesi convention.
- **Some aspects keep `replicated` flavor.** The `@replicated` aspect name is a user-facing API on consumption views (a row is "replicated" to the local DB). Renaming it to `@pipelined` would be semantically weird for the `replicate` kind (the row *is* replicated, not merely pipelined). Options: keep `replicated` as a kind-specific aspect offered by the federation plugin (not the engine); add `materialized` as a kind-specific aspect offered by a future materialization plugin. Left deliberately unresolved here — it's a federation-side detail, not an engine-level one.
- **Positioning discipline required.** The biggest ongoing risk is scope creep into orchestrator / ETL / iPaaS territory. Mitigation: the out-of-scope list is part of the foundational ADR and gets copied into the engine README as a "What this is / What this isn't" section.

### Supersessions and amendments

- **[ADR 0003](./0003-split-plugin-into-replication-and-federation.md) — superseded by this ADR.** The split is preserved (two packages, monorepo under npm workspaces, peer-dep model, `Federations → Replications` tracker rename). The engine package name changes from `cds-data-replication` to `cds-data-pipeline`; the tracker rename target changes from `Replications` to `Pipelines`; the API name changes from `addReplication` to `addPipeline`. Most of ADR 0003's body is still correct — only the names differ.
- **[ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) — superseded by this ADR.** The CQN adapter still lands in the engine package (renamed `cds-data-pipeline`). The `source.query` escape hatch is re-legitimized under `kind: 'materialize'` specifically — no longer an escape from the consumption-view contract in general, but a defining feature of the materialize kind. Secondary-DB replication (use case 2) remains `kind: 'replicate'` and uses the consumption-view contract unchanged. No more `source.query` on `kind: 'replicate'`.
- **[ADR 0001](./0001-replication-service-extends-cds-service.md) — amended (not superseded).** Event namespace renamed `REPLICATE.* → PIPELINE.*`. Service-class rename `DataReplicationService → DataPipelineService`. Otherwise unchanged: `cds.Service` extension, `srv.dispatch(req)` for non-CRUD events, interceptor semantics via `req.reply`, single-winner `on` handler routing. Add an `**Amended 2026-04-19 by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)**` banner at the top of 0001 pointing here for the rename details.

### Follow-up work (checklist — not ADR content)

Tracked here so `/implement-feature` has a concrete target list; no implementation in this ADR itself.

1. **Plan doc.** `spec/internal/plans/reposition-as-pipeline.md` — concrete step sequence for the refactor.
2. **Supersession banners on ADRs 0003 and 0004.** Status line becomes `Superseded by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)`. Bodies unchanged.
3. **Amendment banner on ADR 0001.** Top-of-file note about the `REPLICATE.* → PIPELINE.*` rename and `DataReplicationService → DataPipelineService`.
4. **Idea docs.**
   - New `spec/internal/ideas/cds-data-materialization.md` — future annotation plugin (`@materialize.snapshot`) consuming `kind: 'materialize'`. Status `Exploring`.
   - Update `spec/internal/ideas/service-to-service-data-movement.md` Question 1 — answered by this ADR (`kind: 'move'` on engine).
5. **Refactor (multi-step, tracked in the plan doc).**
   - Scaffold `packages/cds-data-pipeline/` and `packages/cds-data-federation/`.
   - Rename all `Replication*` identifiers → `Pipeline*` across code, CDS, tests, docs.
   - Rename `REPLICATE.*` events → `PIPELINE.*`.
   - Rename `Federations`/`Replications` tracker → `Pipelines`. Rename `ReplicationRuns` → `PipelineRuns`.
   - Rename `addReplication` → `addPipeline`; add required `kind` parameter (default `'replicate'` for source-compat during migration, remove default before release).
   - Add per-kind validation in `addPipeline` (e.g. `kind: 'materialize'` rejects `delta.mode: 'timestamp'`).
   - Update `cds.connect.to('DataReplicationService')` call sites → `DataPipelineService`.
6. **Requirements tracker updates.**
   - Sections that live in the engine package ([ADR 0003](./0003-split-plugin-into-replication-and-federation.md) redistribution) rename "Replication Strategy" / "Replicate" language to "Pipeline (kind: replicate)" throughout.
   - Add a Progress Summary section per kind.
   - Test-mapping regenerates.
7. **Docs surface updates.**
   - Split [`mkdocs.yml`](../../../mkdocs.yml) nav into Pipeline engine + Federation plugin top-level sections.
   - Rewrite [`docs/index.md`](../../index.md) positioning paragraph with the kind taxonomy.
   - Update [`CLAUDE.md`](../../../CLAUDE.md) §"What this project is" for the pipeline primitive framing.
   - Update [`AGENTS.md`](../../../AGENTS.md) entry-point table.
   - Update [`spec/concepts/terminology.md`](../../concepts/terminology.md) — add "pipeline / replication / materialization / movement" distinctions + scope statement.
   - Update [`docs/reference/comparison.md`](../../reference/comparison.md) — matrix rows re-attributed (engine vs. federation).
8. **Scope-discipline grep-lint in [`.claude/commands/review.md`](../../../.claude/commands/review.md).** Add a Req for "doesn't reintroduce DAG / orchestrator / visual-modeler language in public docs." Low priority; optional.
9. **Positioning copy in `packages/cds-data-pipeline/README.md`** includes the "What this is / What this isn't" paragraph derived from the scope-boundary table above.
10. **v1 scope commitment.** Ship `kind: 'replicate'` only in v1.0. Declare `materialize` and `move` in docs with `Planned` status. Land `materialize` in v1.x, `move` in v1.x+.

### What this decision does not do

- Does not change the `@federation.*` annotation surface. Users writing `@federation.delegate` / `@federation.replicate` see no change.
- Does not commit to shipping `kind: 'materialize'` or `kind: 'move'` in v1.0. Only declares the taxonomy.
- Does not rename the GitHub repository. That remains a cosmetic follow-up.
- Does not invalidate [ADR 0002](./0002-separate-internal-and-published-docs.md) — the docs separation + tone rules apply per-package after the split.
- Does not deprecate or replace `cds-caching`. `cds-data-federation`'s caching composition with `cds-caching` is unchanged.
- Does not open the scope door to DAGs, multi-source joins, or visual modeling. The positioning statement explicitly excludes these, permanently.

## References

- [ADR 0001](./0001-replication-service-extends-cds-service.md) — `cds.Service` pattern and event dispatch (amended here).
- [ADR 0002](./0002-separate-internal-and-published-docs.md) — docs separation and tone rules (unchanged; applied per-package).
- [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) — plugin split (superseded here for naming; preserved for structural split reasoning).
- [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) — CQN adapter scope (superseded here; re-legitimized `source.query` under `kind: 'materialize'`).
- [`spec/internal/ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — parallel discussion; Question 1 answered (`kind: 'move'`).
- [`spec/internal/ideas/cds-data-materialization.md`](../ideas/cds-data-materialization.md) — future annotation plugin stub.
- [`spec/concepts/terminology.md`](../../concepts/terminology.md) — federation / replication / materialization / movement definitions after this ADR.
- [`spec/reference/requirements.md`](../../reference/requirements.md) — feature tracker redistribution per ADR 0003 with pipeline renaming applied.
- [`CLAUDE.md`](../../../CLAUDE.md) — project primer, updates per follow-up §7.
- [xtravels `data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) — prior art that motivates the gap; 20-line sample lacking production characteristics.
- [CAP Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation) — CAP's narrow "data federation" definition.
- [CAP Calesi pattern](https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern) — one plugin / one capability / explicit composition convention.
- [`cds-caching`](https://github.com/mikezaschka/cds-caching) — composition precedent the engine mirrors.
- [`@cap-js-community/common`](https://github.com/cap-js-community/common) — anti-pattern; scope-boundary reminder.
