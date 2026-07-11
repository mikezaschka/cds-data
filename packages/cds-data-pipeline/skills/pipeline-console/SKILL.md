---
name: pipeline-console
description: Enables the cds-data-pipeline Pipeline Console UI for the /pipeline management API. Use when adding pipeline monitoring, running pipelines manually, viewing run history, inspecting source/target data, or scaffolding with cds add pipeline-console.
---

# Pipeline Console

Pre-built SAPUI5 app shipped at `cds-data-pipeline/app/pipeline-console/`. Reads/writes management OData at `/pipeline/`.

## Layout

| Column | Purpose |
|---|---|
| **Data Pipelines** (begin) | Searchable list with status, last run, errors |
| **Detail** (mid) | Network graph, Overview / Runs / Health / Statistics tabs, pipeline actions |
| **Data inspector** (end) | Source/target preview via `inspectData`, column picker, advanced filters |

Adaptive polling: 30 s idle, 3 s while any pipeline is `running`.

## Local reuse (recommended)

Add to `package.json`:

```json
{
  "cds": {
    "requires": {
      "data-pipeline": {
        "impl": "cds-data-pipeline",
        "management": {
          "reuse": {
            "api": true,
            "console": true
          }
        }
      }
    }
  }
}
```

```bash
cds deploy
cds watch
```

Open `http://localhost:4004/pipeline-console/index.html`.

## Customize the UI

Sources live in `packages/cds-data-pipeline/app/pipeline-console-src/`. Rebuild with:

```bash
cd packages/cds-data-pipeline && npm run build:pipeline-console
```

The app uses SAPUI5 (not OpenUI5) for `sap.suite.ui.commons.networkgraph`.

## BTP — project-owned UI

```bash
cds add pipeline-console
```

Do not combine `cds add pipeline-console` with `management.reuse.console`.

## Prerequisites

- `cds-data-pipeline` installed
- Management API exposed via `management.reuse.api` or `using from 'cds-data-pipeline/index.cds'`

## Anti-patterns

❌ **Wrong** — `management.reuse.console` + `cds add pipeline-console` (duplicate UI route).

✅ **Correct** — pick reuse **or** own, not both.

❌ **Wrong** — expecting the console without exposing the management OData service.

✅ **Correct** — set `management.reuse.api: true` or import `index.cds`.

❌ **Wrong** — exposing `inspectData` without securing underlying entity read access.

✅ **Correct** — apply the same authorization to `/pipeline` and source/target services as for production data reads.

## Docs

- Feature activation: https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation.html
- Pipeline Console: https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console.html
- Management API: https://mikezaschka.github.io/cds-data/pipeline/reference/management-service.html
