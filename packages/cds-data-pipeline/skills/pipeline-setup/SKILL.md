---
name: pipeline-setup
description: Installs and configures cds-data-pipeline in a SAP CAP project. Use when adding the pipeline plugin, importing tracker schema, exposing the management OData service, or connecting to the pipeline engine.
---

# Pipeline setup

## Install

```bash
npm add cds-data-pipeline
```

Peer: `@sap/cds` >= 9 · Node >= 22

## Engine access

```javascript
const pipelines = await cds.connect.to('data-pipeline');
await pipelines.addPipeline({ name, source, target, ... });
```

## Management API + tracker

**Option A — reuse from plugin** (recommended for local dev):

```json
{
  "cds": {
    "requires": {
      "data-pipeline": {
        "impl": "cds-data-pipeline",
        "management": { "reuse": { "api": true } }
      }
    }
  }
}
```

**Option B — manual CDS imports**:

Tracker schema:

```cds
using from 'cds-data-pipeline/db';
```

Management OData (single import):

```cds
using from 'cds-data-pipeline/index.cds';
```

Served at `/pipeline/`. Add your own auth — the plugin ships no `@requires` annotations.

## Run housekeeping (optional)

Prune old `PipelineRuns` rows on a schedule:

```json
"data-pipeline": {
  "impl": "cds-data-pipeline",
  "housekeeping": {
    "retentionDays": 90,
    "maxRuns": 1000,
    "schedule": "0 3 * * *"
  }
}
```

Per-pipeline override: `addPipeline({ ..., retention: { maxRuns: 200 } })`. See [Run housekeeping](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/housekeeping).

## Verify

After boot, `/pipeline/Pipelines` should list registered pipelines. Log lines from `cds-data-pipeline` confirm plugin activation.

## Anti-patterns

❌ **Wrong** — forgetting tracker schema when not using `management.reuse.api` → tables missing.

✅ **Correct** — use reuse API or import `db` / `index.cds`.

## Docs

- Feature activation: https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation.html
- Get started: https://mikezaschka.github.io/cds-data/pipeline/guide/get-started.html
