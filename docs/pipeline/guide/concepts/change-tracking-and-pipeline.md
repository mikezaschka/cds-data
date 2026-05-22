# Change history and pipeline replication

**`@cap-js/change-tracking`** records who changed what on entities you annotate for end-user auditing and UI “change history” features. **`cds-data-pipeline`** fills tables from remote sources and records **per-run** statistics on `Pipelines` / `PipelineRuns` (created, updated, deleted counts, watermarks, errors).

These concerns are **orthogonal**:

- Pipeline runs attribute bulk sync work to a **run** and a **pipeline name**, not to interactive user edits on individual fields.
- Change tracking attributes **row-level** changes to **business users** when they edit data through your app.

After a replicate run, rows in the target table match the remote slice you defined (consumption view, delta mode). Local **enrichment** columns (fields not overwritten by the pipeline’s UPSERT strategy) can still be edited by users; keep pipeline mapping and delta configuration aligned with what you want to preserve vs overwrite.

For pipeline observability, use the [Management Service](../../reference/management-service.md) and [Features → Observability](../../reference/features.md#observability) rather than treating `PipelineRuns` statistics as a substitute for `@cap-js/change-tracking`.

## See also

- [Consumption views](consumption-views.md) — local shape and what the pipeline writes.
- [Built-in replicate → What happens at runtime](../recipes/built-in-replicate.md#what-happens-at-runtime) — READ / MAP / WRITE and tracker updates.
