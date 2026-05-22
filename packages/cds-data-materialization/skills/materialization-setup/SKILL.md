---
name: materialization-setup
description: Installs cds-data-materialization and cds-data-pipeline in a SAP CAP project. Use when adding the materialization plugin, checking peer dependencies, or ensuring tracker schema is present.
---

# Materialization setup

## Install

```bash
npm add cds-data-materialization cds-data-pipeline
```

Both packages are required. Materialization composes query-shape pipelines on the engine.

## Consumer project prerequisites

From `cds-data-pipeline`:

```cds
using from 'cds-data-pipeline/db';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
```

Materialization binds `@materialize.snapshot` entities to `addPipeline` at boot — tracker tables must exist.

## Plugin activation

Auto-loads via `cds-plugin.js`. No manual `server.js` registration for annotation-driven snapshots.

## Composition with federation

| Package | Role |
|---|---|
| `cds-data-federation` | Remote delegate / replicate |
| `cds-data-materialization` | Local aggregate snapshots |
| `cds-data-pipeline` | Shared engine |

Install federation and materialization side by side when you need remote sync and local rollups.

## Anti-patterns

❌ **Wrong** — `cds-data-materialization` without `cds-data-pipeline`.

✅ **Correct** — always install both.

❌ **Wrong** — expecting materialization to read remote OData aggregates directly.

✅ **Correct** — replicate remote data locally first, then snapshot with `source.service: 'db'`.

## Docs

- Installation: https://mikezaschka.github.io/cds-data/materialization/getting-started/installation.html
