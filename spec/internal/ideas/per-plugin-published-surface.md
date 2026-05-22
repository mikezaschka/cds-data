# Per-plugin published surface (READMEs + mkdocs)

**Status:** Promoted
**Created:** 2026-04-19
**Promoted to:** [ADR 0006](../decisions/0006-per-plugin-published-surface.md) (2026-04-19) — Accepted
**Related:** [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md), [ADR 0003](../decisions/0003-split-plugin-into-replication-and-federation.md), [ADR 0005](../decisions/0005-reposition-engine-as-cds-data-pipeline.md), [`mkdocs.yml`](../../../mkdocs.yml), [`README.md`](../../../README.md), [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md), [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md), [`spec/internal/docs-style-guide.md`](../docs-style-guide.md), [`spec/internal/ideas/docs-internal-external-separation.md`](./docs-internal-external-separation.md)

## Trigger

Two observations, one structural fix:

1. **READMEs leak internal references.** The published READMEs link into [`spec/internal/**`](../), ADRs, [`spec/reference/requirements.md`](../../reference/requirements.md), and [`CLAUDE.md`](../../../CLAUDE.md) — 8+ links in [`README.md`](../../../README.md), 6+ in [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md), 2 in [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md). npm renders each package's README on its package page; every consumer lands one click from contributor-only material. [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md) handled tone (R1–R4); link targets were out of scope and the `packages/*/README.md` files post-date the ADR.
2. **One mkdocs site serves two independent npm packages.** [`mkdocs.yml`](../../../mkdocs.yml) line 1 (`site_name: cds-data-pipeline + cds-data-federation`) and line 3 (`site_url: https://.../cds-data-federation/`) treat the monorepo as a single product. Nav sections split by package (`Pipeline engine:` / `Federation plugin:`) but `Getting Started`, `Concepts`, `Reference` mix. A visitor from `npmjs.com/package/cds-data-pipeline` lands on a site whose URL names the other package and whose front page opens on federation annotations.

## Direction

Per the maintainer's decision (see user query collapsing the brainstorm):

- **Isolated READMEs.** Each package's `packages/<pkg>/README.md` is the canonical consumer surface for that package. Each README covers only its own domain. The repo-root [`README.md`](../../../README.md) becomes a thin monorepo hub — positioning, "which package do I need", link grid.
- **Isolated docs.** Each package gets `packages/<pkg>/docs/` with its own [`mkdocs.yml`](../../../mkdocs.yml). Each docs site covers only its own domain. The root `docs/` keeps only cross-cutting internal material ([`spec/internal/**`](../), [`spec/reference/requirements.md`](../../reference/requirements.md), [`spec/reference/test-mapping.md`](../../reference/test-mapping.md)).
- **Deliberate concept duplication is accepted.** `terminology`, `consumption-views`, `cross-service-scenarios`, `service-query-execution` appear in both packages' docs when relevant, at the scope and detail level each package needs. This is an explicit second exception to the [`CLAUDE.md`](../../../CLAUDE.md) §Conventions low-redundancy rule, on top of the existing internal↔external exception.

The structural shape:

```
/README.md                           # thin monorepo hub
/CLAUDE.md, /AGENTS.md               # unchanged — contributor entry points
/docs/
  /internal/**                       # stays — ADRs, research, ideas, plans, ai-assistant-context
  /reference/requirements.md         # stays — contributor feature tracker
  /reference/test-mapping.md         # stays — auto-generated
  (no external pages, no mkdocs.yml)
/packages/cds-data-pipeline/
  README.md                          # canonical consumer README for the engine
  mkdocs.yml                         # own site config
  docs/
    index.md
    getting-started/...
    concepts/terminology.md          # engine-scoped terminology
    reference/management-service.md
    reference/features.md            # engine-scoped features
    integration/odata.md
    integration/rest.md
/packages/cds-data-federation/
  README.md                          # canonical consumer README for the annotation plugin
  mkdocs.yml                         # own site config
  docs/
    index.md
    getting-started/first-delegation.md
    getting-started/first-replication.md
    getting-started/first-cache.md
    concepts/terminology.md          # federation-scoped terminology (pruned + extended)
    concepts/consumption-views.md
    concepts/cross-service-scenarios.md
    reference/annotations.md
    reference/comparison.md
    reference/features.md            # federation-scoped features
    integration/caching.md
```

## Non-goals

- **Not reopening [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md).** Tone rules stay. Internal analysis stays at `spec/internal/**`.
- **Not moving `spec/internal/**` or `spec/reference/requirements.md`.** Those paths are encoded in [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), [`.claude/commands/*`](../../../.claude/commands/), and [`.cursor/rules/project.mdc`](../../../.cursor/rules/project.mdc); the ADR-0002 rejection of Option A still stands for that tree.
- **Not splitting the monorepo.** One repo, two packages, two docs sites — same repo.
- **Not changing public API.** `@federation.*` and `addPipeline(...)` signatures unchanged.
- **Not touching [`examples/`](../../../examples/)** (ADR 0002 already flagged future extraction; out of scope here).

## Open implementation questions (for `/discuss-architecture`)

