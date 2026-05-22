# Implement Feature

Implement a feature from REQUIREMENTS.md following the project's quality-first workflow.

**Input:** Feature ID (e.g., `4.6.3`) or feature description.

## Phase 1 -- Research & Understand

1. Read `CLAUDE.md` for project context and conventions.
2. Find the feature in `REQUIREMENTS.md` by ID or description. Note its priority, status, and full description.
3. Read the source files that will be affected. Trace the code path from `cds-plugin.js` through the relevant modules.
4. Read existing tests in `test/delegation.test.js`, `test/replication.test.js`, or `test/unit.test.js` to understand test patterns and find any skipped tests for this feature.
5. Check `docs/plans/` for any existing plan doc for this feature.
6. Summarize findings before proceeding.

## Phase 2 -- Plan & Align

1. Write an implementation plan to `docs/plans/<feature-name>.md` with:
   - **Overview:** What the feature does and why.
   - **Affected files:** Table mapping files to the changes needed.
   - **Tasks:** Numbered task sections with checkbox items (`- [ ]`). Each task should list specific files to modify.
   - **Test strategy:** What tests to add or unskip.
   - **Validation commands:** `npx jest --runInBand --forceExit --roots test/ --testNamePattern "pattern"` and `npm run lint`.
2. Set the feature's status to `In progress` in REQUIREMENTS.md.
3. **Wait for user approval before proceeding to Phase 3.**

## Phase 3 -- Implement (Test-First)

1. Find or write a skipped test (`it.skip(...)`) that validates the feature.
2. Unskip it and verify it fails: `npx jest --runInBand --forceExit --roots test/ --testNamePattern "test name"`.
3. Implement the feature. Follow these conventions:
   - Use `cds.log('cds-data-federation')` for logging (never `console.log`).
   - Use `cds.ql.clone(query)` before modifying CQN objects.
   - Use `withRetry()` for all remote I/O.
   - Don't mutate `req.query` in handlers.
   - Keep changes minimal -- no speculative abstractions.
4. Verify the test passes.

## Phase 4 -- Verify

1. Run the full test suite: `npx jest --runInBand --verbose --forceExit --roots test/`.
2. Run lint: `npm run lint`.
3. Fix any failures or regressions before proceeding.

## Phase 5 -- Update Documentation

Update all documentation surfaces:

1. **REQUIREMENTS.md:**
   - Set status to `Implemented`.
   - Update the Progress Summary table counts (section 4, top).
2. **README.md:** If the feature is user-visible (new annotation option, adapter, query capability, event hook, management action, protocol), add or adjust the relevant line in the feature matrix or annotation reference.
3. **CLAUDE.md:** If architecturally significant, update the relevant section (architecture, implementation status, test categories).
4. **Plan doc:** Move `docs/plans/<feature-name>.md` to `docs/plans/completed/`.
5. **Examples:** If the feature adds a user-visible capability reachable via OData (new annotation option, new entity pattern, new adapter, new query capability, new management action), update `examples/consumer`:
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
