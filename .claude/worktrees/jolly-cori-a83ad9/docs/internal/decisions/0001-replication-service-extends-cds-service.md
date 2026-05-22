# 1. DataReplicationService extends cds.Service with REPLICATE.* event namespace

**Date:** 2026-04-17
**Status:** Accepted

## Context

`srv/DataReplicationService.js` is today a plain ES6 class. It holds a registry of
named replications, owns a scheduler, and owns a custom `EventEmitter`
(`srv/lib/EventEmitter.js`, ~130 LoC) that implements a `before → on → after`
pipeline over three phase events: `READ`, `MAP`, `WRITE`. It is exposed to the
outside via a second, proper CAP service — `DataFederationService` (the management
service in `srv/data-replication-management-service.cds`/`.js`) — which extends
`cds.ApplicationService` and delegates to the plain-class instance via the global
stash `cds._dataFederation.replicationService`.

This layering was pragmatic: the plain class kept us unblocked while we built the
READ→MAP→WRITE pipeline, and the CAP-native management service handled the
OData surface. But it costs us:

1. **~130 LoC of bespoke event dispatching** (`EventEmitter.js` + `ReplicationRequest.js`)
   that parallels what `cds.Service` already provides natively.
2. **A global stash** (`cds._dataFederation.replicationService`) used as a service
   locator because there's no CDS definition to hang off of for `cds.connect.to`.
3. **Different hook semantics** from the rest of the plugin — delegate handlers
   use `srv.on/before/after` on real `cds.Service` instances; only replication is
   the odd one out.
4. **No `cds.context`, `cds.outboxed`, or request-scoped tracing** integration,
   which we will need in Phase 6 (event-driven sync).

The question: should `DataReplicationService` extend `cds.Service`, and if so, how
does the pipeline (READ → MAP → WRITE, with user hooks between phases) map onto
CAP's native event dispatch without colliding with CRUD semantics?

### Options considered

- **Keep the plain class** until Phase 6, then migrate.
- **Extend `cds.ApplicationService`** and merge the management service into the
  runtime. Rejected: conflates two concerns (OData integration surface vs. batch
  orchestrator) and exposes internal methods over HTTP.
- **Extend `cds.Service`** with custom pipeline events in a dedicated namespace.
  Selected.

### Concerns investigated via spike

CAP's `srv-dispatch.js` and `srv-handlers.js` at `@sap/cds` 8.9.9 were read, and a
working spike was run against a non-CRUD `REPLICATE.READ/MAP/WRITE` pipeline to
confirm:

- **`srv.dispatch(req)` works for non-CRUD events.** Custom event names are
  treated as opaque strings by the handler filter (`srv-handlers.js:132-135`).
- **Handler-chain (interceptor) semantics require `req.reply` to be set.**
  Without it, `on` handlers run in parallel (`srv-dispatch.js:58-68`). With it,
  they run sequentially with `next()` fall-through — the pipeline semantic we
  want. Setting `req.reply = (x) => { req.results = x }` on constructed Requests
  is sufficient.
- **3-arg `srv.before(event, path, handler)` works for arbitrary path strings.**
  CAP canonicalizes `path` to `${srv.name}.${path}` (`srv-handlers.js:81`). Setting
  `req.path` to the same value gives clean string matching. Hooks for
  replication `'Products'` do not fire for `'Customers'`.
- **`WRITE` alone is a CAP CRUD alias** for `CREATE`+`UPSERT`+`UPDATE`
  (`srv-handlers.js:54-57`). Bare `WRITE` would be catastrophic. `REPLICATE.WRITE`
  does not match because the handler filter uses `===` (exact equality).
- **`after` hook signature is `(results, req)`** per CAP convention
  (`srv-dispatch.js:76-77`). For non-READ events, `results` is `req.results`
  (often `undefined`). Users read from the second argument.
- **Multiple `before/after` hooks for the same `(event, path)` run in parallel**
  via `Promise.all`. This differs from the current `EventEmitter`, which keeps
  only the last-registered handler. CAP's behavior is strictly better (doesn't
  silently drop hooks) but composing multiple hooks must not depend on ordering.
  `srv.prepend(...)` remains available for explicit ordering.

## Decision

**Migrate `DataReplicationService` to extend `cds.Service` now, using namespaced
`REPLICATE.*` events dispatched via `srv.dispatch(cds.Request)`. Keep the public
hook API shape (`srv.before/on/after(event, replicationName, handler)`) exactly
as today — it maps 1:1 onto CAP's native registration.**

Concrete shape:

- Add `srv/replication-service.cds` stub:
  ```cds
  namespace plugin.data_federation;
  service DataReplicationService;
  ```
  This gives us CAP auto-wiring (`srv/DataReplicationService.js` picked up by
  name), makes `cds.connect.to('DataReplicationService')` work, and removes the
  need for `cds._dataFederation.replicationService`.
- Events use the `REPLICATE.` prefix, uppercase phase suffix:
  `REPLICATE.READ`, `REPLICATE.MAP`, `REPLICATE.WRITE`. Uppercase matches CAP's
  CRUD/action convention; the prefix prevents collision with CAP's reserved
  CRUD aliases (`READ`, `WRITE`, `SAVE`).
