# 4. Scope Req 4.6.3 (CQN adapter) to `cds-data-replication`

**Date:** 2026-04-19
**Status:** Superseded by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md)

> **Supersession note ([ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md), 2026-04-19).** The scoping decision recorded here — CQN adapter belongs in the engine package, not the annotation layer — is **preserved**. The engine package is renamed `cds-data-replication` → **`cds-data-pipeline`**; wherever this ADR says "cds-data-replication", read "cds-data-pipeline".
>
> The two use cases now map cleanly onto the kind taxonomy introduced by [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md):
>
> - **Use case 1 (aggregated rollup / `DailyCustomerRevenue`)** is **`kind: 'materialize'`**. The `source.query` escape hatch is re-legitimized as a *defining feature of the materialize kind* — not a general escape from the consumption-view contract. `GROUP BY` / `SUM` / derived columns / full-refresh semantics belong here by design.
> - **Use case 2 (secondary-DB replication over CQL)** is **`kind: 'replicate'`**. Consumption-view contract unchanged. `source.query` is **not** offered for `kind: 'replicate'` — the consumption-view projection is the schema.
>
> Per-kind validation ([ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) §"The kind taxonomy") enforces this at `addPipeline` registration time. The CQN adapter itself is still the single adapter implementing the CQN source protocol — it is the `kind` that decides the semantics layered on top.

## Context

Requirement 4.6.3 ([`spec/reference/requirements.md`](../../reference/requirements.md) §4.6 Source Adapters) has stood as "Not started / P1" since Phase 5:

> **CQN adapter** — replicate from other CAP services or databases using CQL queries.

The original framing left the use cases implicit. A concrete walkthrough surfaced two candidate scenarios:

1. **Pre-aggregated / rolled-up materialization** — e.g. nightly `SELECT customer_id, SUM(amount) GROUP BY customer_id FROM Orders` snapshotted into a `DailyCustomerRevenue` table. The existing `ODataAdapter` cannot run this against a remote OData source (CAP rejects `.groupBy` for OData — see the Query Capability Matrix in [`requirements.md`](../../reference/requirements.md) §4.2 "$apply (aggregation): No"). A CDS view doesn't solve it either — a view doesn't persist the snapshot.
2. **Secondary / legacy database replication** — a reporting PostgreSQL, a side HANA for archived data, or a CAP-wrapped legacy DB via `@sap/cds-dbs`, exposed as a `cds.requires` entry with a CQN-native `kind`. No OData front end, no REST API — CQL is the only protocol.

The question: does 4.6.3 belong in the federation plugin at all?

### Tested against the terminology

Per [`spec/concepts/terminology.md`](../../concepts/terminology.md):

> "Federation means: integrating remote service models into the consumer's data model and providing strategies for how that remote data is accessed at runtime."

Running each use case through that definition:

| Use case | Remote service model? | Integrated into consumer's model? | Federation? |
|---|---|---|---|
| **1 — Pre-aggregated rollup from in-process `SalesService`** | No — same app, same process, same CAP runtime, arguably the same database | The source already *is* the consumer's model; we're snapshotting a derivation of it | **No.** This is materialization, not federation. |
| **2 — Replicate from a secondary PostgreSQL / side HANA** | Yes — distinct system, separate connection, own model namespace | Yes — brought into consumer's namespace via a consumption view | **Yes.** Multi-source consolidation, [`requirements.md`](../../reference/requirements.md) §2. |

Use case 1 fails the federation test cleanly. No remote boundary, no foreign model — it's materialized-view semantics ("`CREATE MATERIALIZED VIEW ... REFRESH`" in PostgreSQL terms; scheduled calculation-view materialization in HANA terms). CAP has no first-class materialized-view story — that's a real gap, but it's a **different** gap from the one the federation plugin fills.

Use case 2 passes, weakly. The reporting DB is "another system"; pulling from it is CAP's own narrow "data federation" (replicate-for-close-access, per the [CAP Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation)).

### Why this keeps coming up

