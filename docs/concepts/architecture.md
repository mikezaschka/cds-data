# Architecture

`cds-data` is three npm packages that compose in one CAP app. This page explains the layering, the peer-dependency graph, and the single principle the annotation plugins are built on.

## Two layers: engine and annotations

```
┌─────────────────────────────────────────────────────────────┐
│  Annotation layer (declarative)                              │
│                                                              │
│  cds-data-federation            cds-data-materialization     │
│  @federation.delegate           @materialize.snapshot        │
│  @federation.replicate                                       │
└───────────┬──────────────────────────────┬──────────────────┘
            │ generates addPipeline(…)      │ generates addPipeline(…)
            ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│  Engine layer                                                │
│  cds-data-pipeline — READ → MAP → WRITE, tracker, retry,     │
│  scheduling, management API, Pipeline Console                │
└─────────────────────────────────────────────────────────────┘
```

- **Engine** — `cds-data-pipeline` is a scheduled, traceable `READ → MAP → WRITE` primitive between one source and one target. It has no dependency on the annotation plugins and is fully usable standalone via `cds.connect.to('datapipeline').addPipeline({ … })`.
- **Annotations** — `cds-data-federation` and `cds-data-materialization` scan your CDS model at startup and translate each annotated projection into an `addPipeline` registration through a small `pipeline-binding` seam. You never call `addPipeline` yourself when you use annotations.

`@federation.delegate` is the exception: it is a **live proxy** and does not use the pipeline at all — reads are forwarded to the remote at request time.

## Peer dependency graph

| Package | Depends on | Optional peers |
|---|---|---|
| `cds-data-pipeline` | `@sap/cds` | `@cap-js/sqlite` (SQLite targets) |
| `cds-data-federation` | `@sap/cds`, **`cds-data-pipeline`** (peer) | `cds-caching` (response cache), `@cap-js/sqlite` (replicate/entity cache), `@cap-js/mcp` (AI agents) |
| `cds-data-materialization` <Badge type="warning" text="Experimental" /> | `@sap/cds`, **`cds-data-pipeline`** (peer) | — |

Both annotation plugins fail loudly at `served` if `cds-data-pipeline` is not installed.

## The consumption view is the contract

Everything in the annotation layer follows from one principle: **the CDS projection declares schema; the annotation declares runtime behavior.**

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

// Column restriction + field renames.
@federation.delegate
entity Products as projection on remote.Products {
  ID    as productId,
  name  as productName,
  price as unitPrice,
  currency
  // remote fields not projected here are never fetched
};
```

From this projection the plugin infers:

- the **source service / entity** (`projection on remote.X`),
- the **projected columns** for `$select` restriction,
- the **bidirectional rename map** (`localToRemote` / `remoteToLocal`) from the `as` clauses,
- the **strategy** from the annotation name.

The same projection shape drives replication (the pipeline's `viewMapping`) and materialization (the query-shape read). See [Consumption views](/federation/concepts/consumption-views).

## Install once, runs on CDS 9 and CDS 10

All three packages install on **both** CAP major runtimes (`@sap/cds >= 9`, Node.js >= 22). Version-specific behavior (write-result shapes, queued-schedule lifecycle, HCQL auto-selection) is feature-detected at runtime — no configuration flag is required when you upgrade from CDS 9 to CDS 10.

```bash
# Federation (the usual entry point) + engine
npm add cds-data-federation cds-data-pipeline

# Engine only (programmatic pipelines)
npm add cds-data-pipeline
```

`cds-data-materialization` is experimental and not yet published to npm — install it from the monorepo workspace for evaluation.

See [CDS 10, HCQL and MCP](./cds-10.md) for how the June 2026 CAP release composes with the suite.
