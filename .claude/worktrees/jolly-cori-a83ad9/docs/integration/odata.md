# OData V2 / V4

## Protocol support matrix

| Protocol | `cds.requires.<service>.kind` | Delegate | Replicate | Notes |
|---|---|---|---|---|
| OData V4 | `odata` | yes | yes | CAP-native CQN translation. Default. |
| OData V2 | `odata-v2` | yes | yes | CAP-native. V2 returns decimals / `$count` as strings; plugin handles conversion where needed. |
| HCQL | `hcql` | yes | yes | CAP-native protocol (xtravels sample). |
| REST | `rest` | **no** | yes | CAP does not translate CQN to REST. Use `@federation.replicate` with the [REST adapter](rest.md). |

## OData V4

The default case. Configure the remote service in `cds.requires`:

```json title="package.json"
{
  "cds": {
    "requires": {
      "API_BUSINESS_PARTNER": {
        "kind": "odata",
        "model": "./srv/external/API_BUSINESS_PARTNER",
        "credentials": { "url": "https://..." }
      }
    }
  }
}
```

Then annotate consumption views in the usual way. All query translation (`$filter`, `$select`, `$orderby`, `$expand`, column restriction) is handled by CAP natively through the projection chain.

### Supported query features

- `$filter` operators: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`, `and`, `or`, `not`.
- String functions: `contains`, `startswith`, `endswith`, `tolower`, `toupper`.
- `$orderby`, `$select`, `$top`, `$skip`, `$count`, `$search`.
- Lambda operators: `any()`, `all()` — including cross-service (Scenario B).
- Navigation path filters with renamed associations (e.g., `buyer/name` → `customer/name`).
- Cross-service navigation filters on local entities that reference federated entities.
- `$expand` — all three scenarios. See [`$expand` Scenarios](../concepts/expand-scenarios.md).

### Server-driven paging

Some OData services cap the number of rows returned per request regardless of `$top` — Northwind, for example, returns at most 20 rows per page and signals the next page via `@odata.nextLink`. For **delegate** entities, the plugin auto-loops the remote via `$top` / `$skip` until the client's requested rows are collected or the remote returns an empty batch. `@odata.count` from the first batch is preserved. This is always on and requires no configuration.

For **replicate** entities, the OData adapter paginates the same way during sync: it requests `batchSize` rows per page (default `1000`) and keeps paging by `$skip` until the remote returns empty, so a smaller server-enforced cap never causes silent truncation. See [`@federation.replicate` options](../reference/annotations.md#replicate-only-options) for `batchSize`.

## OData V2

Use `kind: 'odata-v2'`. The plugin runs the same delegation pipeline — the difference is purely at the wire level.

```json
{
  "cds": {
    "requires": {
      "LegacyService": {
        "kind": "odata-v2",
        "model": "./srv/external/LegacyService"
      }
    }
  }
}
```

### V2-specific limitations

| Feature | V2 behavior |
|---|---|
| Nested `$expand` options (`$filter`, `$orderby`, `$top`, `$skip` inside an expand) | **Not supported** by the V2 protocol itself. These work on V4 only. |
| `$count` | Returns a string; the plugin converts to `Number`. |
| Decimals | Returned as strings; CAP handles conversion. |

For apps that must integrate a V2 service (S/4HANA's older SOAP-over-HTTP endpoints, legacy Gateway services), the `@cap-js-community/odata-v2-adapter` package is the recommended companion when serving V2 endpoints out of CAP.

## HCQL

SAP's own Cloud Query Language protocol (e.g., xtravels sample). Use `kind: 'hcql'`. HCQL has no gaps versus OData V4 for federation purposes — everything works identically.

## CQL via the projection chain

`SELECT.from(FederatedEntity)` routes through the CAP runtime, CQN is translated to an OData URL by `cqn2odata`, and the response is mapped back.

### What works

- `SELECT.one`, `.columns()`, `.where()` (eq / ne / gt / ge / lt / le / in / boolean / AND / OR / ranges), `.orderBy()`, `.limit()`.
- Key shortcuts: `SELECT.from(Entity, key)`.
- Projection functions / arrow syntax.
- `$expand` scenarios A / B / C via nested projections.
- `cds.ql` tagged template literals.

### What doesn't work on remote services

Platform-level CAP limitations (not plugin-specific):

| Feature | Why | Workaround |
|---|---|---|
| `.where({ field: { like: '%X%' } })` | OData `$filter` has no `like` keyword | Use `contains(...)`, `startswith(...)`, `endswith(...)` via HTTP `$filter`. |
| `SELECT.distinct` | CAP's `cqn2odata` rejects `.distinct` | Deduplicate in app code, or replicate and use local SQL. |
| `.groupBy()` / `.having()` / `$apply` | CAP rejects aggregation on remote services | Aggregate in app code, or replicate and use local SQL. |
| `forUpdate()` / `forShareLock()` | DB concept, not OData | Use ETags for optimistic concurrency. |
| `pipeline()` / `stream()` / `foreach()` | Only implemented by `DatabaseService` | Fetch the full result set. |

## Authentication

The plugin does not touch credential handling. Use CAP's standard mechanisms:

- `credentials` block in `cds.requires.<service>`.
- SAP Cloud SDK destination binding (BTP).
- JWT principal propagation.
- Service bindings via `~/.cds-services.json` for local development.

Any auth setup that works with plain `cds.connect.to(...)` + `srv.run(...)` works transparently through `@federation.delegate` — there's no intermediary.

## See also

- [Concepts → `$expand` Scenarios](../concepts/expand-scenarios.md) — detailed scenario A / B / C flow.
- [Integration → REST Adapter](rest.md) — for services without a CDS model.
- [Integration → cds-caching](caching.md) — response caching on top of delegation.
