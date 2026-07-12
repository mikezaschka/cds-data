# cds-data-pipeline

[![npm version](https://img.shields.io/npm/v/cds-data-pipeline)](https://www.npmjs.com/package/cds-data-pipeline)
[![monthly downloads](https://img.shields.io/npm/dm/cds-data-pipeline)](https://www.npmjs.com/package/cds-data-pipeline)
[![CI](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml/badge.svg)](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mikezaschka/cds-data/blob/main/LICENSE)
![SAP CAP](https://img.shields.io/badge/SAP%20CAP-CDS%209%20%26%2010-0a6ed1)
[![Documentation](https://img.shields.io/badge/docs-online-brightgreen)](https://mikezaschka.github.io/cds-data/pipeline/)

[Documentation](https://mikezaschka.github.io/cds-data/pipeline/) · [npm](https://www.npmjs.com/package/cds-data-pipeline)

**A CAP plugin for declarative, scheduled data pipelines between CAP services.** Each pipeline moves data from one source to one target in a linear `READ → MAP → WRITE` flow — with tracking, retry, delta support, and a management API out of the box.

## Beyond CAP

CAP already gives you the moving parts — `cds.connect.to`, consumption views, `cds.ql`, `UPSERT`, `cds.spawn`, the [Event Queues scheduling API](https://cap.cloud.sap/docs/releases/2026/jun26#scheduling-api) (CDS 10), and the standard `before` / `on` / `after` hook API on services. Reference samples assemble the read–map–write loop by hand: paging, delta watermarks, error handling, and scheduling copied into every project.

**This plugin reuses those primitives** and adds the orchestration layer on top:

| Reuses from CAP | Adds on top |
|---|---|
| `cds.connect.to` for source and target I/O | Fixed `READ → MAP → WRITE` run envelope with `PIPELINE.*` events |
| `cds.spawn` / [Event Queues scheduling API](https://cap.cloud.sap/docs/releases/2026/jun26#scheduling-api) / external `execute` | Three scheduling engines — see below |
| `UPSERT` / `INSERT` / `DELETE` via target adapters | Delta modes, retry with backoff, concurrency guard, run history |
| Standard service hooks | Per-pipeline `before` / `on` / `after` on every phase — opt-in only |
| Consumption views (when used with federation) | Management OData at `/pipeline`, data inspector, [Pipeline Console](https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console) |

You call `addPipeline({ source, target, … })` once; the engine owns the loop. Hooks are the CAP escape hatch when a run needs custom logic — not a requirement for every pipeline.

## Install

```bash
npm add cds-data-pipeline
```

| Dependency | Version | Notes |
|---|---|---|
| `@sap/cds` | `>= 9` | **CDS 9 and CDS 10** |
| Node.js | `>= 22` | |

Connect: `cds.connect.to('data-pipeline')`. Full feature list: [Features](https://mikezaschka.github.io/cds-data/pipeline/reference/features).

## Features

### Pipeline intents

Intent is [inferred from the config shape](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference) — no `kind` flag.

| Intent | Typical shape |
|---|---|
| **Replicate** | Remote entity → local DB table |
| **Materialize** | `source.query` (aggregates, joins) → local table |
| **Move-to-service** | Local/remote source → remote OData target |
| **Fan-in** | Multiple sources → one table via `source.origin` |

### Source adapters

OData V2/V4, REST (cursor/offset/page), CQN, server-driven paging, [custom](https://mikezaschka.github.io/cds-data/pipeline/guide/sources/custom). See [Sources](https://mikezaschka.github.io/cds-data/pipeline/guide/sources/).

### Target adapters

Local DB (default), remote OData, [custom](https://mikezaschka.github.io/cds-data/pipeline/guide/targets/custom). See [Targets](https://mikezaschka.github.io/cds-data/pipeline/guide/targets/).

### Delta, scheduling, hooks

| Area | Highlights |
|---|---|
| **Delta** | `timestamp`, `key`, `datetime-fields`, or `full` refresh |
| **Scheduling** | `spawn` (`cds.spawn`), `queued` (Event Queues API), or external trigger — see below |
| **Event hooks** | `PIPELINE.START → READ → MAP → WRITE → DONE` via standard `before` / `on` / `after` |
| **Housekeeping** | Opt-in `PipelineRuns` retention (`retentionDays`, `maxRuns`) |

**Scheduling engines**

| Engine | CAP primitive | When to use |
|---|---|---|
| **`spawn`** (default) | `cds.spawn({ every })` | Dev, single instance, best-effort interval |
| **`queued`** | `cds.queued(srv).schedule(...).every(...)` — the [June 2026 scheduling API](https://cap.cloud.sap/docs/releases/2026/jun26#scheduling-api) | Scaled deployments: single-winner across instances, survives restarts, cron (`engine: 'queued'`). On CDS 10, named tasks (`.as(...)`) enable live `setSchedule` / `clearSchedule` via `unschedule` |
| **External** | `POST /pipeline/execute` | BTP Job Scheduling Service, Kubernetes CronJob, corporate cron |

```javascript
schedule: 600_000,                              // spawn — implicit engine
schedule: { every: '10m', engine: 'queued' }, // Event Queues: .schedule().every()
schedule: { cron: '0 2 * * *', engine: 'queued' },
```

Details: [Internal scheduling (queued)](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/internal-scheduling-queued) · [External scheduling](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/external-scheduling-jss) · [Recipes](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/) · [Event hooks](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/event-hooks)

### Management API and observability

OData at `/pipeline`: pipeline list, run history, statistics, `execute`, `flush`, `inspectData`, configuration overrides. See [Management service](https://mikezaschka.github.io/cds-data/pipeline/reference/management-service).

### Resilience

Retry with exponential backoff on remote I/O, concurrency guard (no parallel runs), transactional batches.

## Quick example

```javascript
const cds = require('@sap/cds');

cds.on('served', async () => {
    const pipelines = await cds.connect.to('data-pipeline');

    await pipelines.addPipeline({
        name: 'BusinessPartners',
        source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
        target: { entity: 'db.BusinessPartners' },
        delta: { field: 'modifiedAt', mode: 'timestamp' },
        schedule: 600_000,
    });
});

module.exports = cds.server;
```

Step-by-step: [Get started](https://mikezaschka.github.io/cds-data/pipeline/guide/get-started)

## Used by `cds-data-federation`

[`cds-data-federation`](https://www.npmjs.com/package/cds-data-federation) composes this engine for annotation-driven sync — you install both packages, but rarely call `addPipeline` yourself:

- **`@federation.replicate`** — federation scans consumption views at boot and registers entity-shape pipelines via `pipeline-binding.js` (source entity → local table, schedule, delta from annotation options).
- **`cache.strategy: 'entity'`** on `@federation.delegate` — on TTL miss, a pipeline fills a SQLite snapshot of the projected entity.

Federation-bound pipelines show up in `/pipeline` and the Pipeline Console alongside programmatic ones. For custom transforms on a federation pipeline, hook the pipeline **by name** (defaults to the entity name). See the [federation README](https://www.npmjs.com/package/cds-data-federation) and [first replication](https://mikezaschka.github.io/cds-data/federation/getting-started/first-replication).

## Event hooks (optional)

`DataPipelineService` is a normal `cds.Service`. The default path needs no handler code — register `before` / `on` / `after` on `PIPELINE.*` **only when** a run needs filtering, enrichment, side effects, or observability beyond the built-in MAP/WRITE. That is the usual CAP pattern: declarative wiring by default, intercept when processing gets non-trivial.

```javascript
const pipelines = await cds.connect.to('data-pipeline');

// Filter source rows before rename mapping (federation replicate or addPipeline)
pipelines.before('PIPELINE.MAP', 'ReplicatedPartners', (req) => {
    req.data.sourceRecords = req.data.sourceRecords.filter(r => !r.blocked);
});

// Per-batch side effect after the default WRITE commits its statistics
pipelines.after('PIPELINE.WRITE', 'Shipments', async (_results, req) => {
    const { runId, batchIndex, statistics } = req.data;
    await cds.tx(req).run(INSERT.into('BatchMetrics').entries({
        runId, batchIndex, created: statistics?.created ?? 0,
    }));
});
```

Full event reference: [Event hooks](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/event-hooks) · [Management service](https://mikezaschka.github.io/cds-data/pipeline/reference/management-service#event-hooks)

## Pipeline Console

Pre-built UI for `/pipeline` — enable via config reuse or `cds add pipeline-console`:

```json
{
  "cds": {
    "requires": {
      "data-pipeline": {
        "impl": "cds-data-pipeline",
        "management": {
          "reuse": {
            "api": true,
            "console": true
          }
        }
      }
    }
  }
}
```

![Pipeline landscape — services and data flows grouped by remote service](https://raw.githubusercontent.com/mikezaschka/cds-data/main/docs/images/pipeline-landscape.png)

![Pipeline detail — list, schedules, and per-run statistics](https://raw.githubusercontent.com/mikezaschka/cds-data/main/docs/images/pipeline-runs.png)

Details: [Pipeline Console](https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console) · [Feature activation](https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation)

## Documentation

- [Pipeline guide](https://mikezaschka.github.io/cds-data/pipeline/) — concepts, recipes, adapters
- [Feature catalog](https://mikezaschka.github.io/cds-data/pipeline/reference/features)
- [Programmatic API](https://mikezaschka.github.io/cds-data/pipeline/reference/api)
- [Management service](https://mikezaschka.github.io/cds-data/pipeline/reference/management-service)

## AI assistants

**Coming soon.** Agent guidance (`AGENTS.md`) and task skills for coding assistants will ship in a future release.

---

> **SAP data extraction.** `@sap/cds` ships under the [SAP Developer License Agreement (3.2 CAP)](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt). Section 1 limits mass extraction from an SAP product to a non-SAP product unless required for interoperability with an SAP product. When pointing a pipeline at an SAP source, stay within that carve-out.
