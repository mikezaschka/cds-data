# Service-to-service data movement

**Status:** Promoted
**Created:** 2026-04-19
**Promoted to:** [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) — `kind: 'move'` on the `cds-data-pipeline` engine; [ADR 0008](../decisions/0008-target-adapter-capability-layer.md) — `TargetAdapter` capability contract for the WRITE phase (Option A formalised; Questions 2–7 resolved).
**Related:** Req 4.6.3 (CQN adapter, Not started), Req 4.2.10 (CUD forwarding, Implemented), Req 4.4.x (Replicate core), Req 4.6.x (Source adapters), Req 4.17.x (Target adapters, tracks [ADR 0008](../decisions/0008-target-adapter-capability-layer.md)), ADR 0001 (PIPELINE.* events on cds.Service), ADR 0005 (engine repositioning), ADR 0007 (inferred kind + validation matrix rows 6–8)

## Related decisions

- [ADR 0008 — Target-adapter capability layer for the pipeline WRITE phase](../decisions/0008-target-adapter-capability-layer.md) **formalises Option A below** as the shape of the `TargetAdapter` contract and wires the per-adapter capability flags into [ADR 0007](../decisions/0007-infer-pipeline-intent-from-config-shape.md)'s registration-time validation matrix (rows 6–8). Questions 2–7 from this idea are resolved in the ADR's §"Decision" (per-adapter idempotency guarantees, adapter-internal `localToRemote` rename, independence from Req 4.2.10 CUD forwarding, target-state ownership warning in two places, REST config closures, `target.query` deferred). The corresponding requirements rows live at [`spec/reference/requirements.md` §4.17](../../reference/requirements.md).
- [ADR 0005 — Reposition engine as `cds-data-pipeline`](../decisions/0005-reposition-engine-as-cds-data-pipeline.md) **answers Question 1 definitively.** Service-to-service movement is neither federation nor a separate sibling product — it is the **`kind: 'move'`** variant of the pipeline engine. The pipeline primitives (READ → MAP → WRITE, tracker, adapters, retry, events, management API) are pattern-agnostic by design; the `kind` field decides the semantics layered on top (`replicate` for row-preserving copy, `materialize` for aggregated snapshot, `move` for non-`db` target). No annotation plugin is required — service-to-service movement is reached programmatically via `addPipeline({ kind: 'move', source, target, ... })`. A dedicated `cds-data-movement` annotation plugin is explicitly considered unnecessary in [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md); revisit only if evidence accumulates.
- [ADR 0003 — Split the plugin into `cds-data-replication` (engine) and `cds-data-federation` (annotation layer)](../decisions/0003-split-plugin-into-replication-and-federation.md) *(superseded by ADR 0005 for naming; structurally preserved)* initially answered Question 1 by placing target adapters in the engine package. ADR 0005 refines that answer by making the engine pattern-agnostic (pipeline, not replication) and naming the use case explicitly (`kind: 'move'`).
- [ADR 0004 — Scope Req 4.6.3 (CQN adapter) to `cds-data-replication`](../decisions/0004-scope-cqn-adapter-to-cds-data-replication.md) *(superseded by ADR 0005 for naming; structurally preserved)* introduces the `source.query` escape hatch on the source side. The shape is deliberately symmetric to the `target.query` escape hatch anticipated by Option A below, so whoever implements target adapters inherits a consistent ergonomic. Under ADR 0005 `source.query` is re-legitimized as a defining feature of `kind: 'materialize'`.

## Trigger

`DataReplicationService` currently moves data in exactly one direction: **remote source → local DB**. The default WRITE handler in [`srv/lib/DataReplication.js`](../../../srv/lib/DataReplication.js) is hard-coded to `cds.connect.to('db')` + `UPSERT.into(targetEntity)`, even though the rest of the pipeline already threads a generic `target: { service, entity }` shape end-to-end ([`srv/DataReplicationService.js:149`](../../../srv/DataReplicationService.js), tracker persists `target` as JSON).

The idea: lift that hard-coded `'db'` so a replication can write to **any** `cds.requires` service — another CAP service, a second S/4 tenant, a REST backend — making the plugin offer *managed data movement between two services* as a first-class use case. Today this is the manual-integration gap left of SAP Integration Suite / Cloud Integration: small, declarative, in-process, CDS-model-aware.

## Non-goals

- **Not an iPaaS replacement.** No visual modeller, no broker, no adapter marketplace. The scope is "two CAP-addressable services + mapping + schedule/trigger".
- **Not a new strategy.** See the "Don't add a cache strategy" note in [`CLAUDE.md`](../../../CLAUDE.md). This should land as capability on `@federation.replicate`, not as `@federation.move` or similar.
- **Not delegation.** This is data-at-rest movement, not a live proxy. `@federation.delegate` stays untouched.
- **Not a generic ETL engine.** No joins across sources inside the pipeline; no transformation DSL beyond the existing `REPLICATE.MAP` hook.
- **Not about replacing `@federation.replicate: { target: db }`** — the local-DB default stays the path of least surprise and the default target.

## Options

### Option A — Pluggable target adapter, programmatic-first

