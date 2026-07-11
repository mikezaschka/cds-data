# Multi-Tenancy (CAP MTX)

`cds-data-federation` and `cds-data-pipeline` support SaaS multi-tenancy when CAP multitenancy is active ([`@sap/cds-mtxs`](https://www.npmjs.com/package/@sap/cds-mtxs)). Tenant isolation is enforced for the entity cache (one SQLite file per tenant), scheduled replication (fan-out per subscribed tenant), and pipeline run history.

## Entity cache — per-tenant SQLite files

With `cache.strategy: 'entity'`, declaring a dedicated SQLite datastore switches the entity cache from the primary `db` to **one SQLite file per tenant**. Declaring the service is the trigger; `entityCache` options only tune naming/location:

```json
{
  "cds": {
    "requires": {
      "federation-entity-cache": { "kind": "sqlite" },
      "cds-data-federation": {
        "entityCache": {
          "urlTemplate": "federation-entity-cache-{tenant}.sqlite",
          "defaultTenant": "default",
          "baseDir": "."
        }
      }
    }
  }
}
```

For the full storage-selection rules (default `db` vs dedicated files, custom service names, and why `cache.service` doesn't apply here), see [Caching → Where the entity cache is stored](./caching.md#where-the-entity-cache-is-stored).

| Option | Default | Purpose |
|---|---|---|
| `entityCache.urlTemplate` | `federation-entity-cache-{tenant}.sqlite` | File name pattern per tenant |
| `entityCache.defaultTenant` | `default` | Fallback when no request tenant (single-tenant dev) |
| `entityCache.baseDir` | project root | Directory for SQLite files |

Each tenant gets an isolated file. There is **no** `tenantId` column in cache tables (breaking change vs. earlier previews — flush old cache files on upgrade).

## `@federation.replicate` → main `db`

Under MTX, CAP routes the primary `db` service to per-tenant containers automatically. The plugin's job is to **run pipelines inside tenant context** so reads and writes hit the correct tenant database.

Scheduled cron / Job Scheduler runs fan out to all subscribed tenants when multitenancy is active:

```json
{
  "cds-data-pipeline": {
    "multitenancy": {
      "active": true,
      "fanOutScheduledRuns": true
    }
  }
}
```

`DataPipelineService.executeForTenant(tenant, name, opts)` and `execute(name, { tenant, ... })` pass the tenant id through to entity-cache targets without mutating the HTTP request context.

## Response cache tenant tags

When `cds.requires.multitenancy === true` or `cds-data-federation.multitenancy.active === true`, delegate response caches automatically include a `tenant-{{tenant}}-entity-{{entity}}` tag (opt out with `cache.tenantScoped: false` on the annotation).

## MTX subscribe / unsubscribe hooks (optional)

Wire in your mtx sidecar (`mtx/sidecar/server.js`):

```javascript
const { registerMtxDeploymentHooks } = require('cds-data-federation/srv/multitenancy/mtx-hooks')
registerMtxDeploymentHooks()
```

| Config flag | Hook | Action |
|---|---|---|
| `multitenancy.syncOnSubscribe: true` | `DeploymentService.subscribe` (after) | Run all `@federation.replicate` pipelines for the new tenant |
| `multitenancy.flushOnUnsubscribe: true` | `DeploymentService.unsubscribe` (after) | Delete the tenant's entity-cache SQLite file |

## Per-tenant replicate overrides (4.15.2)

Override mode or trigger per tenant under `cds.env`:

```json
{
  "cds-data-federation": {
    "multitenancy": {
      "tenants": {
        "t1": { "replicate": { "Movies": { "mode": "full" } } },
        "t2": { "replicate": { "Movies": { "mode": "delta" } } }
      }
    }
  }
}
```

Keys under `replicate` match the pipeline / entity short name. Schedule overrides use the same structure with a `schedule` field (consumed by `TenantRunCoordinator.resolveTenantExecuteOpts`).

## External Job Scheduler (JSS)

For BTP Job Scheduler, emit one job per tenant or call `POST /pipeline/execute` with `{ "name": "...", "tenant": "t1" }` for each subscribed tenant. See [Pipeline → External scheduling](/pipeline/guide/recipes/external-scheduling-jss.md).

## See also

- [Integration → Caching](./caching.md) — entity vs. response cache strategies.
- [cds-data-pipeline multitenancy](/pipeline/) — engine-level fan-out and `executeForTenant`.
