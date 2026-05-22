# 8. Target-adapter capability layer for the pipeline WRITE phase

**Date:** 2026-04-19
**Status:** Accepted

## Context

The pipeline engine's WRITE phase is hard-coded to the local database. [`Pipeline._defaultWriteHandler`](../../../packages/cds-data-pipeline/srv/lib/Pipeline.js) calls `cds.connect.to('db')` unconditionally and issues `INSERT.into` (for query-shape pipelines) or `UPSERT.into` (for entity-shape pipelines). The surrounding plumbing already threads a generic `target: { service, entity }` config end-to-end: registration validators accept non-`db` `target.service`, the tracker persists the resolved target, and the inference rules in [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) derive `inferredKind = 'move'` when `target.service !== 'db'` and the source is entity-shape.

Three decisions already depend on a `TargetAdapter` abstraction that does not yet exist:

1. **[ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) §"The kind taxonomy"** introduced `kind: 'move'` with per-target idempotency contracts. The kind is now derived ([ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md)) but the per-target contract expectation stands.
2. **[ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) §"Registration-time validation matrix"** lists three rows (rows 6–8) that reference `target adapter lacks key-addressable writes` / `supportsBatchDelete` / `supportsBatchInsert`. Deferred in [`plans/completed/infer-pipeline-intent-from-config-shape.md:36`](../plans/completed/infer-pipeline-intent-from-config-shape.md) §A.1 pending this ADR.
3. **[`packages/cds-data-pipeline/spec/concepts/inference.md:44-52`](../../../packages/cds-data-pipeline/spec/concepts/inference.md)** labels the same rows `Planned — unlocked when target-adapter capability layer lands`.

The originating idea is [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) ("Option A — Pluggable target adapter, programmatic-first"). Its Question 1 ("is this in scope?") was answered by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md); Questions 2–7 are resolved by this ADR.

### Constraints shaping the decision

- **Source-side precedent is minimal.** [`BaseAdapter`](../../../packages/cds-data-pipeline/srv/adapters/BaseAdapter.js) has a single method, `readStream(tracker)`. There are no source-side capability flags because READ doesn't need them. The WRITE side is **not** a mirror — capability flags are the essential new concept, not a symmetric copy.
- **MAP phase already produces locally-named records.** [`Pipeline._defaultMapHandler`](../../../packages/cds-data-pipeline/srv/lib/Pipeline.js) applies `viewMapping.remoteToLocal` and stores the result on `req.data.targetRecords`. Target adapters receive records in the **local** namespace; outbound-to-remote rename, if needed, is the adapter's concern.
- **Delegate CUD forwarding (Req 4.2.10) is per-request pass-through.** [`registerWriteHandlers`](../../../packages/cds-data-federation/srv/delegation/handler-registration.js) is a five-line `remote.run(req.query)` per event. No batching, no idempotency. It shares transaction scope with the incoming CAP request, which target adapters do not. Low unification value.
- **User WRITE hooks are the current escape hatch.** [`recipes/move-to-service.md`](../../../docs/pipeline/recipes/move-to-service.md) already documents the pattern of overriding `PIPELINE.WRITE`. The factory-resolved adapter becomes the *default*; user hooks continue to win.

### The question answered in this ADR

*What is the contract between the pipeline engine and a target adapter, and which capability flags does each built-in adapter declare, so that the engine can validate `mode` / `source.query` / `delta` combinations at registration time?*

## Decision

