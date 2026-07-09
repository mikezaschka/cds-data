# Custom target adapter

**When to pick this recipe:** the destination is not the local DB and not an OData service — reporting services, message buses, custom HTTP APIs, anything else. Writing a target adapter gives you a reusable class; it is the route for non-`db`, non-OData targets, which `addPipeline` otherwise rejects.

For the formal contract and resolution order see [Targets → Custom target adapter](../targets/custom.md). This page is a scenario-driven walkthrough.

## Scenario — forward rows to a reporting service

Orders live in a CAP source service (`OrdersService`). A downstream CAP service (`ReportingService`) exposes an `upsertBatch` event to ingest pre-aggregated facts. You want a pipeline that reads orders entity-shape, maps them to fact rows, and forwards each batch to the reporting service. The same adapter should be reusable for a half-dozen similar feeds.

## Adapter

Extend `BaseTargetAdapter` and implement the three write primitives plus the `capabilities()` declaration:

```javascript
// adapters/ReportingTargetAdapter.js
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

The four capability flags are load-bearing: `addPipeline` consults them to reject incompatible modes. Pipelines that need `batchInsert` (query-shape `source.query`) or `batchDelete` (`mode: 'full'` with partial delete) will be rejected for this adapter before the first run.

## Pipeline registration

```javascript
const cds = require('@sap/cds');
const ReportingTargetAdapter = require('./adapters/ReportingTargetAdapter');

module.exports = async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

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
};
```

`ReportingTargetAdapter` is selected via `target.adapter`, which takes precedence over `target.service`. `target.service` is still honoured — `this.service` is injected as the connected `ReportingService` handle — but it is not used to pick the adapter.

## Capability-based rejection

Incompatible configs are rejected up front rather than halfway through a run:

```javascript
// Rejected at registration — source.query requires batchInsert,
// which ReportingTargetAdapter reports as false:
await pipelines.addPipeline({
    name: 'OrdersRollup',
    source: {
        kind: 'cqn',
        service: 'OrdersService',
        query: () => SELECT.from('Orders').columns(/* aggregates */).groupBy('status'),
    },
    target: {
        service: 'ReportingService',
        entity: 'ReportingService.OrderRollup',
        adapter: ReportingTargetAdapter,
    },
});
// → Error: target adapter lacks `batchInsert` — required by query-shape pipelines.
```

See [Concepts → Inference rules → Registration validation](../concepts/inference.md#registration-validation-matrix) for the full matrix.

## What happens at runtime

1. Schedule fires (or a manual `run` is dispatched via the management service).
2. `PIPELINE.READ` runs against `OrdersService.Orders` through the auto-selected source adapter, yielding batches.
3. `PIPELINE.MAP` applies any renames / filters.
4. For each batch `ReportingTargetAdapter.writeBatch(records, { mode: 'upsert', target })` is called — which fans out to `ReportingService.send('upsertBatch', ...)`.
5. If `mode: 'full'` is used, `truncate` is called once before the first batch.
6. The tracker row is updated with the new `lastSync`.

## When to pick this over a write event hook

- **Reuse:** the adapter is a class — drop it into multiple pipelines without repeating the forwarding logic.
- **Capability gating:** the `capabilities()` declaration makes misuse a registration-time error rather than a run-time one.
- **Composability with `mode: 'full'` and partial refresh:** the adapter owns `truncate` / `deleteSlice`, so refresh semantics work correctly.

Pick an [`on('PIPELINE.WRITE')` event hook](event-hooks.md#on-as-a-target-adapter-alternative) instead for one-off forwarding that will not be repeated, or when you want to layer a bespoke write on top of the default `DbTargetAdapter` (e.g. write to a staging table *and* forward).

## See also

- [Targets → Custom target adapter](../targets/custom.md) — the formal `BaseTargetAdapter` contract.
- [Targets → overview](../targets/index.md) — resolution order and capability gating.
- [Concepts → Inference rules](../concepts/inference.md) — how `target.adapter` plugs into target adapter selection.
- [Recipes → Custom source adapter](custom-source-adapter.md) — the peer recipe for the READ phase.
- [Recipes → Event hooks](event-hooks.md) — the lightweight alternative for one-off forwarding and per-phase customization.
