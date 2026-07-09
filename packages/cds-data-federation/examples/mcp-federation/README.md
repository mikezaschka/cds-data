# MCP + cds-data-federation example

Runnable demo showing how SAP CAP’s [`@cap-js/mcp`](https://cap.cloud.sap/docs/guides/protocols/mcp) protocol adapter composes with **cds-data-federation**:

| Entity | Federation strategy | What MCP `query` hits |
|---|---|---|
| `Customers` | `@federation.delegate` | Live OData proxy → ProviderService |
| `Products` | `@federation.delegate` (renames) | Live proxy with `productId` / `unitPrice` mapping |
| `ReplicatedCustomers` | `@federation.replicate: { preload: { mode: 'full' } }` | Local SQLite table (pipeline-fed, preloaded at startup) |

All three are exposed on a single **`FederationAgentService`** annotated with `@mcp:'agent'`.

## Prerequisites

- Node.js ≥ 22
- Monorepo dependencies installed from the repository root (`npm install`)

## MCP query format note

The `query` tool expects **CQN-style** `select` entries (objects with `ref` arrays), not plain field name strings:

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

The smoke script (`scripts/mcp-smoke.mjs`) and integration test demonstrate this format.

## Quick start

```bash
bash packages/cds-data-federation/examples/mcp-federation/start.sh
```

In another terminal:

```bash
node packages/cds-data-federation/examples/mcp-federation/scripts/mcp-smoke.mjs
```

### Endpoints

| URL | Purpose |
|---|---|
| http://localhost:4120/mcp/agent | MCP Streamable HTTP (tools: `describe`, `query`, `call_action`) |
| http://localhost:4120/odata/v4/federation-agent/Customers | Same data via OData (compare) |
| http://localhost:4120/launchpage.html | Launchpad — Pipeline Console tile |
| http://localhost:4120/pipeline-console/ | Pipeline Console — runs, status, errors, data inspection |
| http://localhost:4121/odata/v4/provider/Customers | Upstream remote provider |

The **Pipeline Console** is served automatically by `cds-data-pipeline` via `management.reuse.console` (see the consumer's `package.json`). Use it to watch the `ReplicatedCustomers` preload run and inspect the replicated rows.

Ports **4120** (consumer) and **4121** (provider) are chosen to avoid clashing with the main `examples/` launchpad on 4004/4444.

## Try with an AI client

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

1. Transport: **Streamable HTTP**
2. URL: `http://localhost:4120/mcp/agent`
3. Connection: **Via Proxy** → Connect
4. Tools → **List Tools** → run `describe`, then `query` on `Customers`

### Claude Code (manual wiring)

Autowiring is disabled in this example (`cds.mcp.autowire: false`). Add the server manually:

```bash
claude mcp add --transport http federation-agent http://localhost:4120/mcp/agent
claude "list customers from the federation agent service"
```

## Architecture

```
 AI agent / MCP Inspector
         │  tools/call query
         ▼
  @mcp FederationAgentService  (/mcp/agent)
         │  srv.run(CQN)
         ├─► @federation.delegate handler ──► ProviderService (OData :4121)
         └─► ReplicatedCustomers (local SQLite)
                    ▲
                    │  cds-data-pipeline (preload on startup)
                    └── remote.Customers
```

MCP does **not** call remote services directly. It runs CQN on the application service; federation handlers registered by **cds-data-federation** forward delegated reads to the remote provider — the same path OData uses.

## Replicated data

`ReplicatedCustomers` uses `@federation.replicate: { preload: { mode: 'full' } }`, so the pipeline runs a **full** replicate at server startup — no bootstrap code needed. The `preload` run happens in the background (non-blocking); a failed remote read is logged, not fatal. To refresh manually:

```http
POST http://localhost:4120/pipeline/Pipelines(name='ReplicatedCustomers')/start
Content-Type: application/json

{ "mode": "full" }
```

(See `http/replicate.http`.)

## Integration test

The Jest/Vitest suite includes an automated check:

```bash
npm run test:integration -w cds-data-federation -- test/integration/mcp
```

## Related docs

- [MCP Protocol Adapter (capire)](https://cap.cloud.sap/docs/guides/protocols/mcp)
- [cds-data-federation README](../../README.md)
- [June 2026 release — MCP highlight](https://cap.cloud.sap/docs/releases/2026/jun26)
