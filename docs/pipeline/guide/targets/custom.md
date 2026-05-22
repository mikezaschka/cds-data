# Custom target adapter

When the destination is not the local DB (`'db'`) and not an OData service (`'odata'` / `'odata-v2'`), `addPipeline` rejects the config unless you supply a `target.adapter` class reference. Write one by extending `BaseTargetAdapter`.

Four methods are called on the adapter — three write primitives plus the capability hook consulted at registration.

## Contract

```javascript
const BaseTargetAdapter = require('cds-data-pipeline/srv/adapters/targets/BaseTargetAdapter');

class MyTargetAdapter extends BaseTargetAdapter {
    async writeBatch(records, { mode, target }) {
        // mode: 'upsert' (entity-shape) | 'snapshot' (query-shape INSERT
        // after the target is cleared). target: { service?, entity }.
        // Return { created, updated, deleted } for the tracker.
    }

    async truncate(target) {
        // Full-refresh clear, called before the first snapshot batch or
        // at the start of a mode: 'full' run.
    }

    async deleteSlice(target, predicate) {
        // Partial-refresh clear. `predicate` is the CQN where-shape
        // returned by refresh.slice(tracker).
    }

    capabilities() {
        return {
            batchInsert: false,        // INSERT many rows in one call
            keyAddressableUpsert: false, // UPSERT by key (delta writes)
            batchDelete: false,        // DELETE WHERE <predicate>
            truncate: false,           // DELETE all rows
        };
    }
}
```

## Capability gating

`addPipeline` rejects incompatible configs by consulting `capabilities()`:

| Config | Required capability |
|---|---|
| `mode: 'delta'` | `keyAddressableUpsert` |
| `mode: 'full'` | `truncate` **or** `batchDelete` |
| `source.query` (query-shape) | `batchInsert` |

Omitted keys default to `false`. Report only what your adapter actually supports — `addPipeline` rejects users at registration rather than halfway through the first run.

## Resolution order

1. `config.target.adapter` — class reference extending `BaseTargetAdapter`. Takes precedence over `target.service`.
2. `config.target.service` unset or `'db'` → built-in `DbTargetAdapter`.
3. `config.target.kind` (`'odata' | 'odata-v2'`) — explicit transport selector. Takes precedence over the connected service's auto-detected kind.
4. Auto-detected `service.options.kind` (`'odata' | 'odata-v2'`) on the connected remote service → built-in `ODataTargetAdapter`.
5. Any other `config.target.service` with no `target.adapter` → **registration error** pointing to this page.

## Worked example — a reporting-service target adapter

Forward mapped rows to a remote CAP service via `send({ event, data })`. Illustrates the full contract including capability-based rejection.

```javascript
const cds = require('@sap/cds');
const BaseTargetAdapter = require('cds-data-pipeline/srv/adapters/targets/BaseTargetAdapter');

class ReportingTargetAdapter extends BaseTargetAdapter {
    async getReporting() {
        if (!this.reporting) {
            const targetService = this.config.target && this.config.target.service;
            this.reporting = this.service || await cds.connect.to(targetService);
        }
        return this.reporting;
    }

    async writeBatch(records, { mode }) {
        if (!records || records.length === 0) {
            return { created: 0, updated: 0, deleted: 0 };
        }
        const svc = await this.getReporting();

        if (mode === 'snapshot') {
            throw new Error(
                `ReportingTargetAdapter: snapshot writes unsupported — ` +
                `capabilities().batchInsert must be false`
            );
        }

        await svc.send({ event: 'upsertBatch', data: { rows: records } });
        return { created: records.length, updated: 0, deleted: 0 };
    }

    async truncate() {
        const svc = await this.getReporting();
        await svc.send({ event: 'truncate', data: {} });
    }

    async deleteSlice() {
        throw new Error(
            `ReportingTargetAdapter: deleteSlice unsupported — ` +
            `capabilities().batchDelete must be false`
        );
    }

    capabilities() {
        return {
            batchInsert: false,           // remote has no batch-insert endpoint
            keyAddressableUpsert: true,   // `upsertBatch` honours keys
            batchDelete: false,           // no slice support
            truncate: true,               // `truncate` exists
        };
    }
}

module.exports = ReportingTargetAdapter;
```

Wire it on registration:

```javascript
const ReportingTargetAdapter = require('./adapters/ReportingTargetAdapter');

await pipelines.addPipeline({
    name: 'OrdersToReporting',
    source: { service: 'OrdersService', entity: 'Orders' },
    target: {
        service: 'ReportingService',
        entity: 'ReportingService.OrderFacts',
        adapter: ReportingTargetAdapter,
    },
    mode: 'delta',
});

// The following would be rejected at registration — source.query requires
// batchInsert, which ReportingTargetAdapter reports as false:
//
// await pipelines.addPipeline({
//     name: 'OrdersRollup',
//     source: { kind: 'cqn', service: 'OrdersService',
//               query: () => SELECT.from('Orders').columns(...).groupBy(...) },
//     target: { service: 'ReportingService', entity: '...', adapter: ReportingTargetAdapter },
// });
```

## Transactional semantics

Query-shape (snapshot) pipelines run inside a `cds.tx` transaction — so `truncate` / `deleteSlice` + batch `INSERT`s commit atomically and a mid-run crash leaves the previous snapshot intact. Entity-shape (UPSERT) pipelines run without an outer transaction: each batch commits on its own so partial progress survives interruptions.

Target adapters do not have to manage `cds.tx` themselves; they inherit the ambient `cds.context` / transaction. Custom remote-protocol adapters (like the reporting-service adapter above) need to surface their own atomicity guarantees at the service boundary — `cds.tx` does not span remote HTTP calls.

## See also

- [Targets → overview](index.md) — resolution order and the capability-gating matrix.
- [Targets → Local DB](db.md) and [OData](odata.md) — the two built-in target adapters.
- [Sources → Custom source adapter](../sources/custom.md) — the peer contract for the READ phase.
- [Recipes → Custom target adapter](../recipes/custom-target-adapter.md) — scenario-driven walkthrough.
- [Recipes → Event hooks](../recipes/event-hooks.md) — the lightweight alternative for one-off forwarding and per-phase customization.
- [Concepts → Inference rules](../concepts/inference.md) — target adapter selection and the full validation matrix.
