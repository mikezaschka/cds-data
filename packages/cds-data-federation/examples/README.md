# Examples

Small, self-contained runnable examples — one per `cds-data-federation` capability — built on top of the shared backend services under [`test/fixtures/`](../test/fixtures/). Each example is a runnable CAP consumer app: its own `package.json`, `db/`, `srv/`, `http/` scenarios, `start.sh`, and a README that walks through one feature.

Each `start.sh` boots the required provider(s) from `test/fixtures/` and the example consumer, then prints the endpoints. Stop with `Ctrl+C`.

## Example catalogue

| Example | Capability | Doc anchor | Consumer port |
|---|---|---|---|
| [01-delegate](01-delegate/) | `@federation.delegate` — live proxy, field/entity renames, static `where`, CUD opt-in (OData V4) | [Federation → First delegation](../../../docs/federation/getting-started/first-delegation.md) | 4131 |
| [02-replicate](02-replicate/) | `@federation.replicate` — scheduled sync into local SQLite, delta, local SQL views | [Federation → First replication](../../../docs/federation/getting-started/first-replication.md) | 4132 |
| [03-cross-service-expand](03-cross-service-expand/) | Cross-service `$expand` + navigation (local ↔ remote) | [Federation → Cross-service scenarios](../../../docs/federation/concepts/cross-service-scenarios.md) | 4133 |
| [04-caching](04-caching/) | `cache.strategy: 'response'` (cds-caching) and `cache.strategy: 'entity'` (SQLite) on delegate | [Federation → Caching](../../../docs/federation/integration/caching.md) | 4134 |
| [05-cross-provider-mashup](05-cross-provider-mashup/) | Two remote providers + local entity in one `$expand` | [Federation → Cross-provider mashup](../../../docs/federation/getting-started/cross-provider-mashup.md) | 4135 |
| [06-odata-v2](06-odata-v2/) | Delegate against a legacy OData **V2** source with entity/field renames | [Federation → Consumption views](../../../docs/federation/concepts/consumption-views.md) | 4136 |
| [07-hcql](07-hcql/) | CAP-to-CAP delegate with an `@hcql` provider — flattened associations | [Pipeline → Remote CQN sources (OData & HCQL)](../../../docs/pipeline/guide/sources/odata.md) | 4137 |
| [mcp-federation](mcp-federation/) | Expose federated entities to AI agents via `@cap-js/mcp` | [Federation → MCP](../../../docs/federation/integration/mcp.md) | 4120 |

## Port allocation

```
Consumers                       Providers (booted per example)
4131  01-delegate               4141  01 provider (OData V4)
4132  02-replicate              4142  02 provider (OData V4)
4133  03-cross-service-expand   4143  03 provider (OData V4)
4134  04-caching                4144  04 provider (OData V4)
4135  05-cross-provider-mashup  4145  05 provider (OData V4)  + 4155 inventory (OData V4)
4136  06-odata-v2               4146  06 provider (OData V2 via cov2ap)
4137  07-hcql                   4147  07 hcql-provider (@hcql @odata)
4120  mcp-federation            4121  mcp provider (OData V4)
```

Ports are chosen to avoid clashing with the root [`examples/`](../../../examples/) launchpads (4004/4005/444x) and the `cds-data-pipeline` examples (410x/445x).

## Prerequisites

Install workspace dependencies once from the repository root:

```bash
npm install
```

Each `start.sh` will run `npm install` at the repo root if a required dependency is missing.

## Running an example

```bash
# Pick any example; its README is the walkthrough
bash packages/cds-data-federation/examples/01-delegate/start.sh
```

Then run the `.http` scenarios in the example's `http/` folder with the VS Code REST Client extension, or `curl` the printed endpoints.

## Shared backends

These examples **reuse the test fixture providers** rather than shipping duplicate backends:

| Fixture | Serves | Used by |
|---|---|---|
| [`test/fixtures/provider`](../test/fixtures/provider/) | `ProviderService` (Customers, Products, Orders, Addresses) — OData V4 **and** V2 via `@cap-js-community/odata-v2-adapter` | 01–06 |
| [`test/fixtures/inventory`](../test/fixtures/inventory/) | `InventoryService` (Warehouses, StockLevels) — OData V4 | 05 |
| [`test/fixtures/hcql-provider`](../test/fixtures/hcql-provider/) | `ProviderService` annotated `@hcql @odata` | 07 |

The imported external models (`srv/external/*.csn`) are copied into each example so the consumer compiles standalone.

## Relationship to the docs and tests

The [docs site](../../../docs/federation/) is the reference; each example shows one end-to-end configuration plus its observable output. The [`test/`](../test/) suite is the source of truth for correctness — these examples surface a curated subset with runnable wiring around them.
