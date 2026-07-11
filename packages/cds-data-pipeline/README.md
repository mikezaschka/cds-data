# cds-data-pipeline

[![npm version](https://img.shields.io/npm/v/cds-data-pipeline)](https://www.npmjs.com/package/cds-data-pipeline)
[![monthly downloads](https://img.shields.io/npm/dm/cds-data-pipeline)](https://www.npmjs.com/package/cds-data-pipeline)
[![CI](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml/badge.svg)](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mikezaschka/cds-data/blob/main/LICENSE)
![SAP CAP](https://img.shields.io/badge/SAP%20CAP-%E2%89%A5%209-0a6ed1)
[![Documentation](https://img.shields.io/badge/docs-online-brightgreen)](https://mikezaschka.github.io/cds-data/pipeline/)

> **Work in progress.** APIs, schema, and documentation may change before a stable release.

[Documentation](https://mikezaschka.github.io/cds-data/pipeline/) · [npm](https://www.npmjs.com/package/cds-data-pipeline)

**A CAP plugin for declarative, scheduled data pipelines between CAP services.** Each pipeline moves data from one source to one target in a linear `READ → MAP → WRITE` flow — with tracking, retry, delta support, and a management API out of the box.

## Why

CAP makes it easy to connect services, but replicating or materializing data between them requires boilerplate: paging, delta logic, error handling, scheduling, observability. Every project re-implements the same loop. This plugin extracts that pattern into a reusable, idiomatic CAP building block.

It sits **above** ad-hoc `cds.spawn` scripts and **below** SAP Integration Suite / SDI / SLT, which solve cross-system, out-of-process problems.

## Use cases

| Use case | Description |
|---|---|
| **Replicate** | Copy rows from a remote entity into a local table (filtered, projected, renamed). |
| **Materialize** | Run a query (aggregates, joins, computed columns) and persist the result. |
| **Move-to-service** | Push data to a remote OData target or custom destination. |
| **Fan-in** | Consolidate the same entity from multiple sources into one target table. |

## Key concepts

- **`addPipeline(...)`** — register a pipeline. Behavior is [inferred from the config shape](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/inference).
- **Event hooks** — `PIPELINE.START → READ → MAP → WRITE → DONE`, using CAP's standard `before / on / after` API.
- **Consumption views** — declare the target as a `projection on <remote.Entity>` with `@cds.persistence.table`. One CDS declaration defines schema, column restriction, renames, and filters. See [Consumption views](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/consumption-views).
- **Source adapters** — OData V2/V4, REST (cursor/offset/page pagination), CQN, or [custom](https://mikezaschka.github.io/cds-data/pipeline/guide/sources/custom).
- **Target adapters** — local DB, remote OData, or [custom](https://mikezaschka.github.io/cds-data/pipeline/guide/targets/custom).
- **Delta modes** — polling-based `timestamp`, `key`, `datetime-fields`, or `full` refresh.
- **Scheduling** — in-process timer, persistent queue, or external (BTP Job Scheduling Service, CronJob).
- **Run housekeeping** — opt-in retention for `PipelineRuns` history (`retentionDays`, `maxRuns`); see [Run housekeeping](https://mikezaschka.github.io/cds-data/pipeline/guide/concepts/housekeeping).
- **Management API** — OData at `/pipeline` with tracker, run history, statistics, and `execute` action.

## Quick start

```bash
npm add cds-data-pipeline
```

Peer dependency: `@sap/cds` >= 9.2 · Node >= 22

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

Step-by-step setup: [Get started](https://mikezaschka.github.io/cds-data/pipeline/guide/get-started)

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

Details: [Pipeline Console](https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console) · [Feature activation](https://mikezaschka.github.io/cds-data/pipeline/guide/feature-activation)

## Documentation

Full docs — concepts, recipes, adapter references, management API — at **<https://mikezaschka.github.io/cds-data/pipeline/>**.

## AI assistants

This package ships agent guidance in the npm tarball:

- `node_modules/cds-data-pipeline/AGENTS.md` — index, decision trees, anti-patterns
- `node_modules/cds-data-pipeline/skills/` — task skills ([Agent Skills](https://agentskills.io) format)

To symlink skills into your agent workspace (Cursor, Claude Code, …):

```bash
npx skills-npm --include cds-data-pipeline
```

For live CDS model introspection, configure [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) in your project's MCP config.

---

> **SAP data extraction.** `@sap/cds` ships under the [SAP Developer License Agreement (3.2 CAP)](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP.txt). Section 1 limits mass extraction from an SAP product to a non-SAP product unless required for interoperability with an SAP product. When pointing a pipeline at an SAP source, stay within that carve-out.
