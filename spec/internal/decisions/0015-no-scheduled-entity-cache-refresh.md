# ADR 0015: No scheduled refresh for the entity cache

**Status:** Accepted
**Date:** 2026-07-11
**Package:** `cds-data-federation`
**Related:** [ADR 0010](./0010-multi-tenancy-entity-cache-and-pipeline-runs.md), [Req 4.3.8](../../reference/requirements.md)

## Context

The entity cache (`@federation.delegate` with `cache: { strategy: 'entity' }`) is a **pull-based (lazy)** read-through cache. A full-entity snapshot is synced into a local SQLite table by a `cds-data-pipeline` pipeline, and reads are served from that table while it is considered fresh.

Freshness is governed by `ttl` and tracked **in process memory** in `EntityCacheRegistry` via a `freshAt` timestamp per entity + tenant:

```js
// packages/cds-data-federation/srv/entity-cache/EntityCacheRegistry.js
isFresh(entityFullName, tenantKey, ttlMs) {
    const entry = this._entries.get(this._key(entityFullName, tenantKey))
    if (!entry || entry.freshAt == null) return false
    if (ttlMs === Infinity) return true
    return Date.now() - entry.freshAt < ttlMs
}
```

The pipeline created by `bindEntityCachePipelines` is registered **without a `schedule`** — it exists only to be invoked on demand. A refresh (`DataPipelineService.execute(...)` → `registry.markFresh(...)`) is triggered lazily, only when a READ finds the snapshot stale (`isFresh() === false`).

The question raised: should the entity cache also support a **periodic schedule** so the snapshot is refreshed proactively and no user request ever pays the reload wait time?

The building blocks for this already exist:

- `EntityCacheCoordinator.refreshEntity(entityFullName, tenant)` — refreshes **and** calls `markFresh` (so it bridges freshness state, unlike a raw pipeline schedule).
- `EntityCacheCoordinator.startIntervals()` — already runs in-process `setInterval` timers for prune + stats; a refresh timer would fit here.
- `EntityCacheCoordinator.preloadOnBoot()` / `preloadForTenant(tenant)` — proactive warming at boot and tenant-subscribe.
- `tenant-provider.listSubscribedTenants()` — tenant enumeration for MT fan-out.

So a scheduled refresh is technically small to add. It is deliberately **not** built for the reasons below.

## Decision

**Do not add a scheduled / periodic refresh to the entity cache.** The entity cache stays purely pull-based (TTL read-through), with proactive warming limited to the existing `preload` (boot + tenant-subscribe) hooks.

Reasons:

1. **A raw pipeline `schedule` would not even work correctly.** Setting `schedule` on the entity-cache `addPipeline` call would run the pipeline directly (writing SQLite) but bypass the coordinator/registry, so `freshAt` is never updated. The next read would still see the cache as stale and trigger a *second* full reload — doing the work twice and still paying the wait. Any correct implementation must route through `refreshEntity`, i.e. a coordinator-driven interval, not the engine scheduler.

2. **Multi-instance duplication.** `startIntervals` uses in-process `setInterval`, so with N app instances each fires its own refresh → N× remote load and N× pipeline executions. For a shared `db` target these are redundant writes to the same table; correctness would require leader election or a distributed lock. This is significant complexity for a cache.

3. **It refreshes cold entities.** The point of the lazy design is to fetch only data that is actually read. A timer fetches on a fixed cadence regardless of access, spending remote calls on rarely-read entities — the opposite trade-off from TTL-lazy.

4. **Convergence with `@federation.replicate`.** A scheduled, always-warm local copy queried transparently is essentially what `@federation.replicate` already provides (scheduled sync into a local table). The remaining distinction — transparent live fallback + TTL-bounded read-through — is thin. Consumers who want periodically refreshed local data should use `@federation.replicate`, which is the purpose-built tool.

5. **Cheaper existing mitigations already cover the stated goal** ("no user hits the wait time"):
   - `cache: { wait: false }` — on a stale read, the user is served a live remote query immediately (no wait) while the reload runs in the background.
   - `cache: { preload: true }` — warms the cache at boot and on tenant-subscribe, so the first read is not a miss.
   - `ttl` tuning (including negative `ttl` = never expire once loaded).

## Consequences

- The entity cache remains simple: no leader election, no distributed lock, no scheduled tenant fan-out, no cold-entity fetching.
- The first read after a TTL window (or after a process restart, since `freshAt` is in-memory) can still incur a reload cost, unless the consumer opts into `wait: false` and/or `preload: true`.
- Consumers needing guaranteed always-warm local data on a fixed cadence are directed to `@federation.replicate` rather than an entity-cache schedule.
- If a scheduled refresh is ever revisited, it **must** go through `EntityCacheCoordinator.refreshEntity` (not the pipeline `schedule`) and **must** address multi-instance ownership (leader/lock) and MT fan-out via `listSubscribedTenants`.

## References

- [`packages/cds-data-federation/srv/entity-cache/EntityCacheRegistry.js`](../../../packages/cds-data-federation/srv/entity-cache/EntityCacheRegistry.js) — `isFresh`, `markFresh`, in-memory `freshAt`.
- [`packages/cds-data-federation/srv/entity-cache/entity-cache-coordinator.js`](../../../packages/cds-data-federation/srv/entity-cache/entity-cache-coordinator.js) — `refreshEntity`, `startIntervals`, `preloadOnBoot`, `preloadForTenant`.
- [`packages/cds-data-federation/srv/entity-cache/entity-cache-binding.js`](../../../packages/cds-data-federation/srv/entity-cache/entity-cache-binding.js) — `addPipeline` (no `schedule`).
- [`packages/cds-data-federation/srv/delegation/handler-registration.js`](../../../packages/cds-data-federation/srv/delegation/handler-registration.js) — `registerEntityCachedDelegateHandler`, `runPipelineReload`, `wait` handling.
- [`packages/cds-data-federation/srv/multitenancy/tenant-provider.js`](../../../packages/cds-data-federation/srv/multitenancy/tenant-provider.js) — `listSubscribedTenants`.
- [ADR 0010](./0010-multi-tenancy-entity-cache-and-pipeline-runs.md) — per-tenant SQLite entity cache, tenant fan-out for scheduled runs.
