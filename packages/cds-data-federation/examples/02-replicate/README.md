# 02 — Replicate (scheduled sync)

> Expands on [Federation → First replication](../../../../docs/federation/getting-started/first-replication.md).

`@federation.replicate` copies remote data into a **local database table** on a schedule, composing [`cds-data-pipeline`](../../../cds-data-pipeline/) underneath. Once local, the data is queryable with full SQL — joins, `GROUP BY`, offline access — none of which a live proxy can do.

## What this shows

| Entity | Pattern | What to observe |
|---|---|---|
| `ReplicatedCustomers` | `preload: true` | Full replicate runs at startup — table populated on first boot |
| `ReplicatedProducts` | `schedule` + `delta` on `modifiedAt` | Incremental sync; each run pulls only changed rows |
| `ExpensiveProducts` | Local SQL view | `where unitPrice > 100` over the replica |
| `CategoryStats` | Local `GROUP BY` | Aggregate rollup computed on the local table |

The **Pipeline Console** (`management.reuse.console`) and management OData API (`/pipeline/`) are enabled so you can watch runs and trigger them manually.

## Run

```bash
bash start.sh
```

- Pipeline Console: http://localhost:4132/pipeline-console/
- Management API: http://localhost:4132/pipeline/Pipelines
- Service: http://localhost:4132/odata/v4/shop/

Trigger a run and query the local copy — see [`http/scenarios.http`](http/scenarios.http).

## Key idea

`@federation.replicate` and `@federation.delegate` share the exact same consumption-view contract. The only difference is the annotation: replicate registers a scheduled pipeline that UPSERTs remote rows into a real local table (`@cds.persistence.skip: false`), while delegate keeps the entity virtual. After replication, the entity is an ordinary local table.
