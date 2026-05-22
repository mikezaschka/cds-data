# External Documentation Style Guide

**Purpose:** keep the published documentation surface — the unified VitePress site under [`docs/`](../../docs/) (`docs/pipeline/`, `docs/federation/`, `docs/materialization/`), the top-level `README.md`, the per-package `README.md`s shipped to npm, and the example READMEs — welcoming, focused, and tutorial-shaped. Internal analysis (research notes, ADRs, ideas, the AI-assistant primer, the feature tracker) lives under [`spec/internal/**`](./) and follows different conventions — it's a thinking space for maintainers, not a product surface.

This guide operationalizes the *"internal ↔ external duplication"* exception from [`CLAUDE.md`](../../CLAUDE.md) §Conventions and the decisions recorded in [ADR 0002](./decisions/0002-separate-internal-and-published-docs.md) and [ADR 0006](./decisions/0006-per-plugin-published-surface.md).

## Scope

The rules below apply to:

- Everything under [`docs/`](../) **except** [`spec/internal/**`](./), [`spec/concepts/**`](../concepts/), [`spec/reference/requirements.md`](../reference/requirements.md), and [`spec/reference/test-mapping.md`](../reference/test-mapping.md).
- Per-package documentation trees: every `docs/pipeline/** and docs/federation/**/*.md`.
- Per-package READMEs shipped to npm: every `packages/*/README.md`.
- The repository [`README.md`](../../README.md) — **except** its `## For contributors` section, which is the single permitted home for internal references (see R5).
- Consumer-facing READMEs in [`examples/`](../../examples/) — every `examples/**/README.md`.

[`spec/concepts/`](../concepts/) is out of scope because it is the **contributor canonical source of truth** for concept pages per [ADR 0006 §3](./decisions/0006-per-plugin-published-surface.md). Consumer-facing concept pages live under `docs/pipeline/guide/concepts/` and `docs/federation/concepts/`, scoped to each package's audience; those published copies are in scope.

The `examples/` scope applies even though the VitePress site does not build those pages. Consistent voice now makes a future examples extraction cheaper.

Files **outside** the scope (internal analysis, workflow docs, entry points like `CLAUDE.md` / `AGENTS.md`) may freely use comparative, opinionated, status-tracking, or internal-reference language. They serve a different audience.

## Rules

### R1 — Tutorial voice in published pages

Describe what the plugin does on its own terms. Show the reader how to get from zero to a working setup. Avoid structuring pages around what other tools *fail* to do.

- **Good:** *"Add `@federation.delegate` to a projection on a remote entity. Queries against that entity are forwarded to the remote service at request time."*
- **Avoid:** *"CAP does not automatically register delegate handlers, so you would normally hand-write an `on('READ')` handler. This plugin does that for you."*

The plugin's value is worth stating positively.

### R2 — No adversarial library comparisons on the published site

Comparing approaches is useful. The site includes capability matrices for delegation and replication alternatives because readers need to choose. But the framing is always *"pick X when …"*, never *"X is wrong when …"*.

- **Good:** *"HANA Smart Data Access fits when the integration boundary logically belongs to the database and you want native SQL joins and pushdown."*
- **Avoid:** *"HANA SDA is the wrong choice when the boundary belongs to the application layer."*
- **Good:** *"The Replication Cache from `@cap-js-community/common` stores a full entity dataset per tenant and serves any query against it from that snapshot."*
- **Avoid:** *"Despite the name, the Replication Cache is architecturally a delegation-side cache, not a true replication strategy."*

Capability matrices (rows of "yes / no / partial / n/a") are facts, not tone — they stay on the site. Opinion prose that evaluates another library's architecture, naming, or design choices belongs under [`spec/internal/research/`](./research/), linked from the site via an absolute GitHub URL when readers might want the deeper analysis.

### R3 — No status / priority / roadmap / phase content on the published site

Consumers want to know **what works today**, not what is prioritized for which phase. The feature tracker at [`spec/reference/requirements.md`](../reference/requirements.md) is for contributors; it is not part of the VitePress build. The consumer-facing equivalents are [`docs/pipeline/reference/features.md`](../../docs/pipeline/reference/features.md) and [`docs/federation/reference/features.md`](../../docs/federation/reference/features.md) — Implemented features only, grouped by capability, no `Priority` / `Phase` / `Status` / `Requirement ID` columns.

- **Avoid on the site:** phrases like *"Phase 6 event-driven sync (planned)"*, *"P1 — not started"*, *"roadmap item"*.
- **Fine internally:** the tracker, ADRs, and the AI-assistant primer may use these terms freely.

If a forward-looking statement is genuinely consumer-relevant (e.g., explaining why caching is currently response-level), phrase it as a capability description, not a schedule.

