# Choosing a Strategy

`cds-data-federation` gives you **two strategies** and, on the delegate strategy, **two optional caching modes**. That is four runtime shapes for the same consumption view:

| # | Shape | Annotation |
|---|---|---|
| 1 | **Delegate** — live proxy, every read forwarded to the remote | `@federation.delegate` |
| 2 | **Delegate + response cache** — per-query result cached | `@federation.delegate: { cache: { strategy: 'response' } }` |
| 3 | **Delegate + entity cache** — full projection snapshot in local SQLite | `@federation.delegate: { cache: { strategy: 'entity' } }` |
| 4 | **Replicate** — scheduled sync into a real local table | `@federation.replicate` |

Caching is an **option on delegation**, not a separate strategy: it keeps live-proxy semantics and adds a freshness window. Replication is a genuinely different shape — the data physically lives in your database.

This page is the decision reference: a quick decision tree, a master comparison matrix, and — because the strategies differ most in what they *cannot* do — an explicit catalogue of limitations, including OData-protocol limits on delegation.

For the syntax of every option see [Annotations](annotations.md); for a per-strategy capability list see [Features](features.md); for positioning against non-plugin approaches see [Comparison with CAP](comparison.md).

---

## Quick decision tree

```
Do you need reads to reflect remote writes immediately (strong consistency)?
├─ YES ─ must never be stale, or data must not be stored locally
│        └─► DELEGATE (no cache)
│
├─ MOSTLY ─ live is fine but the remote is slow / rate-limited / costly
│        ├─ same queries repeat verbatim ............► DELEGATE + response cache
│        └─ arbitrary filters/sorts over one entity .► DELEGATE + entity cache
│
└─ NO ─ staleness is acceptable and you need one of:
         • SQL joins to local tables, GROUP BY, $apply, analytics
         • offline / remote-outage resilience
         • cross-service $expand served from local SQL
         └─► REPLICATE
```

Rule of thumb: **start with plain delegate.** Add a cache when a concrete latency/load problem appears; move to replicate when you need SQL power, offline resilience, or local joins that delegation cannot express.

---

## Master comparison matrix

| Decision signal | Delegate | Delegate + response cache | Delegate + entity cache | Replicate |
|---|---|---|---|---|
| **Freshness** | Always live | Live within TTL | Live within TTL | As of last sync run |
| **Where data lives** | Remote only | Cache backend (memory / Redis / …) | Secondary SQLite (per tenant) | Your app's DB table |
| **First-access cost** | One remote call per request | One remote call per distinct query | One remote **full-entity** read per TTL | One bulk sync per schedule |
| **Repeat-read cost** | One remote call each time | Cache hit (identical query) | Local SQL (any query) | Local SQL (any query) |
| **Arbitrary filters/sorts served locally** | — | Only identical queries | Yes (any CQN on the entity) | Yes |
| **Joins with local tables** | No | No | No (separate store) | **Yes** |
| **Aggregation / `GROUP BY` / `$apply`** | **No** (OData limit) | No | No | **Yes** (full SQL) |
| **Offline / remote-outage resilience** | No | Until TTL (stale) | Until TTL (stale) | **Full** — table always present |
| **Reduces remote load** | No | Yes (per query) | Yes (one read/TTL) | Yes (one sync/schedule) |
| **Write-back (CUD) to remote** | Opt-in, synchronous | Opt-in (cache not auto-invalidated) | Opt-in (cache not auto-invalidated) | Local write only; overwritten by next sync |
| **Cross-service `$expand` into this entity served locally** | No (live batch-fetch) | **No** — expand bypasses the cache | **No** — expand falls back to live remote | **Yes** — native SQL join |
| **Invalidation model** | n/a | Tags + TTL | TTL (pipeline reload on miss) | Schedule / manual run |
| **Per-tenant isolation** | Remote's concern | Auto tenant tag | One SQLite file per tenant | CAP MTX per-tenant DB |
| **Sensitive data kept off local disk** | Yes | Depends on backend | No (on local disk) | No (in local DB) |
| **Good fit for very large datasets** | Yes | Yes | Depends on entity size | Depends on schema |
| **Peer dependency** | — | `cds-caching` | `cds-data-pipeline` (+ `@cap-js/sqlite`) | `cds-data-pipeline` |

