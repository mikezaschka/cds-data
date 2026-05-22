# Fix Bug

Fix a bug following the project's reproduce-first workflow.

**Input:** Bug description or failing behavior.

## Phase 1 -- Reproduce

1. Read `CLAUDE.md` for project context and conventions.
2. Find or write a failing test that demonstrates the bug. Place it in the appropriate package test tree:
   - `packages/cds-data-federation/test/integration/` — delegate, expand, navigation, caching, CUD (pick the subfolder matching the scenario)
   - `packages/cds-data-pipeline/test/integration/` — pipeline runs, adapters, scheduling
   - `packages/cds-data-materialization/test/` — snapshot compiler and binding
   - `packages/*/test/unit/` — pure logic (no I/O)
   - Tag the new test with `it('[<id>] ...')` if it maps 1:1 to a requirement row (see [`spec/reference/test-mapping.md`](../../spec/reference/test-mapping.md)).
3. Run the test and confirm it fails, e.g. `npm run test:federation -- --testNamePattern "test name"` (or `test:pipeline` / `test:materialization`).

## Phase 2 -- Investigate

1. Read the failing code path. Trace from the test through the handler/module.
2. For CAP-specific issues, inspect the compiled model and runtime state. Prefer the `cap-mcp` MCP server (configured in [`.mcp.json`](../../.mcp.json)):
   - List services / entities / definitions — ask the agent to use `cap-mcp` tools directly.
   - Inspect annotations, associations, view mappings without booting the app.

   Only if the MCP server is unavailable, fall back to:
   ```js
   node -e "
   const cds = require('@sap/cds');
   cds.test('packages/cds-data-federation/test/fixtures/consumer');
   setTimeout(async () => {
       const srv = cds.services['ConsumerService'];
       // inspect srv.entities, cds.model.definitions, etc.
       process.exit(0);
   }, 3000);
   "
   ```
3. Identify the root cause before writing any fix.

## Phase 3 -- Fix

1. Implement the minimal fix. Follow conventions:
   - Use `cds.ql.clone(query)` before modifying CQN objects.
   - Don't mutate `req.query` in handlers.
   - Use `cds.log('cds-data-federation')` for logging.
2. Verify the failing test now passes.

## Phase 4 -- Verify

1. Run the relevant package test suite: `npm test` (all workspaces) or `npm run test:federation` / `test:pipeline` / `test:materialization`.
2. Run lint: `npm run lint`.
3. Fix any regressions.

## Phase 5 -- Commit

Create a `fix:` conventional commit. Reference the symptom and root cause in the message.
