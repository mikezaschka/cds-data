# cds-data-pipeline monorepo — AI Assistant Context

Primer for AI assistants (Cursor, Claude Code, Codex, Copilot, Aider, ...) working on this repo. Read this first. Detailed architecture, lifecycle, test layout, and CAP quirks live in the linked documents below — this file only covers the load-bearing mental model and the conventions you must follow.

---

## What this project is

This repository is an npm workspaces monorepo hosting three composable SAP CAP packages per [ADR 0005](./spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md) and [ADR 0009](./spec/internal/decisions/0009-cds-data-materialization-plugin.md) (which supersedes ADR 0003 and amends ADR 0001):

- **`cds-data-pipeline`** (`packages/cds-data-pipeline/`) — the engine. A scheduled, traceable, declarative `READ → MAP → WRITE` primitive between exactly one source and one target, with built-in tracker, retry, concurrency guard, management OData API, and event hooks. Pipeline intent (`replicate` / `materialize` / `move`) is **derived** by the engine from the configuration shape (see [ADR 0007](./spec/internal/decisions/0007-infer-pipeline-intent-from-config-shape.md) and [`docs/pipeline/guide/concepts/inference.md`](./docs/pipeline/guide/concepts/inference.md)) — consumers do **not** pass `kind` to `addPipeline`. Entity-shape and query-shape pipelines are executable against db targets. Used programmatically via `cds.connect.to('DataPipelineService').addPipeline({ name, source, target, ... })`, or via annotation plugins.

