# Pipeline Console

The **Pipeline Console** is a pre-built UI5 freestyle app (flexible column layout) for inspecting and operating pipelines at runtime. It reads and writes the management OData API at `/pipeline/` — list pipelines, open run history, trigger runs, and set in-process schedules.

The console ships **inside the `cds-data-pipeline` npm package** at `app/pipeline-console/` (pre-built static assets). You mount it in your CAP app the same way CAP documents [reuse & compose — Reuse UIs](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#reuse-uis): no local copy, no UI5 dev-server plugin required.

## What you get

| Surface | Path | Notes |
|---|---|---|
| **Pipeline Console** (this page) | `/pipeline-console/` | Freestyle FCL — master / detail / runs. Shipped with the plugin. |
| **Management OData API** | `/pipeline/` | Always served when the plugin is installed. See [Management service](../reference/management-service.md). |
| **Fiori Elements monitor** | — | Not bundled in the npm package. The plugin ships [`srv/monitor-annotations.cds`](https://github.com/mikezaschka/cds-data/blob/main/packages/cds-data-pipeline/srv/monitor-annotations.cds) for list/object pages; generate a Fiori app in your project if you prefer Elements over the console. |

The console manifest binds its default OData model to `/pipeline/` (absolute URL). UI and API share the same CAP origin, so no CORS or reverse-proxy path rewriting is needed when you mount the console under any prefix on that server.

## Quick start — scaffold

From your project root (after `npm add cds-data-pipeline`):

```bash
cds add data-pipeline-monitor
```

This adds or updates `server.js` with a bootstrap hook that mounts the console from the installed package. Then:

```bash
cds watch
```

Open `http://localhost:4004/pipeline-console/index.html` (port from your profile).

## Manual mount

Add the mount yourself in `server.js` if you prefer not to run the generator, or need a custom path.

### Inline (CAP docs pattern)

```javascript
const cds = require('@sap/cds')

cds.once('bootstrap', (app) => {
    app.serve('/pipeline-console').from('cds-data-pipeline', 'app/pipeline-console')
})

module.exports = cds.server
```

`app.serve(...).from(...)` is provided by `@sap/cds/server` when you export `cds.server`. The second argument is the folder **inside the npm package** that contains `index.html`.

### Helper module

The plugin ships a small bootstrap helper:

```javascript
const cds = require('@sap/cds')
require('cds-data-pipeline/lib/mount-pipeline-console')
module.exports = cds.server
```

Custom mount path:

```javascript
const cds = require('@sap/cds')
const { registerMountPipelineConsole } = require('cds-data-pipeline/lib/mount-pipeline-console')

registerMountPipelineConsole('/admin/pipelines')
module.exports = cds.server
```

## Composite / mashup apps

In a composite solution that embeds several reuse packages, mount each UI on its own prefix in the same `bootstrap` handler — the bookstore sample uses the same pattern:

```javascript
cds.once('bootstrap', (app) => {
    app.serve('/pipeline-console').from('cds-data-pipeline', 'app/pipeline-console')
    // app.serve('/bookshop').from('@capire/bookshop', 'app/vue')
})
```

Pipeline **services** are already embedded when your CDS model reaches the plugin definitions; the console mount only serves static UI assets. Dynamic requests still hit `/pipeline/` on the same process.

## Security

The plugin does not attach `@(requires: …)` to the management service. Secure `/pipeline` in **your** CDS model and deployment (XSUAA, approuter, annotations). The console uses the same OData session as the rest of your app — if `/pipeline` requires authentication, configure login before opening the console. See [Securing `/pipeline`](../reference/management-service.md#securing-pipeline-in-your-app).

## Without a UI

The management API is fully usable without any UI:

```http
GET /pipeline/Pipelines
GET /pipeline/PipelineRuns
POST /pipeline/execute
```

See [Management service](../reference/management-service.md) for the full surface.

## Package layout (for reuse providers)

If you publish a CAP reuse package with a UI, the same pattern applies:

1. Ship pre-built static files under a stable folder (for example `app/my-console/`).
2. Include that folder in the npm `files` allowlist.
3. Document the mount path and folder in your readme.

Consumers then run `app.serve('<mount>').from('<your-package>', 'app/my-console')`.

## See also

- [Get started](get-started.md) — end-to-end walkthrough including the console
- [Management service](../reference/management-service.md) — OData entities, actions, hooks
- [Feature catalog](../reference/features.md) — observability and UI capabilities
