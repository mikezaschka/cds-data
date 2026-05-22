---
name: delegate-consumption-view
description: Creates @federation.delegate consumption views on remote OData entities in SAP CAP. Use when proxying remote data, adding field renames, association renames, read-only defaults, CUD opt-in, or delegate caching.
---

# Delegate consumption view

## Minimal pattern

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

@federation.delegate
entity Customers as projection on remote.Customers;
```

## Common patterns

**Column restriction + renames** — excluded fields are never fetched remotely:

```cds
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    price as unitPrice,
    currency
};
```

**Association renames** — `$expand=buyer` maps to remote `$expand=customer`:

```cds
@federation.delegate
entity Orders as projection on remote.Orders {
    ID       as orderId,
    customer as buyer,
    product  as item
};
```

**Static filter** — injected into every remote query:

```cds
@federation.delegate
entity ActiveCustomers as projection on remote.Customers
  where blocked = false;
```

## CUD opt-in (read-only by default)

```cds
// All CUD:
@federation.delegate: { writable: true }
entity Products as projection on remote.Products { * };

// Selective:
@federation.delegate: { create: true, update: true }
entity Partners as projection on remote.Partners { ... };
```

Disabled operations return HTTP 405.

## Optional cache

```cds
@federation.delegate: { cache: { ttl: 60000 } }
entity CachedCustomers as projection on remote.Customers;
```

Default strategy is `response` (requires `cds-caching`). Use `strategy: 'entity'` for full-entity SQLite snapshots (requires `cds-data-pipeline`).

## Anti-patterns

❌ **Wrong** — entity without `projection on remote.X`:

```cds
@federation.delegate
entity Products { key ID: UUID; name: String; }
```

✅ **Correct** — always use a consumption view projection.

❌ **Wrong** — assuming CREATE/UPDATE/DELETE work without write flags.

✅ **Correct** — explicit `writable: true` or per-operation flags.

❌ **Wrong** — hand-written `srv.on('READ', ...)` for the same entity.

✅ **Correct** — let the plugin register the delegate handler from the annotation.

## Docs

- Annotations: https://mikezaschka.github.io/cds-data-federation/federation/reference/annotations.html
- Consumption views: https://mikezaschka.github.io/cds-data-federation/federation/concepts/consumption-views.html
