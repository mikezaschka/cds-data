# Research: `@cap-js/cds-federation-synonyms` and CAP-level Data Federation vs `cds-data-*`

**Status:** Exploring  
**Created:** 2026-07-16  
**Related:** [terminology](../../concepts/terminology.md), [comparison](../../../docs/federation/reference/comparison.md), [choosing-a-strategy](../../../docs/federation/reference/choosing-a-strategy.md), ADR 0005, blog §"Where this sits in the landscape"  
**External:** `[cap-js/cds-federation-synonyms](https://github.com/cap-js/cds-federation-synonyms)` (experimental, v0.0.1), `[SAP-samples/recap2026-cap-level-data-federation](https://github.com/SAP-samples/recap2026-cap-level-data-federation)`

---



## Executive verdict

Synonym-based federation is a **real third access strategy** for the same consumption-view contract — but it lives at the **database / HDI layer**, not the application-service layer where `cds-data-federation` operates. It is a strong fit as a **documented peer strategy** (and possibly a thin `@federation.alias` marker that composes SAP’s plugin), and a **poor fit** as something we reimplement inside `cds-data-federation`.


| Question                                                        | Short answer                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does it belong under the `@federation.*` umbrella conceptually? | **Yes** — same intent (“remote entity available locally”), different how.                                                                                                     |
| Should we ship HDI synonym generation ourselves?                | **No** — duplicate SAP’s experimental plugin; compose or document instead.                                                                                                    |
| Is a synonym annotation a good idea?                            | **Yes as a thin bridge / validation marker** named **`@federation.alias`** (not `synonym` — that leaks the HANA artifact); not as a full engine. See §11.                      |
| Can we mock it off HANA?                                        | **Partially** — CAP’s imported-service mock + `#mock` tables already cover local/dev; true cross-schema synonyms are HANA-only (Postgres FDW is the closest portable analog). |
| What does the reCAP workshop expose that we lack?               | API packages (`cds export`), synonym strategy, BDC Data Product + virtual-table path.                                                                                         |
| Should one console span all three strategies?                   | **Yes** — as a *union* landscape view with strategy-aware drill-down; each strategy contributes a different data source (see §12).                                            |
| Should all strategies live in one package?                      | **Surface yes, runtime no** — unify annotation namespace + console + docs (umbrella meta-package); keep the engines split and portable (see §13).                             |


Our public docs already place HANA synonyms / SDA in the **DB layer** of the landscape matrix. This research deepens that row with how SAP’s new plugin actually works, how HANA cross-container synonyms work, and how the reCAP 2026 exercises map onto our three packages.

### SAP cooperation framing

There is a natural, non-competitive division of labor: **SAP ships the golden-path primitives** — the `@data.product: 'via-synonym'` HDI build plugin, the reference `@federated` + `data-federation.js`, and the CAP Data Federation guide that sketches the general principles. **Our differentiated value is the sophisticated layer on top** — deltas / retry / tracker / management API / cross-service `$expand` / caching, plus a *single declarative UX and observability console across all strategies*. We do not want to own HANA synonym codegen; we want to **orchestrate and observe** it alongside delegate/replicate. Reading SAP's synonym `Status` view into our console is the archetypal "compose, don't fork" move — it lets us present a superset experience without duplicating SAP's primitive.

---



## 1. What `@cap-js/cds-federation-synonyms` actually is

Experimental CAP plugin (`@cap-js/cds-federation-synonyms@0.0.1`) for **CAP-to-CAP (and CAP-to-Data-Product) federation via HANA synonyms**. It does **not** register READ handlers and does **not** copy rows. At query time CAP sees ordinary local persistence; HANA resolves the synonym to another schema’s table/view (or a local mock).

### Hard requirements

