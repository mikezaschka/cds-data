---
name: cross-service-expand
description: Handles cross-service $expand and navigation in cds-data-federation. Use when expanding local to remote, remote to local, cross-provider mashups, navigation filters, or association renames across federated entities.
---

# Cross-service expand and navigation

## Rule of thumb

Every cross-service scenario has the **remote side on `@federation.delegate`**. The local side can be a plain db entity or `@federation.replicate` (materialized local table — query-time equivalent).

`@federation.replicate` has no expand scenarios of its own; it participates only as the local side.

## Scenario picker

| Your ask | Scenario | Main entity | Expand / nav target |
|---|---|---|---|
| Expand assoc on same remote provider | Delegated expand | `@federation.delegate` | `@federation.delegate` (same provider) |
| Local entity expands to remote | Cross-service expand: local → remote | local or `@federation.replicate` | `@federation.delegate` |
| Remote entity expands to local | Cross-service expand: remote → local | `@federation.delegate` | local or `@federation.replicate` |
| Multiple remote providers in one expand | Cross-service expand: cross-provider | local or `@federation.replicate` | `@federation.delegate` (different providers) |
| Navigate local → remote tail | Cross-service navigation: local → remote | local or `@federation.replicate` | `@federation.delegate` |
| Navigate remote → local tail | Cross-service navigation: remote → local | `@federation.delegate` | local or `@federation.replicate` |

## What the plugin does

CAP passes `$expand` as CQN column objects in `req.query.SELECT.columns`. The delegate handler must return nested objects — flat results yield empty expands.

The plugin:

1. Strips federated expand items from the main query
2. Executes each side against the correct service
3. Stitches results by foreign key (including composite keys and to-many grouping)

## Association renames matter

If local assoc is `buyer` but remote is `customer`, declare the rename in the consumption view:

```cds
@federation.delegate
entity Orders as projection on remote.Orders {
    customer as buyer,
    ...
};
```

Filters like `$filter=buyer/name eq 'Acme'` translate to remote `customer/name`.

## Anti-patterns

❌ **Wrong** — expecting `@federation.replicate` to proxy live `$expand` to the remote.

✅ **Correct** — replicate materializes locally; use it as the local side, delegate on the remote side.

❌ **Wrong** — `@federation.delegate` on both sides when providers differ without understanding cross-provider stitching.

✅ **Correct** — each remote entity is its own delegate view; local entity holds FKs; plugin handles multi-hop expand.

❌ **Wrong** — hand-splitting expand queries in application code when annotations already define the federation contract.

✅ **Correct** — model associations in CDS; issue a single OData query with `$expand`.

## Docs

- Full scenario reference: https://mikezaschka.github.io/cds-data/federation/concepts/cross-service-scenarios.html
- Cross-provider mashup: https://mikezaschka.github.io/cds-data/federation/getting-started/cross-provider-mashup.html
