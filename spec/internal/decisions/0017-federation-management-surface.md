# ADR 0017 — A federation management surface, built on the other plugins' APIs

Status: Proposed
Date: 2026-09-20
Supersedes: —
Relates to: [ADR 0006 — Per-plugin published surface](0006-per-plugin-published-surface.md), [ADR 0013 — Event-driven pipeline runs](0013-event-driven-pipeline-runs.md), [ADR 0016 — Align service names](0016-align-service-names.md)

## Context

Two of the three plugins in this suite ship an operator surface; federation ships none.

| Plugin | API | UI | Activation |
|---|---|---|---|
| `cds-data-pipeline` | `/pipeline` — Pipelines, PipelineRuns, `execute`, `setEnabled`, `setSchedule`, `setOverrides`, `inspectData` | Pipeline Console at `/pipeline-console` | `management.reuse.{api,console}` |
| `cds-caching` (>= 3.0) | `CachingApiService` at `/odata/v4/caching` — Caches, Metrics, KeyMetrics | Dashboard at `/caching-dashboard` | `metrics.reuse.{api,dashboard}` |
| `cds-data-federation` | — | — | — |

Three problems follow from that gap.

**Delegates are invisible.** A `@federation.delegate` entity has no pipeline and no cache unless one is configured, so nothing anywhere reports it. In the xtravels demo, seven of the eight showcase entities are delegates and the console lists none of them.

**Addressing is inconsistent.** Federation already exposes `refreshEntityCache(entityFullName)` keyed by consumption-view FQN. Refreshing a *replica* instead requires knowing the pipeline's name (`'Flights'`) and connecting to a different service. One annotation, two addressing schemes, depending on which strategy it carries.

**The operator's question spans three plugins.** "What remote data does this app use, is it fresh, is it healthy?" is answered today by opening two consoles with two activation mechanisms, and for plain delegates by opening nothing. Federation is the only layer that knows a replica, an entity cache, a response cache and a live delegate are four facets of one annotation.

Since `cds-caching` 3.0 the activation convention has converged: `<feature>.reuse.<surface>`, with a project-owned escape hatch and a warning when both are used. A federation surface would adopt an established pattern rather than introduce a third.

## Decision

### 1. Ship a `/federation` management API — unconditionally

A read-mostly OData service projecting the annotation scanner's existing registry: one row per federated entity carrying strategy, source service, remote entity, projected columns, renames, static `where`, write flags and cache configuration. Actions limited to what federation already owns:

- `refreshReplica(entity, keys?)` — wraps `execute` / `executeEvent` (ADR 0013)
- `refreshEntityCache(entity)` — the existing public API, over HTTP
- `invalidate(entity)` — wraps `deleteByTag('federation:<Entity>')`

Activation: `federation.reuse.{api,console}`, matching the convention above.

**The identifier is the consumption-view FQN, everywhere.** This is the point of the API: one address for an annotated entity regardless of the strategy it carries, with the pipeline name and cache name exposed as navigation rather than as things a caller must know.

### 2. The console is conditional on instrumenting the delegate path

Today a plain delegate produces no runtime data: no request count, no error count, no latency. A federation console would therefore render deep links for replicate / entity-cache / response-cache rows, and *static configuration* for plain delegates.

- **Without delegate instrumentation**, the console is a browser over the compiled annotation model. That is useful — today the only way to confirm an annotation resolved as intended is reading startup logs — but it is an introspection job better served by the CLI and the MCP server, and it does not justify a fourth UI5 application.
- **With delegate instrumentation**, federation owns the only numbers that exist for roughly half its annotation surface, and the console becomes the single place showing every federated entity's health.

**Decision: build the console if and only if the delegate path is instrumented.** Until that is decided, ship the API alone.

If built, the federation console is the **entry point** for federation users, with the Pipeline Console and the caching dashboard as specialist views beneath it. This is permitted by the dependency direction — federation depends on both, neither depends on federation — and it must not be inverted.

### 3. Depend on the other plugins' APIs, never on their UIs

The federation console reads `/pipeline` and `/odata/v4/caching` over OData and renders its own scoped views. It does **not** embed their UI5 components.

Embedding was considered and rejected on three concrete grounds:

| | Pipeline Console | Caching dashboard |
|---|---|---|
| component id | `pipeline.monitor.fcl` | `cds.plugin.caching.dashboard` |
| `sap.app.type` | `application` | `application` |
| pinned UI5 | 1.150.0 | 1.136.1 |

- **One UI5 core per page, two different pins.** Embedding forces a single UI5 version across independently released packages.
- **Both are applications with their own routing**, not reuse components; the pipeline console is a FlexibleColumnLayout app, so nesting it means two FCLs competing over the hash. Converting either into a reuse component freezes its internals against an external consumer.
- **A component's settings and events have no `$metadata`, no versioning story, and fail silently.** The OData services already have all three.

