# ADR 0019 — Instrumenting the delegate path

Status: Proposed
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
| `avgLatency`, `minLatency`, `maxLatency` | Time in the remote call. |
| `writes`, `writeErrors` | CUD forwarding on writable delegates, counted apart from reads: a failed write is a different incident from a failed read. |

**Deliberately excluded from v1:** latency percentiles (they need retained samples, as `cds-caching` does with `maxLatencies`), per-query metrics, and distributed tracing — the last belongs to OpenTelemetry, not to a table of our own.

**Also excluded: last-error message and timestamp.** This was offered and not taken. Noting it explicitly because it is usually the first thing an operator asks for and it is cheap to add later; the counters above will say *that* something failed without saying *what*.

### 3. In-memory accumulation, periodic flush

Counters accumulate in the process and flush to a table on an interval, the shape `cds-caching` already uses. A delegate read is a hot path, so the per-request cost stays a counter increment and a timestamp delta; nothing touches the database inline.

Persisting rather than staying in-memory buys what the console needs: survival across restarts, and aggregation across instances and tenants.

### 4. Schema

```cds
entity DelegateMetrics {
    key bucket     : String;   // 'hourly:2026-09-20T14' — same convention as cds-caching Metrics
    key entity     : String;   // consumption-view FQN — the address, per ADR 0018
        requests   : Integer;
        errors     : Integer;
        writes     : Integer;
        writeErrors: Integer;
        avgLatency : Double;
        minLatency : Double;
        maxLatency : Double;
}
```

Keyed on the consumption-view FQN, so it joins the `/federation` inventory directly and needs no name translation.

### 5. Retention

Bucketed rows grow without bound. `PipelineRuns` already solved this in ADR 0014, and this must reuse that policy rather than invent a second one. A metrics table with no housekeeping is a slow leak that surfaces months later in someone else's database.

## Open questions — to resolve before implementation

**Concurrent flush across instances.** Two app instances flushing the same `(bucket, entity)` row will collide. Options: an atomic `UPDATE … SET requests = requests + ?` accumulate, or adding the instance to the key and summing on read. The first keeps the table small and the read trivial but depends on the database's increment semantics; the second is portable but multiplies rows. **Not yet decided.** This is the single most likely source of wrong numbers, so it should be settled explicitly rather than discovered.

**Tenant scoping.** ADR 0010 established how the entity cache and pipeline runs handle MTX. These metrics need the same treatment, and per-tenant flush interacts with the concurrency question above.

**Runtime toggle.** v1 is config-only: no `setMetricsEnabled` equivalent, because a runtime toggle needs somewhere to persist the operator's choice, which is a settings table for one boolean. If one is added later it **must** follow the precedence the suite just agreed for `cds-caching`: the database wins, config seeds, and clearing the override falls back to config. Introducing a second precedence model would undo that alignment.

## Consequences

- The federation console becomes an operations tool for every strategy, which is what ADR 0017 §2 was waiting for.
- `cds-data-federation` gains a persisted entity, having had none. That brings a deployment consideration for existing installs and a housekeeping obligation.
- Enabling the flag adds per-request work on the delegate read path. It should be measured before release, not assumed negligible, and the measurement belongs in this ADR once taken.
- Three plugins will then each own a metrics surface. That is consistent, but it strengthens the case for the shared leaf-control library in ADR 0017 §6 so they at least look alike.
