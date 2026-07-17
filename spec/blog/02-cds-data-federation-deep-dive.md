---
title: "The Full Picture: Federating, Replicating, and Caching Remote Data in CAP — Part 2: Hands-On"
description: "Part 2 of 2: a step-by-step walkthrough. We build a Sales Cockpit that blends a public OData service, local data, and a second native CAP service — delegation, caching, replication, the pipeline console, and CQL queries from cds repl. At every step: what is standard CAP, and what the plugins add."
date: 2026-07-16
author: Mike Zaschka
tags: [SAP CAP, cds-data-federation, cds-data-pipeline, cds-caching, federation, replication, HCQL, BTP, tutorial]
---

# The Full Picture: Federating, Replicating, and Caching Remote Data in CAP — Part 2: Hands-On

[Part 1](https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-1/ba-p/14402349) covered the theory: what federation, delegation, and replication mean, what CAP provides out of the box, and how a combined set of plugins closes the gaps. This post is the practical counterpart — we build a small but complete application, step by step.

The finished project is on GitHub: **[sales-cockpit](https://github.com/mikezaschka/data-federation-demo)**. The repo contains the final state; every step below documents how to get there, so you can build along or start from the finished app.

One thing I want to make explicit throughout this walkthrough: **which part is standard CAP, and which part comes from the plugins.** The plugins deliberately build *on* CAP's own mechanics — consumption views, query translation, service bindings — rather than replacing them. Each step ends with a short "CAP or plugin?" box so the boundary stays visible. My hope is that by the end you'll see how nicely the pieces snap together.

## What we're building

A **Sales Cockpit** for an inside-sales team. It starts as an empty CAP app and progressively blends:

- **Live remote data** — Customers from the public Northwind OData V4 service, proxied at query time (delegate).
- **Local data** — the reps' own `CustomerNotes`, merged with the live remote customers via `$expand` in both directions.
- **Cached lookups** — two delegated entities showing both cache flavors: `Suppliers` (response cache via cds-caching) and `Products` (entity cache, a local snapshot).
- **Replicated analytics** — Northwind Orders synced into local tables on a schedule, joinable with everything else in plain SQL.
- **A second, native CAP system** — an FX rate service, consumed over CAP's brand-new **HCQL** protocol and replicated the exact same way as the external OData source.
- **Event-driven refresh** — a single updated FX rate emits a CAP event that triggers a targeted single-record sync, no waiting for the schedule.
- **A third source type: plain REST** — a shipment-tracking API with no CDS model, replicated with pagination, a delta parameter, and a field-mapping hook.
- **Observability** — the built-in Pipeline Console.
- **A custom REST API** — a hand-written endpoint whose custom handler combines live, local, and replicated reads in one response.
- **And as a finale** — the same federated data queried interactively with CQL from `cds repl`, and (optionally) by an AI agent over MCP.

```
┌──────────────────────────────────────────────────────────────────────┐
│  SalesCockpit                    (CAP, SQLite, port 4004)            │
│                                                                      │
│  local DB ──── CustomerNotes                                         │
│                                                                      │
│  delegate ──── Northwind V4 (public) → Customers, GermanCustomers    │
│                  ├─ Suppliers with cache: { strategy: 'response' }   │
│                  └─ Products  with cache: { strategy: 'entity' }     │
│                                                                      │
│  replicate ─┬── Northwind V4 (public)  → SalesOrders   ── OData      │
│             ├── FX service (CAP app)   → ExchangeRates ── HCQL       │
│             └── Tracking API (no CDS!) → Shipments     ── plain REST │
│                                                                      │
│  local view ── FreightByCountryEUR (SQL join over two remotes)       │
│                                                                      │
│  event ─────── FXService.RateChanged → single-record micro-run       │
│                                                                      │
│  REST API ──── /api/customerBrief (custom handler, 3 read paths)     │
│                                                                      │
│  pipeline ──── tracker tables + /pipeline-console/                   │
└──────────────────────────────────────────────────────────────────────┘
         │                    │                        │
  services.odata.org   FX service (CAP,       tracking-api (plain
  (OData V4, public)   @hcql, port 4005)      Node.js, port 4006)
```

**Prerequisites:** Node.js ≥ 22, `@sap/cds` 10 (the HCQL step needs it on both apps; everything else also runs on CDS 9), `@sap/cds-dk` globally, and network access to `services.odata.org`. I'll use the VS Code REST Client — the repo ships a [`requests.http`](https://github.com/mikezaschka/data-federation-demo/blob/main/requests.http) with every request from this post.

## Step 0 — Scaffold a fresh app

```bash
cds init sales-cockpit
cd sales-cockpit
cds add nodejs sqlite
cds watch          # → empty app on http://localhost:4004
```

A standard, empty CAP app with a file-backed SQLite database. Nothing to see yet — which is the point. Let's give it data it doesn't own.

> **CAP or plugin?** 100% standard CAP. The file-backed SQLite matters later: replicated tables, the entity cache, and the pipeline tracker will survive restarts.

## Step 1 — Import the remote service

Northwind plays the role of the ERP-style backend. Download its metadata once and import it (the `.edmx` is also [committed to the repo](https://github.com/mikezaschka/data-federation-demo/blob/main/sales-cockpit/srv/external/northwind-v4.edmx) in case the public service is down):

```bash
curl -sL 'https://services.odata.org/V4/Northwind/Northwind.svc/$metadata' -o northwind-v4.edmx
cds import northwind-v4.edmx --as cds
```

Then tell CAP where the real service lives:

```jsonc
// package.json → cds.requires
"northwind_v4": {
  "kind": "odata",
  "model": "srv/external/northwind-v4",
  "credentials": { "url": "https://services.odata.org/V4/Northwind/Northwind.svc" }
}
```

And install the plugins plus the Cloud SDK connectivity layer CAP uses for outbound HTTP:

```bash
npm add cds-data-federation
npm add @sap-cloud-sdk/http-client @sap-cloud-sdk/resilience @sap-cloud-sdk/connectivity
```

> **CAP or plugin?** Still standard CAP: `cds import`, the external model under `srv/external/`, and the `cds.requires` binding are exactly what the [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi) describes. In production you'd point `credentials` at a BTP destination instead of a URL — also standard. The plugin is installed but hasn't done anything yet.

## Step 2 — Delegate: the projection is the contract

Now the first plugin moment. Expose the remote Customers through your own service — as a plain CDS projection with one annotation:

```cds
// srv/sales-cockpit.cds
using { northwind_v4 as northwind } from './external/northwind-v4';

service SalesCockpit {

    @federation.delegate
    entity Customers as projection on northwind.Customers {
        CustomerID  as customerId,
        CompanyName as companyName,
        ContactName as contactName,
        City        as city,
        Country     as country
    };
}
```

Save, and `cds watch` reloads. That's it — no handler file. Try it:

```http
GET http://localhost:4004/odata/v4/sales-cockpit/Customers?$filter=country eq 'Germany'&$top=5
```

The client filters on `country` — your field name. The remote receives `$filter=Country eq 'Germany'` — its field name. Only the five projected columns are ever requested from the remote; fields you didn't project are never fetched. The response is mapped back through the renames.

Consumption views can also carry **static filters**. A second entity, same source, permanently scoped:

```cds
@federation.delegate
entity GermanCustomers as projection on northwind.Customers {
    CustomerID  as ID,
    CompanyName as companyName,
    ContactName as contactName,
    City        as city,
    Country     as country,
} where Country = 'Germany';
```

Every query against `GermanCustomers` silently gets the filter injected into the remote call.

> **CAP or plugin?** The projection syntax, the renames, and the query translation through the projection chain are **standard CAP** — this is CAP's "Automatic Query Translation" doing the heavy lifting. What the **plugin** adds: it scans the model for `@federation.*` at startup, registers the pass-through handler for you (the `this.on('READ', ...)` you'd otherwise write per entity), extracts the static `where` into every remote query, and enforces `@readonly` since we didn't opt into writes. One line of the log confirms it: `[cds-data-federation] discovered N @federation.* entities`.

## Step 3 — Blend local and remote data

A cockpit needs data the reps *own*. Add a local entity — with an association pointing at the **remote** one:

```cds
// inside service SalesCockpit
entity CustomerNotes {
    key ID        : UUID;
        customer  : Association to SalesCockpit.Customers;  // → lives in Northwind!
        author    : String(100);
        note      : String(500);
        createdAt : Timestamp;
}
```

And give `Customers` the backlink:

```cds
@federation.delegate
entity Customers as projection on northwind.Customers {
    CustomerID  as customerId,
    // ... as before ...
    notes : Association to SalesCockpit.CustomerNotes on notes.customer = $self
};
```

Seed a few notes against real Northwind keys (`ALFKI`, `BLAUS`, …) via CSV ([grab it from the repo](https://github.com/mikezaschka/data-federation-demo/blob/main/sales-cockpit/db/data/SalesCockpit.CustomerNotes.csv)), `cds deploy`, and then ask for both directions:

```http
# local → remote: my notes, each stitched to its live remote customer
GET {{baseUrl}}/CustomerNotes?$expand=customer&$filter=customer/companyName eq 'Alfreds Futterkiste'

# remote → local: a live remote customer, stitched to my local notes
GET {{baseUrl}}/Customers('ALFKI')?$expand=notes
```

Read that first request again: it filters local notes **by a field of the remote customer** (`customer/companyName`) and expands across the service boundary. The second goes the other way — a live remote read, enriched with local rows.

> **CAP or plugin?** The association modeling is **standard CDS** — you declare relationships exactly as if everything were local; that's the beauty of the consumption-view contract. But executing them is the part CAP leaves to you: a cross-service `$expand` means splitting the query, batch-fetching the other side by key, and stitching results — per entity, per direction (in part 1 this was the first "what's missing" bullet). The **plugin** resolves both directions generically, including navigation filters like `customer/companyName`, without N+1 remote calls.

## Step 4 — Cache: response, then entity

Lookups that are read constantly but change rarely don't need the remote on every request. Caching comes in two flavors, and the cockpit uses both — on two different entities.

First flavor, the **response cache** via [cds-caching](https://github.com/mikezaschka/cds-caching), on `Suppliers`:

```bash
npm add cds-caching
```

```cds
@federation.delegate: { cache: { strategy: 'response', ttl: 60000 } }
entity Suppliers as projection on northwind.Suppliers {
    SupplierID  as supplierId,
    CompanyName as companyName,
    City        as city,
    Country     as country
};
```

```http
GET {{baseUrl}}/Suppliers?$top=10      # cold → remote
GET {{baseUrl}}/Suppliers?$top=10      # warm → cache hit, no remote call
GET {{baseUrl}}/Suppliers?$filter=country eq 'Germany'   # different query → miss
```

Identical queries are instant; every *variation* is a fresh miss. Perfect for repetitive reads — but for a Fiori list page where users constantly change filters, that's not good enough. That's what the second flavor, the **entity cache**, is for — here on `Products`:

```bash
npm add cds-data-pipeline    # the entity cache is a snapshot on the pipeline engine
```

The snapshot needs a place to live: declare the cache datastore in `cds.requires`, so the required tables are deployed — a dedicated SQLite file, kept separate from your application tables:

```jsonc
// package.json → cds.requires — datastore for the entity-cache snapshot tables
"data-federation-cache": { "kind": "sqlite" }
```

```cds
@federation.delegate: { cache: { strategy: 'entity', ttl: 5000 } }
entity Products as projection on northwind.Products;
```

Now the plugin pulls the *whole* projected entity into a local SQLite table once, and **any** filter, sort, or aggregation is served locally until the TTL expires:

```http
GET {{baseUrl}}/Products?$filter=UnitPrice gt 20&$orderby=UnitPrice desc   # local
GET {{baseUrl}}/Products?$filter=contains(ProductName,'Cha')               # still local
```

(The 5-second TTL is demo-friendly so you can watch the refresh in the logs; in a real app you'd use minutes or hours.)

> **CAP or plugin?** Caching has no CAP-native counterpart — this is plugin territory on both flavors. Note the composition, though: the response cache is `cds-caching` (a separate plugin, usable entirely on its own) wired in by the federation plugin; the entity cache is the **pipeline engine** doing a full read into a local table. Remember that sentence — the next step is the same mechanism, made permanent.

## Step 5 — Replicate: same engine, scheduled and joinable

Freight analytics over Orders shouldn't hit a remote per request. Replicate instead:

```jsonc
// package.json → cds.requires — enable the tracker's management API + console
"data-pipeline": {
  "management": { "reuse": { "api": true, "console": true } }
}
```

```cds
@federation.replicate: { preload: true, schedule: 30000 }
entity SalesOrders as projection on northwind.Orders {
    OrderID     as orderId,
    OrderDate   as orderDate,
    Freight     as freight,
    ShipCountry as shipCountry,
    CustomerID  as customerId,
    notes : Association to many SalesCockpit.CustomerNotes
                on notes.customer.customerId = $self.customerId
};
```

Same consumption-view pattern, different annotation. `preload: true` runs an initial sync at startup; `schedule: 30000` re-syncs every 30 seconds. Watch the log narrate it: `PIPELINE.READ` … `PIPELINE.WRITE` — the engine pages through the remote, streams records, and UPSERTs them into a real local table. Which means:

```http
# aggregation over the replicated table — plain local SQL
GET {{baseUrl}}/SalesOrders?$apply=groupby((shipCountry),aggregate(freight with sum as totalFreight))&$orderby=totalFreight desc

# replicated → local join: every order carries my notes — a SQL join, not a stitch
GET {{baseUrl}}/SalesOrders?$expand=notes&$top=5
```

Compare with step 3: there, `$expand` across the boundary was a runtime stitch orchestrated by the plugin. Here, `$expand=notes` is a plain database join, because `SalesOrders` *is* a local table. Delegate for freshness, replicate for joins and analytics — and switching between them is an annotation, not a rewrite.

> **CAP or plugin?** Serving `$apply` aggregations from a local table is **standard CAP** — once the data is local, CAP doesn't care how it got there. Everything that *makes* it local is the **plugin stack**: `cds-data-federation` derives the pipeline from the consumption view, and `cds-data-pipeline` contributes the scheduler, paging, streaming, idempotent UPSERT, retry with backoff, the concurrency guard, and the tracker tables (part 1's replication gap list, item by item).

## Step 6 — A second, native CAP system over HCQL

So far the remote was external OData, imported from an `.edmx`. Now the second half of the story: consume a **native CAP service** — and watch the same annotations behave identically.

The provider is a tiny FX-rate CAP app (in the repo under [`fx-service/`](https://github.com/mikezaschka/data-federation-demo/tree/main/fx-service)), serving one entity over both OData and HCQL:

```cds
// fx-service/srv/fx-service.cds
@hcql @odata
service FXService @(path: 'fx') {
    entity ExchangeRates as projection on fx.ExchangeRates;  // currency, base, rate, modifiedAt
}
```

Instead of an `.edmx` import, share it the idiomatic CAP-to-CAP way — [CAP's own API packaging](https://cap.cloud.sap/docs/guides/integration/calesi#providing-cap-level-apis): `cds export` on the provider produces an interface-only npm package, which the consumer simply installs:

```bash
# in fx-service/ (done once, committed to the repo)
cds export srv/fx-service.cds --data

# in sales-cockpit/
npm add ../fx-service/apis/fx-service
```

```cds
// srv/sales-cockpit.cds
using { FXService as fx } from 'data-federation-demo-fx-api';   // ← an npm package, not an edmx

@federation.replicate: {
    schedule: 60000,
    preload : true,
    mode    : 'delta',
    delta   : { field: 'modifiedAt' }
}
entity ExchangeRates as projection on fx.ExchangeRates {
    currency, base, rate, modifiedAt
};
```

Two new things in the annotation: `mode: 'delta'` with a `delta.field` — after the first full load, only rows whose `modifiedAt` passed the last run's high-watermark are fetched. The tracker keeps that watermark; you keep nothing.

Run the provider as a real, separate process and bind it:

```jsonc
// sales-cockpit/package.json → cds.requires
"FXService": { "kind": "hcql", "credentials": { "url": "http://localhost:4005/hcql/fx" } }
```

```bash
# terminal 1
cd fx-service && cds watch --port 4005
# terminal 2
cd sales-cockpit && cds watch
```

And here's the payoff in the pipeline log — same engine, two wire protocols:

```
[cds-data-pipeline] PIPELINE.READ SalesOrders   — via odata
[cds-data-pipeline] PIPELINE.READ ExchangeRates — via hcql
```

Since both replicas are plain local tables now, joining **two different remote systems** is just CDS:

```cds
entity FreightByCountryEUR as
    select from SalesOrders as o
    cross join ExchangeRates as fx {
        o.shipCountry            as country,
        sum(o.freight * fx.rate) as freightEUR
    }
    where fx.currency = 'USD' and fx.base = 'EUR'
    group by o.shipCountry;
```

```http
GET {{baseUrl}}/FreightByCountryEUR?$orderby=freightEUR desc
```

Northwind orders (USD freight) × FX rates from a second system → EUR totals per country. In one local SQL view.

> **CAP or plugin?** A lot of standard CAP here, and it's worth appreciating: `cds export` / `npm add` is CAP's Calesi packaging, and **HCQL is a CDS 10 runtime feature** — CAP auto-selects it for CAP-to-CAP hops because the provider declares `@hcql`; there is no `@federation.hcql`. The `FreightByCountryEUR` view is plain CDS over local tables. The **plugin's** contribution is consistency: `@federation.replicate` is byte-for-byte the same annotation whether the source arrived as an `.edmx` import, a native CAP package, or a plain REST API (that one comes in step 8) — federation is source-agnostic, and the engine picks the best wire per source.

## Step 7 — Watch the delta run work — then make it instant

In step 6 we declared `mode: 'delta'` on `ExchangeRates` — but we never actually *saw* it work. Let's fix that first, in isolation, before adding events on top.

The FX service has an `updateRate` action that changes a single rate and bumps its `modifiedAt` — a plain custom handler, nothing special:

```cds
// fx-service/srv/fx-service.cds
action updateRate(currency : String(3), rate : Decimal(10, 4)) returns ExchangeRates;
```

```http
POST http://localhost:4005/odata/v4/fx/updateRate
Content-Type: application/json

{ "currency": "USD", "rate": 0.9250 }
```

Now watch the cockpit's log. Within 60 seconds the scheduled run fires — and fetches exactly **one** row:

```
[cds-data-pipeline] PIPELINE.READ ExchangeRates — delta (modifiedAt > <watermark>) via hcql
[cds-data-pipeline] PIPELINE.WRITE ExchangeRates — 1 record
```

That's delta sync in isolation: the tracker keeps a high-watermark from the last successful run, and every scheduled run asks the source only for rows changed since. Cheap, steady, zero code on your side. The one thing it can't give you is **immediacy** — worst case, the cockpit is a full schedule interval stale.

So let's close that gap. A second action on the FX service — same update, but this one also **emits a declared CDS event**:

```cds
// fx-service/srv/fx-service.cds
action updateRateAndNotify(currency : String(3), rate : Decimal(10, 4)) returns ExchangeRates;
event  RateChanged { currency : String(3); rate : Decimal(10, 4); }
```

```js
// fx-service/srv/fx-service.js — the notifying handler
this.on('updateRateAndNotify', async (req) => {
    const result = await updateRate(req)                 // the same update as before
    await this.emit('RateChanged', { currency: result.currency, rate: result.rate })
    return result
})
```

Since the two apps are separate processes, they need a message channel. For local development, CAP ships one that needs zero infrastructure — add to **both** apps:

```jsonc
// package.json → cds.requires (both apps)
"messaging": { "kind": "file-based-messaging" }
```

Consumer side, in the cockpit's service implementation — subscribe and hand the key to the pipeline:

```js
// sales-cockpit/srv/sales-cockpit.js
const messaging = await cds.connect.to('messaging')
const pipelines = await cds.connect.to('data-pipeline')

messaging.on('FXService.RateChanged', async (msg) => {
    const { currency } = msg.data
    await pipelines.executeEvent('ExchangeRates', {
        event: { read: 'key', keys: { currency } },
    })
})
```

`executeEvent` runs a **micro-run**: a single-key read from the source, through the same MAP/WRITE path as the batch sync. Compare the two side by side:

```http
POST http://localhost:4005/odata/v4/fx/updateRateAndNotify
Content-Type: application/json

{ "currency": "USD", "rate": 0.9312 }
```

```http
GET {{baseUrl}}/ExchangeRates?$filter=currency eq 'USD'    # updated in seconds — not on the next schedule tick
```

Where the silent `updateRate` left the cockpit stale until the next scheduled delta run, the notifying variant lands in the local table near-instantly. And the scheduled delta run keeps running underneath as the catch-up net — for changes that happen while the cockpit is down, or sources that don't emit events at all.

One subtle detail that's easy to get wrong when hand-rolling this: the micro-run deliberately does **not** advance the batch delta watermark (`lastSync`). If it did, the next scheduled delta run could silently skip rows that changed between the watermark and the event. Batch and event runs coexist safely; both appear in the tracker, the micro-runs marked `trigger: event`.

> **CAP or plugin?** The actions, the declared event, `this.emit`, and the messaging binding are **standard CAP** — custom handlers and eventing straight from the book; locally file-based, in production you'd swap the binding to SAP Event Mesh or Redis without touching a line of code (also standard). The **plugin** owns both sync mechanics: the scheduled delta run (watermark tracking, changed-rows-only fetch) and `executeEvent` (the targeted single-record run, watermark protection, `trigger: event` observability). Notice the seam: CAP delivers the notification, the engine turns it into a safe, traceable sync.

## Step 8 — A third source type: a plain REST API

Northwind arrived as imported OData, the FX service as a native CAP package. The third kind of source you'll meet in the wild has neither: a **plain JSON-over-HTTP API**. No OData, no CDS model, snake_case field names, records wrapped in an envelope, offset paging. Our stand-in is a shipment-tracking API — in the repo as a single-file, zero-dependency Node server ([`tracking-api/`](https://github.com/mikezaschka/data-federation-demo/tree/main/tracking-api), deliberately *not* CAP):

```bash
# terminal 3
cd tracking-api && npm start     # → http://localhost:4006/api/shipments
```

```json
// GET /api/shipments?offset=0&limit=2 — what the wire actually looks like
{
  "results": [
    { "order_id": 10248, "status_text": "in_transit", "carrier_name": "DHL", "updated_at": "2026-07-15T08:12:44Z" },
    { "order_id": 10249, "status_text": "delivered",  "carrier_name": "UPS", "updated_at": "2026-07-14T16:03:01Z" }
  ],
  "totalCount": 80
}
```

No CDS model means no projection — there's nothing to project *from*. This is the one escape hatch in the consumption-view principle: declare the target entity locally, and describe the wire in the annotation:

```jsonc
// package.json → cds.requires
"TrackingAPI": { "kind": "rest", "credentials": { "url": "http://localhost:4006" } }
```

```cds
@federation.replicate: {
    source  : 'TrackingAPI',
    schedule: 30000,
    preload : true,
    mode    : 'delta',
    delta   : { field: 'updatedAt' },
    rest    : {
        path      : '/api/shipments',
        pagination: { type: 'offset', pageSize: 50 },
        deltaParam: 'modifiedSince',
        dataPath  : 'results'
    }
}
entity Shipments {
    key orderId   : Integer;
        status    : String(20);
        carrier   : String(40);
        updatedAt : Timestamp;
}
```

Read the `rest` block as a description of the API's conventions: page with `offset`/`limit` in steps of 50, find the records under `results`, and pass the delta watermark as `?modifiedSince=...`. One thing is still missing — without a projection there are no renames to infer, and the API speaks snake_case. A `PIPELINE.MAP` hook closes that gap:

```js
// srv/sales-cockpit.js
pipelines.on('PIPELINE.MAP', 'Shipments', (req) => {
    req.data.targetRecords = req.data.sourceRecords.map((r) => ({
        orderId:   r.order_id,
        status:    r.status_text,
        carrier:   r.carrier_name,
        updatedAt: r.updated_at,
    }))
})
```

And because the tracking server advances a random shipment's status every 20 seconds, the 30-second delta schedule has something to do — watch the log pick up one or two changed rows per run, exactly like the FX delta in step 7. Since `Shipments` keys on the Northwind order ID, the payoff is a three-source join:

```http
GET {{baseUrl}}/Shipments?$filter=status ne 'delivered'&$orderby=updatedAt desc

# OData-sourced order + REST-sourced shipment + local notes — one local join
GET {{baseUrl}}/SalesOrders?$expand=shipment,notes&$top=5
```

> **CAP or plugin?** This step is the mirror image of the others: here CAP genuinely can't help — no model, no projection, no query translation — and only the `cds.requires` service binding with `kind: 'rest'` is standard. Everything else is the **pipeline's REST adapter**: pagination strategies (offset, page, cursor), envelope unwrapping via `dataPath`, the delta query parameter, and the MAP hook for field translation. What's worth noticing is what *didn't* change: the annotation is still `@federation.replicate`, the target is still a plain local table, and the tracker, retry, and console treat this pipeline exactly like the OData and HCQL ones.

## Step 9 — Observability: the Pipeline Console

We enabled `management.reuse` in step 5 — so this step costs nothing:

```
http://localhost:4004/pipeline-console/index.html
```

All three pipelines — `SalesOrders` (OData), `ExchangeRates` (HCQL), and `Shipments` (REST) — with status, run history, row counts, durations, errors, and the wire protocol per source. Fire the `updateRateAndNotify` action from step 7 again and watch the `ExchangeRates` run list: the scheduled batch runs (full and delta) sit next to single-record entries marked `trigger: event`. Behind the UI sits a plain OData management service you can script against:

```http
GET  http://localhost:4004/pipeline/Pipelines?$expand=runs($top=3;$orderby=startedAt desc)

POST http://localhost:4004/pipeline/execute
Content-Type: application/json

{ "name": "ExchangeRates", "mode": "full" }
```

> **CAP or plugin?** The console and the management service ship with `cds-data-pipeline`. But notice *what* they are: a CDS-modeled OData service like any other — which is why you can query it with `$expand` and call its actions with plain HTTP. The plugin eats CAP's own dog food.

## Step 10 — A custom REST endpoint, a custom handler

So far every consumer spoke OData. Not everything does — a mobile app, a script, another system might just want plain JSON. And sometimes one endpoint should answer with data from *several* of our sources at once. Both are ordinary CAP: a second service served over the REST protocol, with a hand-written handler.

```cds
// srv/cockpit-api.cds
using { SalesCockpit } from './sales-cockpit';

@protocol: 'rest'
service CockpitAPI @(path: '/api') {
    function customerBrief(customerId : String) returns CustomerBrief;
    // (CustomerBrief and its sub-types are plain CDS type definitions — see the repo)
}
```

The handler is where it gets interesting — three reads, three completely different execution paths, identical code:

```js
// srv/cockpit-api.js
export default class CockpitAPI extends cds.ApplicationService {
    async init() {
        const cockpit = await cds.connect.to('SalesCockpit')
        const { Customers, CustomerNotes, SalesOrders } = cockpit.entities

        this.on('customerBrief', async (req) => {
            const { customerId } = req.data

            // 1. LIVE remote read — routed through the delegate handler to Northwind
            const customer = await cockpit.read(Customers, { customerId })
                .columns('customerId', 'companyName', 'city', 'country')

            // 2. Local read — the reps' notes from our own SQLite table
            const notes = await cockpit.read(CustomerNotes)
                .columns('author', 'note')
                .where({ customer_customerId: customerId })

            // 3. Replicated read — a local table the pipeline keeps in sync
            const [orderStats] = await cockpit.read(SalesOrders)
                .columns('count(*) as orderCount', 'sum(freight) as totalFreight')
                .where({ customerId })

            return { customer, notes, orderStats }
        })
        return super.init()
    }
}
```

```http
GET http://localhost:4004/api/customerBrief?customerId=ALFKI
```

```json
{
  "customer":   { "customerId": "ALFKI", "companyName": "Alfreds Futterkiste", "city": "Berlin", "country": "Germany" },
  "notes":      [ { "author": "John Smith", "note": "Initial contact established. ..." }, ... ],
  "orderStats": { "orderCount": 6, "totalFreight": 225.58 }
}
```

Look at the handler once more: nothing in it knows that `Customers` is a live remote, that `SalesOrders` is a replica, or that `Products` would come from a cache. It's three `cockpit.read(...)` calls. The annotations on the consumption views decide the execution path — the handler code stays strategy-agnostic, which means you can *change* the strategy later without touching this handler.

> **CAP or plugin?** Almost everything here is **standard CAP**: `@protocol: 'rest'` for the plain-JSON endpoint, `cds.ApplicationService` with an `on` handler, CQL via `srv.read(...)`. The **plugin's** entire contribution is invisible: read #1 fires its delegate handler because CQL queries hit the same service events as HTTP requests. That invisibility is the point — custom code composes with federation for free.

## Step 11 — Query it all from `cds repl`

Here's my favorite way to show that federation lives at the **CAP service level**, not at the OData adapter: query it with CQL, interactively. Stop `cds watch` in the cockpit terminal and start the REPL instead (the FX service keeps running):

```bash
cds repl --run .
```

This boots the app inside a Node.js REPL, with `cds` and the query builders as globals. Connect to your service and go:

```js
> var cockpit = await cds.connect.to('SalesCockpit')

// A delegated entity — this CQL query triggers a LIVE remote call to Northwind:
> await cockpit.read('Customers').where({ country: 'Germany' })
[ { customerId: 'ALFKI', companyName: 'Alfreds Futterkiste', ... }, ... ]

// The cached entity — served from the SQLite snapshot, no remote call within TTL:
> await cockpit.read('Products').where('UnitPrice >', 50)

// The replicated table — plain local read, aggregate away:
> await cockpit.read('SalesOrders')
    .columns('shipCountry', 'sum(freight) as totalFreight')
    .groupBy('shipCountry')

// And the cross-system join view:
> await SELECT.from(cockpit.entities.FreightByCountryEUR).orderBy('freightEUR desc')
```

Watch the terminal while you do this: the first query logs an outbound Northwind request, the second logs a cache hit, the third stays silent — pure SQLite. Same CQL, three different execution paths, decided entirely by the annotation on the consumption view.

Why this matters beyond the wow factor: **anything** that speaks CQN against your service gets federation for free — custom handlers (step 10 was exactly that), integration tests, the REPL, and, as we'll see next, AI agents. The OData endpoint is just one consumer among many.

> **CAP or plugin?** `cds repl` is a **standard CAP** developer tool, and programmatic CQL against a service is core CAP. The **plugin** simply doesn't care who's asking: its handlers sit on the service's READ events, so REPL queries route through delegate/cache/replicate exactly like HTTP requests do. Nothing was configured for this step — it falls out of the architecture.

## Step 12 (optional) — Let an AI agent query it over MCP

One more consumer, because it's 2026: expose the same service via the Model Context Protocol. With CAP's MCP adapter this is one annotation and one dependency:

```bash
npm add @cap-js/mcp
```

```cds
@mcp: 'agent'
service SalesCockpit { /* everything from steps 2–8, unchanged */ }
```

The service is now also served at `http://localhost:4004/mcp/agent` (tools: `describe`, `query`, `call_action`). Point any MCP client at it — Cursor, Claude, the MCP Inspector — and ask in natural language: *"List the top 5 customers in Germany and show total freight per country in EUR."* The agent's `query` calls run CQN `SELECT`s on your service — landing on the same federation handlers as the REPL queries in step 11. Live remote data, cached lookups, and replicated analytics in one conversation, with zero MCP-specific code.

> **CAP or plugin?** The MCP adapter is **standard CAP** (`@cap-js/mcp`, CDS 10). The federation handlers underneath are the plugin. Neither knows about the other — they compose through CAP's event model. That's the "nicely fits together" point of this whole post in a single step.

## How it all fits together

Looking back at what we built, the division of labor is remarkably clean:

| Concern | Standard CAP | The plugins add |
|---|---|---|
| Remote model & binding | `cds import`, `cds.requires`, destinations | — |
| Schema contract | consumption views, renames, associations | — |
| Query translation | projection chain, automatic renames | — |
| Live forwarding | `remote.run(query)` primitive | handler registration, cross-service `$expand`/navigation, static `where`, CUD opt-in |
| Caching | — | response cache (`cds-caching`), entity cache (pipeline snapshot) |
| Replication | `UPSERT`, `cds.spawn` primitives | scheduler, full/delta modes, retry, concurrency guard, streaming, tracker |
| CAP-to-CAP | `cds export`/`npm add`, HCQL (CDS 10) | same annotation for every source type |
| REST sources | `cds.requires` binding (`kind: 'rest'`) | REST adapter: pagination, `dataPath` envelopes, delta param, `PIPELINE.MAP` field translation |
| Eventing | declared events, `emit`, messaging bindings (file-based → Event Mesh) | `executeEvent` single-record micro-runs, watermark-safe, `trigger: event` in the tracker |
| Custom endpoints | `@protocol: 'rest'`, `ApplicationService` handlers, CQL | reads inside handlers route through delegate / cache / replicate automatically |
| Observability | CDS-modeled services, OData | Pipeline Console + management API |
| Other consumers | `cds repl`, CQL, `@cap-js/mcp` | handlers fire on every channel automatically |

The left column is why this doesn't feel bolted on: the contract (consumption views), the translation (projections), and the transports (OData, HCQL, MCP) are all CAP. The right column is part 1's "what's missing" list, crossed off. And the seam between the two is a handful of annotations.

The complete project — both apps, seed data, `requests.http`, step-by-step commits — is here: **[GitHub repo](https://github.com/mikezaschka/data-federation-demo)**.

If you build something with it, hit a gap, or disagree with a design decision — the comments below and the [GitHub issues](https://github.com/mikezaschka/cds-data/issues) are open. And if you missed the concepts behind all of this, [part 1](https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-1/ba-p/14402349) has you covered.

## Links

| Resource | URL |
|---|---|
| Demo project (this post) | https://github.com/mikezaschka/data-federation-demo |
| Part 1 of this series | https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-1/ba-p/14402349 |
| Documentation portal | https://mikezaschka.github.io/cds-data/ |
| Annotation reference | https://mikezaschka.github.io/cds-data/federation/reference/annotations |
| Pipeline Console guide | https://mikezaschka.github.io/cds-data/pipeline/guide/pipeline-console |
| `cds-data-federation` on npm | https://www.npmjs.com/package/cds-data-federation |
| `cds-data-pipeline` on npm | https://www.npmjs.com/package/cds-data-pipeline |
| `cds-caching` | https://github.com/mikezaschka/cds-caching |
| CAP Service Integration guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| Northwind OData service | https://services.odata.org/V4/Northwind/Northwind.svc |
