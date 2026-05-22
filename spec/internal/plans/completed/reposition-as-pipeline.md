# Reposition engine as `cds-data-pipeline` + split repo

**Scope:** foundational refactor per [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md). Renames the engine to `cds-data-pipeline`, introduces the `kind` taxonomy (`replicate` | `materialize` | `move`), splits the monorepo into `packages/cds-data-pipeline/` and `packages/cds-data-federation/`, and retones docs/tests/rules accordingly.

ADR 0005 supersedes [ADR 0003](../decisions/0003-split-plugin-into-replication-and-federation.md) and [ADR 0004](../decisions/0004-scope-cqn-adapter-to-cds-data-replication.md), and amends [ADR 0001](../decisions/0001-replication-service-extends-cds-service.md) (event-namespace rename only). A previous plan (`split-plugin.md`) was written against the 0003 vocabulary and is deleted in this commit — it is superseded before ever being implemented.

**Status:** Completed. The monorepo split, engine rename, event-namespace rename (`REPLICATE.*` → `PIPELINE.*`), service/class renames, and docs retone all landed. The `kind` discriminator described in §3.1 was subsequently superseded by [ADR 0007](../../decisions/0007-infer-pipeline-intent-from-config-shape.md) (pipeline intent is now inferred from config shape, not an explicit `kind` field) — see [completed/infer-pipeline-intent-from-config-shape.md](./infer-pipeline-intent-from-config-shape.md). Task checkboxes below were not updated as work progressed; they do not reflect current state.

---

## Overview

The current single plugin (`cds-data-federation` at the repo root) bundles the annotation layer + pipeline engine together. ADR 0005's core observation: the engine's internals are pattern-agnostic — they don't know or care whether the job is replication (row-preserving), materialization (aggregated), or movement (to a non-`db` target). The honest name is `cds-data-pipeline`.

Non-feature work: no new user-visible capabilities. The acceptance bar is **equivalence of behavior** — same inputs produce same outputs, same tracker rows (just under new entity/column names), same emitted events (under `PIPELINE.*`), same HTTP surface from the (renamed) management service, byte-for-byte identical `@federation.*` annotation semantics.

**One deliberate deviation from pre-existing behavior:** the current root `cds-plugin.js` runs `CREATE TABLE IF NOT EXISTS plugin_data_federation_*` at startup as a fallback. That pattern is SQLite-only and fails on HANA HDI (the plugin has no DDL authority — schema ownership belongs to the HDI deployer). The fallback is dropped; the engine's CDS model (`packages/cds-data-pipeline/db/index.cds`) becomes the single source of truth, materialized by `cds deploy` (local / SQLite) or by HDI during `cf push` (HANA). See Task 3.9 for the simplified plugin entry and Approval §A.9 for the model-inclusion strategy.

**Two packages after this PR:**

- **`packages/cds-data-pipeline`** — engine. `DataPipelineService`, `Pipeline` driver, adapters, retry, scheduler, `Pipelines` + `PipelineRuns` entities, management service. No `@federation.*` awareness. Programmatic surface: `addPipeline({ kind, ... })`, event surface: `PIPELINE.READ / MAP / WRITE`.
- **`packages/cds-data-federation`** — annotation layer. Scanner, delegation handlers, `pipeline-binding.js` seam that translates `@federation.replicate` into `addPipeline({ kind: 'replicate', ... })`. The `replicated` aspect lives here, not in the engine (ADR 0005 Consequences §"Some aspects keep replicated flavor").

`@federation.delegate` / `@federation.replicate` annotations are unchanged byte-for-byte. External users see no change apart from the install pair.

---

## Pre-existing code vs. task-text expectations

The user-provided task text references several files/concepts that either don't exist or don't match the current tree. Flagged here so Phase 3 is predictable:

1. **`srv/lib/ViewMapping.js`** — does not exist. View-mapping extraction is inline in `srv/annotation-scanner.js` (`extractViewMapping()`). No speculative extraction in this PR; the function moves with the scanner.
2. **Standalone scheduler / EventEmitter** — do not exist. The scheduler is `_scheduleJob(name, everyMs)` inside `DataPipelineService.js` using `cds.spawn({ every })`. There is no custom `EventEmitter` — pipeline events flow through `cds.Service.on/dispatch`, which is CAP-native (ADR 0001). Nothing to move separately; they're part of the service class.
3. **`srv/data-replication-api-service.js`** — orphan file. Defines a `DataReplicationApiService` class that implements cache-admin actions (`setMetricsEnabled`, `getEntries`, `clearCache`, etc.) — nothing to do with replication despite the filename. Not wired from any CDS `service {}`, not referenced from any test. **Approval point §A.1**: delete as dead code, or move to `packages/cds-data-federation/srv/cache-admin-service.js` for a future wire-up.
4. **`FederationStrategy` enum** in `index.cds` — conceptually obsolete in the engine package (strategy `delegate` has no meaning to a pipeline). **Approval point §A.2**: drop entirely.
5. **FK column on `ReplicationRuns`** — today the association is `tracker: Association to one Federations`, giving FK column `tracker_name`. After rename the natural shape is `pipeline: Association to one Pipelines`, FK column `pipeline_name`. The user task text doesn't specify the column; the plan proposes `pipeline_name`. **Approval point §A.3**.
6. **`replicated` aspect location** — ADR 0005 Consequences explicitly defers this: the aspect name stays, but lives in federation-package CDS (not engine). The user's work item 2 confirms ("keep a federation-side `replicated` aspect"). **Approval point §A.4**: move `replicated` aspect to `packages/cds-data-federation/index.cds` under namespace `plugin.data_federation`; drop `multiSourced` (currently unused) unless there is a reason to keep it.
7. **Workspaces glob.** User task text proposes `"workspaces": ["packages/*", "examples/*"]`. The current layout has nested workspaces (`examples/sales-intel/providers/*`, `examples/sales-intel/workbench`) and four test providers (`test/provider`, `test/inventory`, `test/consumer`, `test/rest-provider`) that need to remain workspaces for `npm install` to link them. **Approval point §A.5**: use the fuller glob `["packages/*", "examples/*", "examples/sales-intel/providers/*", "examples/sales-intel/workbench", "test/provider", "test/inventory", "test/consumer", "test/rest-provider"]`.
8. **Management service rename target.** User says `DataPipelineManagementService`. The current class is `DataPipelineManagementService` at path `/federation`. **Approval point §A.6**: rename class to `DataPipelineManagementService`, path to `/pipeline`, no backward-compat alias (pre-release, zero external users per ADR 0005 §Context).

