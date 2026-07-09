# 03 — Cross-service expand & navigation

> Expands on [Federation → Cross-service scenarios](../../../../docs/federation/concepts/cross-service-scenarios.md).

CAP handles `$expand` natively only when both sides live on the same service. When an association crosses a service boundary — local ↔ remote — `cds-data-federation` splits the query, batch-fetches the other side, and stitches the results.

## What this shows

| Request | Direction | How the plugin serves it |
|---|---|---|
| `Reviews?$expand=product` | local → remote | Reads local Reviews, collects `product` keys, one batched remote read, stitches |
| `Customers?$expand=bookmarks` | remote → local | Delegates Customers to the remote, then reverse-fetches matching local Bookmarks |
| `Reviews?$filter=product/category eq 'Electronics'` | cross-service navigation | Resolves the remote-side predicate, then filters the local rows |

`Reviews` and `Bookmarks` are **local** entities (seeded from `db/data/`); `Customers` and `Products` are **delegated** remote entities.

## Run

```bash
bash start.sh
```

- Service: http://localhost:4133/odata/v4/shop/

Then run [`http/scenarios.http`](http/scenarios.http).

## Key idea

`@federation.replicate` entities participate in these scenarios only as the *local* side — after replication they are ordinary local tables. The remote side is always `@federation.delegate`. See the [directional scenario names](../../../../docs/federation/concepts/cross-service-scenarios.md) for the full topology.
