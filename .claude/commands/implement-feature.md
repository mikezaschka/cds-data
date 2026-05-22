# Implement Feature

Implement a feature from `spec/reference/requirements.md` following the project's quality-first workflow.

**Input:** Feature ID (e.g., `4.6.3`) or feature description.

## Phase 1 -- Research & Understand

1. Read `CLAUDE.md` for project context and conventions.
2. Find the feature in `spec/reference/requirements.md` by ID or description. Note its priority, status, and full description.
3. Read the source files that will be affected. Trace the code path from `cds-plugin.js` through the relevant modules.
4. Read existing tests under `packages/cds-data-federation/test/`, `packages/cds-data-pipeline/test/`, or `packages/cds-data-materialization/test/` to understand test patterns and find any skipped tests for this feature. Use `spec/reference/test-mapping.md` to find tests tagged with the requirement ID.
5. Check `spec/internal/plans/` for any existing plan doc for this feature.
6. Summarize findings before proceeding.

## Phase 2 -- Plan & Align

1. Write an implementation plan to `spec/internal/plans/<feature-name>.md` with:
   - **Overview:** What the feature does and why.
   - **Affected files:** Table mapping files to the changes needed.
   - **Tasks:** Numbered task sections with checkbox items (`- [ ]`). Each task should list specific files to modify.
   - **Test strategy:** What tests to add or unskip.
   - **Validation commands:** `npm run test:federation -- --testNamePattern "pattern"` (or `test:pipeline` / `test:materialization`) and `npm run lint`.
2. Set the feature's status to `In progress` in `spec/reference/requirements.md`.
3. **Wait for user approval before proceeding to Phase 3.**

## Phase 3 -- Implement (Test-First)

1. Find or write a skipped test (`it.skip(...)`) that validates the feature.
2. Unskip it and verify it fails: `npm run test:federation -- --testNamePattern "test name"` (or the relevant package script).
3. Implement the feature. Follow these conventions:
   - Use `cds.log('cds-data-federation')` for logging (never `console.log`).
   - Use `cds.ql.clone(query)` before modifying CQN objects.
   - Use `withRetry()` for all remote I/O.
   - Don't mutate `req.query` in handlers.
   - Keep changes minimal -- no speculative abstractions.
4. Verify the test passes.

## Phase 4 -- Verify

1. Run the full test suite: `npm test`.
2. Run lint: `npm run lint`.
3. Fix any failures or regressions before proceeding.

## Phase 5 -- Update Documentation

Update all documentation surfaces:

1. **`spec/reference/requirements.md`:**
   - Set status to `Implemented`.
   - Run `npm run sync:requirements` to regenerate the Progress Summary table counts.
2. **Per-package `features.md`:** If the feature is consumer-visible, update the `features.md` for the package the feature lives in. Pick by scope:
   - `docs/pipeline/reference/features.md` — engine-scope features: source adapters, management-service endpoints and actions, pipeline event hooks (`PIPELINE.*`), tracker surfaces, scheduling/trigger capabilities, `kind` taxonomy additions, programmatic API changes to `addPipeline(...)`.
   - `docs/federation/reference/features.md` — annotation-scope features: `@federation.*` options, query-delegation capabilities (`$select`, `$filter`, `$orderby`, `$top`, `$skip`, `$expand` translations), cross-service scenarios, CUD forwarding, cache options, consumption-view patterns.
   - A feature that crosses the binding seam (e.g. a new adapter that surfaces a new `@federation.replicate` option) touches both.

   Treat each file as the consumer-facing subset of `requirements.md`: Implemented features only, no `Priority` / `Phase` / `Status` / `Requirement ID` columns. Tone follows [`spec/internal/docs-style-guide.md`](../../spec/internal/docs-style-guide.md) (R1–R5).
3. **README.md:** If the feature is user-visible (new annotation option, adapter, query capability, event hook, management action, protocol), add or adjust the relevant line in the feature matrix or annotation reference.
4. **CLAUDE.md:** If architecturally significant, update the relevant section. Deep architecture changes go in `spec/internal/ai-assistant-context.md` (CLAUDE.md is a slim primer that links to it).
5. **Plan doc:** Move `spec/internal/plans/<feature-name>.md` to `spec/internal/plans/completed/`.
6. **Examples:** If the feature adds a user-visible capability reachable via OData (new annotation option, new entity pattern, new adapter, new query capability, new management action), update `examples/consumer`:
   - Add or adjust the consumption view in `examples/consumer/db/schema.cds` and expose it in `srv/consumer-service.cds`.
   - If the entity surfaces in the UI, add or adjust FE annotations in `srv/consumer-service-ui.cds`.
   - If a new tile is warranted, edit `examples/consumer/app/_generate-fe-apps.js` (append an entry), rerun `node examples/consumer/app/_generate-fe-apps.js`, and add the tile to `examples/consumer/app/launchpage.html`.
   - Verify `npm run examples:start` still boots cleanly and the affected app renders. Don't let `examples/` drift from the feature set — see `CLAUDE.md` → "## Example apps".

## Phase 6 -- Commit

Create a conventional commit:
- `feat:` for new features
- `fix:` for bug fixes
- `chore:` for infrastructure/tooling

Include the requirement ID in the commit body (e.g., `Implements 4.6.3`).
