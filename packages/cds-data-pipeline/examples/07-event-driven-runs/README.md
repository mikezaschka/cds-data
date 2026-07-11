# Example 07 — Event-driven pipeline runs

**What this shows:** batch delta replication **plus** CAP messaging micro-runs on the **same pipeline name** — `executeEvent` with `event.read: 'key' | 'payload'` and `event.action: 'upsert' | 'delete'`. Event runs reuse MAP/WRITE and appear in `/pipeline` with `trigger: event`, but **do not** advance the batch watermark (`Pipelines.lastSync`).

This is **not** [example 06](../06-event-hooks/) — that one layers `before` / `on` / `after` on the `PIPELINE.*` lifecycle. Here the entry point is **`execute` / `executeEvent`** with a nested **`event`** object. See [Event-driven runs](https://mikezaschka.github.io/cds-data/pipeline/guide/recipes/event-driven-runs.html).

**Source:** `LogisticsService.Shipments` at `http://localhost:4455/odata/v4/logistics/`.
**Target:** `example07.Shipments` (same consumption-view pattern as example 01).
**Pipeline name:** `Shipments`.

## Run it

```bash
bash examples/07-event-driven-runs/start.sh
```

Provider and consumer use CAP **file-based messaging** (default outbox `~/.cds-msg-box`) so emit actions on `:4455` reach the bridge on `:4107`.

- Local replica: <http://localhost:4107/odata/v4/example/Shipments>
- Pipeline Console: <http://localhost:4107/pipeline-console/>
- Management API: <http://localhost:4107/pipeline/Pipelines>

Stop with `Ctrl+C`.

## The four moving parts

1. **Consumption view** in [db/schema.cds](db/schema.cds) — same pattern as example 01.
2. **Pipeline registration** in [server.js](server.js) — entity-shape replicate, **no `schedule`** (batch runs are manual via `/pipeline/execute` for a deterministic demo).
3. **Messaging bridge** in [messaging-bridge.js](messaging-bridge.js) — `messaging.on(...)` → `executeEvent('Shipments', { event: { ... } })`.
4. **Provider emit actions** on the shared [LogisticsService](../_providers/logistics-service/) — `emitShipmentKeyTest` / `emitShipmentPayloadTest` publish test messages (topics in [`lib/event-topics.js`](../_providers/logistics-service/lib/event-topics.js)).

## Batch vs event

| | Batch (`execute`) | Event (`executeEvent`) |
|---|---|---|
| READ | Full `readStream(tracker)` via OData adapter | One batch: key fetch or synthetic payload |
| Watermark | Updates `lastSync` / `lastKey` on success | **Does not** update batch watermark (default) |
| `PipelineRuns.trigger` | `manual`, `scheduled`, `external` | `event` |
| When to use | Periodic catch-up, initial load | Notifications, single-row upserts/deletes |

## `event.read` vs run `mode`

- **`mode`** (top-level on `execute`) = batch run strategy (`delta` \| `full`).
- **`event.read`** = how a micro-run obtains rows (`key` \| `payload`). These must not be conflated.

## Watch it work

Run the `.http` files in order with the VS Code REST Client extension:

1. [http/10-batch-baseline.http](http/10-batch-baseline.http) — full refresh, note `lastSync`.
2. [http/20-event-key.http](http/20-event-key.http) — provider emits key → local row updated, `lastSync` unchanged.
3. [http/30-event-payload.http](http/30-event-payload.http) — full payload, no remote read.
4. [http/40-event-delete.http](http/40-event-delete.http) — local delete by key; batch full refresh restores.
5. [http/50-monitor.http](http/50-monitor.http) — mixed run history in the monitor.

After each provider emit, allow ~1 s for file-based messaging to deliver before querying the local table.

## Production wiring

Replace the test emit actions with your real subscription:

```javascript
const pipelines = await cds.connect.to('data-pipeline')

someService.on('shipments.updated', async (event) => {
    await pipelines.executeEvent('Shipments', {
        event: { read: 'key', action: 'upsert', keys: { ID: event.data.shipmentId } },
    })
})
```

Use Event Mesh / CloudEvents in production; file-based messaging is for local development only.

## See also

- [Example 01 — Replicate OData](../01-replicate-odata/) — batch twin of this pipeline config.
- [Example 06 — Event hooks](../06-event-hooks/) — `PIPELINE.*` lifecycle customization.
- [Recipes → Event-driven runs](../../docs/guide/recipes/event-driven-runs.md)
- [Reference → Management Service → Event hooks](../../../docs/pipeline/reference/management-service.md#event-hooks) — phase hooks vs event micro-runs.
