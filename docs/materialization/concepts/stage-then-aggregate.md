# Stage then aggregate

::: warning Experimental — not yet released
`cds-data-materialization` is **experimental** and **not yet published to npm**. `cds-data-federation` and `cds-data-pipeline` (used below) are released independently.
:::

A common pattern:

1. **`@federation.replicate`** — copy remote rows into a local table.
2. **`@materialize.snapshot`** — project aggregates from that local table via `source: { service: 'db' }`.

The materialization source is a normal local entity; the engine does not call the remote service for `GROUP BY`. See [Local analytics over replicated data](/federation/getting-started/local-analytics-over-replicated) for why ad-hoc SQL on replicated tables differs from a **frozen snapshot** contract.

```cds
@federation.replicate: { schedule: '*/15 * * * *' }
entity ReplicatedOrders as projection on remote.Orders { ... };

@materialize.snapshot: { source: { service: 'db' } }
entity DailyRevenue as projection on ReplicatedOrders {
  key customerId,
      sum(amount) as totalAmount : Decimal(15, 2)
}
group by customerId;
```

Install **`cds-data-federation`**, **`cds-data-materialization`**, and **`cds-data-pipeline`** together. No extra wiring beyond annotations.

## Why not aggregate directly on the remote?

`@materialize.snapshot` rejects OData/REST sources for the aggregate read on purpose — CAP does not support `GROUP BY` / `$apply` pushdown to those remotes, and a live remote aggregate has no frozen-snapshot guarantee. Even with CAP's newer **HCQL** protocol (see [how CDS 10 relates to these plugins](/federation/concepts/service-query-execution#cds-10-hcql-and-mcp)), HCQL only unlocks richer path expressions on *entity-shape* reads; top-level remote aggregation is not proven. Stage the rows locally with `@federation.replicate`, then aggregate on your own database.
