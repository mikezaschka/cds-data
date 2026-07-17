# How cds-data-pipeline + cds-data-federation Compare

This document positions the two packages (`cds-data-pipeline`, the engine; `cds-data-federation`, the annotation plugin) against other approaches for integrating remote services into a SAP CAP application. The space is active — SAP samples, community plugins, blog posts, database features, and enterprise platforms all tackle pieces of the same problem. The goal here is to make the trade-offs visible so you can pick the right tool for your scenario.

## Scope: application-level integration

The plugin's focus is **application-level integration** — the CAP service is the owner of the integration contract. Consumption views, field renames, cross-service `$expand` resolution, scheduled sync, and hooks all live inside the CAP app, as part of the application's own codebase and deployment.

This is a deliberate contrast to **DB-layer** approaches (HANA synonyms, Smart Data Access) where integration happens underneath CAP at the database level, and to **platform-layer** approaches (Datasphere, generic CDC/ETL) where integration happens outside the CAP app in a data-integration platform. Those options are included in the matrices below for orientation, but they solve different problems at different architectural layers. Pick DB-layer tools when you want joins to disappear into the database; pick platform tools when data-warehouse-scale volumes or enterprise governance are the driver; pick this plugin when the CAP app itself is where the integration logic belongs.

The two strategies the plugin offers — **delegation** (live proxy) and **replication** (scheduled sync into the local DB) — compete with different alternatives, so the comparison is split accordingly.

---

## CAP reference samples

Throughout this document, **CAP reference samples** refers to the integration pattern shown in SAP's own sample applications:

