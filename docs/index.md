---
layout: home
title: cds-data CAP plugins
titleTemplate: false
sidebar: false
aside: false
outline: false
lastUpdated: false

hero:
  name: cds-data CAP plugins
  tagline: Composable SAP CAP plugins — federation for remote services, a shared pipeline engine, and materialization for local snapshots.
  actions:
    - theme: brand
      text: cds-data-federation
      link: /federation/
    - theme: alt
      text: cds-data-materialization
      link: /materialization/
    - theme: alt
      text: cds-data-pipeline
      link: /pipeline/
---

<PackageOverview />

## Architecture

Three npm packages compose in one CAP app. **cds-data-federation** is the usual entry point when integrating remote services; **cds-data-pipeline** is the engine underneath for scheduled runs; **cds-data-materialization** covers local aggregate snapshots.

<ArchitectureDiagram />

**Delegate** forwards reads (and optional writes) to the remote at query time. **Replicate** and **snapshot** register scheduled pipelines that move data through the engine into your database. Federation optionally layers [cds-caching](https://github.com/mikezaschka/cds-caching) on delegate or replicate; federation and materialization both peer-require the pipeline package.

New to the suite? Start with **[Concepts](/concepts/)** — the shared [terminology](/concepts/terminology), [architecture](/concepts/architecture), and how the three plugins fit together.

## Documentation

| Package | What it is |
|---------|------------|
| **[cds-data-federation](/federation/)** | `@federation.delegate` and `@federation.replicate` on consumption views; composes the pipeline for replicate. |
| **[cds-data-materialization](/materialization/)** <Badge type="warning" text="Experimental" /> | `@materialize.snapshot` on `group by` projections; composes the pipeline for query-shape snapshots. **Not yet released.** |
| **[cds-data-pipeline](/pipeline/)** | Application-layer `READ → MAP → WRITE` engine — tracker, retry, management API, event hooks. |

Install from npm: `cds-data-federation`, `cds-data-pipeline`. `cds-data-materialization` is experimental and not yet published.

## CDS 10 & AI integration

These plugins track CAP's June 2026 (**cds 10**) release. All three install on **both CDS 9 and CDS 10** (`@sap/cds >= 9`). Two new CAP capabilities compose naturally with them:

- **HCQL** (CQL over HTTP) — for CAP-to-CAP integration, CAP's remote client auto-selects HCQL over OData. `@federation.delegate` and `@federation.replicate` benefit automatically, with no annotation change.
- **MCP** (`@cap-js/mcp`) — expose federated entities to AI agents through the Model Context Protocol. Because federation handlers run on the application service, MCP `query` calls flow through the same delegate/replicate path as OData.

See **[CDS 10, HCQL and MCP](/concepts/cds-10)** for the full picture, or the deep dives in [Service query execution](/federation/concepts/service-query-execution#cds-10-hcql-and-mcp) and [MCP integration](/federation/integration/mcp).

## Blog posts

A two-part series on SAP Community covers the concepts and a hands-on walkthrough:

- [The Full Picture: Federating, Replicating, and Caching Remote Data in CAP — Part 1](https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-1/ba-p/14402349) — terminology, what CAP provides, and how the plugins close the gaps
- [The Full Picture: Federating, Replicating, and Caching Remote Data in CAP — Part 2: Hands-On](https://community.sap.com/t5/technology-blog-posts-by-members/federating-replicating-and-caching-remote-data-in-cap-part-2/ba-p/14442604) — Sales Cockpit walkthrough (delegate, cache, replicate)
