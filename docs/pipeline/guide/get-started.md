# Get started

Set up a single replicate pipeline using the public **[Northwind OData V4](https://services.odata.org/V4/Northwind/Northwind.svc/)** API: remote **Products** → local table. Swap the URL and model for your own API when ready.

## Prerequisites

- **Node.js** >= 22
- **`@sap/cds`** >= 9.2
- Network access to `https://services.odata.org`

## 1. Install the plugin

```bash
npm add cds-data-pipeline
```

The plugin auto-registers `DataPipelineService` — no extra config needed.

For AI coding assistants, the installed package also ships `node_modules/cds-data-pipeline/AGENTS.md` and task skills under `skills/` — see the package README § AI assistants.

Include the **tracker** schema so the `Pipelines` / `PipelineRuns` tables exist (e.g. in `db/schema.cds`):

```cds
using from 'cds-data-pipeline/db';

namespace my.app;

// … your entities and consumption views …
```

Expose the **management OData** surface (e.g. in `srv/pipeline-mgmt.cds`):

```cds
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
```

The plugin ships no auth annotations — add your own as needed. See [Management Service](../reference/management-service.md#securing-pipeline-in-your-app).

## 2. Import the Northwind OData API

The plugin needs a **connected service name** and **entity** names from your imported model — the standard [capire OData import flow](https://cap.cloud.sap/docs/guides/integration/calesi#odata-apis). Skip the expander if you already have an imported service.

::: details `cds import` and Northwind (step-by-step)

1. **Download metadata** (example: Northwind V4 — save as `.edmx`):

```bash
curl -sL 'https://services.odata.org/V4/Northwind/Northwind.svc/$metadata' -o northwind.edmx
```

2. **Import** from your CAP project root (adjust the path if the file lives elsewhere):

```bash
cds import northwind.edmx
```

3. **Connectivity** — set `credentials.url` to the service root (no `$metadata` suffix), e.g. `https://services.odata.org/V4/Northwind/Northwind.svc`, or use a BTP destination.

After import, CAP prints a `using` hint:

```cds
using { northwind as external } from './external/northwind';
```

The service name (here `northwind`) is what you pass as `source.service` in `addPipeline`.

:::

## 3. Define a consumption view

Model the **local target** as a projection on `northwind.Products`. This example restricts columns, renames one field (`ProductName` → `ProductTitle`), and excludes discontinued rows:

```cds
using { northwind } from '../srv/external/northwind';

@cds.persistence.table
entity LocalProducts as projection on northwind.Products {
    ProductID,
    ProductName as ProductTitle,
    UnitPrice,
    UnitsInStock,
} where Discontinued = false;
```

Place this in your app namespace (e.g. `my.app` in `db/schema.cds`) so the fully qualified name is `my.app.LocalProducts`. See [Concepts → Consumption views](concepts/consumption-views.md) for details.

## 4. Register your first pipeline

In `server.js`, connect after CAP has served and call `addPipeline`. The engine infers column mappings and renames from the consumption view. Northwind Products has no change-timestamp field, so we use `mode: 'full'` here (for delta, see [Built-in replicate](recipes/built-in-replicate.md)).

```javascript
const cds = require('@sap/cds');

cds.on('served', async () => {
    const pipelines = await cds.connect.to('DataPipelineService');

    await pipelines.addPipeline({
        name: 'NorthwindProducts',
        source: { service: 'northwind', entity: 'Products' },
        target: { entity: 'my.app.LocalProducts' },
        mode: 'full',
        schedule: 600_000, // optional: every 10 minutes; omit and use execute (below)
    });

    // Example: tweak one column after the default mapper (do not use `on` here — it would replace the default)
    pipelines.after('PIPELINE.MAP_BATCH', 'NorthwindProducts', (_results, req) => {
        for (const row of req.data.targetRecords) {
            if (row.ProductTitle != null) {
                row.ProductTitle = String(row.ProductTitle).trim().toUpperCase();
            }
        }
    });
});

module.exports = cds.server;
```

`after('PIPELINE.MAP_BATCH')` runs per batch on top of the built-in mapping. `req.data.targetRecords` already uses local names (e.g. `ProductTitle`, not `ProductName`). Use `before` / `after` to layer behavior — `on` replaces the default mapper entirely. See [Event hooks](recipes/event-hooks.md).

## 5. Deploy and run

- **SQLite / local:** `cds deploy` (or your usual profile), then `cds watch` / `cds serve`.
- **HANA:** include the plugin DB model in production build and deploy with your HDI flow.

## 6. Open the Pipeline Console

Scaffold or mount the pre-built console from the npm package:

```bash
cds add data-pipeline-monitor
cds watch
# → http://localhost:4004/pipeline-console/index.html
```

Mount options, composite mashups, and security notes: **[Pipeline Console](pipeline-console.md)**.

**Without a UI**, use the management OData API directly (`GET /pipeline/Pipelines`, `GET /pipeline/PipelineRuns`). See [Management Service](../reference/management-service.md).

## 7. Query the service and check the data

1. **Trigger a run** (if no `schedule` set): `POST /pipeline/execute` with body `{ "name": "NorthwindProducts", "mode": "full" }`. See [`execute`](../reference/management-service.md#execute).
2. **Check status:** `GET /pipeline/Pipelines(‘NorthwindProducts’)` or `GET /pipeline/status(name=’NorthwindProducts’)`.
3. **Query data:** access `my.app.LocalProducts` via your app service or CDS and confirm rows match non-discontinued Northwind products.

## Next

- [Pipeline Console](pipeline-console.md) — mount options, mashups, security
- [Recipes](recipes/index.md) — replicate, materialize, fan-in, custom adapters, hooks, scheduling
- [Concepts](concepts/) — vocabulary, inference, consumption views
- [Feature catalog](../reference/features.md)
