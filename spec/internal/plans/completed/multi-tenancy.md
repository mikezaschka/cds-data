# Plan: CAP Multi-Tenancy (§4.15 + entity-cache refactor)

**Status:** Completed (2026-05-22)
**ADR:** [0010-multi-tenancy-entity-cache-and-pipeline-runs.md](../decisions/0010-multi-tenancy-entity-cache-and-pipeline-runs.md)

## Overview

Replace entity-cache row-level `tenantId` isolation with per-tenant SQLite files; add tenant-context pipeline execution, scheduled fan-out, MTX hooks, tenant config overrides, and response-cache tenant tags.

## Tasks

### Phase 0
- [x] ADR 0010
- [x] This plan doc
- [x] Set §4.15 to In progress in requirements.md

### Phase 1 — Per-tenant SQLite entity cache
- [ ] `EntityCacheDbResolver.js` — URL template, connect, deploy-on-first-access
- [ ] Remove `tenantId` from `cache-schema.js`
- [ ] Update `entity-cache-binding.js` — sanitize writes only, `entityCachePerTenantDb` flag
- [ ] Update `query-rewrite.js` — drop tenant predicate
- [ ] Update `handler-registration.js` — resolver-based READ
- [ ] Update `Pipeline.js` + `DbTargetAdapter.js` — truncate per tenant db
- [ ] Test `[4.3.8] EC2` cross-tenant isolation

### Phase 2 — Tenant-context pipeline execution
- [ ] `DataPipelineService.executeForTenant`
- [ ] `TenantRunCoordinator.js` + scheduler fan-out

### Phase 3 — MTX lifecycle (4.15.1)
- [ ] `tenant-provider.js`
- [ ] `mtx-hooks.js`
- [ ] Integration tests for tenant fan-out

### Phase 4 — Tenant-specific config (4.15.2)
- [ ] `cds.env` per-tenant replicate overrides in coordinator

### Phase 5 — Response cache
- [ ] Auto tenant template tags in `normalizeTags`

### Phase 6 — Docs
- [ ] requirements.md, features.md, caching.md, multitenancy.md, README
- [ ] `npm run sync:requirements`

## Validation

```bash
npm run test:federation -- --testNamePattern "EC1|EC2|4.15"
npm run test:pipeline -- --testNamePattern "tenant|multitenan"
npm run lint
npm test
```
