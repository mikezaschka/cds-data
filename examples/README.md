# Example Apps

Runnable demos for manual exploration of the monorepo packages. Complementary to the Jest suites under `packages/*/test/` — same patterns, but with **persistent SQLite**, **UIs attached**, and **startable with `cds watch`** so you can walk through features interactively.

## Demos

| Demo | Path | Start |
|---|---|---|
| **Sales Intelligence Workbench** *(headline)* | [`examples/sales-intel/`](./sales-intel/) | `bash examples/sales-intel/start-all.sh` → http://localhost:4005/launchpage.html |
| **Movies & Streaming** | [`examples/consumer/`](./consumer/) | `npm run examples:start` → http://localhost:4004/launchpage.html |

The Sales Intelligence Workbench fuses Northwind V4 + V2, a local CAP provider, and a local REST provider into a Fiori Elements launchpad that shows delegation, replication, cross-service `$expand`, and cache visibility side-by-side.

The Movies demo models a small movies-and-streaming platform: a studio catalog is live-proxied, a hot "trending" list is cached, a legacy V2 licensing system is reshaped with renames, a second provider delivers streaming manifests, and REST-sourced box-office data is replicated into the local database for analytics.

## Structure

```
examples/
  provider/            :4444 — Studio provider
                         ProviderService V4 (Movies, Genres, Directors, Actors, Castings)
                         LicensingService V2 (Titles, TerritoryLicenses)
  inventory/           :4445 — Streaming CDN
                         StreamingService V4 (Regions, StreamingManifests)
  rest-provider/       :4446 — Box-office REST
                         GET /api/box-office — offset pagination + modifiedSince delta
  consumer/            :4004 — App under test
    db/                Persistent SQLite at examples/consumer/db.sqlite
    srv/               ConsumerService + external CSN models
    app/               Fiori Elements apps + launchpad
  regen-csn.js         Recompiles provider/inventory/licensing models into CSN
                       snapshots under consumer/srv/external/
  start-all.sh         Starts all four servers in parallel
```

## Prerequisites

From the repository root:

```bash
npm install
```

This installs workspace dependencies for the plugin, the examples, and the test apps.

## Start everything

```bash
npm run examples:start
```

This runs `examples/start-all.sh`, which starts:

- Studio provider (V4 + V2) on http://localhost:4444
- Streaming CDN on http://localhost:4445
- Box-Office REST on http://localhost:4446
- Consumer on http://localhost:4004

Watch the consumer terminal for the line `[cds] - server listening on ...`, then open:

- **Launchpad:** http://localhost:4004/launchpage.html
- **ConsumerService (OData):** http://localhost:4004/odata/v4/consumer/

Stop with `Ctrl+C` in the terminal running `start-all.sh` (all child processes are killed).

## Running a single server

To work on one component in isolation:

```bash
# Studio provider only
cd examples/provider && npx cds watch --port 4444

# Consumer only (requires the three providers running)
cd examples/consumer && npx cds watch --port 4004
```

## Regenerating external CSN snapshots

If you change provider or inventory schemas, refresh what the consumer imports:

```bash
npm run examples:regen-csn
```

## What each tile demonstrates

| Tile | Entity | Strategy | Shows |
|---|---|---|---|
| Movies | `Movies` | `@federation.delegate` (read-only) | Live proxy of the studio V4 catalog, cross-service expand: remote → local backlinks to local Reviews/Bookmarks |
| Trending Movies | `TrendingMovies` | `@federation.delegate: { cache: { ttl: 60000 } }` | Response caching via `cds-caching` — second load is instant |
| Award-Winning | `AwardWinningMovies` | `@federation.delegate` + `where avgRating >= 8.5` | Static `where` clause injected into every remote query |
| Films (Rebranded) | `Films` | `@federation.delegate` + field renames | `ID → filmId`, `title → filmTitle`, `year → releaseYear`, `avgRating → rating`, `voteCount → votes` |
| Actors | `Actors` | `@federation.delegate: { writable: true }` | Full CUD forwarded to the remote studio service |
| Directors | `Directors` | `@federation.delegate: { update: true }` | Selective writable — updates allowed, inserts/deletes rejected with 405 |
| Licensed Movies | `LicensedMovies` | `@federation.delegate` on OData V2 | Entity + field renames from legacy V2 licensing system (`Titles.titleName` → `LicensedMovies.movieTitle`) |
| Streaming Manifests | `StreamingManifests` | `@federation.delegate` — second provider | Catalog delivered from the :4445 streaming CDN |
| Watchlists | `Watchlists` | Local entity with assoc to delegated `Movies` | Cross-service expand: local → remote (`$expand=movie`, batch-fetch + stitch) |
| Reviews | `Reviews` | Local entity with assoc to delegated `Movies` | Cross-service expand: local → remote plus cross-service expand: remote → local backlink from `Movies(...)/reviews` |
| Replicated Movies | `ReplicatedMovies` | `@federation.replicate` | Scheduled full sync of the studio catalog into local SQLite for analytics |
| Box Office | `ReplicatedBoxOffice` | `@federation.replicate` with REST adapter | Offset pagination + `modifiedSince` delta param, `results` dataPath unwrap |
| Pipeline Console | `Pipelines` / `PipelineRuns` | Pipeline Console (`management.reuse.console`) | Plugin management UI at `/pipeline-console/` — runs, status, errors, data inspection |

## Triggering replications

Both replicate tiles depend on data having been synced at least once. Trigger a run:

```bash
curl -X POST http://localhost:4004/pipeline/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"ReplicatedMovies"}'

curl -X POST http://localhost:4004/pipeline/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"ReplicatedBoxOffice"}'
```

## Persistent state

The consumer uses a **file-backed SQLite** at `examples/consumer/db.sqlite`.
Delete it to reset replicated data, local watchlists, reviews, etc.:

```bash
rm examples/consumer/db.sqlite
```

Providers use in-memory SQLite — restart them to reset provider data.

## Relationship to tests

Package test suites under `packages/cds-data-federation/test/`, `packages/cds-data-pipeline/test/`, and `packages/cds-data-materialization/test/` are the source of truth for correctness. `examples/` is for **manual exploration** and covers a curated subset of user-visible features with UIs attached. When a new user-visible capability lands, add it to the relevant example demo so the launchpad stays a working showcase.
