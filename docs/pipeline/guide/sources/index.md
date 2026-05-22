# Sources

The **source** side of a pipeline owns the `PIPELINE.READ` phase. A source adapter bridges a transport-specific read (OData V4, OData V2, REST, CQN) to a uniform streaming contract the plugin consumes.

One source adapter is resolved per pipeline at registration time.

## Resolution order

`addPipeline(...)` resolves the source adapter in this order:

1. `config.source.adapter` — class reference extending `BaseSourceAdapter`. Full control; skips everything below.
2. `config.source.kind` — explicit transport selector: `'cqn' | 'odata' | 'odata-v2' | 'rest'`.
3. `cds.requires.<service>.kind` (or `remote.kind`) — auto-detected for annotation-wired pipelines. Unknown values fall back to `ODataAdapter`.

## Built-in source adapters

| Source `cds.requires.<service>.kind` | Adapter | Page |
|---|---|---|
| `odata` (OData V4) | `ODataAdapter` | [OData V2 / V4](odata.md) |
| `odata-v2` | `ODataAdapter` | [OData V2 / V4](odata.md) |
| `hcql` | `ODataAdapter` | [OData V2 / V4](odata.md) |
| `rest` | `RestAdapter` | [REST](rest.md) |
| `cqn` / `postgres` / `hana` / `sqlite` / `better-sqlite` / in-process CAP services | `CqnAdapter` | [CQN](cqn.md) |
| Anything else | Register a [custom source adapter](custom.md) |  |

- **[OData V2 / V4](odata.md)** — CAP-native CQN translation. All three delta modes (`timestamp`, `key`, `datetime-fields`), server-driven paging, consumption-view column restriction.

- **[REST](rest.md)** — Plain JSON over HTTP — no CDS model. Cursor / offset / page pagination, configurable delta URL parameter, nested-response extraction via `dataPath`.

- **[CQN](cqn.md)** — In-process CAP services and `cds.requires` DB bindings (`postgres`, `hana`, `sqlite`, …). Serves both entity-shape and query-shape reads.

- **[Custom source adapter](custom.md)** — Extend `BaseSourceAdapter` to read from a transport the plugin does not ship. Worked example: a CSV-file source adapter.

## Delta strategies

Source adapters translate the pipeline's `config.delta` + the tracker watermark into a source-side predicate (OData `$filter`, REST query param, CQN `WHERE`, …):

| Strategy | Watermark | Typical use |
|---|---|---|
| **timestamp** | `tracker.lastSync` (ISO timestamp) | Most common. Requires a reliable `modifiedAt`-style field on the source. |
| **key-based** | `tracker.lastKey` (primary-key value) | Append-only feeds where rows are keyed monotonically. |
| **datetime-fields** | Per-field timestamps in a composite watermark | Sources exposing several independently updated timestamps. |

All three are implemented for OData V4 and V2. REST supports `timestamp`. CQN supports `timestamp` and `key`. Query-shape pipelines (with `source.query`) sidestep delta entirely — see [Concepts → Inference rules](../concepts/inference.md).

## See also

- [Concepts → Terminology](../concepts/terminology.md) — source / target / tracker vocabulary.
- [Concepts → Inference rules](../concepts/inference.md) — read-shape inference and registration validation.
- [Targets](../targets/index.md) — the peer section covering the WRITE phase.
