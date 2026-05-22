---
name: pipeline-console
description: Mounts the cds-data-pipeline Pipeline Console UI for the /pipeline management API. Use when adding pipeline monitoring, running pipelines manually, viewing run history, or scaffolding with cds add data-pipeline-monitor.
---

# Pipeline Console

Pre-built UI5 app shipped at `cds-data-pipeline/app/pipeline-console/`. Reads/writes management OData at `/pipeline/`.

## Scaffold (recommended)

```bash
cds add data-pipeline-monitor
cds watch
```

Open `http://localhost:4004/pipeline-console/index.html`.

## Manual mount

**Helper module:**

```javascript
const cds = require('@sap/cds')
require('cds-data-pipeline/lib/mount-pipeline-console')
module.exports = cds.server
```

**Inline (CAP reuse pattern):**

```javascript
const cds = require('@sap/cds')

cds.once('bootstrap', (app) => {
    app.serve('/pipeline-console').from('cds-data-pipeline', 'app/pipeline-console')
})

module.exports = cds.server
```

## Prerequisites

- `cds-data-pipeline` installed
- Tracker schema imported (`using from 'cds-data-pipeline/db'`)
- Management service exposed (`using from 'cds-data-pipeline/srv/DataPipelineManagementService'`)

## Fiori alternative

The plugin ships `srv/monitor-annotations.cds` for Fiori Elements list/object pages on `/pipeline`. Generate a Fiori app in your project if you prefer Elements over the freestyle console.

## Anti-patterns

❌ **Wrong** — editing files under `node_modules/cds-data-pipeline/app/pipeline-console/`.

✅ **Correct** — mount as-is; customize via your CAP app's auth and routing.

❌ **Wrong** — expecting the console without exposing the management OData service.

✅ **Correct** — import `DataPipelineManagementService` CDS.

## Docs

- Pipeline Console: https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console.html
- Management API: https://mikezaschka.github.io/cds-data/pipeline/reference/management-service.html
