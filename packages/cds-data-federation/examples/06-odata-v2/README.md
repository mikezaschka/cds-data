# 06 — Delegate over OData V2

> Expands on [Federation → Consumption views](../../../../docs/federation/concepts/consumption-views.md).

Federation treats OData **V2** exactly like V4 — the only change is `kind: 'odata-v2'` on the remote binding. The consumption view, renames, and static filters are identical. CAP normalizes V2 wire quirks (string decimals, string `$count`) for you.

## Setup

The shared `provider` fixture bundles [`@cap-js-community/odata-v2-adapter`](https://github.com/cap-js-community/odata-v2-adapter), so it serves the **same data** at both `/odata/v4/provider` and `/odata/v2/provider`. This example binds the consumer to the **V2** endpoint:

```json
"ProviderServiceV2": {
  "kind": "odata-v2",
  "model": "srv/external/ProviderServiceV2",
  "credentials": { "url": "http://localhost:4146/odata/v2/provider" }
}
```

## What this shows

| Entity | Pattern |
|---|---|
| `Customers` | Wildcard delegate over V2 |
| `Products` | Column restriction + renames; `$filter=unitPrice` translated to remote `price` over V2 |
| `Suppliers` | Entity-level rename over V2 |

## Run

```bash
bash start.sh
```

- Consumer (V4 surface, V2 backend): http://localhost:4136/odata/v4/shop/
- Upstream V2: http://localhost:4146/odata/v2/provider/

See [`http/scenarios.http`](http/scenarios.http).

## Key idea

The consumption view is protocol-agnostic. Switching a legacy V2 source to V4 (or vice versa) is a one-line binding change — the annotations and projections stay the same.
