# cds-data-federation

[![npm version](https://img.shields.io/npm/v/cds-data-federation)](https://www.npmjs.com/package/cds-data-federation)
[![monthly downloads](https://img.shields.io/npm/dm/cds-data-federation)](https://www.npmjs.com/package/cds-data-federation)
[![CI](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml/badge.svg)](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mikezaschka/cds-data/blob/main/LICENSE)
![SAP CAP](https://img.shields.io/badge/SAP%20CAP-CDS%209%20%26%2010-0a6ed1)
[![Documentation](https://img.shields.io/badge/docs-online-brightgreen)](https://mikezaschka.github.io/cds-data/federation/)

[Documentation](https://mikezaschka.github.io/cds-data/federation/) · [npm](https://www.npmjs.com/package/cds-data-federation)

The annotation-driven SAP CAP plugin for integrating external services into your application's data model — declarative, no handler code. Composes [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline) for scheduled sync.

## Beyond CAP

CAP gives you the right concepts — consumption views, projection chains, `cds.connect.to`, `remote.run(req.query)` — and you rarely need much code per entity. But you still **maintain that wiring in every project**: `on('READ')` handlers, rename maps, replication loops, and schedule setup copied from samples such as [xtravels](https://github.com/capire/xtravels) or the [S/4 mashup sample](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui). Cross-service `$expand` and navigation are especially brittle — intercepting incoming OData requests and CQN, stripping expand items, batch-fetching from the right service, and stitching results by foreign key adds up fast.

**This plugin needs zero wiring code.** Annotate the consumption view; handlers, query translation, and pipeline binding are registered at boot.

| Benefit | What you get |
|---|---|
| **Zero handler code** | `@federation.delegate` / `@federation.replicate` on the projection — no per-entity `srv` files to maintain |
| **Consumption-view contract** | Field and association renames, column restriction, static `where` — inferred from the projection, not hand-written maps |
| **Cross-service mashups** | `$expand` and navigation across local ↔ remote boundaries handled inside the plugin — not manual request interception per scenario |
| **Scheduled replication** | Full/delta sync into local tables via `cds-data-pipeline` — retry, concurrency guard, run history, REST sources |
| **Optional caching** | Per-query (`cds-caching`) or full-entity SQLite snapshots on delegate |
| **Observability** | Federation-bound pipelines in `/pipeline` and the [Pipeline Console](https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console) |

Full positioning against CAP samples and other approaches: [Comparison with CAP](https://mikezaschka.github.io/cds-data/federation/reference/comparison).

## Install

```bash
# Replicate or entity cache:
npm add cds-data-federation cds-data-pipeline

# Delegate-only:
npm add cds-data-federation
```

| Package | Version | Required when |
|---|---|---|
| `@sap/cds` | `>= 9` | Always — **CDS 9 and CDS 10** |
| `@sap-cloud-sdk/http-client`, `@sap-cloud-sdk/resilience` | `^4` | OData remote services |
| `cds-data-pipeline` | peer | `@federation.replicate`, `cache.strategy: 'entity'`, custom pipeline hooks |
| `cds-caching` | `>= 1` | `cache.strategy: 'response'` (default cache strategy) |
| `@cap-js/sqlite` | `>= 2` | `cache.strategy: 'entity'` (`2.x` on CDS 9, `3.x` on CDS 10) |

The plugin auto-activates on load via `cds-plugin.js`. Setup: [Installation](https://mikezaschka.github.io/cds-data/federation/getting-started/installation).

## Choosing a strategy

| I need… | Use |
|---|---|
| Live data, writes to system of record | `@federation.delegate` |
| Same remote queries repeated; tolerate TTL staleness | `@federation.delegate` + `cache: { strategy: 'response' }` |
| Arbitrary filters/sorts on one entity; tolerate TTL | `@federation.delegate` + `cache: { strategy: 'entity' }` |
| SQL joins with local tables, analytics, offline resilience | `@federation.replicate` (+ `cds-data-pipeline`) |
| Plain REST JSON API (no CDS model on remote) | `@federation.replicate` + `rest: { … }` |

*Start with delegate; add cache for latency/load; replicate when you need SQL power or offline resilience.*

Full decision tree, limitations, and OData caveats: [Choosing a strategy](https://mikezaschka.github.io/cds-data/federation/reference/choosing-a-strategy).

## Features

The **consumption view IS the federation contract** — the `@federation.*` annotation declares runtime behavior; `entity X as projection on remote.Y` declares schema, renames, and column restriction. See [Consumption views](https://mikezaschka.github.io/cds-data/federation/concepts/consumption-views).

| Area | Highlights | Docs |
|---|---|---|
| **Delegate** | Live proxy, query translation, opt-in CUD, server-driven paging | [Annotations](https://mikezaschka.github.io/cds-data/federation/reference/annotations) |
| **Replicate** | Full/delta sync, UPSERT, `replicated` aspect, pipeline hooks | [First replication](https://mikezaschka.github.io/cds-data/federation/getting-started/first-replication) |
| **Caching** | Per-query (`response`) or full-entity SQLite (`entity`) | [Caching](https://mikezaschka.github.io/cds-data/federation/integration/caching) |
| **Cross-service** | `$expand` and navigation across local ↔ remote boundaries | [Cross-service scenarios](https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios) |

Full capability list: [Features](https://mikezaschka.github.io/cds-data/federation/reference/features).

## Examples

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

@federation.delegate
entity Customers as projection on remote.Customers;

@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    price as unitPrice
};

@federation.replicate: { mode: 'delta', schedule: 600000, delta: { field: 'modifiedAt' } }
entity ReplicatedProducts as projection on remote.Products { ... };
```

All annotation options: [Annotations reference](https://mikezaschka.github.io/cds-data/federation/reference/annotations).

## Role of `cds-data-pipeline`

At boot, federation scans `@federation.replicate` (and entity-cache) annotations and calls `addPipeline({ ... })` via `pipeline-binding.js`. You use annotations, not the engine API, unless you need custom `PIPELINE.*` hooks. Replicate pipelines appear in the shared `/pipeline` management API and [Pipeline Console](https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console).

```javascript
const pipelines = await cds.connect.to('data-pipeline');
pipelines.before('PIPELINE.MAP', 'ReplicatedPartners', async (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});
```

See [pipeline features](https://mikezaschka.github.io/cds-data/pipeline/reference/features) and [first replication](https://mikezaschka.github.io/cds-data/federation/getting-started/first-replication).

## Pipeline Console

When `management.reuse.console` is enabled on `cds-data-pipeline`, federation-bound pipelines (replicate jobs, entity-cache entries) show up automatically:

![Pipeline landscape — federation replicate and cache pipelines grouped by service](https://raw.githubusercontent.com/mikezaschka/cds-data/main/docs/images/pipeline-landscape.png)

![Pipeline detail — replicate run history and schedule controls](https://raw.githubusercontent.com/mikezaschka/cds-data/main/docs/images/pipeline-runs.png)

Enable: [Feature activation](https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation).

## Documentation

- [Federation guide](https://mikezaschka.github.io/cds-data/federation/) — getting started, concepts, integration
- [Annotations reference](https://mikezaschka.github.io/cds-data/federation/reference/annotations)
- [Choosing a strategy](https://mikezaschka.github.io/cds-data/federation/reference/choosing-a-strategy)

Multi-tenancy: [CAP MTX](https://mikezaschka.github.io/cds-data/federation/integration/multitenancy).

## AI assistants

**Coming soon.** Agent guidance (`AGENTS.md`) and task skills for coding assistants will ship in a future release.

## Related

- [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline) — the pipeline engine this plugin composes.
- [`cds-caching`](https://github.com/mikezaschka/cds-caching) — optional peer for `cache.strategy: 'response'`.
