---
title: "The Full Picture: Federating, Replicating, and Caching Remote Data in CAP — Part 1"
description: "Part 1 of 2: the concepts behind data federation in CAP — delegation, replication, caching — what CAP gives you out of the box, what you end up building yourself, and how a combined set of plugins closes the gap. Part 2 is a hands-on walkthrough."
date: 2026-07-16
author: Mike Zaschka
tags: [SAP CAP, cds-data-federation, cds-data-pipeline, cds-caching, federation, replication, BTP, side-by-side extensions]
---

# The Full Picture: Federating, Replicating, and Caching Remote Data in CAP — Part 1

Last year at reCAP 2025 and this year at reCAP 2026 I had the opportunity to give two talks on CAP performance optimization with data replication and caching. While I was (hopefully) able to introduce the core ideas, a 20-minute talk is too short to discuss everything that matters in practice.

Last year I also published a blog post about [cds-caching](https://community.sap.com/t5/technology-blog-posts-by-members/cap-just-got-faster-what-s-new-in-cds-caching-1-0/ba-p/14152848), an open-source plugin for request and data caching in CAP. Caching, it turns out, is only one piece of a bigger puzzle: almost every CAP application on BTP sooner or later needs data that lives *somewhere else* — an S/4HANA system, a SuccessFactors instance, another CAP service, some REST API. And every team ends up answering the same questions: Do we fetch it live? Do we copy it? Do we cache it? And who builds the plumbing?

What I'll present here didn't emerge in a vacuum. It's been inspired by many great resources on the topic: SAP's [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi), the [xtravels reference sample](https://github.com/capire/xtravels) (which consumes [xflights](https://github.com/capire/xflights)), the [Risk Management ext-service branch](https://github.com/SAP-samples/cloud-cap-risk-management/tree/ext-service-s4hc-suppliers-ui), [Kai Niklas's CAP Remote Services walkthrough](https://blog.kai-niklas.de/posts/9-sap-cap-remote-services-fiori-elements/), and [Gregor Wolf's cap-replication-demo](https://github.com/gregorwolf/cap-replication-demo).

This two-part series is my attempt to share the full picture:

- **Part 1 (this post)** covers the theory: the terminology, what CAP provides out of the box, where the gaps are, and how a combined set of open-source plugins closes them — with small code examples along the way.
- **Part 2** is a live walkthrough: we set up a small demo application (available on GitHub) that federates, replicates, and caches remote data, step by step.

## Terminology

Before diving in, it's important to straighten out the terms — they overlap with terms SAP uses in the [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) and with terms the data industry uses more broadly. The vocabulary below is what the rest of this series uses.

### Federation

Federation is the umbrella term and here means: **integrating data from various sources into your CAP application's data model and exposing it as a unified interface** — regardless of where the data physically comes from, and regardless of whether queries run live against the remote or against a local copy.

This follows the broader industry meaning ("make multiple data sources appear as one"). Note that CAP's own [Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation) uses the term more narrowly — there it specifically means copying remote data into the local database so it can be joined with local data in SQL. In this series, that narrower meaning is called *replication*, and federation is the umbrella above all strategies.

### Delegation

Delegation is a strategy within federation: incoming requests are **live-forwarded (delegated) to the remote service** at request time. The CAP application does not persist the remote data in its local model — it acts as a transparent proxy, translating each query on the way out and each response on the way back. This includes OData-specific mechanics like `$expand` and navigation, where local data and remote data need to be combined at runtime into a single response for the client.

Delegation shines when data must be fresh (think value helps, stock levels, prices) — and hurts when the remote is slow, rate-limited, or gets hit once per row.

### Replication

Replication means the data is **physically copied from the remote source into the local database** and integrated directly into the application's data model. The copy runs as a separate, scheduled process — (mostly) decoupled from incoming requests — so the application can serve the data as if it were local. Because it actually is: full SQL, joins with your own entities, analytics, no network hop per request.

The trade-off is the flip side of delegation: data is as fresh as the last sync, and someone has to run that sync reliably — scheduling, delta detection, retries, monitoring.

### Caching

Caching is deliberately **not** a third strategy. It's an option on top of either one: a delegated entity can cache responses to avoid hammering the remote with identical queries, and even a replicated entity can cache expensive local aggregations. Keeping caching orthogonal avoids a classic design mistake — a cache that quietly becomes an unmanaged replica.

To summarize:

| Term | What happens to the data | When queries hit the remote |
|---|---|---|
| **Federation** | Umbrella — remote data becomes part of your app's model | depends on strategy |
| **Delegation** | stays remote, proxied live | every request (unless cached) |
| **Replication** | copied into the local DB on a schedule | never at request time |
| **Caching** | option on either strategy | on cache miss |

## What CAP provides out of the box — and what's missing

Let me be clear upfront: CAP's support for consuming remote services is genuinely good, and the [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) ('Calesi' — CAP-level Service Interfaces) is worth reading in full. The building blocks are all there.

You import the external service definition, and CAP mocks it locally out of the box. You declare a *consumption view* — a plain CDS projection on the remote entity:

```cds
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

entity Customers as projection on remote.A_BusinessPartner {
    key BusinessPartner   as ID,
        BusinessPartnerFullName as name
};
```

And delegation is a one-liner, thanks to CAP's automatic query translation through the projection chain:

```js
const remote = await cds.connect.to('API_BUSINESS_PARTNER')
this.on('READ', 'Customers', req => remote.run(req.query))
```

That's the honest version of the demo. A client's `$filter=name eq 'ACME'` is translated to `BusinessPartnerFullName eq 'ACME'` on the remote — renames, `$select` restriction, all handled by CAP. Impressive for one line of code.

Replication is similarly approachable at first: add local persistence to the projection (`@cds.persistence.table`), then page through the remote and upsert what it returns:

```js
async function syncCustomers() {
    const remote = await cds.connect.to('API_BUSINESS_PARTNER')
    let page, offset = 0
    do {
        page = await remote.run(SELECT.from('A_BusinessPartner').limit(1000, offset))
        await UPSERT.into('ReplicatedCustomers').entries(page.map(mapToLocal))
        offset += 1000
    } while (page.length === 1000)
}

cds.spawn({ every: 600000 }, syncCustomers) // sync every 10 minutes
```

This is roughly the pattern SAP's own [xtravels sample](https://github.com/capire/xtravels) implements in [`srv/data-federation.js`](https://github.com/capire/xtravels/blob/main/srv/data-federation.js), and what [Gregor Wolf's cap-replication-demo](https://github.com/gregorwolf/cap-replication-demo) spells out end-to-end against the S/4HANA Business Partner API.

So what's the problem? The problem is everything *around* those lines:

**For delegation:**

- **Cross-service `$expand`.** The one-liner works until a client expands from a local entity into the remote one (or the other way around). Now you're splitting the query, running both halves, and stitching results back together — for every affected entity, in both directions. The Service Integration guide shows how; it's real code, per entity.
- **Navigation and filters across the boundary.** `$filter=customer/name eq 'ACME'` on a local entity with an association to remote data needs the same manual splitting.
- **Writes.** Forwarding CUD requests means translating payloads through the renames too — and deciding, per entity and operation, whether writes should be allowed at all.
- **Resilience.** The remote will be slow or down at some point. Without timeouts, retries, and ideally caching, its problems become your problems, live, per request.

**For replication:**

- **Scheduling.** Something has to trigger the sync — `cds.spawn`, a job scheduler, a heartbeat endpoint. Per project, someone builds this.
- **Delta detection.** Full loads don't scale. Tracking a high-watermark (`modifiedAt`, a key, an OData V2 date/time-field pair) is state you now own.
- **Retry with backoff.** A flaky network at 3 a.m. shouldn't leave you with a half-synced table. And a 401 should *not* be retried the same way as a 503.
- **Concurrency.** Two app instances, one schedule — who wins? You need a guard, or you get double syncs.
- **Idempotency.** UPSERT, never SELECT-then-INSERT, or replays create duplicates.
- **Observability.** When did the last sync run? How many records? Did it fail? Without a tracker and some management UI/API, the answer is "check the logs."

**And the biggest one — it's not a generic approach:**

- Nothing you build here is reusable. The delegate handler, the sync loop, the scheduler, the retry logic — all of it is written per entity and per project. The next federated entity means another handler; the next project means the same patterns and the same coding, all over again.

None of this is a criticism of CAP itself — it provides all the tools to stitch together your own integration logic, and that's a deliberate design choice. Data federation is varied and highly use-case dependent; a full-blown federation framework inside the CAP core would not be a good idea. But between "all the primitives are there" and "assemble them yourself, every time" sits a gap: something that removes the repetition without giving up the flexibility. Well — if you keep reading, I might have good news for you. 😄

## Connecting the dots with a combined set of plugins

![Connecting the dots — @federation.delegate routes through cds-caching, @federation.replicate through cds-data-pipeline](./images/connecting-the-dots.svg)

This is where the plugin family comes in — three open-source packages that divide the work:

| Package | Role |
|---|---|
| [`cds-data-federation`](https://www.npmjs.com/package/cds-data-federation) | The annotation layer: `@federation.delegate` and `@federation.replicate` on consumption views |
| [`cds-data-pipeline`](https://www.npmjs.com/package/cds-data-pipeline) | The engine underneath replication: scheduled, traceable `READ → MAP → WRITE` jobs with retry, delta tracking, and a management API |
| [`cds-caching`](https://github.com/mikezaschka/cds-caching) | Optional response caching on either strategy |

The core principle that everything follows from:

> **The consumption view IS the federation contract.** The CDS projection declares the *schema* — which fields, what shape, what renames. The `@federation.*` annotation declares the *runtime behavior* — delegate or replicate, optional cache, opt-in writes.

You already model consumption views today. The plugin just reads what's there.

### Delegation, declaratively

```cds
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

@federation.delegate
entity Customers as projection on remote.A_BusinessPartner {
    key BusinessPartner          as ID,
        BusinessPartnerFullName  as name,
        Industry                 as industry
};
```

No handler. From the projection alone, the plugin infers the source service and entity, the projected columns (which become the `$select` upper bound on every remote call — fields you don't project are never fetched), and the bidirectional rename mapping. On top of what CAP's query translation already does, the plugin handles the parts you'd otherwise code by hand: cross-service `$expand` in both directions (local → remote and remote → local, including cross-provider cases), navigation filters across the boundary, and static `where` clauses from the projection.

![@federation.delegate — the plugin registers a pass-through handler; reads are forwarded live to the remote service](./images/federation-delegate.svg)

Writes are off by default — a delegated entity is `@readonly` unless you opt in:

```cds
// Opt-in: allow update, keep create/delete blocked (they return HTTP 405)
@federation.delegate: { update: true }
entity EditableCustomers as projection on remote.A_BusinessPartner { ... };
```

### Caching on top

Caching is not a third strategy — it's an option on the annotation, and it comes in two flavors.

The **response cache** targets the "same query, hundreds of times" pattern: responses are cached by their query signature via [cds-caching](https://github.com/mikezaschka/cds-caching), with TTL and tag-based invalidation. Only identical queries hit the cache; everything else still goes to the remote.

```cds
@federation.delegate: { cache: { strategy: 'response', ttl: 30000 } }
entity Customers as projection on remote.A_BusinessPartner { ... };
```

![Response cache — cds-caching wraps the remote read; identical queries are served from the cache store](./images/federation-delegate-response-cache.svg)

The **entity cache** goes further: instead of caching individual responses, the plugin pulls a full snapshot of the remote entity into a local SQLite table — using `cds-data-pipeline` under the hood (more on that engine in a moment) — and serves *any* query against it — filters, sorting, aggregations — until the TTL expires. One remote read per TTL window, arbitrary local queries in between:

```cds
@federation.delegate: { cache: { strategy: 'entity', ttl: 3600000 } }
entity Customers as projection on remote.A_BusinessPartner { ... };
```

![Entity cache — a full snapshot lands in SQLite; any CQN is answered locally until the TTL expires](./images/federation-delegate-entity-cache.svg)

### Replication, declaratively — and the pipeline engine underneath

Same projection, different annotation:

```cds
@federation.replicate: { schedule: 600000, mode: 'delta', preload: true }
entity ReplicatedCustomers as projection on remote.A_BusinessPartner {
    key BusinessPartner          as ID,
        BusinessPartnerFullName  as name,
        Industry                 as industry
};
```

This is where the second plugin enters the picture. `cds-data-federation` doesn't implement syncing itself — it binds every `@federation.replicate` entity to a **pipeline** on `cds-data-pipeline`, the engine package. A pipeline is a deliberately narrow primitive: a scheduled `READ → MAP → WRITE` job between exactly one source and one target. The engine contributes precisely the list from the "missing" section above:

- **Scheduling** (`schedule`, plus `preload` for an initial load at startup)
- **Delta detection** with configurable high-watermark strategies (timestamp, key, OData V2 date/time fields)
- **Retry with exponential backoff** — and a sane default policy: 4xx errors are not retried, everything else is
- **Concurrency guard** via optimistic locking, so two app instances never run the same sync twice
- **Idempotent writes** via UPSERT
- **Streaming** — large datasets are paged and streamed record-by-record, never held fully in memory
- **A tracker and management OData service** at `/pipeline`: every pipeline, every run, record counts, durations, errors — plus actions to trigger or flush a sync manually

![@federation.replicate — the pipeline engine syncs remote data into the local database; requests never touch the remote](./images/federation-replicate.svg)

If you need to hook into a sync — say, to enrich records mid-flight — the engine emits events for each phase:

```js
const pipelines = await cds.connect.to('data-pipeline')
pipelines.before('PIPELINE.MAP', 'ReplicatedCustomers', ({ records }) => {
    for (const r of records) r.industry ??= 'UNKNOWN'
})
```

And because the engine is an independent package, it's also usable without any annotation — `addPipeline({ source, target, schedule })` registers a sync programmatically, for cases that aren't remote-service consumption views at all (REST ingestion, service-to-service copies, one-off backfills). For this series, though, think of it as the machinery that makes `@federation.replicate` production-grade.

### Choosing a strategy

My rule of thumb after having built both ways many times:

- **Delegate** when freshness beats latency: value helps, transactional lookups, data that changes constantly, low request volume.
- **Delegate + cache** when the same queries repeat: dashboards, dropdowns, anything read-heavy where 30 seconds of staleness is fine.
- **Replicate** when you need SQL: joins with local data, aggregations, analytics, high request volume, or a remote you don't want in your request path at all.

Since the strategy is just an annotation on the consumption view, switching between them later is a one-line change — the schema contract stays identical. That, more than any single feature, is the argument for making it declarative.

### When this is *not* the right tool

For completeness: this is application-layer integration — the CAP app owns the contract. If your joins should disappear into the database, HANA synonyms or Smart Data Access are the better layer. If you're building an enterprise-wide data fabric, that's SAP Business Data Cloud / Datasphere territory. And if the integration itself (transformations, B2B, routing) is the deliverable, that's Integration Suite. The [comparison matrix](https://mikezaschka.github.io/cds-data/federation/reference/comparison) in the docs walks through the alternatives row by row.

## What's next

That's the theory. In **Part 2** we get hands-on: we build a small Sales Cockpit (source on GitHub) that blends a public OData service, our own local data, and a second native CAP service consumed over HCQL — delegation, caching, and replication step by step, including the pipeline console and interactive CQL queries against the federated data from `cds repl`.

Feedback, questions, and war stories from your own integration projects are very welcome in the comments — and the plugins are open source, so issues and PRs even more so.

## Links

| Resource | URL |
|---|---|
| Documentation portal | https://mikezaschka.github.io/cds-data/ |
| `cds-data-federation` on npm | https://www.npmjs.com/package/cds-data-federation |
| `cds-data-pipeline` on npm | https://www.npmjs.com/package/cds-data-pipeline |
| `cds-caching` | https://github.com/mikezaschka/cds-caching |
| Source repo | https://github.com/mikezaschka/cds-data |
| CAP Service Integration guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| CAP Data Federation guide | https://cap.cloud.sap/docs/guides/integration/data-federation |
| cds-caching 1.0 blog post | https://community.sap.com/t5/technology-blog-posts-by-members/cap-just-got-faster-what-s-new-in-cds-caching-1-0/ba-p/14152848 |
