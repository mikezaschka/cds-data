# Handover to `cds-caching` — what `cds-data-federation` needs

Context: [ADR 0017 — A federation management surface](../decisions/0017-federation-management-surface.md).
Written against `cds-caching@3.0.1`. Paste the section below into a session on the `cds-caching` repository.

---

## Prompt

You are working on **`cds-caching`** (github.com/mikezaschka/cds-caching), currently at 3.0.1.

A sibling plugin, `cds-data-federation`, uses `cds-caching` as an optional peer for its response-cache strategy. It is building its own management API and possibly a console (ADR 0017), which will read `cds-caching`'s OData API rather than embed its UI. Three things are needed from this side. Please assess each, tell me what is feasible, and what it would cost.

### 1. ~~A tag dimension on metrics~~ — DELIVERED in 3.1.0

`TagMetrics`, keyed `(ID, cache, tag)`, opt-in via `metrics.tagMetricsEnabled` / `setTagMetricsEnabled`, exposed on `CachingApiService`. Verified against the xtravels demo — see ADR 0017. Nothing further needed; the original request is kept below for context.

<details>
<summary>Original request</summary>


`cds-data-federation` registers a cached delegate per consumption view, and tags every entry it writes with `federation:<EntityName>` (one automatic tag, plus any the developer adds through `@federation.delegate.cache.tags`). That tag is what it uses to invalidate one entity's entries with `deleteByTag`.

The metrics model does not carry tags:

- `Metrics` is keyed by `(ID, cache)` where `ID` is a time bucket
- `KeyMetrics` is keyed by `(ID, cache, keyName)`

So hits, misses, latency and error rate are attributable to a **cache instance** and to an individual **key**, but not to a **tag**. Several federated entities normally share one cache service, which means federation cannot answer "what is the hit ratio for `Airports`" — it can only show the whole cache's numbers against every entity in it, which is more misleading than showing nothing.

**What is needed:** a way to aggregate metrics by tag. Some options, in rough order of how invasive they look from the outside:

- an optional `TagMetrics` projection keyed `(ID, cache, tag)`, populated when tag metrics are enabled
- a `tags` element on `KeyMetrics`, letting a consumer group client-side (cheaper to implement, more expensive to query, and cardinality grows with keys)
- a function on `CachingApiService` such as `getMetricsByTag(tag)`

Points worth weighing: tag metrics should be opt-in the way `setKeyMetricsEnabled` already is, since cardinality is developer-controlled; and an entry can carry several tags, so a hit increments every tag it belongs to and tag totals will legitimately exceed cache totals. That needs to be stated in the model's documentation rather than discovered.

</details>

### 2. Confirm the 3.0 tag-shape change

The migration guide says "cache keys and tags change shape" in 3.0, and documents the key change (SHA-256, includes the effective query) but says nothing concrete about tags.

Empirically the tag surface appears unchanged: after upgrading the federation monorepo from 1.3.2 to 3.0.1, all 459 federation tests and the 135-test xtravels demo suite pass with no code change across 11 `deleteByTag` call sites, with tags built as `{ value: 'federation:<Entity>' }`.

**What is needed:** confirmation that this is a supported contract and not a coincidence, plus a line in the migration guide saying what actually changed about tags. If the internal representation did change, consumers need to know which parts of the tag surface are stable.

### 3. A shared leaf-level UI library — worth discussing, not a request

All three plugins in the `cds-data` suite now ship or plan an operator UI, and they are drifting apart visually. The proposal in ADR 0017 is a small library of **stateless** controls — status badge, sparkline, freshness and duration formatters, a shared theme — consumed by all three, with each console keeping its own data loading, routing and layout.

Explicitly *not* proposed: embedding whole console components across packages. The pipeline console (`pipeline.monitor.fcl`, UI5 1.150.0) and the caching dashboard (`cds.plugin.caching.dashboard`, UI5 1.136.1) are both `sap.app.type: application` with their own routing and different pinned UI5 versions, and a page hosts one UI5 core. Sharing dumb leaf controls avoids all of that.

**What is needed:** a view on whether this is worth a fourth package, and if so who owns it.

### Context you may want

- Federation builds its tag in `srv/delegation/handler-registration.js` as an object of the form `{ value: "federation:<EntityName>" }`.
- Its cache options are `strategy: 'response'` with `ttl`, `tags`, `service`; the entity-cache strategy uses `cds-data-pipeline` instead and does not touch `cds-caching`.
- The federation API will address everything by consumption-view FQN, so whatever tag aggregation lands should be queryable by an exact tag string rather than by a pattern.

---

### 5. Bug in 3.1.1: config-driven metric flags are not reflected in `Caches`

With metrics enabled through configuration rather than through the actions:

```json
"caching": {
  "impl": "cds-caching",
  "metrics": { "enabled": true, "tagMetricsEnabled": true, "reuse": { "api": true, "dashboard": true } }
}
```

metrics are collected and persisted correctly — `Metrics` and `TagMetrics` both fill — but `Caches` reports every flag as off:

```
Caches      : { metricsEnabled: false, keyMetricsEnabled: false, tagMetricsEnabled: false }
TagMetrics  : [ "airports", "federation:Airports" ]   // populated at the same moment
```

Stable, not a startup race: still `false` minutes into the run. No "Failed to persist …" warning appears in the log, so the persist branches at `lib/CachingService.js:156/163/170` are not reporting a failure. The config keys are the documented ones (`lib/config-normalizer.js:102-104` maps `metrics.enabled` → `metricsEnabled` and `metrics.tagMetricsEnabled` → `tagMetricsEnabled`).

