# 05 — Cross-provider mashup

> Expands on [Federation → Cross-provider mashup](../../../../docs/federation/getting-started/cross-provider-mashup.md).

A single local entity can associate to entities on **different remote providers**. When you `$expand` both, `cds-data-federation` issues **one batch-fetch per provider** and stitches everything together — the consumer sees one coherent response.

## Topology

```
InventoryReports (local)
   ├─ product   → ProviderService.Products   (provider A, :4145)
   └─ warehouse → InventoryService.Warehouses (provider B, :4155)
```

## What this shows

| Request | Behaviour |
|---|---|
| `InventoryReports?$expand=product,warehouse` | Batch-fetch A for products, batch-fetch B for warehouses, stitch onto local rows |
| `InventoryReports?$expand=product` | Only provider A is contacted |

## Run

```bash
bash start.sh
```

- Service: http://localhost:4135/odata/v4/shop/

See [`http/scenarios.http`](http/scenarios.http).

## Key idea

There is no single remote that can answer this join — the data is spread across two systems and a local table. The plugin decomposes the `$expand` per target service, which is exactly the "cross-service expand: cross-provider" scenario from the [scenario reference](../../../../docs/federation/concepts/cross-service-scenarios.md).
