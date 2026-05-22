# Clear separation of internal vs. published docs

**Status:** Promoted
**Created:** 2026-04-19
**Promoted to:** [ADR 0002](../decisions/0002-separate-internal-and-published-docs.md) (2026-04-19) — bundle B + D-lite + E, Accepted
**Related:** [`mkdocs.yml`](../../../mkdocs.yml), [`CLAUDE.md`](../../../CLAUDE.md) §Conventions (low-redundancy rule), [`spec/reference/requirements.md`](../../reference/requirements.md), [`docs/reference/comparison.md`](../../reference/comparison.md), [`spec/internal/`](../)

## Trigger

`spec/internal/**` currently lives inside `docs_dir: docs` (see [`mkdocs.yml`](../../../mkdocs.yml) line 7). MkDocs builds those pages even though the `nav:` excludes them — they're reachable on the published site via direct URL (leak). On top of that, the tone in some published pages leans toward benchmark-style comparison that reads as "CAP stops short" or "despite the name, X is really Y" — which belongs in internal analysis, not in a welcoming external site. The goal: a clean split where the published site is tutorial-first and gentle, and internal analysis (ADRs, research, requirements tracker, AI-assistant primer, ideas) is kept out of the published output but still easy to cross-reference from the repo.

## Audience

- **Plugin consumers** reading the mkdocs site — want gentle, focused, tutorial/README character.
- **Plugin contributors + AI assistants** working in the repo — want the full context: research notes, ADRs, requirements status, deprecation logs.
- **Published-site crawlers / search engines** — should only index the external surface.

## Non-goals

- Rewriting content or merging pages. This idea is about **structure + tone rules**, not a content overhaul.
- Changing the `'Calesi'` / scenario terminology or any conventions from [`CLAUDE.md`](../../../CLAUDE.md).
- Removing the cross-reference from external → internal entirely. Some links from the published site into the GitHub repo (not the mkdocs site) are fine; they're link-outs, not in-site nav.
- Touching [`AGENTS.md`](../../../AGENTS.md) or [`.claude/commands/`](../../../.claude/commands/) beyond updating path references.

## Map to existing patterns

- [`CLAUDE.md`](../../../CLAUDE.md) §Conventions already states: *"Docs: low redundancy — a given fact lives in exactly one place … The only allowed exception is internal ↔ external (AI-assistant docs may restate external docs for their audience)."* That's the rule this idea operationalizes.
- No existing requirement in [`spec/reference/requirements.md`](../../reference/requirements.md) covers docs structure itself. Closest neighbors are the "don't let the documentation site drift" rule in [`CLAUDE.md`](../../../CLAUDE.md) §What NOT to do and the "don't let `README.md` drift from requirements" rule.
- No prior ADR in [`spec/internal/decisions/`](../decisions/). [`0001-replication-service-extends-cds-service.md`](../decisions/0001-replication-service-extends-cds-service.md) is the only one and it's unrelated.
- No prior research note. [`spec/internal/research/`](../research/) is feature analysis, not docs structure.
- Current leak surface (internal docs cross-linked from published pages): 4 occurrences in [`docs/reference/comparison.md`](../../reference/comparison.md), 3 in [`spec/reference/requirements.md`](../../reference/requirements.md), 2 in [`spec/internal/ai-assistant-context.md`](../ai-assistant-context.md). Those links must either be rewritten as GitHub URLs or dropped when the split happens.

## Observed issues in the current layout

1. **Published-but-unlinked pages.** `spec/internal/ai-assistant-context.md` (~38 KB), `spec/internal/research/*.md`, `spec/internal/decisions/*.md`, `spec/internal/ideas/*.md`, `spec/internal/plans/completed/*.md` are all emitted by mkdocs build. They don't appear in the nav but are reachable via direct URL and indexed by the site search plugin.
2. **Published pages that read as internal.** [`spec/reference/requirements.md`](../../reference/requirements.md) is 752 lines of status/priority/design tracking — useful for contributors, noisy for consumers. It's currently in the **Reference** nav ("Feature Matrix").
3. **Benchmark-style tone in external pages.** [`docs/reference/comparison.md`](../../reference/comparison.md) has phrasing like *"despite the name, it is architecturally a delegation-side cache"* (Replication Cache) and *"wrong when the boundary logically belongs to the application service"* (HANA SDA). [`docs/index.md`](../../index.md) has *"CAP's Service Integration guide … stops short of giving you a turnkey implementation"* and a *"what CAP does NOT do"* list. Accurate, but reads as adversarial rather than positioning.
4. **Broken relative links if internal moves.** All `../internal/...` refs in published pages need a strategy before the move.

## Options

### Option A — Move `spec/internal/**` out of `docs_dir`

Relocate to a sibling directory (e.g. `internal-docs/` or `.internal-docs/`) at the repo root. MkDocs no longer sees it; the published site is structurally clean.

