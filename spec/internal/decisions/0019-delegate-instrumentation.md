# ADR 0019 — Instrumenting the delegate path

Status: Implemented (`srv/metrics/delegate-metrics.js`, `db/metrics.cds`, gated roots in `lib/plugin-roots.js`, handlers wrapped in `srv/delegation/handler-registration.js`)
Date: 2026-09-20
Supersedes: —
Unblocks: [ADR 0017 §2](0017-federation-management-surface.md) — the federation console
Relates to: [ADR 0010 — Multi-tenancy](0010-multi-tenancy-entity-cache-and-pipeline-runs.md), [ADR 0014 — Pipeline run housekeeping](0014-pipeline-run-housekeeping.md)

## Context

A `@federation.replicate` entity has run history. A delegate with an entity cache has one too, because it is a pipeline underneath. A delegate with a response cache has `cds-caching`'s `TagMetrics`, attributable per entity since 3.1.

A **plain delegate records nothing at all**. In the xtravels demo that is eight of eleven federated entities, and it is why ADR 0017 gated its console: an operations surface whose majority rows are static configuration is not an operations surface.

This ADR supplies the missing signal.

## Decision

### 1. Opt-in, off by default

```json
"requires": {
  "data-federation": {
    "metrics": { "enabled": true }
  }
}
```

Same shape as `cds-caching`'s `metrics.enabled` and the `<feature>.reuse` family all three plugins now share. With the flag off, **no counter is touched and no timer is started** — the delegate path is byte-for-byte what it is today, and the console degrades to the inventory it already is.

### 2. What is measured, per consumption view

| Metric | Why |
|---|---|
| `requests` | Reads forwarded to the remote. |
| `errors` | How many of those failed. |
| latency — average, min and max | Time in the remote call. Reported as three numbers, but **stored** as a sum plus min and max; see §4 for why an average cannot be a column. |
| `writes`, `writeErrors` | CUD forwarding on writable delegates, counted apart from reads: a failed write is a different incident from a failed read. |

**Deliberately excluded from v1:** latency percentiles (they need retained samples, as `cds-caching` does with `maxLatencies`), per-query metrics, and distributed tracing — the last belongs to OpenTelemetry, not to a table of our own.

**Also excluded: last-error message and timestamp.** This was offered and not taken. Noting it explicitly because it is usually the first thing an operator asks for and it is cheap to add later; the counters above will say *that* something failed without saying *what*.

### 3. In-memory accumulation, periodic flush

Counters accumulate in the process and flush to a table on an interval, the shape `cds-caching` already uses. A delegate read is a hot path, so the per-request cost stays a counter increment and a timestamp delta; nothing touches the database inline.

Persisting rather than staying in-memory buys what the console needs: survival across restarts, and aggregation across instances and tenants.

### 4. Schema — store what merges

```cds
entity DelegateMetrics {
    key bucket       : String;   // 'hourly:2026-09-20T14' — cds-caching's convention
    key entity       : String;   // consumption-view FQN — the address, per ADR 0018
        requests     : Integer;
        errors       : Integer;
        writes       : Integer;
        writeErrors  : Integer;
        latencySumMs : Double;   // NOT an average — see below
        minLatency   : Double;
        maxLatency   : Double;
}
```

Keyed on the consumption-view FQN, so it joins the `/federation` inventory directly and needs no name translation. **No instance in the key** — see §5.

**There is deliberately no `avgLatency` column.** Averages do not merge: `avg(a)` and `avg(b)` cannot be combined without their counts, so a stored average is wrong both across instances *and* across successive flushes from the same process. The table stores `latencySumMs`, and the average is derived on read as `latencySumMs / requests`.

That leaves three kinds of column, each with its own merge rule:

| Columns | Merge |
|---|---|
| `requests`, `errors`, `writes`, `writeErrors`, `latencySumMs` | additive — `SET col = col + ?` |
| `minLatency`, `maxLatency` | compare-and-set — see §5 |
| average latency | not stored; derived on read |

### 5. Concurrency: atomic increment on a shared row

Two instances flushing the same `(bucket, entity)` row must not lose updates. Two shapes were considered.

**Chosen: a single shared row per `(bucket, entity)`, updated with atomic increments.** Row-level `UPDATE … SET col = col + ?` is atomic on every database the suite targets, so concurrent flushes accumulate correctly without locking.

Min and max cannot use a scalar `MIN(a, b)`, because the spelling differs by dialect — SQLite's two-argument `MIN` is HANA's `LEAST`. Rather than branch on dialect, they are compare-and-set, which needs no scalar function:

