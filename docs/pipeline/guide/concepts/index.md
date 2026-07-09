# Concepts

The small vocabulary `cds-data-pipeline` is built on. These pages cover the pieces of `addPipeline(...)`, what the plugin infers from your config, and the event namespace every pipeline exposes.

- **[Terminology](terminology.md)** — Pipeline, source, target, mode, delta strategy, tracker, event namespace. The primitives every pipeline registration composes.

- **[Inference rules](inference.md)** — How `addPipeline(...)` derives pipeline behavior from the config shape — read shape, inferred defaults — and which config combinations are rejected at registration.

- **[Configuration overrides](overrides.md)** — Persisted runtime overrides layered on the coded baseline (schedule, mode, delta, tuning knobs, pause). Survive restarts; surfaced in the management API and Pipeline Console.

- **[Run housekeeping](housekeeping.md)** — Opt-in retention for `PipelineRuns` history: global defaults, per-pipeline overrides, scheduled age/count pruning.

- **[Consumption views](consumption-views.md)** — The idiomatic CAP pattern for shaping a replicate target — a `projection on <remote.Entity>` that declares target schema, column restriction, and rename mapping in one place.

- **[Change history and pipeline replication](change-tracking-and-pipeline.md)** — How `@cap-js/change-tracking` relates to pipeline-filled tables, per-run `PipelineRuns` statistics, and user-edited local enrichment data.
