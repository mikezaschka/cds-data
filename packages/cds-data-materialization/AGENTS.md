# cds-data-materialization — Agent guide

CAP plugin for declarative `@materialize.snapshot` annotations — scheduled aggregate snapshots composed on `cds-data-pipeline`. Load this file when adding snapshot projections, configuring `group by` aggregates, or choosing materialize vs replicate.

## Install

```bash
npm add cds-data-materialization cds-data-pipeline
```

| Package | Required when |
|---|---|
| `@sap/cds` >= 8 | Always |
| `cds-data-pipeline` >= 0.1.0 | Always — engine peer dependency |

The plugin auto-activates via `cds-plugin.js`. Requires tracker schema from `cds-data-pipeline` in the consumer project.

## When to use

```
Need local aggregates?
├─ Remote data not yet local → replicate first (cds-data-federation), then materialize
├─ Single-entity group by / sum / count → @materialize.snapshot
└─ Imperative custom query → cds-data-pipeline addPipeline with source.query
```

## Core principle

The **aggregation projection IS the snapshot contract**. `@materialize.snapshot` declares schedule and source service; the `group by` projection is compiled to CQN by the plugin.

## Top anti-patterns

❌ **Wrong** — `@materialize.snapshot` and `@federation.*` on the same entity.

✅ **Correct** — separate entities; replicate remote data first, then snapshot locally.

❌ **Wrong** — `@materialize.snapshot` with OData/REST as aggregate source.

✅ **Correct** — `source.service` must be CQN-native (`db` or in-process CAP service). Replicate remote entities first.

❌ **Wrong** — cross-source joins inside one materialization projection.

✅ **Correct** — stage data locally, then aggregate a single entity.

❌ **Wrong** — `refresh: 'partial'` from annotation (rejected in v1).

✅ **Correct** — use default full refresh, or programmatic `refresh.slice` on the engine.

## Skills (task workflows)

| Skill | Use when |
|---|---|
| [materialization-setup](skills/materialization-setup/SKILL.md) | Installing, peer deps, tracker prerequisite |
| [snapshot-projection](skills/snapshot-projection/SKILL.md) | `@materialize.snapshot`, group by, aggregates |

## MCP recommendation

Before proposing CDS or CAP runtime changes, configure [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) and use `search_model` / `search_docs`.

## Documentation

- Materialization guide: https://mikezaschka.github.io/cds-data/materialization/
- Annotations: https://mikezaschka.github.io/cds-data/materialization/reference/annotations.html
- Stage then aggregate: https://mikezaschka.github.io/cds-data/materialization/concepts/stage-then-aggregate.html
- First snapshot: https://mikezaschka.github.io/cds-data/materialization/getting-started/first-snapshot.html
