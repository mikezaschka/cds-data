# ADR 0009 — Event-driven pipeline runs (CAP messaging / CloudEvents)

Status: Implemented (v1 code in `DataPipelineService.execute` / `executeEvent`, `Pipeline._executeEventPayload`, `srv/lib/eventKeyRead.js`)
Date: 2026-04-25
Supersedes: —
Extends: ADR 0008 — Multi-source fan-in; refines [G4 — Messaging / CDC](0008-multi-source-into-one-entity.md#capability-gap-inventory-vs-gregorwolfcap-replication-demo)

## Context

Replication workloads commonly combine two ingestion paths:

1. **Batch / polling** — `execute`, schedule, or external `POST /pipeline/execute`: read many rows from OData, REST, CQN, or a custom `readStream(tracker)`.
2. **Events** — CloudEvents (e.g. from SAP S/4HANA or SAP Event Mesh) or CAP in-process [messaging](https://cap.cloud.sap/docs/guides/messaging) — often handled today with `messaging.on(topic, async (msg) => { ... })` and **ad hoc** `UPSERT` in application code, as in [gregorwolf/cap-replication-demo](https://github.com/gregorwolf/cap-replication-demo) (`replication-service.js`).

`cds-data-pipeline` already:

- Declares `RunTrigger.event` in [db/index.cds](../db/index.cds) and whitelists `trigger: 'event'` on the management [execute](../srv/DataPipelineManagementService.js) path.
- Records `PipelineRuns.trigger` for every run.

But `DataPipelineService.execute` and `Pipeline._run` always run the **full** READ/MAP/WRITE path for the configured **batch** source adapter ([srv/lib/Pipeline.js](../srv/lib/Pipeline.js): `_deltaSync` → `adapter.readStream(tracker)`). A successful run **always** updates `Pipelines.lastSync` to the run end time (same file). Therefore:

- Using `POST /pipeline/execute` with `trigger: 'event'` only **labels** the run; it does **not** model event semantics and can **corrupt** batch **delta** watermarks if event micro-runs advance `lastSync` without reading the same slice as a normal delta.

ADR 0008 [G4](0008-multi-source-into-one-entity.md#capability-gap-inventory-vs-gregorwolfcap-replication-demo) proposed a v2 `MessagingAdapter` and `source.kind: 'messaging'`. This ADR replaces that *shape* for the first shippable increment with a design that **reuses the same `Pipelines` row and phase machine** (START → READ → MAP_BATCH → WRITE_BATCH → DONE) so that **event-driven** upserts are **observable in the same scope** as batch runs and reuse **`viewMapping`**, [targets](../docs/guide/targets/db.md), and [hooks](../docs/reference/management-service.md#event-hooks).

## Decision summary

- **Primary entry point:** extend [`DataPipelineService#execute`](../srv/DataPipelineService.js) with an optional **nested** `event` object for event **micro-runs**. The public verb stays **`execute`** — no separate `handleEvent` / `ingestEvent` as the only way in.
- **Alias:** **`executeEvent(name, opts)`** — a **thin** wrapper that defaults to `trigger: 'event'`, and for the common case `event.action: 'upsert'`, while forwarding **`async`** and **`engine`** exactly like `execute` (see [Async and sync](#async-and-sync)).
- **Naming — run `mode` vs read strategy:** the **top-level** `mode` on `execute` remains the **pipeline run mode** (`'delta' | 'full'` for batch-style runs) as today. **Do not** overload it for “key vs payload”. Use the nested field **`event.read: 'key' | 'payload'`** for how the engine obtains source rows in an event micro-run.
- **Read strategies** (see [Read strategies and action](#read-strategies-and-action-normative)):
  - **`event.read: 'key'`** — message or options supply key(s); the engine **fetches** source row(s) with a one-shot CQN/OData read against `source.entity`, **and**-combined with the same **static** filter as batch (see [Static scope](#static-scope-organizational--tenant-filters)).
  - **`event.read: 'payload'`** — `event.payload` (or similar) supplies source-shaped data; READ yields a **synthetic** batch; no follow-up read to the remote. Optional `mapPayload` in config to normalize the envelope.
- **Write intent:** **`event.action: 'upsert' | 'delete'`** — separates *how* rows are read from *what* happens on the target. **Delete** requires a dedicated DELETE path in the target adapter (not only UPSERT). **`action: 'delete'`** is expected with **`read: 'key'`** and `keys` (tombstone / row removal by key); payload-driven deletes are out of scope for v1 unless specified later.
- **Watermark policy** — by default, successful **event** runs **do not** update `Pipelines.lastSync` or `lastKey` used for **batch** delta. Exact `trigger` / flag rules in implementation. Rolling **cumulative** statistics on `Pipelines` from event runs are **optional** (config flag); at minimum, **per-run** statistics stay on `PipelineRuns`.
- **Query-shape (materialize) pipelines** — **out of scope for v1** of this ADR: validation should reject an event `execute` (or `source.event` config, when added) when `source.query` is present, unless a later ADR extends the model.
- **Subscription wiring** — v1 is **API-first**: the application registers `messaging.on(...)` (or in-process `Service.on`) and calls **`execute(..., { trigger: 'event', event: { ... } })`** or **`executeEvent`**. **Optional** later: declarative `source.event.topic` and automatic registration in `cds.on('served', …)`.
- **Optional HTTP** — exposing event ingestion on the management OData service is **out of scope for v1** unless paired with a strong **auth** story (unauthenticated `ingest` would be a data plane hole).

## Problem statement (today)

| Issue | Detail |
|--------|--------|
| No key / payload path | `execute` has no `event` object; READ always runs full `readStream(tracker)` for the batch adapter. |
| Watermark | Every successful run updates `lastSync`; event micro-runs must not, by default. |
| Duplication | Application reimplements `viewMapping` and UPSERT in `messaging.on` to match batch. |
| Observability | Ad hoc handlers do not produce `PipelineRuns` in the same way as `execute`. |

## Read strategies and action (normative)

| Dimension | Values | Role |
|------------|--------|------|
| **`event.read`** | `key` \| `payload` | How the READ phase **obtains** source-shaped rows. **Not** the same as run **`mode`** (`delta` / `full`). |
| **`event.action`** | `upsert` \| `delete` | **Upsert** — MAP/WRITE as today (default DB path: UPSERT). **Delete** — remove target row(s) by key (implementation must supply DELETE semantics, including [sourced](../db/index.cds) compound keys if applicable). |
| **`event.keys`** | object | Key predicate for **`read: 'key'`** — field names in the **source** (remote) shape **before** MAP (see [Keys semantics](#keys-semantics)). |
| **`event.payload`** | object \| object[] | Source-shaped row(s) for **`read: 'payload'`** (after any configured `mapPayload`). |

- **A — Key / notification** (`read: 'key'`) — one-shot read from `source.service` and `source.entity` with `keys` **and** the same static filter as batch ([Static scope](#static-scope-organizational--tenant-filters)).
- **B — Full payload** (`read: 'payload'`) — no remote entity read; READ yields one batch from `payload` / message body.

A future extension may support **multiple payloads** in one micro-run; v1 is **at least** one batch / one or more rows in that batch.

**Example (subscription + execute):** same pipeline name as batch; event handlers only pass keys or payload; static scope is not duplicated in JS — it lives in CDS / `viewMapping.staticWhere`.

```javascript
logisticsService.on('shipments.updated', async (event) => {
  const { shipmentId } = event.data
  await pipelines.execute('Shipments', {
    trigger: 'event',
    event: { read: 'key', action: 'upsert', keys: { ID: shipmentId } }
  })
})
```

(Replace `ID` / field names with the **actual** primary key fields of `source.entity`.)

## Public API contract (normative)

### `execute` extension

- **Shape (conceptual):**

  ```text
  execute(name, {
    mode?,                    // run mode: 'delta' | 'full' — NOT key vs payload
    trigger: 'event',         // required for event path; sets PipelineRuns.trigger
    event: {
      read: 'key' | 'payload',
      action?: 'upsert' | 'delete',  // default 'upsert' for micro-runs
      keys?: Record<string, unknown>,
      payload?: object | object[],
      message?: <CAP msg>,    // optional: raw message for id / tracing / mapPayload
    },
    async?,                   // same as today
    engine?,                  // same as today ('spawn' | 'queued' when async)
  })
  ```

- **Return value:** same as synchronous `execute` today (`{ runId, name, done? }` / statistics semantics as implemented).
- **True event ingestion** (key or payload) **must** go through an **`event` object** so the engine does **not** run the full `readStream(tracker)` batch path for the same call.

`POST /pipeline/execute` with **`trigger: 'event'`** but **no** structured **`event` payload** remains **at best a dev / smoke-test** label-only path; for production events, use **programmatic** `execute` with `event: { read, action, ... }` (or `executeEvent`). Document as **deprecated** for real event semantics once the extension ships.

### `executeEvent` alias

- **`executeEvent(name, opts)`** — convenience for the common case, e.g.:

  - Sets **`trigger: 'event'`** by default.
  - Defaults **`event.action`** to **`'upsert'`** if omitted.
  - Forwards **`async`**, **`engine`**, and nested **`event`** the same as **`execute`**.

- Implementation is **`return this.execute(name, { ...defaults, ...opts })`**.

### Async and sync

- **No** new public methods **`executeSync` / `executeAsync`**. The existing **`async: true | false`** and **`engine: 'spawn' | 'queued'`** on `execute` (and on `executeEvent` forwards) remain the only sync/async control surface, aligned with [DataPipelineService#execute](../srv/DataPipelineService.js) today.

## Naming collision: `mode` vs `read`

- **`mode`** (top-level) = **replication / run** mode for batch-style execution (`'delta' | 'full'` in current API).
- **`event.read`** = **strategic** read path for the event micro-run (`'key' | 'payload'`).

Using **`mode: 'key'`** at the top level is **rejected** by this ADR: it would collide with run `mode` and confuse callers and the OpenAPI/ OData surface if extended.

## Static scope (organizational / tenant filters)

Batch and event **key** reads **must** apply the same **static** predicate to the same logical source entity:

- **Inferred from the target** — when `viewMapping` is omitted, [`_inferViewMappingIfMissing`](../srv/DataPipelineService.js) uses [`extractViewMappingFromEntityDef`](../srv/lib/extractViewMappingFromEntity.js) to copy **`staticWhere`** from the consumption **projection**’s `where` in CDS.
- **Explicit** — if `viewMapping` is provided manually, include **`viewMapping.staticWhere`** (CQN `where` xpr array) so [ODataAdapter](../srv/adapters/ODataAdapter.js) / [CqnAdapter](../srv/adapters/CqnAdapter.js) continue to [mergeStaticWhereIntoSelect](../srv/lib/mergeStaticWhereIntoSelect.js) into the one-shot `SELECT` for event **`read: 'key'`** the same way as for batch `SELECT.from(source.entity)`.

**Rule of thumb:** one CDS `where` on the consumption projection (or one explicit `staticWhere`) — not a duplicate “filter string” in `addPipeline` for events only.

## Keys semantics

- **`event.keys`** uses **source-side** (remote / OData / CQN) field names, consistent with a one-shot `SELECT` **on `source.entity`** before MAP.
- Application events may carry **business** identifiers (`shipmentId`, `orderId`, S/4 `BusinessPartner`, …) that are **not** the primary key of `source.entity`. Callers (or a future `keyPath` / mapping in `source.event` config) must supply the correct **key element names and values** for the connected model — this ADR does not mandate automatic remapping from arbitrary payload shapes.

## Engine behavior

- Reuse `Pipeline._deltaSync`’s **iterator** (MAP/WRITE per batch) but not necessarily the same **default READ** handler: READ must set `sourceStream` to an **async iterable** that **yields a small number of batches** (usually one) and then completes.
- Reuse the same default **MAP_BATCH** and **WRITE_BATCH** (and user hooks) as batch runs for **`action: 'upsert'`**; **DELETE** is a **separate** WRITE or target-adapter code path.
- **PIPELINE.START** / **PIPELINE.DONE** payloads should allow hooks to see `trigger === 'event'` and optional **message** / correlation fields.
- `Pipeline._makeReq` / `currentRunId` — same as today for correlation.

## Concurrency and ordering

- Today `Pipeline._run` **refuses a second start** if the tracker is already `status: 'running'`. For **event** bursts, a policy is required, e.g.:
  - **Queue** (serialize event micro-runs per pipeline), or
  - **Allow parallel** event runs (risk: duplicate UPSERT / ordering), or
  - **Drop** with log when a **batch** run is in progress.
- This ADR **defers the default** to the implementation; the chosen default must be **documented** and **tested** (e.g. “event runs are queued on a per-pipeline in-memory or persistent queue in v1”).

## Persistence

- **Extend `PipelineRuns`** with optional event metadata, e.g. one of:
  - `eventId`, `eventType`, `messageId`, and/or
  - a **single** `eventContext: LargeString` (JSON) for CloudEvents + traceparent.
- **Migration** — consumers that deploy the plugin’s DB must run schema update (documented in changelog).

## Non-goals

- **Log-based CDC** (Debezium, DB redo logs) — still out of scope; polling delta remains the batch story.
- **Guaranteed once-only** processing of the same `messageId` at the engine level — **at-least-once** is assumed; idempotent **UPSERT** and optional **app-level deduplication** are the consumer’s responsibility. Optional future: store message IDs in a small dedupe table.
- **Obligatory** plugin-managed subscription to Event Mesh / no code in `srv` — v1 is API-first; declarative topics are optional later.
- **Event-driven query-shape (aggregate) refresh** without a separate design.
- **Automatic fan-out** of one message to N pipelines — the app may call `execute` with `trigger: 'event'` N times or this may be a later convenience.
- **Separate** `handleEvent` as the **only** public method name — the **contract** is **`execute` + `event`**, with optional `executeEvent` alias (see [Public API contract](#public-api-contract-normative)).

## Relationship to ADR 0008 §“v2 — Messaging / CDC”

ADR 0008 listed:

> `srv/adapters/MessagingAdapter.js` + factory routing for `source.kind: 'messaging'`.

This ADR **supersedes that deliverable** for the **first** release of event support: a **`execute` extension** (nested `event` object) + optional **`executeEvent`**, **not** a standalone `readStream` that blocks on a message bus, and not **`handleEvent`** as the only user-facing name. A future `kind: 'messaging'` could still wrap the same **internals** if needed. **Update ADR 0008’s G4 / v2 text** to reference ADR 0009 when this ships (already partially aligned).

## Acceptance criteria (when implemented)

- `execute` with `trigger: 'event'` and a structured **`event`** object creates a `PipelineRun` with `trigger: 'event'` and optional correlation metadata.
- **`executeEvent`** delegates to `execute` with the documented defaults; forwards **`async` / `engine`**.
- Default: successful event runs **do not** change `Pipelines.lastSync` / `lastKey` used for **batch** delta; batch `execute` without `event` unchanged.
- **`event.read: 'key'`** performs a **one-shot** read from `source.service` and applies **`staticWhere`**; **`event.read: 'payload'`** does not issue that read.
- **`event.action: 'delete'`** removes or marks deleted rows as specified by the target adapter; **`upsert`** uses the same MAP/WRITE path as batch.
- `addPipeline` / `execute` validation rejects **entity-shape violations** for **query-shape** (`source.query`) in v1 for event path.
- **Documentation**: new recipe (event + batch, `read` vs `mode`, `action`, static scope, watermark), **Management service** note (programmatic `execute` primary; optional HTTP later).
- **Tests**: unit (watermark, validation, `mode` / `read` not conflated); integration (in-process `execute` with `trigger: 'event'` and mock `event` payload, no Event Mesh required).

## References

- [db/index.cds](../db/index.cds) — `RunTrigger`, `PipelineRuns`.
- [srv/lib/Pipeline.js](../srv/lib/Pipeline.js) — `_run`, `_deltaSync`, READ/MAP/WRITE, `lastSync` update.
- [srv/DataPipelineService.js](../srv/DataPipelineService.js) — `execute`, `addPipeline`, `_validateConfig`, `_inferViewMappingIfMissing`.
- [srv/lib/extractViewMappingFromEntity.js](../srv/lib/extractViewMappingFromEntity.js) — `staticWhere` from consumption projection.
- [srv/lib/mergeStaticWhereIntoSelect.js](../srv/lib/mergeStaticWhereIntoSelect.js) — AND static filter into CQN.
- [srv/adapters/ODataAdapter.js](../srv/adapters/ODataAdapter.js), [srv/adapters/CqnAdapter.js](../srv/adapters/CqnAdapter.js) — use `viewMapping.staticWhere`.
- [decisions/0008-multi-source-into-one-entity.md](0008-multi-source-into-one-entity.md) — G4, gregorwolf demo.
- [docs/guide/sources/custom.md](../docs/guide/sources/custom.md) — `readStream(tracker)` contract (batch model).
- CAP: [Core eventing](https://cap.cloud.sap/docs/guides/events/core-concepts), [Messaging](https://cap.cloud.sap/docs/guides/messaging) (in-process and remote).
