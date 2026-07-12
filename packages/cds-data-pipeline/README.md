# cds-data-pipeline

[![npm version](https://img.shields.io/npm/v/cds-data-pipeline)](https://www.npmjs.com/package/cds-data-pipeline)
[![monthly downloads](https://img.shields.io/npm/dm/cds-data-pipeline)](https://www.npmjs.com/package/cds-data-pipeline)
[![CI](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml/badge.svg)](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mikezaschka/cds-data/blob/main/LICENSE)
![SAP CAP](https://img.shields.io/badge/SAP%20CAP-CDS%209%20%26%2010-0a6ed1)
[![Documentation](https://img.shields.io/badge/docs-online-brightgreen)](https://mikezaschka.github.io/cds-data/pipeline/)

[Documentation](https://mikezaschka.github.io/cds-data/pipeline/) · [npm](https://www.npmjs.com/package/cds-data-pipeline)

**A CAP plugin for declarative, scheduled data pipelines between CAP services.** Each pipeline moves data from one source to one target in a linear `READ → MAP → WRITE` flow — with tracking, retry, delta support, and a management API out of the box.

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
| **Scheduling** | In-process `spawn`, persistent `queued`, or external trigger |
| **Event hooks** | `PIPELINE.START → READ → MAP → WRITE → DONE` via standard `before` / `on` / `after` |
| **Housekeeping** | Opt-in `PipelineRuns` retention (`retentionDays`, `maxRuns`) |

Details: [Recipes](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/) · [Event hooks](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/event-hooks)

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
