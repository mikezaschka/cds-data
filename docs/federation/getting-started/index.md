# Getting Started

This section walks through the shortest path from a clean CAP app to a working federation — delegation, replication, and cache, one at a time.

| Page | What you'll do |
|---|---|
| [Installation](installation.md) | Install the plugin and its peer dependencies. |
| [First Delegation](first-delegation.md) | Annotate a consumption view with `@federation.delegate` and forward OData queries to a remote service. |
| [First Replication](first-replication.md) | Annotate a consumption view with `@federation.replicate` and sync remote data into the local DB on a schedule. |
| [First Cache](first-cache.md) | Add caching to a delegate — response cache (`cds-caching`) or entity cache (SQLite snapshot). |

## Patterns

Once the basics click, these task-focused pages show how local and remote data combine in real scenarios. Each page mirrors behavior that is covered by tests in [`packages/cds-data-federation/test/integration/`](https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-federation/test/integration) and [`packages/cds-data-pipeline/test/integration/`](https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-pipeline/test/integration).

| Page | When to reach for it |
|---|---|
| [Joining Local with Remote](joining-local-with-remote.md) | A local entity (reviews, bookmarks, notes) references a federated one. Covers cross-service `$expand`, navigation, and `$filter`. |
| [Extending Remote with Local](extending-remote-with-local.md) | A federated entity needs local-only children (bookmarks, tags, approval status). The reverse direction of the page above. |
| [Cross-Provider Mashup](cross-provider-mashup.md) | One local entity stitches data from two different remote services in a single response. |
| [Mixing Delegate and Replicate](mixing-delegate-and-replicate.md) | Live data via delegate, reference data via replicate — both strategies in one service. |
| [Local Analytics over Replicated Data](local-analytics-over-replicated.md) | SQL aggregations, joins, `DISTINCT`, `$apply` over replicated remote tables. |

!!! tip "Prefer learning from runnable examples?"
    The [`examples/`](https://github.com/mikezaschka/cds-data/tree/main/examples) folder contains four servers you can boot in a single command (`npm run examples:start`) with Fiori Elements UIs aggregated in a launchpad. Every tile maps to one of the getting-started scenarios.
