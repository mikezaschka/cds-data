# cds-data-materialization

![status: experimental](https://img.shields.io/badge/status-experimental-orange)
![npm: not released](https://img.shields.io/badge/npm-not%20released-lightgrey)
[![CI](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml/badge.svg)](https://github.com/mikezaschka/cds-data/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mikezaschka/cds-data/blob/main/LICENSE)
![SAP CAP](https://img.shields.io/badge/SAP%20CAP-%E2%89%A5%209-0a6ed1)
[![Documentation](https://img.shields.io/badge/docs-online-brightgreen)](https://mikezaschka.github.io/cds-data/materialization/)

Declarative `@materialize.snapshot` annotations for SAP CAP — scheduled aggregate snapshots that compose [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline).

## Scope

- **`@materialize.snapshot`** — aggregation-shaped CDS projection (`group by`, `sum` / `count` / …) bound to a query-shape pipeline on `cds-data-pipeline`.
- **Projection → CQN compiler** — derives `source.query` from the CDS model; no imperative `server.js` registration.
- Optional **`materialized`** aspect (`lastMaterializedAt`, `lastMaterializedBy`) for target entities.

Not in scope: remote OData/REST aggregates (replicate first), partial refresh from annotation (v1.x), cross-source joins.

## Install

```bash
npm add cds-data-materialization cds-data-pipeline
```

Peer dependencies:

- `@sap/cds` >= 8 (required)
- `cds-data-pipeline` >= 0.1.0 (required)
- `cds-caching` (optional; not used by this plugin in v1)

## Example

```cds
using from 'cds-data-pipeline/db';

namespace reporting;

@materialize.snapshot: {
  schedule : '0 2 * * *',
  source   : { service: 'db' }
}
entity DailyCustomerRevenue as projection on sales.Orders {
  key customerId,
      sum(amount)     as totalAmount  : Decimal(15, 2),
      count(*)        as orderCount   : Integer,
      max(modifiedAt) as lastActivity : Timestamp
}
group by customerId;
```

`source.service` is the `cds.requires` entry that executes the aggregate query (typically `db` for local tables). The projection `from` ref names the CSN entity (`sales.Orders` or namespace-local `Orders`).

## Composition

| Package | Role |
|---|---|
| `cds-data-pipeline` | Engine: `READ → MAP → WRITE`, tracker, management API |
| `cds-data-federation` | Remote delegate / replicate (`@federation.*`) |
| `cds-data-materialization` | Local snapshots (`@materialize.*`) |

Install federation and materialization side by side when you need both remote sync and local rollups.

## AI assistants

This package ships agent guidance in the npm tarball:

- `node_modules/cds-data-materialization/AGENTS.md` — index, decision trees, anti-patterns
- `node_modules/cds-data-materialization/skills/` — task skills ([Agent Skills](https://agentskills.io) format)

To symlink skills into your agent workspace (Cursor, Claude Code, …):

```bash
npx skills-npm --include cds-data-materialization
```

For live CDS model introspection, configure [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) in your project's MCP config.

## Docs

Published documentation: [Materialization plugin](https://mikezaschka.github.io/cds-data/materialization/) (monorepo docs site). Local preview: `npm run docs:serve` from the repository root, then open `/materialization/`.
