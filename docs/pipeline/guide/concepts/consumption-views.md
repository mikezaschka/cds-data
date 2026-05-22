# Consumption views

A **consumption view** is a CDS projection over a remote (imported) entity that declares the local shape you want to work with — column selection, renames, filters, computed fields — without saying *how* that data will be sourced. It is the idiomatic CAP pattern for CAP-level data federation and the recommended way to model `cds-data-pipeline` targets that mirror a remote entity.

> *"Stay intentional — what, not how." Tag consumption views with `@federated` (or, in this plugin's terms, point an `addPipeline(...)` at them) to express your intent to have that data federated, i.e. in close access locally.*
> — [CAP-level Data Federation guide](https://cap.cloud.sap/docs/guides/integration/data-federation#federated-consumption-views)

## Why they matter for pipelines

Most `replicate` pipelines copy a remote entity into a local table. The natural question is: *what shape should the local table have?* A consumption view answers it in one place:

```cds
using { S4 } from '../srv/external/API_BUSINESS_PARTNER';

@cds.persistence.table
entity Customers as projection on S4.A_BusinessPartner {
    BusinessPartner as ID,
    PersonFullName  as Name,
    LastChangeDate  as modifiedAt,
} where BusinessPartnerCategory = '1'; // 1 = Person
```

That single declaration does four jobs:

1. **Local persistence.** `@cds.persistence.table` tells CAP to materialize the projection as a local table rather than resolving it through the remote service at query time.
2. **Target schema.** The projected fields (`ID`, `Name`, `modifiedAt`) become the columns of the local table, so the pipeline's target entity is already defined.
3. **Column restriction.** Only the listed fields are pulled from the remote — the pipeline uses `SELECT.from(source)` against the remote service, and CAP translates the projection's column list into `$select`.
4. **Rename mapping.** The aliases (`BusinessPartner as ID`, `PersonFullName as Name`, …) are the source-to-target rename map. At registration time, if you **omit** `viewMapping`, the engine **infers** `projectedColumns`, `remoteToLocal`, and `localToRemote` from the target entity's CDS projection (the same rules as `cds-data-federation`'s scanner). The built-in `PIPELINE.MAP_BATCH` handler still applies `remoteToLocal` on each batch. A **static** `where` on the projection is merged into the READ query for OData and CQN sources (not combined automatically with OData `delta.mode: 'datetime-fields'` string filters — use `timestamp` / `key` delta for full parity).

When the target is this consumption view, a minimal pipeline is enough:

```javascript
await pipelines.addPipeline({
    name: 'Customers',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.Customers' },
    delta: { mode: 'timestamp', field: 'LastChangeDate' },
    schedule: 600000,
});
```

`delta.field` must remain the **remote** element name (`LastChangeDate` here), not the local alias (`modifiedAt`).

You can still pass **`viewMapping` explicitly** if you prefer it in code, or to override inference for edge cases:

```javascript
await pipelines.addPipeline({
    name: 'Customers',
    source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
    target: { entity: 'db.Customers' },
    viewMapping: {
        isWildcard: false,
        projectedColumns: ['BusinessPartner', 'PersonFullName', 'LastChangeDate'],
        remoteToLocal: {
            BusinessPartner: 'ID',
            PersonFullName:  'Name',
            LastChangeDate:  'modifiedAt',
        },
    },
    delta: { mode: 'timestamp', field: 'LastChangeDate' },
    schedule: 600000,
});
```

If the target is **not** a projection (plain table) and you omit `viewMapping`, the default `PIPELINE.MAP_BATCH` handler copies `sourceRecords` unchanged — remote and local element names must match, or you need a custom `PIPELINE.MAP_BATCH` hook.

Consumption views give you the declarative option — **say what the local shape should be, once, in CDS**, and let the plugin infer mapping and apply it at runtime.

## Where consumption views fit the plugin entry points

| Entry point | Consumption view role |
|---|---|
| [Built-in replicate → local DB target](../recipes/built-in-replicate.md) | The common case. The view is the target table; the pipeline pulls the remote entity into it on a schedule. |
| [Built-in materialize](../recipes/built-in-materialize.md) | The target is typically a plain `@cds.persistence.table` because the shape is driven by a SELECT CQN closure (`source.query`), not by a projection. A consumption view can still define the schema if you prefer — the `source.query` supplies the values. |
| [Built-in replicate → remote OData target](../recipes/built-in-replicate.md#to-a-remote-odata-target) / [Custom target adapter](../recipes/custom-target-adapter.md) / [Event hooks](../recipes/event-hooks.md) | The target lives on a non-db service, so there is no local table to model. Consumption views do not apply directly. |

## See also

- [CAP-level Data Federation](https://cap.cloud.sap/docs/guides/integration/data-federation) — the canonical capire guide on consumption views and federated entities.
- [CAP-level Service Integration](https://cap.cloud.sap/docs/guides/integration/service-integration) — the preliminary capire guide, covering *Providing & Exporting APIs*, *Importing APIs*, and *Consumption Views*.
- [Recipes → Built-in replicate](../recipes/built-in-replicate.md) — worked example using a consumption-view target.
- [Sources → OData V2 / V4](../sources/odata.md) — how the OData adapter applies the projection against the remote service.
