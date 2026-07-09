# CLAUDE.md

`cds-data-pipeline` is a CAP **plugin** (not an app). It registers the pipeline engine via `impl: "cds-data-pipeline"` and ships tracker schema + management OData + optional Pipeline Console behind `management.reuse.*`.

See [README.md](README.md) for what the plugin does/doesn't do, and [.cursor/rules/mcp.mdc](.cursor/rules/mcp.mdc) for **mandatory** MCP tool usage (CAP / Fiori / UI5) — read it before touching CDS, CAP runtime APIs, or Fiori elements.

## Layout

- `cds-plugin.js` — plugin entry; exports `DataPipelineService`. Uses `global.cds`, never `require('@sap/cds')` (workspace duplication risk — see comment in file).
- `lib/config-normalizer.js`, `lib/plugin-roots.js` — `management.reuse.*` feature activation (cds-caching pattern).
- `lib/add-pipeline-console.js` — `cds add pipeline-console` for BTP-owned UI.
- `index.cds`, `index/index.cds` — manual import surface for management API + tracker.
- `srv/` — service implementations + CDS. `DataPipelineService.js` is the engine; `DataPipelineManagementService.{cds,js}` is the OData management surface; `monitor-annotations.cds` drives the shared Fiori monitor.
- `srv/adapters/` — source adapters (`RemoteCqnAdapter`, `RestAdapter`, `CqnAdapter`, `BaseSourceAdapter`) + `targets/` (DB, OData, Base). `factory.js` picks the adapter from config.
- `srv/lib/` — `Pipeline.js` (per-run state machine), retry, view-mapping extraction, key-read helpers.
- `db/index.cds` — tracker schema in namespace `plugin.data_pipeline`. Uses **String** keys (e.g. pipeline `name`) — do not refactor to UUIDs (see `.cursor/rules/mcp.mdc`).
- `app/pipeline-console-src/` — TypeScript UI5 source; **do not hand-edit** `app/pipeline-console/` (built artifact).
- `test/` — npm-workspaces layout: `fixtures/consumer` is the CAP app under test; `fixtures/{provider,inventory-provider,rest-provider}` are mock backends. `support/` has Vitest setup + spawn helpers. The `CDS_PIPELINE_TEST_CONSUMER=true` env flag (set by `setup-env.js`) toggles fixture loading inside `cds-plugin.js`.
- `examples/` — runnable consumer apps per use case (replicate / materialize / move-to-service / fan-in / event-hooks). `_providers/` holds shared mock backends. Feature examples enable the built Pipeline Console via `management.reuse.console`. **`examples/_dev/pipeline-console/`** is the contributor-only dev backend (port 4100, multiple pipelines) for live TypeScript UI work on `:8090`.
- ADRs — [`../../spec/internal/decisions/`](../../spec/internal/decisions/). Read the relevant one before changing behavior it covers.

## Commands

```bash
npm test                  # all (vitest run, serial, 120s timeout)
npm run test:unit
npm run test:integration
npm run build:pipeline-console   # rebuilds app/pipeline-console from app/pipeline-console-src
npm run dev:console-backend      # contributor dev backend on :4100 (multiple pipelines)
npm run dev:pipeline-console     # live TS UI on :8090, proxies to :4100
npm run start:pipeline-console   # alias for dev:pipeline-console
npm run docs:serve        # VitePress from repo root (npm run docs:serve)
npm run docs:build        # strict build from repo root
```

Tests run serially (`--runInBand`, `maxConcurrency: 1`) because fixture providers spawn real CAP servers on ports — do not parallelize.

## Conventions

- **Pipeline behavior is inferred from config shape**, not flags. Before adding a new option, check whether the existing inference rules (see `docs/pipeline/guide/concepts/inference.md` and `srv/lib/Pipeline.js`) already cover it.
- **Event hooks use CAP's standard `before / on / after(event, pipelineName, handler)`** — don't introduce a parallel hook system. Lifecycle events: `PIPELINE.START` → `PIPELINE.READ` → (`PIPELINE.MAP` → `PIPELINE.WRITE`)* → `PIPELINE.DONE`.
- **Authorization is the consumer's job** — the plugin does not put `@(requires:…)` on `/pipeline`. Don't add it.
- **Peer dep** is `@sap/cds >= 9`; Node `>= 22`. Don't import from `@sap/cds` internals.
- **Published `files`** in `package.json` is allowlist-only. New runtime code must live under an allowed path or be added to `files`.

## Gotchas

- `global.cds` vs `require('@sap/cds')` — see header comment in `cds-plugin.js`. Apply the same rule when adding new entry points.
- Fixture pipelines only register when `CDS_PIPELINE_TEST_CONSUMER=true`; running the consumer fixture outside Jest will look empty.
- The Pipeline Console UI in `app/pipeline-console/` is generated — edits belong in `app/pipeline-console-src/`.
- HANA HDI deploys are owned by the consumer build; the plugin performs no runtime DDL.