Use case 1 is the second occurrence of the same scope question. The first was the target-adapter proposal in [`spec/internal/ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md), whose "Question 1" asked the same thing from the write side. Both times the honest answer is the same: **it's not federation; it's a different capability that happens to share the replication pipeline.**

[ADR 0003](./0003-split-plugin-into-replication-and-federation.md) resolves this at the structural level by separating the replication engine from the federation annotation layer. With that split in place, Req 4.6.3 stops being a scope question and becomes a routing one.

### Options considered

| Option | Outcome | Verdict |
|---|---|---|
| **A — Build a dedicated `CqnAdapter` in `cds-data-federation`, accept only use case 2.** Reject use case 1 as not-federation; materialization stays user-space code. | Preserves federation scope. Splits a natural capability (CQN over any CAP-native source) in half. Leaves use case 1 unsolved even though the pipeline would handle it trivially. | Rejected — federation scope preserved at a real capability cost. |
| **B — Build a dedicated `CqnAdapter` in `cds-data-federation`, accept both use cases.** Broaden the federation plugin to cover materialization despite the terminology mismatch. | Forces the federation namespace to own non-federation semantics. Same anti-pattern ADR 0003 rejects. | Rejected — was implicitly the pre-split framing; obsolete now. |
| **C — Move Req 4.6.3 to `cds-data-replication`.** Both use cases land on the engine. Federation's `@federation.replicate` → `cds-data-replication` binding inherits CQN source support automatically for use case 2. Use case 1 is served by calling `addReplication(...)` directly against the engine, with or without a `@federation.*` annotation on top. | Federation stays federation. Engine gains a capability that fits its scope naturally. | **Selected.** |
| **D — Remove 4.6.3 as redundant with Req 4.6.4 (`BaseAdapter`).** A user can already write a custom CQN adapter by extending `BaseAdapter`. | True but ergonomically poor for the common cases. Secondary-DB replication is frequent enough to deserve a built-in. | Rejected — applies to bespoke SQL scenarios only; the common cases should be one-line adapter-factory routing, not a bespoke class. |

### What a CQN adapter actually needs to do

Critical observation: `ODataAdapter.readStream()` ([`srv/adapters/ODataAdapter.js`](../../../srv/adapters/ODataAdapter.js)) already uses `service.run(SELECT.from(entity).columns(...).where(...).limit(batchSize, skip))`. `srv.run(query)` is CQN-native; CAP picks the wire protocol based on the connected service's `kind`. For in-process services or DB-kind services, the CQN goes straight through without HTTP translation. The existing adapter is therefore **already functional against CQN-native services** — the name is slightly misleading. What's OData-specific is limited to three things:

1. OData-flavored timestamp quirks in `_buildDeltaFilter()` (V2's `.slice(0, -1)` trailing-Z hack, ISO-string formatting).
2. Absence of support for CQN features OData can't express: `.groupBy()`, `.having()`, `DISTINCT`, joins, subqueries.
3. Absence of a `source.query` escape hatch for arbitrary CQL (use case 1 needs this to express aggregates).

The implementation question reduces to: **extract the CQN core as a base capability, push OData-specific quirks into `ODataAdapter`, and add a `source.query` hook for arbitrary CQL.**

## Decision

**Req 4.6.3 ships in `cds-data-replication`, covering both use cases. Concretely:**

1. **Refactor `ODataAdapter` into a `CqnAdapter` base.** Move `service.run(SELECT.from(entity).columns(...).where(...).limit(batchSize, skip))` and the batch-paging loop into `CqnAdapter`. `ODataAdapter` becomes a thin subclass that overrides `_buildDeltaFilter()` with the OData-specific timestamp quirks.

2. **Adapter factory routes by `kind`.** Today ([`srv/adapters/factory.js`](../../../srv/adapters/factory.js)) it routes `odata` / `odata-v2` → OData, `rest` → REST, else → OData fallback. New routing:

   | `kind` | Adapter |
   |---|---|
   | `odata`, `odata-v2`, `hcql` | `ODataAdapter` |
   | `rest` | `RestAdapter` |
   | `hana`, `postgres`, `sqlite`, `better-sqlite`, `sql` | `CqnAdapter` |
   | in-process CAP app service | `CqnAdapter` |
   | else | `CqnAdapter` with warning (not OData fallback — CQN is the more permissive default) |

3. **`source.query` escape hatch.** A new optional field in the `addReplication({ source })` shape:

   ```js
   source: {
       service: 'SalesService',
       query: (tracker) =>
           SELECT.from('Orders')
               .columns('customer_id as customerID', { func: 'sum', args: [{ ref: ['amount'] }], as: 'totalAmount' })
               .groupBy('customer_id')
               .where({ modifiedAt: { '>': tracker.lastSync } })
   }
   ```

   When present, `CqnAdapter` uses the query factory per batch instead of building one from `source.entity` + column/where config. This is the same ergonomic shape anticipated for the target-adapter `options.target = { query }` in [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — symmetric for future consistency.

   **Explicit deviation from the "consumption view IS the federation contract" principle** documented in [`CLAUDE.md`](../../../CLAUDE.md). Rationale: arbitrary CQL cannot be expressed as `projection on X.Y`; an aggregated SELECT-with-GROUP-BY doesn't fit the projection shape. `source.query` is the documented escape hatch, analogous to the existing `options.source` escape hatch for REST services without a CDS model. Users opting in accept that field mapping is owned by the query, not the consumption view.

4. **`@federation.replicate` keeps the consumption-view contract.** Use case 2 is the common case for `@federation.replicate` users; it works purely through the annotation + a `projection on reporting.Orders` consumption view. Only use case 1 (and other arbitrary-CQL scenarios) reaches for `addReplication({ source: { query } })` directly — i.e. as a `cds-data-replication` user, not a `cds-data-federation` user. The annotation layer does not need a new option surface for this.

### What use case 1 looks like in application code

Programmatic-only, against the engine directly:

```cds
// srv/rollups.cds — schema only; no projection clause
@cds.persistence.table
entity DailyCustomerRevenue {
    key customerID : String;
    totalAmount    : Decimal(15,2);
    orderCount     : Integer;
    lastActivity   : Timestamp;
}
```

```js
// srv/rollups.js
const cds = require('@sap/cds')

module.exports = async () => {
    const replication = await cds.connect.to('DataReplicationService')

    replication.addReplication({
        name: 'DailyCustomerRevenue',
        schedule: '0 2 * * *',      // nightly at 02:00
        mode: 'full',               // rebuild snapshot
        source: {
            service: 'SalesService',
            query: () => SELECT.from('SalesService.Orders')
                .columns(
                    'customer_id as customerID',
                    { func: 'sum',   args: [{ ref: ['amount'] }],     as: 'totalAmount' },
                    { func: 'count', args: ['*'],                      as: 'orderCount' },
                    { func: 'max',   args: [{ ref: ['modifiedAt'] }], as: 'lastActivity' },
                )
                .groupBy('customer_id'),
        },
        target: { service: 'db', entity: 'DailyCustomerRevenue' },
    })
}
```

No `@federation.*` annotation. No `cds-data-federation` dependency. Use case 1 is served standalone.

### What use case 2 looks like in application code

Annotation-only, via `cds-data-federation` (which binds to `cds-data-replication` under the hood):

```cds
// db/reporting-schema.cds
namespace reporting;

entity Orders {
    key order_id : UUID;
    customer_id  : String;
    order_date   : Timestamp;
    total_amount : Decimal(15,2);
    status       : String;
    modifiedAt   : Timestamp;
}
```

```cds
// srv/federation.cds
using { reporting } from '../db/reporting-schema';

@federation.replicate: {
    schedule: '0 */1 * * *',
    mode: 'delta',
    delta: { mode: 'timestamp', field: 'order_date' }
}
entity ArchivedOrders as projection on reporting.Orders {
    order_id     as ID,
    customer_id  as customerID,
    order_date   as orderedAt,
    total_amount as amount,
    status
};
```

```json5
// .cdsrc.json
{
    "cds": {
        "requires": {
            "reporting": { "kind": "postgres", "model": "db/reporting-schema" }
        }
    }
}
```

No JS, no `addReplication(...)`. The federation annotation scanner resolves the `projection on reporting.Orders` contract and binds it to `cds-data-replication`, which picks `CqnAdapter` from the factory based on `kind: postgres`.

## Consequences

### What this enables

- **Both use cases served cleanly.** Use case 2 is annotation-only via federation. Use case 1 is programmatic-only via the engine. No forcing of non-federation semantics into the `@federation.*` namespace.
- **`ODataAdapter` simplifies.** Shared paging / batch / retry logic moves into `CqnAdapter`; `ODataAdapter` overrides only the delta-filter builder. Net LOC drop, cleaner responsibility split.
- **Adapter factory becomes honest about CQN sources.** DB-kind services stop falling through to `ODataAdapter` and its OData-flavored timestamp filters. Secondary-DB replication stops working "by accident" and starts working by design.
- **Symmetric escape-hatch shape with future target adapters.** The `source.query` hook mirrors the `target.query` hook anticipated in [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) Option A. Whoever implements target adapters later has a consistent ergonomic to match.
- **Delta strategy for aggregates stays honest.** `mode: 'full'` is the recommended default for use-case-1-shaped replications (aggregates don't have a row-level `modifiedAt` semantic). The CQN adapter supports delta via `source.query` closures over the tracker when users want smarter partial rebuilds, but does not pretend timestamp-delta "just works" for aggregates.

### What we accept as trade-offs

- **Documented break from "consumption view IS the federation contract."** `source.query` is explicitly outside that principle. This is the second such escape hatch (REST's `options.source` is the first). Acceptable precedent; not a slippery slope as long as each deviation is ADR-documented.
- **Use case 1 is programmatic, not declarative.** Materialization via `@materialize.snapshot`-style annotations is out of scope for both packages. A sibling plugin (e.g. hypothetical `cds-materialized-views`) could add that surface later, consuming `cds-data-replication` the way `cds-data-federation` does.
- **Scanner does not learn to handle aggregated CDS views.** An earlier discussion considered extending the annotation scanner to accept `as select from X {...} group by Y` as a federation contract. Rejected: it would pull materialization back into federation, against [ADR 0003](./0003-split-plugin-into-replication-and-federation.md)'s separation. The escape hatch stays programmatic; declarative materialization is a follow-up plugin concern.
- **Update cost in the requirements tracker.** 4.6.3 migrates to `cds-data-replication`'s requirements section post-split, alongside the `CqnAdapter` + factory-routing + `source.query` escape hatch as sub-items. Not new requirements — redistribution.

### Follow-up work

Tracked as a checklist, not ADR content:

1. Post-[ADR 0003](./0003-split-plugin-into-replication-and-federation.md) split: land 4.6.3 in `packages/cds-data-replication/`. Factor out `CqnAdapter` base from `ODataAdapter`. Update factory routing table.
2. Implement `source.query` escape hatch in `DataReplication.js` READ phase.
3. Update [`requirements.md`](../../reference/requirements.md) 4.6 table: narrow 4.6.3 prose, split into 4.6.3a "Adapter factory routing for DB kinds", 4.6.3b "`source.query` escape hatch".
4. Documentation: add a cookbook entry to the engine package's README covering use case 1 (rollup) end-to-end, and to the federation package's README covering use case 2 (secondary DB) end-to-end.
5. Cross-reference this ADR from [`ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — the `source.query` shape is the precedent for that idea's eventual `target.query`.
6. Add a test case per use case to `test/`: one exercising `CqnAdapter` against an in-process CAP app service with `.groupBy`, one against an embedded secondary SQLite bound as `kind: sqlite`.

## References

- [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) — structural precondition; routes this requirement to the engine package.
- [`spec/reference/requirements.md`](../../reference/requirements.md) §4.6 Source Adapters — Req 4.6.3 source; §4.2 Query Capability Matrix — `.groupBy` rejection for OData; §2 Key Use Cases — multi-source consolidation.
- [`spec/concepts/terminology.md`](../../concepts/terminology.md) — federation definition; the basis for classifying use case 1 as non-federation.
- [`spec/internal/ideas/service-to-service-data-movement.md`](../ideas/service-to-service-data-movement.md) — parallel target-adapter discussion; symmetric `query` escape hatch.
- [`srv/adapters/ODataAdapter.js`](../../../srv/adapters/ODataAdapter.js), [`srv/adapters/factory.js`](../../../srv/adapters/factory.js) — files refactored by this decision.
- [`CLAUDE.md`](../../../CLAUDE.md) — "consumption view IS the federation contract" principle and documented escape-hatch precedent.
