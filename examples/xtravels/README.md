# xtravels × cds-data-federation

SAP's [capire/xtravels](https://github.com/capire/xtravels) reference app for
the CAP [Service Integration guide](https://cap.cloud.sap/docs/guides/integration/calesi),
running with `cds-data-federation` + `cds-data-pipeline` instead of its
hand-written replication code.

xtravels consumes two remote services through consumption views, and syncs
them into local tables:

| Consumption view | Remote | Protocol here |
|---|---|---|
| `sap.capire.xflights.Flights` | xflights `FlightsService.Flights` (flattened `airline.name`, `origin.name`, ...) | HCQL |
| `sap.capire.xflights.Supplements` | xflights `FlightsService.Supplements` | HCQL |
| `sap.capire.s4.Customers` | S/4 `API_BUSINESS_PARTNER.A_BusinessPartner` (`where BusinessPartnerCategory == '1'`) | OData V4 (mocked) |

Upstream marks these views `@federated` and replicates them with ~40 lines of
custom code in `srv/data-federation.js`. In this demo, that file is deleted and
the views are annotated instead:

```cds
@federation.replicate: {
  mode: 'delta', delta: { field: 'modifiedAt' },
  schedule: 600000, // 10 minutes, same cadence as the original srv/data-federation.js
  preload: true,
}
entity Flights as projection on external.Flights { ... }
```

The rest of xtravels is unchanged: the Fiori app, the draft/status flows, the
`ReserveSeats` saga to xflights, and the live S/4 value help in
`srv/travel-service/service.js`. On top of upstream's replication, you get:

- run history and statistics
- retry
- a concurrency guard
- the Pipeline Console
- a management API for manual runs

## Run it

`xtravels/` is a git submodule (see [Tracking upstream](#tracking-upstream)), so
from the repository root:

```bash
git submodule update --init examples/xtravels/xtravels
```

```bash
npm install
```

```bash
npm run examples:start:xtravels
```

| URL | What |
|---|---|
| http://localhost:4005/travels/webapp/index.html | xtravels Fiori app (`alice` / `admin`) |
| http://localhost:4005/pipeline-console/ | Pipeline Console: the three replicate pipelines, runs, schedules |
| http://localhost:4005/pipeline/Pipelines | Management OData API |
| http://localhost:4005/showcase/ | Federation showcase: `Airlines` (plain delegate), `Airports` (delegate + response cache), `LiveFlights` (live seats next to the replica) |
| http://localhost:4006 | xflights (flight master data provider) |
| http://localhost:4008 | `HotelsService`, xtravels' bundled microservice, served over OData |
| http://localhost:4009 | S/4 Business Partner API, mocked from `s4/srv/external/data/*.csv` |

[`requests.http`](./requests.http) walks through the story: read the replicas,
change a flight in xflights, trigger a delta run, and see that only that one row
is synced.

The `federated` profile in `xtravels/package.json` binds the three remotes to
the local provider processes. Without it (for example `cd xtravels && npx cds
watch`), CAP mocks them in-process, as it does upstream. xtravels' own tests run
that way too:

```bash
cd examples/xtravels/xtravels && npx cds test
```

## Tests

Every federated entity is covered in the app itself, and on two levels —
because in-process mocking and a real remote prove different things.

```bash
cd examples/xtravels/xtravels && npx cds test
```

- **`federation-replicate.test.js` / `federation-delegate.test.js`** — remotes
  mocked in-process, upstream's own style. One describe per entity: the replica
  is really filled, the projection is applied (flattened paths, renames, static
  `where`), the app reads from it, a delta run syncs only what changed, and the
  delegate stays read-only with no local table.
- **Mashups** — the reason to federate at all: local `Travels` expanded into
  both replicas at once, filtered and ordered by replicated columns, the
  association followed back from a replica into local bookings, booking revenue
  aggregated by a replicated airline, and a delegated expand whose both sides
  live on the remote.
- **`federation-remote.test.js` / `federation-remote-v2.test.js`** — the same
  app against **xflights and the S/4 API as separate server processes**, so
  every read is an HTTP round trip: CQN over HCQL, and queries translated to
  OData V4 and V2 URLs. The queries are deliberately awkward (nested functions,
  parenthesised `or`/`and`/`not`, filters on unselected columns, ordering plus
  paging plus counting) because translation is where federation breaks. These
  need `../xflights` and `../s4` and skip themselves otherwise.

V2 matters because that is what xtravels' `[production]` profile binds for a
real S/4 — a different wire format (`d.results`, `/Date(…)/`), served locally by
`test/providers/s4-v2/`.

The plugin-side suite lives in this repo, so it runs in our CI:

```bash
npm run test -w cds-data-federation -- test/integration/xtravels
```

It boots xflights, HotelsService and the S/4 mock (V4 or V2) on free ports and
federates over HTTP. It skips itself when the submodule is not initialised.

## Layout

The four repos sit side by side, the same workspace layout as the upstream
readme's *Using Workspaces* section, and are registered as npm workspaces in the
root `package.json`, so `@capire/*` resolve locally and the plugins share the
monorepo's single `@sap/cds`.

| Folder | Upstream | Pinned at | How |
|---|---|---|---|
| `xtravels/` | [capire/xtravels](https://github.com/capire/xtravels) | `9ccb46d` + our commit | submodule → [mikezaschka/xtravels](https://github.com/mikezaschka/xtravels) branch `cds-data-federation-demo` |
| `providers/hotels/` | — | — | our launcher; serves the submodule's `HotelsService` over OData |
| `xflights/` | [capire/xflights](https://github.com/capire/xflights) | `bc4e7b4` | copy, unmodified |
| `common/` | [capire/common](https://github.com/capire/common) | `53155b3` | copy, unmodified |
| `s4/` | [capire/s4](https://github.com/capire/s4) | `83436d0` | copy, unmodified |

Only `xtravels/` is modified, so only it is tracked as a fork. Its whole diff
against upstream is one commit:

- `apis/capire/xflights.cds`, `apis/capire/s4.cds`: `@federated` becomes `@federation.replicate: { ... }`.
- `srv/data-federation.js`, `srv/server.js`: deleted. The plugin replaces them.
- `package.json`: adds `cds-data-federation` / `cds-data-pipeline` / `cds-caching`, the `data-pipeline` management console, and the `[federated]` profile.
- `srv/showcase/`: a `FederationShowcaseService` for live-delegation scenarios — additive, so `TravelService` and the Fiori app are untouched.

The other three are plain copies (without `.git` / `.github`); refresh one by
re-copying it from upstream at a newer commit and updating the table above.

## Tracking upstream

`xtravels/` is a submodule of our fork, whose `cds-data-federation-demo` branch
is kept as a thin patch on top of upstream `main`. To pull in SAP's latest:

```bash
cd examples/xtravels/xtravels
git fetch upstream && git rebase upstream/main && git push --force-with-lease
```

The submodule clone only has `origin` (the fork), so add the upstream remote
once: `git remote add upstream https://github.com/capire/xtravels.git`.

Then record the new pointer in this repo, run the demo, and check that the
annotations still line up with whatever changed upstream:

```bash
git -C ../../.. add examples/xtravels/xtravels
```

`Customers` uses `mode: 'full'` (728 rows). Delta via `LastChangeDate` +
`LastChangeTime` (`datetime-fields`) cannot be combined with the view's static
`where` yet; see [OData source](../../docs/pipeline/guide/sources/odata.md).

The upstream code is licensed under Apache-2.0 by SAP SE; see the `LICENSE` file
in each folder.
