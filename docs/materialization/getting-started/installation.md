# Installation

## Install the plugin

```bash
npm add cds-data-materialization cds-data-pipeline
```

The plugin auto-activates on load via `cds-plugin.js` — no manual wiring in `server.js`.

For AI coding assistants, the installed package also ships `node_modules/cds-data-materialization/AGENTS.md` and task skills under `skills/` — see the package README § AI assistants.

## Peer dependencies

| Package | Version | Required? |
|---|---|---|
| `@sap/cds` | `>= 8` | **Yes** |
| `cds-data-pipeline` | `>= 0.1.0` | **Yes** — loud error at `served` if missing |
| [`cds-caching`](https://github.com/mikezaschka/cds-caching) | `>= 1` | Optional — not used by this plugin in v1 |

## Verifying the install

Boot your CAP app and look for a line like this in the log:

```
[cds-data-materialization] Discovered 1 @materialize.snapshot entities
```

That confirms the plugin found annotations and bound pipelines on `served`. Continue with [First snapshot](first-snapshot.md).

## Node.js version

Node.js 22 or newer (aligned with the monorepo engine packages).
