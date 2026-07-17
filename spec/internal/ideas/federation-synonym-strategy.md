# Synonym / alias strategy under `@federation.*` (`@federation.alias`)

**Status:** Exploring  
**Created:** 2026-07-16  
**Promoted to:**  
**Related:** [research note](../research/cds-federation-synonyms-analysis.md), terminology.md, comparison.md, ADR 0005, [cap-js/cds-federation-synonyms](https://github.com/cap-js/cds-federation-synonyms), [reCAP 2026 workshop](https://github.com/SAP-samples/recap2026-cap-level-data-federation)

## Trigger

SAP published an experimental HANA synonym federation plugin and a reCAP 2026 workshop that treats service-level replication and synonym-based federation as peer CAP Data Federation paths. Question: does this belong as a new strategy next to delegate/replicate? **Working name: `@federation.alias`** (synonym-based / DB-layer — "alias" avoids leaking the HANA artifact name and generalizes to SDA/virtual-table targets). See research §11 for the full annotation design, the SDA explainer, and the Ex4 (BDC Data Product) walkthrough.

## Non-goals

- Reimplementing HDI `.hdbsynonym` / `.hdbgrants` generation inside `cds-data-federation`
- Making synonyms work as a real cross-schema feature on SQLite
- Owning BDC remote-source / grantor / PSE setup

## Options

See research §9 — Docs-only peer | Thin `@federation.alias` bridge | Deep reimplementation | Separate `cds-data-federation-hana` package. No winner yet.

## Open questions

See research §10 (CAP promotion of `@data.product`, HANA CI cost, BDC decision matrix, unified console).
