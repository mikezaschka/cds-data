# Mixing Delegate and Replicate

The two federation strategies are not mutually exclusive — they are tools for different jobs. High-churn data that must always be fresh is a delegation candidate. Reference data that changes slowly and is read frequently is a replication candidate. A single service can expose both side-by-side.

## When to use this pattern

- **Delegate** for data that needs to be strictly consistent with the source and changes often — live pricing, order status, stock levels, user sessions.
- **Replicate** for reference data you query a lot but don't own — customer master, product catalog, country codes, categories.
- You want the user-facing API to look like a single service, not a collection of mismatched patterns.

This mirrors CAP's [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) which presents delegation and "data federation" (its term for replication) as complementary patterns under one umbrella.

## The CDS model

Two projections on the same remote service, each carrying a different `@federation.*` annotation:

```cds title="db/schema.cds"
using { ProviderService as remote } from '../srv/external/ProviderService';

// DELEGATE — live prices, read forwards to remote per request.
// Always fresh, but every read is a remote call.
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
};

// REPLICATE — customer master, copied into local DB on a schedule.
// Fast local reads, supports SQL features delegates can't, but is only
// as fresh as the last sync run.
@federation.replicate
entity ReplicatedCustomers as projection on remote.Customers excluding { orders };
```

Both annotations produce consumption views in the same CDS namespace; nothing in the service definition reveals the strategy to the client.

## How the two behave at runtime

=== "Reading `Products` (delegate)"

    ```http
    GET /consumer/Products?$filter=category eq 'Electronics'
    ```

    Every call triggers a remote request to `ProviderService`. CAP translates the CQL/OData query through the projection chain (renames, column restriction, filter rewrites). The response is mapped back to local field names and returned. Zero local storage; source of truth is always the remote.

=== "Reading `ReplicatedCustomers` (replicate)"

    ```http
    GET /consumer/ReplicatedCustomers?$filter=country eq 'DE'
    ```

    Served from the app's local DB with plain SQL. The remote is not touched on the read path. Data is refreshed in the background by a scheduled or manually-triggered replication run.

### Triggering replication

Replication runs on a schedule (if configured) or on demand via the pipeline management service at `/pipeline`:

```http
POST /pipeline/execute
Content-Type: application/json

{ "name": "ReplicatedCustomers", "mode": "full" }
```

Or programmatically from your own code:

```javascript
const repl = await cds.connect.to('data-pipeline');
await repl.run('ReplicatedCustomers');
```

See the [cds-data-pipeline Management Service](/pipeline/reference/management-service) for the full API surface (run, flush, status).

## Crossing the boundary between strategies

You can freely associate across strategies:

```cds
// Local entity bridging delegate and replicate
entity PriceAlerts {
    key ID       : UUID;
        product  : Association to Products;               // delegated — live price
        customer : Association to ReplicatedCustomers;    // replicated — cached master
        threshold: Decimal(10, 2);
}
```

A query like `GET /PriceAlerts?$expand=product,customer` will:

- For `product`: cross-service expand (local → remote) batch-fetch against the remote Products service.
- For `customer`: a local SQL join against the replicated customer table (no remote call).

The plugin detects the strategy per expand target; you don't pick the fetch path, the annotation does.

## When to pick which

| Signal | Delegate | Replicate |
|---|---|---|
| Data must reflect remote writes **immediately** | yes | no (sync lag) |
| High read volume, low write volume | so-so (cache helps) | yes |
| Need SQL features: `GROUP BY`, `$apply`, `JOIN` to local tables, `DISTINCT` | no (OData limits apply) | yes |
| Must work offline / during remote outage | no | yes |
| Remote service has rate limits or per-call costs | no (or cache) | yes |
| Sensitive data that must not be stored locally | yes | no |
| Dataset is very large (millions of rows) | yes | depends on schema |

If you want the best of both: replicate and cache. But start simple — delegate until you have a concrete reason to copy the data.

## Gotchas

- **Writes to a replicated entity don't flow back.** By default, replicated tables are read-only mirrors. A `POST /ReplicatedCustomers` writes to the local table, but the next replication run will treat the remote as the source of truth and may overwrite the change. If you need bidirectional sync, that's a different pattern and not yet supported.
- **Delegate CUD is synchronous; replicate sync is scheduled.** Don't expect them to be symmetric. `PATCH /Products(...)` forwards live to the remote; `POST /ReplicatedCustomers` only writes local.
- **`$expand` from delegate to replicate** works as a cross-service expand (local → remote, batch-fetch) *even though the target is a local table*, because the plugin treats any annotated entity as a federation target. Performance is fine but it's an extra lookup hop — sometimes a plain CAP JOIN would be faster. This is why plain local entities (not annotated) are preferable as join targets when possible.
- **Schedule drift.** `PipelineRuns` tracks every run with start/end timestamps and record counts. Monitor it; a silently failing job is the most common cause of stale data.

## See also

- [First Replication](first-replication.md) — the minimal replicate setup.
- [First Delegation](first-delegation.md) — the minimal delegate setup.
- [Local Analytics over Replicated Data](local-analytics-over-replicated.md) — what becomes possible once data is replicated.
- [cds-data-pipeline Management Service](/pipeline/reference/management-service) — run, flush, status endpoints.
- [Annotations Reference](../reference/annotations.md) — every option on both annotations.
