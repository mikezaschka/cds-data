# Plan: separate internal analysis from the published docs (ADR 0002)

**ADR:** [0002-separate-internal-and-published-docs](../../decisions/0002-separate-internal-and-published-docs.md)
**Requirement ID:** none — docs infrastructure, not a row in `spec/reference/requirements.md`
**Priority:** n/a
**Status:** Completed
**Created:** 2026-04-19
**Completed:** 2026-04-19
**Status source:** this plan doc

## Overview

Operationalize ADR 0002. Three concrete outcomes:

1. The published MkDocs site stops emitting `spec/internal/**`, `spec/reference/requirements.md`, and `spec/reference/test-mapping.md` (via `exclude_docs:`).
2. The public `Reference` nav swaps the contributor-facing feature tracker for a slim consumer-facing `docs/reference/features.md`.
3. An external-docs style guide (rules R1–R4) is codified, referenced from `.cursor/rules/`, and enforced by a new `Req-10` in `/review`.

The prose retone of `docs/index.md` and `docs/reference/comparison.md` (ADR §5 + R1/R2/R4) ships in a **separate** `docs:` commit per the user's Phase 4 answer, **except** for the 3 now-broken `../internal/research/...` links in `comparison.md` — those must be rewritten as absolute GitHub URLs in Commit 1, because [`.github/workflows/docs.yml`](../../../../.github/workflows/docs.yml) runs `mkdocs build --strict` and would fail on dangling links into excluded files.

## Amendment to ADR 0002

ADR follow-up item #9 ("Consider `mkdocs build --strict` in CI") is already implemented — `.github/workflows/docs.yml` step `Build docs` runs `mkdocs build --strict`. The ADR will be amended to mark item #9 as "already in place" rather than "deferred" during Commit 1.

## Affected files

| File | Change | Commit |
|---|---|---|
| `mkdocs.yml` | Add `exclude_docs:` block (§1). Replace `Feature Matrix: reference/requirements.md` with `Features: reference/features.md` in nav. | 1 |
| `docs-requirements.txt` | Add explicit `mkdocs>=1.6` floor (required for `exclude_docs`). | 1 |
| `docs/reference/features.md` | New. Slim consumer-facing capability overview — Implemented features only, grouped by strategy + adapters + scenarios. Canonical scenario names per [`spec/concepts/cross-service-scenarios.md`](../../../concepts/cross-service-scenarios.md). No `Priority`/`Phase`/`Status`/`Requirement ID` columns. Footer links to `spec/reference/requirements.md` on GitHub for contributors. | 1 |
| `docs/reference/comparison.md` | **Link-only rewrite** of the 3 `../internal/research/...` references at lines 24, 47, 110 → absolute GitHub URLs. No prose changes. | 1 |
| `spec/internal/docs-style-guide.md` | New. Rules R1–R4 and scope paragraph (scope includes `examples/**/README.md`). | 1 |
| `.cursor/rules/docs-style.mdc` | New. Thin pointer to `spec/internal/docs-style-guide.md`, following the header style of [`.cursor/rules/project.mdc`](../../../../.cursor/rules/project.mdc). | 1 |
| `AGENTS.md` | Add one line in §Conventions: "External docs tone: see [`spec/internal/docs-style-guide.md`](./spec/internal/docs-style-guide.md)." | 1 |
| `.claude/commands/review.md` | Add `Req-10 External docs tone` to Phase 2 with the grep command. | 1 |
| `.claude/commands/implement-feature.md` | Add Phase 5 substep: when moving a requirement row to `Implemented`, also update `docs/reference/features.md` if the feature is consumer-visible. | 1 |
| `spec/internal/decisions/0002-separate-internal-and-published-docs.md` | Amend follow-up item #9 ("already in place"). | 1 |
| `spec/internal/plans/separate-internal-and-published-docs.md` | This plan itself. Moves to `completed/` at end of Phase 5. | 1 |
| `docs/index.md` | Retone §"Why this plugin" per R1/R4. | 2 |
| `docs/reference/comparison.md` | Retone HANA/SDA note (line 43) and Replication Cache note (line 47) per R2 — keep capability matrices unchanged. | 2 |

