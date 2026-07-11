# Installation

::: warning Experimental — not yet released
`cds-data-materialization` is **experimental** and **not yet published to npm**. Until the first release, install it from the monorepo workspace rather than from the registry — the `npm add` command below documents the eventual package name.
:::

## Install the plugin

```bash
npm add cds-data-materialization cds-data-pipeline
```

The plugin auto-activates on load via `cds-plugin.js` — no manual wiring in `server.js`.

### AI assistants

**Coming soon.** Agent guidance and task skills for coding assistants will ship in a future release.

## Peer dependencies

| Package | Version | Required? |
|---|---|---|
| `@sap/cds` | `>= 9` | **Yes** — CDS 9 and CDS 10 are both supported |
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
