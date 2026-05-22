---
name: federation-setup
description: Installs and verifies cds-data-federation in a SAP CAP project. Use when adding the federation plugin, checking peer dependencies, confirming plugin boot, or troubleshooting missing cds-data-pipeline for replicate.
---

# Federation setup

## Install

```bash
# Delegate-only:
npm add cds-data-federation

# Replicate or entity cache:
npm add cds-data-federation cds-data-pipeline
```

## Peer dependency matrix

| Package | When required |
|---|---|
| `@sap/cds` >= 8 | Always |
| `@sap-cloud-sdk/http-client`, `@sap-cloud-sdk/resilience` | OData remotes (usually already present with CAP OData) |
| `cds-data-pipeline` | `@federation.replicate`, `cache.strategy: 'entity'` |
| `cds-caching` >= 1 | `cache.strategy: 'response'` (default) |
| `@cap-js/sqlite` >= 2 | Optional — secondary SQLite for entity cache |

## Verify boot

Start the app and confirm:

```
[cds-data-federation] discovered N @federation.* entities
```

If N is 0, check that entities have `@federation.delegate` or `@federation.replicate` and a `projection on remote.X` clause.

## Remote service prerequisite

Configure the remote in `cds.requires` per CAP [Reuse & Compose — Service Integration](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#service-integration).

## Anti-patterns

❌ **Wrong** — `@federation.replicate` without `cds-data-pipeline` in `package.json`.

✅ **Correct** — `npm add cds-data-pipeline` before annotating replicate entities.

❌ **Wrong** — expecting the plugin to wire REST delegate reads.

✅ **Correct** — REST sources use `@federation.replicate` with explicit `rest` config.

## Next steps

- First delegate entity → [delegate-consumption-view](../delegate-consumption-view/SKILL.md)
- First replicate entity → [replicate-consumption-view](../replicate-consumption-view/SKILL.md)
- Docs: https://mikezaschka.github.io/cds-data/federation/getting-started/installation.html
