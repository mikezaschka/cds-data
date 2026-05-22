# Fix Bug

Fix a bug following the project's reproduce-first workflow.

**Input:** Bug description or failing behavior.

## Phase 1 -- Reproduce

1. Read `CLAUDE.md` for project context and conventions.
2. Find or write a failing test that demonstrates the bug. Place it in the appropriate test file:
   - `test/delegation.test.js` for delegate/expand/navigation issues
   - `test/replication.test.js` for replication/adapter issues
   - `test/unit.test.js` for pure logic issues (no I/O)
3. Run the test and confirm it fails: `npx jest --runInBand --forceExit --roots test/ --testNamePattern "test name"`.

## Phase 2 -- Investigate

1. Read the failing code path. Trace from the test through the handler/module.
2. For CAP-specific issues, inspect runtime state:
   ```js
   node -e "
   const cds = require('@sap/cds');
   cds.test('test/consumer/');
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

1. Run the full test suite: `npx jest --runInBand --verbose --forceExit --roots test/`.
2. Run lint: `npm run lint`.
3. Fix any regressions.

## Phase 5 -- Commit

Create a `fix:` conventional commit. Reference the symptom and root cause in the message.
