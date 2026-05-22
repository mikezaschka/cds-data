---
layout: home
title: cds-data-federation
titleTemplate: false
sidebar: false
aside: false
outline: false
lastUpdated: false

hero:
  name: cds-data-federation
  tagline: Live delegation and scheduled replication on consumption views — declarative, annotation-driven.
  actions:
    - theme: brand
      text: Get started
      link: /federation/getting-started/
    - theme: alt
      text: Annotations
      link: /federation/reference/annotations
    - theme: alt
      text: Features
      link: /federation/reference/features

features:
  - icon: 🚀
    title: Getting started
    details: Installation, first delegation, first replication, and common patterns.
    link: /federation/getting-started/
  - icon: 📐
    title: Concepts
    details: Consumption views, cross-service expand and navigation, terminology.
    link: /federation/concepts/
  - icon: 📖
    title: Reference
    details: Annotation reference, feature matrix, and comparison with CAP built-ins.
    link: /federation/reference/features
  - icon: 💾
    title: Caching
    details: Response cache (cds-caching) or entity-level SQLite snapshots on delegate.
    link: /federation/integration/caching
---

```cds
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

@federation.delegate
entity Partners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};

@federation.replicate: { schedule: 600000 }
entity ReplicatedPartners as projection on remote.A_BusinessPartner {
    BusinessPartner         as ID,
    BusinessPartnerFullName as name,
    BusinessPartnerCategory as category
};
```

**Delegate** forwards reads (and optional writes) to the remote at request time. **Replicate** runs scheduled sync into your local database via [cds-data-pipeline](/pipeline/). Optional caching: **`cache.strategy: 'response'`** ([cds-caching](https://github.com/mikezaschka/cds-caching)) or **`cache.strategy: 'entity'`** (SQLite snapshot + pipeline on demand).

Install: `npm add cds-data-federation cds-data-pipeline`
