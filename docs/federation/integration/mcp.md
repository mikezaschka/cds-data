# MCP — exposing federated data to AI agents

CAP's [`@cap-js/mcp`](https://cap.cloud.sap/docs/guides/protocols/mcp) protocol adapter (June 2026 / cds 10) serves a CAP service over the **Model Context Protocol**, so AI agents can `describe` its shape and `query` its data. Federated entities work through MCP with **no MCP-specific code** — the same reason they work over OData.

## Why it just works

An MCP `query` call runs a **CQN `SELECT` on the application service**, which is exactly the dispatch path the `@federation.*` handlers hook into (see [Service query execution](../concepts/service-query-execution#cds-10-hcql-and-mcp)). MCP never reaches a remote provider directly.

```
 AI agent / MCP Inspector
         │  tools/call query
         ▼
  @mcp FederationAgentService  (/mcp/agent)
         │  srv.run(CQN)
         ├─► @federation.delegate handler ──► remote provider (OData / HCQL)
         └─► @federation.replicate table  ──► local synced data
```

So an agent transparently gets:

- **live remote data** for `@federation.delegate` entities,
- **locally synced data** for `@federation.replicate` entities,
- **cached responses** if a `cache` option is configured on either strategy.

## Minimal setup

Annotate the served service `@mcp: 'agent'` and declare federated entities on it as usual:

```cds
using { ProviderService as remote } from './external/ProviderService';

@mcp: 'agent'
service FederationAgentService {

  // live proxy
  @federation.delegate
  entity Customers as projection on remote.Customers;

  // live proxy with renames
  @federation.delegate
  entity Products as projection on remote.Products {
    ID    as productId,
    name  as productName,
    price as unitPrice
  };

  // scheduled sync into a local table, preloaded at startup
  @federation.replicate: { preload: { mode: 'full' } }
  entity ReplicatedCustomers as projection on remote.Customers;
}
```

Add the MCP adapter to the project:

```bash
npm add @cap-js/mcp
```

The entities are now reachable both over OData (`/odata/v4/federation-agent/...`) and over MCP (`/mcp/agent`).

## Make replicated freshness visible

Replication deliberately trades freshness for local performance and availability. An MCP client cannot infer from `describe` whether a row is live or a scheduled copy, so expose freshness metadata when the distinction matters:

```cds
using { User } from '@sap/cds/common';

@federation.replicate: { schedule: '*/5 * * * *' }
entity ReplicatedCustomers as projection on remote.Customers {
  *,
  null as lastReplicatedAt : Timestamp @cds.on.insert: $now  @cds.on.update: $now,
  null as lastReplicatedBy : User      @cds.on.insert: $user @cds.on.update: $user
};
```

The pipeline stamps both fields on every full or delta sync. Include `lastReplicatedAt` in agent queries so answers can state their data timestamp. For entity-level monitoring and failed-run diagnosis, use the [pipeline management service](/pipeline/reference/management-service), which exposes `Pipelines.lastSync` and run history.

## Query format

The MCP `query` tool expects **CQN-style** `select` entries (objects with `ref` arrays), not plain field-name strings:

```json
{
  "entity": "Products",
  "select": [
    { "ref": ["productId"] },
    { "ref": ["productName"] }
  ],
  "limit": 5
}
```

Renames declared on the consumption view apply as usual — the agent sees `productId` / `unitPrice`, and delegate forwarding translates them back to the remote's `ID` / `price`.

## Runnable example

A complete, runnable demo — delegate, delegate-with-renames, and preloaded replicate on one `@mcp` service — lives in the repository at [`packages/cds-data-federation/examples/mcp-federation/`](https://github.com/mikezaschka/cds-data/tree/main/packages/cds-data-federation/examples/mcp-federation). It includes a smoke script, `.http` scenarios, and instructions for the MCP Inspector and Claude Code.

## See also

- [Service query execution → CDS 10, HCQL and MCP](../concepts/service-query-execution#cds-10-hcql-and-mcp) — why the dispatch path makes this work
- [CAP: MCP protocol adapter](https://cap.cloud.sap/docs/guides/protocols/mcp)
- [CAP: June 2026 release](https://cap.cloud.sap/docs/releases/2026/jun26)
