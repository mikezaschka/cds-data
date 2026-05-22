# Linear as PM system for cds-data-federation

**Status:** Exploring
**Created:** 2026-04-19
**Promoted to:** (empty)
**Related:** [`spec/reference/requirements.md`](../../reference/requirements.md) (feature matrix, canonical today), [`spec/internal/ideas/`](./) (exploration surface), [`spec/internal/decisions/`](../decisions/) (ADRs), [`CLAUDE.md`](../../../CLAUDE.md) §Conventions (low-redundancy rule), [`.mcp.json`](../../../.mcp.json) (project-level MCP servers)

## Trigger

Linear MCP plugin is installed and already authenticated in Cursor (`plugin-linear-linear`, team `Mikezaschka` confirmed via `list_teams`). The question is no longer *how* to connect but *whether and how* Linear should slot into this project's existing PM flow — today, that flow is three Markdown surfaces:

- [`spec/reference/requirements.md`](../../reference/requirements.md) — the feature matrix (IDs `4.x.y`, status columns), canonical spec.
- [`spec/internal/ideas/`](./) — pre-requirement exploration (this file's home).
- [`spec/internal/decisions/`](../decisions/) — ADRs for architectural choices.

Linear would add a fourth surface (tactical execution: cycles, bugs, task queue). The idea: decide the split before it drifts by accident.

## Non-goals

- **Not replacing ADRs.** Architecture decisions stay in `spec/internal/decisions/`; they are part of the repo so offline/LLM tooling can reason over them. Linear has no equivalent durability guarantee.
- **Not replacing `requirements.md` as the feature spec.** The feature matrix is referenced directly in [`CLAUDE.md`](../../../CLAUDE.md), test IDs (`[<req-id>] <scenario>`), [`spec/reference/test-mapping.md`](../../reference/test-mapping.md), and agent prompts. Breaking that contract is out of scope here.
- **Not cross-tool MCP.** Linear MCP is currently **only** registered in Cursor — it is not in [`.mcp.json`](../../../.mcp.json), so Claude Code / Codex / Aider cannot see it. Either we accept the asymmetry or we add it to `.mcp.json`. Deciding which is part of this idea, not a non-goal.
- **Not customer-facing issue tracking.** This is about internal PM, not bug reports from plugin consumers (those belong on GitHub Issues).
- **Not automation / CI.** No webhooks, no GitHub↔Linear linking, no PR-on-merge closes-issue integration in v1.

## Options

### Option A — Parallel tracks, no sync

Linear handles tactical execution (cycles, weekly task queue, ad-hoc bugs). Markdown keeps strategy (requirements matrix, ADRs, ideas). No automation — cross-references by hand when useful (a Linear issue may mention `Req 4.6.3`; a requirement may mention `MIK-42`).

- **Pros:** Zero build cost. No sync logic to maintain. Each surface is used for what it's best at — Linear for "what am I doing this week", Markdown for "what is the spec and why".
- **Pros:** Respects the low-redundancy rule in [`CLAUDE.md`](../../../CLAUDE.md) — nothing is duplicated, just cross-referenced.
- **Cons:** Two places to look. Status drift: a requirement row says "In progress" but the Linear cycle is closed, or vice versa. Easy to forget Linear exists when editing the Markdown (it is the existing habit).
- **Cons:** Linear is Cursor-only until we add it to `.mcp.json`. Other agents see only half the picture.

### Option B — Markdown → Linear one-way mirror

Add `npm run sync:linear` (symmetric to the existing `npm run sync:requirements`). It reads `requirements.md` rows and upserts Linear issues, keyed on the requirement ID (`4.6.3` → issue title prefix or custom field / label). Status column → Linear workflow state. Markdown stays canonical.

- **Pros:** Linear becomes a live board view of the spec without changing the source of truth. Cycles/priorities/assignees live only in Linear — Markdown stays small.
- **Pros:** Matches the existing "Markdown is canonical, tooling syncs out" pattern already used for [`test-mapping.md`](../../reference/test-mapping.md).
- **Cons:** One-way means status edits in Linear don't flow back. If you close an issue in Linear you still have to flip the row in `requirements.md` — same problem Option A has, just narrower.
- **Cons:** New sync script to write and maintain. Linear label/state mapping has to be kept in sync with the status vocabulary in [`requirements.md`](../../reference/requirements.md).

### Option C — Linear canonical, regenerate `requirements.md`

Flip the direction. `requirements.md` is generated from Linear; the generated file is committed so offline tooling / LLM context still work.

- **Pros:** Linear becomes the single source. No "edit Markdown, run sync" — just work in Linear.
- **Cons:** Requires Linear access (or at least a Linear API token) to change the spec. Contributors without Linear access can't. Hostile to the project's "tool-agnostic" posture ([`AGENTS.md`](../../../AGENTS.md)).
- **Cons:** Prose in `requirements.md` (§1 Vision, §2 Use cases, §3+ narrative between tables) is hand-written and wouldn't round-trip through Linear cleanly.

### Option D — Hybrid: ideas & requirements in Markdown, execution in Linear

- `spec/internal/ideas/` → stays in Markdown (this file is proof the process works).
- `spec/reference/requirements.md` → stays canonical for the feature matrix.
- `spec/internal/decisions/` → stays in Markdown.
- **Linear** → short-lived work items that don't deserve a requirement row: refactors, test coverage gaps, docs fixes, investigation spikes, individual sub-tasks of an in-progress requirement. Cycles/priorities live only in Linear.

Cross-references by hand (Linear issue body: "Implements `Req 4.6.3`"). No sync script in v1; revisit if drift hurts.

- **Pros:** Each surface has a clear, non-overlapping purpose. Requirements and ADRs stay in the repo (agent-accessible offline). Linear absorbs the work items that currently have no good home (they end up as TODOs in code or ad-hoc notes in chat).
- **Pros:** Incremental — start with Option A's zero-cost posture, add a sync script only if we feel the pain.
- **Cons:** Needs a written convention (this file, or a short section in [`AGENTS.md`](../../../AGENTS.md) / [`CLAUDE.md`](../../../CLAUDE.md) §Conventions) explaining what belongs where. Without it, Option D collapses into "use whichever surface comes to mind", which is worse than Option A.

### Option E — Side-channel only (null)

Keep Linear as an ad-hoc chat tool only. No convention, no integration, no structural role. Useful for "give me a summary of open issues", not for tracking project state.

- **Pros:** Truly zero cost. Easy to abandon if Linear turns out not to fit.
- **Cons:** Defeats the point of installing it for PM.

## Open questions

1. **Cross-tool visibility.** Should `linear` be added to [`.mcp.json`](../../../.mcp.json) so Claude Code / Codex also see it? Downside: every tool inherits the same Linear workspace and OAuth story. Upside: consistency with the project's "AI-tool-agnostic" posture ([`CLAUDE.md`](../../../CLAUDE.md) §Working from another tool).
2. **Requirement ↔ issue keying.** If we ever sync (Option B/D-plus), what is the key? Linear's issue ID (`MIK-42`) is stable but ugly in Markdown; the requirement ID (`4.6.3`) is stable and already used everywhere. Probably the requirement ID as a Linear label or custom field.
3. **What counts as "deserves a requirement row"?** Today the implicit rule is "user-visible capability → row". If Linear absorbs the rest, we need a crisper rule so things don't fall through the gap.
4. **Idea promotion path.** The [`/brainstorm`](../../../.claude/commands/brainstorm.md) Phase 5 says promoted ideas become a requirement row or an ADR. Option D would add "or a Linear issue (for execution-only work)". Needs a line in the promotion ladder.
5. **Where does the convention live?** If we pick Option D, the "what belongs where" table either lives in [`AGENTS.md`](../../../AGENTS.md) (tool-agnostic workflows) or as a short appendix in this file once promoted. Probably `AGENTS.md` so every tool sees it without loading this idea file.
6. **Does a sync script even pay for itself?** `requirements.md` has ~dozens of rows across ~10 sections. Drift cost is bounded. The sync script is recurring maintenance cost. Option A + D (no sync) may be the right call forever, not just for v1.

## Initial reaction (capture for later)

Option **D with no sync** (= Option A + a written convention) is the smallest change that adds value. It costs: one short section in `AGENTS.md`/`CLAUDE.md` conventions explaining *"requirements in Markdown, ADRs in Markdown, ideas in Markdown, execution tasks in Linear"*, plus adding `linear` to [`.mcp.json`](../../../.mcp.json) so other agents can see it. Everything else (sync, codegen, automation) can be added later if and only if drift shows up as a real problem.

The one decision that shouldn't drift: **`requirements.md` and `spec/internal/decisions/` stay canonical.** They're the things agents need to reason about offline — losing them to a hosted tool would regress the project's "works with any AI tool" property.
