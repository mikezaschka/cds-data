# Consumption Views

> **Contributor canonical source.** Consumer-facing concept pages live under [`packages/cds-data-federation/spec/concepts/`](../../packages/cds-data-federation/spec/concepts/). Edits here are the authoritative version for contributors; sync changes into the per-package copy as scope allows.

**The CDS projection IS the federation contract.** The `@federation.*` annotation declares *runtime behavior*; the projection declares *schema* — what fields, what shape, what renames.

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

// 1. Wildcard — all fields, no renames (simplest case)
@federation.delegate
entity Customers as projection on remote.Customers;

// 2. Column restriction + field renames
// Remote: ID, name, category, price, currency, stock, modifiedAt (7 fields)
// Local:  productId, productName, category, unitPrice, currency (5 fields)
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,     // rename: remote `ID` → local `productId`
    name  as productName,   // rename
    category,               // keep
    price as unitPrice,     // rename
    currency
    // remote fields `stock`, `modifiedAt` are NOT projected → never fetched
};

// 3. Field + association renames
// Enables remote→remote $expand: $expand=buyer translates to $expand=customer
@federation.delegate
entity Orders as projection on remote.Orders {
    ID         as orderId,
    customer   as buyer,      // rename association
    product    as item,       // rename association
    quantity,
    total      as amount,
    status,
    orderDate  as placedOn,
    modifiedAt
};

// 4. Entity-level rename — same remote data, different local purpose
// Remote "Customers" → local "Suppliers"
// In a procurement context, the same companies are "suppliers" not "customers"
@federation.delegate
entity Suppliers as projection on remote.Customers {
    ID    as supplierId,
    name  as companyName,
    city  as headquarters,
    country as region,
    email as contactEmail
};
```

From each projection, the plugin infers:

- **Source service / entity** from the `projection on remote.X` clause
- **Projected columns** for `$select` restriction (bandwidth optimization)
- **Bidirectional rename mapping** (`localToRemote` / `remoteToLocal`) from `as` clauses
- **Strategy** from the annotation name

A delegate query against `Products` translates `$filter=unitPrice gt 100` to `$filter=price gt 100` on the remote, then maps `price` → `unitPrice` in the response. A query against `Suppliers` translates `$filter=companyName eq 'Acme'` to `$filter=name eq 'Acme'` on the remote Customers entity.

!!! quote "Principle"
    The consumption view is the schema contract. The annotation is the runtime behavior.

## Additional patterns

### Excluding columns

```cds
@federation.delegate
entity CustomersLight as projection on remote.Customers excluding { email, phone };
```

Excluded fields are recorded in the view mapping and omitted from `$select` in remote calls — the plugin never fetches them, even when `$select` is absent on the incoming request.

### Static `where` clauses

```cds
@federation.delegate
entity ActiveCustomers as projection on remote.Customers where blocked = false;
```

CAP's [Consuming Services docs](https://cap.cloud.sap/docs/guides/services/consuming-services#supported-projection-features) explicitly list `where` conditions as **not supported** on projections over remote services. This plugin extracts `projection.where` from the CSN at model load time and injects it into every remote query — a plugin-specific value-add.

## Annotations apply only to consumption views

`@federation.delegate` and `@federation.replicate` are valid **only on a CDS projection of the form `entity X as projection on remote.Y`**. The projection is the federation contract: source service, source entity, projected columns, and bidirectional rename mapping are all inferred from it.

What this rules out:

- **Annotating an imported service entity directly** — `annotate ReviewsService.Reviews with @federation.delegate;` has no projection, so the scanner cannot infer columns or renames. Always wrap in a consumption view.
- **Using plain entities as federation targets** — any entity without an `as projection on <remoteService>.<remoteEntity>` clause is skipped.

The one escape hatch is the explicit `source` option on the annotation, and it is **only** for REST services that have no CDS model:

```cds
@federation.replicate: {
    source: 'RestProvider',
    rest: { path: '/api/customers', pagination: { type: 'offset', pageSize: 100 } }
}
entity ReplicatedRestCustomers { key ID: String(10); name: String(100); ... };
```

Do not use `source` as a general workaround for OData services — it bypasses source inference but also skips the view-mapping extraction needed for cross-service `$expand`, renames, and column restriction. For OData, always project on the imported service.

## See also

- [Terminology](terminology.md) — how "federation", "delegation", and "replication" are used in this plugin vs. elsewhere.
- [Cross-Service Scenarios](cross-service-scenarios.md) — how consumption views enable cross-service `$expand` patterns.
- [cds-data-federation → First Delegation](/federation/getting-started/first-delegation/) — hands-on example.
- [cds-data-federation → Annotations](/federation/reference/annotations/) — complete option reference.
