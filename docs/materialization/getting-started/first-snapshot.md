# First snapshot

## Schema

```cds
using from 'cds-data-pipeline/db';

namespace consumer;

entity SourceOrders {
  key ID         : String(36);
      customerId : String(10);
      amount     : Decimal(10, 2);
      status     : String(20);
      modifiedAt : Timestamp;
}

@materialize.snapshot: {
  source : { service: 'db' }
}
entity DailyCustomerRevenue as projection on SourceOrders {
  key customerId,
      sum(amount)     as totalAmount  : Decimal(15, 2),
      count(*)        as orderCount   : Integer,
      max(modifiedAt) as lastActivity : Timestamp
}
group by customerId;
```

## What happens at runtime

1. On `loaded`, the plugin scans `@materialize.snapshot`, validates the projection, and sets `@cds.persistence.table` on the target.
2. On `served`, it calls `DataPipelineService.addPipeline` with a compiled `source.query` closure.
3. On schedule or manual `execute`, the engine truncates the target and inserts aggregate rows.

Trigger a run manually:

```js
const pipelines = await cds.connect.to('data-pipeline')
await pipelines.execute('DailyCustomerRevenue', { mode: 'full', trigger: 'manual' })
```

Runs appear in the pipeline tracker (`plugin_data_pipeline_Pipelines`) and via the [management API](/pipeline/reference/management-service).

## CDS syntax notes

- Put `group by` **after** the projection closing `}`, not inside the column list.
- Use `source.service` when projecting on a namespace entity (`SourceOrders`) rather than `Service.Entity`.
- `source.service` is the **`cds.requires` key** that executes the query (`db`). `SELECT.from` uses the **CSN entity** (e.g. `consumer.SourceOrders`).

## Optional tracking aspect

```cds
using { plugin.data_materialization as materialization } from 'cds-data-materialization';

entity DailyCustomerRevenue : materialization.materialized {
  /* projection as above */
}
```

Adds `lastMaterializedAt` and `lastMaterializedBy` on insert.
