# Deprecate

Remove a feature, annotation, scenario, or API surface cleanly — with a traceable decision, a `Removed` row in the contract, and no dangling references in examples, tests, or docs.

**Input:** the feature to remove. Pass a requirement ID (e.g. `4.2.6`), an annotation name (e.g. `@federation.delegate.batchSize`), a scenario label, or a file path.

**Output:**
- An ADR in [`spec/internal/decisions/`](../../spec/internal/decisions/) explaining why.
- A `Removed (<reason>)` status in [`spec/reference/requirements.md`](../../spec/reference/requirements.md).
- Cleanup commits deleting or quarantining code, tests, examples, and external docs.

## Phase 1 — Confirm scope

Before touching anything, answer in writing (in the ADR draft or in chat):

1. **Which requirement IDs** does this touch? Pull them from [`spec/reference/requirements.md`](../../spec/reference/requirements.md).
2. **Which code surface?** Annotations, handlers, adapters, scheduler phases, event names? Grep `lib/`, `srv/`, and `package.json`'s `cds.requires` block.
3. **Which docs?** `spec/concepts/**`, `README.md`, `docs/reference/**`, `spec/internal/**`.
4. **Which examples?** `examples/**` CDS, `.http`, and `consumer/srv/**`.
5. **Who depends on it?** External (`README.md`, published npm surface) vs. internal-only. Public API removals need stronger justification in the ADR.

If the answer to "who depends on it?" is "we don't know yet," stop and run `/brainstorm` first.

## Phase 2 — Write the ADR

Use the same template as [`/discuss-architecture`](./discuss-architecture.md#phase-3--document-decision), with this shape:

```markdown
# N. Remove <feature>

**Date:** YYYY-MM-DD
**Status:** Accepted

## Context

What the feature did, which requirement IDs covered it, why we're removing it now.
Reference the original ADR or brainstorm that introduced it, if any.

## Decision

Remove <feature>. Replacement (if any): <link>.
Migration path for existing users: <steps>, or "none — internal only."

## Consequences

- Requirement IDs: 4.X.Y → `Removed (<short reason>)`
- Code deleted: <paths>
- Tests deleted or re-tagged `[N/A — removed, see ADR NNNN]`: <paths>
- Examples updated: <paths>
- `README.md` feature matrix: <line reference>

## References

- Prior ADR that introduced this feature: ADR NNNN
- Requirement IDs: 4.X.Y
- Related ideas: `spec/internal/ideas/<slug>.md` (if any)
```

Commit the ADR on its own: `docs: adr NNNN — remove <feature>`.

## Phase 3 — Update the contract

In [`spec/reference/requirements.md`](../../spec/reference/requirements.md):

1. For each affected row, change `Status` to `Removed (<short reason>)`. Keep the row — don't delete it. History matters.
2. In the `Notes` column, append `See ADR NNNN.`
3. Run `npm run sync:requirements`. The Progress Summary rebuilds; `Removed` rows count as "not counted" (they are neither implemented nor outstanding). [`spec/reference/test-mapping.md`](../../spec/reference/test-mapping.md) regenerates.

## Phase 4 — Clean code and tests

1. Delete the implementation from `lib/**` and `srv/**`. Do not leave "deprecated, do not use" stubs — the ADR is the tombstone.
2. For each test tagged `[4.X.Y]` covering the removed behavior:
   - If the test is *only* about the removed feature → delete the test.
   - If the test is mixed → retag the removed assertions `[N/A — removed, see ADR NNNN]` and keep the rest.
3. Remove any annotation definitions from `lib/annotations.js` (or equivalent) and any type augmentations.

## Phase 5 — Clean user-visible surfaces

1. **`README.md`** — remove rows from the feature matrix and any annotation-reference entries. Do not leave "⚠️ deprecated" — the README describes what the plugin is, not what it was.
2. **`examples/**`** — remove usages from CDS models, `.http` files, and consumer services. If an example app was built solely to demonstrate the removed feature, delete it.
3. **`spec/concepts/**`** — remove the feature description. If it had its own file, delete the file and remove links pointing to it.
4. **`CHANGELOG` / release notes** (if/when adopted) — a `### Removed` entry pointing at the ADR.

## Phase 6 — Verify

1. `rg -n '<feature-name>' -g '!spec/internal/decisions' -g '!spec/reference/requirements.md'` — must be empty (or only hit historical ideas / research notes).
2. `npm test` — all green. No skipped tests whose skip reason isn't `[N/A — removed, see ADR NNNN]`.
3. `npm run sync:requirements` — no diff on a second run.
4. Invoke [`/review`](./review.md) on the commit range to confirm Req-6 (Removed-status hygiene) passes.

## Commit shape

Two or three commits, in order:

1. `docs: adr NNNN — remove <feature>` (Phase 2)
2. `feat!: remove <feature>` (Phase 4 + 5, with `BREAKING CHANGE:` footer if public)
3. `docs: sync progress summary` (Phase 3's script output, if it's a separate diff)

## Non-goals

- This command does not soft-deprecate. We don't have the bandwidth for multi-release deprecation cycles at this stage. If the user wants one, they should run `/discuss-architecture` first to record a staged-removal ADR.
- This command does not rewrite history. The ADR and the `Removed` row are the history.
