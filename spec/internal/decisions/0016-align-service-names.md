# ADR 0016: Align plugin service and config keys to kebab-case defaults

Status: Accepted

## Context

The three cds-data plugins exposed inconsistent connect and configuration names:

- Pipeline engine: `datapipeline` and `DataPipelineService` kind aliases
- Pipeline settings: separate `cds.requires['cds-data-pipeline']` namespace for multitenancy/housekeeping
- Federation settings: `cds.requires['cds-data-federation']` for entityCache/multitenancy
- Entity-cache datastore: `federation-entity-cache` service key and file templates

CAP built-in services use lowercase, kebab-case keys (`db`, `messaging`, `auth`). Community plugins follow the same pattern (`caching`, `redis`).

## Decision

Standardize on three default keys (no backward compatibility):

| Concern | New default key |
|---|---|
| Pipeline engine + settings | `data-pipeline` |
| Federation plugin settings | `data-federation` |
| Entity-cache SQLite datastore | `data-federation-cache` |

Connect: `cds.connect.to('data-pipeline')`.

Pipeline multitenancy/housekeeping settings merge into the same `data-pipeline` requires entry as `impl` and `management`.

## Unchanged

- npm package names (`cds-data-pipeline`, `cds-data-federation`, …)
- `impl: "cds-data-pipeline"` values
- Internal JS class/file `DataPipelineService`
- OData management service `DataPipelineManagementService` at `/pipeline`
- CDS schema namespaces `plugin.data_pipeline` / `plugin.data_federation`
- `cds.log('cds-data-*')` channel labels

## Consequences

- Breaking change for consumers using old requires keys or connect names
- Documentation and examples updated to the new keys
- Historical ADRs and completed plans left as point-in-time records
