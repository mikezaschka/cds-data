# 10. Multi-tenancy — per-tenant SQLite entity cache and tenant-scoped pipeline runs

**Date:** 2026-05-22
**Status:** Accepted
**Related:** [Req §4.15](../../reference/requirements.md), [Req 4.3.8](../../reference/requirements.md), [ADR 0001](./0001-replication-service-extends-cds-service.md), [replication-cache-analysis](../research/replication-cache-analysis.md)

## Context

CAP multi-tenancy (`@sap/cds-mtxs`) isolates tenant data at the database level. The federation entity cache (`cache.strategy: 'entity'`) initially used a **shared** SQLite file with a synthetic `tenantId` column and query rewrite. That model:

- Does not match CAP MTX semantics (per-tenant DB containers).
- Risks cross-tenant leakage when `cds.context.tenant` is missing (empty-string bucket).
- Differs from `@cap-js-community/common` Replication Cache (per-tenant SQLite files).

Scheduled `@federation.replicate` and `@materialize.snapshot` pipelines run via `cds.spawn` / `cds.queued` without tenant context, so writes in MTX SaaS hit the wrong database.

Requirements [4.15.1](../../reference/requirements.md) and [4.15.2](../../reference/requirements.md) track tenant-aware replication and tenant-specific config.

## Decision

### 1. Entity cache — per-tenant SQLite files (no `tenantId` column)

- Remove the synthetic `tenantId` key from injected `plugin.data_federation.entity_cache.*` entities.
- Resolve a **separate SQLite file per tenant** via `EntityCacheDbResolver`:
  - URL template default: `federation-entity-cache-{tenant}.sqlite`
  - Single-tenant / dev fallback tenant id: `default`
- Deploy cache schema into each tenant file on first access.
- Pipeline refresh: **truncate** the cache entity in the current tenant's file (not `deleteSlice` by column).

### 2. `@federation.replicate` → main `db` in MTX

Rely on CAP native per-tenant DB containers. Plugin responsibility: execute pipelines **inside tenant context** (`cds.run({ tenant }, …)`).

### 3. Scheduled runs — tenant fan-out

`TenantRunCoordinator` enumerates subscribed tenants and runs each pipeline once per tenant when MTX is active and `fanOutScheduledRuns !== false`.

### 4. MTX lifecycle hooks (optional, config-gated)

- **Subscribe (after):** initial replicate sync per `@federation.replicate` pipeline when `multitenancy.syncOnSubscribe: true`.
- **Unsubscribe (after):** optional flush of entity-cache sqlite file and pipeline state.

### 5. Response cache — auto tenant tags

When multitenancy is active, auto-inject `tenant-{{tenant}}-entity-{{entity}}` cache tag unless `cache.tenantScoped: false`.

### 6. Tenant-specific config (4.15.2 v1)

`cds.env` overrides under `cds.requires['cds-data-federation'].multitenancy.tenants.<tenantId>` for replicate schedule/mode. No per-tenant CDS annotation syntax in v1.

## Consequences

### Breaking change

Existing entity-cache deployments with `tenantId` column must flush caches and redeploy. Documented in caching integration guide.

### New modules

| Module | Package |
|---|---|
| `EntityCacheDbResolver` | `cds-data-federation` |
| `TenantRunCoordinator` | `cds-data-pipeline` |
| `tenant-provider`, `mtx-hooks` | `cds-data-federation` |

### Pipeline flags

- **Remove:** `entityCacheTenantScoped`, `entityCacheTenantField`
- **Add:** `entityCachePerTenantDb: true`

### Non-goals (v1)

- Per-tenant CDS annotation overrides on consumption views
- Custom credential store for remotes (use CAP destination + SaaS dependencies)
- LRU eviction of idle tenant SQLite connections (optional follow-up)

## References

- [CAP Multitenancy guide](https://cap.cloud.sap/docs/guides/multitenancy/)
- [replication-cache-analysis](../research/replication-cache-analysis.md) §Per-Tenant SQLite Isolation
