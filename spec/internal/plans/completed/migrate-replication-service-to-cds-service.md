# Plan: Migrate DataReplicationService to extend cds.Service

**ADR:** [ADR 0001 — Replication Service extends cds.Service](../../decisions/0001-replication-service-extends-cds-service.md)
**Status:** Completed
**Created:** 2026-04-17
**Completed:** 2026-04-17

## Overview

Replace the plain-class `DataReplicationService` with a `cds.Service`-based
implementation. Rename pipeline events from `READ`/`MAP`/`WRITE` to
`REPLICATE.READ`/`REPLICATE.MAP`/`REPLICATE.WRITE`. Remove the custom
`EventEmitter` and `ReplicationRequest` in favor of CAP's native event handling
and `cds.Request`. Remove the `cds._dataFederation.replicationService` global.

All 27 passing replication tests must stay green after each commit. Delegation
tests (309 passing) must be unaffected.

## Affected files

### New

- `srv/replication-service.cds` — stub CDS service definition so CAP picks up
  `srv/DataReplicationService.js` by name matching and
  `cds.connect.to('DataReplicationService')` works.

### Modified

- `srv/DataReplicationService.js` — `extends cds.Service`, internal router for
  per-replication defaults, event name renames, new `cds.Request`-based
  dispatch.
- `srv/lib/DataReplication.js` — `execute()` constructs `cds.Request` instances
  and calls `srv.dispatch(req)`. Default handlers become plain functions.
- `srv/data-replication-management-service.js` — use
  `cds.connect.to('DataReplicationService')` instead of the global stash.
- `cds-plugin.js` — same, plus remove the `cds._dataFederation` assignment.
- `packages/cds-data-pipeline/test/integration/` — update event names in hook registrations, switch
  to `cds.connect.to('DataReplicationService')`.
- `README.md` — document new event names + the `(results, req)` after-hook
  signature gotcha. Document `cds.connect.to('DataReplicationService')` as the
  entry point.
- `CLAUDE.md` — update "Architecture" section to reflect `cds.Service`-based
  implementation; update "Conventions to follow" with the after-hook signature
  note.

### Deleted

- `srv/lib/EventEmitter.js`
- `srv/lib/ReplicationRequest.js`

## Task checklist

One commit per step for clean bisect. Each step must leave the test suite green
(all 27 replication tests, all 309 delegation tests).

### Step 1 — Scaffold CDS stub + class extension (no behavior change)

- [ ] Create `srv/replication-service.cds` with `service DataReplicationService`.
- [ ] Change `class DataReplicationService` to `extends cds.Service`.
- [ ] Add `constructor(name)` that calls `super(name)` — CAP's `cds.Service`
  constructor accepts `(name, model, options)`; passing just the name is
  supported for code-only services.
- [ ] Override `init()` to initialize `this.replications`, `this.eventEmitter`
  (keep temporarily), and call `super.init()`.
- [ ] Verify: `npx jest --runInBand --forceExit --roots test/ replication.test.js`
  passes. Boot log should show CAP recognizing `DataReplicationService` as a
  registered service.

### Step 2 — Rename events `READ`/`MAP`/`WRITE` → `REPLICATE.READ`/`MAP`/`WRITE`

- [ ] Update `srv/lib/DataReplication.js`:
  - `init()` registers `REPLICATE.READ`, `REPLICATE.MAP`, `REPLICATE.WRITE` on
    the (still custom) EventEmitter.
  - `_deltaSync()` emits `before.REPLICATE.READ`, `REPLICATE.READ`,
    `after.REPLICATE.READ` (and same for MAP/WRITE).
- [ ] Update `packages/cds-data-pipeline/test/integration/` — R18, R19 hook-based tests use the
  new event names.
- [ ] Verify: replication tests pass.

### Step 3 — Switch management service + plugin to `cds.connect.to(...)`

- [ ] Update `srv/data-replication-management-service.js` — replace all
  `cds._dataFederation?.replicationService` reads with
  `await cds.connect.to('DataReplicationService')`.
- [ ] Update `packages/cds-data-pipeline/test/integration/` — replace the line
  `const srv = cds._dataFederation?.replicationService` with
  `const srv = await cds.connect.to('DataReplicationService')`.
- [ ] Update `cds-plugin.js`:
  - Instantiate `DataReplicationService` as before.
  - **Do not** write to `cds._dataFederation`.
  - Register via `cds.services[srv.name] = srv` as a fallback if CAP hasn't
    auto-wired it by the time we call `addReplication()`. (Expected: the `.cds`
    stub triggers auto-wiring on `cds.on('served')`, so the explicit assignment
    becomes a no-op or defensive fallback.)
- [ ] Verify: replication tests pass. Delegation tests still pass.

### Step 4 — Replace EventEmitter with CAP's native handlers + srv.dispatch

This is the meat of the migration. Keep scope tight: only the pipeline
dispatch mechanism changes; the pipeline shape (READ → MAP → WRITE with
before/on/after per phase) is unchanged.

- [ ] In `DataReplicationService`:
  - Remove `this.eventEmitter` entirely.
  - Add internal maps `_defaults = { 'REPLICATE.READ': new Map(), ... }` keyed
    by replication name → default handler fn.
  - In `init()`, register three routers:
    ```js
    this.on('REPLICATE.READ',  (req, next) => this._route('REPLICATE.READ',  req, next))
    this.on('REPLICATE.MAP',   (req, next) => this._route('REPLICATE.MAP',   req, next))
    this.on('REPLICATE.WRITE', (req, next) => this._route('REPLICATE.WRITE', req, next))
    ```
  - `_route(event, req, next)` looks up `req.data.replication` in
    `_defaults[event]` and calls the handler; `next()` if no default registered
    (allows user hooks to override defaults).
  - Remove `before/on/after` facade methods — they're now inherited from
    `cds.Service`.
