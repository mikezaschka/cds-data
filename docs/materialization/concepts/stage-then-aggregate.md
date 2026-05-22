# Stage then aggregate

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
