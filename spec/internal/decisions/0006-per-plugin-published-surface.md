# 6. Per-plugin published surface: isolated READMEs + isolated MkDocs sites under `packages/*/`

**Date:** 2026-04-19
**Status:** Accepted
**Amends:** [ADR 0002](./0002-separate-internal-and-published-docs.md) — supersedes §1 (root `mkdocs.yml` + `exclude_docs:` block) only; §2–§5 (consumer-facing `features.md`, tone style guide R1–R4, `Req-10` enforcement, `comparison.md` link rewrite) remain in force.
**Note on [ADR 0003](./0003-split-plugin-into-replication-and-federation.md):** the monorepo code split recorded there implicitly assumed one shared docs surface. This ADR extends the split to the published surface; [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) gets a one-line pointer note at the top referencing this ADR.

## Context

The repository is an npm workspaces monorepo hosting two independent npm packages per [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) / [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md):

- [`packages/cds-data-pipeline/`](../../../packages/cds-data-pipeline/) — the engine. Programmatic `addPipeline({ kind, ... })` surface; no federation annotations.
- [`packages/cds-data-federation/`](../../../packages/cds-data-federation/) — the annotation layer. `@federation.delegate` / `@federation.replicate`; composes the engine for `replicate`.

The published docs surface did not track the split. [`mkdocs.yml`](../../../mkdocs.yml) line 1 set `site_name: cds-data-pipeline + cds-data-federation` and line 3 set `site_url: https://mikezaschka.github.io/cds-data-federation/`, treating the monorepo as a single product. [ADR 0002](./0002-separate-internal-and-published-docs.md) handled *internal vs. external* separation via `exclude_docs:` and a tone style guide; it left *per-plugin* separation out of scope (non-goals §1).

Two concrete leaks motivated this ADR:

1. **Published READMEs reference contributor artefacts.** [`README.md`](../../../README.md) links to [`spec/reference/requirements.md`](../../reference/requirements.md), [`CLAUDE.md`](../../../CLAUDE.md), and `spec/internal/research/**` from its §Links section; the opening paragraphs cite [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) and [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) inline. [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md) cites four ADRs. [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md) cites two. npm renders each package's README on its landing page; every consumer lands one click from contributor-only material. [ADR 0002 R1–R4](./0002-separate-internal-and-published-docs.md) regulates *tone* but not *link targets*, and the `packages/*/README.md` files post-date that ADR.
2. **One MkDocs site serves two independent npm packages.** Nav sections split by package but `Getting Started`, `Concepts`, and `Reference` mix. A visitor from `npmjs.com/package/cds-data-pipeline` lands on a URL whose path names the other package and on a front page opening with federation annotations.

The direction was settled in [`spec/internal/ideas/per-plugin-published-surface.md`](../ideas/per-plugin-published-surface.md) before this ADR opened: each package owns its consumer surface (README + MkDocs site), root `docs/` holds only contributor material, concept duplication between the two packages' docs is deliberately accepted. The ADR resolves the twelve remaining implementation questions.

### Constraints that shaped the decision

