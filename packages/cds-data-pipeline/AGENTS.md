# cds-data-pipeline — Agent guide

CAP plugin for declarative, scheduled `READ → MAP → WRITE` pipelines between one source and one target. Load this file when registering pipelines, choosing replicate vs materialize vs move, configuring event hooks, or mounting the Pipeline Console.

## Install

```bash
npm add cds-data-pipeline
```

Peer dependency: `@sap/cds` >= 8 · Node >= 22

Include tracker schema and management service in your project:

```cds
using from 'cds-data-pipeline/db';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
```

The plugin auto-registers `DataPipelineService` via `cds-plugin.js`.

## When to use which surface

```
Need data movement?
├─ Annotation-driven remote sync → cds-data-federation @federation.replicate
├─ Annotation-driven local snapshot → cds-data-materialization @materialize.snapshot
└─ Programmatic / custom adapters → addPipeline({ source, target, ... })
```

## Inference (no kind field)

Behavior is **inferred from config shape** — do not pass `kind` to `addPipeline`.

| Source shape | Inferred behavior |
|---|---|
| `source.entity` (or `rest.path`) | Entity-shape — paginated read, default `mode: 'delta'` |
| `source.query` | Query-shape — single-shot aggregate/snapshot, default `mode: 'full'` |

## Top anti-patterns

❌ **Wrong** — passing `kind: 'replicate'` to `addPipeline`.

✅ **Correct** — use entity + db target shape; engine infers replicate semantics.

❌ **Wrong** — both `source.query` and `source.entity` set.

✅ **Correct** — pick one source shape.

❌ **Wrong** — `source.query` with `mode: 'delta'`.

✅ **Correct** — query-shape snapshots use full refresh.

❌ **Wrong** — `target.service` set to a remote name without a custom `target.adapter`.

✅ **Correct** — db target uses `{ entity: 'db.MyTable' }` or implement a custom target adapter.

## Skills (task workflows)

| Skill | Use when |
|---|---|
| [pipeline-setup](skills/pipeline-setup/SKILL.md) | Installing, tracker schema, management service |
| [add-pipeline](skills/add-pipeline/SKILL.md) | `addPipeline` config, inference, delta, schedule |
| [pipeline-hooks](skills/pipeline-hooks/SKILL.md) | `PIPELINE.*` event hooks |
| [pipeline-console](skills/pipeline-console/SKILL.md) | Pipeline Console UI at `/pipeline-console` |

## MCP recommendation

Before proposing CDS or CAP runtime changes, configure [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) and use `search_model` / `search_docs`.

## Documentation

- Pipeline guide: https://mikezaschka.github.io/cds-data-federation/pipeline/
- Get started: https://mikezaschka.github.io/cds-data-federation/pipeline/guide/get-started.html
- Inference rules: https://mikezaschka.github.io/cds-data-federation/pipeline/guide/concepts/inference.html
- Management API: https://mikezaschka.github.io/cds-data-federation/pipeline/reference/management-service.html
- Pipeline Console: https://mikezaschka.github.io/cds-data-federation/pipeline/guide/pipeline-console.html
