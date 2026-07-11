# Feature activation

`cds-data-pipeline` separates three concerns:

| Layer | What it does | Enabled by default? |
|---|---|---|
| **Pipeline runtime** | `cds.connect.to('data-pipeline')`, `addPipeline`, adapters | Yes — `npm add cds-data-pipeline` |
| **Management API** | Tracker schema + `DataPipelineManagementService` at `/pipeline/` | No — opt in via `management.reuse.api` or manual `using` |
| **Pipeline Console** | Pre-built UI5 FCL at `/pipeline-console/` | No — opt in via `management.reuse.console` or `cds add pipeline-console` |

## Reuse vs own (CAP reuse & compose)

Following CAP's [reuse & compose](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#reuse-uis) pattern, management and UI can be activated in two ways:

| Mode | When | How |
|---|---|---|
| **Reuse (config)** | Zero project files; local dev; CAP serves static UI | `management.reuse.api`, `management.reuse.console` |
| **Own (manual)** | BTP HTML5 repo, customization, explicit control | `using … index.cds` and/or `cds add pipeline-console` |

Manual equivalents:

| Reuse flag | Manual alternative |
|---|---|
| `management.reuse.api` | `using from 'cds-data-pipeline/index.cds'` in `srv/` |
| `management.reuse.console` | `cds add pipeline-console` (copies UI into `app/pipeline-console/`) |

Do **not** combine reuse flags with their manual equivalent for the same concern.

## Quick decision guide

```
Need pipeline engine only?
  └─ npm add cds-data-pipeline

Need management OData at /pipeline/ (reuse from package)?
  └─ "data-pipeline": { "impl": "cds-data-pipeline", "management": { "reuse": { "api": true } } }

Need Pipeline Console locally (reuse UI from package)?
  └─ "management": { "reuse": { "api": true, "console": true } }

Need console on BTP (own the UI project)?
  └─ cds add pipeline-console
  └─ cds add html5-repo && cds add mta
  └─ do NOT set management.reuse.console
```

## Configuration

### Minimal (engine only)

```bash
npm add cds-data-pipeline
```

Optional explicit wiring (mirrors cds-caching):

```json
{
  "cds": {
    "requires": {
      "data-pipeline": {
        "impl": "cds-data-pipeline"
      }
    }
  }
}
```

Connect: `await cds.connect.to('data-pipeline')`.

### Local development (reuse API + console)

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
cds deploy && cds watch
# → http://localhost:4004/pipeline-console/index.html
# → http://localhost:4004/pipeline/Pipelines
```

| Field | Purpose |
|---|---|
| `management.reuse.api` | Plugin injects tracker schema + management service via `index.cds` |
| `management.reuse.console` | Plugin serves pre-built UI at `/pipeline-console/`; implies `reuse.api: true` |

### API only (reuse API, no UI)

```json
"management": {
  "reuse": { "api": true }
}
```

### SAP BTP production

```json
"data-pipeline": {
  "impl": "cds-data-pipeline",
  "management": { "reuse": { "api": true } }
}
```

```bash
cds add pipeline-console
cds add html5-repo
cds add mta
cd app/pipeline-console && npm install && npm run build:cf
```

Secure the management service in **your** CDS model. Do **not** use `management.reuse.console` on standard HTML5 repo + approuter deployments.

## Feature matrix

| Setup | Engine | Tracker + `/pipeline/` | Pipeline Console |
|---|---|---|---|
| `npm add` only | ✓ | | |
| + manual `using from 'cds-data-pipeline/db'` | ✓ | partial (schema only) | |
| + `management.reuse.api` | ✓ | ✓ | |
| + `management.reuse.console` | ✓ | ✓ | ✓ |
| + `cds add pipeline-console` | ✓ | ✓* | ✓ |

\*When using `cds add pipeline-console`, the generator writes `srv/pipeline-management.cds` with `using from 'cds-data-pipeline/index.cds'` unless you already import the API manually.

## Avoiding duplicate model loading

The plugin deduplicates automatic loading:

- `management.reuse.api` or `management.reuse.console` → injects `index/` model root only
- Manual `using from 'cds-data-pipeline/index.cds'` → no separate injection when reuse flags are off

### Do not combine

| Combination | Problem |
|---|---|
| `management.reuse.api` + `using … index.cds` | Duplicate management service definitions |
| `management.reuse.console` + `cds add pipeline-console` | Duplicate UI route at `/pipeline-console` |
| `using … index.cds` in two `.cds` files | Duplicate service registration |

Federation and materialization consumers that only need tracker tables (no `/pipeline/` UI) may still use:

```cds
using from 'cds-data-pipeline/db';
```

That path is independent of `management.reuse.api`.

### Securing the management API

```cds
annotate DataPipelineManagementService with @requires: 'authenticated-user';
```

Use the service name from your consumption model — do not repeat the `using` import in the annotate statement.

## See also

- [Pipeline Console](pipeline-console.md) — UI capabilities and BTP setup
- [Management service](../reference/management-service.md) — OData entities and actions
- [Get started](get-started.md) — end-to-end walkthrough
