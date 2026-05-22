# How cds-data-federation Compares

This document positions `cds-data-federation` against other approaches for integrating remote services into a SAP CAP application. The space is active — SAP samples, community plugins, blog posts, database features, and enterprise platforms all tackle pieces of the same problem. The goal here is to make the trade-offs visible so you can pick the right tool for your scenario.

## Scope: application-level integration

The plugin's focus is **application-level integration** — the CAP service is the owner of the integration contract. Consumption views, field renames, cross-service `$expand` resolution, scheduled sync, and hooks all live inside the CAP app, as part of the application's own codebase and deployment.

This is a deliberate contrast to **DB-layer** approaches (HANA synonyms, Smart Data Access) where integration happens underneath CAP at the database level, and to **platform-layer** approaches (Datasphere, generic CDC/ETL) where integration happens outside the CAP app in a data-integration platform. Those options are included in the matrices below for orientation, but they solve different problems at different architectural layers. Pick DB-layer tools when you want joins to disappear into the database; pick platform tools when data-warehouse-scale volumes or enterprise governance are the driver; pick this plugin when the CAP app itself is where the integration logic belongs.

The two strategies the plugin offers — **delegation** (live proxy) and **replication** (scheduled sync into the local DB) — compete with different alternatives, so the comparison is split accordingly.

---

## What "CAP (manual)" means

Throughout this document, **CAP (manual)** refers to the hand-written integration pattern demonstrated in SAP's own reference applications:

