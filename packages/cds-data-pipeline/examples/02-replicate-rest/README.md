# Example 02 — Replicate from REST

**What this shows:** replicate from a plain HTTP / JSON endpoint into a local DB table using the built-in `RestAdapter` — offset pagination, tracker-driven delta, and a `dataPath` for unwrapping the response envelope. See [docs/guide/sources/rest.md](../../docs/guide/sources/rest.md).

**Source:** the bundled [FXService](../_providers/fx-service/) (Express, `:4456`).
**Target:** local SQLite table `example02.ExchangeRates`.
**Pipeline name:** `ExchangeRates`.

## Run it

```bash
bash examples/02-replicate-rest/start.sh
```

- OData of the local replica: <http://localhost:4102/odata/v4/example/ExchangeRates>
- Pipeline Monitor: <http://localhost:4102/launchpage.html>
- FXService direct: <http://localhost:4456/api/rates>

Stop with Ctrl+C.

## REST specifics

```js
source: { service: 'FXService' },
rest: {
    path: '/api/rates',
    pagination: { type: 'offset', pageSize: 100 },
    deltaParam: 'modifiedSince',
    dataPath:   'results',
},
delta: { mode: 'timestamp', field: 'modifiedAt' },
```

- **`pagination: { type: 'offset', pageSize }`.** FXService accepts `limit=<pageSize>` and `offset=<cursor>`. The adapter keeps paging until a short page comes back. Alternatives: `cursor` (`nextToken` from the response) and `page` (`?page=<n>&pageSize=<n>`). See [sources/rest.md](../../docs/guide/sources/rest.md).
- **`deltaParam`.** Tracker-driven query parameter appended to every request (first run excluded — no watermark yet). Here it emits `?modifiedSince=<ISO timestamp>`. Works in tandem with `delta.mode: 'timestamp'`; if your endpoint uses a different semantics (`?sinceRev=…`, `?after=…`), match it here.
- **`dataPath: 'results'`.** FXService returns `{ results: [...], total: n }`. The adapter pulls `results[]`. Leave unset if the endpoint responds with a naked array.
- **No remote CSN.** REST has no metadata. The target table is declared locally in [db/schema.cds](db/schema.cds); column names must match the endpoint's JSON keys (or we'd add a `mapRow` hook).

## Scenarios

`http/10-run-and-query.http` walks through:

1. First run — no watermark, fetches every page.
2. Query the local replica with OData operators (`$filter`, `$orderby`).
3. Second run — adapter appends `modifiedSince`; no changed rows → 0 inserts / updates.
4. Full refresh — truncate + replay.

## Caveats

- `mode: 'full'` on a REST source deletes the whole local table at the start of the run. If the endpoint paginates, rows are only visible again after the full run completes. For very large datasets prefer `delta.mode: 'timestamp'` plus an occasional `full` on a quiet hour.
- The adapter does not currently retry on non-2xx responses. Wrap with your own `before('PIPELINE.READ', ...)` hook for retry / circuit-breaker logic (see [recipes/event-hooks.md](../../docs/guide/recipes/event-hooks.md) and [example 06](../06-event-hooks/)).

## See also

- [Sources → REST](../../docs/guide/sources/rest.md) — full option reference.
- [Example 01 — Replicate OData](../01-replicate-odata/) — the entity-shape variant with consumption views.
