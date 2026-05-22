# 2. Separate internal analysis from the published docs via `exclude_docs` and a tone style guide

**Date:** 2026-04-19
**Status:** Accepted (§1 superseded by [ADR 0006](./0006-per-plugin-published-surface.md))

> **§1 superseded by [ADR 0006](./0006-per-plugin-published-surface.md)** (2026-04-19). The root `mkdocs.yml` + `exclude_docs:` block is retired; each plugin (`cds-data-pipeline`, `cds-data-federation`) now has its own `packages/*/mkdocs.yml` and `packages/*/docs/` tree, deployed as subpaths on the same GitHub Pages site. §2 (features.md), §3 (tone style guide R1–R4, now extended by R5), §4 (Req-10 enforcement), and §5 (absolute-URL link rewrite for `spec/internal/research/*` references) remain in force.

## Context

`docs/` currently serves two audiences from one tree:

- **Plugin consumers** via the [MkDocs Material site](https://mikezaschka.github.io/cds-data-federation/) built from `mkdocs.yml`.
- **Plugin contributors + AI assistants** via GitHub-rendered markdown, following the link grid in [`CLAUDE.md`](../../../CLAUDE.md) → `spec/internal/ai-assistant-context.md`, research notes, ADRs, ideas, and the requirements tracker.

Two concrete problems motivated this decision:

1. **Published-but-unlinked leakage.** `docs_dir: docs` in [`mkdocs.yml`](../../../mkdocs.yml) makes MkDocs build every markdown file under `docs/` — including `spec/internal/**` (≈38 KB `ai-assistant-context.md`, research, decisions, ideas, completed plans). These pages don't appear in the `nav:` sidebar but they are emitted to the site, reachable by direct URL, and indexed by the `search` plugin. From the reader's perspective this is a leak; from the maintainer's perspective it means the "internal ↔ external duplication exception" in [`CLAUDE.md`](../../../CLAUDE.md) §Conventions has no structural enforcement.
2. **Adversarial tone on public pages.** `docs/index.md` frames the plugin as what "CAP does NOT do" and says the CAP guide *"stops short of giving you a turnkey implementation"*. `docs/reference/comparison.md` contains inline opinion paragraphs like *"despite the name, the Replication Cache is architecturally a delegation-side cache"* and *"HANA SDA is wrong when the integration boundary logically belongs to the application service"*. The analyses are accurate, but the voice belongs in internal research, not on a library's welcome page. The comparison matrices themselves (facts, not tone) are fine to keep.

The origin of this ADR is [`spec/internal/ideas/docs-internal-external-separation.md`](../ideas/docs-internal-external-separation.md), which enumerates six options (A–F) ranging from single-line mkdocs config changes to full folder renames.

### Constraints that shaped the discussion

- **Low-redundancy rule in [`CLAUDE.md`](../../../CLAUDE.md) §Conventions** already sanctions the internal ↔ external duplication exception. This ADR operationalizes it; it does not introduce new policy.
- **Workflow docs path-bind to current locations.** [`.claude/commands/review.md`](../../../.claude/commands/review.md) Phase 1 categorizes `spec/internal/**` and `spec/reference/requirements.md`. [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.1 updates `spec/reference/requirements.md` and runs `npm run sync:requirements`. [`AGENTS.md`](../../../AGENTS.md:7-10) entry-point list links to `spec/reference/requirements.md` and `spec/internal/ai-assistant-context.md` at their current paths. Any file move propagates into every workflow doc plus [`CLAUDE.md`](../../../CLAUDE.md)'s "Where to find things" table and `spec/internal/ai-assistant-context.md`'s own link grid (~7 files).
- **Actual leakage surface is small and localized.** Grep confirms only 3 external → internal links in [`docs/reference/comparison.md`](../../reference/comparison.md) (lines 24, 47, 110) and 3 in [`spec/reference/requirements.md`](../../reference/requirements.md) (lines 722, 723, 729). The other published pages — `docs/index.md`, `spec/concepts/**`, `docs/integration/**`, `docs/getting-started/**` — have no internal references at all.
- **MkDocs ≥ 1.6 provides native [`exclude_docs:`](https://www.mkdocs.org/user-guide/configuration/#exclude_docs)** with gitignore-style patterns. Excluded files are dropped before the search index is built, so they stop leaking via site search as well.
- **`examples/` will move to a separate repository.** For now, `examples/**/README.md` is consumer-facing and must adopt the same published style.

### Options considered

| Option | Structural separation | Path churn in repo | Verdict |
|---|---|---|---|
| A — move `spec/internal/**` outside `docs_dir` | Strong (folder boundary) | High: [`CLAUDE.md`](../../../CLAUDE.md) link grid, [`AGENTS.md`](../../../AGENTS.md), `spec/internal/ai-assistant-context.md`, all `.claude/commands/*.md`, `.cursor/rules/project.mdc` — ~7 files | Rejected: buys strong separation at the cost of breaking grep-based workflows that encode `spec/internal/` and `spec/reference/requirements.md` as hard paths |
| B — keep location, `exclude_docs:` in `mkdocs.yml` | Medium (config-level) | Zero | **Selected** |
| C — A + one-directional lint | Very strong | Same as A plus CI lint | Rejected: same cost as A |
| D — move `requirements.md` to internal | Partial | Medium (rename ripples into workflow docs) | Superseded by D-lite (below) |
| E — tone style guide | Orthogonal | Zero | **Selected** (augments B) |
| F — rename both trees (`site/` + `internal/`) | Strongest | Very high: every relative path in every doc, `docs_dir`, `edit_uri` | Rejected: more disruption than the problem warrants |

The core insight: internal pages ship to the site because **MkDocs builds everything under `docs_dir` by default**, not because the folder layout is wrong. Fix the tool, not the filesystem.

## Decision

Adopt the bundle **B + D-lite + E**.

### 1. Exclude internal analysis from the MkDocs build

Add to [`mkdocs.yml`](../../../mkdocs.yml):

```yaml
exclude_docs: |
  internal/
  reference/requirements.md
  reference/test-mapping.md
```

- `internal/` stops building every file under `spec/internal/**` (ADRs, research, ideas, completed plans, `ai-assistant-context.md`).
- `reference/requirements.md` and `reference/test-mapping.md` are contributor trackers with status / priority / phase columns and auto-generated test ↔ requirement mappings. They stay at their current paths so the workflow docs keep working, but they stop reaching the published site.

Files stay put — no `git mv`, no path updates in [`CLAUDE.md`](../../../CLAUDE.md), [`AGENTS.md`](../../../AGENTS.md), [`.claude/commands/*.md`](../../../.claude/commands/), or `spec/internal/ai-assistant-context.md`. The `edit_uri: edit/main/docs/` line in `mkdocs.yml` is unaffected.

### 2. Drop `reference/requirements.md` from the published nav; publish a slim consumer-facing `reference/features.md`

Remove `Feature Matrix: reference/requirements.md` from the `Reference:` section of [`mkdocs.yml`](../../../mkdocs.yml) `nav:`. Replace with **`Features: reference/features.md`** — a new, slim, consumer-facing page that:

- Lists **only `Implemented` features** in a single capability grid, grouped by strategy (delegate, replicate, cache) + adapters + cross-service scenarios.
- Uses canonical scenario names per [`CLAUDE.md`](../../../CLAUDE.md) §Terminology and [`spec/concepts/cross-service-scenarios.md`](../../concepts/cross-service-scenarios.md).
- Has **no** `Priority`, `Phase`, `Status`, `Requirement ID` columns.
- Ends with one sentence linking to the full tracker on GitHub for contributors: *"Tracker with planned features, priorities, and design notes: `spec/reference/requirements.md` on GitHub"* (absolute URL).

The 752-line [`spec/reference/requirements.md`](../../reference/requirements.md) itself stays at its current path unchanged — it remains the source of truth for the `[<id>]` test tagging, the `npm run sync:requirements` output, and the `/implement-feature` Phase 5.1 update target.

### 3. Codify an external-docs style guide in two places

**Canonical markdown:** `spec/internal/docs-style-guide.md` (created as follow-up). Tool-agnostic. The following four rules:

- **R1. Tutorial voice in published pages.** Explain what the plugin does on its own terms. Avoid "X does not do Y" framings.
- **R2. No adversarial library comparisons on the published site.** Positioning uses *"pick X when …"*, not *"X is wrong when …"*. Opinion paragraphs live in `spec/internal/research/`. Capability matrices (facts) stay on the site.
- **R3. No status / priority / roadmap / phase content on the published site.** Those are contributor concerns and belong in `spec/reference/requirements.md`.
- **R4. No rhetorical-contrast vocabulary on published pages.** Words like *manual*, *hand-written*, *boilerplate*, *stops short*, *despite the name*, *what CAP does NOT* are red flags in `docs/`, `README.md`, and `examples/**/README.md`. Describe the plugin positively, not by contrast.

**Scope of the guide:** `docs/` (excluding `spec/internal/`), `README.md`, and `examples/**/README.md`. The `examples/` scope applies even though MkDocs doesn't build it — it is consumer-facing and will move to a separate repository later; consistent voice now simplifies that move.

**Thin pointer rule file:** `.cursor/rules/docs-style.mdc` (created as follow-up). Auto-loaded by Cursor. Content: two sentences summarizing the scope + link to the canonical markdown. [`AGENTS.md`](../../../AGENTS.md) gains a one-line reference in the Conventions section so Claude Code / Codex / Aider pick it up via the cross-tool entry point.

### 4. Enforce via the review workflow

Add `Req-10 External docs tone` to [`.claude/commands/review.md`](../../../.claude/commands/review.md) Phase 2. Cheap grep-lint:

```
grep -rnE 'stops short|hand-written|boilerplate|does not do|despite the name|what .* does NOT' \
  docs/ README.md examples/ \
  --include='*.md' --exclude-dir=internal
```

Expected to return nothing. Any hit is a `FAIL` with a suggested rephrasing.

### 5. Fix the 3 leaking external → internal links in `comparison.md`

> **Amended 2026-04-19:** the link rewrite must ship in the **same commit** as §1 (`exclude_docs:`), not in the retone commit. [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) already runs `mkdocs build --strict`, so a commit that excludes the targets without rewriting the links would fail CI. Prose retone of the surrounding paragraphs can still be deferred to a later `docs:` commit.

Lines 24, 47, and 110 of [`docs/reference/comparison.md`](../../reference/comparison.md) each link into `spec/internal/research/`. MkDocs will emit warnings for these once the targets are excluded. Two permitted treatments:

- **Genuine cross-reference** → rewrite as absolute GitHub URL (`https://github.com/mikezaschka/cds-data-federation/blob/main/spec/internal/research/<file>.md`). MkDocs emits as a plain external link.
- **Opinion paragraph inline today** → delete the opinion, keep the matrix row, add a small footnote *"Detailed analysis: \<GitHub URL\>"*.

## Consequences

### What this enables

- **Published site stops leaking internal analysis.** `spec/internal/**`, the full requirements tracker, and the test-mapping file are no longer built into the site or indexed by site search.
- **Consumers see a tutorial-shaped surface.** Getting Started → Concepts → Reference (Annotations, Management Service, Comparison, Features) → Integration. No 752-line feature tracker in the nav.
- **Workflow docs keep working unchanged.** [`AGENTS.md`](../../../AGENTS.md), [`CLAUDE.md`](../../../CLAUDE.md), `spec/internal/ai-assistant-context.md`, and every file in [`.claude/commands/`](../../../.claude/commands/) still reference `spec/internal/` and `spec/reference/requirements.md` at their current paths.
- **Style guide is enforceable.** R4 is grep-checkable; Req-10 in [`.claude/commands/review.md`](../../../.claude/commands/review.md) runs it. R1–R3 are reviewer-judgment but the rules are explicit and co-located with the other review invariants.
- **Future `examples/` extraction is cheaper.** When examples move to a separate repository, they already follow the published-docs voice — no retone project required at extraction time.

### What we accept as trade-offs

- **Separation lives in one config line**, not a folder boundary. A hand-edit of `mkdocs.yml` that deletes the `exclude_docs:` block re-leaks the internal tree. Mitigation: `mkdocs build --strict` in CI (future work — see follow-up) would flag broken links into excluded files, and Req-10 would catch tone regressions.
- **Style-guide enforcement is prose for R1–R3.** Only R4 is grep-able. The project already relies on reviewer judgment for other cross-document invariants (scenario naming, low-redundancy rule, don't-bypass-withRetry), so this is consistent with house style rather than novel.
- **`reference/features.md` is net-new content that must be maintained.** It duplicates (selectively) what `requirements.md` tracks. This is the one acceptable instance of the internal ↔ external duplication exception from [`CLAUDE.md`](../../../CLAUDE.md) §Conventions. When a row moves to `Implemented`, `features.md` must be updated — that hook belongs in [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5.
- **Retone of `docs/index.md` and `docs/reference/comparison.md` is deferred** to a separate `docs:` commit. The ADR sets the rules; the retone is a separate, reviewable unit.

### Follow-up work

Tracked as checklist items, not ADR content:

1. Edit [`mkdocs.yml`](../../../mkdocs.yml): add `exclude_docs:` block (§1); replace `Feature Matrix: reference/requirements.md` nav entry with `Features: reference/features.md` (§2).
2. Create `docs/reference/features.md` per §2.
3. Create `spec/internal/docs-style-guide.md` per §3 with R1–R4 and scope paragraph.
4. Create `.cursor/rules/docs-style.mdc` — thin pointer to the canonical markdown.
5. Add one line to [`AGENTS.md`](../../../AGENTS.md) §Conventions: *"External docs tone: see `spec/internal/docs-style-guide.md`."*
6. Add `Req-10 External docs tone` to [`.claude/commands/review.md`](../../../.claude/commands/review.md) Phase 2 per §4.
7. Add a Phase 5 substep to [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md): when moving a row to `Implemented`, also update `docs/reference/features.md` if the feature is consumer-visible.
8. Separate `docs:` retone commit — rewrite `docs/index.md` §"Why this plugin" and `docs/reference/comparison.md` lines 24, 43, 47, 110 per R1/R2/R4 + §5 link handling. Run the Req-10 grep; it should return nothing.
9. ~~Consider `mkdocs build --strict` in CI to catch future links-into-excluded-files (deferred — separate decision).~~ **Already in place** — [`.github/workflows/docs.yml`](../../../.github/workflows/docs.yml) already runs `mkdocs build --strict`. Discovered 2026-04-19 during ADR implementation. No action required.

### What this decision does not do

- Does not move or rename any file in `spec/internal/**`.
- Does not move `spec/reference/requirements.md` — it stays as the contributor-facing tracker.
- Does not rename `spec/internal/ai-assistant-context.md`. If that name becomes a source of friction, a follow-up idea captures the rename separately.
- Does not change the [`CLAUDE.md`](../../../CLAUDE.md) low-redundancy rule. The style guide is its published-side operationalization.

## References

- [`spec/internal/ideas/docs-internal-external-separation.md`](../ideas/docs-internal-external-separation.md) — the originating idea, options A–F
- [`mkdocs.yml`](../../../mkdocs.yml) — `docs_dir`, `nav`, target of the `exclude_docs` change
- [`CLAUDE.md`](../../../CLAUDE.md) §Conventions (low-redundancy rule) and §Don'ts (docs drift rules) — the policy this ADR operationalizes
- [`AGENTS.md`](../../../AGENTS.md) — entry-point link grid, gets one line added
- [`.claude/commands/review.md`](../../../.claude/commands/review.md) — adds Req-10
- [`.claude/commands/implement-feature.md`](../../../.claude/commands/implement-feature.md) Phase 5 — gets a features.md update hook
- [`spec/reference/requirements.md`](../../reference/requirements.md), [`docs/reference/comparison.md`](../../reference/comparison.md), [`spec/reference/test-mapping.md`](../../reference/test-mapping.md), [`docs/index.md`](../../index.md) — files directly affected by the decision
- [MkDocs `exclude_docs` documentation](https://www.mkdocs.org/user-guide/configuration/#exclude_docs) — upstream feature reference (MkDocs ≥ 1.6)
- [ADR 0001](./0001-replication-service-extends-cds-service.md) — precedent for ADR structure (context / options-considered / decision / consequences / references)
