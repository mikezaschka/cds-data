# cds-data-pipeline — Agent guide

CAP plugin for declarative, scheduled `READ → MAP → WRITE` pipelines between one source and one target. Load this file when registering pipelines, choosing replicate vs materialize vs move, configuring event hooks, or enabling the Pipeline Console.

## Install

```bash
npm add cds-data-pipeline
```

Peer dependency: `@sap/cds` >= 9 · Node >= 22

Connect: `cds.connect.to('datapipeline')` (`DataPipelineService` alias still supported).

## Management API + tracker

**Reuse (config):**

```json
"datapipeline": {
  "impl": "cds-data-pipeline",
  "management": { "reuse": { "api": true, "console": true } }
}
```

**Manual:**

```cds
using from 'cds-data-pipeline/index.cds';
```

See [Feature activation](https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation.html).

## When to use which surface

```
Need data movement?
├─ Annotation-driven remote sync → cds-data-federation @federation.replicate
├─ Annotation-driven local snapshot → cds-data-materialization @materialize.snapshot
└─ Programmatic / custom adapters → addPipeline({ source, target, ... })
```

## Skills (task workflows)

| Skill | Use when |
|---|---|
| [pipeline-setup](skills/pipeline-setup/SKILL.md) | Installing, tracker schema, management service |
| [add-pipeline](skills/add-pipeline/SKILL.md) | `addPipeline` config, inference, delta, schedule |
| [pipeline-hooks](skills/pipeline-hooks/SKILL.md) | `PIPELINE.*` event hooks |
| [pipeline-console](skills/pipeline-console/SKILL.md) | Pipeline Console at `/pipeline-console` |

## Documentation

- Pipeline guide: https://mikezaschka.github.io/cds-data/pipeline/
- Feature activation: https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation.html
- Pipeline Console: https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console.html
