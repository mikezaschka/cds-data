# Local Analytics over Replicated Data

This is the payoff page for replication. Once remote data lives in the local DB, the full power of SQL is on the table: aggregations, joins, grouping, distinct, window functions — everything that OData simply can't express against a delegated entity.

## When to use this pattern

- You need analytical queries (counts, sums, averages, top-N by group) over remote data.
- You need to **join** remote reference data against fully local tables for reports and dashboards.
- The remote service is a transactional system that can't handle analytical workload, or has quotas, or has no OData `$apply` support.

## The setup

Replicate the remote entity once with a schedule:

```cds title="db/schema.cds"
using { ProviderService as remote } from '../srv/external/ProviderService';

@federation.replicate: { delta: { field: 'modifiedAt' } }
entity ReplicatedProducts as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// Plain local entity — stored in the same DB
entity Reviews {
    key ID        : UUID;
        product   : Association to ReplicatedProducts;
        rating    : Integer;
        comment   : String(500);
        author    : String(100);
        createdAt : Timestamp;
}
```

Both tables live side-by-side in SQLite or HANA. `product` is a managed association; CAP materializes `product_productId` on the `Reviews` table.

## Query capabilities unlocked

### Aggregations / GROUP BY

```javascript
const avgByCategory = await SELECT
    .from('ReplicatedProducts')
    .columns('category', { sum: 'unitPrice', as: 'total' }, { count: 1, as: 'n' })
    .groupBy('category');
```

Against a delegate this fails — [CAP's `cqn2odata` rejects `.groupBy` for remote services](/pipeline/guide/sources/odata). Against a replicated table it's a plain SQL `GROUP BY`.

### Joins to fully local tables

```javascript
const ratings = await SELECT
    .from('ReplicatedProducts as p')
    .columns('p.category', 'p.productName', { avg: 'r.rating', as: 'avgRating' })
    .join('Reviews as r').on('r.product_productId =', { ref: ['p.productId'] })
    .groupBy('p.category', 'p.productName')
    .having({ 'avg(r.rating)': { '>=': 4 } });
```

This is an ordinary SQL JOIN — both tables are in the same DB. Doing the same against a delegate would require fetching all products over the wire, all reviews locally, and joining in application memory.

### `$apply` over OData

Fiori Elements analytics cards and the `$apply` query option work directly:

```http
GET /consumer/ReplicatedProducts?$apply=groupby((category),aggregate(unitPrice with sum as total))
```

CAP translates `$apply` to `GROUP BY` SQL on the local table.

### `DISTINCT`

```javascript
const categories = await SELECT.distinct.from('ReplicatedProducts').columns('category');
```

`SELECT.distinct` [is explicitly rejected for delegated entities](/pipeline/guide/sources/odata) — OData has no `DISTINCT` keyword. On replicated data it's trivial.

### `LIKE` and other SQL-native operators

```javascript
const widgets = await SELECT.from('ReplicatedProducts').where({
    productName: { like: '%Widget%' }
});
```

OData has no `like` keyword so this fails against a delegate; `contains(...)` has to be used instead. On replicated data the full SQL operator set is available.

### Joins spanning remote and local in one query

The most impactful win is cross-domain analytics. Average rating per replicated product category, filtered to only products with at least three reviews, sorted by rating:

```sql
SELECT
    p.category,
    COUNT(DISTINCT p.productId) AS products,
    AVG(r.rating)               AS avgRating
FROM   ReplicatedProducts p
  JOIN Reviews r ON r.product_productId = p.productId
GROUP BY p.category
HAVING  COUNT(r.ID) >= 3
ORDER BY avgRating DESC;
```

Expressed as CAP-native CQL it stays under ten lines; no plugin intervention needed — it's just SQL against the local DB.

## Under the hood

The replicated entity is just a CAP entity with `@cds.persistence.table` and `@cds.persistence.skip: false` (the annotation scanner sets these automatically for `@federation.replicate`). At runtime it looks identical to any other local table to the CAP query engine. The only difference is that data lands there via the replication pipeline (READ → MAP → WRITE) instead of application writes.

For the pipeline internals, see [Service Query Execution](../concepts/service-query-execution.md).

## Gotchas

- **Freshness depends on schedule.** Analytics are only as up-to-date as the last replication run. Add a `schedule: '*/5 * * * *'` option and/or trigger manual runs via the management service. See [First Replication](first-replication.md) for delta sync setup.
- **OData exposure of replicated entities is currently limited.** Direct `GET /consumer/ReplicatedCustomers` over HTTP returns 404 — the plugin does not yet register a READ handler for replicated entities. Access is via CQL (`cds.run(SELECT.from(...))`) only. Until this lands you can also expose the replicated table through a thin wrapper projection (`entity Customers as projection on ReplicatedCustomers;`) in a service.
- **Storage costs** — you're copying remote data. Consider column restriction in the projection (`{ ID as productId, name as productName, ... }`) to only replicate what you actually need.
- **Schema evolution** — when the remote adds a field, the local schema does not auto-update. Redeploy the replicated entity to include the new column, then trigger a full sync (`mode: 'full'`) to backfill.
- **Consistency windows** — if you replicate on a 5-minute schedule and take an analytical snapshot at `12:00:03`, half your data may be from the 11:55 run and half from the 12:00 run if they overlap. The plugin's concurrency guard prevents **simultaneous** runs of the same replication, but not cross-replication drift.

## See also

- [First Replication](first-replication.md) — minimal setup and delta sync.
- [Mixing Delegate and Replicate](mixing-delegate-and-replicate.md) — when to pick replicate vs delegate.
- [cds-data-pipeline → OData limitations](/pipeline/guide/sources/odata) — CQL features unsupported on OData remotes.
- [cds-data-pipeline → Management Service](/pipeline/reference/management-service) — schedule, run, and monitor replications.