::: tip The two caches never serve a cross-service `$expand`
When a **local** entity `$expand`s into a delegated entity (see [Cross-service expand: local → remote](../concepts/cross-service-scenarios.md#cross-service-expand-local--remote)), the plugin batch-fetches the target straight from the remote service. That path does **not** go through the entity's own READ handler, so neither the response cache nor the entity cache is consulted — every such expand hits the remote. If you need that join to be cheap, use **replicate** (native local SQL join) instead. See [Caching](../integration/caching.md).
:::

---

## Delegate: OData-level capabilities and limits

Delegation forwards `remote.run(req.query)` and relies on CAP translating the query through the CDS projection chain. That means a delegated entity is only as capable as the remote **OData** protocol — several CQL/SQL features have no OData equivalent and are rejected.

Unless noted, the supported items work on **both OData V4 and V2**; several advanced options are **V4 only**.

### Supported

| Capability | Notes |
|---|---|
| Basic `$filter` (`eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`) | CAP-native. V4 + V2. |
| String functions `contains`, `startswith`, `endswith`, `tolower`, `toupper` | CAP-native. V4 + V2. |
| `$orderby`, `$select`, `$top`, `$skip`, `$count` | Column restriction follows the projection. V4 + V2. |
| `$expand` within the **same** remote ([Delegated expand](../concepts/cross-service-scenarios.md#delegated-expand)) | CAP-native. V4 + V2. |
| Nested `$expand` (`$expand=a($expand=b)`) | Recursive rename mapping. V4 + V2. |
| `$filter` / `$orderby` / `$top` / `$skip` **inside** `$expand` | **V4 only** (see V2 limitation below). |
| Navigation-path `$filter` through renamed associations (e.g. `buyer/name eq 'X'`) | Plugin translates the association rename. **V4 only**. |
| Lambda operators `any` / `all` on to-many | Plugin workaround. **V4 only**. |
| `$search` | CAP forwards it to the remote; searches string columns. **V4**. |
| Static `where` in the consumption view | Plugin injects the filter into every remote call — a value-add beyond CAP's native projection support. |
| Server-driven paging | When a remote caps a page below the requested `$top` (e.g. Northwind's 20-row default), the handler loops `$top`/`$skip` and preserves `@odata.count`. |
| CQL `SELECT.one`, `.columns()`, `.where()`, `.orderBy()`, `.limit()`, key shortcut, tagged templates | Through the application service. Renamed fields resolve correctly. |
| Error propagation | Remote HTTP status, message, and context reach the client. |

### Not supported on a delegate (OData-protocol limits)

| Feature | Why | Do this instead |
|---|---|---|
| **Aggregation** — `$apply`, CQL `.groupBy()` / `.having()` | CAP rejects `.groupBy` for remote services (*"Feature not supported: SELECT statement with .groupBy"*). OData delegation has no aggregation pushdown. | **Replicate**, then aggregate with local SQL — or use [`cds-data-materialization`](/materialization/). |
| **`SELECT.distinct`** | OData has no `DISTINCT`. | Replicate + local SQL. |
| **`.where()` with `like`** | OData has no `like` keyword. | Use `contains` / `startswith` / `endswith`. |
| **Pessimistic locking** — `forUpdate()` / `forShareLock()` | Locking is not an OData concept. | n/a (locking applies to local DB entities only). |
| **Streaming** — `stream()` / `pipeline()` / `foreach()` | These are `DatabaseService`-only APIs. | Replicate, then stream from the local table. |
| **Flatten associations / path expressions in the projection** (denormalization, e.g. `customer.name as buyerName`) | OData cannot denormalize (*"OData doesn't support denormalization"*). Works only when the remote is **HCQL** (CAP-to-CAP). | Use an HCQL provider, or replicate and flatten locally. See [Service Query Execution → HCQL](../concepts/service-query-execution.md#hcql--a-faster-wire-protocol-for-delegate-and-replicate). |
| **Cross-service path expressions** (local → remote via association in a projection) | `@cds.persistence.skip` on the delegate target prevents SQL compilation of the cross-service path. | Replicate the remote side, then it is an ordinary local path. |
| **REST protocol delegation** | CAP does not translate CQN to REST; `remote.run(req.query)` fails against a `rest` source. | Use **`@federation.replicate`** with a `rest` source config. |
| **Renamed fields inside nested-expand `$orderby`** (`$expand=orders($orderby=renamedField)`) | The consumer URL parser expects local names; the remote expects remote names; CAP does not translate renames inside nested expand options. | Order by a non-renamed field, or sort client-side. |
| **Nested `$expand` options on OData V2** (`$filter` / `$orderby` / `$top` / `$skip` inside `$expand`) | The V2 adapter silently ignores nested expand options. | Use V4, or filter/sort after expansion. |

### Write-back (CUD)

Delegated entities are **read-only by default**. Opt in per entity:

| Annotation | Effect |
|---|---|
| `writable: true` | Enables `CREATE` + `UPDATE` + `DELETE`. |
| `create` / `update` / `delete` | Enable one operation; overrides `writable`. |
| (disabled operation) | Returns **HTTP 405** rather than a DB error. |

CUD forwarding is **synchronous** — the client receives the remote's response (201/200/204). There is deliberately **no transactional-outbox write-through**: the outbox defers execution and returns no result, which breaks OData's request/response contract. (The outbox belongs in fire-and-forget scenarios like event notification and cache invalidation.) Note that a successful CUD does **not** auto-invalidate any cache — see below.

---

## Cross-service `$expand` and navigation

CAP resolves `$expand` and navigation **within a single service**. When an association crosses the local ↔ remote boundary, the plugin adds resolution. Support is identical whether the remote side is delegate or replicate (the plugin treats any annotated entity as a federation target), but the *fetch path* differs.

| Scenario | Supported | Fetch path |
|---|---|---|
| [Delegated expand](../concepts/cross-service-scenarios.md#delegated-expand) (same remote) | Yes | CAP-native, forwarded to the remote |
| [Cross-service expand: local → remote](../concepts/cross-service-scenarios.md#cross-service-expand-local--remote) | Yes — incl. to-many, composite keys, nested expand, inner `$filter`/`$orderby`/`$top`/`$skip`, lambdas | Batch-fetch from remote + stitch (**bypasses the target's cache**) |
| [Cross-service expand: cross-provider](../concepts/cross-service-scenarios.md#cross-service-expand-cross-provider) | Yes | Batch-fetch from each provider + stitch |
| [Cross-service expand: remote → local](../concepts/cross-service-scenarios.md#cross-service-expand-remote--local) | Yes — incl. per-parent `$top` | Forward remote, query local DB, stitch |
| [Cross-service navigation: local → remote](../concepts/cross-service-scenarios.md#cross-service-navigation-local--remote) | Yes — `$select` + `$filter` on target | Read local FK, delegate to remote |
| [Cross-service navigation: remote → local](../concepts/cross-service-scenarios.md#cross-service-navigation-remote--local) | Yes | Rewrite to FK-filtered local query |

::: warning Extra hop vs. a plain JOIN
A cross-service expand into a **replicate** entity still runs the batch-fetch/stitch path (the plugin treats it as a federation target), not a single SQL `JOIN` — correct, but an extra lookup hop. When a target can be a plain **local** (non-annotated) entity, prefer that as the join target for the fastest path.
:::

---

## Caching: response vs. entity, and their limits

Both caches attach to `@federation.delegate` only. Full option reference: [Annotations → Cache option](annotations.md#cache-option); mechanics: [Caching](../integration/caching.md).

| | Response cache (`strategy: 'response'`, default) | Entity cache (`strategy: 'entity'`) |
|---|---|---|
| Backend | `cds-caching` (memory / Redis / HANA / …) | Secondary SQLite (`db` or `data-federation-cache`) |
| Cache key | Full query signature (`$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$expand`) | The entity — any CQN answered from the snapshot |
| Warm-up | Lazy, per distinct query | One full remote read per TTL (or `preload`) |
| Invalidation | TTL + **tag** (`federation:<entity>`, plus static/dynamic/template tags) | TTL only (pipeline reload on miss) — no tag invalidation |
| Multitenancy | Auto `tenant-…` tag (opt out via `tenantScoped: false`) | One SQLite file per tenant; `static: true` for shared reference data |

### Caching limitations (both)

- **Cross-service `$expand` into the entity is never served from either cache** — it hits the remote (see the tip above).
- **No auto-invalidation on CUD.** After a write to a writable delegate, stale entries remain until TTL. Invalidate manually (`cache.deleteByTag('federation:<entity>')` for response) or use a short TTL.
- **Missing peer dependency degrades gracefully.** No `cds-caching` → response caching is skipped with a warning; no `cds-data-pipeline`/SQLite → entity caching is skipped and live delegation continues.

### Entity-cache — falls back to the live remote for

The entity cache holds only the **flat projected columns** of the remote entity in one SQLite table, so it forwards to the live remote whenever a query needs more than that table can answer:

- a **static `where`** on the consumption view,
- **lambda** (`any`/`all`) filters (routed to the direct-remote path),
- a **cross-service (remote → local) `$expand`** on the delegated entity,
- a navigation/lambda filter that was **rewritten to a local-FK `IN`** filter,
- `$search` when `search: false`,
- any SQLite read/reload **error** (transparent fallback).

There is deliberately **no scheduled entity-cache refresh** — the always-warm-local-copy use case converges on `@federation.replicate`; use `preload: true` / `wait: false` to avoid a user paying the reload wait.

---

## Replicate: capabilities and limits

Replication copies remote data into a real local table on a schedule; reads then run entirely as local SQL.

**Enables:** SQL joins to local tables, `GROUP BY` / `$apply` / analytics, offline and remote-outage resilience, cross-service `$expand` as a native join, streaming, and pessimistic locking — everything delegation's OData limits forbid. Delta sync supports **timestamp**, **key**, and **datetime-field** modes; writes are idempotent `UPSERT`; a `replicated` aspect stamps `lastReplicatedAt` / `lastReplicatedBy`.

**Limits:**

| Limitation | Detail |
|---|---|
| **Staleness** | Data is only as fresh as the last run. High-churn data that must be exact is a delegate case. |
| **No write-back** | Replicated tables are read-only mirrors. A local `POST`/`PATCH` writes locally, but the next sync treats the remote as source of truth and may overwrite it. Bidirectional sync is not supported. |
| **Soft-delete propagation** | Source-side deletions are **not** detected/removed today (no tombstone/diff). *Not started.* |
| **Reconciliation & dry-run** | No periodic drift comparison and no preview-without-write mode. *Not started.* |
| **Entity ordering** | Parent-before-child ordering for referential integrity is not inferred. *Not started.* |
| **OData delta tokens** | `$deltatoken` / `$deltalink` change tracking is not supported; use timestamp/key delta. *Not started.* |
| **Storage & schedule ops** | You own table growth and must monitor run history — a silently failing job is the most common cause of stale data. |

---

## Protocol support

Both strategies work over OData; only replication reaches plain REST.

| Protocol | `cds.requires` kind | Delegate | Replicate | Notes |
|---|---|---|---|---|
| **OData V4** | `odata` | Yes | Yes | Default and recommended. |
| **OData V2** | `odata-v2` | Yes | Yes | Needs `@cap-js-community/odata-v2-adapter`; nested `$expand` options unsupported; deprecated by SAP — prefer V4. |
| **HCQL** | `hcql` | Yes | Yes | CAP-native; enables flattened path expressions delegation otherwise cannot express. |
| **REST** | `rest` | **No** | Yes | CAP does not translate CQN to REST. Use replicate with a `rest` source config. |

---

## See also

- [Features](features.md) — the full per-strategy capability list.
- [Annotations](annotations.md) — every option on both annotations and the cache block.
- [Caching](../integration/caching.md) — response vs. entity mechanics, storage, and multitenancy.
- [Mixing delegate and replicate](../getting-started/mixing-delegate-and-replicate.md) — using both in one service.
- [Cross-service scenarios](../concepts/cross-service-scenarios.md) — the canonical `$expand` / navigation reference.
- [Comparison with CAP](comparison.md) — positioning against CAP samples, HANA-native, `@cap-js-community/common`, and platform tools.
