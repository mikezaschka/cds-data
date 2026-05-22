# cds-data-pipeline tests

Package-local Jest harness. Run from the monorepo root:

```bash
npm run test -w cds-data-pipeline
npm run test:unit -w cds-data-pipeline
npm run test:integration -w cds-data-pipeline
```

## Layout

| Path | Role |
|------|------|
| `fixtures/consumer/` | CAP app under test (`cds-data-pipeline` only) |
| `fixtures/{provider,inventory-provider,rest-provider}/` | Mock remote backends |
| `support/` | Jest env (`CDS_PIPELINE_TEST_CONSUMER=true`), dynamic-port provider spawn, helpers |
| `unit/` | Isolated module tests (validation matrix, retry, factories, …) |
| `integration/` | End-to-end pipeline runs against fixtures |

## Fixture pipelines

`register-fixture-pipelines.js` registers pipelines when `CDS_PIPELINE_TEST_CONSUMER=true` (set in `support/jest-setup-env.js`). Integration tests call `waitForConsumerFixturePipelines()` before executing runs.

## Ports

Provider processes bind **dynamic** free ports (`support/setup.js`) and patch `cds.env.requires` URLs before `cds.test()` loads the consumer — no fixed 4444–4446, so parallel CI jobs avoid `EADDRINUSE`.