- [ ] In `DataReplication`:
  - `init()` calls `this.srv.registerDefault('REPLICATE.READ', this.name, this._defaultReadHandler.bind(this))`
    (and MAP/WRITE).
  - Constructor now takes `(name, config, srv)` instead of `(name, config, eventEmitter)`.
  - `_deltaSync()` builds requests:
    ```js
    const readReq = this._makeReq('REPLICATE.READ', { config: this.config })
    await this.srv.dispatch(readReq)
    const { sourceStream } = readReq.data
    for await (const batch of sourceStream) {
      const mapReq = this._makeReq('REPLICATE.MAP', {
        config: this.config, sourceRecords: batch, targetRecords: [],
      })
      await this.srv.dispatch(mapReq)
      const writeReq = this._makeReq('REPLICATE.WRITE', {
        config: this.config, targetRecords: mapReq.data.targetRecords, statistics: {},
      })
      await this.srv.dispatch(writeReq)
    }
    ```
  - `_makeReq(event, data)` helper:
    ```js
    _makeReq(event, data) {
      const req = new cds.Request({
        event,
        path: `${this.srv.name}.${this.name}`,
        data: { replication: this.name, ...data },
      })
      req.reply = (x) => { req.results = x } // force interceptor-chain mode
      return req
    }
    ```
- [ ] Default handler signatures adapt:
  - `_defaultReadHandler(req)` — reads `req.data.config`, sets `req.data.sourceStream`.
  - `_defaultMapHandler(req)` — reads `req.data.sourceRecords` + `req.data.config.viewMapping`, sets `req.data.targetRecords`.
  - `_defaultWriteHandler(req)` — reads `req.data.targetRecords`, sets `req.data.statistics`.
- [ ] Delete `srv/lib/EventEmitter.js` and `srv/lib/ReplicationRequest.js`.
- [ ] Verify: all replication tests pass.

### Step 5 — Update hook-registration tests + public docs

- [ ] Audit `packages/cds-data-pipeline/test/integration/` R18, R19 and any other tests registering
  `before/after` hooks. Update:
  - Event names to `REPLICATE.MAP` / `REPLICATE.WRITE`.
  - `after` hook signature to `(results, req)` if they currently read from a
    single-argument `req`.
- [ ] Update `README.md`:
  - Events section: document `REPLICATE.READ/MAP/WRITE` and example hooks.
  - Note: `after` hooks receive `(results, req)`.
  - Replace any reference to `cds._dataFederation.replicationService` with
    `cds.connect.to('DataReplicationService')`.
- [ ] Update `CLAUDE.md`:
  - "Architecture" diagram + description — `DataReplicationService extends cds.Service`.
  - "Conventions to follow" — add note about `REPLICATE.*` event naming and
    `(results, req)` after-hook signature.
  - Remove references to `EventEmitter.js` and `ReplicationRequest.js`.
- [ ] Verify: full test suite passes end-to-end.

### Step 6 — Move plan to completed

- [ ] `mv docs/plans/migrate-replication-service-to-cds-service.md docs/plans/completed/`.
- [ ] Update ADR status line to `Accepted` (already is, but confirm).

## Test strategy

No new test entities required. The migration is semantics-preserving for the
pipeline; existing tests cover all critical paths:

- **R1–R4** Full sync + renames — exercises `REPLICATE.READ` default,
  `REPLICATE.MAP` default with viewMapping, `REPLICATE.WRITE` default with
  UPSERT.
- **R5–R7** Delta sync — exercises `REPLICATE.READ` with tracker state.
- **R10** Concurrency — exercises the UPDATE-based guard on `Federations`
  (unchanged, runs outside the event pipeline).
- **R18** `before.MAP` filter — renamed to `before.REPLICATE.MAP`, validates
  hook dispatch.
- **R19** `after.MAP` enrich — renamed, validates hook dispatch and
  `(results, req)` arg shape.
- **R22–R29** Adapter tests — unchanged; adapter factory is upstream of the
  event pipeline.

New assertion to add to R18 or R19: verify `cds.context` is populated inside
the hook (sanity check that CAP wiring actually produces a proper request
context). One line:
```js
expect(cds.context).toBeDefined()
```

## Known unknowns to resolve during implementation

1. **Will CAP auto-wire `DataReplicationService` from the stub CDS file?** If
   the service instance from `new DataReplicationService()` in `cds-plugin.js`
   races with CAP's own auto-instantiation on `cds.on('served')`, we may end up
   with two instances. Mitigation: check `cds.services[name]` first in
   `cds-plugin.js` and reuse the auto-wired instance if present.
2. **Does `cds.test()` in `packages/cds-data-pipeline/test/integration/` pick up the plugin's own
   `.cds` stub?** Historically `cds.test('test/consumer/')` only compiles the
   consumer's model; plugin `.cds` files are loaded via `cds-plugin.js`'s
   `cds.on('loaded')` hook. The stub may need to live in `index.cds` or be
   explicitly added to the plugin's served model.
3. **Will the stub show up in OData routing?** An empty `service
   DataReplicationService` with `@protocol: 'none'` or no entities should not
   be exposed over HTTP. Verify by inspecting the running app's endpoints.

If any of these turn out to be blocking, fallback: skip the `.cds` stub, stay
with `cds.services[name] = instance` for registration. Mostly loses the tooling
integration, keeps the rest of the design intact.

## Out of scope

- Phase 6 event-driven sync (outboxed `REPLICATE.Completed`, messaging) — this
  plan sets the foundation but adds no new events.
- CQN adapter.
- Management UI.
- Any changes to the delegate pipeline.
