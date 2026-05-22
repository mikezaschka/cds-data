# Sales Intelligence Workbench — backlog

The Phase 1 OData surface, `.http` scenarios, replications, and cache demo are
in. The Fiori Elements tiles + launchpad are the remaining deliverable.

## Phase 1 MVP — shipped

Five tiles on a sandbox launchpad. Open http://localhost:4005/launchpage.html.

- [x] **Customer Notes** — List Report over local `CustomerNotes` (My Work)
- [x] **Customers** — List Report over delegated `Customers` (Master Data)
- [x] **Customer 360** — Object Page over `Customers` with facets for notes + tasks + risk (Intelligence). Reuses the `customers` app — the launchpad tile frames it as a 360° view.
- [x] **Sales Analytics** — ALP over replicated `SalesOrders` with Chart + `$apply/groupby` (Intelligence)
- [x] **Pipeline Monitor** — List Report over plugin's `DataPipelineManagementService.Pipelines` (Admin)
- [x] Sandbox launchpad with four groups (My Work / Master Data / Intelligence / Admin)
- [x] `workbench/README.md` — narrative walkthrough of which strategy each entity uses and why

## Phase 2 — full tile catalogue

### My Work
- [ ] Follow-Up Tasks (multi-association local entity)
- [ ] Customer Risk Board (governance)
- [ ] Shipment Alerts (cross-service expand: local → remote across a local CAP provider)

### Master Data
- [ ] Orders (delegate list)
- [ ] Products (V2 delegate + renames visible in a Smart Table)
- [ ] Categories (replicated reference data)
- [ ] Shipments (local-CAP delegate)
- [ ] Carriers (visible cache effect in the UI)
- [ ] FX Rates (replicated REST data as a list)

### Intelligence
- [ ] Order Tracker (Object Page mashup — order + Order_Details + shipment + FX conversion)
- [ ] Pipeline Insights (ALP over `PipelineRuns`)

## Out of scope for this example

Deliberately parked to keep the example small — all covered in
[`test/consumer/`](../../../test/consumer/):

- CUD delegation (write flags, 405 rejection handlers)
- Composite-key associations
- Lambda filters (`any()` / `all()`)
- Cross-service navigation (local → remote and remote → local patterns)
- `$search` forwarding
