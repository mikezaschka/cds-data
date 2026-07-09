# CDS 10, HCQL and MCP

CAP's June 2026 release (**cds 10**) adds two capabilities that compose with `cds-data` **without any change to your annotations or pipeline configuration**. Both build on the same fact: queries reach the plugins only when dispatched through the application service.

All three `cds-data` packages run on both CDS 9 and CDS 10 (`@sap/cds >= 9`). The behavior below only activates on CDS 10 with a CAP-to-CAP hop or the MCP adapter installed.

## HCQL — a faster wire protocol for delegate and replicate

**HCQL** (CQL over HTTP) is a new CAP protocol adapter that carries a CQN `SELECT` as an HTTP request instead of translating it to OData `$filter` / `$select`. For **CAP-to-CAP** integration, CAP's remote client **auto-selects HCQL** over OData when the provider serves `@hcql`. CAP describes HCQL as *"best suited, and thus chosen automatically for data federation scenarios."*

The plugins never serialize the wire protocol themselves — they forward CQN via `remote.run(query)`. So both federation strategies benefit transparently:

| Strategy | Read path | HCQL benefit |
|---|---|---|
| `@federation.delegate` | `remote.run(req.query)` on the application service | Richer path expressions (flattened associations like `customer.name`) that OData-only remotes cannot express |
| `@federation.replicate` | Pipeline READ phase via the engine's remote adapter | Same adapter handles OData V2/V4 and HCQL; delta paging is unchanged |

There is **no `@federation.hcql` strategy** and no adapter to pick — HCQL is a CAP-runtime choice. Annotate the CAP provider `@hcql @odata` and bind the consumer as usual. See:

- [Federation → Service query execution](/federation/concepts/service-query-execution#cds-10-hcql-and-mcp) — the dispatch story.
- [Pipeline → Remote CQN sources (OData & HCQL)](/pipeline/guide/sources/odata) — adapter details and flattened-column behavior.

## MCP — exposing data to AI agents

CAP's [`@cap-js/mcp`](https://cap.cloud.sap/docs/guides/protocols/mcp) protocol adapter exposes a service to AI agents over the **Model Context Protocol**. Annotate a service `@mcp: 'agent'` and its entities become MCP tools (`describe`, `query`, `call_action`).

Because MCP `query` calls run **CQN on the application service**, they hit the same `@federation.delegate` / `@federation.replicate` handlers that OData and `srv.run` do — MCP never calls remote providers directly:

```
AI agent ──tools/call query──▶ @mcp service ──srv.run(CQN)──▶ federation handler
                                                              ├─ delegate → remote provider
                                                              └─ replicate → local synced table
```

An MCP agent transparently gets live-proxied remote data (delegate), locally synced data (replicate), or cached responses — with no MCP-specific federation code. See [Federation → MCP integration](/federation/integration/mcp) for a runnable demo.