Symmetric to source adapters (Req 4.6.x): introduce a `TargetAdapter` base class with `writeBatch(records, tracker)`, select via factory by `target.service` kind (`db` | `odata` | `rest` | `cqn`). No new annotation — activated by passing a non-`db` `target` to `addReplication(...)` or by a second annotation option `target: { service, entity }` on `@federation.replicate`.

- **Pros:** Minimal conceptual surface. Fits the existing `READ → MAP → WRITE` mental model exactly. ADR 0001's `REPLICATE.WRITE` event is already the extension point; users can already override it today per replication.
- **Cons:** Writing to remote OData/REST at batch scale is harder than reading: no server-side UPSERT, per-record error handling, no free idempotency. The [Req 4.4.4 "UPSERT writes"](../../reference/requirements.md) guarantee can't be honoured generally — target adapters will need a per-kind idempotency contract (e.g. remote OData: PUT-by-key with 404 → POST fallback; REST: user-provided `writeBatch`).
- **Cons:** Breaks the "consumption view IS the federation contract" principle slightly — the projection now also encodes the **target** schema, not just the read schema. Unless we say the projection is interpreted local-side and the target adapter does its own out-bound mapping.

### Option B — Two consumption views + pipeline binder

Stay strictly declarative. The user declares a normal `@federation.replicate` that lands data in the local DB **and** a separate "outbound" CDS projection that declares how a local entity (possibly the replicated one) maps onto a remote target. A binder annotation ties them: `@federation.replicate: { bridgeTo: 'OutboundProjection' }` (or a separate `@federation.outbound` annotation on the outbound projection).

- **Pros:** Each projection keeps its single-service federation contract. Composes with existing `@federation.delegate` CUD forwarding (Req 4.2.10) — outbound writes go through the same CUD path that's already implemented and tested.
- **Pros:** Natural place for "replicate source A, transform with MAP hooks, publish to target B" — MAP hook already has the local/staged shape.
- **Cons:** Two moving parts for what the user thinks of as one flow. Discovery is worse — you can't see the movement by looking at a single annotation.
- **Cons:** Always goes through the local DB (staging). Fine for durability / retry; not fine if the point is "pass-through without storing locally".

### Option C — Direct pipe, no staging

New `target` shape `{ service, entity, stage: false }` that makes WRITE stream directly from MAP to the target adapter, no local DB write. Effectively makes `DataReplicationService` a managed copy job.

- **Pros:** Matches the user's phrasing ("move data from one service to another") most directly. Enables use cases where staging locally is undesirable (volume, PII, licensing).
- **Cons:** Loses checkpoint/resume for free — Req 4.10.2 (Checkpoint/resume) is already "In progress"; without a local write there's no local high-watermark to resume from beyond what the source adapter itself gives us.
- **Cons:** We lose the durability guarantee that makes replicate's retry model simple. Back-pressure and dead-letter (Req 4.10.8, Not started) become prerequisites, not nice-to-haves.

## Open questions

1. ~~**Is this in scope for a "data-federation" plugin?**~~ **Answered by [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md).** Not in scope for federation. In scope for the renamed `cds-data-pipeline` engine as `kind: 'move'`. The federation plugin (`cds-data-federation`) stays federation-specific; the engine underneath it is pattern-agnostic.
2. **Mapping direction.** The consumption view today maps *remote → local*. For outbound, we need *local → remote*. The existing view-mapping infrastructure (`localToRemote`, `remoteToLocal` in [`srv/lib/ViewMapping.js`](../../../srv/lib/ViewMapping.js) — check path) already has both directions for delegate CUD. Can target adapters reuse it as-is?
3. **Idempotency contract.** Req 4.4.4 (UPSERT writes) is trivial on SQL, painful on remote OData, user-defined on REST. What's the minimum guarantee we document for `target.kind !== 'db'`?
4. **Deletes.** Req 4.4.5 (Soft-delete propagation) is Not started even for the local-DB target. Propagating deletes to a remote target is strictly harder — likely out of scope for v1.
5. **Relationship to Req 4.2.10 (CUD forwarding) and Phase 6 (event-driven sync).** Forwarding a single CUD to a remote and moving a batch to a remote are the per-request vs. per-batch views of the same thing. Should they share an adapter layer?
6. **Credentials.** Req 4.12.1 already gives us per-target credential isolation via `cds.requires`. Nothing new to build there — but the docs need to be explicit that now both `source` and `target` sit in `cds.requires`.
7. **Who owns the target state?** With a local-DB target we own it. With a remote-service target we don't — conflict resolution (Req 4.10.10) and concurrency with external writers become the user's problem, not the plugin's. We need to say so loudly.
8. **Comparison to existing SAP offerings.** Does SAP SCI / SDI / Cloud Integration already own this space? What's the distinct value of a CAP plugin — CDS-model-awareness, in-process, no separate deployment?

## Initial reaction (to capture for later decision)

Option A + a restricted scope feels like the natural next step **if** we decide the plugin should grow here at all:

- The pipeline is already event-based on `cds.Service` (ADR 0001). A `target.service !== 'db'` case is a clean extension, not a re-architecture.
- Keeping it programmatic-first (not a new annotation) bounds the blast radius — users who opt in accept that idempotency / conflict resolution / deletes are weaker than for the DB target.
- Questions 1 and 5 are the real blockers. Until we have an answer on whether this is one product or two, this idea stays `Exploring`.
