# Terminology: Federation, Delegation, Replication & Caching

This document defines the key terms used by `cds-data-federation`, explains how they relate to SAP CAP's official definitions and to the broader industry, and provides the rationale for our naming choices.

---

## What "federation" means in this plugin

**Federation means: integrating remote service models into the consumer's data model and providing strategies for how that remote data is accessed at runtime.**

The developer declares two things:

1. **What** to federate — a CDS consumption view (`entity X as projection on remote.Y`) that defines the schema contract: which remote fields, what shape, what renames.
2. **How** to access it — a `@federation.*` annotation that selects the runtime strategy: delegate (live), replicate (scheduled sync), optionally with caching.

From the developer's perspective, the intent is always the same: "I need this remote entity's data available in my application." Whether that data is fetched live or replicated locally is a runtime concern, not a modeling concern.

---

## Industry context

The broader data industry defines data federation as follows:

> "Data Federation is a data management technique that **makes multiple data sources appear as a single one**."
> — Denodo (data virtualization vendor)

> "Data federation creates a **virtual, unified view of disparate data sources** without moving data. Instead of copying data into a centralized repository, the federation layer sits on top of your existing systems and queries them directly."
> — Fivetran

Key characteristics of data federation in the industry:

- **Unified access** — multiple heterogeneous sources queried through a single interface
- **Transparency** — the consumer does not need to know where data physically resides
- **Strategy-agnostic** — implementations range from live virtual queries to materialized views to full replication; the term covers all of them
- **Middleware-driven** — a federation layer handles query translation, schema mapping, and result assembly

Our plugin follows this definition: the CDS consumption view is the unified interface, the plugin is the middleware layer, and delegate/replicate are the implementation strategies.

---

## CAP's definitions (CaLeSi guide)

SAP CAP's [CaLeSi guide](https://cap.cloud.sap/docs/guides/integration/calesi) ("CAP-Level Service Integration") defines these terms as **peer concepts** under the umbrella of "Integration Logic":

### Integration

The top-level umbrella. The entire CaLeSi guide is titled "CAP-Level Service **Integration**." It covers the full lifecycle of working with remote services: importing APIs, creating consumption views, writing integration logic, events, and messaging.

### Data Federation

