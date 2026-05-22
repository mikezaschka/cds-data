# cds-data CAP plugins

Composable [SAP CAP](https://cap.cloud.sap/) plugins for integrating remote services, moving data between systems, and persisting local aggregate snapshots — declarative via CDS annotations, with a shared pipeline engine underneath.

**Documentation:** [https://mikezaschka.github.io/cds-data-federation/](https://mikezaschka.github.io/cds-data-federation/)

| Package | Docs |
|---|---|
| [cds-data-federation](https://www.npmjs.com/package/cds-data-federation) | [Federation guide](https://mikezaschka.github.io/cds-data-federation/federation/) |
| [cds-data-materialization](https://www.npmjs.com/package/cds-data-materialization) | [Materialization guide](https://mikezaschka.github.io/cds-data-federation/materialization/) |
| [cds-data-pipeline](https://www.npmjs.com/package/cds-data-pipeline) | [Pipeline guide](https://mikezaschka.github.io/cds-data-federation/pipeline/) |

This repository is the monorepo for all three npm packages. Install from npm; use the docs site for guides, concepts, and reference.

## Overview

Three packages compose in one CAP application:

- **cds-data-federation** — `@federation.delegate` and `@federation.replicate` on consumption views. Delegate forwards reads (and optional writes) to remote services at query time, including cross-service `$expand` and navigation. Replicate registers scheduled sync jobs that copy remote data into your local database.
- **cds-data-materialization** — `@materialize.snapshot` on `group by` projections. Persists scheduled rollups and aggregates locally for analytics and reporting.
- **cds-data-pipeline** — the shared `READ → MAP → WRITE` engine. Tracker, retry, management OData API, and event hooks. Federation and materialization peer-require it for scheduled runs; you can also register pipelines programmatically via `addPipeline({ source, target, … })`.

**Delegate** is live and query-time. **Replicate** and **snapshot** move data through the pipeline on a schedule. Federation optionally layers [cds-caching](https://github.com/mikezaschka/cds-caching) on delegate or replicate.

## Which package do I need?

| I want to… | Install |
|---|---|
| Declare `@federation.delegate` / `@federation.replicate` on a consumption view — delegation, cross-service `$expand`, scheduled sync | `npm add cds-data-federation cds-data-pipeline` |
| Declare `@materialize.snapshot` on a `group by` projection — scheduled local rollups | `npm add cds-data-materialization cds-data-pipeline` |
| Register a standalone pipeline — `addPipeline({ source, target, … })` with tracker, retry, and management API | `npm add cds-data-pipeline` |

Delegate-only setups can install just `cds-data-federation`. Replication, entity-level caching, and materialization require `cds-data-pipeline`.

Getting started: [first delegation](https://mikezaschka.github.io/cds-data-federation/federation/getting-started/first-delegation) · [first replication](https://mikezaschka.github.io/cds-data-federation/federation/getting-started/first-replication) · [first snapshot](https://mikezaschka.github.io/cds-data-federation/materialization/getting-started/first-snapshot) · [pipeline get started](https://mikezaschka.github.io/cds-data-federation/pipeline/guide/get-started)

## Examples

Runnable demos live under [`examples/`](./examples/). See [`examples/README.md`](./examples/README.md) for ports, structure, and troubleshooting.

| Demo | Start |
|---|---|
| **Sales Intelligence Workbench** — Northwind V4 + V2, local CAP + REST providers; delegation, replication, cross-service `$expand`, cache visibility | `bash examples/sales-intel/start-all.sh` → http://localhost:4005/launchpage.html |
| **Movies & Streaming** — delegate, cache, replicate, and REST-sourced analytics in a Fiori launchpad | `npm run examples:start` → http://localhost:4004/launchpage.html |

## Links

- [Documentation portal](https://mikezaschka.github.io/cds-data-federation/)
- [cds-data-federation on npm](https://www.npmjs.com/package/cds-data-federation)
- [cds-data-pipeline on npm](https://www.npmjs.com/package/cds-data-pipeline)
- [cds-data-materialization on npm](https://www.npmjs.com/package/cds-data-materialization)
- [cds-caching](https://github.com/mikezaschka/cds-caching) — optional peer for `cache.strategy: 'response'`; built-in `cache.strategy: 'entity'` uses `cds-data-pipeline` + SQLite
- [CAP Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) — upstream delegation and federation reference

Preview docs locally: `npm run docs:serve` from the repository root.

## For contributors

Internal references, primers, and the feature tracker live alongside the code. These links are for contributors and AI assistants working on the repository — they are not needed to use the packages from npm.

- [spec/reference/requirements.md](./spec/reference/requirements.md) — full feature matrix with status, priority, and architecture rationale.
- [spec/reference/test-mapping.md](./spec/reference/test-mapping.md) — auto-generated test ↔ requirement ID mapping.
- Tests live under `packages/cds-data-pipeline/test/`, `packages/cds-data-federation/test/`, and `packages/cds-data-materialization/test/` (root `npm test` runs all three).
- [CLAUDE.md](./CLAUDE.md) — deep architecture notes and project conventions.
- [AGENTS.md](./AGENTS.md) — cross-tool entry point for AI coding assistants (Cursor, Claude Code, Codex, …).
- [spec/internal/](./spec/internal/) — ADRs, research notes, plans, and the contributor canonical [`spec/concepts/`](./spec/concepts/) tree.
