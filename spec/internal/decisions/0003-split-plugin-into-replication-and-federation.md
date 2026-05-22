# 3. Split the plugin into `cds-data-replication` (engine) and `cds-data-federation` (annotation layer)

**Date:** 2026-04-19
**Status:** Superseded by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)

> **Supersession note ([ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md), 2026-04-19).** The structural decision recorded here — split the monolithic plugin, engine as one package, annotation layer as a sibling package, monorepo under npm workspaces, peer-dependency composition, `Federations → Replications` tracker rename, keep `@federation.*` annotation surface unchanged — is **preserved**. What changed is the *engine's identity*:
>
> - Engine package `cds-data-replication` → **`cds-data-pipeline`** ([ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)).
> - Tracker entity target `Replications` → **`Pipelines`**; `ReplicationRuns` → **`PipelineRuns`**.
> - Programmatic API `addReplication({...})` → **`addPipeline({ kind, ... })`**, with a required `kind: 'replicate' | 'materialize' | 'move'` taxonomy.
> - The engine becomes pattern-agnostic rather than row-preserving-only. Rationale: the engine's primitives (READ→MAP→WRITE, tracker, adapters, retry, events, management API) are already pattern-agnostic; naming it "replication" hid two other kinds (materialization and movement) the same primitives serve.
>
> `cds-data-federation`'s role is unchanged: consumes the engine via `kind: 'replicate'` under the hood. Read this ADR with those renames applied; the split itself and everything derived from it (monorepo layout, peer-dep model, packaging strategy, redistribution of requirements) still holds.
>
> **Docs surface** ([ADR 0006](./0006-per-plugin-published-surface.md), 2026-04-19): the consumer-facing documentation is split along the same package lines — `docs/pipeline/` and `docs/federation/`, each with its own `mkdocs.yml` and GitHub Pages subpath.

## Context

The repository currently ships a single plugin, `cds-data-federation`, whose `srv/` folder bundles three architecturally distinct concerns under one annotation namespace:

| Component | What it does | Federation-specific? |
|---|---|---|
| Delegation (`srv/delegation/**`) | `service.prepend` handlers, cross-service `$expand`, cross-service navigation, CUD forwarding, paged remote query — the live-remote side of `@federation.delegate` | Yes |
| Annotation scanner (`srv/annotation-scanner.js`, `srv/lib/ViewMapping.js`) | Walks `@federation.*`, extracts consumption-view metadata, flips `@cds.persistence.table` for replicate entities | Yes |
| Replication pipeline (`srv/DataReplicationService.js`, `srv/lib/DataReplication.js`, `srv/adapters/**`, `srv/lib/retry.js`, scheduler, `Federations` + `ReplicationRuns` entities, management service) | Generic scheduled READ → MAP → WRITE engine with tracker, adapters, retry, concurrency guard, event pipeline (`REPLICATE.READ/MAP/WRITE` — [ADR 0001](./0001-replication-service-extends-cds-service.md)) | **No — the code never references "federation" or "remote"** |

The pipeline never asks "am I federating?" It asks "what's my source adapter, what's my batch size, what's my schedule, what's my WHERE predicate." Federation is one caller of the pipeline. Other plausible callers surfaced during recent design discussions:

- **Pre-aggregated / rolled-up materialization** from an in-process CAP service (e.g. daily `SELECT customer_id, SUM(amount) GROUP BY customer_id FROM Orders` snapshotted into a `DailyCustomerRevenue` table). This was proposed as a use case for Req 4.6.3 (CQN adapter, [`spec/reference/requirements.md`](../../reference/requirements.md)), then rejected as "not federation" per [`spec/concepts/terminology.md`](../../concepts/terminology.md) — no remote boundary is crossed.
- **Service-to-service data movement** — writing the replicate pipeline's output to a non-`db` target (other CAP service, second S/4 tenant, REST backend). Captured in [`spec/internal/ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md); Option A there anticipates a symmetric `TargetAdapter` layer.
- **Secondary / legacy database replication** via a CQN-capable `cds.requires` entry (reporting PostgreSQL, archived HANA, CAP-wrapped legacy DB). This one *is* federation in CAP's own narrow §"Data Federation" sense, but the adapter work is pure pipeline.

