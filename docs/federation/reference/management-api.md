# Management API and Console

An inventory of everything the plugin federates, served at `/federation`. One row per
`@federation.*` entity, addressed by the consumption view's fully qualified name, so a
caller never needs to know what the underlying pipeline or cache is called.

It answers the question the other management surfaces cannot: *what remote data does this
app use, and how?* The [Pipeline Console](/pipeline/reference/management-service) shows
replication, and the `cds-caching` dashboard shows cache metrics — but a plain
`@federation.delegate` has neither, so nothing anywhere reports it.

## Switching it on

```json
"cds": {
  "requires": {
    "data-federation": {
      "management": { "reuse": { "api": true, "console": true } }
    }
  }
}
```

`api` serves the OData service at `/federation`; `console` adds the UI at
`/federation-console`. Either can be used alone — the console needs the API, so switch
both on to use it.

Or import the model yourself, for a project-owned setup — but not both:

```cds
using from 'cds-data-federation/management.cds';
```

Both require an authenticated user by default. The service carries `@requires:
'authenticated-user'`, and the console route carries an express guard, because static
files sit outside CAP's service adapters and inherit nothing from the model.

Tighten it with a role of your own:

```cds
annotate FederationManagementService with @requires: 'FederationAdmin';
```

Or open it deliberately, when the endpoint already sits behind a network boundary:

```cds
annotate FederationManagementService with @requires: null;
```

The console guard reads that same annotation, so either change applies to the API and the
UI together rather than leaving you locked out of your own console. A signed-in user
missing the required role gets 403; an anonymous one gets 401 with a challenge.

## The Console

`/federation-console` is a UI5 app, inventory-led: the landing view is one row per
federated entity, and health appears where data exists.

- **Federated entities** — every `@federation.*` entity with its strategy, cache, source,
  traits and backing pipeline. Searchable by entity or source service, filterable by
  strategy.
