# Brainstorm

Capture a loose idea before it is ready to become a requirement or an ADR. Low-commitment scratch surface that keeps exploration out of [`spec/reference/requirements.md`](../../spec/reference/requirements.md) and [`spec/internal/decisions/`](../../spec/internal/decisions/).

**Input:** rough idea, feature wish, curiosity, or a concern that does not yet have a clear problem statement.

**Output:** a file in [`spec/internal/ideas/`](../../spec/internal/ideas/) with status `Exploring`. Optionally graduates later to a requirement row, an ADR, or is dropped.

## Phase 1 — Frame the problem

1. What triggered the idea? One or two sentences.
2. Who is the user / audience? Plugin consumer, plugin contributor, CI, ops?
3. What is it explicitly **not**? Bound the scope.

Stop here if you cannot answer at least the first question — bring the trigger back when you can describe it.

## Phase 2 — Map to existing patterns

Before proposing anything new, check what already exists. Use the MCP servers in [`.mcp.json`](../../.mcp.json) where they help.

1. Is there an adjacent requirement in [`spec/reference/requirements.md`](../../spec/reference/requirements.md)? Note the ID and status.
2. Is there a prior ADR in [`spec/internal/decisions/`](../../spec/internal/decisions/) that covers or constrains the idea?
3. Is there prior analysis in [`spec/internal/research/`](../../spec/internal/research/)?
4. Is it already demonstrated in [`examples/consumer/`](../../examples/consumer/)?

If the idea is already covered, stop and link to the covering document instead.

## Phase 3 — Explore options

Lightweight, non-committal. Two or three bullet points per option. Pros / cons. **Do not pick a winner yet** — that is the job of `/discuss-architecture`.

## Phase 4 — Capture

Write `spec/internal/ideas/<kebab-slug>.md` using this header:

```markdown
# <Title>

**Status:** Exploring
**Created:** YYYY-MM-DD
**Promoted to:** (empty; later: requirement ID, ADR number, or "Dropped")
**Related:** (requirement IDs, ADR numbers, research notes — one list)

## Trigger
...

## Non-goals
...

## Options
...

## Open questions
...
```

Keep it short. Ideas are allowed to be wrong; requirements and ADRs are not.

## Phase 5 — Graduation path

When the idea is ready to commit:

- **New feature** — promote to a `Not started` row in [`spec/reference/requirements.md`](../../spec/reference/requirements.md). Set the idea's `Status:` to `Promoted` and `Promoted to: 4.X.Y`. Leave the idea file; it's now a decision log.
- **Architectural choice** — run [`/discuss-architecture`](./discuss-architecture.md). The ADR links back to the idea. Set `Status: Promoted` and `Promoted to: ADR NNNN`.
- **Dropped** — set `Status: Dropped`, append a `## Why dropped` section, and leave the file. Future searches benefit from knowing this was considered and rejected.

## Convention

- One idea per file. Don't stuff multiple threads into one note.
- Reference requirement IDs, ADR numbers, and scenario names from [`spec/concepts/cross-service-scenarios.md`](../../spec/concepts/cross-service-scenarios.md) directly — never paraphrase them.
- Do not duplicate external doc content into an idea. Link, don't quote. See [`CLAUDE.md`](../../CLAUDE.md) §Conventions (low-redundancy rule).