## Tasks

### Task 1 — Amend ADR 0002 (follow-up #9)

- [x] Update the "Follow-up work" section of [`spec/internal/decisions/0002-separate-internal-and-published-docs.md`](../../decisions/0002-separate-internal-and-published-docs.md) to note that strict-mode CI is already in place.
- [x] Update §5 to note that the link rewrites move into the config commit (not the retone commit) because of strict mode.

### Task 2 — MkDocs config + version floor

- [x] Add `exclude_docs:` block to `mkdocs.yml`:
      ```yaml
      exclude_docs: |
        internal/
        reference/requirements.md
        reference/test-mapping.md
      ```
- [x] Replace `- Feature Matrix: reference/requirements.md` with `- Features: reference/features.md` under `Reference:`.
- [x] Add `mkdocs>=1.6` to `docs-requirements.txt`.

### Task 3 — New `docs/reference/features.md`

- [x] Draft a consumer-facing capability overview grouped by:
      - Delegate (query translation, filter rewrite, navigation filters, CUD opt-in, …)
      - Replicate (schedule, delta modes, UPSERT, retry, concurrency guard, pipeline events, …)
      - Caching (response-level, tag invalidation)
      - Adapters (OData V4, OData V2, REST, HCQL — Implemented only)
      - Cross-service scenarios (Delegated expand, Cross-service expand: local → remote, remote → local, cross-provider; Cross-service navigation: local → remote, remote → local) — using canonical names per [`CLAUDE.md`](../../../../CLAUDE.md) §Terminology.
      - Management service (Implemented endpoints only)
- [x] Source of truth for "what to list": rows with `Status: Implemented` in `spec/reference/requirements.md`. Progress summary (line 188) currently reports 64 / 96 Implemented.
- [x] Footer: "For the full feature tracker including planned work, priorities, and design notes, see [`spec/reference/requirements.md`](https://github.com/mikezaschka/cds-data-federation/blob/main/spec/reference/requirements.md) on GitHub."

### Task 4 — Rewrite broken links in `comparison.md`

- [x] Line 24: `[CAP Built-in Analysis](../internal/research/cap-builtin-analysis.md)` → `[CAP Built-in Analysis](https://github.com/mikezaschka/cds-data-federation/blob/main/spec/internal/research/cap-builtin-analysis.md)`.
- [x] Line 47: `[Replication Cache Analysis](../internal/research/replication-cache-analysis.md)` → absolute GitHub URL. Same form.
- [x] Line 110: both links in the footer paragraph → absolute GitHub URLs.
- [x] Verify no other `../internal/` or `spec/internal/` references remain anywhere in `docs/` except under `spec/internal/` itself:
      ```
      grep -rn -E '\.\./internal/|spec/internal/' docs/ --include='*.md' | grep -v '^spec/internal/'
      ```
      Must be empty.

### Task 5 — Style guide (canonical markdown)

- [x] Create `spec/internal/docs-style-guide.md` with:
      - Front matter: Purpose, Scope.
      - Scope: `docs/` (excluding `spec/internal/`), `README.md`, and `examples/**/README.md`. Note the pending examples-repo extraction so readers understand why examples are in scope.
      - Rule R1 — Tutorial voice in published pages.
      - Rule R2 — No adversarial library comparisons on the published site.
      - Rule R3 — No status / priority / roadmap / phase content on the published site.
      - Rule R4 — No rhetorical-contrast vocabulary. Include the explicit red-flag word list (`stops short`, `hand-written`, `boilerplate`, `does not do`, `despite the name`, `what … does NOT`).
      - Enforcement: reference `Req-10` in [`.claude/commands/review.md`](../../../../.claude/commands/review.md) Phase 2.

### Task 6 — Style guide (Cursor pointer)