---

## Affected files (summary)

| Group | Files | Change |
|---|---|---|
| Scaffold | `package.json` (root), `packages/cds-data-pipeline/package.json`, `packages/cds-data-federation/package.json` | Root becomes workspace-only; two new package manifests. |
| Engine code | `srv/DataPipelineService.js` → `packages/cds-data-pipeline/srv/DataPipelineService.js`; `srv/lib/DataReplication.js` → `packages/cds-data-pipeline/srv/lib/Pipeline.js`; `srv/adapters/**` → `packages/cds-data-pipeline/srv/adapters/**`; `srv/lib/retry.js` → `packages/cds-data-pipeline/srv/lib/retry.js`; `srv/replication-service.cds` → `packages/cds-data-pipeline/srv/pipeline-service.cds`; `srv/data-replication-management-service.{cds,js}` → `packages/cds-data-pipeline/srv/DataPipelineManagementService.{cds,js}` | `git mv` + rename contents (class names, event names, table names, service names). |
| Engine CDS | `index.cds` → `packages/cds-data-pipeline/db/index.cds` | Namespace `plugin.data_federation` → `plugin.data_pipeline`. Entity `Federations` → `Pipelines`. Entity `ReplicationRuns` → `PipelineRuns`. FK column `tracker_name` → `pipeline_name`. Add `kind : PipelineKind` column on `Pipelines`. Drop `FederationStrategy` enum. Drop `replicated` + `multiSourced` aspects (move `replicated` to federation; drop `multiSourced` unless approved). |
| Federation code | `srv/annotation-scanner.js` → `packages/cds-data-federation/srv/annotation-scanner.js`; `srv/delegation/**` → `packages/cds-data-federation/srv/delegation/**` | `git mv`; retune `require()` paths if necessary (all current imports are relative within `delegation/` → no-op). |
| Federation CDS | `packages/cds-data-federation/index.cds` (new) | Namespace `plugin.data_federation`. Contains only the `replicated` aspect (`lastReplicatedAt`, `lastReplicatedBy`). Imported by consumer schemas. |
| Seam (new) | `packages/cds-data-federation/srv/pipeline-binding.js` | ~200 LoC. Translates `@federation.replicate` scan results into `addPipeline({ kind: 'replicate', ... })` calls against the engine via `cds.connect.to('DataPipelineService')`. Replaces the `cds.once('served', ...)` replicate-config block currently in root `cds-plugin.js`. |
| Plugin entry points | `cds-plugin.js` (root) → delete; `packages/cds-data-pipeline/cds-plugin.js` (new); `packages/cds-data-federation/cds-plugin.js` (new) | Root entry deleted. Engine entry: instantiate `DataPipelineService` defensively; boot scheduler. **No runtime DDL** — drop the current `_ensureTrackerTables()` fallback (incompatible with HANA HDI). Tracker tables come from the CDS model + `cds deploy` / HDI. Federation entry: scan annotations on `loaded`, register delegate handlers + call seam on `served`, peer-dep validation. |
| Dead code | `srv/data-replication-api-service.js` | Per Approval §A.1. Lean: delete. |
| Orphan CDS | none | — |
| Consumer schemas | `test/consumer/db/schema.cds`, `examples/consumer/db/schema.cds` | `using { plugin.data_federation as federation } from 'cds-data-federation'` stays (it's still federation-side — `replicated` aspect now lives in `packages/cds-data-federation/index.cds`). No change needed if Approval §A.4 passes. |
| Management-service imports | `test/consumer/srv/consumer-service.cds`, `examples/consumer/srv/consumer-service.cds`, `examples/sales-intel/workbench/srv/federation-monitor-service.cds` | `using from 'cds-data-federation/srv/data-replication-management-service'` → `using from 'cds-data-pipeline/srv/DataPipelineManagementService'`. Service-name reference `DataPipelineManagementService` → `DataPipelineManagementService`. |
| Consumer `package.json` | `test/consumer/package.json`, `examples/consumer/package.json`, `examples/sales-intel/workbench/package.json` | Add `"cds-data-pipeline": "*"` alongside `"cds-data-federation": "*"` (workspace link). |
| Tests | `packages/cds-data-pipeline/test/integration/`, `packages/cds-data-federation/test/unit/ or packages/cds-data-pipeline/test/unit/` | Update every `cds.connect.to('DataPipelineService')` → `'DataPipelineService'`; every `PIPELINE.READ/MAP/WRITE` → `PIPELINE.READ/MAP/WRITE`; line 137 of `replication.test.js` `.where({ tracker_name: ... })` → `.where({ pipeline_name: ... })`. Add two new validation tests (§Task 7). |
| Test layout | none in this PR | Per-package test regrouping (`packages/*/test/`) deferred — keeping shared `test/` at repo root is the user's explicit constraint. |
| Docs surfaces | `docs/index.md`, `spec/concepts/terminology.md`, `docs/reference/comparison.md`, `spec/reference/requirements.md`, `spec/reference/test-mapping.md`, `docs/reference/features.md`, `docs/reference/annotations.md`, `docs/reference/management-service.md`, `docs/integration/rest.md`, `docs/getting-started/first-replication.md`, `docs/getting-started/mixing-delegate-and-replicate.md`, `mkdocs.yml`, `CLAUDE.md`, `AGENTS.md`, root `README.md`, `.cursor/rules/project.mdc`, `.claude/commands/**` | Rename + retone per ADR 0005 Follow-up §7. Details in §Task 8. |
| ADR banners | `spec/internal/decisions/0001-...md`, `0003-...md`, `0004-...md` | Add status banners per ADR 0005 Follow-up §§2–3. |
| Per-package README | `packages/cds-data-pipeline/README.md` (new), `packages/cds-data-federation/README.md` (new) | Engine README includes "What this is / What this isn't" from ADR 0005 §"Explicit scope boundaries"; federation README documents install pair. |
| Migration | `packages/cds-data-pipeline/scripts/migrate-federations-to-pipelines.js` (new) | One-shot script renaming `plugin_data_pipeline_Pipelines` → `plugin_data_pipeline_Pipelines` + `plugin_data_pipeline_PipelineRuns` → `plugin_data_pipeline_PipelineRuns` + `tracker_name` → `pipeline_name`. Idempotent; SQLite + HANA dispatch. |
| Tracker redistribution | `docs/pipeline/requirements.md` (new), `docs/federation/requirements.md` (new), `spec/reference/requirements.md` (umbrella) | Per ADR 0003 §Monorepo-layout redistribution, pipeline renames applied (e.g. §4.4 "Replicate Strategy" → "Pipeline (kind: replicate)"). Add Progress Summary row for `materialize` / `move` under "Planned". |
| Scripts | `scripts/sync-requirements-progress.js` | Adapt to scan per-package trackers; regenerate `spec/reference/test-mapping.md`. |

---

## Tasks

Numbered for execution order. Each numbered block is a reviewable unit, roughly one commit.

### 1. Monorepo scaffolding

- [ ] 1.1 Create directory skeletons: `packages/cds-data-pipeline/{srv,db,scripts}`, `packages/cds-data-federation/{srv,srv/delegation}`. Empty `.gitkeep` if needed.
- [ ] 1.2 Rewrite root `package.json`:
  - `"private": true`; drop `main`, `files`, `peerDependencies`, `peerDependenciesMeta`.
  - Per Approval §A.5:
    ```json
    "workspaces": [
      "packages/*",
      "examples/*",
      "examples/sales-intel/providers/*",
      "examples/sales-intel/workbench",
      "test/provider",
      "test/inventory",
      "test/consumer",
      "test/rest-provider"
    ]
    ```
  - Keep repo-wide scripts (`test`, `lint`, `docs:*`, `sync:requirements`, `check:*`, `examples:start`, `examples:regen-csn`).
  - Keep shared devDependencies (jest, eslint, chai, chai-as-promised, chai-subset, @cap-js/sqlite, husky, lint-staged). Move runtime-facing ones (`@sap-cloud-sdk/http-client`, `@sap-cloud-sdk/resilience`, `axios`, `express`, `cds-caching`, `@sap/cds`) into the appropriate package.
- [ ] 1.3 Create `packages/cds-data-pipeline/package.json`:
  - `name: "cds-data-pipeline"`, `version: "0.1.0"`, `main: "cds-plugin.js"`.
  - `description`: first sentence of the ADR 0005 Positioning statement.
  - `peerDependencies: { "@sap/cds": ">=8" }`; optional `peerDependenciesMeta: { "cds-caching": { "optional": true } }` — engine itself doesn't use caching; kept as declared-optional for future wiring.
  - `files: ["srv/**", "db/**", "scripts/**", "cds-plugin.js", "README.md"]`. `private: false`.
- [ ] 1.4 Create `packages/cds-data-federation/package.json`:
  - `name: "cds-data-federation"`, `version: "0.1.0"`, `main: "cds-plugin.js"`. Description unchanged from current root.
  - `peerDependencies: { "@sap/cds": ">=8", "cds-data-pipeline": ">=0.1.0", "cds-caching": ">=1" }`, `peerDependenciesMeta: { "cds-caching": { "optional": true } }`. `cds-data-pipeline` is NOT optional — ADR 0005 preserves ADR 0003's "loud error on startup" rule for `@federation.replicate` users.
  - `files: ["srv/**", "index.cds", "cds-plugin.js", "README.md"]`. `private: false`.
- [ ] 1.5 `npm install` from repo root → verify workspace symlinks resolve (`node_modules/cds-data-pipeline` → `packages/cds-data-pipeline`, same for federation).

### 2. Move engine code

All moves via `git mv` to preserve history.

- [ ] 2.1 `git mv srv/DataPipelineService.js packages/cds-data-pipeline/srv/DataPipelineService.js`.
- [ ] 2.2 `git mv srv/lib/DataReplication.js packages/cds-data-pipeline/srv/lib/Pipeline.js`.
- [ ] 2.3 `git mv srv/adapters packages/cds-data-pipeline/srv/adapters`.
- [ ] 2.4 `git mv srv/lib/retry.js packages/cds-data-pipeline/srv/lib/retry.js`.
- [ ] 2.5 `git mv srv/replication-service.cds packages/cds-data-pipeline/srv/pipeline-service.cds`.
- [ ] 2.6 `git mv srv/data-replication-management-service.cds packages/cds-data-pipeline/srv/DataPipelineManagementService.cds` + `git mv srv/data-replication-management-service.js packages/cds-data-pipeline/srv/DataPipelineManagementService.js`.
- [ ] 2.7 `git mv index.cds packages/cds-data-pipeline/db/index.cds`.
- [ ] 2.8 Delete `srv/data-replication-api-service.js` per Approval §A.1.
- [ ] 2.9 Commit these moves as a standalone commit before any in-file renaming (so `git log --follow` keeps working cleanly).

### 3. Engine renames — code

- [ ] 3.1 `packages/cds-data-pipeline/srv/DataPipelineService.js`:
  - Class `DataPipelineService` → `DataPipelineService`.
  - `const PIPELINE_EVENTS = ['PIPELINE.READ', 'PIPELINE.MAP', 'PIPELINE.WRITE']` → `['PIPELINE.READ', 'PIPELINE.MAP', 'PIPELINE.WRITE']`.
  - `cds.log('cds-data-federation')` → `cds.log('cds-data-pipeline')`.
  - `require('./lib/DataReplication')` → `require('./lib/Pipeline')`; `new DataReplication(...)` → `new Pipeline(...)`.
  - `async addPipeline(config)` → `async addPipeline(config)`.
  - New at the top of `addPipeline`:
    ```js
    if (!config || !config.kind) {
        throw new Error(
            `addPipeline requires an explicit 'kind' (replicate | materialize | move). ` +
            `See ADR 0005 (spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md).`
        )
    }
    if (!['replicate', 'materialize', 'move'].includes(config.kind)) {
        throw new Error(
            `Unknown pipeline kind: '${config.kind}'. Allowed: 'replicate' | 'materialize' | 'move'. ` +
            `See ADR 0005.`
        )
    }
    if (config.kind === 'replicate' && config.source && config.source.query) {
        throw new Error(
            `'source.query' is not allowed for kind: 'replicate'; it is a defining feature of kind: 'materialize'. ` +
            `See ADR 0005 §Supersessions for details.`
        )
    }
    if (config.kind === 'materialize' && config.delta && config.delta.mode &&
        !['full', 'partial-refresh'].includes(config.delta.mode)) {
        throw new Error(
            `Invalid delta.mode '${config.delta.mode}' for kind: 'materialize'. ` +
            `Allowed: 'full' | 'partial-refresh'. See ADR 0005 §"The kind taxonomy".`
        )
    }
    ```
    `move` is not constrained at registration time in v1 (behavior unimplemented; validation added when the adapter lands).
  - `this.replications = new Map()` → `this.pipelines = new Map()`. All internal references updated (`this.replications.has(name)` etc.).
  - Public `run(name, mode, trigger)` signature unchanged; internal `_runReplication` → `_runPipeline`.
  - `_normalizeConfig(config)` carries `kind` through: `return { kind: config.kind, name: ..., source: ..., target: ..., mode: ..., delta: ..., rest: ..., schedule: ..., viewMapping: ... }`.
- [ ] 3.2 `packages/cds-data-pipeline/srv/lib/Pipeline.js`:
  - Class `DataReplication` → `Pipeline`.
  - Log namespace → `cds.log('cds-data-pipeline')`.
  - Table-name constants:
    ```js
    const PIPELINES = 'plugin_data_pipeline_Pipelines'
    const RUNS = 'plugin_data_pipeline_PipelineRuns'
    ```
  - All `PIPELINE.READ / MAP / WRITE` → `PIPELINE.READ / MAP / WRITE` (in `_makeReq`, `registerDefault`, `dispatch` calls).
  - INSERT into `Pipelines` now includes `kind` column.
  - All `FEDERATIONS` references → `PIPELINES`; `tracker_name` column → `pipeline_name` in `INSERT.into(RUNS)`.
  - `_ensureTracker` / `_getTracker` / `clear` / status UPDATE clauses rewritten for new table names.
- [ ] 3.3 `packages/cds-data-pipeline/srv/adapters/{BaseAdapter,ODataAdapter,RestAdapter,factory}.js`:
  - `cds.log('cds-data-federation')` → `cds.log('cds-data-pipeline')` in all four files.
  - No other code changes (adapter logic is unchanged).
- [ ] 3.4 `packages/cds-data-pipeline/srv/lib/retry.js`:
  - `cds.log('cds-data-federation')` → `cds.log('cds-data-pipeline')`.
- [ ] 3.5 `packages/cds-data-pipeline/srv/pipeline-service.cds`:
  - Header comment rewritten: "CAP auto-wires `srv/DataPipelineService.js` by name matching" etc.
  - `service DataPipelineService {}` → `service DataPipelineService {}`.
- [ ] 3.6 `packages/cds-data-pipeline/srv/DataPipelineManagementService.cds`:
  - `using { plugin.data_federation as federation } from '../index.cds'` → `using { plugin.data_pipeline as pipeline } from '../db/index.cds'`.
  - `service DataPipelineManagementService @(path: '/federation')` → `service DataPipelineManagementService @(path: '/pipeline')`.
  - `entity Federations as projection on federation.Federations` → `entity Pipelines as projection on pipeline.Pipelines`.
  - `entity ReplicationRuns as projection on federation.ReplicationRuns` → `entity PipelineRuns as projection on pipeline.PipelineRuns`.
  - `function status(name: String) returns Federations` → `function status(name: String) returns Pipelines`.
  - `run` / `flush` action signatures unchanged.
- [ ] 3.7 `packages/cds-data-pipeline/srv/DataPipelineManagementService.js`:
  - Class `DataPipelineManagementService` → `DataPipelineManagementService`.
  - `cds.connect.to('DataPipelineService')` → `cds.connect.to('DataPipelineService')`.
- [ ] 3.8 `packages/cds-data-pipeline/db/index.cds`:
  - `namespace plugin.data_federation` → `namespace plugin.data_pipeline`.
  - Drop `FederationStrategy` enum (Approval §A.2).
  - Add new enum:
    ```cds
    type PipelineKind : String enum {
        replicate;
        materialize;
        move;
    }
    ```
  - `entity Federations` → `entity Pipelines`:
    - New column `kind : PipelineKind;`.
    - Drop `strategy : FederationStrategy;` field.
    - `source`, `target`, `mode`, `lastSync`, `lastKey`, `status`, `errorCount`, `lastError`, `statistics` unchanged.
    - `runs : Composition of many PipelineRuns on runs.pipeline = $self` (renamed from `tracker`).
  - `entity ReplicationRuns` → `entity PipelineRuns`:
    - `tracker : Association to one Federations` → `pipeline : Association to one Pipelines`. FK column becomes `pipeline_name`.
    - Everything else unchanged.
  - `aspect replicated { ... }` → **moved** to `packages/cds-data-federation/index.cds` (Approval §A.4). Engine CDS no longer declares it.
  - `aspect multiSourced { ... }` → **dropped** (currently unused across the repo; reintroduce under federation later if needed).
- [ ] 3.9 `packages/cds-data-pipeline/cds-plugin.js` (new file — moved + trimmed from root `cds-plugin.js`):
  ```js
  const cds = require('@sap/cds')
  const DataPipelineService = require('./srv/DataPipelineService')

  const LOG = cds.log('cds-data-pipeline')

  cds.once('served', async () => {
      let pipelineService = cds.services['DataPipelineService']
      if (!pipelineService) {
          pipelineService = new DataPipelineService('DataPipelineService')
          await pipelineService.init()
          cds.services[pipelineService.name] = pipelineService
      }
      LOG.info('cds-data-pipeline ready')
  })
  ```

  **No runtime DDL.** The current root `cds-plugin.js` has a `_ensureTrackerTables()` fallback that runs `CREATE TABLE IF NOT EXISTS plugin_data_federation_*` at startup. That pattern only works on SQLite (in-memory tests, local `.sqlite` files). **It does not work on HANA HDI**, where the plugin process has no DDL authority and schema ownership belongs to the HDI deployer. Dropping the fallback honors the CAP deployment model: the engine ships its CDS model at `packages/cds-data-pipeline/db/index.cds`, and tables are materialized by `cds deploy` (local dev / SQLite) or by the HDI container during `cf push` (HANA). The plugin runtime only reads + writes — it never DDLs.

  **Consumer-side implication.** The engine's tracker model must be part of the consumer's compiled CSN so `cds deploy` / HDI picks it up. Two options to evaluate in Phase 3 (not here):
  1. **Plugin auto-model** — declare the engine's model in its `package.json` so CAP auto-includes it on install (e.g. via `"cds": { "folders": { "db": "db" } }` or similar). Cleanest for consumers, matches `cds-caching`'s pattern. Requires a smoke test that `cds compile` picks it up from an installed workspace package.
  2. **Explicit `using`** — consumers add `using { plugin.data_pipeline } from 'cds-data-pipeline';` to their own schema. More friction, but explicit and protocol-obvious.

  Lean: option 1 if CAP plugin-loading supports it cleanly, fall back to option 2 if not. **Approval point §A.9** below. Whichever option lands, a sentence goes into `packages/cds-data-pipeline/README.md` §"Upgrade from `cds-data-federation` pre-split": *existing deployments must run `cds deploy` (or an HDI redeploy) after upgrading; the runtime no longer creates its own tables.*

  The `@federation.*` scanning + binding moves out of this plugin entirely — it lives under federation (Task 4).

### 4. Move federation code

- [ ] 4.1 `git mv srv/annotation-scanner.js packages/cds-data-federation/srv/annotation-scanner.js`.
- [ ] 4.2 `git mv srv/delegation packages/cds-data-federation/srv/delegation`.
- [ ] 4.3 Commit as standalone commit (move before rename).

### 5. Federation renames — code

- [ ] 5.1 `packages/cds-data-federation/srv/annotation-scanner.js`:
  - Log namespace stays `cds.log('cds-data-federation')` (unchanged — this is federation-side).
  - No rename of `@federation.*` annotation strings anywhere (user constraint).
- [ ] 5.2 `packages/cds-data-federation/srv/delegation/**`:
  - Log namespace stays `cds.log('cds-data-federation')` in every file.
  - No API changes; delegation is `remote.run(req.query)` style and unaffected by the engine rename.
- [ ] 5.3 `packages/cds-data-federation/index.cds` (new):
  ```cds
  namespace plugin.data_federation;

  using { User } from '@sap/cds/common';

  aspect replicated {
      lastReplicatedAt : Timestamp @cds.on.insert: $now;
      lastReplicatedBy : User      @cds.on.insert: $user;
  }
  ```
  Consumer schemas continue to `using { plugin.data_federation as federation } from 'cds-data-federation'` and get `federation.replicated` unchanged.
- [ ] 5.4 `packages/cds-data-federation/srv/pipeline-binding.js` (new, ~200 LoC) — the seam:
  ```js
  const cds = require('@sap/cds')

  const LOG = cds.log('cds-data-federation')

  async function bindReplicateConfigs(configs) {
      if (!configs || configs.length === 0) return

      let pipelineService
      try {
          pipelineService = await cds.connect.to('DataPipelineService')
      } catch (err) {
          throw new Error(
              `@federation.replicate requires 'cds-data-pipeline' to be installed. ` +
              `Run: npm install cds-data-pipeline. Original error: ${err.message}`
          )
      }

      for (const config of configs) {
          await pipelineService.addPipeline({
              kind: 'replicate',
              name: config.options.name || config.entityName,
              source: {
                  service: config.sourceService,
                  entity: config.sourceEntity,
                  batchSize: config.options.batchSize || 1000,
              },
              target: {
                  entity: config.entityFullName,
              },
              mode: config.options.mode || 'delta',
              delta: {
                  mode: config.options.delta?.mode || 'timestamp',
                  field: config.options.delta?.field || 'modifiedAt',
                  ...config.options.delta,
              },
              rest: config.options.rest,
              schedule: config.options.schedule,
              viewMapping: config.viewMapping,
          })
      }

      LOG.info(`Bound ${configs.length} @federation.replicate config(s) to cds-data-pipeline`)
  }

  module.exports = { bindReplicateConfigs }
  ```
- [ ] 5.5 `packages/cds-data-federation/cds-plugin.js` (new — combines the federation parts of the old root plugin):
  ```js
  const cds = require('@sap/cds')
  const { scanAnnotations } = require('./srv/annotation-scanner')
  const { registerFederationHandlers } = require('./srv/delegation')
  const { bindReplicateConfigs } = require('./srv/pipeline-binding')

  const LOG = cds.log('cds-data-federation')

  let _federationConfigs = []
  let _viewMappingRegistry = {}

  cds.on('loaded', (csn) => {
      const { configs, viewMappingRegistry } = scanAnnotations(csn)
      _federationConfigs = configs
      _viewMappingRegistry = viewMappingRegistry
      if (_federationConfigs.length > 0) {
          LOG.info(`Discovered ${_federationConfigs.length} @federation.* entities`)
      }
  })

  cds.once('served', async () => {
      if (_federationConfigs.length === 0) return

      const delegateConfigs = _federationConfigs.filter(c => c.strategy !== 'replicate')
      if (delegateConfigs.length > 0) {
          await registerFederationHandlers(delegateConfigs, _viewMappingRegistry)
      }

      const replicateConfigs = _federationConfigs.filter(c => c.strategy === 'replicate')
      if (replicateConfigs.length > 0) {
          try {
              await bindReplicateConfigs(replicateConfigs)
              LOG.info(`Registered ${replicateConfigs.length} @federation.replicate bindings`)
          } catch (err) {
              LOG.error('Failed to bind @federation.replicate configs:', err)
              throw err
          }
      }
  })
  ```
- [ ] 5.6 Delete root `cds-plugin.js` (its contents now split between the two packages).

### 6. Update external consumers

- [ ] 6.1 `test/consumer/db/schema.cds` — no change required (the `federation.replicated` aspect is still resolvable via `cds-data-federation`'s new `index.cds`).
- [ ] 6.2 `examples/consumer/db/schema.cds` — same. No change.
- [ ] 6.3 `test/consumer/srv/consumer-service.cds` — replace `using from 'cds-data-federation/srv/data-replication-management-service'` with `using from 'cds-data-pipeline/srv/DataPipelineManagementService'`.
- [ ] 6.4 `examples/consumer/srv/consumer-service.cds` — same replacement.
- [ ] 6.5 `examples/sales-intel/workbench/srv/federation-monitor-service.cds` — same, plus update any `DataPipelineManagementService` class reference to `DataPipelineManagementService`.
- [ ] 6.6 `test/consumer/package.json` — add `"cds-data-pipeline": "*"` to `dependencies`.
- [ ] 6.7 `examples/consumer/package.json` — same.
- [ ] 6.8 `examples/sales-intel/workbench/package.json` — same.

### 7. Test updates

- [ ] 7.1 `packages/cds-data-pipeline/test/integration/`:
  - Every `cds.connect.to('DataPipelineService')` → `cds.connect.to('DataPipelineService')` (currently one occurrence on line 18).
  - Every `'PIPELINE.READ' | 'PIPELINE.MAP' | 'PIPELINE.WRITE'` → `'PIPELINE.READ' | 'PIPELINE.MAP' | 'PIPELINE.WRITE'` (5 occurrences).
  - `.where({ tracker_name: 'ReplicatedProducts' })` → `.where({ pipeline_name: 'ReplicatedProducts' })` (line 137).
  - Test names: test prefixes like `'[4.7.1] R18: should allow before.PIPELINE.MAP handler …'` → `'[4.7.1] R18: should allow before.PIPELINE.MAP handler …'` (reflects the new event name in the test description).
- [ ] 7.2 `packages/cds-data-federation/test/unit/ or packages/cds-data-pipeline/test/unit/` — grep for any `DataPipelineService`, `REPLICATE.`, `addPipeline(` occurrences and rename (same edits as 7.1).
- [ ] 7.3 New validation test cases. Append to `packages/cds-data-federation/test/unit/ or packages/cds-data-pipeline/test/unit/` (or a new `test/pipeline-api.test.js` — approval): 
  ```js
  describe('addPipeline validation (ADR 0005)', () => {
      let srv
      beforeAll(async () => { srv = await cds.connect.to('DataPipelineService') })

      it('throws when kind is omitted', async () => {
          await expect(srv.addPipeline({ name: 'noKind', source: {}, target: {} }))
              .rejects.toThrow(/ADR 0005/)
      })

      it("rejects source.query on kind: 'replicate'", async () => {
          await expect(srv.addPipeline({
              kind: 'replicate',
              name: 'replicateWithQuery',
              source: { query: () => SELECT.from('X') },
              target: { entity: 'Y' }
          })).rejects.toThrow(/source\.query.*materialize/)
      })
  })
  ```
- [ ] 7.4 Per-package test subfolders deferred — user constraint: "Shared test/ harness at repo root stays". Only tests that target package-internal surfaces will move in a later PR; in this PR nothing moves.
- [ ] 7.5 `packages/cds-data-federation/test/integration/**` — check each file for `DataPipelineService` / `REPLICATE.*` / `addReplication` references and rename if any. Based on grep the delegation tests don't touch the engine; verification only.

### 8. Documentation updates

- [ ] 8.1 `docs/index.md`:
  - Rewrite landing paragraph — site name stays `cds-data-federation` (the federation plugin's docs), but add a sibling mention: "Composes the `cds-data-pipeline` engine for `@federation.replicate`." Positioning paragraph for the engine goes in `packages/cds-data-pipeline/README.md` (not the published site unless we add a second site; see §8.3).
  - Decision: if `mkdocs.yml` carries **one site, two nav sections** (ADR 0003 Follow-up §8 option (a), carried forward by ADR 0005 Follow-up §7), then `docs/index.md` becomes a landing page for both. Reconfirm split.
- [ ] 8.2 `spec/concepts/terminology.md`:
  - Add a new section "Pipeline vs. replication vs. materialization vs. movement" with the ADR 0005 definitions.
  - Verify the existing "Federation and replication are separate capabilities" paragraph still reads correctly post-split (it was added in ADR 0003 prep; only minor wording tweaks expected).
- [ ] 8.3 `docs/reference/comparison.md`:
  - Current matrices have one column `cds-data-federation`. Split into `cds-data-federation (annotation)` + `cds-data-pipeline (engine)` in the delegation matrix and the replication matrix.
  - Capabilities that live in federation (annotation, consumption views, cross-service `$expand`, CUD forwarding) attribute to the federation column; capabilities that live in the engine (tracker, retry, scheduler, adapters, management API) attribute to the engine column.
- [ ] 8.4 `spec/reference/requirements.md`:
  - **Split into per-package trackers** (ADR 0003 §Monorepo-layout, ADR 0005 §Follow-up §6):
    - `docs/pipeline/requirements.md` — §§4.4, 4.6, 4.7, 4.8, 4.10, 4.11, 4.13, 4.15, parts of 4.14. Headings retune: `§4.4 Replicate Strategy` → `§4.4 Pipeline (kind: replicate)`. Add Progress Summary rows for `kind: materialize` (Planned) and `kind: move` (Planned).
    - `docs/federation/requirements.md` — §§4.1, 4.2, 4.3, 4.5, 4.12, 4.16, remaining of 4.14.
  - Repo-root `spec/reference/requirements.md` becomes a short umbrella index linking to both per-package trackers and preserving §§Vision/Use Cases/Core Concepts sections that aren't requirement-numbered.
- [ ] 8.5 `docs/reference/features.md`, `docs/reference/annotations.md`, `docs/reference/management-service.md`:
  - Rename every `REPLICATE.*` event reference → `PIPELINE.*`.
  - Rename every `DataPipelineService` → `DataPipelineService`.
  - Rename every `addPipeline(...)` → `addPipeline({ kind: 'replicate', ... })` (with required-kind call-out).
  - Rename `Federations` entity table → `Pipelines`, `ReplicationRuns` → `PipelineRuns`.
  - Management service: path `/federation` → `/pipeline`; class `DataPipelineManagementService` → `DataPipelineManagementService`.
- [ ] 8.6 `docs/getting-started/first-replication.md`, `docs/getting-started/mixing-delegate-and-replicate.md`, `docs/integration/rest.md`:
  - Same renames (events, service-stub IDs, API names).
- [ ] 8.7 `mkdocs.yml`:
  - Two top-level nav sections per ADR 0005 Follow-up §7:
    ```yaml
    nav:
      - Home: index.md
      - Pipeline engine:
          - Getting started: ...
          - Reference: ...
          - Management API: ...
      - Federation plugin:
          - Getting started: ...
          - Concepts: ...
          - Reference: ...
      # Internal excluded
    ```
    Keep single site per ADR 0003 Follow-up §8 option (a). `exclude_docs` unchanged.
- [ ] 8.8 `CLAUDE.md`:
  - `§"What this project is"` rewrites for the monorepo + pipeline primitive framing (pointer to ADR 0005 for the "what this is / isn't" statement).
  - `§"Conventions"` — log namespace rule splits per package:
    - `cds.log('cds-data-pipeline')` in `packages/cds-data-pipeline/`.
    - `cds.log('cds-data-federation')` in `packages/cds-data-federation/`.
  - Event namespace rule: `PIPELINE.READ / MAP / WRITE` (was `REPLICATE.*`). Hook registration: `srv.before/on/after('PIPELINE.MAP', pipelineName, handler)`.
  - `§"What NOT to do"`: `Don't 'console.log'` bullet splits by package.
- [ ] 8.9 `AGENTS.md`:
  - Entry-point table updates to point at both packages.
  - §Conventions bullet: `Logging: cds.log('cds-data-pipeline')` in pipeline package, `cds.log('cds-data-federation')` in federation package.
- [ ] 8.10 Root `README.md`:
  - Becomes a short umbrella: project intro, links to `packages/cds-data-pipeline/README.md` + `packages/cds-data-federation/README.md`, collapsed feature matrix.
  - Rename all call-site examples (`addPipeline`, `PIPELINE.*`, `DataPipelineService`).
- [ ] 8.11 `packages/cds-data-pipeline/README.md` (new):
  - Positioning statement from ADR 0005 §"Positioning statement".
  - "What this is / What this isn't" section derived from ADR 0005 §"Explicit scope boundaries".
  - `kind` taxonomy table (ADR 0005 §"The kind taxonomy") with v1 status (`replicate` → Shipped, `materialize` → Planned, `move` → Planned).
  - `addPipeline({ kind, ... })` API reference.
  - Event hooks: `PIPELINE.READ / MAP / WRITE`.
  - Management service section (`DataPipelineManagementService` at `/pipeline`).
  - Upgrade section: `Federations`/`ReplicationRuns` → `Pipelines`/`PipelineRuns` migration pointer (→ script in §9).
- [ ] 8.12 `packages/cds-data-federation/README.md` (new):
  - Scope: annotation layer.
  - `@federation.delegate` + `@federation.replicate` reference.
  - Install pair: `npm install cds-data-federation cds-data-pipeline` for replicate; `cds-data-federation` alone suffices for delegate-only.
  - Peer-dep policy: loud error if `cds-data-pipeline` is absent at `served` time when `@federation.replicate` configs exist.
- [ ] 8.13 `.cursor/rules/project.mdc`: log namespace bullet updates (per package).
- [ ] 8.14 `.claude/commands/implement-feature.md`, `fix-bug.md`, `review.md`, etc.: global find-replace for `cds.log('cds-data-federation')` in snippets that belong to the engine → `cds.log('cds-data-pipeline')`. Conservative — only update snippets that clearly reference engine code.

### 9. Data migration (existing deployments with pre-split persisted tracker)

Scope: SQLite local-dev fixtures only. **HANA HDI deployments follow the standard CAP upgrade path: update the CDS model, run `cds build` + `cf push` (or `cds deploy`), and the HDI deployer handles the schema transition** via its own `cdsmc` rules — not a Node script.

- [ ] 9.1 `packages/cds-data-pipeline/scripts/migrate-sqlite-federations-to-pipelines.js` (SQLite only; HANA omitted):
  - Reads DB URL from CLI arg `--url` (path to `.sqlite` file).
  - Idempotent: `SELECT 1 FROM plugin_data_pipeline_Pipelines LIMIT 1` → skip if already migrated.
  - Otherwise, inside a transaction:
    1. Verify `plugin_data_pipeline_Pipelines` exists; bail if not (fresh install — nothing to migrate, consumer should just `cds deploy` the new model).
    2. Rename tables: `ALTER TABLE plugin_data_pipeline_Pipelines RENAME TO plugin_data_pipeline_Pipelines`; `ALTER TABLE plugin_data_pipeline_PipelineRuns RENAME TO plugin_data_pipeline_PipelineRuns`.
    3. Add `kind` column + backfill: `ALTER TABLE plugin_data_pipeline_Pipelines ADD COLUMN kind NVARCHAR(5000)`; `UPDATE plugin_data_pipeline_Pipelines SET kind = 'replicate' WHERE kind IS NULL`.
    4. Drop `strategy` column (SQLite needs `PRAGMA foreign_keys = OFF` + table-recreate dance — script handles).
    5. Rename FK column: `ALTER TABLE plugin_data_pipeline_PipelineRuns RENAME COLUMN tracker_name TO pipeline_name`.
  - Dry-run mode (`--dry-run`) prints the SQL without executing.
- [ ] 9.2 **No HANA HDI migration script.** `packages/cds-data-pipeline/README.md` §"Upgrade from `cds-data-federation` pre-split" documents for HANA consumers:
  - Update `package.json` (add `cds-data-pipeline`, keep `cds-data-federation`).
  - Rebuild CDS model: `cds build --production`.
  - Redeploy via HDI: `cf push` (or the CI/CD equivalent). The HDI deployer sees the renamed entities (`Federations` → `Pipelines`, `ReplicationRuns` → `PipelineRuns`, new `kind` column) and generates the appropriate `.hdbmigrationtable` artifacts. If the deployer refuses the rename (entity renames can require a `cdsmc` whitelist entry), document the whitelist recipe.
  - Existing row data is lost unless the user pre-stages a `@cds.persistence.name` alias to keep the old physical name during transition. Document this as a documented-but-not-recommended escape hatch; the tracker table is small (one row per pipeline) and re-initializing is usually acceptable.

### 10. ADR banners

- [ ] 10.1 `spec/internal/decisions/0001-replication-service-extends-cds-service.md`: top-of-file banner:
  ```markdown
  **Amended 2026-04-19 by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)** — event namespace renamed `REPLICATE.*` → `PIPELINE.*`; service class `DataPipelineService` → `DataPipelineService`. All other decisions in this ADR remain in force.
  ```
- [ ] 10.2 `spec/internal/decisions/0003-split-plugin-into-replication-and-federation.md`: status line:
  ```markdown
  **Status:** Superseded by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) (engine renamed `cds-data-replication` → `cds-data-pipeline`; kind taxonomy added). Split + peer-dep model preserved.
  ```
- [ ] 10.3 `spec/internal/decisions/0004-scope-cqn-adapter-to-cds-data-replication.md`: status line:
  ```markdown
  **Status:** Superseded by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md). The CQN adapter still lands in the engine package (now `cds-data-pipeline`); `source.query` is re-legitimized under `kind: 'materialize'` specifically, not as a generic escape hatch.
  ```

### 11. Idea-doc updates

- [ ] 11.1 `spec/internal/ideas/cds-data-materialization.md` — add an opening paragraph noting that ADR 0005 positions the future plugin as a sibling consuming `kind: 'materialize'` on `cds-data-pipeline`; link to ADR 0005. Minor edits only — the idea-doc predates ADR 0005 and already points at the pipeline direction.
- [ ] 11.2 `spec/internal/ideas/service-to-service-data-movement.md` — add a note: "Question 1 (is this in scope for a federation plugin?) is answered by [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md): no — it's `kind: 'move'` on `cds-data-pipeline`, no annotation plugin required."

### 12. Requirements-script adaptation

- [ ] 12.1 `scripts/sync-requirements-progress.js`:
  - Change `REQ_FILE` single constant to an array of per-package tracker paths: `docs/pipeline/requirements.md`, `docs/federation/requirements.md`.
  - Regenerate `spec/reference/test-mapping.md` by scanning all test IDs across both trackers.
  - Repo-root `spec/reference/requirements.md` becomes read-only umbrella; the Progress Summary in each per-package tracker regenerates independently.
- [ ] 12.2 Run `node scripts/sync-requirements-progress.js` → verify outputs.

### 13. Validation

- [ ] 13.1 `npm install` — workspace links resolve.
- [ ] 13.2 `npm run lint` — no new errors.
- [ ] 13.3 `npx jest --runInBand --forceExit --roots test/` — all tests pass (new validation tests included).
- [ ] 13.4 `npx jest --runInBand --forceExit --roots test/ --testNamePattern "addPipeline validation"` — new kind-required + source.query-forbidden tests pass.
- [ ] 13.5 `npx jest --runInBand --forceExit --roots test/ --testPathPattern "replication.test.js"` — behavior-equivalence smoke: same rows, same events, same statistics as pre-refactor.
- [ ] 13.6 `npm run docs:serve` — mkdocs nav renders without errors; both top-level sections reachable.
- [ ] 13.7 `npm run examples:start` — launchpad boots; `@federation.replicate` annotations in `examples/consumer` still trigger scheduled replication through the pipeline engine.
- [ ] 13.8 Grep gate (ADR 0005 acceptance criterion):
  ```bash
  rg -n 'DataPipelineService|REPLICATE\.|addReplication\(|\bFederations\b|\bReplicationRuns\b' \
     --glob '!spec/internal/decisions/0001-*' \
     --glob '!spec/internal/decisions/0003-*' \
     --glob '!spec/internal/decisions/0004-*' \
     --glob '!spec/internal/decisions/0005-*' \
     --glob '!spec/internal/plans/**' \
     --glob '!packages/cds-data-pipeline/scripts/migrate-*' \
     --glob '!CHANGELOG*'
  ```
  Must return **zero** hits outside of archived ADRs / changelog / migration entries / this plan doc.

---

## Test strategy

This is a refactor, not a feature. **Equivalence of behavior is the acceptance bar.** No new feature tests; two new validation tests for the new `kind`-required + `source.query`-forbidden rules.

- Pre-existing tests are the regression gate. Every file that references `DataPipelineService` / `REPLICATE.*` / `addReplication` gets mechanical renames (Task 7).
- New validation tests cover:
  - `addPipeline({...})` without `kind` throws with ADR 0005 message.
  - `addPipeline({ kind: 'replicate', source: { query: ... } })` throws pointing at `kind: 'materialize'`.
- Skipped tests stay skipped (no unskips in this PR).
- `kind: 'materialize'` / `kind: 'move'` behavioral tests are **out of scope** — only the registration-time validation lands in this PR.

---

## Validation commands

```bash
npm install
npm run lint
npx jest --runInBand --forceExit --roots test/
npx jest --runInBand --forceExit --roots test/ --testNamePattern "addPipeline validation"
npx jest --runInBand --forceExit --roots test/ --testPathPattern "replication.test.js"
npm run docs:serve
npm run examples:start
node scripts/sync-requirements-progress.js --check
# Grep gate (see Task 13.8)
```

---

## Rollback

Sequence is designed as a chain of small commits (one per numbered task where possible). If any validation step fails, `git revert` the offending commit and fix-forward. No data migration runs in CI; the migration script is a runtime tool.

---

## Out of scope (explicitly)

- **CQN adapter implementation** — ADR 0005 §Supersessions re-legitimizes `source.query` under `kind: 'materialize'`; the actual adapter factoring (extracting a `CqnAdapter` base from `ODataAdapter`) is a separate `/implement-feature` run after this lands, per ADR 0005 Follow-up §10 ("v1 scope commitment — ship `kind: 'replicate'` only in v1.0").
- **`kind: 'materialize'` / `kind: 'move'` behavior** — only the taxonomy declaration + registration-time validation ships. Both remain `Planned` in docs.
- **Renaming the `replicated` aspect** — stays federation-side per ADR 0005 §Consequences + user constraint. `@pipelined` / `@materialized` ideas deferred.
- **Renaming the GitHub repository** — ADR 0005 §"What this decision does not do" §3.
- **Per-package test regrouping (moving specs under `packages/*/test/`)** — deferred; user constraint is "Shared test/ harness at repo root stays".
- **`@federation.*` annotation changes** — byte-for-byte identical; user constraint.

---

## Approval checklist

Please confirm (or override) before I proceed to Phase 3:

- **§A.1** — Delete orphan `srv/data-replication-api-service.js` as dead code? (Alternative: move to `packages/cds-data-federation/srv/cache-admin-service.js` for future wire-up.) ☐ *Default: delete.*
- **§A.2** — Drop `FederationStrategy` enum from engine CDS? (No longer meaningful once the engine is kind-driven.) ☐ *Default: drop.*
- **§A.3** — `ReplicationRuns.tracker: Association to one Federations` (FK `tracker_name`) → `PipelineRuns.pipeline: Association to one Pipelines` (FK `pipeline_name`)? ☐ *Default: yes.*
- **§A.4** — `replicated` aspect moves to `packages/cds-data-federation/index.cds` (namespace `plugin.data_federation`). Engine CDS drops it. `multiSourced` aspect dropped entirely (currently unused). ☐ *Default: yes.*
- **§A.5** — Full `workspaces` glob including nested examples + test providers (not just `["packages/*", "examples/*"]`). ☐ *Default: full glob per §Pre-existing code §7.*
- **§A.6** — Management service rename `DataPipelineManagementService` (`/federation`) → `DataPipelineManagementService` (`/pipeline`), no backward-compat alias (pre-release). ☐ *Default: clean rename.*
- **§A.7** — Split `spec/reference/requirements.md` into per-package trackers in this PR, or defer the split to a follow-up `docs:` commit after code rename lands? ☐ *Default: split in this PR (ADR 0005 Follow-up §6 co-schedules).*
- **§A.8** — `mkdocs.yml` nav: single site, two top-level sections (option a); or two sites (option b)? ☐ *Default: single site, option (a) per ADR 0005 Follow-up §7.*
- **§A.9** — How should consumers pick up the engine's tracker CDS model so `cds deploy` / HDI materializes the tables? (Runtime DDL fallback is dropped — HANA HDI doesn't permit it.) ☐ *Default: option 1 — `cds-data-pipeline/package.json` declares the model so CAP's plugin loader auto-includes it; fall back to explicit `using { plugin.data_pipeline } from 'cds-data-pipeline'` in consumer schemas if option 1 turns out unreliable during Phase 3.*

If defaults are fine, reply "approved" or equivalent and I'll start Phase 3 at Task 1.