1. **GitHub Pages hosting for two sites from one repo.** GitHub Pages serves one site per repo. Concrete options:
   - **(a) Subpath deploys** via `peaceiris/actions-gh-pages` with `destination_dir: cds-data-pipeline/` and `destination_dir: cds-data-federation/` — yields `https://<owner>.github.io/<repo>/cds-data-pipeline/` and `.../cds-data-federation/`. Nested URL but single repo, single Pages config.
   - **(b) Two dedicated publish repos** (`mikezaschka/cds-data-pipeline-docs` + `mikezaschka/cds-data-federation-docs`) pushed from CI — clean per-package URLs at the cost of two extra repos to own.
   - **(c) Single-repo rename** so the repo hosts the engine site at root and the federation site at a subpath (or vice versa). Privileges one package; matches current `site_url` bias.
   - Recommended starting point: (a). Cheapest, reversible. Revisit only if per-package apex URLs become necessary.
2. **`spec/concepts/**` — keep shared copy at root or delete after duplication?** Two sub-options: (i) copy once, then delete the root `spec/concepts/**` — each package owns its copy, drift is accepted; (ii) keep `spec/concepts/**` at root as the contributor-facing source of truth, duplicate selectively per package with explicit scope notes. Option (i) is simpler but loses a shared reference for ADRs that link into `spec/concepts/*`. Option (ii) keeps the link target but adds a third copy of each concept. Pick (i) unless a concrete ADR link breaks.
3. **`reference/features.md` per package.** [ADR 0002 §2](../decisions/0002-separate-internal-and-published-docs.md) created a single [`docs/reference/features.md`](../../reference/features.md). Under this direction it splits into `docs/pipeline/reference/features.md` and `docs/federation/reference/features.md`. The contributor tracker at [`spec/reference/requirements.md`](../../reference/requirements.md) stays unified — requirements are the cross-cutting concern; `features.md` is the per-package consumer excerpt. [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5 update-target list picks up one or both `features.md` depending on where the implemented row belongs.
4. **Thin root `README.md` shape.** ~40 lines. Positioning paragraph, "which package do I need" 2-row table, link grid into the two package READMEs and their respective sites, pointer to `examples/`, `## For contributors` section at the bottom linking to `CLAUDE.md` / `AGENTS.md` / `spec/internal/` (only place internal links live on any README).
5. **Style guide update.** [`docs-style-guide.md`](../docs-style-guide.md) §Scope currently lists `docs/`, `README.md`, `examples/**/README.md`. Must extend to cover `packages/*/README.md` and `docs/pipeline/** and docs/federation/**`. Add **R5 — no internal references on published READMEs or sites** (targets: `spec/internal/`, `ADR NNNN` inline citations, `CLAUDE.md`, `AGENTS.md`, `spec/reference/requirements.md`, `spec/reference/test-mapping.md`), with a grep-lint paralleling the existing R4 check.
6. **Cross-package linking policy.** `packages/cds-data-federation/README.md` and `packages/cds-data-pipeline/README.md` currently cross-link via relative paths. Those work on GitHub but break on npm (npm doesn't resolve `../cds-data-pipeline/README.md`). Fix: absolute npm URLs (`https://www.npmjs.com/package/cds-data-pipeline`) for consumer-facing references, GitHub absolute URLs for deeper pointers.
7. **CI shape.** [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) currently runs one `mkdocs build --strict`. Becomes a matrix over `[cds-data-pipeline, cds-data-federation]` with per-package `mkdocs.yml`. Strict mode stays on both. Deploy step per matrix entry writes to its own `destination_dir`.
8. **`package.json` docs scripts.** Current `docs:serve` / `docs:build` become per-package (`npm run docs:serve -w packages/cds-data-pipeline`) plus convenience `docs:serve:pipeline` / `docs:serve:federation` aliases at the root. The shared `.venv/` and `docs-requirements.txt` stay at the repo root.
9. **`edit_uri` per site.** Each `mkdocs.yml` sets `edit_uri: edit/main/packages/<pkg>/docs/` so the "Edit on GitHub" button lands on the right file.
10. **Sequencing.** A landable sequence that keeps `main` green throughout:
    1. Add R5 to [`docs-style-guide.md`](../docs-style-guide.md); scrub internal refs from existing READMEs (non-structural; fixes the worst leak before the restructure).
    2. Create `docs/pipeline/` and `docs/federation/` by `git mv`-ing the relevant subtrees out of `docs/`.
    3. Create per-package `mkdocs.yml` files, retire root `mkdocs.yml`.
    4. Update `.github/workflows/docs.yml` matrix + deploy.
    5. Thin the root `README.md`; consolidate full consumer content into each `packages/*/README.md`.
    6. Update [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md), [`.claude/commands/review.md`](../../../.claude/commands/review.md) Phase 2 R5 grep, and [`docs-style-guide.md`](../docs-style-guide.md) §Scope.

## Next step

Run `/discuss-architecture` on this idea. The ADR resolves the numbered questions above, captures the folder layout as decision, updates the style-guide scope rule, and supersedes the root `mkdocs.yml` block from [ADR 0002 §1](../decisions/0002-separate-internal-and-published-docs.md) (`exclude_docs:` on `spec/internal/` + `spec/reference/requirements.md` + `spec/reference/test-mapping.md` is no longer needed once those are the *only* things under root `docs/`).
