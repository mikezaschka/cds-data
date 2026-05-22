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

## Documentation

| Package | What it is |
|---------|------------|
| **[cds-data-federation](/federation/)** | `@federation.delegate` and `@federation.replicate` on consumption views; composes the pipeline for replicate. |
| **[cds-data-materialization](/materialization/)** | `@materialize.snapshot` on `group by` projections; composes the pipeline for query-shape snapshots. |
| **[cds-data-pipeline](/pipeline/)** | Application-layer `READ → MAP → WRITE` engine — tracker, retry, management API, event hooks. |

Install from npm: `cds-data-federation`, `cds-data-pipeline`, `cds-data-materialization`.