- [**xtravels**](https://github.com/capire/xtravels) — the Service Integration reference sample. Delegation via `this.on('READ', Entity, req => remote.run(req.query))`, replication via a generic `@federated` handler in [`srv/data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js).
- [**Risk Management — ext-service branch**](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui) — SAP's S/4HANA mashup sample. The [`risk-service.js`](https://github.com/SAP-samples/cloud-cap-risk-management/blob/ext-service-s4hc-suppliers-ui/srv/risk-service.js) file wires five handlers that together cover every pattern the plugin packages.
- [**Kai Niklas — CAP Remote Services + Fiori Elements**](https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/) — an end-to-end walkthrough of the same assembly for a Fiori Elements frontend.
- [**Gregor Wolf — cap-replication-demo**](https://github.com/gregorwolf/cap-replication-demo) — a replication-focused demo against the S/4HANA Business Partner API (`API_BUSINESS_PARTNER`). Illustrates the full recipe for scheduled sync at the application layer: action-triggered load (`loadEntitiesFromS4`), an offset pagination loop driven by `$count`, per-entity column projection and destination routing via a `map.js` config, `UPSERT(entity).into(table)` for idempotent writes, and event-driven upsert on `sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1` via `cds.connect.to('messaging')`. The scheduler, delta tracking, retry, and concurrency guard that `@federation.replicate` contributes are not part of the demo, which makes it a useful side-by-side reference for the moving parts the annotation covers.

CAP provides all the primitives (`cds.connect.to`, `srv.run`, projection chains, `@cds.persistence.table`, `UPSERT`, `cds.outboxed`). The reference samples assemble them per entity. `cds-data-federation` packages the same assembly behind two annotations so each federated entity is one declaration, not a handler file.

---

## Delegation alternatives

| Capability | cds-data-federation (delegate) | CAP reference samples | CAP + [cds-caching](https://github.com/mikezaschka/cds-caching) | [@cap-js-community/common](https://github.com/cap-js-community/common) (Replication Cache) | HANA-native (synonyms / SDA) |
|---|---|---|---|---|---|
| Architectural layer | application | application | application | application | database |
| Zero handler code (declarative) | yes, via annotation | handler per entity | handler plus cache wrap per entity | yes, via `@cds.replicate` | yes, via `.hdbsynonym` / virtual tables |
| Live forwarding of reads | yes | yes | yes (with cached reads) | no — served from SQLite snapshot within TTL | yes, as native HANA joins |
| Cross-service `$expand` | yes — four expand topologies + navigation | coded per scenario | coded per scenario | no — each entity cached independently | limited to same HANA DB |
| Field / association renames | automatic from projection | CAP projection chain | CAP projection chain | no — data cached verbatim | via CDS view on top of synonym |
| Write-back (CUD) | opt-in per entity | coded per entity | not cache-applicable | not supported (read-only) | depends on target schema grants; typically read-only |
| Caching model | response-level (`cds-caching`) or entity-level (`cache.strategy: 'entity'`, SQLite + pipeline) | none | response-level | entity-level (full dataset into per-tenant SQLite, TTL + LRU) | DB-level only |
| Non-HANA sources | yes | yes | yes | yes | SDA only (MSSQL, Oracle, Postgres, remote HANA) |

### Note on HANA-native integration

HANA synonyms (`.hdbsynonym`) and Smart Data Access are two tools in the same DB-layer kit: synonyms alias a table or view in another HANA schema (typically the same HANA instance, e.g., an S/4HANA CDS view in a paired schema), SDA provides virtual tables that federate remote HANA or non-HANA sources. In CAP projects they are often combined — an SDA virtual table in one schema, a synonym in the app's HDI container pointing at it — so the combined column reflects the typical deployment. They are a strong fit when the integration boundary should live in the database: native joins, pushdown to HANA's query engine, no CAP-level handler code. When the integration contract instead lives in the application service — consumption views, per-consumer renames, cross-service `$expand`, CUD write-back — an application-layer approach like `cds-data-federation` is the closer match.

### Note on the Replication Cache

[`@cap-js-community/common`](https://github.com/cap-js-community/common) loads a full entity dataset into a per-tenant SQLite file on first access and serves subsequent queries from that snapshot within a TTL. **`cds-data-federation`** offers a similar **`cache.strategy: 'entity'`** path on `@federation.delegate` — same performance profile (one remote full read, then local CQN), but consumption-view aware (field renames, column restriction) and composable with federation cross-service features where the MVP allows. **`cache.strategy: 'response'`** ([`cds-caching`](https://github.com/mikezaschka/cds-caching)) remains the choice for identical query repetition. See [Integration → Caching](../integration/caching.md).

---

## Replication alternatives

The application-layer column is split into two: **federation plugin** (`cds-data-federation`, annotation surface for `@federation.replicate`) and **pipeline engine** (`cds-data-pipeline`, the scheduled sync pipeline the plugin composes). Columns attribute capabilities to whichever package owns them; a user reaching for `@federation.replicate` installs both, while a user writing a programmatic pipeline against a non-federation source installs only the engine.

| Capability | cds-data-federation (`@federation.replicate`) | cds-data-pipeline (engine, standalone) | CAP reference samples (sync code) | SAP Business Data Cloud (Datasphere Replication Flow) | Generic CDC / ETL (Debezium, Airflow, dbt) |
|---|---|---|---|---|---|
| Architectural layer | application | application | application | platform | platform |
| Consumption contract | CDS projection on remote + annotation | programmatic `addPipeline({ kind, source, target, mapping, schedule })` | hand-assembled per entity | modeled in the platform | pipeline code |
| Zero setup code (declarative) | yes, via annotation + schedule | no — programmatic API | assembled per entity | yes, modeled in the platform | no, pipeline code |
| Scheduled full / delta sync | inherits engine via composition | yes, both modes | rolled per job | yes | yes |
| Idempotent writes (UPSERT) | inherits engine | built-in | coded per entity | yes | depends on pipeline |
| Retry + concurrency guard | inherits engine | built-in (`withRetry` + optimistic tracker update) | coded per job | platform-managed | platform-managed |
| Non-OData / REST sources | inherits engine | yes, adapter factory (OData, REST, pluggable `BaseAdapter`) | adapter code required | yes | yes (core strength) |
| Field / association renames | from consumption view (`localToRemote` / `remoteToLocal`) | via `PIPELINE.MAP` hook | projection + explicit mapping | via transformations | pipeline code |
| Caching model | response-level option (via [cds-caching](https://github.com/mikezaschka/cds-caching)) | not applicable (engine is the sync layer) | none | n/a (queries go to local tables) | n/a |
| Observability surface | same management API as engine | tracker + run entities + OData management service | none | platform-managed | platform-managed |
| Primary scale target | app-level integration | app-level integration | app-level integration | enterprise data landscape | data-warehouse / lake |

---

## Positioning

The plugin targets the **application layer** exclusively: a CAP service that needs remote data shaped into its own model, where the integration contract is part of the application's own codebase and lifecycle. Within that scope, the goal is to lift the per-entity handler work from the Service Integration samples into a single annotation on the consumption view.

Outside that scope, other tools remain the right choice:

- **HANA synonyms / SDA** — pick when the integration boundary logically belongs to the database, queries stay within HANA, and native joins and pushdown are the point.
- **SAP Business Data Cloud (BDC)** — the umbrella data platform announced Feb 2025 that now contains Datasphere, Databricks integration, Analytics Cloud, and Joule agents. Pick for a governed, enterprise-scale data fabric across SAP applications; Datasphere's Replication Flow (in the table above) is the specific feature that competes with `@federation.replicate`.
- **SAP Cloud Integration (Integration Suite)** — iPaaS. Pick when the integration itself is the deliverable — transformation logic, B2B/EDI, messaging-based A2A, routing, error handling in middleware. Also a valid *upstream producer*: CPI can expose a virtualized OData/REST endpoint that a CAP app then consumes via `@federation.delegate`, or push into a HANA Cloud table that the app reads locally. For pure scheduled replication without the transformation/messaging needs, Datasphere Replication Flow is a more direct match.
- **SAP Graph** — semantic federation API layering a unified business data model (One Domain Model, ODM) over multiple SAP systems (S/4HANA, SuccessFactors, Ariba, Concur). Pick when a harmonized, cross-system *read* API is the deliverable. Orthogonal to the plugin: if SAP Graph exposes OData for a given context, it can be a `@federation.delegate` source like any other OData service; the plugin's consumption-view + rename + cross-service `$expand` features apply unchanged. Distinct from SAP MDI (next bullet), which focuses on master data distribution lifecycle rather than unified read access.
- **SAP Master Data Integration (MDI)** — BTP service for distributing master data (business partners, products, cost centers, employees) across SAP cloud apps, built on the same ODM as SAP Graph. Pick when master data lifecycle — CRUD propagation, soft-delete, cross-system harmonization — is the problem. Architecturally similar to SAP Graph from the plugin's perspective (OData APIs on BTP), so it is a candidate `@federation.delegate` / `@federation.replicate` source. Most natural pairing is MDI-emitted change events on Event Mesh driving the (Phase 6+) event-driven sync into a local cache.
- **Generic CDC / ETL (Debezium, Airflow, dbt)** — pick when data pipelines across heterogeneous systems are the deliverable and CAP is just one consumer among many.

Within the application layer, the plugin complements rather than replaces neighboring tools:

- [`cds-caching`](https://github.com/mikezaschka/cds-caching) — optional peer for `cache.strategy: 'response'`.
- **`cache.strategy: 'entity'`** — built-in SQLite entity cache via `cds-data-pipeline`; see [Caching](../integration/caching.md).
- [`@cap-js-community/common`](https://github.com/cap-js-community/common) offers entity-level caching as a standalone alternative if that specific pattern is all you need.
- **SAP Event Mesh** — not a competitor; the CloudEvents-based messaging backbone that SAP systems publish to and that CAP subscribes to via `cds.connect.to('messaging')`. When event-driven sync is added to the replicate strategy, Event Mesh — or any CAP-supported broker (Redis PubSub, Kafka, local in-process) — will be the transport. Complementary to both delegate and replicate strategies.

---

## References

| Resource | URL |
|---|---|
| SAP Community — Federating, Replicating, and Caching Remote Data in CAP (Part 1) | https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-1/ba-p/14402349 |
| SAP Community — Federating, Replicating, and Caching Remote Data in CAP (Part 2: Hands-On) | https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-2/ba-p/14442604 |
| CAP Service Integration guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation guide | https://cap.cloud.sap/docs/guides/integration/data-federation |
| xtravels (Service Integration reference sample) | https://github.com/capire/xtravels |
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

