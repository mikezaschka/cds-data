# Service Query Execution in CAP

How queries reach the plugin's delegate handlers — and what happens when they don't.

---

## The dispatch pipeline

Every CQL query in CAP must be dispatched through a **service**. Which service receives the query determines whether the plugin's `@federation.delegate` handlers fire.

```
                       ┌──────────────────────────────────┐
                       │     Constructing the query        │
                       │  SELECT.from(Products).where(…)   │
                       └───────────────┬──────────────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 │                     │                     │
                 ▼                     ▼                     ▼
          await query            srv.run(query)         GET /odata/v4/…
          cds.run(query)         srv.read(Entity)       HTTP request
          cds.db.run(query)      srv.get(Entity)
                 │                     │                     │
                 ▼                     ▼                     ▼
          ┌────────────┐     ┌──────────────────┐    ┌──────────────────┐
          │ cds.db      │     │ ApplicationService│    │ OData Adapter    │
          │ (Database   │     │ (e.g. Consumer-  │    │ creates Request, │
          │  Service)   │     │  Service)        │    │ dispatches to    │
          └──────┬─────┘     └────────┬─────────┘    │ ApplicationService│
                 │                    │               └────────┬─────────┘
                 │                    ▼                        │
                 │           ┌──────────────────┐             │
                 │           │ srv.dispatch()    │◀────────────┘
                 │           │  └─ srv.handle()  │
                 │           │    ├─ .before()   │
                 │           │    ├─ .on() ◀──── plugin handler fires here
                 │           │    └─ .after()    │
                 │           └────────┬─────────┘
                 │                    │
                 ▼                    ▼
          ┌────────────┐     ┌──────────────────┐
          │ SQL against │     │ remote.run(query) │
          │ local DB    │     │ → OData call to   │
          │ (SQLite/    │     │   remote provider │
          │  HANA)      │     └──────────────────┘
          └────────────┘
```

The left path (direct DB access) **bypasses all application service handlers**. The center and right paths go through the service dispatch pipeline where the plugin's `on('READ')` handler is registered.

---

## Access patterns and the plugin

The plugin registers its delegate handler on the **application service** (e.g. `ConsumerService`) via `service.prepend()`:

```js
service.prepend(function () {
    service.on('READ', entityName, async (req) => {
        const remote = await cds.connect.to(sourceServiceName)
        let results = await remote.run(effectiveQuery)
        return results
    })
})
```