- [**xtravels**](https://github.com/capire/xtravels) — the CaLeSi reference sample. Delegation via `this.on('READ', Entity, req => remote.run(req.query))`, replication via a generic `@federated` handler in [`srv/data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js).
- [**Risk Management — ext-service branch**](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui) — SAP's S/4HANA mashup sample. Five hand-written handlers in [`risk-service.js`](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js) implement every pattern the plugin automates.
- [**Kai Niklas — CAP Remote Services + Fiori Elements**](https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/) — an end-to-end walkthrough of the same manual pattern for a Fiori Elements frontend.
- [**Gregor Wolf — cap-replication-demo**](https://github.com/gregorwolf/cap-replication-demo) — a replication-focused demo against the S/4HANA Business Partner API (`API_BUSINESS_PARTNER`). Illustrates the full manual recipe for scheduled sync: action-triggered load (`loadEntitiesFromS4`), manual offset pagination loop driven by `$count`, per-entity column projection and destination routing via a `map.js` config, `UPSERT(entity).into(table)` for idempotent writes, and event-driven upsert on `sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1` via `cds.connect.to('messaging')`. No scheduler, no delta tracking, no retry/concurrency guard — everything `cds-data-federation` automates via `@federation.replicate` is hand-coded here, which makes it a useful side-by-side reference for what the annotation actually replaces.

CAP provides all the primitives (`cds.connect.to`, `srv.run`, projection chains, `@cds.persistence.table`, `UPSERT`, `cds.outboxed`). The manual approach wires them together per entity. See [CAP Built-in Analysis](../internal/research/cap-builtin-analysis.md) for a detailed breakdown of what CAP offers natively and what the plugin adds on top.

---

## Delegation alternatives

| Capability | cds-data-federation (delegate) | CAP (manual, CaLeSi samples) | CAP + [cds-caching](https://github.com/mikezaschka/cds-caching) (manual) | [@cap-js-community/common](https://github.com/cap-js-community/common) (Replication Cache) | HANA-native (synonyms / SDA) |
|---|---|---|---|---|---|
| Architectural layer | application | application | application | application | database |
| Zero handler code (declarative) | yes, via annotation | no, per-entity handler | no, manual cache wrap | yes, via `@cds.replicate` | yes, via `.hdbsynonym` / virtual tables |
| Live forwarding of reads | yes | yes | yes (with cached reads) | no — served from SQLite snapshot within TTL | yes, as native HANA joins |
| Cross-service `$expand` | yes, all three scenarios | hand-written per case | hand-written per case | no — each entity cached independently | limited to same HANA DB |
| Field / association renames | automatic from projection | CAP projection chain | CAP projection chain | no — data cached verbatim | via CDS view on top of synonym |
| Write-back (CUD) | opt-in per entity | hand-written | not cache-applicable | not supported (read-only) | depends on target schema grants; typically read-only |
| Caching model | response-level (via cds-caching) | none | response-level | entity-level (full dataset into per-tenant SQLite, TTL + LRU) | DB-level only |
| Non-HANA sources | yes | yes | yes | yes | SDA only (MSSQL, Oracle, Postgres, remote HANA) |

### Note on HANA-native integration

HANA synonyms (`.hdbsynonym`) and Smart Data Access are two tools in the same DB-layer kit: synonyms alias a table or view in another HANA schema (typically same HANA instance, e.g., an S/4HANA CDS view in a paired schema), SDA provides virtual tables that federate remote HANA or non-HANA sources. In CAP projects they are often combined — an SDA virtual table in one schema, a synonym in the app's HDI container pointing at it — so the combined column reflects the typical deployment. They're the right answer when the integration boundary should disappear into the database (native joins, pushdown to HANA's query engine, no CAP-level handler code) and wrong when the boundary logically belongs to the application service.

### Note on the Replication Cache

The Replication Cache in [`@cap-js-community/common`](https://github.com/cap-js-community/common) is worth calling out separately: despite the name, it is architecturally a **delegation-side cache**, not a replication strategy. It replicates a full entity dataset into a separate per-tenant SQLite file and serves any subsequent query against that entity from there within a TTL — complementary to cds-data-federation's current response-level cache (one remote call covers varied `$filter`/`$orderby`/`$select` patterns), but unaware of consumption views, field renames, or cross-entity joins. See [Replication Cache Analysis](../internal/research/replication-cache-analysis.md) for the full analysis.

---

## Replication alternatives

| Capability | cds-data-federation (replicate) | CAP (manual sync code) | SAP Business Data Cloud (Datasphere Replication Flow) | Generic CDC / ETL (Debezium, Airflow, dbt) |
|---|---|---|---|---|
| Architectural layer | application | application | platform | platform |
| Zero setup code (declarative) | yes, via annotation + schedule | no | yes, modeled in the platform | no, pipeline code |
| Scheduled full / delta sync | yes, both modes | roll your own | yes | yes |
| Idempotent writes (UPSERT) | built-in | hand-written | yes | depends on pipeline |
| Retry + concurrency guard | built-in | hand-written | platform-managed | platform-managed |
| Non-OData / REST sources | yes, adapter factory | adapter code required | yes | yes (core strength) |
| Field / association renames | from projection + MAP hook | manual | via transformations | pipeline code |
| Caching model | response-level option (via [cds-caching](https://github.com/mikezaschka/cds-caching)) | none | n/a (queries go to local tables) | n/a |
| Primary scale target | app-level integration | app-level integration | enterprise data landscape | data-warehouse / lake |

---

## Positioning

The plugin targets the **application layer** exclusively: a CAP service that needs remote data shaped into its own model, where the integration contract is part of the application's own codebase and lifecycle. Within that scope it aims to remove the per-entity handler boilerplate that the CaLeSi samples still require.

Outside that scope, other tools remain the right choice:

- **HANA synonyms / SDA** — pick when the integration boundary logically belongs to the database, queries stay within HANA, and native joins and pushdown are the point.
- **SAP Business Data Cloud (BDC)** — the umbrella data platform announced Feb 2025 that now contains Datasphere, Databricks integration, Analytics Cloud, and Joule agents. Pick for a governed, enterprise-scale data fabric across SAP applications; Datasphere's Replication Flow (in the table above) is the specific feature that competes with `@federation.replicate`.
- **SAP Cloud Integration (Integration Suite)** — iPaaS. Pick when the integration itself is the deliverable — transformation logic, B2B/EDI, messaging-based A2A, routing, error handling in middleware. Also a valid *upstream producer*: CPI can expose a virtualized OData/REST endpoint that a CAP app then consumes via `@federation.delegate`, or push into a HANA Cloud table that the app reads locally. For pure scheduled replication without the transformation/messaging needs, Datasphere Replication Flow is a more direct match.
- **SAP Graph** — semantic federation API layering a unified business data model (One Domain Model, ODM) over multiple SAP systems (S/4HANA, SuccessFactors, Ariba, Concur). Pick when a harmonized, cross-system *read* API is the deliverable. Orthogonal to the plugin: if SAP Graph exposes OData for a given context, it can be a `@federation.delegate` source like any other OData service; the plugin's consumption-view + rename + cross-service `$expand` features apply unchanged. Distinct from SAP MDI (next bullet), which focuses on master data distribution lifecycle rather than unified read access.
- **SAP Master Data Integration (MDI)** — BTP service for distributing master data (business partners, products, cost centers, employees) across SAP cloud apps, built on the same ODM as SAP Graph. Pick when master data lifecycle — CRUD propagation, soft-delete, cross-system harmonization — is the problem. Architecturally similar to SAP Graph from the plugin's perspective (OData APIs on BTP), so it is a candidate `@federation.delegate` / `@federation.replicate` source. Most natural pairing is MDI-emitted change events on Event Mesh driving the (Phase 6+) event-driven sync into a local cache.
- **Generic CDC / ETL (Debezium, Airflow, dbt)** — pick when data pipelines across heterogeneous systems are the deliverable and CAP is just one consumer among many.

Within the application layer, the plugin complements rather than replaces neighboring tools:

- [`cds-caching`](https://github.com/mikezaschka/cds-caching) is a peer dependency — use it directly for custom caching scenarios, or enable it per-entity via the plugin's `cache` option.
- [`@cap-js-community/common`](https://github.com/cap-js-community/common) offers entity-level caching as a standalone alternative if that specific pattern is all you need.
- **SAP Event Mesh** — not a competitor; the CloudEvents-based messaging backbone that SAP systems publish to and that CAP subscribes to via `cds.connect.to('messaging')`. When the Phase 6+ event-driven sync feature (see [`CLAUDE.md`](https://github.com/mikezaschka/cds-data-federation/blob/main/CLAUDE.md) Implementation Status) lands, Event Mesh — or any CAP-supported broker (Redis PubSub, Kafka, local in-process) — will be the transport. Complementary to both delegate and replicate strategies.

---

## References

| Resource | URL |
|---|---|
| CAP CaLeSi guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation guide | https://cap.cloud.sap/docs/guides/integration/data-federation |
| xtravels (CaLeSi reference sample) | https://github.com/capire/xtravels |
| xflights (provider sample) | https://github.com/capire/xflights |
| Risk Management ext-service branch | https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui |
| Kai Niklas — CAP Remote Services + Fiori Elements | https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/ |
| Gregor Wolf — cap-replication-demo | https://github.com/gregorwolf/cap-replication-demo |
| @cap-js-community/common (Replication Cache) | https://github.com/cap-js-community/common |
| cds-caching | https://github.com/mikezaschka/cds-caching |
| HANA Smart Data Access | https://help.sap.com/docs/SAP_HANA_PLATFORM/6b94445c94ae495c83a19646e7c3fd56/6ce5a8dc7c0f44e28f12ff09db93b45c.html |
| HANA synonyms in CAP (Using Databases / Native HANA Features) | https://cap.cloud.sap/docs/advanced/hana#native-hana-features |
| SAP Datasphere Replication Flow | https://help.sap.com/docs/SAP_DATASPHERE |
| SAP Cloud Integration (Integration Suite) | https://help.sap.com/docs/integration-suite |
| SAP Business Data Cloud | https://www.sap.com/products/data-cloud.html |
| SAP Event Mesh | https://help.sap.com/docs/SAP_EM |
| SAP Graph | https://help.sap.com/docs/SAP_GRAPH |
| SAP Master Data Integration | https://help.sap.com/docs/SAP_MASTER_DATA_INTEGRATION |

For a deep-dive into CAP's native integration primitives and the manual patterns the plugin automates, see [CAP Built-in Analysis](../internal/research/cap-builtin-analysis.md). For the Replication Cache analysis, see [Replication Cache Analysis](../internal/research/replication-cache-analysis.md).
