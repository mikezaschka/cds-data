---
name: pipeline-setup
description: Installs and configures cds-data-pipeline in a SAP CAP project. Use when adding the pipeline plugin, importing tracker schema, exposing the management OData service, or connecting to DataPipelineService.
---

# Pipeline setup

## Install

```bash
npm add cds-data-pipeline
```

Peer: `@sap/cds` >= 8 · Node >= 22

## Required CDS imports

**Tracker schema** (in `db/schema.cds` or equivalent):

```cds
using from 'cds-data-pipeline/db';
```

**Management OData** (in `srv/pipeline-mgmt.cds` or equivalent):

```cds
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
```

Served at `/pipeline/`. Add your own auth — the plugin ships no `@requires` annotations.

## Programmatic access

```javascript
const pipelines = await cds.connect.to('DataPipelineService');
await pipelines.addPipeline({ name, source, target, ... });
```

Register pipelines in `cds.on('served', ...)` or equivalent bootstrap.

## Verify

After boot, `/pipeline/Pipelines` should list registered pipelines. Log lines from `cds-data-pipeline` confirm plugin activation.

## Anti-patterns

❌ **Wrong** — forgetting `using from 'cds-data-pipeline/db'` → tracker tables missing.

✅ **Correct** — import tracker schema before first pipeline run.

❌ **Wrong** — `require('@sap/cds')` in plugin-adjacent code when extending internals (workspace duplication risk in monorepos).

✅ **Correct** — follow patterns in consumer `server.js`; use documented public APIs.

## Docs

- Get started: https://mikezaschka.github.io/cds-data/pipeline/guide/get-started.html
