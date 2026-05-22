# Materialize projection CSN shape (spike)

**Date:** 2026-05-22
**Status:** Reference for `cds-data-materialization` compiler

## Valid CDS syntax

```cds
entity DailyRevenue as projection on Orders {
  key customerId,
      sum(amount)     as totalAmount  : Decimal(15, 2),
      count(*)        as orderCount   : Integer,
      max(modifiedAt) as lastActivity : Timestamp
}
group by customerId;
```

`group by` is a separate clause after the projection body (not inside `{ }`).

## CSN (`entityDef.projection`)

| Field | Role |
|---|---|
| `from.ref` | Source entity ref (e.g. `["spike.Orders"]` or `["Orders"]`) |
| `columns[]` | Select list: `{ ref, key? }`, `{ func, args, as, cast? }` |
| `groupBy[]` | `{ ref: ['customerId'] }` entries |
| `where` | Optional static filter (same as federation consumption views) |

`count(*)` appears as `args: ["*"]` in CSN; the compiler maps to `{ val: 1 }` for the CQN builder.

## Compiler output

Non-async closure:

```javascript
() => SELECT.from('consumer.SourceOrders')
  .columns(/* from projection.columns */)
  .groupBy(/* from projection.groupBy */)
  // .where(/* static where if present */)
```

Service dispatch uses `source.kind: 'cqn'` and `source.service` from annotation (`db` for local SQLite tests).
