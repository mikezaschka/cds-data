# Examples

Seven small, self-contained examples — one per plugin entry point — built on top of two shared backend services. Each example is a runnable CAP app: its own `package.json`, `db/`, `srv/`, `http/` scenarios, `start.sh`, and a README that walks through one feature of `cds-data-pipeline`.

Each example is meant to include the two monitor UIs (Fiori Elements **Pipeline Monitor** and the freestyle **Pipeline Console** with `sap.f.FlexibleColumnLayout`) so you can watch runs, error counts, and statistics in a browser at `http://localhost:<port>/launchpage.html` (the launchpad has a tile for each app).

**One shared implementation** lives in [`_ui-pipeline/`](_ui-pipeline/): two UI5 Tooling 3 projects (`pipeline-monitor`, `pipeline-console`, TypeScript + `ui5 build`). Every example’s `package.json` links them with **`file:`** devDependencies; **[cds-plugin-ui5](https://github.com/ui5-community/ui5-ecosystem-showcase/tree/main/packages/cds-plugin-ui5)** serves them at `/pipeline-monitor` and `/pipeline-console` on the same origin as the CAP server. The sandbox `launchpage.html` is a single file in `_ui-pipeline/`; each example’s `app/launchpage.html` is a **symlink** to it. After changing the UIs, run `npm run ui:build` in any example (or `cd examples/_ui-pipeline && npm install && npm run build`).

## Shared substrate

- `_providers/` — two reusable backends (LogisticsService CAP V4, FXService REST) plus a `start-providers.sh` script. See [_providers/README.md](_providers/README.md).
- `_ui-pipeline/` — Fiori monitor + FCL console + launchpad (TypeScript, **cds-plugin-ui5**). See [_ui-pipeline/README.md](_ui-pipeline/README.md). Fiori list/object **annotations** for the management service live in the plugin at [`srv/monitor-annotations.cds`](../srv/monitor-annotations.cds) (not under `_ui-pipeline/`).

## Example catalogue

| Example | Plugin feature | Doc anchor | Port |
|---|---|---|---|
| [01-replicate-odata](01-replicate-odata/) | Entity-shape replicate from OData V4 via consumption view + `viewMapping` | [recipes/built-in-replicate](../docs/guide/recipes/built-in-replicate.md) | 4101 |
| [02-replicate-rest](02-replicate-rest/) | REST source with offset pagination + `modifiedSince` delta + `dataPath` | [sources/rest](../docs/guide/sources/rest.md) | 4102 |
| [03-materialize-cqn](03-materialize-cqn/) | Query-shape materialize (CQN aggregate) with `refresh: 'full'` + partial-refresh slice | [recipes/built-in-materialize](../docs/guide/recipes/built-in-materialize.md) | 4103 |
| [04-move-to-service](04-move-to-service/) | Move-to-service via `ODataTargetAdapter` — remote OData source → remote OData target | [recipes/built-in-replicate#to-a-remote-odata-target](../docs/guide/recipes/built-in-replicate.md) | 4104 |
| [05-multi-source-fanin](05-multi-source-fanin/) | N backends → one target table with `source.origin` + `plugin.data_pipeline.sourced` aspect | [recipes/multi-source](../docs/guide/recipes/multi-source.md) | 4105 |
| [06-event-hooks](06-event-hooks/) | Full 5-event envelope: `before/on/after` on `PIPELINE.START`/`READ`/`MAP_BATCH`/`WRITE_BATCH`/`DONE` | [recipes/event-hooks](../docs/guide/recipes/event-hooks.md) | 4106 |
| [07-event-driven-runs](07-event-driven-runs/) | ADR 0009: batch delta + CAP messaging micro-runs (`executeEvent`, `read: key/payload`, watermark-safe) | [recipes/event-driven-runs](../docs/guide/recipes/event-driven-runs.md) | 4107 |

## Port allocation

```
4101  example 01 consumer
4102  example 02 consumer
4103  example 03 consumer
4104  example 04 consumer
4105  example 05 consumer
4106  example 06 consumer
4107  example 07 consumer

4455  LogisticsService (DEV origin) — used by 01, 04, 05, 06, 07
4465  LogisticsService (PROD origin) — used by 05 only
4456  FXService                       — used by 02 only
```

## Running an example

Each example has a self-contained `start.sh` that launches its required providers and the example consumer on the matching `410x` port. Stop with `Ctrl+C`.

```bash
# Pick any example; its README is the walkthrough
bash examples/01-replicate-odata/start.sh

# Visit http://localhost:4101/launchpage.html for the Pipeline Monitor and Pipeline Console,
# and http://localhost:4101/odata/v4/... for the example's own OData service.
# Run the .http scenarios in examples/01-replicate-odata/http/ via the
# VS Code REST Client extension.
```

## Relationship to the docs

Each example README opens with a one-line anchor to the doc page it expands on. The docs are the reference; the examples show one end-to-end configuration plus its observable output. Code snippets in the docs are intentionally self-contained — the examples add the runnable wiring (CAP service file, HTTP scenarios, Pipeline Monitor setup) around them.

A custom source / target adapter is intentionally not included here — the code lives in [Custom source](../docs/guide/sources/custom.md) and [Custom target](../docs/guide/targets/custom.md) and adds little that the seven above don't already cover.
