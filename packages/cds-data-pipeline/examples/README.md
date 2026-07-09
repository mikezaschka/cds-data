# Examples

Seven small, self-contained examples — one per plugin entry point — built on top of two shared backend services. Each example is a runnable CAP app: its own `package.json`, `db/`, `srv/`, `http/` scenarios, `start.sh`, and a README that walks through one feature of `cds-data-pipeline`.

Each example enables the **plugin-provided Pipeline Console** and management OData API via `management.reuse.*` in `package.json` — no local UI5 projects, launchpad, or `cds-plugin-ui5` wiring. Open `http://localhost:<port>/pipeline-console/` to watch runs, error counts, and statistics in the browser.

## Shared substrate

- `_providers/` — two reusable backends (LogisticsService CAP V4, FXService REST) plus a `start-providers.sh` script. See [_providers/README.md](_providers/README.md).

## Example catalogue

| Example | Plugin feature | Doc anchor | Port |
|---|---|---|---|
| [01-replicate-odata](01-replicate-odata/) | Entity-shape replicate from OData V4 via consumption view + `viewMapping` | [recipes/built-in-replicate](../docs/guide/recipes/built-in-replicate.md) | 4101 |
| [02-replicate-rest](02-replicate-rest/) | REST source with offset pagination + `modifiedSince` delta + `dataPath` | [sources/rest](../docs/guide/sources/rest.md) | 4102 |
| [03-materialize-cqn](03-materialize-cqn/) | Query-shape materialize (CQN aggregate) with `refresh: 'full'` + partial-refresh slice | [recipes/built-in-materialize](../docs/guide/recipes/built-in-materialize.md) | 4103 |
| [04-move-to-service](04-move-to-service/) | Move-to-service via `ODataTargetAdapter` — remote OData source → remote OData target | [recipes/built-in-replicate#to-a-remote-odata-target](../docs/guide/recipes/built-in-replicate.md) | 4104 |
| [05-multi-source-fanin](05-multi-source-fanin/) | N backends → one target table with `source.origin` + `plugin.data_pipeline.sourced` aspect | [recipes/multi-source](../docs/guide/recipes/multi-source.md) | 4105 |
| [06-event-hooks](06-event-hooks/) | Full 5-event envelope: `before/on/after` on `PIPELINE.START`/`READ`/`MAP`/`WRITE`/`DONE` | [recipes/event-hooks](../docs/guide/recipes/event-hooks.md) | 4106 |
| [07-event-driven-runs](07-event-driven-runs/) | Batch delta + CAP messaging micro-runs (`executeEvent`, `read: key/payload`, watermark-safe) | [recipes/event-driven-runs](../docs/guide/recipes/event-driven-runs.md) | 4107 |

## Port allocation

```
4100  pipeline-console dev backend (contributors only — see _dev/)
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

# Visit http://localhost:4101/pipeline-console/ for the Pipeline Console,
# and http://localhost:4101/odata/v4/... for the example's own OData service.
# Run the .http scenarios in examples/01-replicate-odata/http/ via the
# VS Code REST Client extension.
```

## Pipeline Console UI development

Contributors editing the TypeScript UI use the dedicated dev backend at [`_dev/pipeline-console/`](_dev/pipeline-console/) (port **4100**, multiple pipelines). See [Pipeline Console guide](../docs/guide/pipeline-console.md#developing-the-ui-typescript).

## Management UI configuration

Every example's `package.json` includes:

```json
"datapipeline": {
  "impl": "cds-data-pipeline",
  "management": {
    "reuse": {
      "api": true,
      "console": true
    }
  }
}
```

See [feature activation](../docs/guide/feature-activation.md) for reuse vs. own (`cds add pipeline-console`) trade-offs.

## Relationship to the docs

Each example README opens with a one-line anchor to the doc page it expands on. The docs are the reference; the examples show one end-to-end configuration plus its observable output. Code snippets in the docs are intentionally self-contained — the examples add the runnable wiring (CAP service file, HTTP scenarios, pipeline registration) around them.

A custom source / target adapter is intentionally not included here — the code lives in [Custom source](../docs/guide/sources/custom.md) and [Custom target](../docs/guide/targets/custom.md) and adds little that the seven above don't already cover.