Every one of these recurs as the same scope question: *"is this in the federation plugin or not?"* The question keeps surfacing because the current bundling forces it. The pipeline code is federation-agnostic; the annotation namespace is not.

### Origin: Phase 1 rename (January 2025)

The project started as `cds-data-replication` v0.1.0 — a replication-only prototype. Phase 1 ([`spec/reference/requirements.md`](../../reference/requirements.md) §"Implementation History") renamed it to `cds-data-federation` to reflect the broader scope once delegation was added. That rename was necessary (the project *is* federation at its declarative surface), but it coupled the engine's identity to the caller's identity. The git folder is still named `cds-data-replication` for historical reasons ([`CLAUDE.md`](../../../CLAUDE.md) §"What this project is").

This ADR **refines** that decision: the engine keeps its original name, the annotation layer takes the broader `cds-data-federation` name, and they compose the way `cds-data-federation` already composes with [`cds-caching`](https://github.com/mikezaschka/cds-caching). The Phase 1 rename is not reverted; it is resolved at the correct granularity.

### Side note: the anti-pattern we're avoiding

[`@cap-js-community/common`](https://github.com/cap-js-community/common) bundles six unrelated capabilities under one package name: Replication Cache, Migration Check (CLI for CDS schema compatibility), Rate Limiting, Redis Client, Local HTML5 Repository (UI5 dev-time asset server), CDM Builder (SAP Build Work Zone content descriptor). The name `common` is the organizing principle — i.e. no organizing principle. Observable consequences:

- Discovery broken: npm search for "replication cache" does not surface `common`.
- Dependency graph opaque: installing for rate limiting pulls a SQLite replication engine + HTML5 asset server into `node_modules`.
- Version coupling: a CDM Builder bug fix ships as a new package version that also "changes" rate limiting from a consumer's perspective.
- Docs sprawl: one README explains six products; five out of six are irrelevant to any given reader.

The SAP CAP ecosystem first-party plugins (`@cap-js/attachments`, `@cap-js/audit-logging`, `@cap-js/change-tracking`, `@cap-js/telemetry`, `@cap-js/hana`, `cds-caching`, `@cap-js/change-tracking`) deliberately follow the opposite pattern: **one plugin, one capability, explicit composition through `cds.requires` and `cds.connect.to()`**. That pattern is what the Calesi guide ([CAP-Level Service Interfaces](https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern)) recommends. Splitting this plugin puts it on the right side of that line; not splitting invites the `common` trajectory.

### Options considered

| Option | Outcome | Verdict |
|---|---|---|
| **A — Keep one plugin, reject all non-federation use cases.** Req 4.6.3 stays narrow to "federation only"; service-to-service movement stays an open idea; materialization is out of scope permanently. | Avoids refactor. Keeps pushing scope questions back to users, who then re-ask them. Materialization requires reinventing pipeline primitives in user space (`cds.spawn` + custom tracker + retry) every time. | Rejected — treats symptom, not cause. |
| **B — Keep one plugin, broaden the vision.** Redefine `cds-data-federation` as "any CAP-native data movement." Adopt target adapters, CQN source adapter, materialization all under `@federation.*`. | Federation namespace stops being federation. Discovery and naming break. Mirrors the `common` trajectory. | Rejected — broadens the wrong axis. |
| **C — Split.** `cds-data-replication` = engine (pipeline, adapters, tracker, management service). `cds-data-federation` = annotation layer (scanner, delegation, `@federation.replicate` → `cds-data-replication` binding). Peer-dep model mirrors `cds-caching`. | Federation stays federation. Replication becomes a reusable primitive. Scope questions resolve at install time ("which capability do I need?"). | **Selected.** |
| **D — Split + extract to separate repos.** Same as C plus multi-repo. | All C's benefits plus independent release cadence, at the cost of cross-repo PR friction during initial stabilization. | Deferred — start as monorepo under npm workspaces, extract later only if release cadences actually diverge. |

The core insight: **the engine doesn't know or care about federation; the annotation namespace shouldn't own the engine's identity.**

## Decision

**Split the codebase into two single-capability npm packages inside this repository, wired via npm workspaces. `cds-data-federation` becomes a thin consumer of `cds-data-replication`, the way it is already a thin consumer of `cds-caching`.**

### Package 1 — `cds-data-replication`

Scheduled data-replication engine. No federation semantics. No `@federation.*` annotations. Programmatic and event-driven surface only.

**Contents:**

- `cds-plugin.js` — registers the service, boots scheduler on `cds.once('served', ...)`.
- `srv/DataReplicationService.js` — `cds.Service` subclass with `REPLICATE.READ / MAP / WRITE` pipeline ([ADR 0001](./0001-replication-service-extends-cds-service.md)).
- `srv/lib/DataReplication.js` — per-replication execution driver.
- `srv/adapters/` — `BaseAdapter`, `ODataAdapter`, `RestAdapter`, factory, and the future `CqnAdapter` ([ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md)).
- `srv/lib/retry.js` — `withRetry` with exponential backoff.
- `srv/ManagementService.js` — OData management API for runs, status, flush, trigger.
- `db/index.cds` — `Replications` entity (**renamed from `Federations`** — see below), `ReplicationRuns` entity, `replicated` aspect.
- Programmatic API: `cds.connect.to('DataReplicationService').then(srv => srv.addReplication({ name, source, target, mapping, schedule, mode, ... }))`.

**Tracker entity rename.** The current `Federations` entity is misnamed today — it tracks replication state (lastSync, lastKey, status, statistics), and delegate entities never have rows in it (delegation is stateless). Renaming to `Replications` resolves the misnomer, which the split makes obvious.

**Annotations:** none. The engine is consumed programmatically (`addReplication(...)`) or via events. Declarative consumers layer their own annotation on top.

### Package 2 — `cds-data-federation`

Remote-service federation plugin. Consumes `cds-data-replication` **only when the application uses `@federation.replicate`**; consumes `cds-caching` **only when any `cache` option is present**. Both peer-dep.

**Contents:**

- `cds-plugin.js` — scanner + handler registration.
- `srv/annotation-scanner.js`, `srv/lib/ViewMapping.js` — `@federation.*` scanning, consumption-view metadata (projected columns, `localToRemote` / `remoteToLocal`, `excludedColumns`, `staticWhere`).
- `srv/delegation/**` — handler registration, cross-service expand (local → remote, remote → local, cross-provider), cross-service navigation, paged remote query, CUD forwarding.
- `srv/replication-binding.js` — **the seam.** For each `@federation.replicate` entity: translate the view mapping + annotation options into an `addReplication(...)` call on the peer-installed `cds-data-replication`. ~200 LoC.

**Dep model:** both dependencies are peers, not direct. Mirrors the `cds-caching` pattern the project already uses.

- User uses `@federation.delegate` only → no peer needed beyond CAP.
- User uses `@federation.delegate` + `{ cache: { ttl } }` → peer `cds-caching` required; if absent, warning logged once and caching silently skipped (current behavior, [Req 4.3.6](../../reference/requirements.md)).
- User uses `@federation.replicate` → peer `cds-data-replication` required; if absent, **loud startup error** with install hint (unlike caching, replication is the whole point of the annotation — silent skip would be confusing).

Rationale for peer over direct dep: users who only federate via delegation (the majority of simple lookup/value-help use cases) don't install the replication engine into their `node_modules`. Explicit composition over transitive bundling, matching the first-party CAP plugin convention.

### Monorepo layout

Stay in this repository under npm workspaces. Multi-repo extraction (Option D) is deferred; revisit only if release cadences diverge.

```
cds-data-replication/                 # repo name unchanged; becomes the workspace root
├── packages/
│   ├── cds-data-replication/         # engine
│   │   ├── cds-plugin.js
│   │   ├── srv/
│   │   │   ├── DataReplicationService.js
│   │   │   ├── ManagementService.js
│   │   │   ├── adapters/             # BaseAdapter, ODataAdapter, RestAdapter, CqnAdapter, factory
│   │   │   └── lib/                  # DataReplication.js, retry.js, scheduler
│   │   ├── db/index.cds              # Replications, ReplicationRuns, replicated aspect
│   │   ├── package.json              # name: cds-data-replication
│   │   └── README.md
│   └── cds-data-federation/          # annotation layer
│       ├── cds-plugin.js
│       ├── srv/
│       │   ├── annotation-scanner.js
│       │   ├── delegation/           # handler-registration, expand-*, cross-service-*, paged-*
│       │   ├── lib/                  # ViewMapping.js, navigation filter helpers
│       │   └── replication-binding.js  # the seam
│       ├── package.json              # name: cds-data-federation; peerDep: cds-data-replication, cds-caching
│       └── README.md
├── examples/                         # consumer app depends on both via workspace:
├── test/                             # shared harness (real providers); specs grouped per package
├── docs/                             # two top-level sections after retone (federation + replication)
├── package.json                      # "workspaces": ["packages/*"]
└── README.md                         # umbrella
```

Release strategy (initial): version both packages in lockstep via changesets or a simple release script. Decouple later only if one stabilizes faster than the other.

## Consequences

### What this enables

- **Federation stays federation.** Scope questions that kept recurring ("is this federation?" for service-to-service movement, materialization, secondary DBs) resolve by routing. Non-federation callers install `cds-data-replication` directly without touching `@federation.*`.
- **Replication becomes a reusable primitive.** Other plugins (e.g. a hypothetical `cds-materialized-views` with `@materialize.snapshot`) can layer on top of `cds-data-replication` the same way `cds-data-federation` does. The same applies to the target-adapter extension tracked in [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md): it lands in `cds-data-replication`, not in federation.
- **Req 4.6.3 (CQN adapter) unblocked.** Migrates cleanly to `cds-data-replication` under both use cases — secondary-DB replication (federation-adjacent) and pre-aggregated materialization (not federation). See [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md).
- **`Federations` tracker rename to `Replications`** becomes natural. The current name was a compromise; the split makes the correct name the obvious one.
- **Dependency footprint becomes honest.** A delegation-only user stops installing the replication engine + tracker schema + scheduler. A standalone-replication user stops installing the delegation handlers + annotation scanner.
- **Documentation clarifies.** Two READMEs with two scopes beat one README that opens with "this plugin does five things." The [`docs/`](../../) site gets two top-level sections (federation, replication) with no cross-contamination.
- **Matches the `cds-caching` composition story.** The plugin is already designed around "compose with `cds-caching` rather than reinvent caching" ([Req §1.4 Composable](../../reference/requirements.md), [`spec/concepts/terminology.md`](../../concepts/terminology.md)). Applying the same composition discipline one layer deeper is consistent, not a new pattern.
- **Consciously avoids the `common`-style grab-bag trajectory** documented in the side note above.

### What we accept as trade-offs

- **Wide but mechanical refactor.** Imports move, CDS `using` paths shift, `Federations` → `Replications` ripples through `db/`, management service, tests, `test-mapping.md`. Multi-day effort, tracked as a plan doc (see follow-ups). No conceptual redesign — the code is already clean along the split line.
- **Requirements.md redistributes.** Sections 4.4 (Replicate Strategy), 4.6 (Source Adapters), 4.7 (MAP phase), 4.8 (Scheduling), parts of 4.10 (Resilience), 4.11 (Tracking), 4.13 (Management API), parts of 4.14 (Configuration), 4.15 (Multi-Tenancy) are **replication-plugin concerns** and move to the replication package's own requirements. Sections 4.1 (Consumption Views), 4.2 (Delegate Strategy), 4.3 (Caching), 4.5 (Annotations), 4.12 (Security) stay in federation. A clean redistribution, not new requirements. Test tag IDs (`[4.2.5]`, etc.) re-home accordingly — [`spec/reference/test-mapping.md`](../../reference/test-mapping.md) regenerates from the new layout.
- **Two packages to version.** Independent release cycles are possible but initially unused; lockstep releases via a release script keep operational cost low during stabilization.
- **Peer-dep UX cost for `@federation.replicate` users.** Users must install both `cds-data-federation` and `cds-data-replication` to get replication. Mitigation: loud startup error + install hint when the peer is missing; README of `cds-data-federation` documents the install pair prominently; `npx cds add` integration (future) could install both in one step.
- **Supersedes the implicit Phase 1 rename decision.** The rename was undocumented as an ADR (only mentioned in [`spec/reference/requirements.md`](../../reference/requirements.md) §"Implementation History" and [`CLAUDE.md`](../../../CLAUDE.md) §"What this project is"). This ADR formalizes the refined outcome: engine keeps its original name, the broader-scoped annotation layer takes the federation name, neither reverts the rename.

### Follow-up work (not ADR content — tracked here as a checklist)

Flagged items surface through the normal workflow: implement via [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md); docs via a separate `docs:` commit after the code split stabilizes.

1. **Restructure plan.** Create `spec/internal/plans/split-plugin.md` with the concrete step sequence: `packages/` scaffold → move files with `git mv` (preserve history) → update imports → rename `Federations` → `Replications` in CDS + code + tests → update `cds-plugin.js` entries → rebuild `examples/consumer/package.json` to depend on both workspaces → rerun `test/` end-to-end.
2. **Requirements redistribution.** Split [`spec/reference/requirements.md`](../../reference/requirements.md) into `packages/cds-data-replication/docs/requirements.md` and `docs/federation/requirements.md`. Decide whether to keep a repo-root umbrella requirements doc or let each package own its tracker independently — lean toward per-package.
3. **`CLAUDE.md` update.** "What this project is" rewrites to describe the monorepo: two packages, one engine, one annotation layer. The "Annotations only on consumption views" convention moves into federation's doc; the "Idempotency — UPSERT" convention moves into replication's doc.
4. **`AGENTS.md` update.** Entry-point table adjusts for the new layout.
5. **`spec/concepts/terminology.md`.** Add a short paragraph: "Federation and replication are separate capabilities. The federation plugin composes the replication engine for `@federation.replicate`; the engine can also be used standalone."
6. **`docs/reference/comparison.md`.** Matrix row for "this plugin" splits into "federation plugin" + "replication engine" columns so the capability attribution is correct.
7. **MCP discovery.** The [`cap-mcp`](../../../.mcp.json) entry doesn't care about the split; `cap.services` introspection still works. No action.
8. **Doc-site `mkdocs.yml`.** Revisit after split: either (a) one site covers both packages with two top-level nav sections, or (b) two sites. Lean (a) for a while; split later if scope grows.
9. **`Federations` → `Replications` data migration.** Existing deployments that persist the tracker to HANA need a rename migration. Document in an upgrade note; ship a `cdsmc`-compatible whitelist entry or a one-shot migration script.
10. **Cross-reference this ADR from [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md).** Its "Question 1" (is this in scope for a federation plugin?) is now answered: target adapters live in `cds-data-replication`, the plugin stays federation-specific.

### What this decision does not do

- Does not rename the repository. The GitHub repo stays `cds-data-replication` for now; the workspace root `package.json` carries neither package's public name.
- Does not extract packages to separate repositories. That remains Option D, deferred.
- Does not change `@federation.delegate` or `@federation.replicate` semantics. Users writing the annotations see no change — they only change their install (`npm i cds-data-federation cds-data-replication` for the replicate path).
- Does not change [ADR 0001](./0001-replication-service-extends-cds-service.md). `REPLICATE.*` events, `cds.Service` extension, and `cds.connect.to('DataReplicationService')` survive unchanged — they're engine concerns that move with the engine.
- Does not change [ADR 0002](./0002-separate-internal-and-published-docs.md). `exclude_docs` discipline and tone rules apply to whichever package's docs folder they live in.

## References

- [ADR 0001](./0001-replication-service-extends-cds-service.md) — `DataReplicationService` extends `cds.Service`; defines `REPLICATE.*` event namespace. Survives unchanged; moves with the engine package.
- [ADR 0002](./0002-separate-internal-and-published-docs.md) — docs separation; rules carry forward per-package.
- [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) — applies this split to the CQN adapter (Req 4.6.3).
- [`spec/internal/ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — parallel discussion; "Question 1" answered by this ADR.
- [`spec/concepts/terminology.md`](../../concepts/terminology.md) — federation ≠ materialization; the terminological basis for the split.
- [`spec/reference/requirements.md`](../../reference/requirements.md) — feature tracker; redistributes across packages per follow-up §2.
- [`CLAUDE.md`](../../../CLAUDE.md) — updates per follow-up §3.
- [`cds-caching`](https://github.com/mikezaschka/cds-caching) — the existing composition precedent the split mirrors.
- [CAP Calesi pattern](https://cap.cloud.sap/docs/get-started/concepts#the-calesi-pattern) — "one plugin, one capability" ecosystem convention.
- [`@cap-js-community/common`](https://github.com/cap-js-community/common) — the anti-pattern side-noted above.
