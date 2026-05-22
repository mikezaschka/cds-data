# Req 4.6.3 — CQN adapter on `cds-data-pipeline`

Implements the CQN source adapter on the renamed engine per ADR 0004 (superseded by ADR 0005 for naming; scope preserved) and ADR 0005 §"The kind taxonomy". Single adapter, two use cases differentiated by `kind`:

- `kind: 'replicate'` — row-preserving copy from a CQN-native `cds.requires` service (secondary DB, CAP-wrapped legacy DB, in-process CAP service). Consumption-view contract unchanged. `source.query` rejected.
- `kind: 'materialize'` — derived/aggregated snapshot built by running a user-supplied closure returning a SELECT CQN on a CAP-addressable service. Full-refresh default (TRUNCATE + INSERT), optional `refresh: 'partial-refresh'` with an explicit `slice` predicate closure.

## Affected files

| File | Change |
|---|---|
| `packages/cds-data-pipeline/srv/adapters/CqnAdapter.js` | New adapter, branches on `config.kind`. |
| `packages/cds-data-pipeline/srv/adapters/factory.js` | Route `source.kind === 'cqn'` → CqnAdapter. |
| `packages/cds-data-pipeline/srv/DataPipelineService.js` | Per-kind validation for CQN sources. |
| `packages/cds-data-pipeline/srv/lib/Pipeline.js` | Materialize write path (full + partial-refresh). |
| `packages/cds-data-pipeline/srv/DataPipelineManagementService.cds` | `kind` filter parameter on list actions. |
| `docs/pipeline/guide/sources/cqn.md` | New adapter doc, both kinds. |
| `packages/cds-data-pipeline/spec/concepts/materialize.md` | Worked `DailyCustomerRevenue` example. |
| `docs/pipeline/reference/features.md` | Adapter table entry. |
| `spec/reference/requirements.md` | Req 4.6.3 → Implemented. |
| `test/adapters/cqn-adapter.replicate.test.js` | New. |
| `test/adapters/cqn-adapter.materialize.test.js` | New. |
| `test/pipeline-validation.test.js` | Negative tests for kind-vs-source.query rules. |
| `test/consumer/db/schema.cds` | Seed source entity + materialize target table. |
| `test/consumer/srv/consumer-service.cds` | Expose new entities for tests. |
| `examples/consumer/db/schema.cds` + `srv/consumer-service.cds` | Worked examples (optional, deferred to v1.x if time). |

## Tasks

- [x] Adapter class with kind-branched `readStream()`.
- [x] Factory wiring for `source.kind === 'cqn'`.
- [x] Validation rules at `addPipeline` registration time.
- [x] Materialize target path (TRUNCATE + INSERT / slice DELETE + INSERT).
- [x] Tracker + management surface (filter by `kind`).
- [x] Docs (adapter page + worked materialize example).
- [x] Tests (replicate, materialize, negative).

## Validation commands

```bash
npx jest --runInBand --forceExit --roots test/ --testNamePattern "cqn-adapter"
npx jest --runInBand --forceExit --roots test/
npm run lint
```

## References

- ADR 0004 (superseded): `spec/internal/decisions/0004-scope-cqn-adapter-to-cds-data-replication.md`
- ADR 0005: `spec/internal/decisions/0005-reposition-engine-as-cds-data-pipeline.md`