This is the standard CAP pattern for delegation — see `req => remote.run(req.query)` in the [xtravels sample](https://github.com/capire/xtravels). The handler intercepts READ requests **on the application service** and forwards them to the remote OData service.

### Which access patterns trigger delegation?

| Pattern | Dispatched through | Plugin handler fires? | Result |
|---|---|---|---|
| `GET /odata/v4/consumer/Products` | ConsumerService (via OData adapter) | **Yes** | Remote data returned |
| `srv.run(SELECT.from(Products))` | ConsumerService | **Yes** | Remote data returned |
| `srv.read(Products)` | ConsumerService | **Yes** | Remote data returned |
| `await SELECT.from(Products)` | **cds.db** (DatabaseService) | No | Empty / error (no local table) |
| `cds.run(SELECT.from(Products))` | **cds.db** (DatabaseService) | No | Empty / error (no local table) |
| `cds.db.run(SELECT.from(Products))` | **cds.db** (DatabaseService) | No | Empty / error (no local table) |

### Why does bare `await` go to `cds.db`?

From the [CAP documentation on cds.ql](https://cap.cloud.sap/docs/node.js/cds-ql#awaiting-queries):

> "you can just `await` a constructed query, which by default passes the query to `cds.db.run()`"

And from the [cds facade docs](https://cap.cloud.sap/docs/node.js/cds-facade#cds-db):

> `cds.db` is "A shortcut to `cds.services.db`" and `await SELECT.from(Books)` is "a shortcut for `cds.db.run(SELECT.from(Books))`"

This is the intended behavior for local entities where the database is the source of truth. But for federated entities, the source of truth is the remote service. The query must go through the application service so the plugin's handler can intercept it and forward to the remote.

---

## Correct usage per context

### In an event handler

Inside a service implementation (e.g. `this.on('READ', ...)` on `ConsumerService`), `this` is a transactional derivative of the service. Use `this.run()` or the CRUD convenience methods to query other entities on the same service:

```js
class ConsumerService extends cds.ApplicationService {
    init() {
        this.on('someAction', async (req) => {
            const { Products } = this.entities
            // Correct: goes through ConsumerService → plugin handler fires
            const products = await this.run(SELECT.from(Products))
            // Also correct:
            const products2 = await this.read(Products)
        })
        return super.init()
    }
}
```

Do NOT use bare `await SELECT.from(Products)` inside a handler if you need the federation pipeline. That would bypass the service and go straight to the (empty) local database.

### In tests

The test suite uses `cds.connect.to('ConsumerService')` to get the service instance, then dispatches queries through it:

```js
const cds = require('@sap/cds')

describe('Tests', () => {
    const { GET, expect } = cds.test(__dirname + '/consumer/')
    let cs, Products

    beforeAll(async () => {
        cs = await cds.connect.to('ConsumerService')
        ;({ Products } = cs.entities)
    })

    // Via HTTP (OData URL) — goes through ConsumerService
    it('via HTTP', async () => {
        const { data } = await GET('/odata/v4/consumer/Products')
    })

    // Via service API (CQL) — also goes through ConsumerService
    it('via service', async () => {
        const products = await cs.run(SELECT.from(Products))
    })

    // WRONG — bypasses ConsumerService, goes to cds.db
    it('BROKEN for delegate entities', async () => {
        const products = await SELECT.from(Products) // → empty!
    })
})
```

`cds.test()` boots the full CAP server in-process. Both `GET` (HTTP) and `cs.run` (programmatic) dispatch through `ConsumerService` where the plugin handler is registered.

The test file [`packages/cds-data-federation/test/integration/`](https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-federation/test/integration) demonstrates both patterns:
- HTTP tests use `GET('/odata/v4/consumer/...')`
- CQL tests use `cs.run(SELECT.from(...))`

### In the CDS REPL

When exploring federated entities in the REPL, you must connect to the application service explicitly:

```js
// Start the REPL with the consumer app
// $ cds repl --run test/consumer/

// WRONG — goes to cds.db, returns nothing for delegate entities
> await SELECT.from('ConsumerService.Products')
[]

// CORRECT — dispatch through the application service
> var cs = await cds.connect.to('ConsumerService')
> await cs.read('Products')
[ { productId: 'P001', productName: 'Laptop Pro', ... }, ... ]

// Also correct — explicit srv.run
> var { Products } = cs.entities
> await cs.run(SELECT.from(Products))
[ ... ]
```

This is a common gotcha. The blog post [CDS expressions in CAP — notes on Part 5](https://qmacro.org/blog/posts/2026/04/07/cds-expressions-in-cap-notes-on-part-5/) by DJ Adams shows REPL queries like `await SELECT.from(Authors)` — these work because the bookshop sample has local database tables. For federated entities without local tables, the same syntax returns nothing. You must route through the service.

### In standalone Node.js code

Any Node.js code outside of a CAP server context needs to boot the CAP runtime first:

```js
const cds = require('@sap/cds')

async function main() {
    // Boot the CAP server (loads model, serves services, connects DB)
    await cds.connect.to('db')
    await cds.serve('all').from(await cds.load('*'))

    // Now connect to the application service
    const cs = await cds.connect.to('ConsumerService')
    const { Products } = cs.entities

    // Dispatch through the service — plugin handler fires
    const products = await cs.run(SELECT.from(Products))
}
```

Alternatively, use `cds.test()` which handles the full bootstrap:

```js
const cds = require('@sap/cds')
const test = await cds.test('.')

const cs = await cds.connect.to('ConsumerService')
const products = await cs.read('Products')
```

---

## Direct database access (db.run) and consumption views

### What are consumption views in the database?

CDS consumption views like `entity Products as projection on remote.Products { ... }` are translated to **database views** — if a table/view exists at all. For the two federation strategies:

| Strategy | `@cds.persistence.skip` | Local DB artifact | `db.run(SELECT.from(Entity))` result |
|---|---|---|---|
| `@federation.delegate` | `true` (default for external projections) | No table, no view | Error or empty result |
| `@federation.replicate` | `false` (set by annotation scanner) | Real table with synced data | Returns locally cached data |

### Delegate entities: no local data

For `@federation.delegate` entities, the annotation scanner does NOT create a local persistence artifact. The entity only exists as a CDS definition in the model — there is no SQLite/HANA table behind it. Querying it via `cds.db` results in an error or empty result set because the database has nothing to return.

The data lives exclusively on the remote service. The only way to access it is through the application service, where the plugin's handler forwards the query to the remote.

### Replicate entities: stale but queryable

For `@federation.replicate` entities, the annotation scanner explicitly sets `@cds.persistence.skip: false`, creating a real local table. The replication engine periodically syncs data from the remote service into this table via UPSERT.

Querying a replicate entity via `cds.db.run()` **does work** — it returns whatever data was last synced. This is sometimes desirable (e.g. for SQL joins with other local entities, analytics queries, or offline access). However, it bypasses any freshness logic, cache TTL, or event hooks that the plugin might provide through the service layer.

### Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    delegate entity                               │
│                                                                 │
│  srv.run(query)  ──→  plugin handler  ──→  remote OData call    │
│  db.run(query)   ──→  local DB  ──→  ERROR / empty              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    replicate entity                              │
│                                                                 │
│  srv.run(query)  ──→  plugin handler  ──→  local DB (managed)   │
│  db.run(query)   ──→  local DB  ──→  stale data (works, but    │
│                                       bypasses plugin logic)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## How cds.connect.to resolves services

When you call `cds.connect.to('ConsumerService')`, CAP checks `cds.services` for an already-served instance. Since `ConsumerService` was created by `cds.serve()` during bootstrap, `cds.connect.to` returns that same in-process instance — it does NOT create a new remote connection.

From the [CAP documentation on cds.services](https://cap.cloud.sap/docs/node.js/cds-connect#cds-services):

> "As services constructed by `cds.serve` are registered with `cds.services` as well, a connect finds and returns them as **local service connections**."

This is why `cs.run(query)` dispatches through the full handler pipeline including `before`/`on`/`after` — it's the same in-process service instance that handles HTTP requests.

In contrast, `cds.connect.to('ProviderService')` with `kind: 'odata'` creates a **remote service proxy** that translates CQN to OData HTTP requests. These are the remote services that the plugin's delegate handler calls internally.

---

## CDS 10, HCQL and MCP

CAP's June 2026 release (**cds 10**) adds two capabilities that compose with federation **without any change to `@federation.*` annotations**. Both build on the same principle as the rest of this page: queries reach the plugin only when they are dispatched through the application service.

### HCQL — a faster wire protocol for delegate and replicate

**HCQL** (CQL over HTTP) is a new CAP protocol adapter that carries a CQN `SELECT` as an HTTP request, rather than translating it to OData `$filter` / `$select`. For **CAP-to-CAP** integration, CAP's remote client **auto-selects HCQL** over OData when the provider serves `@hcql` (as xflights / xtravels do). CAP describes HCQL as *"best suited, and thus chosen automatically for data federation scenarios."*

The plugin never serializes the wire protocol itself — it forwards CQN via `remote.run(query)`. So both strategies benefit transparently:

| Strategy | Read path | HCQL benefit |
|---|---|---|
| `@federation.delegate` | `remote.run(req.query)` on the application service | Auto-selected when the remote serves `@hcql`; richer path expressions (flattened associations like `customer.name`) that OData-only remotes cannot express |
| `@federation.replicate` | Pipeline READ phase via the engine's `RemoteCqnAdapter` | Same class handles OData V2/V4 and HCQL — CAP negotiates the wire protocol; delta paging is unchanged |

There is **no `@federation.hcql` strategy** and no adapter to pick — HCQL is a CAP-runtime choice. To use it, annotate the CAP provider `@hcql @odata` and bind the consumer as usual (`kind: 'odata'`, V4). See the engine-side write-up in [Pipeline → Remote CQN sources (OData & HCQL)](/pipeline/guide/sources/odata) for the adapter details and the flattened-column behaviour.

### MCP — exposing federated data to AI agents

CAP's [`@cap-js/mcp`](https://cap.cloud.sap/docs/guides/protocols/mcp) protocol adapter exposes a service to AI agents over the **Model Context Protocol**. Annotate a service `@mcp: 'agent'` and its entities become MCP tools (`describe`, `query`, `call_action`).

Because MCP `query` calls run **CQN on the application service** — exactly the center path in the [dispatch diagram](#the-dispatch-pipeline) above — they hit the same `@federation.delegate` / `@federation.replicate` handlers that OData and `srv.run` do. MCP does **not** call remote providers directly:

```
 AI agent ──tools/call query──▶ @mcp service ──srv.run(CQN)──▶ federation handler
                                                              ├─ delegate → remote provider
                                                              └─ replicate → local synced table
```

This means an MCP agent gets live-proxied remote data (delegate), locally synced data (replicate), or cached responses — with no MCP-specific federation code. A runnable end-to-end demo lives in [MCP integration](/federation/integration/mcp).

---

## References

- [CAP: Core Services — srv.run()](https://cap.cloud.sap/docs/node.js/core-services#srv-run-query) — dispatches queries through the service pipeline
- [CAP: cds.ql — Executing Queries](https://cap.cloud.sap/docs/node.js/cds-ql#awaiting-queries) — bare `await` routes to `cds.db`
- [CAP: cds Facade — cds.db](https://cap.cloud.sap/docs/node.js/cds-facade#cds-db) — `cds.db` is the primary database service
- [CAP: Connecting to Required Services](https://cap.cloud.sap/docs/node.js/cds-connect) — `cds.connect.to` and service caching
- [CAP: Testing with cds.test](https://cap.cloud.sap/docs/node.js/cds-test) — how `cds.test()` boots a server and provides service APIs
- [CDS expressions in CAP — notes on Part 5](https://qmacro.org/blog/posts/2026/04/07/cds-expressions-in-cap-notes-on-part-5/) — REPL query examples (local DB dispatch)
- [CAP: Service Integration — Delegation](https://cap.cloud.sap/docs/guides/integration/calesi#delegation) — the `req => remote.run(req.query)` pattern
- [CAP: June 2026 release — HCQL protocol adapter](https://cap.cloud.sap/docs/releases/2026/jun26#new-hcql-protocol-adapter) — CQL over HTTP, auto-selected for CAP-to-CAP federation
- [CAP: MCP protocol adapter](https://cap.cloud.sap/docs/guides/protocols/mcp) — exposing CAP services to AI agents over the Model Context Protocol