From the [plugin README](https://github.com/cap-js/cds-federation-synonyms):

- `@sap/cds-dk` ≥ 9.9; peer `@sap/cds` ≥ 9.6.1
- Provider **and** consumer are CAP apps on **SAP HANA**
- Same HANA instance; if Native Multitenancy is on, **same tenant**
- Proprietary peers: `@sap/hdi`, `@sap/xssec` (license acceptance required)
- Install on provider, consumer, and (if MTX) the consumer’s MTX sidecar



### Annotation / packaging contract


| Role                  | Marker                                                       | Effect                                                                                                       |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Provider data service | `@data.product: 'via-synonym'` (and **not** `@cds.external`) | Build emits `.hdbrole` / `.hdbrole#` granting `SELECT` (+ grant option on `#`) on the service’s tables/views |
| Imported API service  | `@data.product: 'via-synonym'` **and** `@cds.external`       | Build emits mock tables, `.hdbsynonym`, `.hdbsynonymconfig`, `.hdbgrants`                                    |
| Consumption view      | CAP sample `@federated` (workshop)                           | Marks “close access” intent; with synonyms the entity is already DB-local via synonym                        |


Optional on imported BDC-style services: `@cds.persistence.namingMode: 'quoted'` (case-sensitive target names + mapping views).

This is **orthogonal** to our `@federation.delegate` / `@federation.replicate`. There is no technical name collision with `@data.product`.

### Plugin architecture (two jobs)

```
cds-plugin.js
├── lib/build-plugin.js   # patches cds.compile.to.hana (+ hdbtabledata)
│                         # provider → .hdbrole / .hdbrole#
│                         # consumer → #mock tables, .hdbsynonym,
│                         #            .hdbsynonymconfig, .hdbgrants,
│                         #            Status view over SYS.SYNONYMS
└── lib/server.js         # MTX: before DeploymentService.deploy
                          # reads Registry, injects SERVICE_REPLACEMENTS
                          # + VCAP for target HDI containers
                          # (or strips config → stays on #mock)

Runtime config services (app + MTX profiles):
├── /synonymapi  (REST)  connect | unconnect | check | getConfig
└── /readconf    Registry, Synonyms, Status
```

Internal schema (`cds.dataproducts.synonyms`):

- `Registry { srv, target }` — maps imported CDS service name → target HDI service manager name
- `Synonyms` / `Status` — `@cds.persistence.exists` overlays on `SYS.SYNONYMS` + derived status view (`mock` | `connected` | `?`)

**Important:** there is almost no application-runtime query path. After deploy, `SELECT` on the consumption view is plain CAP → HANA SQL. Freshness is **live** (provider’s data). Consistency is **strong** relative to the provider schema (same instance). Writes are **read-only** at the HANA privilege layer.

### Connected vs unconnected


| Mode            | Mechanism                                                                                                          | Data seen                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **Unconnected** | `.hdbsynonym` → local `…#MOCK` table; omit/ignore `.hdbsynonymconfig` + `.hdbgrants`                               | CSV / mock seed from API package |
| **Connected**   | `.hdbsynonymconfig` overrides target via `schema.configure: "<service>/schema"`; `.hdbgrants` pulls provider roles | Live provider views/tables       |


Single-tenant: deploy decision (`.hdiignore` / exclude-filter + `SERVICE_REPLACEMENTS` + `TARGET_CONTAINER`). Multi-tenant: Registry + `connect`/`unconnect` (+ optional `triggerUpgrade`) so tenants can switch at runtime without a full model change.

---



## 2. How HANA synonyms enable cross-HDI access

This is the infrastructure the plugin automates. Background: [HDI synonyms](https://help.sap.com/doc/e7a49993ba20497f9fa1802b28f81c40/2.0.08/en-US/SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en.pdf), [cross-container access tutorials](https://github.com/sap-tutorials/Tutorials/blob/master/tutorials/xsa-cross-container-access/xsa-cross-container-access.md), [hdbsynonymconfig in HANA Cloud](https://community.sap.com/t5/technology-blog-posts-by-sap/hdbsynonymconfig-and-cross-container-access-in-hana-cloud/ba-p/13499911).

### Object graph (CAP-to-CAP)

```
Provider HDI container                    Consumer HDI container
─────────────────────                     ──────────────────────
bookshop.Books (table)                    Flights#MOCK (local seed table)
   ↑                                      Flights (SYNONYM)
datasrv.Books (view / exposed object)        │  unconnected → #MOCK
   ↑                                         │  connected   → provider schema.object
role datasrv#  (SELECT WITH GRANT OPTION)    │
role datasrv   (SELECT)                      ← .hdbgrants from provider roles
                                             ← .hdbsynonymconfig:
                                               schema.configure =
                                                 "sap.capire.flights.data_syn/schema"
```



### Deploy-time resolution

1. **Logical service name** = imported CDS service (`sap.capire.flights.data_syn`).
2. **SERVICE_REPLACEMENTS** maps that key to a bound CF/HANA service (`xflights-db` or a UPS grantor).
3. HDI templating resolves `schema.configure: "<key>/schema"` to the **physical schema** of that binding.
4. Grantor credentials from the bound service execute `.hdbgrants` so the consumer’s **object owner** and **application user** can `SELECT` through the synonym.
5. If the consumer is bound to **two** HDI containers, `TARGET_CONTAINER` must name the consumer’s own container.

HANA’s two-role pattern (`role` + `role#` with grant option) exists so the consumer’s object owner can create synonyms that reference objects it does not own — see SAP’s “Granting Roles and Privileges for Use with Synonyms”.

### BDC / Data Product variant (workshop Ex4)

Not pure CAP-to-CAP:

1. BDC share exposed via **Delta Sharing** remote source on HANA.
2. **Virtual tables** in a dedicated schema (e.g. `DP_VT_CUSTOMER`).
3. UPS **grantor** service for that schema.
4. Synonym plugin still generates consumer synonyms; `SERVICE_REPLACEMENTS` points at the grantor, not another CAP HDI container.
5. Quoted naming mode + optional `.hdbview` column remapping when Data Product names are case-sensitive.

That is synonym + **SDA/virtual table** (or Delta Sharing VT) in one deploy path — the pattern our comparison.md already alludes to when combining synonyms and SDA.

### What synonyms buy vs application-layer strategies


| Property                        | Synonym (DB)                    | `@federation.delegate` | `@federation.replicate`          |
| ------------------------------- | ------------------------------- | ---------------------- | -------------------------------- |
| Layer                           | HDI / SQL                       | CAP service handlers   | Pipeline engine + local table    |
| Freshness                       | Live                            | Live                   | As of last run                   |
| SQL joins / `$apply` / GROUP BY | Native HANA                     | No (OData limits)      | Yes (local SQL)                  |
| Cross-service `$expand`         | Native if both sides in same DB | Plugin topologies      | Local side only (like any table) |
| Works off HANA                  | No                              | Yes                    | Yes (SQLite / HANA / …)          |
| Same HANA instance required     | Yes                             | No                     | No                               |
| Network hop per request         | No (DB-local)                   | Yes (remote HTTP)      | No (after sync)                  |
| CUD to remote                   | No (SELECT-only grants)         | Opt-in                 | Local only (overwritten by sync) |
| Observability                   | SYS.SYNONYMS / Status           | logs / cache           | Pipelines / PipelineRuns         |
| Data duplication                | None                            | None                   | Full copy                        |


Synonym is closest to **delegate for freshness** and **replicate for SQL power**, without copying data — but only when co-location on HANA is acceptable.

---



## 3. Fit into `cds-data-federation`



### Shared principle (strong alignment)

Both stacks obey the same modeling contract our primer calls out:

> The consumption view IS the federation contract. Schema = projection; runtime behavior = strategy annotation.

Workshop Ex2/Ex3/Ex4 all define `entity X as projection on imported.Y { … }` and treat that as the single point of access. That is exactly our core principle — strategy differs:


| Workshop / SAP                                                              | Our equivalent                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@federated` + `data-federation.js` polling                                 | `@federation.replicate` (+ pipeline tracker, retry, deltas, management API) |
| Live `remote.run(req.query)` (not in workshop, but in CAP guide / xtravels) | `@federation.delegate`                                                      |
| `@data.product: 'via-synonym'` + HDI                                        | *(gap)* DB-layer peer — not implemented                                     |




### Layer mismatch (strong constraint)

ADR 0005 and the published comparison deliberately scope `cds-data-*` to the **application layer**. Synonyms are **infrastructure**: build plugins, HDI artifacts, CF bindings, MTX deploy hooks. Folding that into `cds-data-federation` would:

- Pull `@sap/hdi` / HDI deploy semantics into an app-layer package
- Break our SQLite-first test story (real providers, no HANA CI today)
- Duplicate an SAP-owned experimental plugin that will likely move with CAP’s Data Federation guide

So: **conceptual strategy yes; package ownership no.**

### How `@federation.alias` could look (if we add it)

> Strategy named **`@federation.alias`** — full option design, the SDA explainer, and the Ex4 walkthrough are in [§11](#11-annotation-design-federationalias-synonym-based--db-layer). Summary here.

Not a third handler implementation — a **declarative intent** that:

1. Documents the strategy in the same namespace as delegate/replicate.
2. Validates environment (HANA, imported service has `@data.product: 'via-synonym'`, peer plugin present).
3. Optionally suppresses `@cds.persistence.table` / replicate pipeline registration for that entity (synonym already provides the table-shaped name).
4. Surfaces status in docs / choosing-a-strategy decision tree.

Sketch:

```cds
@federation.alias   // or @federation.alias: { require: 'connected', fallback: 'replicate' }
entity Flights as projection on external.Flights { /* … */ }
```

**Anti-patterns to avoid:**

- Reimplementing `build-plugin.js` inside our monorepo
- Treating alias as a `cds-data-pipeline` `kind` (no READ→MAP→WRITE)
- Using `@federation.alias` on non-HANA profiles without a documented `fallback`
- Conflicting with CAP’s future promotion of `@federated` / `@data.product`



### Decision-tree insertion (docs only, or annotation later)

```
Need close access + SQL joins?
├─ Same HANA instance as provider / VT schema?
│   ├─ YES, live, no copy ……………► ALIAS (SAP plugin / @federation.alias)
│   └─ NO / portable DB …………► REPLICATE
├─ Live but remote over HTTP …………► DELEGATE (± cache)
└─ Local aggregates on already-local data ► MATERIALIZE
```

---



## 4. Mocking synonym semantics without HANA



### What already works today


| Environment                         | Behavior                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQLite /** `cds watch`            | Imported `@cds.external` services are mocked; API-package CSV loads into local tables. Workshop Ex2.5 / Ex3.4 / Ex4.6 rely on this — **no synonym plugin required**. |
| **HANA unconnected**                | Plugin’s `#MOCK` tables + synonyms pointing locally; CSV redirected via patched `hdbtabledata`.                                                                      |
| `cds.env.data_integration = 'mock'` | Plugin skips emitting `.hdbsynonymconfig` / `.hdbgrants` (stays mock).                                                                                               |
| `cds.env.data_integration = false`  | Disables build plugin entirely.                                                                                                                                      |


So “mock synonyms on other DBs” for **dev/test** is already: **use CAP’s default remote-service mock** (same as testing `@federation.replicate` without a remote). The consumption view still works; only the *connected* aliasing is missing.

### Portable “connected” analogs (research directions, not commitments)


| Database          | Mechanism                                                                         | Fidelity to HANA synonyms                                |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **PostgreSQL**    | `CREATE VIEW` / `CREATE FOREIGN TABLE` + postgres_fdw / dblink across schemas/DBs | High for same-cluster schemas; FDW for remote            |
| **SQLite**        | Attached DB (`ATTACH`) + views, or plain local tables                             | Low — no real cross-container security model             |
| **HANA SDA**      | Virtual tables to remote HANA / MSSQL / Oracle / Postgres                         | Already the “heterogeneous” sibling of synonyms          |
| **Our replicate** | Scheduled UPSERT into local table                                                 | Behavioral substitute for “close access + SQL”, not live |


A future “mock connected” mode in *our* tests would not need real synonyms: treat `@federation.alias` entities like plain local tables seeded from fixtures (identical to unconnected). Integration tests against real HANA would be a separate, optional suite (same bar as any HDI feature).

### Practical recommendation

- **Local / CI:** continue SQLite; document that synonym strategy is HANA-profile-only.
- **Hybrid HANA:** use SAP plugin’s unconnected → connected deploy flip (workshop Ex3.6–3.7).
- **Need SQL + portability:** `@federation.replicate` remains the answer.
- **Need live + co-located HANA:** synonym (compose SAP plugin).

---



## 5. What is required for synonym federation to work (checklist)



### Modeling

- [ ] Provider exposes a dedicated data service (use-case oriented, often denormalized) with `@data.product: 'via-synonym'`
- [ ] `cds export … --plugin` (or equivalent) produces an API package; consumer `npm add`s it
- [ ] Consumer consumption views on imported entities; app code never binds to imported entities directly
- [ ] For BDC: `cds import --data-product …` + annotate imported service with `@data.product: 'via-synonym'` (and often `namingMode: 'quoted'`)



### Build / deploy (provider)

- [ ] Install synonym plugin; `cds add hana`
- [ ] Undeploy allowlist for generated `.hdbrole` artifacts
- [ ] `cds deploy --to hana` so roles exist for grantors



### Build / deploy (consumer, connected)

- [ ] Install synonym plugin; `cds add hana`
- [ ] Undeploy allowlist for `.hdbsynonym` / `.hdbsynonymconfig`
- [ ] Bind to provider HDI (or grantor UPS); set `SERVICE_REPLACEMENTS` + `TARGET_CONTAINER`
- [ ] Deploy **with** config+grants for connected, **without** for unconnected
- [ ] MTX: Registry + connect API + upgrade; plugin in sidecar



### Runtime assumptions

- [ ] Same HANA instance (same NMT tenant)
- [ ] Provider subscribed/deployed before consumer connect (MTX credential fetch can fail soft → stays mock)
- [ ] Read-only privilege model accepted
- [ ] No expectation of CAP-level CUD forwarding or pipeline tracker for these entities

---



## 6. Extension opportunities (ours + SAP’s)

Ordered roughly by value-to-effort for *this* monorepo.

### A. Documentation / positioning (low effort, high clarity)

- Extend [choosing-a-strategy](../../../docs/federation/reference/choosing-a-strategy.md) with a fifth shape: **Synonym (HANA)**.
- Update [comparison](../../../docs/federation/reference/comparison.md) row for HANA-native to cite `@cap-js/cds-federation-synonyms` and the reCAP workshop.
- Clarify in terminology that CAP’s Data Federation guide now spans **replication and synonym** paths; our `@federation.replicate` supersedes the sample `data-federation.js`, while synonyms remain DB-layer.



### B. Thin `@federation.alias` bridge (medium)

- Scanner recognizes annotation; asserts peer plugin + HANA profile; does **not** register replicate pipelines or delegate handlers.
- Optional: map CAP `@federated` + imported `@data.product: 'via-synonym'` → treat as synonym strategy automatically (workshop interop).
- Surface in management UI as “external / synonym-backed” (no PipelineRuns).



### C. Compose, don’t fork (medium)

- Example under `examples/` that mirrors workshop Ex2 with `@federation.replicate` and documents Ex3 as “switch to SAP synonym plugin”.
- Optional peerDependency / optionalDependency detection with a loud startup message if `@federation.alias` is set but plugin missing (same pattern as pipeline peer for replicate).



### D. Extend SAP plugin capabilities (upstream / collaboration)

Ideas that belong in `cap-js/cds-federation-synonyms` or CAP core more than here:


| Extension                                     | Why                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Write path / controlled CUD                   | Today SELECT-only; some master-data scenarios want controlled updates |
| Partial entity connect                        | Connect subset of entities per service                                |
| Schema drift detection                        | Compare provider CSN hash vs consumer import                          |
| Auto SERVICE_REPLACEMENTS from `cds.requires` | Reduce `.env` / mta boilerplate                                       |
| First-class BDC ORD import                    | Workshop still hand-annotates `@data.product: 'via-synonym'`          |
| Postgres FDW codegen                          | Parallel “via-fdw” product mode for non-HANA CAP                      |




### E. Hybrid topologies with our plugins (high leverage)

Patterns the three packages already enable conceptually:

1. **Synonym master data + replicate transactional** — Flights via synonym (live, huge, joinable); Orders via `@federation.replicate`.
2. **Synonym stage +** `@materialize.snapshot` — live synonym feed as local SQL source for aggregates (no pipeline READ from remote).
3. **Delegate value helps + synonym lists** — CAP guide’s classic split; annotate explicitly.
4. **BDC VT synonym + local analytics** — Ex4 + materialization over joined local facts.

Cross-service expand: a synonym-backed entity behaves like **any local table** (same as replicate after sync). It can be the local side of local→remote expand; it does not need our expand stitch for local↔local.

### F. What not to extend into our engine

- HDI file generation
- MTX deploy hooks for SERVICE_REPLACEMENTS
- Grantor / PSE / remote-source setup for BDC
- Replacing `@data.product` with `@federation.*` on the **provider** service (provider annotation is CAP/Data-Product owned)

---



## 7. reCAP 2026 workshop → our plugin scope

Source: [SAP-samples/recap2026-cap-level-data-federation](https://github.com/SAP-samples/recap2026-cap-level-data-federation).


| Exercise                            | What it teaches                                                                                        | Covered by `cds-data-*`?                                                                                    | Gap                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Ex0** Prep                        | Workspace                                                                                              | n/a                                                                                                         | —                                                                                                          |
| **Ex1** API package for xflights    | `cds export` data service → npm API package (`--texts --data --plugin`), Calesi packaging              | **Partially** — we *consume* remote models; we don’t document/export API packages as a first-class workflow | Tooling/docs for provider-side `cds export`; HCQL-annotated provider services                              |
| **Ex2** Service-level replication   | Consumption views + `@federated` + sample `data-federation.js` (`modifiedAt` poll, `schedule().every`) | **Yes — superseded by** `@federation.replicate`                                                             | Workshop still uses CAP sample; our plugin adds deltas, retry, tracker, management API, REST, view mapping |
| **Ex3** Synonym-based federation    | Switch API to `@data.product: 'via-synonym'`, HANA deploy, mock↔connected                              | **No** (by design: DB layer)                                                                                | Document as peer; optional `@federation.alias` bridge                                                      |
| **Ex4** BDC Data Product “Customer” | `cds import --data-product`, consumption view, synonym → virtual tables via grantor                    | **No** for synonym/VT path; **partial** if Data Product also exposed as OData/HCQL                          | BDC ORD import story; VT/grantor ops; quoted naming                                                        |




### Workshop `data-federation.js` vs our replicate

The workshop handler is the classic xtravels MVP (~30 lines): mark `@cds.persistence.table`, schedule `replicate`, `max(modifiedAt)` watermark, `UPSERT`. That is precisely the gap analysis already in [requirements §CAP alignment](../../reference/requirements.md) and [cap-builtin-analysis](./cap-builtin-analysis.md). Dropping `@federation.replicate` into Ex2 would replace that file entirely — a strong demo opportunity.

### HCQL note

Ex1 annotates the provider with `@hcql @rest @odata @graphql`. Ex2 replication traffic in the workshop logs is **HCQL** POST bodies with projection columns and `modifiedAt` filters. Our HCQL adoption plan (`spec/internal/plans/hcql-adoption.md`) is directly on the critical path for looking “native” next to this workshop.

---



## 8. What might be missing in our stack (gap list)

Prioritized for product/docs, not as committed requirements.

### P1 — Positioning / docs

1. Fifth strategy in choosing-a-strategy + comparison matrices: **Synonym (HANA / Data Product)**.
2. Explicit workshop mapping: “Ex2 → our replicate; Ex3/Ex4 → SAP synonym plugin.”
3. API package / `cds export` / `cds import --data-product` getting-started page (provider & BDC), even if we don’t own the tooling.



### P2 — Interop

1. Optional `@federation.alias` marker + peer detection for `@cap-js/cds-federation-synonyms`.
2. Accept CAP `@federated` as alias for `@federation.replicate` when the source service is *not* `via-synonym` (migration path already floated in terminology.md).
3. Example app path that runs Ex2-equivalent with our plugin (sales-intel or a slim xtravels fork).



### P3 — Capability gaps relative to the full CAP Data Federation story

1. **No provider-side packaging story** in our docs (export, versioning, i18n bundles, seed data in API packages).
2. **No BDC / ORD / Delta Sharing** guidance (when to synonym+VT vs delegate OData vs replicate).
3. **No HANA co-location assumption** in our engine — good for portability, weak for “zero-copy live join” demos on BTP.
4. **HCQL** as first-class replicate/delegate transport (workshop-default for CAP-to-CAP).
5. **Runtime connect/unconnect** UX — we have Pipeline management; synonym has Registry/Status; no unified “federation console” across strategies.



### Explicit non-gaps (we should not chase)

- Replacing HDI synonym generation
- Owning grantor / PSE / remote-source SQL for BDC
- Making synonyms work on SQLite beyond mock tables
- CUD through synonyms (unless SAP adds it upstream)

---



## 9. Options (for a future ADR — do not pick here)

Per brainstorm workflow: options only; winner deferred to `/discuss-architecture`.

### Option A — Docs-only peer

Treat SAP’s plugin as the DB-layer row we already describe. Update decision tree + comparison + blog landscape. No code.

- Pros: honest layering, zero maintenance, aligns ADR 0005  
- Cons: no single `@federation.*` story for workshop learners



### Option B — Thin `@federation.alias` bridge

Annotation + validation + docs; peerDependency optional; no HDI codegen.

- Pros: unified developer vocabulary; fail-loud if misconfigured  
- Cons: yet another annotation; coupling to experimental SAP API (`@data.product`)



### Option C — Deep integration / reimplementation

Own build plugin, MTX hooks, management UI for synonym status.

- Pros: one package to rule strategies  
- Cons: fights SAP ownership, HANA-only CI tax, license/@sap/hdi surface, out of app-layer scope



### Option D — Separate package `cds-data-federation-hana`

Optional HANA companion that wraps/extends SAP plugin and exposes `@federation.alias`.

- Pros: keeps core portable; clear install line for BTP/HANA customers  
- Cons: another package in the monorepo; still tracks upstream

---



## 10. Open questions

1. Will CAP promote `@data.product: 'via-synonym'` / synonym plugin from experimental to supported guide default? (Affects whether we bridge or just link.)
2. Will `@federated` gain a strategy discriminator, or stay replication-only while synonyms stay on `@data.product`?
3. Do we want HANA integration tests in CI (expensive) or document-only synonym coverage?
4. For BDC Data Products that also expose OData: prefer synonym+VT, `@federation.delegate`, or replicate — and do we publish a decision matrix?
5. Should the pipeline console grow a “Federated entities” view that includes synonym-backed entities (status from `cds.dataproducts.synonyms.Status`) without owning deploy?

---



## 11. Annotation design: `@federation.alias` (synonym-based / DB-layer)

### Strategy name

We adopt **`@federation.alias`** as the annotation name for the synonym / DB-layer strategy. Rationale:

- `delegate` and `replicate` are **behavior verbs** (developer intent). `synonym` leaks the HANA artifact name and does not generalize to the SDA / virtual-table variants that do the same thing.
- An *alias* is literally what a synonym is — a name that points at an object living elsewhere — and it reads cleanly in the triad:

  > **delegate** (live over HTTP) · **alias** (live over the database) · **replicate** (copied locally)

- We keep **"synonym"** as the documented *technique / discoverability keyword* (it matches SAP's plugin and CAP's guide); `@federation.alias` is the *annotation*. Docs say "synonym-based (`@federation.alias`)".

### Current surface, for contrast

`@federation.delegate` (live proxy): `source`, `writable`, `create` / `update` / `delete`, `cache` (`response` | `entity` with `ttl` / `tags` / `service` / entity-only `preload`/`static`/`group`/`wait`/`validate`/`search`); always-on server-driven paging.

`@federation.replicate` (scheduled local copy, composes `cds-data-pipeline`): `name`, `description`, `mode` (`full`|`delta`), `schedule`, `preload` (`bool`|`{mode,wait}`), `delta` (`{field, mode: timestamp|key|datetime-fields}`), `batchSize`, `rest` (`{path, pagination, deltaParam, dataPath}`), `source`, `cache`.

### Proposed `@federation.alias` options

The alias strategy is a **build/deploy-time + HANA** behavior. Our annotation does **not** generate HDI artifacts — it validates the environment, wires the logical→physical mapping, suppresses a redundant `@cds.persistence.table` / replicate pipeline for the entity, and composes SAP's `@cap-js/cds-federation-synonyms` plugin.

```cds
@federation.alias: {
    // ── Wiring (maps to SERVICE_REPLACEMENTS / schema.configure) ──
    source: 'sap.capire.flights.data_syn',  // imported data service (logical name); inferred where possible
    target: 'xflights-db',                   // physical HDI/grantor service the logical name resolves to

    // ── Connection state ──
    connect: 'connected',                    // 'connected' | 'unconnected' (mock) | 'auto'
    require: 'connected',                    // fail boot if unreachable (vs. silent mock fallback)

    // ── Target shape ──
    naming: 'quoted',                        // 'plain' | 'quoted' (@cds.persistence.namingMode) — quoted needed for BDC/Data Products
    kind: 'view',                            // 'table' | 'view' | 'virtual' — provider object type; 'virtual' = SDA / Delta-Sharing (BDC)

    // ── Access ──
    writable: false,                         // reserved; SELECT-only at the HANA grant layer today

    // ── Dev / test (our value-add — SAP has no off-HANA story) ──
    mock: { data: 'db/data/…csv' },          // seed for the #MOCK table when unconnected
    fallback: 'replicate'                    // OFF-HANA behavior: 'replicate' | 'delegate' | 'mock' | 'error'
}
entity Flights as projection on external.Flights { /* … */ };
```

| Option | Backed by SAP plugin today | Notes |
|---|---|---|
| `source`, `target`, `connect`, `naming` | ✅ | via `@data.product:'via-synonym'`, `SERVICE_REPLACEMENTS`, `namingMode:'quoted'`, `.hdbsynonymconfig` presence — our marker *drives* these; SAP owns codegen |
| `require`, `mock`, `fallback` | ⚠️ partial | `mock` = the `#MOCK` table + CSV; `fallback` is **ours** — the portability escape hatch SAP lacks |
| `kind:'virtual'` | ⚠️ | documents BDC/SDA targets (see below); plugin already handles quoted VT targets |
| `writable` | ❌ | SELECT-only grants; reserved for possible upstream support |

The single most valuable option we add over SAP's golden path is **`fallback`**: the same consumption view keeps working off HANA (CI, SQLite, `cds watch`) by degrading to replicate / delegate / mock, instead of only existing as a deployed-HANA artifact.

### What SDA is (Smart Data Access)

You are not expected to know this — here is the model in plain terms.

**SAP HANA Smart Data Access (SDA)** is HANA's built-in **data virtualization**. It lets a HANA database query data that physically lives in *another* system as if it were a local table, **without copying it**. Two objects make it work:

1. **Remote source** — a named connection to an external system, created with SQL:
   ```sql
   CREATE REMOTE SOURCE RS_BDC
     ADAPTER "deltasharing" CONFIGURATION 'provider=hdlf;endpoint=<url>;'
     WITH CREDENTIAL TYPE 'X509' PSE PSE_BDC;
   ```
   Adapters exist for other HANA systems, MSSQL, Oracle, PostgreSQL, Spark, and — as here — **Delta Sharing** (the protocol SAP Business Data Cloud uses to expose Data Products).

2. **Virtual table** — a local table object that is really a pointer to a remote object through that remote source:
   ```sql
   CREATE VIRTUAL TABLE Customer AT RS_BDC."sap.s4com.customer:v1"."customer"."customer";
   ```
   Selecting from `Customer` makes HANA fetch (and, where possible, **push down** filters/joins to) the remote system at query time. No local copy; data is always live.

**How SDA relates to synonyms.** They operate at different granularities and compose:

| Object | What it does | Boundary it crosses |
|---|---|---|
| **Synonym** (`.hdbsynonym`) | A name alias to a table/view **already reachable** by the database | Between HDI containers / schemas **in the same HANA instance** |
| **Virtual table** (SDA) | A federation bridge that makes an **external / remote** object queryable | Out to another system entirely (BDC, another DB, …) |

So a synonym cannot, by itself, reach outside the HANA instance. When the "provider" is *not* another CAP HDI container but an external system (a BDC Data Product, an on-prem DB, …), you put an **SDA virtual table** in a HANA schema first, then point the consumer's **synonym** at that virtual table. The chain is:

```
consumer synonym  →  virtual table (SDA)  →  remote source  →  external data (e.g. BDC Delta Share)
```

From CAP's perspective nothing changes — the entity is still plain local SQL through the synonym; the federation happens invisibly inside HANA. In our annotation, `kind: 'virtual'` documents that the alias target is an SDA virtual table rather than a plain provider table/view.

### How workshop Ex4 plays into this

Workshop Ex4 ("Consume Data Product 'Customer' from S/4") is the **synonym + SDA** path — same modeling as CAP-to-CAP, different physical target. Step by step:

1. **Discover + import the API.** The Customer Data Product is found on SAP Business Accelerator Hub; its metadata is a **CSN Interop JSON** (an ORD-described API). `cds import --data-product sap-s4com-Customer-v1.json` turns it into an API package — structurally identical to a `cds export`ed CAP service, with the Data Product represented as an external service `sap.s4com.Customer.v1`.
2. **Consumption view + annotations.** A normal `@federated`/consumption projection on `Cust.Customer`, plus two annotations that let the synonym plugin handle this imported service:
   ```cds
   annotate Cust with @data.product: 'via-synonym'
                      @cds.persistence.namingMode: 'quoted';  // case-sensitive Data Product names
   ```
   In our world this is exactly `@federation.alias: { naming: 'quoted', kind: 'virtual', source: 'sap.s4com.Customer.v1' }`.
3. **The external plumbing (pre-built for the workshop, HANA-admin work).** A **PSE** holds the client certificate; a **remote source** (`deltasharing` adapter) points at the BDC HDLFS share; **virtual tables** in a schema like `DP_VT_CUSTOMER` map to the share's tables; a user-provided service `grantor-dp-admin` holds credentials + the schema name for that VT schema.
4. **Deploy.** The synonym plugin generates the consumer's synonym, `.hdbsynonymconfig`, and `.hdbgrants` for the `Customer` entity, just like Ex3. The only difference: `SERVICE_REPLACEMENTS` maps the logical service `sap.s4com.Customer.v1` to the **grantor** (`grantor-dp-admin`) instead of another app's HDI container. The synonym then resolves to the virtual tables, which federate live to BDC.
5. **Local dev is unchanged.** With no HANA, CAP mocks the imported service and loads `Customer` from CSV — the app runs on SQLite exactly as in Ex2/Ex3. This is precisely where our proposed `fallback` would make the *deployed* alias entity also runnable off-HANA in CI without hand-swapping annotations.

**Why Ex4 matters for us:** it proves the alias strategy is **not limited to CAP-to-CAP** — the same consumption-view contract reaches SAP Business Data Cloud Data Products through SDA virtual tables. That extends `@federation.alias`'s reach to the BDC/ORD ecosystem (with `kind: 'virtual'`), and it is the clearest case where our `fallback` + a unified console (showing the synonym `Status` next to delegate/replicate) would beat hand-wired HDI artifacts. What we would still **not** own: the PSE / remote-source / virtual-table SQL and the grantor service — that is HANA-admin / BDC infrastructure, upstream of our annotation.

---

## 12. A console spanning all three strategies

**Possible: yes. Sensible: yes — but the value is in the *union view*, not in forcing three strategies into one shape.** Each contributes a different observability model, so the console must be strategy-aware.

### Today

The Pipeline Console (`packages/cds-data-pipeline/app/pipeline-console-src/`) is a **pipeline monitor** bound to `/pipeline`:

- Master: `Pipelines` table + a landscape graph (`landscapeMetadata()`).
- Detail: `PipelineRuns`, statistics, schedule, config diff (`configView()`), data inspector (`inspectData()` / `inspectCapabilities()`), flow graph (`flowMetadata()`).

It works because **replicate has persistent state** (tracker tables in `plugin.data_pipeline`). The other strategies do not.

### The three observability models

| Strategy | State model | What a console can surface | Data source | Availability |
|---|---|---|---|---|
| **Replicate** | Tracker tables (`PipelineRuns`, statistics, schedule, delta watermark, errors) | Everything today: runs, timeline, inspector, actions (start / schedule / overrides) | `/pipeline` OData (exists) | Everywhere |
| **Delegate** | *None* (live proxy, no rows) | Registry of delegated entities, cache config + hit-rate (`cds-caching`), CUD flags, cross-service `$expand` topologies, last remote call latency / errors | New runtime instrumentation (nothing persistent today) | Everywhere (once instrumented) |
| **Synonym** | `SYS.SYNONYMS` + SAP plugin `Status` view (`mock` \| `connected` \| `?`), grant validity, target schema | Connection state per entity, target container, mock-vs-connected | SAP plugin `/readconf` `Status` / `Synonyms` (cross-package) | **HANA-deployed only** |

### Unification point: the landscape graph

The existing landscape graph is the natural home for a **Federation Console**: render one graph of *all* federated entities, badged by strategy, with drill-down that adapts per node:

- replicate node → today's full run / inspector / action detail
- delegate node → registry + cache + expand metadata (read-mostly)
- synonym node → connection status from the `Status` view (read-only, HANA)

The console already degrades per capability (`inspectCapabilities()` → `full` \| `limited` \| `none`), so a strategy-aware detail panel extends an existing pattern rather than a rewrite.

### Design sketch — common model + per-strategy adapter

A `FederatedEntity` projection with a `strategy` discriminator, populated by three metadata adapters:

```
FederatedEntity { name, strategy, source, target, status, detailRef }
   ├─ replicate → pipeline tracker (Pipelines/PipelineRuns)   [rich, actionable]
   ├─ delegate  → scanner registry + cds-caching stats        [read-mostly]
   └─ synonym   → SYS.SYNONYMS / SAP plugin Status view       [read-only, HANA]
```

### Constraints / open design decisions

- **Delegate needs new instrumentation** — no tables exist; add a lightweight registry (+ lean on `cds-caching` stats where present). Medium effort.
- **Synonym only lights up on deployed HANA** — locally shows nothing; data comes from *SAP's* plugin (cross-package read). Not owned by us.
- **Where does the console live?** A federation-wide console arguably belongs in `cds-data-federation` (or a shared reuse module) reading from three sources. Today it physically lives in `cds-data-pipeline` because it is pipeline-scoped. Relocating / sharing it is itself an architectural call (ties into §13).

---

## 13. One package vs. the current split

**Surface: consolidate. Runtime: keep split.** The current separation is deliberate (ADR 0005 engine/annotation split; ADR 0006 per-plugin published surface) and collapsing everything regresses real properties.

### Why not one runtime package

- The **engine** (`cds-data-pipeline`) is federation-agnostic on purpose — `cds-data-materialization` uses it too. Re-merging re-couples layers.
- The **peer-dep model** keeps replicate optional: delegate-only users don't pull the engine.
- **Synonym drags in HANA-only baggage** — `@sap/hdi`, `@sap/xssec` (proprietary), a `cds.compile.to.hana` build patch, MTX deploy hooks. Folding that into the core federation package poisons the portable, SQLite-first test story and forces HANA on everyone. SAP also *owns* that plugin — forking fights upstream.

### What "one package" should mean

Consolidate the **developer-facing surface** (annotation namespace + console + docs), not the runtime/deploy machinery. Three candidate shapes (for an ADR to choose):

| Shape | What it is | Pros | Cons |
|---|---|---|---|
| **1. Umbrella meta-package** | `cds-data` depends on pipeline + federation + materialization; `optionalDependencies` synonym plugin | One install line, one docs home, one console; sub-packages stay independently usable + portable | Extra package to version; must avoid accidental coupling |
| **2. Unify namespace + console only** | Keep packages; add `@federation.alias` thin marker in federation; console gains strategy-aware adapters | "One vocabulary, many engines"; minimal new packaging | Console still needs a home + cross-package data reads |
| **3. Docs only** | Document synonym as DB-layer peer; no code | Zero maintenance; honest layering | No unified developer experience |

### Recommendation (for ADR, not committed here)

**Umbrella meta-package (1) + strategy-aware console (console half of 2) + `@federation.alias` as a thin composing marker.** Keep the runtime engines split and portable; unify only the surface the developer touches. This realizes the "sophisticated one-stop version" without owning synonym codegen or breaking portability — and positions cleanly against SAP's golden-path primitives (see §Executive verdict → SAP cooperation framing).

This graduates naturally into an ADR via `/discuss-architecture`: **"Unified federation console + package topology across delegate / replicate / synonym."**

Also referenced in §6 (Extension opportunities) and §9 (Options A–D).

---

## 14. Sources

- `[cap-js/cds-federation-synonyms](https://github.com/cap-js/cds-federation-synonyms)` — README, `lib/build-plugin.js`, `lib/server.js`, `lib/app-service.*`, `lib/mtx-service.*`, `lib/int-schema.cds`, `doc/details.md`, test HDI refs  
- `[SAP-samples/recap2026-cap-level-data-federation](https://github.com/SAP-samples/recap2026-cap-level-data-federation)` — exercises Ex0–Ex4, `ws/xtravels/srv/data-federation.js`, `assets/HANA-setup.md`  
- CAP: [Data Federation](https://cap.cloud.sap/docs/guides/integration/data-federation), [cds export](https://cap.cloud.sap/docs/tools/cds-cli), [Native HANA features](https://cap.cloud.sap/docs/advanced/hana#native-hana-features)  
- HANA: [HDI reference — synonyms / grants](https://help.sap.com/doc/e7a49993ba20497f9fa1802b28f81c40/2.0.08/en-US/SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en.pdf), [cross-container access](https://github.com/sap-tutorials/Tutorials/blob/master/tutorials/xsa-cross-container-access/xsa-cross-container-access.md)  
- Internal: [terminology.md](../../concepts/terminology.md), [comparison.md](../../../docs/federation/reference/comparison.md), [cap-builtin-analysis.md](./cap-builtin-analysis.md)