```sql
UPDATE … SET minLatency = ?
WHERE bucket = ? AND entity = ? AND (minLatency IS NULL OR minLatency > ?)
```

The row may not exist yet, and two instances can both find it missing and both `INSERT`, one losing on the primary key. The sequence is therefore: `UPDATE` first; if `rowsAffected() === 0` then `INSERT`; if that `INSERT` conflicts, retry the `UPDATE` once. Bounded, lock-free.

**This is reuse, not new machinery.** The engine already guards concurrent runs exactly this way at [`Pipeline.js:137`](../../../packages/cds-data-pipeline/srv/lib/Pipeline.js) — a conditional `UPDATE … WHERE status != 'running'` whose count is read through [`rowsAffected()`](../../../packages/cds-data-pipeline/srv/lib/rowsAffected.js), which normalizes CDS 9's `number` against CDS 10's `{ affected }` shape. [`withTransientDbRetry()`](../../../packages/cds-data-pipeline/srv/lib/transientDbError.js) supplies the retry.

Contention is negligible because flushing is per **interval**, not per request: ten instances against fifty entities on a sixty-second flush is roughly 500 statements a minute, spread across distinct rows.

**Rejected: putting the instance in the key** (`(bucket, entity, instance)`), with a `GROUP BY` on read. It removes contention entirely, but the cost is deciding what identifies an instance. A hostname or pod name is stable but not always available; a per-process UUID means a pod restarting ten times a day writes ten times the rows per bucket per entity — the table then grows with restart churn rather than with traffic, and every console read pays for an aggregation whose size depends on deployment behaviour.

### 6. Retention

Bucketed rows grow without bound. `PipelineRuns` already solved this in ADR 0014, and this must reuse that policy rather than invent a second one. A metrics table with no housekeeping is a slow leak that surfaces months later in someone else's database.

## Open questions — to resolve before implementation

**Tenant scoping.** ADR 0010 established how the entity cache and pipeline runs handle MTX. These metrics need the same treatment: either the tenant joins the key, or each tenant's context writes to its own database as the entity cache already does. That should be settled against `EntityCacheDbResolver`'s existing behaviour rather than decided fresh here, since diverging from it would give federation two tenant models.

**Flush interval and retention policy values.** The mechanism is settled (§5, §6); the numbers are not. Both should be configurable with defaults chosen after the overhead measurement below.

**Measured overhead.** §Consequences requires measuring the per-request cost with the flag on before release. Until that number exists, "negligible" is an assumption.

**Runtime toggle.** v1 is config-only: no `setMetricsEnabled` equivalent, because a runtime toggle needs somewhere to persist the operator's choice, which is a settings table for one boolean. If one is added later it **must** follow the precedence the suite just agreed for `cds-caching`: the database wins, config seeds, and clearing the override falls back to config. Introducing a second precedence model would undo that alignment.

## Implementation notes

**A CQN object predicate cannot express the compare-and-set.** The obvious spelling for
§5's guard is wrong, and wrong *silently*:

```js
.where({ ...key, or: [{ minLatency: null }, { minLatency: { '>': min } }] })
```

compiles to `bucket = ? and entity = ? or 0 minLatency = ? and 1 minLatency > ?` — no
parentheses, and stray array indices as tokens. It does not throw; it updates rows the
statement was never meant to touch. The implementation uses the tagged-template form
instead, which groups correctly:

```js
.where`bucket = ${bucket} and entity = ${entity} and (minLatency is null or minLatency > ${min})`
```

Worth remembering anywhere a parenthesised `OR` is needed alongside a key.

**Handlers are wrapped, remote calls are not.** Instrumentation sits on the four
`service.on` registrations in `handler-registration.js` rather than on each `remote.run`
call site, of which there are many across expand, navigation and paging. One consequence:
latency includes local post-processing such as expand resolution, not purely the wire
time. That is the more useful number for an operator — it is what the caller waited — but
it is not a pure remote-latency measurement.

**Failed flushes fold back.** A batch that cannot be written is merged into the live
accumulator rather than dropped, so a transient database error costs a delay rather than
a hole in the counts.

## Consequences

- The federation console becomes an operations tool for every strategy, which is what ADR 0017 §2 was waiting for.
- `cds-data-federation` gains a persisted entity, having had none. That brings a deployment consideration for existing installs and a housekeeping obligation.
- Enabling the flag adds per-request work on the delegate read path. It should be measured before release, not assumed negligible, and the measurement belongs in this ADR once taken.
- Three plugins will then each own a metrics surface. That is consistent, but it strengthens the case for the shared leaf-control library in ADR 0017 §6 so they at least look alike.