### R4 — No rhetorical-contrast vocabulary

A small set of words consistently signals benchmark-style framing rather than tutorial voice. Treat these as red flags in published pages:

- *stops short* — implies the compared thing gave up or is incomplete
- *hand-written*, *manual*, *boilerplate* — used to make the plugin look better by contrast
- *does not do*, *doesn't do* — in constructions like "X does not do Y, but we do"
- *despite the name* — implies the other project's naming is misleading
- *what … does NOT* / *what … DOES NOT* — adversarial list framing

This is not a ban on the words themselves — *manual* is fine in *"a manual UPSERT loop"* describing your own code. The red flag is the **comparative** use. If in doubt, rewrite to describe the plugin directly.

### R5 — No internal references on published surfaces

Published pages describe the shipped capability. Internal reasoning — ADR numbers, the feature tracker, contributor primers — belongs to a different audience and does not survive on npm, GitHub Pages, or in a user's code-review context where the linked files are unavailable or irrelevant.

Treat the following as internal references on any in-scope file:

- Any link or path fragment matching `spec/internal/` (ADRs, research, ideas, plans, the AI-assistant primer).
- Inline citations matching `[ADR NNNN]`, `ADR 000N`, or `ADR-000N`. The ADRs themselves are contributor artifacts — their numbers are not a consumer concept.
- References to the contributor entry points [`CLAUDE.md`](../../CLAUDE.md) and [`AGENTS.md`](../../AGENTS.md).
- References to the contributor feature tracker [`spec/reference/requirements.md`](../reference/requirements.md) or the generated mapping [`spec/reference/test-mapping.md`](../reference/test-mapping.md).

The single permitted home is the repository `README.md`'s `## For contributors` section. That section is out of scope for R5, because its whole purpose is to hand contributors off to the internal surface.

- **Good (in a package README):** *"omitting `kind` throws a descriptive error explaining the required values."*
- **Avoid (in a package README):** *"omitting it throws a descriptive error pointing at ADR 0005."*
- **Good (in the root README `## For contributors` section):** *"Full feature tracker: [`spec/reference/requirements.md`](./spec/reference/requirements.md). Deep architecture notes: [`CLAUDE.md`](./CLAUDE.md)."*
- **Avoid (anywhere else):** the same bullet list.

If a published page needs to reference the rationale behind a capability and the rationale legitimately lives only in an ADR, link to the ADR via an **absolute GitHub URL** (matching the pattern for research links from R2). This keeps the site self-contained even when rendered outside the repo context.

## Cross-package links

Links between the two packages must be absolute because the rendered surfaces do not share a filesystem:

- Consumer cross-references (e.g. "see the companion package"): `https://www.npmjs.com/package/cds-data-pipeline` or `https://www.npmjs.com/package/cds-data-federation`.
- Deeper repo pointers (e.g. a specific page of the other package's site): `https://mikezaschka.github.io/cds-data-federation/<section>/<path>` or `https://github.com/mikezaschka/cds-data-monorepo/blob/main/packages/<package>/...`.

Relative paths like `../<other-package>/README.md` do **not** resolve on npm, and relative links across `mkdocs` sites break once they are rendered as independent GitHub Pages subpaths.

## Enforcement

[`.claude/commands/review.md`](../../.claude/commands/review.md) Phase 2 has `Req-10 External docs tone` covering this scope. The grep-lint for R4:

```bash
grep -rnE 'stops short|hand-written|boilerplate|does not do|despite the name|what .* does NOT' \
  docs/ README.md packages/*/README.md packages/*/docs/ examples/ \
  --include='*.md' --exclude-dir=internal 2>/dev/null
```

The grep-lint for R5:

```bash
grep -rnE 'spec/internal/|ADR 00[0-9]+|ADR-00[0-9]+|\[ADR [0-9]+\]|CLAUDE\.md|AGENTS\.md|reference/requirements\.md|reference/test-mapping\.md' \
  README.md packages/*/README.md packages/*/docs/ examples/ \
  --include='*.md' 2>/dev/null
```

R4 must return nothing. R5 must return only lines inside the root `README.md` `## For contributors` section — hits anywhere else are a FAIL. R1–R3 are reviewer judgment; the rules above are the reference.

## Where opinion goes

If a comparative or evaluative paragraph is genuinely valuable to contributors, write it where it belongs:

- Detailed library analysis → [`spec/internal/research/`](./research/).
- Design rationale for rejecting an approach → an ADR under [`spec/internal/decisions/`](./decisions/).
- Exploratory thinking → an idea under [`spec/internal/ideas/`](./ideas/) via [`/brainstorm`](../../.claude/commands/brainstorm.md).

Published pages may link to these from absolute GitHub URLs when readers would benefit from the depth.
