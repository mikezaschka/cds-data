# HCQL evaluation — relevance for cds-data plugins

**Date:** 2026-07-04
**Status:** Research (no runtime commitment)
**Related:** [ADR 0011](../decisions/0011-cds-9-10-dual-compatibility.md), [Req §1.5](../../reference/requirements.md), [CAP June 2026 release — HCQL](https://cap.cloud.sap/docs/releases/2026/jun26#new-hcql-protocol-adapter), [CAP-level Service Integration](https://cap.cloud.sap/docs/guides/integration/calesi)

## Summary

HCQL (CQL over HTTP) is **relevant** to this monorepo but **does not require immediate plugin changes**. CAP's remote client already auto-selects HCQL over OData when the remote service serves `@hcql`. Federation delegate forwarding and pipeline reads that go through `cds.connect.to(...).run(query)` benefit automatically on CAP-to-CAP hops. Gaps remain for OData-specific adapter code, flatten-association limitations documented as OData-only, and REST/non-CAP sources.

**Recommendation:** document the automatic benefit for delegate + CAP-to-CAP replicate; defer a dedicated HCQL source adapter until a concrete consumer scenario fails on OData (flattened projections, expand shape, or performance).

---

## What HCQL is

- Protocol adapter (`@hcql`) serving CQN `SELECT` as JSON POST (or CQL text on Node.js).
- Outbound: CAP remote proxies translate `srv.run(query)` / tagged templates to HCQL when available — **preferred over OData/REST** for CAP-to-CAP integration.
- Beta on Node.js and Java (read subset stable cross-runtime).

CAP states HCQL is *"best suited, and thus chosen automatically for data federation scenarios"* ([June 2026 release](https://cap.cloud.sap/docs/releases/2026/jun26#new-hcql-protocol-adapter)).

---

## Federation (`cds-data-federation`)

### Delegate — automatic benefit

Delegate handlers forward unchanged CQN:

```javascript
// packages/cds-data-federation/srv/delegation/index.js (concept)
remote.run(req.query)
```

When `remote` is a CAP `RemoteService` bound to a provider that serves HCQL, CAP's client stack selects HCQL without plugin changes. Query translation through consumption-view projections (renames, `$filter`, `$expand`) stays in CAP runtime — same as today with OData.

**Implication:** CAP-to-CAP delegate setups should prefer remote services annotated `@hcql @odata` (as in xflights/xtravels). No `@federation.*` annotation change required.

### Cross-service expand / navigation

Plugin-added batch expand logic (`expand-local-to-remote.js`, etc.) issues explicit remote reads. Those also route through `remote.run()` / `remote.read()` — HCQL applies when available, which may improve denormalized `$select` paths that OData cannot express (see Req 4.1.3 / flatten associations).

**Follow-up test idea:** unskip or add an integration test against an HCQL-serving fixture provider and verify flattened projection columns replicate/delegate correctly (today skipped/documented as OData limitation).

### Replicate (`@federation.replicate`)

Pipeline binding registers entity-shape pipelines with OData source adapter when `kind: odata`. The **read path** is `ODataAdapter.readStream` → `this.service.run(query)` on a connected remote service. If the remote is CAP and HCQL is auto-selected, **reads may already use HCQL** even though the adapter class is named OData.

Pagination uses `limit`/`skip` loops — verify HCQL remote supports the same paging semantics as OData adapter expects (likely yes for CAP services; needs fixture proof).

---

## Pipeline engine (`cds-data-pipeline`)

### Current adapter model

| Adapter | When used | HCQL relevance |
|---|---|---|
| `ODataAdapter` | `source.service` with OData kind | Indirect — uses `RemoteService.run()`; HCQL if CAP auto-selects |
| `RestAdapter` | REST JSON sources | None — not CQN-native |
| `CqnAdapter` | In-process / db CQN | N/A (local) |

`ODataAdapter` contains OData-v2-specific delta timestamp formatting (`slice(0, -1)` on ISO string). HCQL/CAP-native remotes likely use standard ISO — **delta filter shape may differ** if HCQL is selected; worth a targeted test when promoting HCQL explicitly.

### No dedicated HCQL adapter today

A first-class `HcqlAdapter` (or renaming `ODataAdapter` → protocol-agnostic `RemoteCqnAdapter`) would only add value if:

1. We need to **force** HCQL when CAP does not auto-select (misconfigured remote binding).
2. We need HCQL-specific capabilities (CQL text body, richer expand paths) with explicit error messages.
3. OData adapter pagination/retry assumptions break under HCQL in practice.

**Not recommended now** — auto-selection covers the primary CAP-to-CAP case.

---

## Materialization (`cds-data-materialization`)

Query-shape snapshots compile projections to CQN and run against **local** `db` or in-process services — HCQL is irrelevant unless the aggregate source is remote (rejected in v1 `@materialize.snapshot`; stage-then-aggregate is the default pattern). See [HCQL adoption plan § Remote materialize spike](../plans/hcql-adoption.md#remote-materialize-over-hcql--spike-criteria) for re-evaluation criteria.

---

## Comparison with CAP built-in federation sample

CAP's xtravels `data-federation.js` replication log shows HCQL requests with flattened columns when reading from `@capire/xflights-data`. Our `@federation.replicate` + pipeline engine should behave similarly when the remote serves HCQL — the MAP phase and view mapping already handle column renames on the result side.

---

## Risks / open questions

| Topic | Risk | Mitigation |
|---|---|---|
| HCQL still Beta | Protocol or read-subset changes | Feature-detect; no hard dependency on HCQL-only APIs |
| OData v2 timestamp delta | HCQL may not need v2 truncation | Test delta sync CAP-to-CAP over HCQL |
| Flatten associations (Req 4.1.3) | Marked Not supported (OData) | Re-evaluate status when HCQL fixture proves it works end-to-end |
| Explicit `kind: odata-v2` in `cds.requires` | May prevent HCQL auto-selection | Document: add `@hcql` on provider; consumer binding follows CAP protocol negotiation |

---

## Recommended next steps (future work, not in scope)

1. Add HCQL-serving provider fixture (`@hcql` on ProviderService) and one federation integration test for flattened delegate `$select`.
2. If green, update Req 4.1.3 status from "Not supported (OData limitation)" to "Supported with HCQL remote (CAP-to-CAP)".
3. Optionally rename/document `ODataAdapter` as "remote CQN adapter (OData or HCQL via CAP client)" without code split.
4. Do **not** add `@hcql` exposure on plugin management services unless a concrete AI/MCP ops use case is requested (see June 2026 MCP adapter — out of scope for this spike).
