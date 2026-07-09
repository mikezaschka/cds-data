---
layout: home
title: cds-data-materialization
titleTemplate: false
sidebar: false
aside: false
outline: false
lastUpdated: false

hero:
  name: cds-data-materialization
  tagline: Declarative @materialize.snapshot for scheduled aggregate snapshots on local data.
  actions:
    - theme: brand
      text: Get started
      link: /materialization/getting-started/
    - theme: alt
      text: Annotations
      link: /materialization/reference/annotations
    - theme: alt
      text: Features
      link: /materialization/reference/features

features:
  - icon: 🚀
    title: Getting started
    details: Install, declare a group-by projection, and run your first snapshot pipeline.
    link: /materialization/getting-started/
  - icon: 📐
    title: Concepts
    details: Stage remote data with replicate, then materialize rollups locally.
    link: /materialization/concepts/stage-then-aggregate
  - icon: 📖
    title: Reference
    details: Annotation options, validation rules, and feature matrix.
    link: /materialization/reference/annotations
  - icon: ⚙️
    title: Pipeline engine
    details: Query-shape runs, tracker, and management API live in cds-data-pipeline.
    link: /pipeline/guide/recipes/built-in-materialize
---

::: warning Experimental — not yet released
`cds-data-materialization` is **experimental** and **not yet published to npm**. The `@materialize.snapshot` annotation surface and validation rules may still change without notice, and there is no release channel yet. Use it from the monorepo workspace for evaluation only. Track progress in the [feature matrix](reference/features.md).
:::

## Install

```bash
npm add cds-data-materialization cds-data-pipeline
```

::: info
The npm command above is shown for completeness. Until the first release, install from the monorepo workspace rather than npm.
:::

The plugin auto-activates via `cds-plugin.js`. Peer: **`cds-data-pipeline`** (required).
