# cds-data CAP plugins

Composable [SAP CAP](https://cap.cloud.sap/) plugins for integrating remote services, moving data between systems, and persisting local aggregate snapshots — declarative via CDS annotations, with a shared pipeline engine underneath.

**Documentation:** [https://mikezaschka.github.io/cds-data/](https://mikezaschka.github.io/cds-data/)

| Package | Docs |
|---|---|
| [cds-data-federation](https://www.npmjs.com/package/cds-data-federation) | [Federation guide](https://mikezaschka.github.io/cds-data/federation/) |
| cds-data-materialization — **experimental, not yet released** | [Materialization guide](https://mikezaschka.github.io/cds-data/materialization/) |
| [cds-data-pipeline](https://www.npmjs.com/package/cds-data-pipeline) | [Pipeline guide](https://mikezaschka.github.io/cds-data/pipeline/) |

This repository is the monorepo for all three packages. `cds-data-federation` and `cds-data-pipeline` are published to npm; **`cds-data-materialization` is experimental and not yet released**. Use the docs site for guides, concepts, and reference.

All three packages install on **both CDS 9 and CDS 10** (`@sap/cds >= 9`, Node >= 22).

## Overview

Three packages compose in one CAP application:

- **cds-data-federation** — `@federation.delegate` and `@federation.replicate` on consumption views. Delegate forwards reads (and optional writes) to remote services at query time, including cross-service `$expand` and navigation. Replicate registers scheduled sync jobs that copy remote data into your local database.
- **cds-data-materialization** *(experimental, not yet released)* — `@materialize.snapshot` on `group by` projections. Persists scheduled rollups and aggregates locally for analytics and reporting.
- **cds-data-pipeline** — the shared `READ → MAP → WRITE` engine. Tracker, retry, management OData API, and event hooks. Federation and materialization peer-require it for scheduled runs; you can also register pipelines programmatically via `addPipeline({ source, target, … })`.

**Delegate** is live and query-time. **Replicate** and **snapshot** move data through the pipeline on a schedule. Federation optionally layers [cds-caching](https://github.com/mikezaschka/cds-caching) on delegate or replicate.

## Which package do I need?

| I want to… | Install |
|---|---|
| Declare `@federation.delegate` / `@federation.replicate` on a consumption view — delegation, cross-service `$expand`, scheduled sync | `npm add cds-data-federation cds-data-pipeline` |
| Declare `@materialize.snapshot` on a `group by` projection — scheduled local rollups | `npm add cds-data-materialization cds-data-pipeline` |
| Register a standalone pipeline — `addPipeline({ source, target, … })` with tracker, retry, and management API | `npm add cds-data-pipeline` |

Delegate-only setups can install just `cds-data-federation`. Replication, entity-level caching, and materialization require `cds-data-pipeline`.

Getting started: [first delegation](https://mikezaschka.github.io/cds-data/federation/getting-started/first-delegation) · [first replication](https://mikezaschka.github.io/cds-data/federation/getting-started/first-replication) · [first snapshot](https://mikezaschka.github.io/cds-data/materialization/getting-started/first-snapshot) · [pipeline get started](https://mikezaschka.github.io/cds-data/pipeline/guide/get-started)

## Examples

Runnable demos live under [`examples/`](./examples/). See [`examples/README.md`](./examples/README.md) for ports, structure, and troubleshooting.

| Demo | Start |
|---|---|
| **Sales Intelligence Workbench** — Northwind V4 + V2, local CAP + REST providers; delegation, replication, cross-service `$expand`, cache visibility | `bash examples/sales-intel/start-all.sh` → http://localhost:4005/launchpage.html |
| **Movies & Streaming** — delegate, cache, replicate, and REST-sourced analytics in a Fiori launchpad | `npm run examples:start` → http://localhost:4004/launchpage.html |

## Links

- [Documentation portal](https://mikezaschka.github.io/cds-data/)
- [cds-data-federation on npm](https://www.npmjs.com/package/cds-data-federation)
- [cds-data-pipeline on npm](https://www.npmjs.com/package/cds-data-pipeline)
- cds-data-materialization — experimental, not yet published to npm
- [cds-caching](https://github.com/mikezaschka/cds-caching) — optional peer for `cache.strategy: 'response'`; built-in `cache.strategy: 'entity'` uses `cds-data-pipeline` + SQLite
- [CAP Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) — upstream delegation and federation reference

Preview docs locally: `npm run docs:serve` from the repository root.
