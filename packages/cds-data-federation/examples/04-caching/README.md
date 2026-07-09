# 04 — Caching a delegate

> Expands on [Federation → Caching](../../../../docs/federation/integration/caching.md).

Caching is an **option on a strategy**, not a third strategy. Attach a `cache` block to `@federation.delegate` to avoid hitting the remote on every read. Two strategies:

| Strategy | Backend | Cache hit when | Peer |
|---|---|---|---|
| `response` (default) | `cds-caching` (memory/Redis/…) | The **exact same** query is repeated | `cds-caching` |
| `entity` | SQLite snapshot | **Any** query on the entity (whole-entity snapshot) | `cds-data-pipeline` + `@cap-js/sqlite` |

## What this shows

| Entity | Strategy | Observe |
|---|---|---|
| `CachedCustomers` | `response`, ttl 30s | 2nd identical call → no upstream request |
| `CachedProducts` | `response` + tag `product-cache` | Custom tag for surgical invalidation |
| `EntityCachedCustomers` | `entity`, ttl 60s | 1st call warms SQLite; then different `$filter`/`$orderby` still served locally |

## Run

```bash
bash start.sh
```

- Service: http://localhost:4134/odata/v4/shop/

Run a request twice and watch the **provider terminal** — a cache hit produces no upstream request. See [`http/scenarios.http`](http/scenarios.http).

## Key idea

Response cache keys on the full query signature; the entity cache keys on the *entity* and answers arbitrary filters from a local snapshot until TTL. Writable delegates do **not** auto-invalidate on CUD — plan manual `cache.deleteByTag(...)` or a short TTL.
