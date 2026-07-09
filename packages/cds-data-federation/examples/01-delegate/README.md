# 01 — Delegate (live proxy)

> Expands on [Federation → First delegation](../../../../docs/federation/getting-started/first-delegation.md).

`@federation.delegate` turns a consumption view into a **live proxy**: reads (and, opt-in, writes) are forwarded to the remote OData provider at request time. Nothing is stored locally.

## What this shows

| Entity | Pattern | What to observe |
|---|---|---|
| `Customers` | Wildcard proxy | All remote fields, fetched live |
| `Products` | Column restriction + renames | Only 5 of 7 fields; `price → unitPrice`, `$filter=unitPrice` translated to remote `price` |
| `Suppliers` | Entity-level rename | Same remote `Customers` data, reframed as a supplier domain |
| `ActiveCustomers` | Static `where` | `$filter=blocked eq false` injected into every remote query |
| `WritableCustomers` | `writable: true` | Full CUD forwarded to the remote |
| `WritableCustomersNoDelete` | `create: true, update: true` | Delete rejected with `405` — read-only by default |

## Run

```bash
bash start.sh
```

- Consumer: http://localhost:4131/odata/v4/shop/
- Provider (upstream, for comparison): http://localhost:4141/odata/v4/provider/

Then run [`http/scenarios.http`](http/scenarios.http) with the VS Code REST Client extension.

## Key idea

The **consumption view is the federation contract**: the CDS projection declares the schema (fields, shape, renames); the `@federation.delegate` annotation declares the runtime behaviour. Source service, projected columns, and the bidirectional rename mapping are all inferred from the projection — no handler code.
