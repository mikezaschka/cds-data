# Discuss Architecture

Interactive architecture discussion grounded in this project's patterns and trade-offs. Produces a written Architecture Decision Record (ADR) capturing the reasoning and outcome.

**Input:** A question, scenario, or design problem.

Examples:
- "Should entity X use delegate or replicate?"
- "How should we handle cross-service joins for analytics?"
- "What's the right caching strategy for frequently updated reference data?"
- "Why does Scenario B expand work this way? Should we change the approach?"

---

## Phase 1 -- Gather Context

Read the relevant project sources to ground the discussion in actual architecture, not generic advice:

1. **`CLAUDE.md`** — slim primer pointing to the canonical sources below.
2. **`spec/internal/ai-assistant-context.md`** — deep architecture overview, plugin lifecycle, CDS quirks.
3. **`spec/concepts/*.md`** — detailed design docs:
   - `cross-service-scenarios.md` — the canonical reference for expand + navigation scenarios and what CAP provides OOTB vs. what the plugin adds
   - `service-query-execution.md` — how CAP routes queries through services vs. DB
   - `terminology.md` — federation / delegation / replication definitions, including the `'Calesi'` pattern definition
   - `consumption-views.md` — the consumption view contract
4. **`spec/internal/research/*.md`** — prior analysis that may inform the discussion:
   - `cap-builtin-analysis.md` — what CAP provides natively vs. what the plugin adds
   - `replication-cache-analysis.md` — entity-level vs. response-level caching trade-offs
   - `change-tracking-analysis.md` — whether `@cap-js/change-tracking` complements the plugin
5. **`spec/reference/requirements.md`** — specifically these sections:
   - Section 2: Key Use Cases — when to use delegate vs. replicate vs. cache
   - Section 2: Strategy trade-offs table (delegate vs. replicate capabilities)
   - Section 4: Query Capability Matrix (what works in each scenario)
   - Section 4: Consumption View Pattern Matrix
   - Progress Summary — what's implemented vs. not started
6. **`spec/internal/decisions/`** — existing ADRs, to avoid contradicting prior decisions.
7. **Source files** — if the discussion touches specific modules, read the relevant code in `srv/delegation/` or `srv/adapters/`.

Summarize the relevant context you found before proceeding to discussion.

## Phase 2 -- Analyze & Discuss

This is an interactive phase. Work through the problem with the user:

1. **Map the scenario** to the project's existing patterns. Which strategy, scenario, or convention applies?
2. **Reference specific sources** — cite file paths, section numbers, and relevant quotes from the docs read in Phase 1. Don't give generic advice.
3. **Consider constraints:**
   - CAP platform limitations (CQL on OData, projection chain behavior, `@cds.persistence.skip`)
   - OData protocol limitations (no DISTINCT, no $apply on remote, no flatten)
   - Current implementation status (what's built vs. what's planned in REQUIREMENTS.md)
4. **Present options** with concrete pros/cons grounded in project context. Use tables when comparing approaches.
5. **Ask clarifying questions** if the scenario is ambiguous — don't assume.
6. **Arrive at a recommendation.** Be opinionated — the user wants a grounded recommendation, not a menu of options without guidance.

## Phase 3 -- Document Decision

Once the user agrees on an approach, write an Architecture Decision Record.

1. **Determine the next ADR number:** List existing files in `spec/internal/decisions/` and increment.
2. **Write the ADR** to `spec/internal/decisions/NNNN-<slug>.md`:

```markdown
# N. Title

**Date:** YYYY-MM-DD
**Status:** Accepted

## Context

What is the issue or question? What forces are at play?
Reference the user's original scenario and the project constraints that shaped the discussion.

## Decision

What was decided and why.
Reference specific project docs, trade-off tables, requirement IDs, or source files.

## Consequences

- What this enables or simplifies.
- What trade-offs were accepted.
- What follow-up work is needed (reference requirement IDs if applicable).

## References

- [spec/reference/requirements.md](../../reference/requirements.md) — relevant sections
- [spec/concepts/cross-service-scenarios.md](../../concepts/cross-service-scenarios.md) — if relevant
- Source files consulted
```

Use `Accepted` for decisions the user confirmed. Use `Proposed` if the user wants to think about it further.

## Phase 4 -- Flag Follow-Up

If the decision affects documented architecture or requirements:

1. **List which docs may need updating** — but do NOT update them here. That's `/implement-feature`'s job.
2. **Note any new requirements** that should be added to `spec/reference/requirements.md` (with suggested section and priority).
3. **Note any existing requirements** whose priority or status should change based on this decision.

Report these as a checklist the user can act on later.
