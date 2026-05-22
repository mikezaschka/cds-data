# cds-data-federation — Agent guide

Annotation-driven SAP CAP plugin for integrating remote services via `@federation.delegate` and `@federation.replicate`. Load this file when adding federated entities, choosing delegate vs replicate, configuring cache, or debugging cross-service `$expand`.

## Install and peer dependencies

```bash
npm add cds-data-federation
# When using @federation.replicate or cache.strategy: 'entity':
npm add cds-data-pipeline
```

| Package | Required when |
|---|---|
| `@sap/cds` >= 8 | Always |
| `@sap-cloud-sdk/http-client`, `@sap-cloud-sdk/resilience` | OData remote services |
| `cds-data-pipeline` | `@federation.replicate`, `cache.strategy: 'entity'`, custom pipeline hooks |
| `cds-caching` >= 1 | `cache.strategy: 'response'` (default cache strategy) |
| `@cap-js/sqlite` >= 2 | `cache.strategy: 'entity'` with secondary SQLite datastore |

The plugin auto-activates via `cds-plugin.js`. On boot, look for:

```
[cds-data-federation] discovered N @federation.* entities
```

## Strategy decision tree

```
Need remote data?
├─ Live reads / writes to system of record → @federation.delegate
├─ Local SQL, joins, offline, analytics → @federation.replicate (+ cds-data-pipeline)
└─ Reduce remote load, tolerate staleness → @federation.delegate + cache
       ├─ Per-query cache → cache.strategy: 'response' (cds-caching)
       └─ Full-entity SQLite snapshot → cache.strategy: 'entity' (cds-data-pipeline)
```

## Core principle

The **consumption view IS the federation contract**. `@federation.*` declares runtime behavior; `entity X as projection on remote.Y` declares schema, column restriction, and renames. Source, columns, and bidirectional rename mappings are inferred from the projection.

## Top anti-patterns

❌ **Wrong** — annotation without projection:

```cds
@federation.delegate
entity Customers { key ID: UUID; name: String; }
```

✅ **Correct**:

```cds
@federation.delegate
entity Customers as projection on remote.Customers;
```

❌ **Wrong** — `@federation.replicate` without `cds-data-pipeline` installed.

✅ **Correct** — install both packages; boot fails fast with an actionable error if replicate is annotated but the engine is missing.

❌ **Wrong** — `@cds.federated` (reserved for SAP).

✅ **Correct** — `@federation.delegate` or `@federation.replicate`.

❌ **Wrong** — writable by default or hand-written `on('READ')` handlers for federated entities.

✅ **Correct** — read-only by default; opt in with `writable: true` or individual `create` / `update` / `delete` flags.

❌ **Wrong** — `@federation.delegate` for plain REST JSON APIs.

✅ **Correct** — use `@federation.replicate` with `rest: { path, pagination, ... }` config.

## Skills (task workflows)

| Skill | Use when |
|---|---|
| [federation-setup](skills/federation-setup/SKILL.md) | Installing, peer deps, verifying plugin boot |
| [delegate-consumption-view](skills/delegate-consumption-view/SKILL.md) | Adding `@federation.delegate`, projections, renames, CUD |
| [replicate-consumption-view](skills/replicate-consumption-view/SKILL.md) | Adding `@federation.replicate`, schedule, delta |
| [cross-service-expand](skills/cross-service-expand/SKILL.md) | `$expand`, navigation filters, cross-provider mashups |

## MCP recommendation

Before proposing CDS or CAP runtime changes, configure [`@cap-js/mcp-server`](https://www.npmjs.com/package/@cap-js/mcp-server) and use `search_model` / `search_docs`. Do not guess entity shapes or CAP APIs from memory.

## Documentation

- Federation guide: https://mikezaschka.github.io/cds-data-federation/federation/
- Annotations: https://mikezaschka.github.io/cds-data-federation/federation/reference/annotations.html
- Consumption views: https://mikezaschka.github.io/cds-data-federation/federation/concepts/consumption-views.html
- Cross-service scenarios: https://mikezaschka.github.io/cds-data-federation/federation/concepts/cross-service-scenarios.html
- Caching: https://mikezaschka.github.io/cds-data-federation/federation/integration/caching.html
