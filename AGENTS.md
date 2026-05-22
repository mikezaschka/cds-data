# Agents Guide

Entry point for AI coding assistants (Cursor, Claude Code, Codex, Copilot, Aider, ...) working on this repository. Read this first; follow the links, do not expect the content to be repeated here.

## Repo layout (npm workspaces)

| Path | Contents |
|---|---|
| [`packages/cds-data-pipeline/`](./packages/cds-data-pipeline/) | Pipeline engine (`DataPipelineService`, adapters, tracker entities, management service). Authoritative CDS at `db/index.cds`. |
| [`packages/cds-data-federation/`](./packages/cds-data-federation/) | Annotation plugin (`@federation.delegate` / `@federation.replicate`), `replicated` aspect, pipeline-binding seam. Declares `cds-data-pipeline` as a peer dependency. |
| [`packages/cds-data-materialization/`](./packages/cds-data-materialization/) | Annotation plugin (`@materialize.snapshot`), projection→CQN compiler, pipeline-binding for query-shape snapshots. Peer-dep `cds-data-pipeline`. |
| [`packages/cds-data-pipeline/test/`](./packages/cds-data-pipeline/test/) | Engine Jest suite (unit + integration). Real OData/REST fixtures; dynamic ports in `test/support/setup.js`. |
| [`packages/cds-data-federation/test/`](./packages/cds-data-federation/test/) | Federation Jest suite by scenario (`integration/delegate`, expand, navigation, caching, cud, …). Same fixture pattern. |
| [`packages/cds-data-materialization/test/`](./packages/cds-data-materialization/test/) | Materialization Jest suite (compiler unit tests, binding integration). |
| [`examples/`](./examples/) | Runnable demos: `examples/consumer/` (movies launchpad), `examples/sales-intel/workbench/` (federation/pipeline monitor). |
| [`docs/`](./docs/) | Public documentation (VitePress): `pipeline/`, `federation/`, `materialization/`. |
| [`spec/`](./spec/) | Contributor spec: `concepts/`, `internal/` (ADRs, plans), `reference/` (requirements, test mapping). |

## Read these before touching code

1. [`CLAUDE.md`](./CLAUDE.md) — project primer: what this monorepo is, terminology, core principles, the "don'ts" list.
2. [`spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md`](./spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md) — the current architectural spec (supersedes 0003, amends 0001).
3. [`spec/reference/requirements.md`](./spec/reference/requirements.md) — numbered feature matrix with `Implemented | In progress | Not started | Not supported | Removed` statuses.
4. [`spec/concepts/cross-service-scenarios.md`](./spec/concepts/cross-service-scenarios.md) — canonical reference for expand + navigation scenarios. Use the directional names (Delegated expand, Cross-service expand: local → remote, ...), not `Scenario A/B/C` in new prose.
5. [`spec/internal/ai-assistant-context.md`](./spec/internal/ai-assistant-context.md) — deep architecture, plugin lifecycle, CDS quirks, implementation status.

## Workflows

Use the workflows in [`.claude/commands/`](./.claude/commands/). They apply regardless of which AI tool you use — Claude Code invokes them as slash commands, other tools should read the file and follow the phases.

| Intent | Command | Output |
|---|---|---|
| Capture a loose idea, pre-decision | [`/brainstorm`](./.claude/commands/brainstorm.md) | `spec/internal/ideas/<slug>.md` |
| Decide an architectural question | [`/discuss-architecture`](./.claude/commands/discuss-architecture.md) | ADR in `spec/internal/decisions/` |
| Implement a feature from the matrix | [`/implement-feature`](./.claude/commands/implement-feature.md) | Plan doc, tests, code, doc updates |
| Fix a bug | [`/fix-bug`](./.claude/commands/fix-bug.md) | Failing test → fix → `fix:` commit |
| Review a diff or PR | [`/review`](./.claude/commands/review.md) | Checklist report (read-only) |
| Deprecate / remove a feature | [`/deprecate`](./.claude/commands/deprecate.md) | ADR + `Removed` status |
| Sync the Progress Summary | [`/update-requirements`](./.claude/commands/update-requirements.md) | Regenerated table |

## Conventions

Every convention is documented in [`CLAUDE.md`](./CLAUDE.md) (§Conventions, §Don'ts). Do not paraphrase them here. Highlights:

- Logging: `cds.log('cds-data-pipeline')` in engine code, `cds.log('cds-data-federation')` in federation code, `cds.log('cds-data-materialization')` in materialization code. Never `console.log`.
- CQN safety: `cds.ql.clone(query)` before any mutation.
- Remote I/O: wrap in `withRetry(...)` from `packages/cds-data-pipeline/srv/lib/retry.js`.
- Tests: use real providers from each package's `test/support/setup.js`, not mocks. Root `npm test` runs all three workspace suites serially.
- Docs: low-redundancy rule. Public pages live under `docs/pipeline/`, `docs/federation/`, and `docs/materialization/`; contributor canonical concepts live under `spec/concepts/`. See [ADR 0006](./spec/internal/decisions/0006-per-plugin-published-surface.md).
- External docs tone + internal-reference hygiene: see [`spec/internal/docs-style-guide.md`](./spec/internal/docs-style-guide.md). Published scope: `docs/**`, `packages/*/README.md`, `README.md` (except `## For contributors`), `examples/**/README.md`. Rules R1–R4 are tone; R5 forbids internal references to `spec/` outside the root README `## For contributors` section.
- Engine vs. federation split: see [ADR 0005](./spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md). Attribute new capabilities to either `cds-data-federation` (annotation layer) or `cds-data-pipeline` (engine); do not add federation-agnostic pipeline features under `@federation.*`.

## MCP servers

[`.mcp.json`](./.mcp.json) declares:

- `cap-mcp` — prefer this for CSN introspection over ad-hoc `node -e "..."` snippets.
- `fiori-mcp` — only relevant when working in `examples/consumer/app/`.
