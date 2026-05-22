# cds-data-federation tests

Package-local Jest suite for `@federation.*` delegation, caching, CUD, cross-service expand/navigation, and thin replicate→pipeline binding. Engine-depth pipeline runs live in [`packages/cds-data-pipeline/test/`](../cds-data-pipeline/test/).

## Layout

```
test/
  support/           jest-setup-env.js (cds.root → fixtures/consumer), setup.js (dynamic ports)
  fixtures/
    consumer/        Movies-style CAP app with @federation.* + cds-data-pipeline peer
    provider/        OData V4 + V2 mock
    inventory/       Second OData provider (multi-service mashup)
    rest-provider/   Plain REST server (replicate REST seam)
  unit/              Scanner, write flags (no I/O)
  integration/
    delegate/        Basic queries + delegated expand (A1–A7), parameterised V4/V2
    expand-local-to-remote/
    expand-remote-to-local/
    navigation/
    consumption-views/
    caching/
    cud/
    cql/
    misc/
    replicate-binding/   Thin @federation.replicate → pipeline registration smoke
    northwind/           Optional external contract tests (skipped when unreachable)
```

## Running

From the monorepo root:

```bash
npm run test -w cds-data-federation
npm run test:unit -w cds-data-federation
npm run test:integration -w cds-data-federation
```

Provider processes bind **dynamic** free ports (`support/setup.js`) and patch `cds.env.requires` URLs **before** `cds.test()` loads the consumer — start fixture servers in `beforeAll` above the `cds.test(...)` call in each spec file.

Tests tagged `it('[<id>] ...')` are indexed in [`spec/reference/test-mapping.md`](../../../spec/reference/test-mapping.md); regenerate with `npm run sync:requirements` from the repo root.
