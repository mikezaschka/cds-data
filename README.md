# cds-data-pipeline + cds-data-federation

Three composable SAP CAP packages: a pipeline engine, a federation annotation plugin, and a materialization annotation plugin for local aggregate snapshots.

## Which package do I need?

| I want to… | Install | Docs |
|---|---|---|
| Declare `@federation.delegate` / `@federation.replicate` on a consumption view and have CAP handle delegation, cross-service `$expand`, and scheduled sync for me | `npm add cds-data-federation cds-data-pipeline` | [Federation docs](https://mikezaschka.github.io/cds-data-federation/federation/) · [README](./packages/cds-data-federation/README.md) |
| Declare `@materialize.snapshot` on a `group by` projection and persist scheduled rollups locally | `npm add cds-data-materialization cds-data-pipeline` | [README](./packages/cds-data-materialization/README.md) |
| Register a standalone pipeline programmatically — `addPipeline({ source, target, mode, … })` — with tracker, retry, management OData API, and event hooks | `npm add cds-data-pipeline` | [Pipeline docs](https://mikezaschka.github.io/cds-data-federation/pipeline/) · [README](./packages/cds-data-pipeline/README.md) |

The federation and materialization plugins depend on the pipeline engine for scheduled runs; delegate-only setups can install just `cds-data-federation`.

## Examples

Runnable demos live under [`examples/`](./examples/). The headline demo is the **Sales Intelligence Workbench** under [`examples/sales-intel/`](./examples/sales-intel/) — Northwind V4 + V2, a local CAP provider, and a local REST provider, fused into a Fiori Elements launchpad that shows delegation, replication, cross-service `$expand`, and cache visibility side-by-side. Start it with `bash examples/sales-intel/start-all.sh` and open http://localhost:4005/launchpage.html.

An earlier smaller demo — **Movies & Streaming** — lives at [`examples/consumer/`](./examples/consumer/) and still boots via `npm run examples:start`.

## Links

- [cds-data-pipeline on npm](https://www.npmjs.com/package/cds-data-pipeline)
- [cds-data-federation on npm](https://www.npmjs.com/package/cds-data-federation)
- [cds-data-materialization](./packages/cds-data-materialization/) (monorepo workspace; npm publish TBD)
- [Documentation portal](https://mikezaschka.github.io/cds-data-federation/)
- [cds-caching](https://github.com/mikezaschka/cds-caching) — optional peer for `cache.strategy: 'response'`; built-in `cache.strategy: 'entity'` uses `cds-data-pipeline` + SQLite instead
- [CAP Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) — upstream delegation & federation reference

## For contributors

Internal references, primers, and the feature tracker live alongside the code. These links are for contributors and AI assistants working on the repository — they are not needed to use the packages from npm.

- [spec/reference/requirements.md](./spec/reference/requirements.md) — full feature matrix with status, priority, and architecture rationale.
- [spec/reference/test-mapping.md](./spec/reference/test-mapping.md) — auto-generated test ↔ requirement ID mapping.
- Tests live under `packages/cds-data-pipeline/test/`, `packages/cds-data-federation/test/`, and `packages/cds-data-materialization/test/` (root `npm test` runs all three).
- [CLAUDE.md](./CLAUDE.md) — deep architecture notes and project conventions.
- [AGENTS.md](./AGENTS.md) — cross-tool entry point for AI coding assistants (Cursor, Claude Code, Codex, …).
- [spec/internal/](./spec/internal/) — ADRs, research notes, plans, and the contributor canonical [`spec/concepts/`](./spec/concepts/) tree.