Why it matters: the dashboard renders those flags as the cache's state, so it will show "metrics off" for a cache that is actively collecting them. More importantly for us, any consumer that reads `Caches.tagMetricsEnabled` to decide whether a metrics view is available — which is what a federation console would naturally do — concludes the data is unavailable while it is sitting in `TagMetrics`.

### 4. ~~Bug in 3.1.0: the reuse dashboard points at the wrong service path~~ — FIXED in 3.1.1

Both `app/dashboard/manifest.json` and `app/dashboard-src` now declare `/odata/v4/caching-api/`, matching CAP's derived service path and the existing `xs-app.json` route. Verified in the xtravels demo: the served manifest reports `/odata/v4/caching-api/`, that path's `$metadata` returns 200, and `TagMetrics` is readable through it. No `@path` was added, so existing callers of `/odata/v4/caching-api` are unaffected — the least disruptive of the three options offered.

<details>
<summary>Original report</summary>


Reproduced on `cds-caching@3.1.0` in the xtravels demo with

```json
"caching": { "impl": "cds-caching", "metrics": { "reuse": { "api": true, "dashboard": true } } }
```

CAP derives the service path from the service name, so `CachingApiService` mounts at **`/odata/v4/caching-api`**:

```
[cds] - serving plugin.cds_caching.CachingApiService {
  at: [ '/odata/v4/caching-api' ],
```

But the manifest served at `/caching-dashboard/manifest.json` declares

```json
"dataSources": { "caching": { "uri": "/odata/v4/caching/", ... } }
```

Measured with authenticated requests: `/odata/v4/caching-api/$metadata` → **200**, `/odata/v4/caching/$metadata` → **404**. Nothing rewrites the URI at runtime — no match for `caching-api` in `app/dashboard/Component.js`, the controllers, or `lib/dashboard-bootstrap.js`.

**Both activation routes are affected.** `lib/add.js:212` copies the same `app/dashboard` folder into the project, and the `srv/caching-api.cds` it generates (`lib/add.js:225`) is a bare `using` with no `@path`, so CAP derives `/odata/v4/caching-api` there too. The manifest is simply stale: `lib/add.js:121` already routes `^/odata/v4/caching-api/(.*)$` in the generated `xs-app.json`, so the real path was known when that file was written.

Likely fixes: align the manifest to `/odata/v4/caching-api`, give the service an explicit `@path: '/caching'` (and update the xs-app route to match), or have `dashboard-bootstrap` rewrite the URI in the manifest it serves.

Not verified visually: the demo's dashboard renders blank for me, but that is basic-auth on sub-resources in my browser, not this bug. The endpoint mismatch above is the reliable evidence.

</details>

### 6. Align metric-flag precedence with `cds-data-pipeline`: the database wins

Today config and the database combine as a one-way OR (`lib/CachingService.js:129-140`): the DB value is read, then config forces `true` if it says `true`, and lines 151-170 persist that `true` back. So `metrics.enabled: true` in `package.json` makes metrics impossible to switch off — a runtime `setMetricsEnabled(false)` holds only until the next restart, which then overwrites it.

`cds-data-pipeline` resolves the same tension the other way, in three layers:

| Layer | Written by | Lifetime |
|---|---|---|
| `baseConfig` | code, rewritten on every registration | per boot |
| `overrides` | **only** explicit `setOverrides` / `setEnabled` / `setSchedule` | persisted |
| effective | `applyOverrides(base, overrides)`, per key | computed |

A key the operator never touched follows the code; a key they did touch sticks until cleared. `setEnabled(name, false)` is literally `setOverrides(name, { enabled: false })`, so a paused pipeline stays paused across restarts, and `getConfigView` shows all three layers side by side — which is what the Pipeline Console renders.

**Target for caching:** same precedence. Config seeds; an explicit runtime call wins and survives restarts.

| package.json | operator set | effective |
|---|---|---|
| `true` | — | `true` |
| `true` | `false` | **`false`** (today: `true`, and the operator's value is overwritten) |
| absent | `true` | `true` |
| `false` | `true` | `true` |

The blocker is that one boolean column cannot distinguish "seeded from config" from "the operator chose this". Two shapes:

- **Nullable flags** — `null` means no operator decision, so the effective value follows config; `true` / `false` means the operator decided. Smallest change for three booleans, and `Caches` keeps reporting the effective value if the read resolves it.
- **An `overrides` JSON column**, as pipeline does. Heavier, and pipeline needs it only because it overrides arbitrary config keys; caching has three.

Nullable flags look right here.

Open question worth deciding explicitly: **existing rows.** They are non-null today, so a migration cannot tell a seeded `true` from an operator's `true`. Treating them as operator decisions preserves current behaviour but freezes config out for every existing installation; resetting them to `null` makes config authoritative again for everyone, which loses any deliberate runtime setting. Neither is obviously right, and the choice should be stated in the migration guide rather than inferred.

Worth mirroring `getConfigView` on the `Caches` projection too, so the dashboard can show config vs operator vs effective instead of a single flag whose provenance is invisible. That is what makes the precedence legible rather than surprising.

## Status

- [x] 1. Tag dimension on metrics — **delivered in 3.1.0**, verified end-to-end
- [ ] 2. Tag-shape confirmation for 3.0 — documentation only; empirically stable across 3.0.1, 3.1.0 and 3.1.1
- [ ] 3. Shared leaf UI library — open question
- [x] 4. Dashboard service path — **fixed in 3.1.1**, verified
- [ ] 5. Config-driven metric flags read back as `false` from `Caches` (3.1.1) — fixed on `fix/caches-metrics-flags-from-config`, verified against the xtravels demo; awaiting release
- [ ] 6. Align flag precedence with cds-data-pipeline: the database wins, config seeds
