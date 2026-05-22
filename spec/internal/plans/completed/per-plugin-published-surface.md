# Plan: per-plugin published surface (ADR 0006)

**ADR:** [0006-per-plugin-published-surface](../decisions/0006-per-plugin-published-surface.md)
**Requirement ID:** none — docs/infra change, not a row in [`spec/reference/requirements.md`](../../reference/requirements.md). ADR 0006 §Follow-up explicitly records *"No new requirement rows, no existing requirement status changes"*.
**Priority:** n/a
**Status:** Not started
**Created:** 2026-04-19
**Status source:** this plan doc

## Overview

Operationalize [ADR 0006](../decisions/0006-per-plugin-published-surface.md). Six concrete outcomes, sequenced so `main` stays deployable between commits:

1. **Rules first.** Add R5 (no internal references on published surfaces) + extend §Scope to cover `packages/*/README.md` and `docs/pipeline/** and docs/federation/**`. Update [`.claude/commands/review.md`](../../../.claude/commands/review.md) Phase 1 categories + Phase 2 Req-10, and [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.2 (`features.md` picker).
2. **Scrub the leaks** from existing READMEs — 19 R5-grep hits to resolve (root `README.md`: 8; `packages/cds-data-pipeline/README.md`: 8; `packages/cds-data-federation/README.md`: 2; `examples/README.md`: 1). No content rewrite yet.
3. **Create `docs/pipeline/`** by `git mv`-ing engine-scope pages + per-package `mkdocs.yml` + engine-scope `features.md`.
4. **Create `docs/federation/`** symmetrically.
5. **Retire root [`mkdocs.yml`](../../../mkdocs.yml); switch CI** to matrix-over-packages + `peaceiris/actions-gh-pages` subpath deploys. Duplicate `spec/concepts/**` per-package with scope pruning. Amend [`CLAUDE.md`](../../../CLAUDE.md) / [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md) / [ADR 0003](../decisions/0003-split-plugin-into-replication-and-federation.md) per ADR 0006 §Consequences.
6. **Thin the root [`README.md`](../../../README.md)** to ~40 lines; consolidate consumer content into the two package READMEs.

### Scope discipline (from ADR 0006)

- No changes under [`spec/internal/**`](../) other than the amendment notes on [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md) / [ADR 0003](../decisions/0003-split-plugin-into-replication-and-federation.md) and an optional one-liner header on the `spec/concepts/` pages.
- No changes to [`spec/reference/requirements.md`](../../reference/requirements.md) or [`spec/reference/test-mapping.md`](../../reference/test-mapping.md).
- No code changes under `packages/*/srv/` or `test/`. No Jest tests involved.
- Repo rename is explicitly out of scope per ADR 0006 §"What this decision does not do".

### Approval gates (per user instruction)

- **Commits 1, 2, 6** — pure additions/edits, proceed after Phase 2 plan approval.
- **Commits 3, 4** — involve `git mv` and carving `features.md`. Show the proposed file list to the user before execution.
- **Commit 5** — single-commit CI transition. Requires explicit "go" before execution because it deletes [`mkdocs.yml`](../../../mkdocs.yml), rewrites [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml), and requires a one-time manual repo `Settings → Pages → Source` flip as a **pre-merge** step.

## Affected files

| File | Change | Commit |
|---|---|---|
| [`spec/internal/docs-style-guide.md`](../docs-style-guide.md) | Extend §Scope to cover `packages/*/README.md` + `docs/pipeline/** and docs/federation/**`, exclude `spec/concepts/` + the two trackers from the in-scope set. Add new R5 section + cross-package linking rule bullet. | 1 |
| [`.claude/commands/review.md`](../../../.claude/commands/review.md) | Phase 1 category list gains `packages/*/README.md` + `docs/pipeline/** and docs/federation/**`. Phase 2 Req-10 §Scope paragraph extended; second grep block added for R5. | 1 |
| [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) | Phase 5.2 `features.md` update target becomes a picker over `docs/pipeline/reference/features.md` and `docs/federation/reference/features.md`. | 1 |
| [`AGENTS.md`](../../../AGENTS.md) | One-line R5 pointer added alongside the existing R1–R4 pointer in §Conventions. | 1 |
| [`README.md`](../../../README.md) | Scrub 8 R5-grep hits: lines 7, 10, 105, 376, 436, 437, 439, 440. Line 10 ADR 0003 link is already broken (`0003-split-into-data-replication-and-data-federation.md` vs. actual `0003-split-plugin-into-replication-and-federation.md`) — fix or drop. No content rewrite. | 2 |
| [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md) | Scrub 8 R5-grep hits: lines 7, 19, 37, 68, 108, 119, 120, 121. Rewrite as capability-first sentences without the ADR citations. | 2 |
| [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md) | Scrub 2 R5-grep hits: lines 73–74. Replace `## Related` ADR list with an npm-URL pointer to the sibling package. | 2 |
| [`examples/README.md`](../../../examples/README.md) | Scrub 1 R5-grep hit: line 133 (`CLAUDE.md` reference). | 2 |
| `packages/cds-data-pipeline/mkdocs.yml` | **New.** Per ADR 0006 §10 — `docs_dir: docs`, `site_url: .../cds-data-pipeline/`, `edit_uri: edit/main/docs/pipeline/`, theme/markdown/plugins mirroring current root. | 3 |
| `docs/pipeline/index.md` | **New.** Engine-scoped landing page (positioning, `addPipeline({kind,...})` snippet, link to `reference/management-service.md`). | 3 |
| `docs/pipeline/reference/management-service.md` | **`git mv`** from [`docs/reference/management-service.md`](../../reference/management-service.md). | 3 |
| `docs/pipeline/integration/odata.md` | **`git mv`** from [`docs/integration/odata.md`](../../integration/odata.md). | 3 |
| `docs/pipeline/integration/rest.md` | **`git mv`** from [`docs/integration/rest.md`](../../integration/rest.md). | 3 |
| `docs/pipeline/reference/features.md` | **New.** Engine rows carved from [`docs/reference/features.md`](../../reference/features.md): Source adapters, Management service, Observability, Scheduling and triggers, Configuration (programmatic subset), Resilience (retry + concurrency), Security. | 3 |
| [`mkdocs.yml`](../../../mkdocs.yml) (root) | Drop the moved pages from `nav:` — `Pipeline engine (cds-data-pipeline):` section becomes empty and is removed. Root site still builds strict. | 3 |
| `packages/cds-data-federation/mkdocs.yml` | **New.** Symmetric to pipeline. | 4 |
| `docs/federation/index.md` | **New.** Federation-scoped landing page (consumption-view annotation snippet, link to annotation reference). | 4 |
| `docs/federation/reference/annotations.md` | **`git mv`** from [`docs/reference/annotations.md`](../../reference/annotations.md). | 4 |
| `docs/federation/reference/comparison.md` | **`git mv`** from [`docs/reference/comparison.md`](../../reference/comparison.md). | 4 |
| `docs/federation/integration/caching.md` | **`git mv`** from [`docs/integration/caching.md`](../../integration/caching.md). | 4 |
| `docs/federation/getting-started/*.md` | **`git mv`** all 11 files from [`docs/getting-started/`](../../getting-started/) (all federation-first per Phase 1 survey). | 4 |
| `docs/federation/reference/features.md` | **New.** Federation rows carved from [`docs/reference/features.md`](../../reference/features.md): Consumption views, Delegate strategy, Replicate strategy (federation POV), Caching, Cross-service scenarios, Configuration (annotation subset). | 4 |
| [`mkdocs.yml`](../../../mkdocs.yml) (root) | Drop the moved federation entries. At end of Commit 4, root site points at only `index.md` + `concepts/**` + the carcass of `reference/features.md`. Still builds strict. | 4 |
| [`docs/reference/features.md`](../../reference/features.md) | Delete (superseded by the two per-package `features.md`). | 5 |
| [`docs/index.md`](../../index.md) | Delete (superseded by the two per-package `docs/index.md`). | 5 |
| [`mkdocs.yml`](../../../mkdocs.yml) (root) | **Delete.** | 5 |
| `packages/cds-data-pipeline/spec/concepts/*.md` | **New.** Pipeline-scoped pruning of [`spec/concepts/terminology.md`](../../concepts/terminology.md) (+ any other concept that applies to the engine audience). Copy-with-edit, not mechanical copy. | 5 |
| `packages/cds-data-federation/spec/concepts/*.md` | **New.** Federation-scoped pruning of [`spec/concepts/terminology.md`](../../concepts/terminology.md), [`consumption-views.md`](../../concepts/consumption-views.md), [`cross-service-scenarios.md`](../../concepts/cross-service-scenarios.md), [`service-query-execution.md`](../../concepts/service-query-execution.md). | 5 |
| [`spec/concepts/`](../../concepts/) (all 5 files) | Add one-line header banner: *"> Contributor canonical source. Consumer-facing concept pages live under `packages/*/spec/concepts/`."* | 5 |
| [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) | Rewrite per ADR 0006 §8 — matrix over the two packages, `peaceiris/actions-gh-pages@v4` with `destination_dir: <pkg>` + `keep_files: true`, path filter updated. | 5 |
| [`package.json`](../../../package.json) | Docs scripts per ADR 0006 §9 — remove `docs:serve` + `docs:build`, add `docs:serve:pipeline` / `docs:serve:federation` / `docs:build:pipeline` / `docs:build:federation` / `docs:build` (aggregator). | 5 |
| `docs/_pages-landing/index.html` (or similar) | **New.** Minimal static landing page at the `gh-pages` root linking to the two subpaths. Workflow deploys it once (third deploy step, no `destination_dir`). | 5 |
| [`CLAUDE.md`](../../../CLAUDE.md) | §Conventions low-redundancy rule bullet gains one sentence on the second exception (per-package concept duplication). | 5 |
| [`spec/internal/decisions/0002-separate-internal-and-published-docs.md`](../decisions/0002-separate-internal-and-published-docs.md) | Header gets a supersession note: *"§1 superseded by [ADR 0006](./0006-per-plugin-published-surface.md); §2–§5 retained."* | 5 |
| [`spec/internal/decisions/0003-split-plugin-into-replication-and-federation.md`](../decisions/0003-split-plugin-into-replication-and-federation.md) | Header gets a one-line pointer: *"Docs surface split along the same package lines: see [ADR 0006](./0006-per-plugin-published-surface.md)."* | 5 |
| [`README.md`](../../../README.md) (root) | Rewrite per ADR 0006 §5 — ~40 lines, no code snippets, "Which package do I need?" table, Examples section, `## For contributors` as the only place internal links appear. | 6 |
| [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md) | Consolidate full consumer content — inline the engine-scope subset of the current root README's annotation and programmatic API sections (tracker, management service, event hooks, adapters, configuration, `kind` taxonomy). Self-contained for npm. | 6 |
| [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md) | Consolidate full consumer content — inline the federation-scope subset (full annotation reference, CUD options, cache options, `$expand` scenarios, CQL-on-OData limitations, feature matrix). Self-contained for npm. | 6 |
| [`spec/internal/plans/per-plugin-published-surface.md`](./per-plugin-published-surface.md) | This plan. Moves to [`completed/`](./completed/) at end of Phase 5. | 6 |

## Tasks

### Commit 1 — `docs: add R5 and per-package scope to external docs style guide`

#### Task 1.1 — Extend [`spec/internal/docs-style-guide.md`](../docs-style-guide.md) §Scope

- [ ] Rewrite §Scope bullet list: `docs/` (excluding `spec/internal/`, `spec/reference/requirements.md`, `spec/reference/test-mapping.md`, `spec/concepts/`); `packages/*/README.md`; `docs/pipeline/** and docs/federation/**/*.md`; repo `README.md` except its `## For contributors` section; `examples/**/README.md`.
- [ ] Add a paragraph after the bullet list noting that `spec/concepts/` is out of scope because it is the contributor canonical source of truth — link to [ADR 0006 §3](../decisions/0006-per-plugin-published-surface.md).

#### Task 1.2 — Add R5 rule and cross-package linking rule

- [ ] Add `### R5 — No internal references on published surfaces` after R4, listing the target set (`spec/internal/`, inline ADR citations matching `[ADR NNNN]` / `ADR 000N`, `CLAUDE.md`, `AGENTS.md`, `spec/reference/requirements.md`, `spec/reference/test-mapping.md`). State the single exception (`## For contributors` section of the root `README.md`).
- [ ] Provide the grep-lint command paralleling R4:
      ```bash
      grep -rnE 'spec/internal/|ADR 00[0-9]+|ADR-00[0-9]+|\[ADR [0-9]+\]|CLAUDE\.md|AGENTS\.md|reference/requirements\.md|reference/test-mapping\.md' \
        README.md packages/*/README.md packages/*/docs/ examples/**/README.md \
        --include='*.md' 2>/dev/null
      ```
- [ ] Add a `## Cross-package links` section after the R1–R5 rules with the absolute-URL policy: `https://www.npmjs.com/package/<pkg>` for consumer references; `https://github.com/mikezaschka/cds-data-federation/blob/main/packages/<pkg>/...` for deeper repo pointers. State why — npm doesn't resolve `../<other-pkg>/README.md`.

#### Task 1.3 — Extend [`.claude/commands/review.md`](../../../.claude/commands/review.md)

- [ ] Phase 1 category list (lines 13–20): add `packages/*/README.md` to the "entry points" category and a new bullet `docs/pipeline/** and docs/federation/**` under its own category (parallel to `spec/concepts/**`).
- [ ] Phase 2 Req-10 §Scope paragraph (line 82): extend the "published scope" enumeration to match the style guide §Scope.
- [ ] After the existing R4 grep block (lines 88–92), add an R5 grep block using the command from Task 1.2.
- [ ] Add a note that R5 hits outside `## For contributors` are FAIL; hits inside that section are PASS.

#### Task 1.4 — Extend [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.2

- [ ] Rewrite Phase 5.2 target file from the single `docs/reference/features.md` to a picker: *"If the feature is consumer-visible, update `docs/pipeline/reference/features.md` for engine-scope features (adapter, management action, event hook, pipeline taxonomy) and/or `docs/federation/reference/features.md` for annotation-scope features (annotation option, query capability, cross-service scenario, cache option, protocol)."*
- [ ] Note: a feature that crosses the binding seam touches both.

#### Task 1.5 — [`AGENTS.md`](../../../AGENTS.md) §Conventions

- [ ] Add a one-line bullet after the existing `External docs tone` line: *"R5 — no internal references on published surfaces; see [`spec/internal/docs-style-guide.md`](./spec/internal/docs-style-guide.md) §R5."*

#### Task 1.6 — Verify Commit 1

- [ ] R4 grep returns empty (existing invariant, must stay clean).
- [ ] R5 grep over the whole repo still returns the 19 pre-existing hits — Commit 1 adds the rule but doesn't clean the leaks. Confirm count matches expectation.
- [ ] `npm run docs:build` still passes strict (root mkdocs.yml unchanged).
- [ ] `npm run lint` passes.
- [ ] Commit with message `docs: add R5 and per-package scope to external docs style guide` + body: one sentence + `Part of ADR 0006.`

---

### Commit 2 — `docs: scrub internal references from published READMEs`

#### Task 2.1 — Scrub [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md)

- [ ] Line 7 `See [ADR 0005]...` → delete the whole paragraph or replace with a capability-first sentence that doesn't cite the ADR.
- [ ] Line 19 `Per [ADR 0005]:` → delete the "What this isn't" section's ADR lead-in; keep the five bullets as free-standing negative-scope statements.
- [ ] Line 37 `omitting it throws a descriptive error pointing at ADR 0005` → rephrase: "omitting it throws a descriptive error explaining the required values."
- [ ] Line 68 `// kind is required (ADR 0005)` → `// kind is required`.
- [ ] Line 108 `Before ADR 0005, the engine lived inline inside cds-data-federation` → rewrite §"Upgrade from `cds-data-federation` pre-split" without the ADR citation: *"In earlier pre-split releases the engine was bundled inside `cds-data-federation` and persisted `Federations` / `ReplicationRuns` tables. After the split..."*. The migration steps themselves stay.
- [ ] Lines 119–121 `## Related` — delete the three ADR bullets; replace with a single npm-URL cross-link to [`cds-data-federation`](https://www.npmjs.com/package/cds-data-federation).

#### Task 2.2 — Scrub [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md)

- [ ] Lines 73–74 `## Related` — delete the two ADR bullets; replace with a single npm-URL cross-link to [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline). Keep the existing `cds-caching` link.

#### Task 2.3 — Scrub [`examples/README.md`](../../../examples/README.md)

- [ ] Line 133 `see CLAUDE.md → "Example apps"` → remove the parenthetical; the sentence stands on its own without the reference.

#### Task 2.4 — Scrub [`README.md`](../../../README.md) (root, structural scrub only — no thinning yet)

- [ ] Line 7 inline citation `([ADR 0005](...))` → drop; the sentence about `kind` placeholders stands on its own.
- [ ] Line 10 paragraph "See [ADR 0005] for the positioning, and [ADR 0003]..." → delete the whole paragraph. (The broken `0003-split-into-data-replication-and-data-federation.md` path is a bug anyway; deletion fixes it.)
- [ ] Line 105 `See UPGRADE.md for the migration script...` → the `UPGRADE.md` reference stays (it's a root-level consumer-facing file). The `pre-ADR-0005 Federations / ReplicationRuns` phrase → `pre-split Federations / ReplicationRuns`.
- [ ] Line 376 `// Define a pipeline programmatically. kind is required (ADR 0005).` → `// Define a pipeline programmatically. kind is required.`
- [ ] Lines 434–446 `## Links` — leave this section in place for now; it's the de-facto "For contributors" section. Move it under a new heading `## For contributors` as part of Commit 2 so that R5 has a legal home for the remaining `spec/reference/requirements.md`, `CLAUDE.md`, `spec/internal/research/*` links. All four bullets remain. Line 441–446 bullets (non-internal links: cds-caching, CAP guides, `spec/concepts/*`, `docs/reference/comparison.md`) stay as-is since `spec/concepts/` is out of R5 scope — but move them above the `## For contributors` heading into a fresh `## Links` section, so only contributor-scoped links are under `## For contributors`.
- [ ] No content rewrite of the 400+ lines of annotation reference / feature matrix / programmatic API — that's Commit 6.

#### Task 2.5 — Verify Commit 2

- [ ] R5 grep: all hits must now fall under `## For contributors` in root `README.md`. The `packages/*/README.md`, `examples/README.md` must have **zero** hits. Expected line pattern: `README.md:XXX:...` with XXX above the `## For contributors` header line should be empty.
- [ ] Manual spot-check: the scrubbed sentences still read naturally (no dangling "per the above" that referred to a deleted ADR citation).
- [ ] `npm run docs:build` strict still passes (root mkdocs.yml untouched; `README.md` is built by mkdocs via `edit_uri` only, not a nav entry — no impact).
- [ ] `npm run lint` passes.
- [ ] Commit with message `docs: scrub internal references from published READMEs` + body + `Part of ADR 0006.`

---

### Commit 3 — `docs(pipeline): create packages/cds-data-pipeline/docs + mkdocs` (APPROVAL GATE)

> **Stop and ask the user** before executing the `git mv` + file creation set below. Confirm the file list matches expectation.

#### Task 3.1 — Create `packages/cds-data-pipeline/mkdocs.yml`

- [ ] Per ADR 0006 §10. Fields: `site_name: cds-data-pipeline`, `site_description` ≈ "CAP application-layer data pipeline engine — scheduled READ→MAP→WRITE between services, with tracker, retry, management API, and event hooks.", `site_url: /pipeline/`, `repo_url` + `repo_name` (mirror root), `edit_uri: edit/main/docs/pipeline/`, `docs_dir: docs`.
- [ ] Copy `theme:` + `markdown_extensions:` + `plugins:` + `extra:` blocks from root [`mkdocs.yml`](../../../mkdocs.yml).
- [ ] `nav:` — Home (index.md), Concepts (placeholder — populated in Commit 5), Reference → Management Service + Features, Integration → OData + REST.
- [ ] **No `exclude_docs:`** — the per-package `docs/` tree contains only published material by construction.

#### Task 3.2 — `git mv` engine-scope pages

- [ ] `git mv docs/reference/management-service.md docs/pipeline/reference/management-service.md`.
- [ ] `git mv docs/integration/odata.md docs/pipeline/integration/odata.md`.
- [ ] `git mv docs/integration/rest.md docs/pipeline/integration/rest.md`.
- [ ] Fix all relative links in the moved files pointing back into root-`docs/` pages: update `../concepts/terminology.md` → the file moves with no concept change yet, so re-point to `../concepts/terminology.md` (pipeline-scoped concept created in Commit 5) and leave a short comment-marker if the concept doesn't exist yet. Alternative: leave as `../concepts/terminology.md` and let Commit 5 create the target; `mkdocs build --strict` will fail in between, so: defer the strict check in Task 3.5 to "builds after Commit 5 includes concepts". Prefer this deferral — do not invent placeholder pages.

#### Task 3.3 — Create `docs/pipeline/index.md`

- [ ] Engine-scoped landing page. ~60 lines. Content shape: one-paragraph positioning (copy from [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md) §"What this is", rephrased for site audience), `addPipeline({ kind, source, target, ... })` snippet, link to management service + features.
- [ ] `mkdocs-material` grid cards style (copy shape from current root [`docs/index.md`](../../index.md) lines 38–).

#### Task 3.4 — Create `docs/pipeline/reference/features.md`

- [ ] Carve from [`docs/reference/features.md`](../../reference/features.md): Source adapters (lines 64–74), Management service (98–108), Observability (110–118), Scheduling and triggers (120–125), Configuration (127–134) filtered to engine-only bullets, Resilience (89–96) minus the "CQN safety" row (which belongs to federation), Security (136–140).
- [ ] Rewrite frontmatter sentence to scope to the engine: *"What `cds-data-pipeline` does today, grouped by capability."*
- [ ] Keep the `## For contributors` footer (with absolute-GitHub URLs to [`spec/reference/requirements.md`](../../reference/requirements.md) and [`spec/reference/test-mapping.md`](../../reference/test-mapping.md)) — this is the permitted R5 exception.

#### Task 3.5 — Trim root [`mkdocs.yml`](../../../mkdocs.yml) `nav:`

- [ ] Remove the `Pipeline engine (cds-data-pipeline):` block (lines 68–71 — `Management Service`, `OData V2 / V4 adapter`, `REST adapter`).
- [ ] Confirm remaining root `nav:` is valid: Home / Getting Started / Concepts / Federation plugin / Reference → Features.

#### Task 3.6 — Verify Commit 3

- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml` — **expected to fail** on missing `concepts/*` nav targets (deferred to Commit 5). Record the failures in the commit message and proceed; Commit 5 resolves them. Alternative: include a single placeholder `packages/cds-data-pipeline/spec/concepts/index.md` with a "coming in Commit 5" note to keep strict mode clean per commit. **Recommend the placeholder** — it keeps the "`main` is deployable between commits" invariant intact. Task list updates accordingly.
- [ ] **Adjusted:** create `packages/cds-data-pipeline/spec/concepts/index.md` as a one-line stub *"Concept pages for engine consumers will populate in Commit 5 of ADR 0006."* Same for any other nav target that doesn't resolve yet.
- [ ] `.venv/bin/mkdocs build --strict -f mkdocs.yml` — root site still builds with the reduced nav.
- [ ] R4 + R5 greps: no regressions.
- [ ] `npm run lint` passes.
- [ ] Commit with message `docs(pipeline): create packages/cds-data-pipeline/docs + mkdocs` + body + `Part of ADR 0006.`

---

### Commit 4 — `docs(federation): create packages/cds-data-federation/docs + mkdocs` (APPROVAL GATE)

> **Stop and ask the user** before executing the `git mv` set — larger mover footprint than Commit 3.

#### Task 4.1 — Create `packages/cds-data-federation/mkdocs.yml`

- [ ] Mirror pipeline: `site_name: cds-data-federation`, `site_url: .../cds-data-federation/`, `edit_uri: edit/main/docs/federation/`. Same theme/markdown/plugins.

#### Task 4.2 — `git mv` federation-scope pages

- [ ] `git mv docs/reference/annotations.md docs/federation/reference/annotations.md`.
- [ ] `git mv docs/reference/comparison.md docs/federation/reference/comparison.md`.
- [ ] `git mv docs/integration/caching.md docs/federation/integration/caching.md`.
- [ ] `git mv docs/getting-started/*.md docs/federation/getting-started/` (all 11 files).

#### Task 4.3 — Create `docs/federation/index.md`

- [ ] Federation-scoped landing page. Copy shape from current root [`docs/index.md`](../../index.md); prune the "pipeline engine" framing from the opening headline.

#### Task 4.4 — Create `docs/federation/reference/features.md`

- [ ] Carve from [`docs/reference/features.md`](../../reference/features.md): Consumption views (5–15), Delegate strategy (17–34), Replicate strategy (36–49) reframed as "what `@federation.replicate` does", Caching (51–62), Cross-service scenarios (76–87), Configuration (127–134) filtered to annotation-only bullets, the "CQN safety" row from Resilience (line 96).

#### Task 4.5 — Create concept placeholder stubs (parallel to Task 3.6 adjustment)

- [ ] `packages/cds-data-federation/spec/concepts/index.md` — same one-line stub as pipeline.

#### Task 4.6 — Trim root [`mkdocs.yml`](../../../mkdocs.yml) `nav:`

- [ ] Remove the `Getting Started:` block entirely.
- [ ] Remove the `Federation plugin (cds-data-federation):` block entirely (lines 72–75).
- [ ] Root `nav:` now reduced to: Home, Concepts, Reference → Features. (Features is the federation-row-only carcass; deleted in Commit 5.)

#### Task 4.7 — Verify Commit 4

- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-federation/mkdocs.yml`.
- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml`.
- [ ] `.venv/bin/mkdocs build --strict -f mkdocs.yml` — root site still builds on its reduced shape.
- [ ] R4 + R5 greps: no regressions.
- [ ] `npm run lint` passes.
- [ ] Commit with message `docs(federation): create packages/cds-data-federation/docs + mkdocs` + body + `Part of ADR 0006.`

---

### Commit 5 — `docs: retire root mkdocs; per-package sites via gh-pages subpaths` (APPROVAL GATE + MANUAL PAGES FLIP)

> **Stop and ask the user explicitly** before executing. This commit deletes [`mkdocs.yml`](../../../mkdocs.yml), rewrites [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml), and requires the user to flip `Settings → Pages → Source` from *"GitHub Actions"* to *"Deploy from a branch → `gh-pages` / `/`"* **before** the first post-merge deploy.

#### Task 5.1 — Duplicate `spec/concepts/**` per package with scope pruning

- [ ] `cp spec/concepts/terminology.md packages/cds-data-pipeline/spec/concepts/terminology.md` then prune: keep pipeline-scoped sections (kind taxonomy, source/target/pipeline/mode/delta), drop federation-only subsections (`@federation.*`, delegate-specific discussion).
- [ ] `cp spec/concepts/terminology.md packages/cds-data-federation/spec/concepts/terminology.md` then prune: keep federation-scoped sections (delegate / replicate / federation / consumption view), drop the `kind` taxonomy detail (reference with a link to the engine site instead).
- [ ] `cp spec/concepts/consumption-views.md packages/cds-data-federation/spec/concepts/consumption-views.md` (federation-only concept — no pipeline copy).
- [ ] `cp spec/concepts/cross-service-scenarios.md packages/cds-data-federation/spec/concepts/cross-service-scenarios.md` (federation-only).
- [ ] `cp spec/concepts/service-query-execution.md packages/cds-data-federation/spec/concepts/service-query-execution.md` (federation-only — the whole doc is about how CAP routes queries through services, which is the delegate story).
- [ ] `spec/concepts/expand-scenarios.md` is a 3-line stub redirect; **do not copy** — federation site's `cross-service-scenarios.md` is the canonical target.
- [ ] Delete the placeholder `concepts/index.md` stubs from Commits 3 and 4.
- [ ] Update per-package `mkdocs.yml` `nav:` to include the new concept pages.

#### Task 5.2 — Header banner on root [`spec/concepts/`](../../concepts/) pages

- [ ] Add to each of the 5 files as a second line (right after the `# Title`):
      ```
      > **Contributor canonical source.** Consumer-facing concept pages live under [`packages/cds-data-pipeline/spec/concepts/`](../../packages/cds-data-pipeline/spec/concepts/) and [`packages/cds-data-federation/spec/concepts/`](../../packages/cds-data-federation/spec/concepts/). Edits here are the authoritative version for contributors; sync changes into the per-package copies as the scope allows.
      ```
- [ ] Verify no existing link from [ADRs](../decisions/), [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), or internal workflow docs breaks after this edit.

#### Task 5.3 — Delete root-only external pages

- [ ] Delete [`docs/index.md`](../../index.md).
- [ ] Delete [`docs/reference/features.md`](../../reference/features.md).
- [ ] Delete root [`mkdocs.yml`](../../../mkdocs.yml).
- [ ] Directories [`docs/getting-started/`](../../getting-started/) and [`docs/integration/`](../../integration/) are already empty after Commits 3–4; delete the empty directories too.

#### Task 5.4 — Rewrite [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) per ADR 0006 §8

- [ ] Full replacement per the ADR's YAML spec. Key fields:
      - `on.push.paths` — `docs/pipeline/**`, `docs/federation/**`, `packages/*/mkdocs.yml`, `packages/*/README.md`, `docs-requirements.txt`, `.github/workflows/docs.yml`, `docs/_pages-landing/**`.
      - `strategy.matrix.package: [cds-data-pipeline, cds-data-federation]`.
      - `strategy.fail-fast: false` — one package's mkdocs failure shouldn't abort the other.
      - Build step: `mkdocs build --strict -f packages/${{ matrix.package }}/mkdocs.yml -d ../../site/${{ matrix.package }}`.
      - Deploy step: `peaceiris/actions-gh-pages@v4` with `publish_dir: site/${{ matrix.package }}`, `destination_dir: ${{ matrix.package }}`, `keep_files: true`.
      - `concurrency.group: pages`, `cancel-in-progress: false`.
- [ ] Add a **landing-page deploy job** (separate job, `needs: build-and-deploy`) that copies `docs/_pages-landing/index.html` to the `gh-pages` root via the same action with `publish_dir: docs/_pages-landing` and **no** `destination_dir`, `keep_files: true`.

#### Task 5.5 — Create landing page

- [ ] `docs/_pages-landing/index.html` — minimal static HTML (~30 lines) linking to the two subpaths. No framework, no CSS dependency.

#### Task 5.6 — Update [`package.json`](../../../package.json) scripts

- [ ] Per ADR 0006 §9. Remove `docs:serve` and `docs:build` (top-level). Add `docs:serve:pipeline`, `docs:serve:federation`, `docs:build:pipeline`, `docs:build:federation`, and a new `docs:build` aggregator that runs both.
- [ ] Keep `docs:setup` unchanged (shared `.venv/`).

#### Task 5.7 — Amend [`CLAUDE.md`](../../../CLAUDE.md) §Conventions low-redundancy rule

- [ ] Locate the bullet at line 137: *"Docs: low redundancy — a given fact lives in exactly one place; other surfaces cross-reference. The only allowed exception is internal ↔ external..."*.
- [ ] Add after the existing exception sentence: *"A second allowed exception, per [ADR 0006](./spec/internal/decisions/0006-per-plugin-published-surface.md): consumer-facing concept pages duplicated under each `packages/*/spec/concepts/` tree with per-package scope. The contributor canonical source lives at `spec/concepts/`."*

#### Task 5.8 — Amend [ADR 0002 header](../decisions/0002-separate-internal-and-published-docs.md)

- [ ] Insert a supersession note below the title, following the ADR 0003 / 0005 pattern: *"**§1 superseded by [ADR 0006](./0006-per-plugin-published-surface.md)** (2026-04-19). The `exclude_docs:` block is retired along with the root `mkdocs.yml`. §2 (features.md), §3 (style guide R1–R4), §4 (Req-10 enforcement), §5 (link rewrites) remain in force."*

#### Task 5.9 — Amend [ADR 0003 header](../decisions/0003-split-plugin-into-replication-and-federation.md)

- [ ] Add one line to the existing supersession note paragraph: *"**Docs surface**: split along the same package lines, see [ADR 0006](./0006-per-plugin-published-surface.md)."*

#### Task 5.10 — Verify Commit 5

- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml`.
- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-federation/mkdocs.yml`.
- [ ] `npm run docs:build` (aggregator) succeeds.
- [ ] `npm run docs:serve:pipeline` boots locally at http://127.0.0.1:8000 with engine content (spot-check).
- [ ] `npm run docs:serve:federation` same for federation.
- [ ] R4 + R5 greps: still only `## For contributors` hits on root README.
- [ ] `npm run lint` passes.
- [ ] **Do not attempt to validate `gh-pages` deploy locally.** The CI transition can only be end-to-end-validated after merge.
- [ ] Commit message explicitly flags the required manual step:
      ```
      docs: retire root mkdocs; per-package sites via gh-pages subpaths

      Introduces two per-package mkdocs sites deployed via
      peaceiris/actions-gh-pages to subpaths on the gh-pages branch.

      Manual pre-merge step: flip repo Settings → Pages → Source from
      "GitHub Actions" to "Deploy from a branch → gh-pages / /".

      Part of ADR 0006.
      ```

---

### Commit 6 — `docs: thin root README; finalize per-package READMEs`

#### Task 6.1 — Rewrite [`README.md`](../../../README.md) (root)

- [ ] Target ~40 lines. Structure per ADR 0006 §5:
      - Title (monorepo name).
      - One-paragraph positioning.
      - `## Which package do I need?` — 2-row markdown table (Intent | Install | Docs).
      - `## Examples` — 2–3 lines, link per example directory.
      - `## For contributors` — one paragraph; the current `## Links` section's contributor-scoped bullets move here, non-contributor links move into `## Which package do I need?`'s table cells or drop entirely.
- [ ] **No code snippets.** Delete all the `cds` / `http` / `javascript` / `json` blocks from the current root README (lines 16–34, 38, 49, 88, 115, 160–194, 215–223, 241–269, 275–315 and further). Their homes are the two package READMEs in Task 6.2–6.3.

#### Task 6.2 — Consolidate [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md)

- [ ] Ensure the package README is self-contained for an npm landing page. Current content (~122 lines after Commit 2 scrub) already covers: §What this is, §What this isn't, §kind taxonomy, §Install, §Database schema, §Programmatic API (with `addPipeline(...)` + event hooks), §Management service, §Upgrade from pre-split, §Related.
- [ ] Move from root `README.md` (post-Commit 2): the engine-specific subset of §"Programmatic API" (CAP-native service events, the full `srv.before/on/after` example), §"Event hooks" ordering/signature notes, §"CQL limitations on remote (OData) services" section since that's engine/adapter-layer.
- [ ] Keep the `## Related` npm-URL cross-link from Commit 2.

#### Task 6.3 — Consolidate [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md)

- [ ] Ensure self-contained. Current content (~75 lines after Commit 2 scrub) covers: §Scope, §Install, §Example, §Composition with `cds-data-pipeline`, §Related.
- [ ] Inline from root `README.md` (post-Commit 2): the full §"Core concept: consumption views" patterns (wildcard, column restriction + renames, association renames, entity-level rename), the full §"Annotation reference" (Common options table, Cache option, Replicate options, Examples), §"Feature matrix" subset that applies to federation (Query delegation / `$expand` scenarios / Cross-service navigation / CUD forwarding / Server-driven paging delegate / Protocols / Caching), §"CQL limitations" link-out to the engine README.
- [ ] Keep the `## Related` npm-URL cross-link from Commit 2.

#### Task 6.4 — Final verification

- [ ] R4 grep over whole repo (`docs/`, `README.md`, `packages/*/README.md`, `packages/*/docs/`, `examples/**/README.md`): **empty**.
- [ ] R5 grep over whole published surface: hits **only** under root `README.md` `## For contributors`.
- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml`.
- [ ] `.venv/bin/mkdocs build --strict -f packages/cds-data-federation/mkdocs.yml`.
- [ ] `npm run lint`.
- [ ] Manually walk: open root `README.md` + both `packages/*/README.md` and confirm each is self-contained and non-redundant with the others.
- [ ] Commit message `docs: thin root README; finalize per-package READMEs` + body + `Part of ADR 0006.`

---

### Phase 5 — Move plan to completed/

- [ ] After Commit 6 is verified and pushed, `git mv spec/internal/plans/per-plugin-published-surface.md spec/internal/plans/completed/per-plugin-published-surface.md`.
- [ ] Update this plan's front matter: `Status: Completed` + `Completed: <date>`.
- [ ] Commit with `docs: mark ADR 0006 plan as completed`.

## Test strategy

**No Jest tests.** ADR 0006 is a docs/infra change; no `srv/**` or `test/**` file is modified. Record explicitly in each commit message.

Verification relies on:

| Signal | What it proves | Command |
|---|---|---|
| R4 grep | Existing tone rule stays clean | `grep -rnE 'stops short\|hand-written\|boilerplate\|does not do\|despite the name\|what .* does NOT' docs/ README.md packages/*/README.md packages/*/docs/ examples/ --include='*.md' --exclude-dir=internal 2>/dev/null` |
| R5 grep (new) | Internal references are only under `## For contributors` | See Task 1.2 |
| `mkdocs build --strict` per config | No dangling links; all nav targets resolve | `.venv/bin/mkdocs build --strict -f <path-to-mkdocs.yml>` |
| `npm run lint` | Lint hygiene (unchanged — files touched are `.md` / `.yml`, not `.js`) | `npm run lint` |

## Validation commands

```bash
# R4 grep (must stay empty throughout)
grep -rnE 'stops short|hand-written|boilerplate|does not do|despite the name|what .* does NOT' \
  docs/ README.md packages/*/README.md packages/*/docs/ examples/ \
  --include='*.md' --exclude-dir=internal 2>/dev/null

# R5 grep (introduced in Commit 1; expected to return only root README ## For contributors
# hits from Commit 2 onward)
grep -rnE 'spec/internal/|ADR 00[0-9]+|ADR-00[0-9]+|\[ADR [0-9]+\]|CLAUDE\.md|AGENTS\.md|reference/requirements\.md|reference/test-mapping\.md' \
  README.md packages/*/README.md packages/*/docs/ examples/ \
  --include='*.md' 2>/dev/null

# Strict builds (per commit, whichever configs exist)
.venv/bin/mkdocs build --strict -f mkdocs.yml                                  # commits 1–4
.venv/bin/mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml       # commits 3–
.venv/bin/mkdocs build --strict -f packages/cds-data-federation/mkdocs.yml     # commits 4–

# Lint (sanity — nothing runtime-touching should change)
npm run lint
```

## Out of scope (per ADR 0006)

- Moving or renaming any file under [`spec/internal/**`](../) other than the amendment notes on [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md) and [ADR 0003](../decisions/0003-split-plugin-into-replication-and-federation.md) and the optional banner on [`spec/concepts/**`](../../concepts/) pages.
- Moving [`spec/reference/requirements.md`](../../reference/requirements.md) or [`spec/reference/test-mapping.md`](../../reference/test-mapping.md).
- Deleting [`spec/concepts/**`](../../concepts/).
- Changing the `@federation.*` or `addPipeline(...)` public API.
- Changing [ADR 0002 R1–R4](../decisions/0002-separate-internal-and-published-docs.md) tone rules (R5 layers on top).
- Renaming the GitHub repository.
- Any code or test changes under `packages/*/srv/`, `packages/*/db/`, or `test/`.

## Open points flagged during planning

1. **Root `README.md` line 10 broken link** (`0003-split-into-data-replication-and-data-federation.md`) — the actual file is named `0003-split-plugin-into-replication-and-federation.md`. The scrub in Commit 2 deletes the whole paragraph containing this link, so the broken path disappears as a side effect. No separate fix commit needed.
2. **Commit 3 strict-build window.** `mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml` fails between Commits 3 and 5 because the nav references concept pages that don't exist until Commit 5. Mitigation chosen in Task 3.6: one-line `concepts/index.md` placeholder stub, deleted in Commit 5. Keeps "main is buildable between commits" intact.
3. **Landing-page deploy ordering.** The landing `index.html` deploy needs `needs: build-and-deploy` in the workflow so it runs after both matrix entries; otherwise `keep_files: true` + parallel writes to `gh-pages` could race. Task 5.4 records this.
4. **Manual Pages source flip (Commit 5 pre-merge).** Not something CI can do. Commit 5's message explicitly calls it out; the merge PR's description should repeat the instruction.
5. **`spec/concepts/` pruning effort.** Task 5.1 is the most judgment-heavy step — carving which sections of each concept doc belong to which audience. Recommend showing a diff to the user for each pruned file before committing.
