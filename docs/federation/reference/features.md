# Features

What `cds-data-federation` does today, grouped by capability. Every entry on this page is available in the current release. Annotation syntax and option reference are in [Annotations](annotations.md); scenario names follow [Cross-Service Scenarios](../concepts/cross-service-scenarios.md). To decide *which* strategy fits a given entity — with limitations side by side — see [Choosing a Strategy](choosing-a-strategy.md).

## Consumption views

The CDS projection on a remote entity defines the schema contract — what fields, what shape, what renames. See [Consumption Views](../concepts/consumption-views.md) for the full pattern catalog.

| Pattern | Example | Notes |
|---|---|---|
| **Wildcard projection** | `as projection on remote.X { * }` | All remote fields projected. |
| **Column restriction + field renames** | `as projection on remote.X { ID as productId, price as unitPrice }` | Bidirectional local ↔ remote mapping. `$select` on the remote is restricted to the projected set. |
| **Excluding columns** | `as projection on remote.X excluding { modifiedAt }` | Excluded fields are omitted from `$select` and absent from responses. |
| **Static `where` clause** | `as projection on remote.X where status = 'active'` | Filter is injected into every remote query for this entity. Composes with client filters. |
| **Entity-level rename** | `entity Suppliers as projection on remote.Customers { … }` | Project a remote entity under a different local name and domain purpose. |

## Delegate strategy

Transparent live proxy. Annotate a consumption view with `@federation.delegate` and the plugin forwards reads to the remote service at request time. Reference: [`@federation.delegate`](annotations.md).