- **Detail** — the resolved annotation (projected columns, renames, static scope, cache
  tag), request/error/latency tiles when [metrics](#delegate-metrics) are on, the actions
  this entity's strategy supports, and links out to `/pipeline` or the caching dashboard
  for anything deeper.
- **Landscape** — remote services on one side, consumption views on the other, one line
  per entity, with strategy and cache on each node. Unlike the Pipeline Console's graph
  this covers delegates and caches too, since those have no pipeline to draw.

It deliberately stops short of a run table, a cache-key browser and a config-layer diff:
those live in the consoles that own them, and the detail page links to them.

The UI5 runtime is the active long-term maintenance release, loaded from the SAP CDN.
Override it with `management.ui5Url` — an http(s) URL or an absolute path — to serve UI5
from your own host.

## What it serves

```http
GET /federation/FederatedEntities
```

| Field | Meaning |
|---|---|
| `entity` | Fully qualified consumption view. The key, and the stable address. |
| `name` | Last segment of `entity`, for display. |
| `service` | The CAP service exposing the view. |
| `strategy` | `replicate` or `delegate`. |
| `cacheStrategy` | `response`, `entity`, or null for an uncached delegate. |
| `sourceService` / `sourceEntity` | The remote this view projects on. |
| `writable` / `writeVerbs` | Write opt-in. Read-only by default, so `writeVerbs` is usually empty. |
| `wildcardProjection` | True when the projection is `{ * }`. |
| `projectedColumns` | Remote columns actually fetched. Empty for a wildcard projection. |
| `renames` | Renames declared with `as`, as `{ local, remote }` pairs. |
| `scoped` | Whether a static `where` is applied on every request. |
| `pipeline` | The pipeline backing this entity, for `replicate` and the entity cache. Null otherwise. |
| `cacheTag` | The `cds-caching` tag every response-cache entry carries. |
| `pipelineDetail` / `cacheDetail` | Where to find runtime detail, or null with a reason in the `*Unavailable` field. |

A single entity reads by its FQN:

```http
GET /federation/FederatedEntities('sap.capire.xflights.Flights')
```

## What it does not serve

No run history, no cache metrics, no configuration changes. This service **references**
the plugins that own those things rather than copying them:

- Replication detail lives in `/pipeline`, linked per row as `pipelineDetail`.
- Cache metrics live in the `cds-caching` API, linked as `cacheDetail`, filtered to the
  entity's own tag.
- Schedules, overrides and the enabled flag stay on `/pipeline`.

When a linked surface is not enabled, the link is null and the neighbouring
`pipelineDetailUnavailable` / `cacheDetailUnavailable` field says which flag to set. The
inventory itself still works: it is built from the compiled model, not from either
neighbour.

## Actions

Three, all bound to an entity and limited to what federation itself owns.

```http
POST /federation/FederatedEntities('sap.capire.xflights.Flights')/refreshReplica
```

Runs the pipeline. Pass `keys` as a JSON object to refresh a single row through an
event-driven run instead of a full pass:

```json
{ "keys": "{\"ID\":\"EA0018\",\"date\":\"2027-06-06\"}" }
```

```http
POST /federation/FederatedEntities('…SnapshotFlights')/refreshEntityCache
```

Refills the entity-cache snapshot. Requires `cache.strategy: 'entity'`.

```http
POST /federation/FederatedEntities('…Airports')/invalidate
```

Drops the entity's response-cache entries by its automatic `federation:<Entity>` tag.
Requires `cache.strategy: 'response'`.

Each returns `{ entity, action, message }`. An action that does not match the entity's
strategy is rejected with 400 rather than quietly doing nothing, and an unknown entity
with 404.

## Delegate metrics

A plain delegate has no pipeline and no cache, so nothing reports on it. Switching on
metrics gives every delegated entity request, error and latency counters.

```json
"cds": {
  "requires": {
    "data-federation": {
      "metrics": { "enabled": true }
    }
  }
}
```

Off by default, and off means off: with the flag unset no counter is touched, no timer
starts, and the table is not even part of the model, so nothing is deployed.

```http
GET /federation/DelegateMetrics
```

| Field | Meaning |
|---|---|
| `bucket` | Hour the counters belong to, as `hourly:2026-09-20T14`. |
| `entity` | Consumption-view FQN — the same key the inventory uses. |
| `requests` / `errors` | Reads forwarded to the remote, and how many failed. |
| `writes` / `writeErrors` | CUD forwarding on writable delegates, counted separately. |
| `latencySumMs` | Summed remote round-trip time. |
| `avgLatency` | Derived as `latencySumMs / requests` — see below. |
| `minLatency` / `maxLatency` | Fastest and slowest call in the bucket. |

**There is no stored average.** Averages cannot be merged without their counts, so a
stored one would drift as soon as a second flush — or a second app instance — wrote to
the same bucket. The table keeps a sum, and the average is computed on read.

Counters accumulate in memory and flush on an interval, so a delegated read costs a
counter increment rather than a database write:

| Option | Default | |
|---|---|---|
| `metrics.enabled` | `false` | Switches everything above on. |
| `metrics.persistenceInterval` | `60000` | Milliseconds between flushes. |
| `metrics.retention.days` | `30` | Buckets older than this are swept on each flush. |

Counts from the current interval are lost if the process is killed outright; a clean
shutdown flushes first.

### Pausing collection

The console header carries a **Collect metrics** switch, backed by an action:

```http
POST /federation/setMetricsCollection
{ "enabled": false }
```

`null` clears the override and follows configuration again. The choice is persisted and
survives a restart: configuration seeds it, the database wins — the same precedence
`cds-caching` uses for its own metric flags. Pending counters are flushed before pausing,
so nothing already gathered is lost.

It pauses and resumes collection; it cannot switch metrics on from nothing. Whether the
delegate handlers are instrumented at all is decided by `metrics.enabled` at startup, so
that the flag-off path carries no wrapper. With metrics unconfigured the switch is hidden
and the action returns 400.

## Example

The xtravels demo, with eleven federated entities across both strategies:

```
entity           strategy   cache      writable scoped pipeline
Airlines         delegate   -          no       no     -
LiveFlights      delegate   -          no       no     -
Airports         delegate   response   no       no     -
SnapshotFlights  delegate   entity     no       no     data-federation-cache:…SnapshotFlights
CachedFlights    delegate   response   no       no     -
Hotels           delegate   -          no       no     -
HotelBookings    delegate   -          yes      no     -
Organizations    delegate   -          no       yes    -
Flights          replicate  -          no       no     Flights
Supplements      replicate  -          no       no     Supplements
Customers        replicate  -          no       yes    Customers
```

Eight of those eleven have no pipeline at all, which is exactly why the Pipeline Console
cannot answer this question on its own.
