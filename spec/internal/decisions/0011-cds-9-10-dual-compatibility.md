# 11. CDS 9 / CDS 10 dual runtime compatibility

**Date:** 2026-07-04
**Status:** Accepted
**Related:** [June 2026 CAP release](https://cap.cloud.sap/docs/releases/2026/jun26), [Req §1.5](../../reference/requirements.md), [HCQL evaluation](../research/hcql-evaluation.md)

## Context

CAP **cds 10** (June 2026) is a major release with breaking runtime changes that affect this monorepo:

| Area | CDS 9 | CDS 10 |
|---|---|---|
| Write results (`UPDATE` / `UPSERT` / …) | Resolves to a `number` | Uniform array shape with `.affected` |
| Event Queues scheduling | Alpha `schedule().every()` | Mature API: cron, `.as(name)`, `unschedule(name)` |
| Test tooling | Jest still common in CAP samples | Vitest + ESM becoming the default |
| HCQL protocol | Preview / traces | Beta adapter; auto-chosen for CAP-to-CAP federation |

The three plugins (`cds-data-pipeline`, `cds-data-federation`, `cds-data-materialization`) must remain installable on **both** CDS 9 and CDS 10 consumer projects. Internal development and CI default to CDS 10; a CI matrix leg overrides to CDS 9 to prove backward compatibility.

## Decision

### 1. Peer dependencies

- `@sap/cds`: **`>=9`** (allows 9.x and 10.x) on all three packages.
- `@cap-js/sqlite`: **`>=2`** on federation (2.x on CDS 9, 3.x on CDS 10).
- `engines.node`: **`>=22`** (meets cds 10 minimum; already in place).

### 2. Runtime compatibility shims (no `legacy_srv_results` opt-out)

- **`rowsAffected(result)`** in `packages/cds-data-pipeline/srv/lib/rowsAffected.js` normalizes write results so the pipeline concurrency guard works on both majors.
- **Queued schedule lifecycle**: when the runtime exposes `.as(name)` + `unschedule(name)` (CDS 10), name tasks (`cds-data-pipeline:{pipelineName}`) so `clearSchedule` / `setSchedule` work for `engine: 'queued'`. On CDS 9, queued schedules remain non-cancelable at runtime (throw with guidance).
- **Cron expressions**: 5-field cron strings normalize to `engine: 'queued'`; spawn engine rejects cron (uses `setInterval` only).

All new CAP-10-only APIs are **feature-detected** at runtime — no hard dependency on cds 10 symbols at load time.

### 3. Internal development on CDS 10

- Root and package devDependencies pin **`@sap/cds` ^10**, **`@cap-js/sqlite` ^3**, **`vitest` ^4**, **`@cap-js/cds-test` ^1**.
- All three plugin test suites run on **Vitest** with serial execution (`maxWorkers: 1`, `fileParallelism: false`) to preserve the former Jest `--runInBand` fixture-port isolation.
- Jest is removed from plugin `package.json` scripts and configs; examples may still carry legacy lockfiles until separately refreshed.

### 4. CI matrix

`.github/workflows/test.yml` runs each package's Vitest suite on Node 22 and 24 against CDS **10** (lockfile `npm ci`). CDS **9** compatibility runs in an isolated Docker image (`docker/Dockerfile.cds9`) on Node 22. Optional local reproduction (either major, without mutating the host tree): `npm run test:cds10:docker`, `npm run test:cds9:docker`, or `npm run test:docker` for both. No release without both legs green.

### 5. Documentation

- `spec/reference/requirements.md` §1.5 updated for cds 10 integration-guide changes (HCQL, CAP reference replication scheduler, `@federated` still sample-only).
- HCQL adoption deferred; see [HCQL evaluation](../research/hcql-evaluation.md).

## Consequences

- Consumers on CDS 9 keep working without configuration changes.
- Consumers upgrading to CDS 10 get correct concurrency guarding and (when using queued schedules) runtime schedule management without plugin changes.
- Contributors run Vitest locally against CDS 10; optional dockerized runs via `npm run test:cds10:docker` / `test:cds9:docker`; CDS 9 regressions are caught in CI (Docker image).
- When CAP drops CDS 9 support in a future release, revisit peer range and remove CDS 9 CI leg + feature-detection branches in a dedicated ADR.