| Capability | What it does |
|---|---|
| **Declarative handler registration** | Adding `@federation.delegate` to a projection wires the read handler automatically. |
| **Query translation** | `$select`, `$filter`, `$orderby`, and `$expand` are translated through the CDS projection chain so client-side names always refer to the local model. |
| **Column-restricted fetch** | Requests to the remote only include fields the consumption view projects. |
| **Server-driven paging** | When a remote caps responses below the client's requested `$top` (e.g. Northwind's 20-row default), the handler loops `$top`/`$skip` until the client is satisfied. `@odata.count` is preserved. |
| **Full query passthrough** | Arbitrary combinations of `$filter` / `$orderby` / `$select` / `$top` / `$skip` / `$expand` work on any delegate entity, V4 and V2. |
| **[Delegated expand](../concepts/cross-service-scenarios.md)** | Same-remote `$expand` is handled by CAP's native query translation. |
| **[Cross-service expand: local → remote](../concepts/cross-service-scenarios.md#cross-service-expand-local-remote)** | When a local entity `$expand`s to a delegate entity, the plugin batch-fetches from the remote and stitches results — including cross-provider and composite-key cases. |
| **[Cross-service expand: remote → local](../concepts/cross-service-scenarios.md#cross-service-expand-remote-local)** | When a delegate entity `$expand`s to a local entity, the plugin forwards the remote portion, queries local for the targets, and stitches. `$filter` / `$orderby` / `$top` inside the expand are respected. |
| **Navigation path filters** | `$filter` through renamed or cross-service associations (e.g. `buyer/name eq 'Acme'`, or `LocalEntity/Name eq 'X'` on a delegate with a local backlink) is translated for same-service and both cross-service directions (to-one and lambda). |
| **Cross-service navigation** | URL navigation across a local/remote boundary — `/Reviews(id)/product` or `/Customers('C001')/bookmarks` — is resolved transparently. Supports `$select` and `$filter` on the target. |
| **Opt-in CUD forwarding** | Writes are off by default. Enable all three with `writable: true` or pick individual flags (`create`, `update`, `delete`). Synchronous — clients get the remote's response. |
| **Error propagation** | Remote status codes, messages, and context reach the client. |

## Replicate strategy

Scheduled sync that copies remote data into the local database. Once replicated, queries run fully locally — joinable, aggregatable, offline-capable. Reference: [`@federation.replicate`](annotations.md). Every replicate entity binds to an entity-shape job on [cds-data-pipeline](/pipeline/); pipeline intent is **derived** from the config shape (see [inference rules](/pipeline/guide/concepts/inference)).

| Capability | What it does |
|---|---|
| **Full sync** | Truncate (multi-source aware) and replace. |
| **Delta sync** | Three delta modes: timestamp-based, key-based, and datetime-fields via adapter options. |
| **Streaming batch reads** | Async-generator pipeline with configurable batch size. Only projected columns are fetched. |
| **Idempotent writes** | Every batch is applied via `UPSERT` — safe to re-run. |
| **Auto-persistence** | `replicate` entities automatically get `@cds.persistence.table: true`; no manual table setup. |
| **Pipeline events** | `before` / `on` / `after` hooks on `PIPELINE.READ`, `PIPELINE.MAP`, `PIPELINE.WRITE` for custom transformation or filtering logic — see the [pipeline event hooks reference](/pipeline/reference/management-service#event-hooks). |
| **Rename mapping during MAP** | Field renames from the consumption view are applied during the MAP phase — no per-entity mapping code. |
| **Replicated aspect** | `lastReplicatedAt` / `lastReplicatedBy` are auto-populated on every record. |

## Caching

Two optional strategies on `@federation.delegate` (and a rarely useful response cache on replicate). See [Integration → Caching](../integration/caching.md).

| Capability | What it does |
|---|---|
| **Response cache** (`strategy: 'response'`, default) | Wraps the remote READ with [`cds-caching`](https://github.com/mikezaschka/cds-caching); cache key = full query signature. |
| **Entity cache** (`strategy: 'entity'`) | On TTL miss, runs [`cds-data-pipeline`](/pipeline/) to fill a SQLite table with the full projected entity; any READ CQN hits SQLite until TTL. **One SQLite file per tenant** when `data-federation-cache` is configured. Falls back to live delegate on errors. |
| **Per-entity TTL** | `cache: { ttl: 60000 }` on either strategy. |
| **Tag-based invalidation** | `response` only — auto-tag `federation:<entityName>`, static/dynamic/template tags via `cds-caching`. |
| **Backend flexibility** | `response`: in-memory, Redis, HANA, … via `cds-caching`. `entity`: primary `db` or optional `cds.requires.'data-federation-cache'` SQLite. |
| **Configurable cache service** | `cache.service` selects a `cds-caching` instance (`response` only). |
| **Hit / miss metrics** | `cds-caching` statistics API (`response`). |
| **Graceful degradation** | Missing `cds-caching` → skip `response` with warning. Missing pipeline/SQLite → skip `entity` with warning; live delegate continues. |

## Cross-service scenarios

Summary — see [Cross-Service Scenarios](../concepts/cross-service-scenarios.md) for the full scenario reference.

| Scenario | Supported |
|---|---|
| [Delegated expand](../concepts/cross-service-scenarios.md) | Yes (CAP-native). |
| [Cross-service expand: local → remote](../concepts/cross-service-scenarios.md#cross-service-expand-local-remote) | Yes — including to-many, composite keys, cross-provider, nested expand, `$filter` / `$orderby` / `$top` / `$skip` inside the expand, and lambda operators. |
| [Cross-service expand: remote → local](../concepts/cross-service-scenarios.md#cross-service-expand-remote-local) | Yes — including per-parent `$top` limiting. |
| [Cross-service expand: cross-provider](../concepts/cross-service-scenarios.md#cross-service-expand-cross-provider) | Yes. |
| [Cross-service navigation: local → remote](../concepts/cross-service-scenarios.md#cross-service-navigation-local-remote) | Yes — `$select` and `$filter` on the target supported. |
| [Cross-service navigation: remote → local](../concepts/cross-service-scenarios.md#cross-service-navigation-remote-local) | Yes. |

## CQN safety

| Capability | What it does |
|---|---|
| **CQN clone on mutation** | Delegate handlers clone queries before any modification — changes never leak back into CAP's request pipeline. |

## Configuration

| Capability | What it does |
|---|---|
| **Annotation-driven** | Zero configuration for standard scenarios — `@federation.delegate` or `@federation.replicate` on a consumption view is enough. |
| **Profile-based overrides** | Different settings per CAP environment profile (`[development]`, `[production]`, …) via the native `cds.env` mechanism. |
| **Sensible defaults** | Read-only CUD for delegate; delta mode for replicate; batch size 1000; 10-minute replicate schedule. |
