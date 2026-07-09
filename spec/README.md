# spec/

Contributor and engineering specification — **not** published on the documentation site.

| Path | Purpose |
|------|---------|
| [`concepts/`](concepts/) | Canonical deep-dive concept pages (source for pruning into public docs). |
| [`internal/`](internal/) | ADRs (0001–0014), plans, research, ideas, AI-assistant context, docs style guide, product vision, releasing. |
| [`reference/`](reference/) | Feature requirements matrix (`requirements.md`) and generated test mapping. |

Public documentation lives in [`../docs/`](../docs/) (VitePress). Build with `npm run docs:serve` or `npm run docs:build` from the monorepo root.

## For contributors

Internal references, primers, and the feature tracker live here — not in the root README or package READMEs.

- [`reference/requirements.md`](reference/requirements.md) — full feature matrix with status, priority, and architecture rationale.
- [`reference/test-mapping.md`](reference/test-mapping.md) — auto-generated test ↔ requirement ID mapping (`npm run sync:requirements`).
- Tests live under `packages/cds-data-pipeline/test/`, `packages/cds-data-federation/test/`, and `packages/cds-data-materialization/test/` (root `npm test` runs all three).
- [`../CLAUDE.md`](../CLAUDE.md) — project primer, terminology, conventions, and the "don'ts" list.
- [`../AGENTS.md`](../AGENTS.md) — cross-tool entry point for AI coding assistants (Cursor, Claude Code, Codex, …).
- [`internal/decisions/`](internal/decisions/) — architecture decision records (0001–0014).
- [`internal/plans/`](internal/plans/) — implementation plans (active and completed).
- [`internal/research/`](internal/research/) — technical analysis and spike notes.
- [`internal/ideas/`](internal/ideas/) — pre-decision brainstorms.
- [`internal/vision.md`](internal/vision.md) — product vision for `cds-data-pipeline`.
- [`internal/releasing.md`](internal/releasing.md) — how to publish packages to npm.
