# cds-data-pipeline tests

Package-local Vitest harness. Run from the monorepo root:

```bash
npm run test -w cds-data-pipeline
npm run test:unit -w cds-data-pipeline
npm run test:integration -w cds-data-pipeline
```

Optional Postgres smoke tests (5 scenarios: concurrency guard, UPSERT replicate, query-shape materialize, partial refresh slice, tracker persistence):

```bash
docker compose -f docker/docker-compose.postgres.yml up -d
npm run test:integration:postgres -w cds-data-pipeline
```

CI runs the default SQLite suite on CDS 9 and CDS 10, plus the optional Postgres smoke job (see `.github/workflows/test.yml`).

## Layout

| Path | Role |
|------|------|
| `fixtures/consumer/` | CAP app under test (`cds-data-pipeline` only) |
| `fixtures/{provider,inventory-provider,rest-provider}/` | Mock remote backends |
| `support/` | Vitest setup (`CDS_PIPELINE_TEST_CONSUMER=true`), dynamic-port provider spawn, helpers |
| `unit/` | Isolated module tests (validation matrix, retry, factories, …) |
| `integration/` | End-to-end pipeline runs against fixtures |

## Fixture pipelines

`register-fixture-pipelines.js` registers pipelines when `CDS_PIPELINE_TEST_CONSUMER=true` (set in `support/setup-env.js`). Integration tests call `waitForConsumerFixturePipelines()` before executing runs.

## Ports

Provider processes bind **dynamic** free ports (`support/setup.js`) and patch `cds.env.requires` URLs before `cds.test()` loads the consumer — no fixed 4444–4446, so parallel CI jobs avoid `EADDRINUSE`.
