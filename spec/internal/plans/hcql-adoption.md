# HCQL adoption — implementation plan

**Date:** 2026-07-04  
**Status:** Implemented (Phases 1–4; Phase 5 spike documented, remote materialize deferred)  
**Input:** [HCQL evaluation](../research/hcql-evaluation.md), [ADR 0011](../decisions/0011-cds-9-10-dual-compatibility.md), [Req §1.5 / §4.1.3 / §4.6.3](../../reference/requirements.md)  
**Pre-release note:** Plugin is unreleased — adapter renames and factory routing changes are allowed without deprecation shims.

## Goal

1. **Consolidate** duplicated CQN read logic across source adapters; rename misleading `ODataAdapter` to reflect actual behaviour (CQN over CAP `RemoteService`, wire protocol chosen by CAP).
2. **Prove** HCQL end-to-end for federation delegate + replicate (flatten associations, Req 4.1.3).
3. **Document** protocol differences and when each adapter applies — no dedicated `HcqlAdapter` unless a concrete gap appears in tests.

## Non-goals

- Exposing `@hcql` on plugin management services (MCP ops use case — out of scope).
- HCQL for materialization query-shape against remote sources in v1 (see [Remote materialize over HCQL — spike criteria](#remote-materialize-over-hcql--spike-criteria); stage-then-aggregate remains the default pattern).
- Forcing HCQL when CAP auto-selection already works (`remote.run(query)` path).
- Target-side HCQL write protocol (HCQL beta is read-focused; `ODataTargetAdapter` stays CQN→CAP for now).

---

## Adapter landscape — what is actually different?

All three source adapters share the `BaseSourceAdapter.readStream(tracker)` contract. They diverge on **wire protocol**, **read shapes**, and **delta/pagination semantics**.

| Dimension | `RestAdapter` | `RemoteCqnAdapter` *(rename of `ODataAdapter`)* | `CqnAdapter` |
|---|---|---|---|
| **When selected** | `source.kind: 'rest'` or remote `kind: 'rest'` | Remote CAP service: `odata`, `odata-v2`, `hcql` (auto or explicit) | Local DB / in-process CAP / explicit `source.kind: 'cqn'` |
| **Wire protocol** | Raw HTTP (`service.send({ method, path })`) | CQN → `service.run(query)` → CAP translates to **OData V4, OData V2, or HCQL** (CAP negotiates; plugin does not pick) | CQN → `service.run(query)` (same API, typically in-process or DB driver) |
| **Query language** | None — JSON path extraction (`rest.dataPath`) | CQN `SELECT` built from `source.entity` + view mapping | CQN `SELECT` from entity **or** user `source.query(tracker)` closure |
| **Read shapes** | Entity-shape only | Entity-shape only | Entity-shape **and** query-shape (aggregates / snapshots) |
| **Pagination** | REST params: `page` / `offset` / `cursor` | CQN `.limit(batchSize, skip)` loop | Same CQN loop (entity-shape); query-shape = single shot |
| **View mapping** | Not applied at READ (MAP phase only) | `projectedColumns`, `staticWhere` merged into SELECT | Same |
| **Delta modes** | `rest.deltaParam` → query param | `timestamp`, `key`, `datetime-fields` (OData string fragment), `none` | `timestamp`, `key` only |
| **Protocol-specific quirks** | Pagination config, headers, method | **OData V2:** truncate ISO timestamp (`slice(0,-1)`) for delta filter | Standard ISO timestamps; no V2 quirk |
| **Retry / batch tuning** | `source.maxRetries`, `source.delay` | Same | Same |

### HCQL vs OData in practice

From the plugin's perspective **HCQL and OData are identical**: both are reached via `this.service.run(cqnSelect)`. CAP's remote client prefers HCQL when the provider serves `@hcql @odata`. The plugin never serializes `$select` or HCQL JSON itself.

**Implication:** Do **not** add `HcqlAdapter`. Route `kind: 'hcql'` to the same class as `odata` / `odata-v2`. The only HCQL-specific work is:

- Provider fixtures that serve `@hcql`.
- View-mapping fixes for flattened columns (CQN path expressions HCQL can express; OData cannot).
- Delta timestamp test (confirm V2 truncation is **not** applied when wire is HCQL).

### Target adapters (brief)

| Adapter | Role | HCQL |
|---|---|---|
| `DbTargetAdapter` | Local SQL via CQN | N/A |
| `ODataTargetAdapter` | Remote writes via CQN → CAP | Reads may use HCQL; writes stay CAP-managed. Optional rename to `RemoteCqnTargetAdapter` for naming symmetry — **low priority**, same class. |

---

## Recommended architecture

### 1. Extract shared entity-shape read loop

**Problem:** `ODataAdapter._readStream` and `CqnAdapter._readEntityShape` are ~80% duplicate (SELECT build, view mapping, delta WHERE, pagination, retry).

**Solution:** New module `packages/cds-data-pipeline/srv/adapters/lib/entityShapeReadStream.js`:

```javascript
async function* entityShapeReadStream({ service, config, buildDeltaFilter, LOG })
```

Responsibilities:

- Build `SELECT.from(entity)` + columns + delta WHERE + `mergeStaticWhereIntoSelect`.
- Paginate with `.limit(batchSize, skip)`.
- **`hasMore = batch.length >= batchSize`** (fix: current `ODataAdapter` sets `hasMore = true` whenever any rows returned — incorrect for partial last page edge cases on fixed-size remotes).
- `withRetry` wrapper (shared retry predicate).

Inject `buildDeltaFilter(delta, tracker, service)` so protocol-specific delta stays in the subclass/module.

### 2. Rename `ODataAdapter` → `RemoteCqnAdapter`

| Old | New |
|---|---|
| `srv/adapters/ODataAdapter.js` | `srv/adapters/RemoteCqnAdapter.js` |
| Factory / log strings `ODataAdapter` | `RemoteCqnAdapter` |
| `docs/pipeline/guide/sources/odata.md` | Rename or retitle **Remote CQN sources (OData V2/V4 & HCQL)** — keep `odata.md` as redirect/alias if external links exist |

`RemoteCqnAdapter` extends `BaseSourceAdapter`, delegates entity-shape to `entityShapeReadStream`, implements:

- `_buildDeltaFilter` with `mode: 'none'`, `datetime-fields`, OData V2 timestamp truncation (gate on `service.options?.kind === 'odata-v2'`, **not** on `hcql`).

### 3. Slim `CqnAdapter`

- Entity-shape: call shared `entityShapeReadStream` with local delta builder (timestamp + key only).
- Query-shape: keep `_readQueryShape` as-is (unique to `CqnAdapter`).

### 4. Keep `RestAdapter` separate

No shared code with CQN adapters beyond `BaseSourceAdapter` and `withRetry`. REST is a different transport (no `SELECT`, no view mapping at READ).

### 5. Factory routing (`srv/adapters/factory.js`)

```javascript
// Explicit source.kind
'cqn'     → CqnAdapter
'rest'    → RestAdapter
'odata' | 'odata-v2' | 'hcql' → RemoteCqnAdapter

// Auto-detect from connected service
switch (remote.options?.kind || remote.kind) {
  case 'odata':
  case 'odata-v2':
  case 'hcql':
    return new RemoteCqnAdapter(remote, config)
  case 'rest':
    return new RestAdapter(remote, config)
  default:
    // Pre-release: prefer RemoteCqnAdapter for unknown remote kinds (ADR 0004 intent)
    // Log at debug; document that custom remotes should set source.kind explicitly
}
```

Update `VALID_SOURCE_KINDS` in `DataPipelineService.js`: add `'hcql'`.

### 6. Federation: flatten associations (Req 4.1.3)

**Scanner gap:** `extractViewMapping()` and `extractViewMappingFromEntity()` only read `col.ref[0]`, dropping `customer.name` paths.

**Fix (shared helper):** `packages/cds-data-pipeline/srv/lib/columnRefPath.js` (or federation re-export):

```javascript
function columnRefToRemotePath(col) {
  // { ref: ['customer', 'name'], as: 'buyerName' } → path + CQN column spec
}
```

Update both:

- `packages/cds-data-federation/srv/annotation-scanner.js`
- `packages/cds-data-pipeline/srv/lib/extractViewMappingFromEntity.js`

For flattened columns, `projectedColumns` should store CQN column descriptors (multi-segment `ref`), not bare string names. `RemoteCqnAdapter` already passes them to `.columns(...)` — CAP/HCQL handles path expressions when the wire protocol supports them.

**Expand helpers:** Audit `buildInnerColumns` in `expand-local-to-remote.js` for the same `ref[0]` assumption.

---

## Remote materialize over HCQL — spike criteria

This section records why `@materialize.snapshot` rejects remote aggregate sources today, what HCQL does and does **not** change, and how to re-evaluate without conflating federation replicate with materialization.

### Two different “projection on remote” shapes

| Pattern | Plugin | Pipeline shape | Remote `cds.requires` in v1 |
|---|---|---|---|
| `@federation.replicate` / `@federation.delegate` on `projection on remote.X` | `cds-data-federation` | **Entity-shape** — paginated row copy | Allowed (`RemoteCqnAdapter` / CAP client) |
| `@materialize.snapshot` on `projection on remote.X { … } group by …` | `cds-data-materialization` | **Query-shape** — single-shot `SELECT` with aggregates | **Rejected** at scan (`assertCqnNativeSource`) |

HCQL helps the first row automatically when the provider serves `@hcql`. The second row is blocked **before** HCQL is considered: the materialization scanner rejects `kind: odata | odata-v2 | rest` ([ADR 0009](../decisions/0009-cds-data-materialization-plugin.md) compiler subset).

### Why v1 rejected remote materialization (not “projections are local-only”)

1. **CAP remote aggregation is unproven here.** Skipped federation tests document `Feature not supported: SELECT statement with .groupBy` when `$apply` / `.groupBy()` targets a remote-connected service. The sales-intel workbench replicates `SalesOrders` specifically because delegate cannot serve `$apply/groupby`. HCQL evaluation did **not** claim remote `GROUP BY` works — only that HCQL may enable **flatten / path expressions** in entity-shape SELECT (Req 4.1.3).

2. **Stage-then-aggregate is intentional product design** ([`docs/materialization/concepts/stage-then-aggregate.md`](../../../docs/materialization/concepts/stage-then-aggregate.md)):
   - Frozen snapshot semantics (totals at run time, not live remote drift mid-aggregate)
   - Local SQL after replicate (joins, `$apply`, `DISTINCT`, offline)
   - Reduced load on remote systems (heavy `GROUP BY` on a schedule)

3. **v1 scope cut.** ADR 0009 lists “OData/REST `requires` kind as aggregate source” in the rejected-at-scan table to avoid depending on beta HCQL read-subset semantics without an end-to-end proof.

### What HCQL does vs does not unlock for materialization

| CQN feature | OData remote | HCQL remote (CAP-to-CAP) | `@materialize.snapshot` needs |
|---|---|---|---|
| Flatten / path expressions (`customer.name`) | No | Likely yes (xflights) | No — entity-shape, not materialize |
| Top-level `GROUP BY` + aggregates | No (CAP rejects) | **Unknown — not proven in this repo** | **Yes — core of materialize compiler** |
| Joins / subqueries in source | No | Unclear (read subset) | Not in v1 compiler anyway |

HCQL is “fuller CQN on the wire” **relative to OData** (denormalized SELECT, path expressions). That is **not** the same as “remote aggregate materialization works.” Those require separate validation.

### Spike scope (optional Phase E — after Phases 1–4)

**Goal:** Determine whether CAP 10 allows `service.run(SELECT … groupBy …)` against an `@hcql` provider, independent of the materialization annotation layer.

**Preconditions:** HCQL provider fixture from Phase A; `RemoteCqnAdapter` rename from Phase 1.

**Spike steps:**

1. **Programmatic engine test** (bypass `cds-data-materialization` scanner):

   ```javascript
   await pipelineService.addPipeline({
     name: '__hcql_remote_aggregate_spike',
     source: {
       service: 'ProviderService', // provider serves @hcql @odata
       query: () => SELECT.from('ProviderService.Orders')
         .columns('customer_ID as customerId', { func: 'sum', args: [{ ref: ['amount'] }], as: 'total' })
         .groupBy('customer_ID'),
     },
     target: { entity: 'consumer.RemoteDailyRevenue' },
     refresh: 'full',
   })
   ```

2. **Assert wire protocol** where feasible (request path contains `/hcql/` or CAP debug log).

3. **Compare outcomes:**

   | Outcome | Action |
   |---|---|
   | Green — aggregate rows land in local target | Document as **experimental** CAP-to-CAP option; consider relaxing `assertCqnNativeSource` for `hcql` only |
   | Red — same `.groupBy` rejection as OData | Keep v1 rejection; update [`hcql-evaluation.md`](../research/hcql-evaluation.md) with explicit “remote aggregate not supported” |
   | Red — provider executes but wrong/partial results | File CAP issue; do not relax scanner |

**If spike is green — minimal plugin follow-up (separate PR / ADR):**

- Extend `NON_CQN_SOURCE_KINDS` logic: allow `hcql` (or CAP auto-selected HCQL when provider serves `@hcql`) in `assertCqnNativeSource`.
- Materialization `pipeline-binding`: stop forcing `source.kind: 'cqn'` when source is a remote HCQL service — route via factory to `RemoteCqnAdapter` / shared query-shape path on remote connection.
- Requirements: new row or amend M-5 — “remote aggregate source (HCQL CAP-to-CAP only)” with **stage-then-aggregate still recommended**.
- Docs: [`stage-then-aggregate.md`](../../../docs/materialization/concepts/stage-then-aggregate.md) — add “when remote HCQL aggregate is acceptable” vs default pattern.

**If spike is green — still keep as non-default because:**

- Snapshot stability and local join story remain better with replicate-first.
- HCQL read subset is beta; OData-only remotes must keep failing loudly.
- Partial refresh / cross-entity aggregates remain out of scope.

**Exit criteria for Phase E:**

- One integration test: programmatic remote aggregate pipeline against `@hcql` fixture **or** documented CAP rejection with issue link.
- [`hcql-evaluation.md`](../research/hcql-evaluation.md) materialization paragraph updated to reference this spike result.
- No change to `@materialize.snapshot` annotation surface until spike is green **and** ADR/amendment records the relaxed rule.

---

## Test strategy

### Phase A — HCQL provider fixture

| File | Change |
|---|---|
| `packages/cds-data-federation/test/fixtures/provider/srv/provider-service.cds` | Add `@hcql` on `ProviderService` (alongside existing OData — mirror xflights/xtravels) |
| `packages/cds-data-federation/test/fixtures/consumer/package.json` | Add `ProviderServiceHcql` requires entry **or** document that `@hcql` on provider + `kind: odata` consumer binding is enough for CAP negotiation (verify which) |
| `packages/cds-data-pipeline/test/fixtures/provider/` | Mirror `@hcql` if pipeline tests need it |

**Spike task:** Confirm CAP 10 auto-selects HCQL with consumer `kind: odata` + provider `@hcql`. If not, consumer binding needs dual protocol config per CAP docs.

### Phase B — Adapter consolidation (no behaviour change intended)

| Test | Purpose |
|---|---|
| Existing `odata-adapter.test.js` | Rename → `remote-cqn-adapter.test.js`; green after refactor |
| Existing `cqn-adapter` / integration tests | Green |
| New unit: pagination termination | Last page `< batchSize` stops loop (regression for ODataAdapter bug) |
| New unit: delta V2 vs HCQL | Mock `service.options.kind`; V2 truncates timestamp, `hcql` does not |

### Phase C — Flatten associations

| Test | Action |
|---|---|
| `[4.1.3]` consumption-views `OrderFlat` | Unskip when HCQL fixture green |
| New replicate test | `@federation.replicate` on `OrderFlat` → local table has `buyerName`, `itemName` |
| Unit: `extractViewMapping` | Multi-segment refs → correct `projectedColumns` / rename maps |

Keep **skipped** OData-only variant (or separate describe block) documenting that flatten still fails when remote is OData-only — status string in requirements becomes conditional.

### Phase D — Delta sync over HCQL

| Test | Purpose |
|---|---|
| Pipeline integration | Delta timestamp replicate CAP-to-CAP with HCQL provider; verify rows incrementally synced |

### Phase E — Remote materialize spike (optional, after A–D)

| Test | Purpose |
|---|---|
| Programmatic `source.query` + `groupBy` against `@hcql` provider | Prove or disprove remote aggregate materialization (see [spike criteria](#remote-materialize-over-hcql--spike-criteria)) |
| OData-only control | Same query against OData-only provider — expect CAP rejection (baseline) |

---

## Documentation updates

| Surface | Change |
|---|---|
| `docs/pipeline/guide/sources/odata.md` | Retitle; lead with "Remote CQN (OData & HCQL via CAP)"; table lists `hcql` → `RemoteCqnAdapter` |
| `docs/pipeline/guide/sources/index.md` | Adapter name column |
| `docs/federation/concepts/consumption-views.md` | Flatten associations: supported with HCQL remote, not OData-only |
| `spec/reference/requirements.md` | §4.1.3 status → "Implemented (HCQL remote)" with OData caveat; §4.6.5 factory text |
| `packages/cds-data-pipeline/CLAUDE.md` | Adapter list |
| Optional ADR | `0012-remote-cqn-adapter-rename.md` if we want a paper trail (short — mostly naming) |

---

## Implementation phases (ordered)

### Phase 1 — Refactor without feature change (~1 PR)

1. Add `entityShapeReadStream.js` + unit tests.
2. Rename `ODataAdapter` → `RemoteCqnAdapter`; wire factory + `VALID_SOURCE_KINDS` + logs.
3. Refactor `CqnAdapter` entity-shape to shared module.
4. Fix pagination `hasMore` in shared module.
5. Rename test files / update AGENTS.md / CLAUDE.md.
6. Full `npm test` (all three packages).

**Exit criteria:** Zero intentional behaviour change; all existing tests green.

### Phase 2 — HCQL fixture + proof (~1 PR)

1. `@hcql` on federation provider fixture; verify protocol in test setup (log or assert request path if feasible).
2. Spike: delegate `GET OrderFlat` — unskip if green.
3. Document consumer `cds.requires` pattern for HCQL in federation guide.

**Exit criteria:** One delegate integration test proves HCQL path; research doc "recommended next steps" item 1 done.

### Phase 3 — Flatten view mapping (~1 PR)

1. Shared `columnRefPath` helper; update both extractors + federation expand builder.
2. Unit tests for multi-segment refs.
3. Replicate integration test for `OrderFlat`.
4. Update Req 4.1.3 + run `npm run sync:requirements`.

**Exit criteria:** `[4.1.3]` tests pass against HCQL fixture; OData-only limitation documented.

### Phase 4 — Delta + docs polish (~0.5 PR)

1. HCQL delta timestamp test.
2. Publish doc renames / cross-links.
3. Close loop on `hcql-evaluation.md` → mark research items done or superseded by this plan.

### Phase 5 — Remote materialize spike (optional, ~0.5 PR)

1. Run Phase E spike (programmatic `groupBy` against `@hcql` provider).
2. Update `hcql-evaluation.md` and this plan with result.
3. Only if green: draft ADR amendment + relax `assertCqnNativeSource` for `hcql` (separate PR).

**Exit criteria:** Spike result documented; no annotation-surface change unless green + ADR.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| HCQL beta API drift | No HCQL-specific APIs in plugin; only CQN + CAP client |
| Consumer `kind: odata-v2` blocks HCQL | Document: provider `@hcql`, consumer `kind: odata` (V4) for CAP-to-CAP federation |
| Flatten works in delegate but not replicate | Separate tests; replicate uses same `RemoteCqnAdapter` + fixed view mapping |
| ADR 0004 "unknown → CqnAdapter" vs current "unknown → OData" | Pre-release: adopt ADR 0004 default (`CqnAdapter` for unknown **local** kinds, `RemoteCqnAdapter` for connected remotes) — clarify in factory comment |
| Rename churn in examples/README | Grep `ODataAdapter`; update in same PR as rename |

---

## Affected files (summary)

| Package | Files |
|---|---|
| **cds-data-pipeline** | `srv/adapters/ODataAdapter.js` → `RemoteCqnAdapter.js`, `CqnAdapter.js`, `factory.js`, `adapters/lib/entityShapeReadStream.js`, `DataPipelineService.js`, `extractViewMappingFromEntity.js`, tests, docs |
| **cds-data-federation** | `annotation-scanner.js`, `expand-local-to-remote.js`, provider fixture, consumption-views tests, docs |
| **cds-data-materialization** | None in Phases 1–4; Phase E may touch `annotation-scanner.js` + `pipeline-binding.js` if remote aggregate spike is green |
| **spec** | `requirements.md`, optional ADR, `hcql-evaluation.md` status line |

---

## Validation commands

```bash
npm test                                    # full monorepo serial suite
npm test -w cds-data-pipeline -- --grep remote-cqn
npm test -w cds-data-federation -- --grep OrderFlat
npm run lint
npm run sync:requirements                 # after Req 4.1.3 status change
```

---

## Decision log (for optional ADR 0012)

- **No `HcqlAdapter` class** — HCQL is a CAP wire protocol, not a plugin concern.
- **`RemoteCqnAdapter`** — name reflects "CQN dispatched to a remote CAP service"; OData/HCQL are implementation details of CAP.
- **`CqnAdapter`** — name reflects "CQN to local or query-shape sources"; not used for typical OData/HCQL remotes unless explicitly `source.kind: 'cqn'`.
- **`RestAdapter`** — remains the only non-CQN source adapter.
