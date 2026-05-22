# Cross-Service $expand: Concept & Implementation

## Problem

CAP cannot natively resolve `$expand` across service boundaries. When a consumer app has federated entities from a remote service, expanding associations requires manual coding: fetch main entity, collect foreign keys, batch-fetch from remote, stitch results. Our plugin should automate this.

## How CAP Processes $expand

CAP does **not** split `$expand` into separate queries. The OData adapter parses `$expand=buyer` into a CQN column object with an `.expand` property, embedded in `req.query.SELECT.columns`:

```javascript
req.query = {
    SELECT: {
        from: { ref: ['Orders'] },
        columns: [
            '*',
            { ref: ['buyer'], expand: ['*'] }   // ← expand item
        ]
    }
}
```

The handler receives the full query including expand items. CAP expects the handler to return results with the expanded data already nested:

```javascript
[{
    orderId: 'O001',
    buyer: { ID: 'C001', name: 'Acme Corp', ... }  // ← expanded
}]
```

If the handler returns flat results (no `buyer` object), the expand is silently empty.

Ref: [CaLeSi: Navigation & Expands Across Services](https://cap.cloud.sap/docs/guides/integration/calesi)

## Three Expand Scenarios

### Scenario A: Remote → Remote

```
GET /consumer/Orders?$expand=buyer
```
- `Orders` is `@federation.delegate` → delegated to `ProviderService.Orders`
- `buyer` association (renamed from `customer`) points to `ProviderService.Customers`
- **Both entities live on the same remote service**
- **Status:** A1-A7 all passing

**Approach:** CAP handles this entirely via `remote.run(req.query)`. The CDS projection chain tells CAP how to translate `buyer` → `customer`, forward the expand, and map results back. No plugin code needed for Scenario A.

```
Consumer                          Provider (via CAP's projection chain)
Orders?$expand=buyer    →    Orders?$expand=customer
                        ←    [{ID:'O001', customer:{ID:'C001', name:'Acme'}}]
CAP maps result:        →    [{orderId:'O001', buyer:{ID:'C001', name:'Acme'}}]
```

**Complexity:** None for the plugin. CAP's native query translation handles it.

### Scenario B: Local → Remote

```
GET /consumer/Reviews?$expand=product
```
- `Reviews` is a local entity (stored in consumer's DB)
- `product` association points to `Products` (delegated to `ProviderService.Products`)

**Approach:** CAP reads Reviews from local DB. When it encounters the `product` expand, it needs to resolve it from the remote. Since our plugin registers a READ handler on `Products`, CAP's expand resolution should trigger our handler for the association target. However, CAP's DB service handles expand via correlated SQL subqueries — which won't work for remote data.

The plugin needs to intercept this and implement the manual pattern:
1. Let CAP read Reviews from local DB (without the expand)
2. Collect `product_ID` foreign keys from results
3. Batch-fetch Products from remote service
4. Stitch product data into review results

```
Consumer DB                    Provider
SELECT from Reviews     →
← [{ID:.., product_ID:'P001'}, {ID:.., product_ID:'P002'}]

                               GET Products?$filter=ID in ('P001','P002')
                        ←      [{ID:'P001', name:'Laptop Pro', ...}]

stitch:                 →      [{ID:.., product: {productId:'P001', productName:'Laptop Pro'}}]
```

**Complexity:** Medium. Requires intercepting the expand, splitting the query, and stitching.

### Scenario C: Remote → Local

```
GET /consumer/Customers('C001')?$expand=bookmarks
```

This scenario is currently **not in our model** — the provider's Customers entity doesn't know about local Bookmarks. To support this, we'd need to:
1. Extend the remote entity with a local association (unmanaged)
2. Fetch the main entity from remote
3. Fetch the local expansion from the consumer's DB

This is an advanced scenario for later phases. For now, we focus on A and B.

## Implementation Design

### Scenario A: Remote → Remote (CAP-native)

**No plugin code needed.** CAP's runtime handles Scenario A entirely through the CDS projection chain when `remote.run(req.query)` is called. This includes:
- Translating association names (e.g., `buyer` → `customer`)
- Forwarding $expand to the remote service
- Mapping expanded results back through the target entity's projection (e.g., Products' `ID→productId`, `name→productName`)
- Handling nested expands, $select within expands, and to-many associations

This was confirmed by the A1-A7 test suite: all pass with the simplified `remote.run(req.query)` handler.

### Scenario B: Local → Remote (batch-fetch and stitch — plugin-specific)

**What changes:**

For local entities that have associations to federated entities, the plugin needs to register an `after('READ')` handler that:
1. Inspects the original query for expand items pointing to federated entities
2. Collects foreign key values from the results
3. Batch-fetches the expanded entities from the remote service (using the delegate handler's logic)
4. Stitches the fetched data into the results as nested objects

This handler runs on the local entity's service, not on the federated entity.

### Caching Integration Point

Every remote call during expand resolution is independently cacheable:

**Scenario A (remote→remote):** The full query including expand is one remote call. Cache the entire response with `cds-caching`.

**Scenario B (local→remote):** The batch-fetch of expanded entities is a separate remote call. Cache it independently. The local DB query is not cached by the plugin (that's the DB's job).

The caching layer wraps the remote service call, not the expand resolution logic. This means caching is transparent — the expand handler calls the delegate handler which is optionally wrapped with cache. No special caching code in the expand logic.

```
$expand resolution
    → delegate handler (for expanded entity)
        → [cache wrapper] (if @federation.delegate: { cache: { ttl: ... } })
            → remote.run(query)
```

## Test Scenarios

### Scenario A tests (remote → remote)

All entities are `@federation.delegate` on the same remote provider. CAP handles the expand natively via `remote.run(req.query)`.

| # | Test | Request | Status | Validates |
|---|---|---|---|---|
| A1 | Orders → buyer (to-one, renamed assoc) | `Orders?$expand=buyer` | **passing** | CAP translates buyer→customer, maps result back |
| A2 | Orders → item (to-one, renamed assoc + renamed fields) | `Orders?$expand=item` | **passing** | CAP translates item→product, maps inner fields (productId, productName, unitPrice) |
| A3 | Customers → orders (to-many) | `Customers('C001')?$expand=orders` | **passing** | Array of orders nested under customer |
| A4 | Orders → buyer,item (multiple expands) | `Orders?$expand=buyer,item` | **passing** | Both associations expanded in single request |
| A5 | Nested expand | `Orders('O001')?$expand=buyer($expand=orders)` | **passing** | Recursive: order.buyer.orders |
| A6 | $expand with $select | `Orders?$expand=buyer($select=ID,name)` | **passing** | Only selected fields in expanded data |
| A7 | Single entity with expand | `Orders('O001')?$expand=buyer` | **passing** | Single order with expanded buyer |

### Scenario B tests (local → remote)

Main entity is local, expanded entity is remote/federated.

| # | Test | Request | Status | Validates |
|---|---|---|---|---|
| B1 | Reviews → product (local → delegate) | `Reviews?$expand=product` | **passing** | Product data fetched from remote, stitched into local reviews |
| B2 | Bookmarks → customer (local → delegate) | `Bookmarks?$expand=customer` | **passing** | Customer data fetched from remote |
| B3 | Reviews → product with $select | `Reviews?$expand=product($select=productId,productName)` | **passing** | Only selected fields fetched |

Note: B tests require seed data for Reviews and Bookmarks in the consumer DB.

## View Mapping Registry

To support rename translation across entities during expand, the plugin needs a registry:

```javascript
// Built during annotation scanning, stored globally
const viewMappingRegistry = {
    'consumer.Customers': { isWildcard: true, localToRemote: {}, remoteToLocal: {} },
    'consumer.Products':  { 
        isWildcard: false,
        projectedColumns: ['ID', 'name', 'category', 'price', 'currency'],
        localToRemote: { productId: 'ID', productName: 'name', unitPrice: 'price' },
        remoteToLocal: { ID: 'productId', name: 'productName', price: 'unitPrice' }
    },
    'consumer.Orders': {
        isWildcard: false,
        projectedColumns: ['ID', 'customer', 'product', 'quantity', 'total', 'status', 'orderDate', 'modifiedAt'],
        localToRemote: { orderId: 'ID', buyer: 'customer', item: 'product', amount: 'total', placedOn: 'orderDate' },
        remoteToLocal: { ID: 'orderId', customer: 'buyer', product: 'item', total: 'amount', orderDate: 'placedOn' }
    },
    'consumer.Suppliers': {
        isWildcard: false,
        projectedColumns: ['ID', 'name', 'city', 'country', 'email'],
        localToRemote: { supplierId: 'ID', companyName: 'name', headquarters: 'city', region: 'country', contactEmail: 'email' },
        remoteToLocal: { ID: 'supplierId', name: 'companyName', city: 'headquarters', country: 'region', email: 'contactEmail' }
    }
}
```

**Note:** Both `consumer.Customers` and `consumer.Suppliers` project on `ProviderService.Customers`. The registry also stores entries keyed by source (`ProviderService.Customers`), where the last-registered mapping wins. This is a known limitation — entity-full-name keys remain distinct and are used for most lookups.

**Scenario A (CAP-native):** When expanding `Orders.buyer` or `Orders.item`, CAP handles the full translation pipeline automatically through `remote.run(req.query)`. No plugin code, no registry lookups needed.

**Scenario B (plugin):** The view mapping registry is still used by `resolveFederatedExpand()` for manual field mapping during batch-fetch + stitch operations (because CAP cannot resolve $expand across service boundaries).

## Implementation Status

| Phase | Status |
|---|---|
| Scenario A: Remote→remote expand | **Done** — CAP handles natively via `remote.run(req.query)` |
| Scenario B: Local→remote expand | **Done** — `registerLocalExpandResolvers()` with batch-fetch + stitch |
| View mapping registry | **Done** — only needed for Scenario B |
| Caching integration | **Done** — cache wraps remote calls during expand transparently |
| Scenario C: Remote→local expand | **Done** — `resolveRemoteToLocalExpands()` with local DB query + stitch |
| Cross-service navigation (4.2.12) | **Done** — N1 local→remote, N2 remote→local via `cross-service-navigation.js` |

## See also

Task-focused walkthroughs that demonstrate these scenarios in practice:

- [Joining Local with Remote](../getting-started/joining-local-with-remote.md) — Scenario B expand + cross-service navigation (N1) + cross-service `$filter`, with sequence diagrams and gotchas.
- [Extending Remote with Local](../getting-started/extending-remote-with-local.md) — Scenario C expand + cross-service navigation (N2).
- [Cross-Provider Mashup](../getting-started/cross-provider-mashup.md) — Scenario B across two remote services, resolved by two independent batch-fetches.
