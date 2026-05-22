---
name: snapshot-projection
description: Creates @materialize.snapshot aggregation projections in SAP CAP. Use when defining group by snapshots, sum/count aggregates, schedule options, or the materialized aspect on target entities.
---

# Snapshot projection

## Minimal pattern

```cds
using from 'cds-data-pipeline/db';

namespace reporting;

@materialize.snapshot: {
  schedule : '0 2 * * *',
  source   : { service: 'db' }
}
entity DailyCustomerRevenue as projection on sales.Orders {
  key customerId,
      sum(amount)     as totalAmount  : Decimal(15, 2),
      count(*)        as orderCount   : Integer,
      max(modifiedAt) as lastActivity : Timestamp
}
group by customerId;
```

`source.service` is the `cds.requires` key that executes the aggregate (typically `db` for local tables).

## Annotation options

| Option | Description |
|---|---|
| `schedule` | Cron or interval for pipeline runs |
| `refresh` | Default `full` — rebuild entire snapshot each run |
| `name` | Pipeline tracker name (default: entity name) |
| `source.service` | Required when `from` ref is not `Service.Entity` |

## Optional `materialized` aspect

```cds
using { plugin.data_materialization as materialization } from 'cds-data-materialization';

entity DailyCustomerRevenue : materialization.materialized {
  key customerId : String(10);
  totalAmount    : Decimal(15, 2);
}
```

Adds `lastMaterializedAt` and `lastMaterializedBy`.

## Compiler rules (v1)

Supported:

- Single-entity `projection on`
- Standard aggregates with `as` aliases
- `group by` on projected keys
- Optional static `where` on the projection

Rejected at scan time:

- Path expressions in SELECT
- Expand/join columns
- Cross-source joins in one materialization
- `@federation.*` on the same entity

## Stage-then-aggregate pattern

Remote OData cannot be the aggregate source. Workflow:

1. `@federation.replicate` remote entity into local table
2. `@materialize.snapshot` on `group by` over the local table with `source.service: 'db'`

## Anti-patterns

❌ **Wrong**:

```cds
@materialize.snapshot: { source: { service: 'RemoteOData' } }
entity DailyRevenue as projection on remote.Orders { ... }
group by customerId;
```

✅ **Correct** — replicate first, aggregate from `db`.

❌ **Wrong** — `@materialize.snapshot: { refresh: 'partial' }` in annotation.

✅ **Correct** — full refresh in v1; use engine API for partial refresh with `refresh.slice`.

## Docs

- Annotations: https://mikezaschka.github.io/cds-data-federation/materialization/reference/annotations.html
- Stage then aggregate: https://mikezaschka.github.io/cds-data-federation/materialization/concepts/stage-then-aggregate.html
