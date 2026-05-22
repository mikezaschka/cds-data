---
hide:
  - navigation
---

# cds-data-federation

**A SAP CAP plugin for integrating external services into your application's data model through declarative CDS annotations — without any additional coding.**

Declare a consumption view on the remote entity. Annotate it. That's the integration layer.

```cds
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

// Live proxy — reads forwarded to the remote service at request time
@federation.delegate
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};

// Scheduled sync — copies remote data into the local DB for local joins, analytics, offline
@federation.replicate: { schedule: 600000 }
entity ReplicatedPartners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};
```

From any CAP service, query them like local entities:

```http
GET /my-service/Partners?$filter=contains(name,'Acme')&$orderby=name&$top=10
```

<div class="grid cards" markdown>

-   :material-rocket-launch: **Getting Started**

    ---

    Install the plugin, annotate your first consumption view, and watch query delegation happen without a line of JavaScript.

    [:octicons-arrow-right-24: Getting started](getting-started/index.md)

-   :material-book-open-variant: **Concepts**

    ---

    The core ideas: consumption views as federation contracts, cross-service `$expand` scenarios, and how queries route through services vs. the DB.

    [:octicons-arrow-right-24: Terminology](concepts/terminology.md)

-   :material-book-multiple: **Reference**

    ---

    Every annotation option, the management OData service, and a side-by-side comparison with CAP built-ins and community alternatives.

    [:octicons-arrow-right-24: Annotations](reference/annotations.md)

-   :material-connection: **Integration**

    ---

    Protocol-specific guidance for OData V2 / V4, plain REST services, and the optional `cds-caching` integration.

    [:octicons-arrow-right-24: Integration](integration/odata.md)

</div>

## The two strategies

| Strategy | Annotation | Behavior | Use when |
|---|---|---|---|
| Delegate | `@federation.delegate` | Transparent live proxy. Reads (and optionally writes) are forwarded to the remote service at request time. Read-only by default; CUD is opt-in per entity. | You need up-to-the-second data, writes must hit the system of record, or the remote dataset is too large to replicate. |
| Replicate | `@federation.replicate` | Scheduled sync that copies remote data into the local database. Queries afterwards run fully locally — joinable, aggregatable, offline-capable. | You need analytics, joins across sources, resilience against remote outages, or the remote service can't sustain live query load. |

Both strategies support optional response caching via [`cds-caching`](https://github.com/mikezaschka/cds-caching).

## Why this plugin

CAP's [CaLeSi guide](https://cap.cloud.sap/docs/guides/integration/calesi) tells you *what* delegation and data federation are. It stops short of giving you a turnkey implementation: in practice you still write per-entity `on('READ')` handlers, wire up scheduled jobs, translate renamed fields in filters, and handle cross-service `$expand` by hand. The SAP [risk-management](https://github.com/SAP-samples/cloud-cap-risk-management) and [xtravels](https://github.com/capire/xtravels) samples demonstrate the manual pattern.

This plugin abstracts that boilerplate behind two CDS annotations. What CAP does natively (query translation, same-service `$expand`, result mapping) is preserved; what CAP does **not** do is automated:

- **Declarative handler registration** — no per-entity `on('READ')` code.
- **Navigation path filter translation** for renamed associations (e.g., `buyer/name` → `customer/name`).
- **Local → remote `$expand` resolution** (batch-fetch + stitch, composite keys, to-many, cross-provider).
- **Remote → local `$expand` resolution** (strip, forward, query local, stitch).
- **Static `where` clauses in projections** (a feature CAP explicitly does not support for remote services).
- **Scheduled replication** with delta sync, idempotent `UPSERT`, retry, concurrency guards.
- **Pluggable adapters** — OData V4 / V2 / HCQL out of the box, plain REST for services without a CDS model.
- **Optional response caching** via `cds-caching` with tag-based invalidation.

Opt-in CUD forwarding keeps federated entities read-only by default, matching SAP's own [xtravels](https://github.com/capire/xtravels) pattern.

## Links

- [GitHub repository](https://github.com/mikezaschka/cds-data-federation)
- [npm package](https://www.npmjs.com/package/cds-data-federation)
- [CAP CaLeSi guide](https://cap.cloud.sap/docs/guides/integration/calesi) — upstream delegation & federation reference
- [cds-caching](https://github.com/mikezaschka/cds-caching) — optional peer dependency for response caching
