# Targets

The **target** side of a pipeline owns the `PIPELINE.WRITE_BATCH` phase plus the pre-write clear (`truncate` / `deleteSlice`) that full-refresh and partial-refresh modes need. A target adapter reports its `capabilities()` so `addPipeline` can reject incompatible configs at registration time rather than halfway through the first run.

Every write is dispatched through the resolved target adapter. Non-`db` targets without a `target.adapter` class reference are rejected at registration — there is no silent fallback to the local DB.

## Resolution order

`addPipeline(...)` resolves the target adapter in this order:

1. `config.target.adapter` — class reference extending `BaseTargetAdapter`. Full control; takes precedence over `target.service`.
2. `config.target.service` unset or `'db'` → built-in `DbTargetAdapter`.
3. `config.target.kind` (`'odata' | 'odata-v2'`) — explicit transport selector. Takes precedence over the connected service's auto-detected kind.
4. Auto-detected `service.options.kind` (`'odata' | 'odata-v2'`) on the connected remote service → built-in `ODataTargetAdapter`.
5. Any other `config.target.service` with no `target.adapter` → **registration error** pointing to [Custom target adapter](custom.md).

## Built-in target adapters

| Adapter | Resolved when | Capabilities | Page |
|---|---|---|---|
| `DbTargetAdapter` | `target.service` unset or `'db'` | `batchInsert`, `keyAddressableUpsert`, `batchDelete`, `truncate` | [Local DB](db.md) |
| `ODataTargetAdapter` | `target.kind` is `'odata' / 'odata-v2'`, or the connected service advertises that kind | `batchInsert`, `keyAddressableUpsert`, `batchDelete`, `truncate` | [OData](odata.md) |
| Any other transport | Register a [custom target adapter](custom.md) | Whatever the adapter advertises |  |

- **[Local DB](db.md)** — The default. Resolved automatically when `target.service` is unset or `'db'`. Writes `UPSERT` / `INSERT` / `DELETE` via CAP's `cds.connect.to('db')`.

- **[OData](odata.md)** — Forward writes to a remote OData V2 / V4 service through CAP's remote runtime — `UPSERT.entries(...)` → POST / PUT / PATCH, with `$batch` change sets where the provider supports them.

- **[Custom target adapter](custom.md)** — Extend `BaseTargetAdapter` for non-db, non-OData destinations (message buses, custom HTTP APIs, …). Worked example: a reporting service over `srv.send()`.

## Capability gating

`addPipeline` rejects incompatible configs by consulting the target adapter's `capabilities()`:

| Config | Required capability |
|---|---|
| `mode: 'delta'` | `keyAddressableUpsert` |
| `mode: 'full'` | `truncate` **or** `batchDelete` |
| `source.query` (query-shape) | `batchInsert` |

Omitted keys default to `false`. Report only what your adapter actually supports — `addPipeline` rejects users at registration rather than halfway through the first run. The default `DbTargetAdapter` reports all four capabilities as `true`.

## Transactional semantics

Query-shape (snapshot) pipelines run inside a `cds.tx` transaction — so `truncate` / `deleteSlice` + batch `INSERT`s commit atomically and a mid-run crash leaves the previous snapshot intact. Entity-shape (UPSERT) pipelines run without an outer transaction: each batch commits on its own so partial progress survives interruptions.

Target adapters do not have to manage `cds.tx` themselves; they inherit the ambient `cds.context` / transaction. Custom remote-protocol adapters (e.g. a reporting-service adapter) need to surface their own atomicity guarantees at the service boundary — `cds.tx` does not span remote HTTP calls.

## See also

- [Concepts → Inference rules](../concepts/inference.md) — target adapter selection and the full registration matrix.
- [Sources](../sources/index.md) — the peer section covering the READ phase.
- [Recipes → Custom target adapter](../recipes/custom-target-adapter.md) — end-to-end reporting-service example.
