# Pipeline Console dev backend

Contributor-only CAP app that registers **six pipelines** against shared mock providers so the live TypeScript Pipeline Console has a rich backend to develop against.

The bundled `start.sh` seeds **1000 shipments** in LogisticsService (`LOGISTICS_SHIPMENT_COUNT=1000`) so replicate runs exercise multi-batch paging (batch size 250 on `Shipments`).

Not part of the seven feature examples — do not use this for doc walkthroughs.

## Pipelines

| Name | Source | Target | Notes |
|---|---|---|---|
| `Shipments` | LogisticsService OData | primary `db` | Scheduled delta replicate |
| `Carriers` | LogisticsService OData | primary `db` | Full refresh, same service group |
| `FxRates` | FXService REST | primary `db` | Second service in landscape graph |
| `ShipmentArchive` | LogisticsService OData | `ArchiveDb` SQLite | Secondary DB move (no federation) |
| `CarriersToReporting` | LogisticsService OData | `ReportingService` (custom adapter) | `ReportingTargetAdapter` — **target not inspectable** |
| `ShipmentsWithHooks` | LogisticsService OData | primary `db` | Custom `PIPELINE.*` hooks |

`ShipmentArchive` uses `target.service: 'ArchiveDb'` so the landscape graph shows a separate database group. Archive rows are queryable at `/odata/v4/archive/ShipmentArchive` and in the Pipeline Console data inspector (target side).

`CarriersToReporting` uses `target.adapter: ReportingTargetAdapter` to forward batches to `/reporting` via CAP events. The data inspector shows the limited-support banner on the **target** side (no CQN preview). After a run, rows are readable at `/reporting/CarrierFacts`.

## Run

```bash
# Terminal 1 — this backend (:4100)
bash examples/_dev/pipeline-console/start.sh
# or from packages/cds-data-pipeline: npm run dev:console-backend

# Terminal 2 — live TypeScript UI (:8090)
cd packages/cds-data-pipeline && npm run dev:pipeline-console
```

Open **http://localhost:8090/index.html**. The UI5 dev server proxies `/pipeline` to this app.

Built console reuse is **disabled** (`management.reuse.console: false`) so you always hit the transpiled TypeScript sources during development.