- `DataReplication.execute()` constructs `cds.Request` instances with
  `{ event: 'REPLICATE.PHASE', path: '<srv>.<name>', data: {...} }`, sets
  `req.reply` to force interceptor semantics, and calls `this.srv.dispatch(req)`.
- Per-replication default handlers (`_defaultReadHandler`, etc.) are registered
  in an internal router that dispatches from the single service-level
  `on('REPLICATE.READ', ...)` handler. This avoids depending on CAP resolving
  replication names as CSN entities.
- `srv/lib/EventEmitter.js` and `srv/lib/ReplicationRequest.js` are deleted.

### Event naming rationale

`REPLICATE.READ` beats alternatives:

| Candidate | Verdict |
|---|---|
| `READ` / `MAP` / `WRITE` | Collides with CAP CRUD (`READ`) and CRUD-alias (`WRITE` → CREATE+UPSERT+UPDATE). Rejected. |
| `sync.read` / `sync.map` / `sync.write` | Lowercase breaks CAP idiom; `sync` is ambiguous (delegation cache warmup is also "sync-like"). Rejected. |
| `REPLICATE.READ` / `.MAP` / `.WRITE` | Uppercase phase matches CAP's `CREATE/READ/UPDATE/DELETE`. Namespaced by domain verb. Accepted. |
| `REPLICATE.Completed` (future) | Reserved for Phase 6 domain events. CamelCase follows CAP convention for emitted/outboxed events (e.g., `BookingCompleted`). |

## Consequences

### What this enables

- **Drop ~150 LoC** of custom event infrastructure (`EventEmitter.js` +
  `ReplicationRequest.js`).
- **Drop the `cds._dataFederation.replicationService` global** — the management
  service and tests use `cds.connect.to('DataReplicationService')` instead.
- **`cds.context` propagation** (tenant, user, correlation id) flows through
  `cds.Request` into every phase handler automatically.
- **Phase 6 readiness.** Event-driven sync needs `cds.outboxed(this).emit(...)`
  for business events (`REPLICATE.Completed`, `REPLICATE.Failed`); this is free
  once we're a `cds.Service`.
- **Uniform hook API** with the rest of the plugin. Delegate handlers and
  replication hooks both use `srv.before/on/after`.

### What we accept as trade-offs

- **`after` hook signature is `(results, req)`**, not `(req)`. Users reading
  `req.data.statistics` in `after('REPLICATE.WRITE', ...)` take the second arg.
  Documented in `README.md` and `CLAUDE.md`.
- **Multiple hooks run in parallel, not sequentially.** Users composing multiple
  `before.REPLICATE.MAP` handlers must not depend on ordering; if they need
  ordering, use `srv.prepend(...)`. This is standard CAP convention.
- **`req.reply` must be set on constructed Requests** to force interceptor-chain
  semantics (required for single-winner `on` handler behavior). Encapsulated in
  a helper method so pipeline code never forgets it.
- **Internal router for per-replication dispatch.** Rather than rely on CAP's
  `this.on(event, entityName, handler)` matching logic (which expects a CSN entity
  path), we register a single `on('REPLICATE.PHASE', ...)` that routes by
  `req.data.replication`. User-facing hooks still use `(event, replicationName,
  handler)` via CAP's native path matcher — only the defaults go through the
  router. This keeps the public API idiomatic while avoiding CSN resolution
  surprises.

### Follow-up work (Phase 6)

- Add outboxed domain events: `REPLICATE.Completed`, `REPLICATE.Failed`,
  `REPLICATE.BatchProcessed` — emitted via `cds.outboxed(this).emit(...)`.
- Expose `cds.connect.to('DataReplicationService')` as the documented way for
  application code to trigger replications programmatically.

### Risks

- **Not all replication tests currently exercise `cds.context` propagation.**
  After migration, tenant-scoped replications must be validated end-to-end.
- **The CDS stub service registration** is idiomatic but our
  `test/consumer/srv/consumer-service.cds` does not currently reference it.
  Verify that `cds.test()` picks it up from the plugin's own `srv/` folder.

## References

- [CLAUDE.md](https://github.com/mikezaschka/cds-data-federation/blob/main/CLAUDE.md) — sections "Architecture", "Plugin lifecycle",
  Phase 6 roadmap
- [Feature Matrix](../../reference/requirements.md) — Phase 6 (Event-driven sync)
- `srv/DataReplicationService.js` — current plain-class implementation
- `srv/lib/EventEmitter.js` — custom event dispatcher being retired
- `srv/lib/DataReplication.js` — pipeline driver being refactored
- `srv/data-replication-management-service.js` — currently reads from the
  `cds._dataFederation` global; will switch to `cds.connect.to(...)`
- `@sap/cds` 8.9.9: `lib/srv/cds.Service.js`, `lib/srv/srv-dispatch.js`,
  `lib/srv/srv-handlers.js` — validated via a spike on 2026-04-17
- [Completed migration plan](../plans/completed/migrate-replication-service-to-cds-service.md) —
  task breakdown for implementation