CAP has a dedicated guide: [CAP-level Data Federation](https://cap.cloud.sap/docs/guides/integration/data-federation). The meaning is specific:

> "Relying on live calls to remote services per row is clearly not an option. Instead, we'd rather ensure that data required in close access is really available locally, so it can be joined with own data using SQL JOINs. **This is what data federation is all about.**"

CAP's `@federated` annotation marks entities for **local replication** so their data is "in close access." The implementation pattern: `@cds.persistence.table` + UPSERT-based replication.

### Delegation

> "Even with data federation in place, there are still several scenarios where we need to reach out to remote services on demand. Value helps are a prime example."

Implementation: `this.on('READ', Customers, req => s4.run(req.query))` — forwarding a query live to a remote service. CAP emphasizes "Automatic Query Translation" as the key capability: field names are translated through the CDS projection chain.

### Navigation

> "The term 'navigation' commonly refers to **traversing associations between entities** in queries. In CAP, this is typically expressed using **path expressions along (chains of) associations** — e.g., `flight.origin.name` — which can show up in all query clauses (select, from, where, order by, and group by)."

When navigation paths cross service boundaries, queries must be split manually.

### Expands

`$expand` across service boundaries. Three scenarios:
- **Remote-to-remote** (Scenario A): both entities on the same remote — CAP handles natively
- **Local-to-remote** (Scenario B): local entity expands to remote — requires manual batch-fetch + stitch
- **Remote-to-local** (Scenario C): remote entity expands to local — requires manual reverse fetch

### Caching

CAP has **no native caching** for remote service responses or replicated data. No TTL, no LRU, no cache invalidation. Every remote call hits the network unless you add caching yourself.

---

## How our terms map to CAP's terms

| Term | CAP (CaLeSi) definition | Our plugin's definition | Alignment |
|---|---|---|---|
| **Integration** | Umbrella for all remote service work (APIs, events, messaging) | Not used as primary term; plugin sits under integration | No conflict |
| **Federation** | Narrow: replication for local "close access" (SQL joins) | Broad: integrating remote models + all access strategies | Intentionally broader |
| **Delegation** | Live forwarding: `req => remote.run(req.query)` | `@federation.delegate` — same behavior | Aligned |
| **Navigation** | Path expressions traversing associations in queries | `translateNavigationFilters()` — same concept | Aligned |
| **Replication** | Mechanism: copy remote data to local DB via UPSERT | `@federation.replicate` — same mechanism | Aligned |
| **Expand** | `$expand` across service boundaries (3 scenarios) | Scenarios A/B/C in `srv/delegation/` | Aligned |
| **Caching** | No CAP-native concept exists | Cross-cutting option via `cds-caching` peer dependency | No conflict |

### Annotation: `@federated` (CAP sample) vs `@federation.*` (this plugin)

CAP's [Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation) and the [xtravels sample](https://github.com/capire/xtravels/blob/main/srv/data-federation.js) introduce a `@federated` annotation (no dot, no strategy) used purely as a marker. A ~20-line `data-federation.js` in the sample walks the CSN, marks `@federated` entities as persistence tables, and implements a naive `modifiedAt`-based polling replication:

```cds
@federated entity Customers as projection on S4.A_BusinessPartner { ... };
```

This is conceptually similar to — but intentionally much smaller than — our `@federation.*` namespace.

| Aspect | CAP `@federated` (sample) | `@federation.*` (this plugin) |
|---|---|---|
| Namespace | Top-level annotation (adjective) | Dotted namespace (`delegate` / `replicate` as strategy suffixes) |
| Ownership | CAP sample code (not a runtime built-in) | This plugin |
| Strategy | Implicit: replication only | Explicit: `delegate` or `replicate` at the annotation site |
| Options | None | `cache`, `writable` / `create` / `update` / `delete`, `schedule`, `mode`, `batchSize`, `source` |
| Delta modes | `modifiedAt`-only polling | `timestamp` / `key` / `datetime-fields` via adapter |
| Adapters | OData / HCQL (CAP-native) | OData v2/v4, REST (with pagination + delta URL param), pluggable BaseAdapter |
| Resilience | None | `withRetry()` with exponential backoff + skip-4xx, concurrency guard via optimistic UPDATE |
| Hooks | None | `before/on/after('REPLICATE.READ'|'MAP'|'WRITE', name, fn)` — composable pipeline |
| Observability | None | `Federations`, `ReplicationRuns` entities + management OData service |
| View mapping | Verbatim replication | Scanner extracts `localToRemote`/`remoteToLocal`; MAP phase renames fields |
| Delegation | Not covered | `@federation.delegate` with Scenarios A/B/C $expand, cross-service navigation, static where, CUD forwarding |

There is **no technical collision**: `@federated` and `@federation.delegate` / `@federation.replicate` are distinct identifiers in distinct namespaces. Annotation names stay compatible if a project uses both (e.g. during migration). If CAP promotes `@federated` from sample code to a runtime built-in, we will reassess alignment at that point — possibly by recognising `@federated` on a consumption view as a synonym for `@federation.replicate` with defaults.

---

## Why "federation" as umbrella (not "integration")

We considered two naming options:

### Option A: `cds-data-federation` with `@federation.*` (chosen)

- Follows the **industry convention** where "data federation" = unified access across heterogeneous sources, regardless of strategy
- CAP's own `@federated` annotation is close in spirit — the xtravels sample treats it as "this data should be transparently available regardless of where it lives"
- `@federation.delegate` and `@federation.replicate` read naturally: "this entity participates in data federation, using strategy X"
- The namespace `@federation.*` is cleanly separated from CAP's `@federated` (namespace vs. adjective)
- The package name `cds-data-federation` communicates scope clearly

### Option B: `cds-data-integration` with `@integration.*` (rejected)

- Would align with CAP's top-level umbrella term
- But "integration" is too broad — it covers events, messaging, outbox, etc.
- The plugin focuses specifically on **data access patterns** (read delegation + replication), not the full integration spectrum
- Risk of colliding with future CAP-owned `@integration.*` annotations

### The intentional divergence

In CaLeSi, "Data Federation" and "Delegation" are **sibling sections** under "Integration Logic." Our plugin makes delegation a **strategy within** federation. This is intentional:

- From the developer's perspective, the decision is: "I have a remote entity in my model. How should I access its data?" The answer is `@federation.delegate` or `@federation.replicate`.
- Separating them into different annotation namespaces would force the developer to think about conceptual categories instead of practical choices.
- The consumption view is the constant; the strategy is the variable.

---

## Annotation design

```
@federation.delegate                              — live proxy (industry "federation")
@federation.delegate: { cache: { ttl: 60000 } }  — live proxy + response caching
@federation.replicate                             — scheduled sync (CAP "data federation")
@federation.replicate: { schedule: '*/10 * * * *', cache: { ttl: 300000 } }
```

Design principles:

- **Strategy is the annotation name**, not an option — `@federation.delegate` vs `@federation.replicate`. Easy to scan visually in CDS models.
- **Caching is an option**, not a strategy — it can be applied to either strategy. Caching is orthogonal to how data is accessed.
- **No `@cds.federated`** — that namespace belongs to SAP. We use `@federation.*` to stay in our own namespace.

---

## Summary for presentation

**One-liner:** Federation = integrating remote models into your data model + choosing how to access them.

**Three-part model:**

| | What | How | Annotation |
|---|---|---|---|
| **Schema** | Consumption view defines fields, shape, renames | CDS projection: `entity X as projection on remote.Y { ... }` | (modeling, no annotation needed) |
| **Strategy** | Live proxy or local sync | `delegate` = forward query; `replicate` = scheduled UPSERT | `@federation.delegate` / `@federation.replicate` |
| **Caching** | Optional response-level cache | Wraps strategy with TTL-based caching via `cds-caching` | `{ cache: { ttl: 60000 } }` option |

**Relationship to CAP terminology:**

```
CAP "Integration" (umbrella)
 ├── Data Federation (replication for close access)  ─┐
 ├── Delegation (live forwarding)                     ├── Our @federation.* (unified)
 ├── Navigation (association path traversal)          │   delegate = CAP delegation
 ├── Expands ($expand across services)                │   replicate = CAP data federation
 └── Outboxed Emits (async events)                   ─┘
```

**Why this naming works:**
1. Matches the industry definition of data federation (Denodo, Fivetran, Oracle)
2. Developer-centric: one annotation namespace, strategy as the only choice
3. Internal terms (delegate, replicate, navigation, expand) all align with CAP
4. Clean separation from CAP's `@federated` and `@cds.*` namespaces

---

## References

| Resource | URL |
|---|---|
| CaLeSi (CAP-Level Service Integration) | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP-level Data Federation | https://cap.cloud.sap/docs/guides/integration/data-federation |
| Denodo: Data Federation Definition | https://www.denodo.com/en/glossary/data-federation-definition-importance-best-practices |
| Fivetran: What is Data Federation? | https://www.fivetran.com/learn/data-federation |
| xtravels sample (data-federation.js) | https://github.com/capire/xtravels/blob/main/srv/data-federation.js |