- [x] Create `.cursor/rules/docs-style.mdc` following the header style of [`.cursor/rules/project.mdc`](../../../../.cursor/rules/project.mdc):
      - `alwaysApply: false` — loaded on demand via the globs.
      - `globs: ["docs/**/*.md", "README.md", "examples/**/README.md"]` — excluding `spec/internal/**` via rule prose (Cursor globs don't support negation cleanly; the prose scope is authoritative).
      - Two sentences of content + link to `spec/internal/docs-style-guide.md`.

### Task 7 — Entry-point pointer in `AGENTS.md`

- [x] Add one line to §Conventions: "External docs tone: see [`spec/internal/docs-style-guide.md`](./spec/internal/docs-style-guide.md). Scope and rules are enforced by `Req-10` in `/review`."

### Task 8 — Review workflow check

- [x] Add `Req-10 External docs tone` to [`.claude/commands/review.md`](../../../../.claude/commands/review.md) Phase 2 with:
      - The rule summary (one-liner per R1–R4).
      - The grep command and expected empty output.
      - Explicit scope: `docs/` (excluding `spec/internal/`), `README.md`, `examples/**/README.md`.

### Task 9 — Implement-feature hook for `features.md`

- [x] Add a substep to [`.claude/commands/implement-feature.md`](../../../../.claude/commands/implement-feature.md) Phase 5.1 (or 5.2):
      "If the feature is consumer-visible, also update `docs/reference/features.md`. Treat `features.md` as the consumer-facing subset of `requirements.md`: add a one-line row under the right group, no priority/phase columns."

### Task 10 — Verify Commit 1

- [x] Local strict build (if mkdocs venv available): `npm run docs:build`. Expect no warnings for missing links.
- [x] CI strict build passes on push.
- [x] Req-10 grep against published surface: still-to-be-done prose retones are expected to fail (that's Commit 2's job). For Commit 1, just confirm that no *new* red-flag phrases have been introduced.
- [x] Internal-link leak check (from Task 4, repeated): empty.

### Task 11 — Commit 2: retone (separate commit, later)

- [x] Rewrite `docs/index.md` §"Why this plugin" (now "What this plugin adds"): drop "stops short" / "what CAP does NOT do" framing; describe what the plugin adds on its own terms.
- [x] Retone `docs/reference/comparison.md`: renamed the `CAP (manual)` heading and table columns to `CAP reference samples`, dropped the "despite the name" framing on the Replication Cache, softened the HANA/SDA closing line to positive-framing.
- [x] Retone `README.md` §§55–76 and §§70–76 ("How it compares"): same vocabulary removals.
- [x] Retone `docs/getting-started/extending-remote-with-local.md:64` ("unlike naive hand-written handlers" → straight capability statement).
- [x] Run the Req-10 primary grep on the published surface → empty. Near-synonym grep (`manual pattern|manual handler|hand-coded|…`) on the published surface → empty; remaining hits live only in `spec/reference/requirements.md`, which is `exclude_docs:`-excluded from the site and out of Req-10 scope per ADR 0002.

## Test strategy

No Jest tests. Verification surfaces:

1. **Mechanical:** `npm run docs:build` (strict) passes both locally (if venv present) and in CI.
2. **Mechanical:** the two greps in Tasks 4 and 10 return empty.
3. **Visual:** inspect the built `site/` tree (or the live Pages deployment) to confirm `internal/`, `reference/requirements/`, and `reference/test-mapping/` are absent from the site and from site search results.
4. **Structural:** the new `docs/reference/features.md` lists only features with `Status: Implemented` in `requirements.md`. Sanity check against the Progress Summary (line 188): 64 Implemented today.

## Validation commands

```bash
# MkDocs strict build (local, requires venv)
npm run docs:build

# Leak checks
grep -rn -E '\.\./internal/|spec/internal/' docs/ --include='*.md' | grep -v '^spec/internal/'
grep -rnE 'stops short|hand-written|boilerplate|does not do|despite the name|what .* does NOT' \
  docs/ README.md examples/ --include='*.md' --exclude-dir=internal

# Jest + lint (sanity only — nothing runtime-touching should change)
npx jest --runInBand --forceExit --roots test/
npm run lint
```

## Out of scope (per ADR 0002)

- Moving or renaming any file under `spec/internal/**`.
- Moving `spec/reference/requirements.md` to `spec/internal/`.
- Renaming `spec/internal/ai-assistant-context.md`.
- Rewriting the `CLAUDE.md` low-redundancy rule.
