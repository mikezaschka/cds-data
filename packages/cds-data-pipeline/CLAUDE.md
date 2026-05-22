# CLAUDE.md

`cds-data-pipeline` is a CAP **plugin** (not an app). It registers `DataPipelineService` (engine) + `DataPipelineManagementService` (OData at `/pipeline`) and ships a tracker schema in `db/`. Consumers install it via npm and call `addPipeline(...)`.

See [README.md](README.md) for what the plugin does/doesn't do, and [.cursor/rules/mcp.mdc](.cursor/rules/mcp.mdc) for **mandatory** MCP tool usage (CAP / Fiori / UI5) — read it before touching CDS, CAP runtime APIs, or Fiori elements.

## Layout

- `cds-plugin.js` — plugin entry. Uses `global.cds`, never `require('@sap/cds')` (workspace duplication risk — see comment in file).
- `srv/` — service implementations + CDS. `DataPipelineService.js` is the engine; `DataPipelineManagementService.{cds,js}` is the OData management surface; `monitor-annotations.cds` drives the shared Fiori monitor.
- `srv/adapters/` — source adapters (`ODataAdapter`, `RestAdapter`, `CqnAdapter`, `BaseSourceAdapter`) + `targets/` (DB, OData, Base). `factory.js` picks the adapter from config.
- `srv/lib/` — `Pipeline.js` (per-run state machine), retry, view-mapping extraction, key-read helpers.
- `db/index.cds` — tracker schema in namespace `plugin.data_pipeline`. Uses **String** keys (e.g. pipeline `name`) — do not refactor to UUIDs (see `.cursor/rules/mcp.mdc`).
- `lib/add-data-pipeline-monitor.js` — `cds add data-pipeline-monitor` generator hook (wires manual mount in `server.js`).
- `lib/mount-pipeline-console.js` — bootstrap helper for CAP reuse-and-compose UI mount.
- `app/pipeline-console/` — **built artifact**, regenerated from `examples/_ui-pipeline/pipeline-console` via `npm run build:app-pipeline-console`. Do not hand-edit.
- `test/` — npm-workspaces layout: `fixtures/consumer` is the CAP app under test; `fixtures/{provider,inventory-provider,rest-provider}` are mock backends. `support/` has Jest env + spawn helpers. The `CDS_PIPELINE_TEST_CONSUMER=true` env flag (set by `jest-setup-env.js`) toggles fixture loading inside `cds-plugin.js`.
- `examples/` — runnable consumer apps per use case (replicate / materialize / move-to-service / fan-in / event-hooks). `_providers/` and `_ui-pipeline/` are shared.
- `decisions/` — ADRs. Read the relevant one before changing behavior it covers.
- `docs/` — published VitePress source. Serve from repo root: `npm run docs:serve` (port 5173 by default).

## Commands

```bash
npm test                  # all (jest --runInBand, 120s timeout, maxConcurrency 1)
npm run test:unit
npm run test:integration
npm run build:app-pipeline-console   # rebuilds app/pipeline-console from examples/_ui-pipeline
npm run docs:serve        # VitePress from repo root (npm run docs:serve)
npm run docs:build        # strict build from repo root
```

Tests run serially (`--runInBand`, `maxConcurrency: 1`) because fixture providers spawn real CAP servers on ports — do not parallelize.

## Conventions

- **Pipeline behavior is inferred from config shape**, not flags. Before adding a new option, check whether the existing inference rules (see `docs/pipeline/guide/concepts/inference.md` and `srv/lib/Pipeline.js`) already cover it.
- **Event hooks use CAP's standard `before / on / after(event, pipelineName, handler)`** — don't introduce a parallel hook system. Lifecycle events: `PIPELINE.START` → `PIPELINE.READ` → (`PIPELINE.MAP_BATCH` → `PIPELINE.WRITE_BATCH`)\* → `PIPELINE.DONE`.
- **Authorization is the consumer's job** — the plugin does not put `@(requires:…)` on `/pipeline`. Don't add it.
- **Peer dep** is `@sap/cds >= 9.2`; Node `>= 22`. Don't import from `@sap/cds` internals.
- **Published `files`** in `package.json` is allowlist-only (`srv/`, `db/`, `lib/`, `app/pipeline-console/`, `cds-plugin.js`, `README.md`). New runtime code must live under one of these or be added to `files`.

## Gotchas

- `global.cds` vs `require('@sap/cds')` — see header comment in `cds-plugin.js`. Apply the same rule when adding new entry points.
- Fixture pipelines only register when `CDS_PIPELINE_TEST_CONSUMER=true`; running the consumer fixture outside Jest will look empty.
- The Pipeline Console UI in `app/` is generated — edits belong in `examples/_ui-pipeline/pipeline-console/`.
- HANA HDI deploys are owned by the consumer build; the plugin performs no runtime DDL.
