# AI Assistant Context

This page mirrors [`CLAUDE.md`](https://github.com/mikezaschka/cds-data-federation/blob/main/CLAUDE.md) at the root of the repository. That file is the canonical entry-point context for AI coding assistants (Claude Code, Cursor, etc.) working on this project — it contains the deep architecture overview, plugin lifecycle, CAP quirks, and project conventions.

It is **not** included in the main documentation navigation because:

1. It's written for AI assistants and repository contributors, not for end-users of the plugin.
2. It is the source of truth and must live at the repository root (Claude Code reads it from there).
3. Its content is largely duplicated across the [Concepts](../concepts/terminology.md) and [Reference](../reference/annotations.md) sections for human readers, in a more navigable form.

If you are an AI assistant or contributor looking for:

| You want | Go to |
|---|---|
| Overall architecture | [`CLAUDE.md`](https://github.com/mikezaschka/cds-data-federation/blob/main/CLAUDE.md) |
| Feature matrix / roadmap | [Reference → Feature Matrix](../reference/requirements.md) |
| Consumption view principle | [Concepts → Consumption Views](../concepts/consumption-views.md) |
| Cross-service `$expand` design | [Concepts → $expand Scenarios](../concepts/expand-scenarios.md) |
| How queries route through services vs. DB | [Concepts → Service Query Execution](../concepts/service-query-execution.md) |
| Comparison with CAP built-ins and alternatives | [Reference → Comparison](../reference/comparison.md) |

## Internal research

Background investigations that shaped the design:

- [CAP Built-in Analysis](research/cap-builtin-analysis.md) — what CAP offers natively for federation / delegation / replication and the manual patterns this plugin automates.
- [Replication Cache Analysis](research/replication-cache-analysis.md) — deep dive on `@cap-js-community/common`'s Replication Cache.

## Architectural decisions

- [ADR 0001 — Replication Service extends cds.Service](decisions/0001-replication-service-extends-cds-service.md)

## Completed plans

- [Migrate replication service to cds.Service](plans/completed/migrate-replication-service-to-cds-service.md)
