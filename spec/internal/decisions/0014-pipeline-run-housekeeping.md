# ADR 0014: Pipeline run housekeeping

**Status:** Accepted  
**Date:** 2026-07-08  
**Package:** `cds-data-pipeline`

## Context

`PipelineRuns` rows are inserted on every executed run and never deleted. Long-running deployments with frequent schedules (or many pipelines) accumulate unbounded history in the tracker database.

## Decision

Add opt-in run housekeeping with:

1. **Global defaults** in `cds.requires.*.housekeeping` (`retentionDays`, `maxRuns`, `schedule`).
2. **Per-pipeline overrides** via `addPipeline({ retention: { ... } })` and the existing overrides layer.
3. **One global scheduled sweep** (spawn or queued engine) that iterates registered pipelines and applies the effective policy.
4. **Two independent retention axes** applied in sequence: age (`endTime`) then count (`startTime` desc). Never delete `running` runs.
5. **Multitenancy fan-out** reuses the same tenant context seam as scheduled pipeline ticks.

No on-demand management action in v1 — scheduled job only.

## Consequences

- Consumers must opt in explicitly; default behavior is unchanged.
- Per-pipeline overrides cannot disable global housekeeping when global retention is enabled (only adjust counts). A follow-up could add explicit opt-out if needed.
- `RunStatus` enum still omits `completed` at the CDS layer; housekeeping filters on `status != 'running'` instead.

## References

- [`docs/pipeline/guide/concepts/housekeeping.md`](../../../docs/pipeline/guide/concepts/housekeeping.md)
- Requirement **4.13.9** in [`spec/reference/requirements.md`](../../reference/requirements.md)