Introduce a `BaseTargetAdapter` contract in [`packages/cds-data-pipeline/srv/adapters/`](../../../packages/cds-data-pipeline/srv/adapters/). Four built-in adapters (`DbTargetAdapter`, `CqnTargetAdapter`, `ODataTargetAdapter`, `RestTargetAdapter`) dispatched by a factory keyed on `target.service` kind. Per-adapter capability flags consumed by `_validateConfig` to close [ADR 0007's validation matrix rows 6–8](./0007-infer-pipeline-intent-from-config-shape.md).

### Contract

```javascript
class BaseTargetAdapter {
  static capabilities = {
    supportsKeyAddressableWrites: false,  // enables mode: 'delta'
    supportsTruncate:             false,  // enables mode: 'full'
    supportsBatchInsert:          false,  // enables source.query snapshot writes
    supportsBatchDelete:          false,  // enables Req 4.4.5 delete propagation
  }

  async writeBatch(records, tracker, ctx) { /* per-adapter idempotency */ }
  async deleteBatch(keys,    tracker, ctx) { /* optional */ }
  async truncate(tracker,             ctx) { /* optional — full-refresh */ }
}
```

`Pipeline._defaultWriteHandler` is reduced to: resolve the adapter via factory once at `init()`, dispatch on pipeline shape to `writeBatch` / `deleteBatch` / `truncate`. User WRITE hooks (`srv.on('PIPELINE.WRITE', ...)`) continue to compose through CAP's native handler chain and always win — the adapter path is the default, not a replacement for the hook surface.

### Built-in adapters and idempotency guarantees

Per Question 1 — **per-adapter documented guarantee; engine enforces only via capability flags**.

| Adapter | `target.service` kind | `writeBatch` primitive | Idempotency guarantee | `truncate` | `batchInsert` |
|---|---|---|---|---|---|
| `DbTargetAdapter` | `db` | `UPSERT.into(target)` (entity-shape) / `INSERT.into(target)` (query-shape) | **Strong** — SQL UPSERT. Exact behavior unchanged from today's `_defaultWriteHandler`. | `DELETE.from(target)` | yes |
| `CqnTargetAdapter` | `sql`, `sqlite`, `hana`, CAP-wrapped legacy DBs, any CQN-native `cds.requires` service | `UPSERT.into` / `INSERT.into` dispatched to `target.run(cqn)` | **Strong** — same primitives as `DbTargetAdapter`, differs only in which service `cds.connect.to(...)` resolves. Unlocks service-to-service replication with full Req 4.4.4 semantics. | `DELETE.from(target)` via `target.run` | yes |
| `ODataTargetAdapter` | `odata`, `odata-v2` | PUT-by-key, 404 → POST fallback, wrapped in `withRetry` and `propagateRemoteError` | **Best-effort** — per-record. Race window between GET-304 and PUT on concurrent external writers documented per-adapter. Uses OData `$batch` where available; sequential otherwise. | not supported (no server-side truncate in OData) — user-supplied hook required for `mode: 'full'` | **not supported** (no server-side snapshot write) |
| `RestTargetAdapter` | `rest` | user-supplied `target.writeBatch(records, ctx)` closure | **User-declared.** The user owns `writeBatch`; the adapter is a thin pass-through that applies `withRetry` and error translation. | user-supplied `target.truncate(ctx)` | user-supplied `target.writeBatch` (same closure covers both) |

**Why per-adapter published guarantees, not a plugin-level at-least-once dedup store (Question 1 Option B):** The DB case already has strong idempotency for free via SQL UPSERT. Adding a plugin-owned dedup table to satisfy the non-DB cases would force operational surface on every user (including DB-only users) for a guarantee that can't be stronger than the weakest adapter anyway. Publishing per-adapter guarantees keeps each adapter honest and doesn't tax the DB path.

### Capability-validated registration matrix

Implements [ADR 0007 rows 6–8](./0007-infer-pipeline-intent-from-config-shape.md) §"Registration-time validation matrix":

| Config combination | Engine response |
|---|---|
| `mode: 'delta'` + adapter without `supportsKeyAddressableWrites` | Error — "target cannot address writes per key; use `mode: 'full'` or choose a different target" |
| `mode: 'full'` + adapter without `supportsTruncate` (and no user `truncate` hook) | Error — "target cannot truncate for full refresh; supply `target.truncate` or choose a different target" |
| `source.query` + adapter without `supportsBatchInsert` | Error — "target cannot accept snapshot writes; query-shape pipelines need a target that supports batch insert" |

Each message points at the config + resolved adapter, matching [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) §"Observations" bullet 5.

### Mapping direction on the outbound path

Per Question 2 — **the target adapter applies `localToRemote` when writing to a renamed remote.**

- `DbTargetAdapter` / `CqnTargetAdapter`: no second translation. The target IS the local model (or a CAP service over the same CDS shape); `req.data.targetRecords` is already in the correct namespace.
- `ODataTargetAdapter` / `RestTargetAdapter`: consume `req.data.targetRecords` (local names) and apply `config.viewMapping.localToRemote` at write time before constructing the OData PUT-by-key URL or handing records to the user's REST closure. This reuses the same `localToRemote` table already built for delegate CUD ([Req 4.2.10](../../reference/requirements.md)) — no new plumbing.
- User WRITE hooks continue to see `req.data.targetRecords` in local names and are free to re-translate however they want.

**Why not a second `PIPELINE.MAP_OUTBOUND` phase (Question 2 Option B):** adds a phase to the lifecycle forever to solve a one-adapter problem (only OData/REST targets with a renaming `viewMapping` need outbound translation; DB/CQN targets do not). Keeping the rename inside the adapter means the phase count stays at three (READ / MAP / WRITE).

### Relationship to Req 4.2.10 delegate CUD forwarding

Per Question 3 — **independent. Share only `withRetry` and `propagateRemoteError`, both of which are already library-level.**

| | Delegate CUD (Req 4.2.10) | Target adapters (§4.17) |
|---|---|---|
| Granularity | per-request | per-batch |
| Transport | `remote.run(req.query)` pass-through | adapter-constructed writes (PUT-by-key, UPSERT, closure) |
| Transaction scope | shares the incoming CAP request's tx | pipeline's own tx (or none for non-CQN targets) |
| Rename translation | CAP projection chain does it | adapter applies `localToRemote` (see above) |
| Idempotency | remote service's inherent semantics | per-adapter published guarantee |

Sharing an "OData write-primitive library" (Question 3 Option B) is a **revisit trigger, not a v1.x commitment**: if a second consumer of PUT-by-key + 404→POST appears, extract at that point.

### REST target contract shape

Per Question 5 — **config closures with inferred capabilities.** Symmetric to how source-side [`RestAdapter`](../../../packages/cds-data-pipeline/srv/adapters/RestAdapter.js) takes config closures for pagination and delta-URL.

```javascript
target: {
  service: 'reporting-api',
  writeBatch: async (records, ctx) => { /* user-owned */ },
  deleteBatch: async (keys, ctx) => { /* optional */ },
  truncate:    async (ctx) => { /* optional */ },
  capabilities: { supportsKeyAddressableWrites: true },  // optional override
}
```

`RestTargetAdapter` wraps the closures in `withRetry` and translates thrown errors via `propagateRemoteError`. Capabilities default from closure presence: providing `deleteBatch` implies `supportsBatchDelete`, providing `truncate` implies `supportsTruncate`, providing `writeBatch` implies both `supportsBatchInsert` and (by user declaration if specified) `supportsKeyAddressableWrites`. The explicit `capabilities` object is the override when inference is wrong (e.g. user's `writeBatch` is not key-addressable because the REST endpoint appends-only).

### `target.query` escape hatch

Per Question 6 — **deferred.** The `source.query` closure was motivated by a concrete read pattern (aggregated snapshot, [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md)). The write-side analogue has no equivalent concrete use case that the REST config closures or user WRITE hook doesn't already cover. Reintroducing symmetry is cheap later; bloating v1 surface today is not.

### What stays

- **User WRITE hooks.** `srv.on('PIPELINE.WRITE', ...)` always wins over the adapter default. The override pattern documented in [`move-to-service.md`](../../../docs/pipeline/recipes/move-to-service.md) continues to work unchanged.
- **Consumption-view projection.** MAP phase (§4.7) output semantics are unchanged — target adapters consume `req.data.targetRecords` exactly as user WRITE hooks do today.
- **Credential isolation.** Per [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) and `ideas/service-to-service-data-movement.md` Question 6, source and target both resolve through `cds.requires`. No new credential plumbing.
- **`withRetry` and `propagateRemoteError`.** Shared between delegate CUD and the OData/REST target adapters. Already the common primitives; this ADR adds no new ones.
- **Req 4.4.4 (UPSERT writes) guarantee for DB and CQN-native targets.** `DbTargetAdapter` and `CqnTargetAdapter` preserve it exactly.

## Consequences

### What this enables

- **Service-to-service replication with strong idempotency** (source-entity → CQN-native target): same Req 4.4.4 UPSERT, same Req 4.10.1 retry, zero behavior change for `target.service: 'db'`.
- **"Materialize to non-`db` target" cell closes.** Nightly aggregate → reporting service is expressible end-to-end; called out by [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) §"Consequences" bullet 1.
- **[ADR 0007 rows 6–8](./0007-infer-pipeline-intent-from-config-shape.md) graduate** from `Planned` to `Implemented` capability. The deferral note in [`plans/completed/infer-pipeline-intent-from-config-shape.md:36`](../plans/completed/infer-pipeline-intent-from-config-shape.md) §A.1 resolves.
- **Custom targets slot cleanly.** `event-bus`, `s3`, `http-webhook` become additional factory entries with their own capability flags; no new `kind: 'publish'` / `kind: 'broadcast'` pressure.
- **Delegate CUD and target adapters evolve independently.** Neither is blocked by the other's refactor schedule.

### Target-state ownership (published in two places — per Question 4)

Once `target.service !== 'db'`, the pipeline no longer owns target state. Concurrency with external writers, conflict resolution (Req 4.10.10), and schema drift at the target are the user's concerns, not the plugin's.

**Documented in both:**
- Each per-adapter doc page (`docs/pipeline/adapters/{odata,rest,cqn}-target.md`) — a "Who owns target state" section.
- [`recipes/move-to-service.md`](../../../docs/pipeline/recipes/move-to-service.md) — cross-cutting warning above the code sample.

### What we accept as trade-offs

- **Weaker idempotency off the DB/CQN target.** Each adapter publishes what it guarantees; `ODataTargetAdapter`'s "best-effort per-record" is the headline case. Users who need stronger guarantees either stage through DB first (two pipelines) or supply a `RestTargetAdapter` closure with their own dedup.
- **Delete propagation stays open.** Req 4.4.5 is not blocked by this ADR but is not solved by it either. Adapters that declare `supportsBatchDelete` can participate once Req 4.4.5 lands.
- **`_defaultWriteHandler` refactor.** The current in-place write moves behind the factory; zero-behavior-change for `target.service: 'db'`, but tests need to cover "default adapter resolves to `DbTargetAdapter`."
- **Per-adapter error surface grows.** Each target adapter publishes a per-error classification (transient vs. permanent, retryable vs. dead-letter). Req 4.10.8 (dead-letter) tracks the retryable side.
- **No shared OData write-primitive library in v1.x.** Accepted; revisit if a second consumer appears.

### Supersessions and amendments

- **Requirements tracker.** [`spec/reference/requirements.md` §4.17](../../reference/requirements.md) rows 4.17.1–4.17.8 are the implementation tracker for this ADR. Already added.
- **Idea file.** [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) already lists this ADR in its `Promoted to:` and `Related decisions` sections (added alongside the ADR stub). The six questions from Option A are now resolved.
- **No prior ADR is superseded.** [ADR 0001](./0001-replication-service-extends-cds-service.md), [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md), [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md), [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) all remain in force; this ADR closes deferrals from [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) but does not contradict any decision in it.

### Follow-up work (checklist — not ADR content)

Tracked for `/implement-feature` planning; no implementation in this ADR.

1. **Create `BaseTargetAdapter`** at [`packages/cds-data-pipeline/srv/adapters/BaseTargetAdapter.js`](../../../packages/cds-data-pipeline/srv/adapters/) with the contract and capability flags per §Decision.
2. **Implement `DbTargetAdapter`** by lifting `Pipeline._defaultWriteHandler` logic verbatim. Zero-behavior tests for `target.service: 'db'`.
3. **Implement `CqnTargetAdapter`** using `cds.connect.to(config.target.service).run(UPSERT.into(...))`. Reuses `DbTargetAdapter` primitives.
4. **Implement `ODataTargetAdapter`** with PUT-by-key + 404→POST fallback, `$batch` where available. Wrap in `withRetry` and `propagateRemoteError`.
5. **Implement `RestTargetAdapter`** as a thin pass-through over config closures (`target.writeBatch` / `deleteBatch` / `truncate`). Capability inference from closure presence.
6. **Target-adapter factory** at [`packages/cds-data-pipeline/srv/adapters/target-factory.js`](../../../packages/cds-data-pipeline/srv/adapters/) dispatching on `target.service` kind. Symmetric to [`factory.js`](../../../packages/cds-data-pipeline/srv/adapters/factory.js).
7. **Refactor `Pipeline._defaultWriteHandler`** to resolve an adapter in `init()` (stored as `this.targetAdapter`) and dispatch on pipeline shape in the WRITE handler.
8. **Rewrite `_validateConfig`** matrix rows 6–8 per §Decision "Capability-validated registration matrix". One test per row.
9. **Per-adapter doc pages** at [`docs/pipeline/adapters/{db,cqn,odata,rest}-target.md`](../../../docs/pipeline/) with the "Who owns target state" section (per Question 4).
10. **Update [`recipes/move-to-service.md`](../../../docs/pipeline/recipes/move-to-service.md)** — remove the "until the target-adapter capability layer lands" caveat, add the cross-cutting target-state-ownership warning (per Question 4), link to the four new per-adapter doc pages.
11. **Update [`concepts/inference.md`](../../../packages/cds-data-pipeline/spec/concepts/inference.md)** — rows 6–8 graduate from "Planned" to part of the live validation matrix; remove the "unlocked when target-adapter capability layer lands" banner.
12. **Flip §4.17 rows in [`spec/reference/requirements.md`](../../reference/requirements.md)** as each follow-up lands (Not started → Implemented).
13. **Examples.** Add a `move-to-service` example under `examples/` demonstrating a CQN-native target (two CAP services) once `CqnTargetAdapter` ships — satisfies the §4.16 maintenance rule.
14. **Linear tickets.** One per adapter + one for the factory/validator rewrite; `Status: Accepted` on this ADR is the "ready to plan" signal for the Linear MCP.

### What this decision does not do

- **Does not open `target.query` as an API today** (Question 6). The door stays open for a future ADR if a concrete scenario materialises.
- **Does not extract a shared OData write library** between delegate CUD and target adapters (Question 3 Option B). Revisit trigger only.
- **Does not add a new pipeline phase.** Three phases (READ / MAP / WRITE) remain.
- **Does not change Req 4.2.10 behavior.** Delegate CUD forwarding is unaffected.
- **Does not require a plugin-level dedup store.** Per-adapter published guarantees are the idempotency model.
- **Does not propagate deletes.** Req 4.4.5 remains independent future work.

## References

- [ADR 0001](./0001-replication-service-extends-cds-service.md) — `PIPELINE.*` events on `cds.Service`; the WRITE hook extension point.
- [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) — target adapters live in the engine package, not federation.
- [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md) — source-side CQN adapter and the `source.query` escape hatch (the read-side precedent for configuration-driven adapters).
- [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) — `kind: 'move'` semantic and per-target idempotency expectations.
- [ADR 0007](./0007-infer-pipeline-intent-from-config-shape.md) — inference matrix rows 6–8 (closed by this ADR).
- [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — originating idea; Option A formalised here.
- [`spec/reference/requirements.md` §4.17](../../reference/requirements.md) — implementation tracker.
- [`packages/cds-data-pipeline/srv/lib/Pipeline.js` `_defaultWriteHandler`](../../../packages/cds-data-pipeline/srv/lib/Pipeline.js) — current hard-coded write path; lifted into `DbTargetAdapter`.
- [`packages/cds-data-pipeline/srv/adapters/BaseAdapter.js`](../../../packages/cds-data-pipeline/srv/adapters/BaseAdapter.js) — source-side contract the target side is **inspired by, not mirrored from** (targets add capability flags).
- [`packages/cds-data-pipeline/srv/adapters/factory.js`](../../../packages/cds-data-pipeline/srv/adapters/factory.js) — source-side factory the target-side factory is symmetric to.
- [`packages/cds-data-federation/srv/delegation/handler-registration.js` `registerWriteHandlers`](../../../packages/cds-data-federation/srv/delegation/handler-registration.js) — Req 4.2.10 delegate CUD forwarding, independent of target adapters per §Decision.
- [`docs/pipeline/recipes/move-to-service.md`](../../../docs/pipeline/recipes/move-to-service.md) — the user-hook escape hatch that the adapter default supplants.
- [`packages/cds-data-pipeline/spec/concepts/inference.md`](../../../packages/cds-data-pipeline/spec/concepts/inference.md) — validation-matrix page that drops the "unlocked when target-adapter capability layer lands" banner as part of follow-up work.
- [`spec/internal/plans/completed/infer-pipeline-intent-from-config-shape.md` §A.1](../plans/completed/infer-pipeline-intent-from-config-shape.md) — formal deferral point that this ADR resolves.
