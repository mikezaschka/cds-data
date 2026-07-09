# 07 — CAP-to-CAP delegate over HCQL

> Expands on [Pipeline → Remote CQN sources (OData & HCQL)](../../../../docs/pipeline/guide/sources/odata.md) and [Federation → CDS 10, HCQL and MCP](../../../../docs/federation/concepts/service-query-execution.md#cds-10-hcql-and-mcp).

**HCQL** (CQL over HTTP) is CAP's protocol (June 2026 / cds 10) for CAP-to-CAP integration. When the remote provider serves `@hcql @odata`, CAP's client **auto-selects HCQL** — the plugin makes **no** annotation or adapter change. HCQL carries richer CQN than OData, which unlocks **flattened associations** (path expressions) that OData cannot express.

> **Requires CDS 10.** On CDS 9, HCQL is unavailable and the `OrderFlat` path expressions below will fail — that is the point of the example.

## What this shows

| Entity | Pattern | HCQL relevance |
|---|---|---|
| `Customers` | Plain delegate | HCQL chosen automatically on the wire |
| `Products` | Renames + `$filter` | Same as OData; benefits from HCQL transparently |
| `OrderFlat` | `customer.name as buyerName`, `product.name as itemName` | **Flattened associations** — works over HCQL, fails over OData-only |

## Run

```bash
bash start.sh
```

- Service: http://localhost:4137/odata/v4/shop/
- Provider (`@hcql @odata`): http://localhost:4147/odata/v4/provider/

See [`http/scenarios.http`](http/scenarios.http).

## Key idea

There is **no `@federation.hcql` strategy** and no HCQL adapter to pick. HCQL is a CAP runtime choice negotiated between the consumer and a provider that serves `@hcql`. Federation forwards CQN via `remote.run(query)`; CAP decides the wire protocol. To adopt it, annotate the provider `@hcql @odata` and keep the consumer binding as `kind: 'odata'`.