- **Pros:** Hard guarantee — internal pages cannot leak to the site. Clear mental model for contributors (two trees, two audiences). Git history preserved via `git mv`.
- **Cons:** All cross-links from published docs into internal must be rewritten as GitHub blob URLs (they'd no longer be relative paths mkdocs can resolve). Breaks a lot of the current [`ai-assistant-context.md`](../ai-assistant-context.md) and [`CLAUDE.md`](../../../CLAUDE.md) link grid, which assumes `spec/internal/...` paths.

### Option B — Keep location, exclude from build

Keep `spec/internal/**` where it is, use `exclude_docs:` (mkdocs ≥ 1.6) or an `awesome-pages` hide pattern to prevent build output.

- **Pros:** Minimal churn. All existing relative links in internal docs keep working (they resolve on GitHub). Easy to revert.
- **Cons:** Still looks like "one docs tree" to a new contributor — the separation lives only in `mkdocs.yml`, easy to forget. Published pages linking into `spec/internal/...` still break on the site (404) because the targets aren't built. That link-style inconsistency is a subtler leak than option A.

### Option C — Hybrid: external under `docs/`, internal under `docs-internal/`; enforce one-directional linking

Move internal to a sibling folder **and** establish a rule: published docs never link into internal; internal docs link into published with relative `../docs/...` paths that resolve both on GitHub and are valid.

- **Pros:** Strong structural signal (two folders, two audiences). Unidirectional link rule is easy to lint (`grep internal/ docs/` should be empty). Survives mkdocs version upgrades better than config-based excludes.
- **Cons:** Same cost as A for rewriting existing external→internal links. Plus an explicit lint/CI check needs to be introduced (or trusted to reviewers).

### Option D — Move `requirements.md` to internal, keep rest of internal hidden via exclude

A narrower first step that addresses only the biggest leak: [`requirements.md`](../../reference/requirements.md) belongs to contributors, not consumers. Move it to `spec/internal/requirements.md` (or to the new internal tree if A/C is adopted). Replace the Reference → Feature Matrix nav entry with a smaller consumer-facing "Feature overview" page summarizing what's implemented, without the status/priority/design columns.

- **Pros:** Removes the largest single source of internal-flavored content from the public nav. Forces a consumer-facing summary page — which is the right thing to have anyway.
- **Cons:** Doesn't solve the underlying layout issue; internal pages still live inside `docs_dir` unless combined with A/B/C.

### Option E — Tone style guide for external docs (independent of layout)

Regardless of layout choice, codify a short style guide (~1 page) for external pages. Pinned in [`spec/internal/`](../) or `.cursor/rules/`. Rules like:

- **Tutorial / README voice.** Explain what the plugin does, not what it replaces. Avoid "X does not do Y" framings.
- **No adversarial library comparisons on the published site.** If a comparison is needed, describe when each tool is the right fit ("pick when …") rather than where another tool is wrong. Detailed head-to-head analyses belong in [`spec/internal/research/`](../research/).
- **No status/priority/roadmap columns on the published site.** Those are contributor concerns.
- **Link out with context.** When pointing at CAP docs or SAP samples, describe what the reader gains there, not what's missing.
- **No terms like "manual", "boilerplate", "hand-written" as rhetorical contrast.** Describe the plugin's approach on its own terms.

Applied retroactively:
- [`docs/index.md`](../../index.md) "Why this plugin" section loses the "stops short" / "CAP does NOT do" framing; becomes "What this plugin adds on top of CAP's building blocks".
- [`docs/reference/comparison.md`](../../reference/comparison.md) keeps the capability matrices (facts, not tone) but moves the prose notes on Replication Cache, SDA, etc., into [`spec/internal/research/`](../research/) and links out.

- **Pros:** Fixes the perceived tone regardless of where files live. Low-effort, high-visibility.
- **Cons:** Style guides only work if enforced during review. Needs to land in [`.claude/commands/review.md`](../../../.claude/commands/review.md) or equivalent.

### Option F — Separate tools for separate jobs (no mkdocs change, keep internal as markdown-in-repo)

Treat internal docs as repo-only markdown (GitHub renders it), published docs as mkdocs-only. Rename `docs/` to clarify: `site/` (published) + `internal/` (repo-only). This is effectively Option A with renaming for clarity.

- **Pros:** Maximum clarity for new contributors (folder names say what they are). Aligns with how many OSS projects split `site/` and `docs/`.
- **Cons:** Large churn (rename changes every relative path + `docs_dir` in mkdocs config + [`CLAUDE.md`](../../../CLAUDE.md) link grid + [`AGENTS.md`](../../../AGENTS.md) + all `.claude/commands/*.md` path references). Might be more disruption than the problem warrants.

## Interactions

Options aren't all exclusive:

- **E (tone guide) is orthogonal** and worth doing regardless of the layout choice.
- **D (move `requirements.md`)** is independent too and could ship first as a small win.
- **A vs. B vs. C vs. F** are mutually exclusive structural choices.

A reasonable bundle for `/discuss-architecture` to evaluate: **E + D + one of {A, C}**.

## Open questions

1. Does the published site need to reference the requirements tracker at all? If yes, a summary page is needed. If no, drop the nav entry entirely and keep the tracker internal.
2. Should [`docs/reference/comparison.md`](../../reference/comparison.md) stay on the site? It provides positioning that consumers do want. If it stays, how much of its prose moves to internal research? (Likely: matrices stay, opinion paragraphs move.)
3. Does the [`.claude/commands/review.md`](../../../.claude/commands/review.md) workflow need a "tone check" phase for files under `docs/` (excluding `spec/internal/`)? Same for [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.
4. What about [`examples/`](../../../examples/)? The READMEs there (`examples/README.md`, `examples/sales-intel/README.md`, `examples/sales-intel/workbench/README.md`) are consumer-facing but not published via mkdocs. Style guide applies? Probably yes, since they're the first thing a consumer sees in the repo.
5. Should [`spec/internal/ai-assistant-context.md`](../ai-assistant-context.md) be renamed to make its audience obvious (e.g. `CONTRIBUTING-deep-dive.md`, `ARCHITECTURE.md`)? Related but arguably a separate idea.
6. Is a pre-commit or CI lint worth it? Cheap version: `grep -rE 'spec/internal/|\.\./internal/' docs/ --include='*.md' | grep -v 'spec/internal/'` should be empty once the split lands.
