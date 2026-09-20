# Management API

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
      "management": { "reuse": { "api": true } }
    }
  }
}
```

Or import the model yourself, for a project-owned setup — but not both:

```cds
using from 'cds-data-federation/management.cds';
```

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