- **`cds-data-federation`** (`packages/cds-data-federation/`) — the annotation layer for remote-service integration. Declarative via CDS annotations on consumption views:

 | Annotation | Behavior |
 |---|---|
 | `@federation.delegate` | Transparent live proxy. Reads forwarded to remote. Writes (CUD) opt-in via annotation flags; read-only by default. |
 | `@federation.replicate` | Scheduled sync: copies remote data into the local database for offline access, analytics, full SQL. Composed on top of `cds-data-pipeline` via `packages/cds-data-federation/srv/pipeline-binding.js`. |

 Optional response caching on either strategy via [`cds-caching`](https://github.com/mikezaschka/cds-caching) (peer dependency). Declares `cds-data-pipeline` as a peer dependency — `@federation.replicate` fails loudly at startup if the engine is not installed.

- **`cds-data-materialization`** (`packages/cds-data-materialization/`) — the annotation layer for local aggregate snapshots. `@materialize.snapshot` on `group by` projections composes query-shape `cds-data-pipeline` jobs via `packages/cds-data-materialization/srv/pipeline-binding.js`. Peer-dep `cds-data-pipeline`.

The `@federation.*` annotation surface and the `replicated` aspect (on the federation side) are stable; ADR 0005 renamed the engine internals (class names, event namespace `PIPELINE.*`, entity names `Pipelines` / `PipelineRuns`, management path `/pipeline`) but did not change user-facing annotations. The git folder is still named `cds-data-replication` for historical reasons; the npm packages and CDS namespaces are `cds-data-pipeline` / `plugin.data_pipeline` (engine), `cds-data-federation` / `plugin.data_federation` (federation), and `cds-data-materialization` / `plugin.data_materialization` (materialization).

---

## Terminology

"Federation" here uses the **broader industry meaning** — "make multiple data sources appear as one" — not CAP's narrower usage where "data federation" is a sibling of "delegation". The plugin collapses delegation + federation + cache into one annotation namespace because, from the developer's perspective, the intent is the same: "I need this remote entity's data available in my application." The strategy is a runtime choice.

For the full alignment table with CAP's [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi), the `'Calesi'` abbreviation, and the directional scenario names used throughout this repo, see [`spec/concepts/terminology.md`](./spec/concepts/terminology.md) and [`spec/concepts/cross-service-scenarios.md`](./spec/concepts/cross-service-scenarios.md).

**Canonical scenario names** (replace the old `Scenario A/B/C/N1/N2` labels in new prose):

| Canonical name | Short test ID |
|---|---|
| Delegated expand | `A1..A7` |
| Cross-service expand: local → remote | `B1..B3`, `B7..B14` |
| Cross-service expand: cross-provider | `B4..B6` |
| Cross-service expand: remote → local | `C1..C4` |
| Cross-service navigation: local → remote | `N1`, `N3`, `N5` |
| Cross-service navigation: remote → local | `N2`, `N4` |

Short IDs are still valid as test identifiers and `requirements.md` cross-references. Descriptive prose uses the canonical names.

---

## Core principle: the consumption view IS the federation contract

The CDS projection declares **schema** (what fields, what shape, what renames). The `@federation.*` annotation declares **runtime behavior** (delegate vs. replicate, optional cache, optional CUD opt-in). This is the single principle everything else follows from.

```cds
using { ProviderService as remote } from '../srv/external/ProviderService';

// Column restriction + field renames.
// Remote: ID, name, category, price, currency, stock, modifiedAt (7 fields)
// Local:  productId, productName, category, unitPrice, currency   (5 fields)
@federation.delegate
entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    category,
    price as unitPrice,
    currency
    // remote fields `stock`, `modifiedAt` are NOT projected → never fetched
};
```

From this projection the plugin infers:

- **Source service / entity** from `projection on remote.X`.
- **Projected columns** for `$select` restriction (bandwidth).
- **Bidirectional rename mapping** (`localToRemote` / `remoteToLocal`) from `as` clauses.
- **Strategy** from the annotation name.

A delegate query against `Products` with `$filter=unitPrice gt 100` is translated by CAP to `$filter=price gt 100` on the remote, and the response's `price` fields are mapped back to `unitPrice`. Further consumption-view patterns (wildcard, entity-level rename, `excluding`, static `where`) are covered in [`spec/concepts/consumption-views.md`](./spec/concepts/consumption-views.md) (public: [`docs/federation/concepts/consumption-views.md`](./docs/federation/concepts/consumption-views.md)).

---

## Where to find things

This file is deliberately short. Everything else is cross-referenced, not repeated:

| You want | Go to |
|---|---|
| **Public docs** (VitePress) | [`docs/`](./docs/) — `npm run docs:serve` |
| Pipeline user guide | [`docs/pipeline/`](./docs/pipeline/) |
| Federation user guide | [`docs/federation/`](./docs/federation/) |
| Materialization user guide | [`docs/materialization/`](./docs/materialization/) |
| Deep architecture (module tree, lifecycle, CAP native vs. plugin) | [`spec/internal/ai-assistant-context.md`](./spec/internal/ai-assistant-context.md) |
| Feature matrix, status, priority | [`spec/reference/requirements.md`](./spec/reference/requirements.md) |
| Test ↔ requirement mapping (auto-generated) | [`spec/reference/test-mapping.md`](./spec/reference/test-mapping.md) |
| Cross-service `$expand` + navigation scenarios | [`spec/concepts/cross-service-scenarios.md`](./spec/concepts/cross-service-scenarios.md) |
| How queries route through services vs. DB | [`spec/concepts/service-query-execution.md`](./spec/concepts/service-query-execution.md) |
| Annotation reference (published) | [`docs/federation/reference/annotations.md`](./docs/federation/reference/annotations.md) |
| CAP vs. plugin comparison (published) | [`docs/federation/reference/comparison.md`](./docs/federation/reference/comparison.md) |
| Internal research, ADRs, plans | [`spec/internal/`](./spec/internal/) |
| Example apps (movies launchpad) | [`examples/`](./examples/) — see ai-assistant-context §Example apps |
| Workflows (all tool-agnostic) | [`AGENTS.md`](./AGENTS.md) + [`.claude/commands/`](./.claude/commands/) |

---

## Working with this project from another tool (Cursor, etc.)

Every AI tool that operates on this repo picks up the same entry point on session start:

- **Cursor** auto-loads [`.cursor/rules/project.mdc`](./.cursor/rules/project.mdc) (`alwaysApply: true`).
- **Claude Code**, **Codex CLI**, **Copilot**, **Aider** and other agents read [`AGENTS.md`](./AGENTS.md) (the cross-tool standard at [agentsmd.org](https://agentsmd.org)).

Both files are thin pointers — they link here. You do not need to tell the AI to "read `CLAUDE.md` first"; it is already in the loading order.

For workflows (implement a feature, fix a bug, brainstorm, decide architecture, review a diff, deprecate, sync requirements), see [`AGENTS.md`](./AGENTS.md) §Workflows, which maps each intent to the corresponding file in [`.claude/commands/`](./.claude/commands/).

---

## MCP servers

[`.mcp.json`](./.mcp.json) declares two Model Context Protocol servers. Prefer them over ad-hoc introspection:

- **`cap-mcp`** (via `@cap-js/mcp-server`) — CSN introspection at runtime: list services, entities, definitions, annotations. Use instead of ad-hoc `cds.test('packages/cds-data-federation/test/fixtures/consumer')` snippets when you need to inspect the compiled model. Claude Code picks it up automatically; in Cursor it is listed under **MCP servers**.
- **`fiori-mcp`** — only relevant when working in [`examples/consumer/app/`](./examples/consumer/app/) (Fiori Elements apps). Safe to ignore outside of UI work.

[.claude/commands/fix-bug.md](./.claude/commands/fix-bug.md) Phase 2 calls `cap-mcp` first and falls back to the `node -e` snippet only when the MCP server is unreachable.

---

## Conventions

Each convention below is a short pointer. Full rationale and examples live in [`spec/internal/ai-assistant-context.md`](./spec/internal/ai-assistant-context.md) §Conventions and the per-topic concept docs.

- **Annotation naming** — `@federation.delegate` / `@federation.replicate`. Never `@cds.federated` (reserved for SAP). Cache is an option on either annotation, not a third strategy.
- **CUD opt-in** — read-only by default. Enable writes with `writable: true` (all) or individual `create` / `update` / `delete` flags. The scanner enforces `@readonly` on entities without write flags; see [`docs/federation/reference/annotations.md`](./docs/federation/reference/annotations.md) for precedence.
- **Annotations only on consumption views** — `@federation.*` requires an `entity X as projection on remote.Y` projection. No projection → no inferred source / columns / renames. The one escape hatch is explicit `options.source` for REST targets without a CDS model.
- **CQN safety** — never mutate `req.query`. `cds.ql.clone(query)` before any modification. The delegate handler passes `req.query` unchanged into `remote.run()`.
- **Pipeline events** — `PIPELINE.READ`, `PIPELINE.MAP`, `PIPELINE.WRITE` — namespaced to avoid collision with CAP's CRUD aliases. Register hooks via `srv.before/on/after(event, pipelineName, handler)` on `DataPipelineService`.
- **Idempotency** — entity-shape writes use `UPSERT.into(entity).entries(records)`. Never SELECT-then-INSERT/UPDATE. Query-shape (snapshot) writes use `INSERT` after a tracker-guarded flush.
- **Retry** — all remote I/O in the engine goes through `withRetry(...)` from [`packages/cds-data-pipeline/srv/lib/retry.js`](./packages/cds-data-pipeline/srv/lib/retry.js). Default `retryOn` is "skip 4xx, retry everything else"; don't retry auth failures or bad requests.
- **Concurrency** — pipeline runs use optimistic locking via UPDATE on the `plugin_data_pipeline_Pipelines` tracker table. If `affectedRows === 0`, another run is in progress; return early.
- **Logging** — engine code uses `cds.log('cds-data-pipeline')`; federation code uses `cds.log('cds-data-federation')`. No `console.log`. `LOG.debug` for details, `LOG.info` for one-time summaries, `LOG.warn` for recoverable unexpected states, `LOG.error` for failures.
- **Tests** — run against the real CAP providers in each package's `test/support/setup.js` ([`packages/cds-data-pipeline/test/`](./packages/cds-data-pipeline/test/), [`packages/cds-data-federation/test/`](./packages/cds-data-federation/test/)), never mocks. OData translation has subtleties (V2 timestamp format, `@odata.count`, …) that mocks miss.
- **Test naming** — tests that map 1:1 to a requirement carry `it('[<id>] <shortId> [<scenario>]: ...')` prefixes. See [`spec/reference/test-mapping.md`](./spec/reference/test-mapping.md) (auto-generated).
- **Docs: low redundancy** — a given fact lives in exactly one place; other surfaces cross-reference. Public docs: `docs/pipeline/`, `docs/federation/`, `docs/materialization/`. Contributor canonical concepts: `spec/concepts/`. Internal engineering: `spec/internal/`. See [ADR 0006](./spec/internal/decisions/0006-per-plugin-published-surface.md).

---

## What NOT to do

- **Don't reintroduce `@cds.federated`** — reserved for future SAP use.
- **Don't add a "cache" strategy** — caching is an option on `delegate` or `replicate`, not a peer.
- **Don't bypass `withRetry`** in adapter calls.
- **Don't mutate `req.query`** — always clone.
- **Don't write tests that mock the provider service** — use the real providers from the relevant package's `test/support/setup.js`.
- **Don't unskip multiple tests at once** — one test → fail → implement → pass → next.
- **Don't `console.log`** — use `cds.log('cds-data-pipeline')` in engine code or `cds.log('cds-data-federation')` in federation code.
- **Don't `cds.outboxed()` CUD forwarding** — CUD is synchronous. The outbox breaks OData's request/response contract. It belongs in fire-and-forget scenarios (domain event notification, cache invalidation, background sync).
- **Don't make federated entities writable by default** — explicit opt-in via `writable` / `create` / `update` / `delete`. Matches SAP's [xtravels](https://github.com/capire/xtravels) reference pattern.
- **Don't let `README.md` drift from `spec/reference/requirements.md`** — user-visible features must land in the README feature matrix / annotation reference.
- **Don't let the documentation site drift** — user-visible features must also land in [`docs/`](./docs/) (annotation reference, integration guide, or concept doc).
- **Don't let `examples/` drift** — user-visible capabilities must also land in [`examples/consumer/`](./examples/consumer/). The launchpad is the interactive showcase. The maintenance checklist lives in [`.claude/commands/implement-feature.md`](./.claude/commands/implement-feature.md) Phase 5 and is enforced during review.
- **Don't introduce `Scenario A/B/C` or `N1/N2` in new prose** — use the directional names from [`spec/concepts/cross-service-scenarios.md`](./spec/concepts/cross-service-scenarios.md). Short IDs remain as auxiliary test identifiers.
- **Don't use the title-cased `CaLeSi`** — the canonical spelling is `'Calesi'` and its only definition lives in [`spec/concepts/terminology.md`](./spec/concepts/terminology.md).

---

## Useful prompts

- *"Look at how delegate handlers work and add support for [feature]."*
- *"Test `[<id>] ...` is skipped. Read it, implement the minimal change to make it pass without regressing others."*
- *"There's a bug in [file]. Reproduce it with a test first, then fix it."*
- *"Update `spec/reference/requirements.md` to mark [feature] as Implemented and run `npm run sync:requirements`."*