This choice has a property embedding cannot match: **the federation console works when the other plugins' consoles are switched off.** It requires `management.reuse.api` and `metrics.reuse.api` only. Absent either, the affected tiles degrade to a readable "management API not enabled" message rather than an empty frame.

### 4. Reference, never copy

Federation exposes the pipeline name and cache name as navigation properties and reads their data live. It does **not** persist its own copy of run statistics or cache metrics. Copying forks two schemas and drifts from both.

### 5. Scope: summaries and links out

Federation renders *"last run, status, rows written, next run"* from `/pipeline/PipelineRuns?$filter=pipeline_name eq 'X'&$top=1`, and a hit ratio from `/odata/v4/caching/Metrics`. Detail views stay below.

**The line:** if the federation console grows a filterable run table, a config-layer diff or a cache-key browser, it has crossed into duplication and that view belongs to the plugin that owns it.

### 6. Optional: a shared leaf-level UI library

Consistency across the three consoles should come from *stateless* controls — a status badge, a run sparkline, freshness and duration formatters, a common theme — published once and consumed by all three. Stateless leaf controls have a tiny, stable contract precisely because they know nothing about where their data came from. This is the granularity at which sharing UI across package boundaries works; sharing stateful application components is the granularity at which it does not.

## Non-goals

- Run history, config layers, and the data inspector — these live in the Pipeline Console.
- The cache key browser and per-key metrics — these live in the caching dashboard.
- Mutating pipeline configuration through `/federation`. Schedules and overrides stay on `/pipeline`; federation's actions are limited to refresh and invalidate.
- Replacing `refreshEntityCache` as a programmatic API. The HTTP action wraps it; it does not supersede it.

## Resolved dependency: per-entity cache attribution

This was an open blocker against `cds-caching` 3.0.1, whose `Metrics` (`(bucket, cache)`) and `KeyMetrics` (`(bucket, cache, keyName)`) carried no tag dimension — so the response-cache column would have shown whole-cache numbers against every entity sharing that cache.

**`cds-caching` 3.1.0 resolves it.** `TagMetrics` is keyed `(ID, cache, tag)`, opt-in via `metrics.tagMetricsEnabled` (or `setTagMetricsEnabled`), and exposed on `CachingApiService`. Verified end-to-end against the xtravels demo: four reads of the cached `Airports` delegate (one query three times, then a different one) produced

```
{ cache: "caching", tag: "federation:Airports", hits: 2, misses: 2, hitRatio: 50 }
{ cache: "caching", tag: "airports",            hits: 2, misses: 2, hitRatio: 50 }
```

So federation's automatic `federation:<Entity>` tag is attributable, and the developer-supplied tag from `@federation.delegate.cache.tags` is too. The response-cache column in §5 can therefore read `TagMetrics?$filter=tag eq 'federation:<Entity>'`.

Note that an entry carrying several tags increments each of them, so tag totals legitimately exceed cache totals — visible above, where both tags report the same four events that `Metrics` reports once. Any aggregation across tags in the federation console must not sum them.

**Minimum version:** a federation console consuming this needs `cds-caching >= 3.1.0`. The plugin's peer range (`>=3`) should be raised when that console ships, not before — nothing in federation consumes `TagMetrics` yet.

See the handover note in [`../plans/cds-caching-handover.md`](../plans/cds-caching-handover.md) for the remaining items.

## Consequences

- Federation gains a published HTTP surface, and with it a compatibility obligation. `/federation` becomes a versioned contract.
- A fourth activation flag (`federation.reuse.*`) joins the convention. Consistent, but it is one more switch.
- The federation console depends on two OData contracts it does not own. Both are public and carry `$metadata`, which is the point, but a breaking change in either is a breaking change here.
- The Pipeline Console's Overview graph (remote services against consumption views) is a federation concept living in the engine. If the federation console is built, that graph belongs there and the pipeline version should degrade to pipelines only. Left open deliberately; it is a boundary cleanup, not a blocker.
- Deciding to instrument the delegate path adds per-request work and a persistence decision on the hot path. That cost is the substance of the conditional in §2 and should be measured, not assumed.

## Acceptance criteria (when implemented)

1. `/federation` lists every `@federation.*` entity with its strategy and resolved configuration, addressed by consumption-view FQN.
2. `refreshReplica`, `refreshEntityCache` and `invalidate` are reachable over HTTP and are the only mutations exposed.
3. With `management.reuse.api` off, the API still serves configuration and degrades the pipeline-derived fields with an explicit reason.
4. No federation entity persists run statistics or cache metrics.
5. If a console ships: no filterable run table, no key browser, and every detail affordance is a link into the owning plugin's console.