- **Contributor trees cannot move.** [ADR 0002 §Options §A](./0002-separate-internal-and-published-docs.md) rejected moving [`spec/internal/**`](../) and [`spec/reference/requirements.md`](../../reference/requirements.md) because ~7 files in [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), [`.claude/commands/*.md`](../../../.claude/commands/), and [`.cursor/rules/project.mdc`](../../../.cursor/rules/project.mdc) hardcode those paths. The same rejection applies here. Specifically for [`spec/concepts/**`](../../concepts/): a grep confirms 14+ contributor references from ADRs 0003/0004/0005, [`CLAUDE.md`](../../../CLAUDE.md) §"Where to find things", [`AGENTS.md`](../../../AGENTS.md), [`spec/internal/ai-assistant-context.md`](../ai-assistant-context.md) (11×), and workflow docs. The root concepts tree is the contributor canonical source of truth; it cannot be deleted.
- **CAP-level low-redundancy rule.** [`CLAUDE.md`](../../../CLAUDE.md) §Conventions: *"Docs: low redundancy — a given fact lives in exactly one place … The only allowed exception is internal ↔ external."* This ADR introduces a **second** explicit exception for per-package consumer duplication; see §Decision.
- **Official GitHub Pages action is single-site.** [`actions/deploy-pages@v4`](https://github.com/actions/deploy-pages) binds to one `github-pages` environment and one artifact per repository. Multi-site hosting from one repo requires [`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages) writing to a shared `gh-pages` branch with `destination_dir:` per package.
- **Repo name is asymmetric.** The GitHub repo is `mikezaschka/cds-data-federation`; the npm package names are symmetric but the Pages subpath will name one package in the URL path of the other's site. That cosmetic cost is accepted here; a rename is a separate future decision.
- **Examples extraction is pending.** [ADR 0002 §Context](./0002-separate-internal-and-published-docs.md) and [`spec/internal/ideas/docs-internal-external-separation.md`](../ideas/docs-internal-external-separation.md) flag [`examples/`](../../../examples/) for future extraction to a separate repository. This ADR keeps `examples/**/README.md` in scope for R5 so the extraction stays cheap.

## Decision

### 1. Repo layout

```
/README.md                                   # thin monorepo hub (~40 lines, no code)
/CLAUDE.md, /AGENTS.md                       # unchanged — contributor entry points
/docs/
  /concepts/**                               # contributor canonical source of truth
  /internal/**                               # ADRs, research, ideas, plans, ai-assistant-context
  /reference/requirements.md                 # contributor feature tracker
  /reference/test-mapping.md                 # auto-generated
  # no root mkdocs.yml; no external-surface pages
/packages/cds-data-pipeline/
  README.md                                  # canonical consumer README (npm landing page)
  mkdocs.yml                                 # own MkDocs config
  docs/
    index.md
    concepts/**                              # engine-scoped subset, pruned per §2
    getting-started/**                       # engine-scoped
    reference/features.md                    # engine capabilities only
    reference/management-service.md
    integration/odata.md
    integration/rest.md
/packages/cds-data-federation/
  README.md                                  # canonical consumer README (npm landing page)
  mkdocs.yml                                 # own MkDocs config
  docs/
    index.md
    concepts/**                              # federation-scoped subset, pruned per §2
    getting-started/**                       # federation-scoped (first-delegation, first-replication, first-cache, patterns)
    reference/annotations.md
    reference/comparison.md
    reference/features.md                    # federation capabilities only
    integration/caching.md
```

[`spec/concepts/**`](../../concepts/) at repo root stays as the **contributor canonical source of truth**, unchanged in content, with a header note added once: *"Contributor canonical source. Consumer-facing concept pages live under `packages/*/spec/concepts/`."* Each package's `spec/concepts/` is an independent, pruned, consumer-scoped subset — not a mechanical copy. For example, `packages/cds-data-pipeline/spec/concepts/terminology.md` covers `kind`, `source`, `target`, `pipeline`, `mode`, `delta`; `packages/cds-data-federation/spec/concepts/terminology.md` covers `delegate`, `replicate`, consumption view, federation. Different scope, different detail level.

### 2. GitHub Pages hosting — subpath deploys via `peaceiris/actions-gh-pages`

Two sites, one repository, one `gh-pages` branch. Each matrix entry builds into `site/<package>/` and deploys to the branch with `destination_dir: <package>` and `keep_files: true` so matrix entries don't overwrite each other.

Resulting URLs:

- `/pipeline/`
- `/federation/`

**Accepted cosmetic cost:** the repo name `cds-data-federation` appears in the path of the pipeline-engine site. A repo rename is out of scope for this ADR and captured as a potential future idea.

**One-time manual setup** required before the first deploy succeeds: repo `Settings → Pages → Source` flipped from *"GitHub Actions"* to *"Deploy from a branch → `gh-pages` / `/`"*. A trivial `gh-pages` `index.html` linking to the two subpaths is added as part of the switch commit (§10 commit 5).

Rejected alternatives: two dedicated publish repos (overkill pre-release, doubles the token/CI surface); repo rename privileging one package (same asymmetry inverted).

### 3. `spec/concepts/**` disposition

Keep at repo root as contributor SoT; duplicate selectively per package with per-package scoping. This is the second explicit exception to the [`CLAUDE.md`](../../../CLAUDE.md) §Conventions low-redundancy rule, on top of the existing internal↔external exception. Rationale:

- 14 contributor references into [`spec/concepts/terminology.md`](../../concepts/terminology.md) alone from [ADR 0003](./0003-split-plugin-into-replication-and-federation.md), [ADR 0004](./0004-scope-cqn-adapter-to-cds-data-replication.md), [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md), [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), [`ai-assistant-context.md`](../ai-assistant-context.md), workflow docs, and research notes. Deletion would force a rewrite of all 14 files; `git mv` would re-break the same set. Keeping the canonical concept tree at root is the cheapest correct answer.
- Each package's `spec/concepts/` serves a consumer. The federation consumer does not need the engine's `kind` taxonomy; the engine consumer does not need cross-service `$expand` scenarios. Pruning per package is a feature, not a duplication bug.

[`CLAUDE.md`](../../../CLAUDE.md) §Conventions gets one line added to the low-redundancy rule clause: *"The second allowed exception is consumer-facing concept pages duplicated under each `packages/*/spec/concepts/` tree with per-package scope; the contributor canonical source lives at `spec/concepts/`."* This is a pointer update, not a policy introduction — the policy lives in this ADR.

### 4. `features.md` split per package; `requirements.md` stays unified

- `docs/pipeline/reference/features.md` — engine capabilities: `kind` taxonomy, pipeline events, management OData surface, adapter matrix, retry/concurrency guarantees, delta modes.
- `docs/federation/reference/features.md` — federation capabilities: `@federation.*` annotations, query delegation matrix, `$expand` scenarios, cross-service navigation, CUD opt-in, cache options, protocol matrix, CQL-on-OData limitations.
- [`spec/reference/requirements.md`](../../reference/requirements.md) stays unified at repo root, contributor-only. Requirement rows keep their package attribution via the section structure already established in [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md).

[`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.2 changes from a single `docs/reference/features.md` update target to a picker: *"update `docs/pipeline/reference/features.md` for engine-scope features, `docs/federation/reference/features.md` for annotation-scope features; a feature may touch both when it crosses the binding seam."*

### 5. Thinned root `README.md`

Target ~40 lines. Outline:

- Title + one-paragraph monorepo positioning.
- "Which package do I need?" two-row table mapping intent → install command → docs link (both package README and site subpath).
- "Examples" — 2–3 lines, one link per example.
- "For contributors" — one paragraph, links to [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), [`spec/internal/`](../), [`spec/reference/requirements.md`](../../reference/requirements.md), test workflow. **This is the only place in the repo's published surface where internal-path links are permitted.**

No code snippets in the root README. All annotation, API, and management-service examples live in the package READMEs (which are also the npm landing pages). This eliminates the ~350 lines of duplication between the current root README and the per-package sites.

### 6. [`docs-style-guide.md`](../docs-style-guide.md) — extended scope and new R5

**Scope update:** the guide now covers

- [`docs/`](../../) (excluding [`spec/internal/`](../), [`spec/reference/requirements.md`](../../reference/requirements.md), [`spec/reference/test-mapping.md`](../../reference/test-mapping.md), [`spec/concepts/`](../../concepts/) — all contributor material after this ADR).
- `packages/*/README.md`.
- `docs/pipeline/** and docs/federation/**/*.md`.
- [`README.md`](../../../README.md) (repo root) — except the designated `## For contributors` section.
- [`examples/**/README.md`](../../../examples/).

**R5 — No internal references on published surfaces.** Published READMEs and published MkDocs pages must not link to `spec/internal/`, inline ADR citations (`[ADR NNNN]`, `ADR-NNNN`, `ADR 000N`), [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), [`spec/reference/requirements.md`](../../reference/requirements.md), or [`spec/reference/test-mapping.md`](../../reference/test-mapping.md). The single exception is the `## For contributors` section of the root [`README.md`](../../../README.md) (and any future `## For contributors` sections in package READMEs).

**Grep-lint** (paralleling R4):

```bash
grep -rnE 'spec/internal/|ADR 00[0-9]+|ADR-00[0-9]+|\[ADR [0-9]+\]|CLAUDE\.md|AGENTS\.md|reference/requirements\.md|reference/test-mapping\.md' \
  README.md packages/*/README.md packages/*/docs/ examples/**/README.md \
  --include='*.md' 2>/dev/null
```

Expected to return nothing outside a `## For contributors` heading. The grep is a coarse mechanical check; reviewer judgment closes the scope-within-section gap (same pattern as R1–R3, which are also reviewer judgment).

**Cross-package linking rule** (added as a bullet under §Scope): *"Published READMEs and sites link across package boundaries via absolute URLs, never relative paths. Use `https://www.npmjs.com/package/<pkg>` for consumer references; use `https://github.com/mikezaschka/cds-data-federation/blob/main/packages/<pkg>/...` for deeper repo pointers. Relative paths like `../cds-data-pipeline/README.md` do not resolve on npm."*

### 7. [`.claude/commands/review.md`](../../../.claude/commands/review.md) updates

Phase 1 category list gains `packages/*/README.md` and `docs/pipeline/** and docs/federation/**`. Phase 2 Req-10 extends its §Scope paragraph to match the style-guide §Scope and adds a second grep block for R5 after the existing R4 block. Phase 3 report template unchanged.

### 8. CI: [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml)

Matrix over the two packages. Each matrix entry runs `mkdocs build --strict` against its per-package config and deploys to its subpath on `gh-pages` via [`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages) with `keep_files: true`. Path filter updated to trigger on `docs/pipeline/**`, `docs/federation/**`, `packages/*/mkdocs.yml`, `packages/*/README.md`, `docs-requirements.txt`, and `.github/workflows/docs.yml`. Concurrency group stays `pages` with `cancel-in-progress: false` to serialize the two matrix entries cleanly on the shared branch.

### 9. [`package.json`](../../../package.json) scripts

```json
"docs:setup": "python3 -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r docs-requirements.txt",
"docs:serve:pipeline": ".venv/bin/mkdocs serve -f packages/cds-data-pipeline/mkdocs.yml",
"docs:serve:federation": ".venv/bin/mkdocs serve -f packages/cds-data-federation/mkdocs.yml",
"docs:build:pipeline": ".venv/bin/mkdocs build --strict -f packages/cds-data-pipeline/mkdocs.yml",
"docs:build:federation": ".venv/bin/mkdocs build --strict -f packages/cds-data-federation/mkdocs.yml",
"docs:build": "npm run docs:build:pipeline && npm run docs:build:federation"
```

`docs-requirements.txt` and `.venv/` stay at repo root (shared across both packages). The old unparameterized `docs:serve` is removed; callers must pick a package.

### 10. Per-site `mkdocs.yml`

Each `packages/<pkg>/mkdocs.yml` sets:

```yaml
docs_dir: docs
site_url: https://mikezaschka.github.io/cds-data-federation/<pkg>/
repo_url: https://github.com/mikezaschka/cds-data-monorepo
repo_name: mikezaschka/cds-data-federation
edit_uri: edit/main/packages/<pkg>/docs/
```

Theme config, markdown extensions, and plugins mirror the current root [`mkdocs.yml`](../../../mkdocs.yml); no functional change there.

### 11. Landable sequence

Six reviewable commits. `main` stays green between commits 1–4 and 6; commit 5 is a single-commit CI transition that requires a one-time Pages-source flip.

| # | Commit | Scope | Safety |
|---|---|---|---|
| 1 | `docs: add R5 + scope extensions to docs-style-guide` | [`spec/internal/docs-style-guide.md`](../docs-style-guide.md), [`.claude/commands/review.md`](../../../.claude/commands/review.md), [`AGENTS.md`](../../../AGENTS.md) (one-line scope bump). | Non-structural. Root site still builds. |
| 2 | `docs: scrub internal references from published READMEs` | [`README.md`](../../../README.md), [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md), [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md), [`examples/**/README.md`](../../../examples/). R5 grep returns empty outside `## For contributors`. | Fixes the leak ASAP. Reverentable. |
| 3 | `docs(pipeline): create packages/cds-data-pipeline/docs + mkdocs.yml` | `git mv` pipeline-scope pages into the package tree; add per-package `mkdocs.yml`, `features.md`. Root `mkdocs.yml` still builds. | Root site builds with reduced nav. |
| 4 | `docs(federation): create packages/cds-data-federation/docs + mkdocs.yml` | Same for federation. Root `mkdocs.yml` now points at an effectively empty set. | Root site builds. |
| 5 | `docs: retire root mkdocs; duplicate concepts per package; switch CI` | Delete root `mkdocs.yml`. Copy-with-pruning `spec/concepts/**` into both package trees. Rewrite [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) per §8. Update [`package.json`](../../../package.json) per §9. Flip repo Pages source. Add a minimal `gh-pages/index.html` landing page linking to both subpaths. | **One-commit CI transition.** Verify `gh-pages` subpaths serve before merging. |
| 6 | `docs: thin root README; finalize per-package READMEs` | Rewrite [`README.md`](../../../README.md) per §5. Consolidate full annotation reference and full programmatic API into the respective package READMEs. Final R5 grep clean. | Content-move commit. |

## Consequences

### What this enables

- **npm landing pages are honest.** A consumer on `npmjs.com/package/cds-data-pipeline` sees a README scoped to the engine; one on `npmjs.com/package/cds-data-federation` sees a README scoped to the annotation layer. Neither page leaks contributor artefacts.
- **MkDocs sites are scoped.** Each site's search index, nav, and front page describe exactly one package. `mkdocs build --strict` runs per package.
- **Root README becomes a honest monorepo hub.** ~40 lines, no code, points to the two canonical surfaces.
- **Contributor workflows stay intact.** [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), all [`.claude/commands/`](../../../.claude/commands/) files, [`.cursor/rules/project.mdc`](../../../.cursor/rules/project.mdc), and [`spec/internal/ai-assistant-context.md`](../ai-assistant-context.md) keep every relative link to [`spec/concepts/**`](../../concepts/), [`spec/internal/**`](../), [`spec/reference/requirements.md`](../../reference/requirements.md), and [`spec/reference/test-mapping.md`](../../reference/test-mapping.md) working. Zero path churn into contributor material.
- **Future `examples/` extraction is cheap.** Examples already follow the published style per [ADR 0002 §3](./0002-separate-internal-and-published-docs.md); this ADR adds R5 coverage so the extracted repo carries consistent link hygiene from day one.

### What we accept as trade-offs

- **Second exception to the low-redundancy rule.** Consumer concept pages are duplicated per package with scope differences. This is an explicit policy addition, recorded in §3 and reflected as a one-line clause in [`CLAUDE.md`](../../../CLAUDE.md) §Conventions.
- **Doubly-nested site URLs.** `mikezaschka.github.io/cds-data-federation/cds-data-pipeline/` names the repo in the subpath of the engine site. The cost is cosmetic; a repo rename is a separate decision.
- **Single-commit CI transition.** Commit 5 in §11 changes the deploy mechanism. Mitigated by running the new workflow once on a throwaway branch before merging and by the manual Pages-source flip being a one-line repo setting.
- **R5 grep is coarse.** It can't distinguish "under `## For contributors`" from "elsewhere in the same README"; reviewer judgment closes the gap. Consistent with how R1–R3 are already enforced.
- **Two build jobs in CI.** Doubles the pip-install and mkdocs-build time. Acceptable; both are seconds-scale.
- **`docs:serve` is removed from root scripts.** Callers must pick `docs:serve:pipeline` or `docs:serve:federation`. Minor DX cost; worth it to avoid a silent serve-the-wrong-site footgun.

### Follow-up work

Tracked as a checklist, not as ADR content. Numbered to match §11.

1. Commit 1 — [`spec/internal/docs-style-guide.md`](../docs-style-guide.md) §Scope + R5; [`.claude/commands/review.md`](../../../.claude/commands/review.md) Phase 1 + 2; [`AGENTS.md`](../../../AGENTS.md) §Conventions (one line pointing at R5).
2. Commit 2 — scrub internal links from [`README.md`](../../../README.md), [`packages/cds-data-pipeline/README.md`](../../../packages/cds-data-pipeline/README.md), [`packages/cds-data-federation/README.md`](../../../packages/cds-data-federation/README.md), [`examples/**/README.md`](../../../examples/). Content rewrite per §5 still deferred to commit 6.
3. Commit 3 — create `docs/pipeline/` + `packages/cds-data-pipeline/mkdocs.yml` + `docs/pipeline/reference/features.md`.
4. Commit 4 — create `docs/federation/` + `packages/cds-data-federation/mkdocs.yml` + `docs/federation/reference/features.md`.
5. Commit 5 — delete root [`mkdocs.yml`](../../../mkdocs.yml); duplicate [`spec/concepts/**`](../../concepts/) into both package trees with per-package pruning; add header note to root [`spec/concepts/`](../../concepts/) index page; update [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) per §8; update [`package.json`](../../../package.json) per §9; flip repo Pages source; add minimal `gh-pages/index.html` landing page.
6. Commit 6 — rewrite [`README.md`](../../../README.md) per §5; consolidate consumer content into per-package READMEs; run the R5 grep to verify.
7. Amend [`CLAUDE.md`](../../../CLAUDE.md) §Conventions low-redundancy rule with the second-exception clause (part of commit 5 or a follow-up `docs:` commit).
8. Amend [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.2 per §4 (features.md picker). Also part of commit 1 or a follow-up.
9. Add a one-line pointer note to [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) referencing this ADR (docs-surface split along the same package lines).
10. Amend [ADR 0002](./0002-separate-internal-and-published-docs.md) header with a supersession note matching the ADR 0003/0005 pattern: §1 superseded by this ADR; §2–§5 remain in force.

### What this decision does not do

- Does not move or rename any file under [`spec/internal/**`](../).
- Does not move [`spec/reference/requirements.md`](../../reference/requirements.md) or [`spec/reference/test-mapping.md`](../../reference/test-mapping.md). They stay unified as the contributor tracker.
- Does not delete [`spec/concepts/**`](../../concepts/). It stays at root as the contributor canonical source of truth.
- Does not change the `@federation.*` annotation surface or the `addPipeline({ kind, ... })` API.
- Does not change [ADR 0002 R1–R4](./0002-separate-internal-and-published-docs.md) tone rules. R5 layers on top.
- Does not rename the GitHub repository. A rename is a potential future idea.

## Amendment (2026-05-22): unified public `docs/` + contributor `spec/`

**Status:** Accepted (supersedes the 2026-05-21 split-build amendment for published content.)

- **Public:** [`docs/`](../../../docs/) — single VitePress site (`npm run docs:serve` / `npm run docs:build`). Published pages live under `docs/pipeline/` and `docs/federation/`. CI deploys `docs/.vitepress/dist` to the `gh-pages` site root.
- **Contributor:** [`spec/`](../../../spec/) — `spec/concepts/`, `spec/internal/`, `spec/reference/` (requirements + test mapping). Not included in the site build.
- Retired: `packages/*/docs/`, per-package `mkdocs.yml`, and the separate gh-pages subpath deploy matrix for published content.

## References

- [`spec/internal/ideas/per-plugin-published-surface.md`](../ideas/per-plugin-published-surface.md) — originating idea; gets marked `Promoted` with pointer to this ADR.
- [`spec/internal/ideas/docs-internal-external-separation.md`](../ideas/docs-internal-external-separation.md) — prior idea; `Promoted` to [ADR 0002](./0002-separate-internal-and-published-docs.md). This ADR is the direct sequel.
- [ADR 0002](./0002-separate-internal-and-published-docs.md) — amended by this ADR (§1 superseded; §2–§5 retained).
- [ADR 0003](./0003-split-plugin-into-replication-and-federation.md) — gets a pointer note from this ADR; monorepo code split preserved, docs surface now matches.
- [ADR 0005](./0005-reposition-engine-as-cds-data-pipeline.md) — engine repositioning; sets the package naming this ADR consumes.
- [`CLAUDE.md`](../../../CLAUDE.md) §Conventions (low-redundancy rule) — receives a second-exception clause.
- [`AGENTS.md`](../../../AGENTS.md) §Conventions — receives an R5 pointer line.
- [`spec/internal/docs-style-guide.md`](../docs-style-guide.md) — §Scope extended, R5 added.
- [`.claude/commands/review.md`](../../../.claude/commands/review.md) — Phase 1 category list + Phase 2 Req-10 extended.
- [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) — Phase 5.2 features.md picker.
- [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) — rewritten per §8.
- [`package.json`](../../../package.json) — docs scripts per §9.
- [`mkdocs.yml`](../../../mkdocs.yml) — retired in commit 5; replaced by two per-package files.
- [`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages) — the GitHub Action that enables multi-site subpath deploys from one repo.
