# Vision

**cds-data-pipeline** exists so CAP development teams can move data between services the same way they already build services: declaratively, with standard hooks, and without reinventing paging, deltas, retries, and observability in every project.

---

## North star

Every CAP application that needs a local copy, a materialized view, or a push to another service should be able to declare that intent in CDS and a few lines of configuration — then run it on a schedule or on demand, with full traceability, from day one.

The plugin is the **idiomatic CAP building block** for in-process data movement: not a separate runtime, not a proprietary DSL, and not a replacement for enterprise integration platforms — but the piece that belongs *inside* a CAP app when replication is an application concern.

---

## The problem we solve

CAP makes federation and service-to-service reads straightforward. Many real apps still need to **move** data: replicate remote entities locally, persist query results for reporting, fan in the same logical entity from several backends, or push rows to a remote OData API. Capire and community examples show the pattern; in practice every team copies the same loop:

- Page through a remote source
- Track what changed since the last run
- Map and upsert into a local or remote target
- Handle failures, concurrency, and operations visibility

That loop is boring, error-prone, and duplicated. **cds-data-pipeline** extracts it into a reusable plugin so teams ship business logic instead of plumbing.

---

## Where we sit in the landscape


| Layer                                                    | Role                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Ad-hoc scripts** (`cds.spawn`, one-off jobs)           | Fine for experiments; poor for operations, deltas, and consistency across teams.                                    |
| **cds-data-pipeline**                                    | Scheduled, traceable **READ → MAP → WRITE** inside one CAP app — adapters, delta modes, management API, monitor UI. |
| **SAP Integration Suite, Datasphere, HANA SDI / SLT, …** | Cross-system, cross-landscape, out-of-process integration — outside our scope.                                      |


We deliberately occupy the **application layer**: `cds.connect.to`, destinations, consumption views, and CAP's event model. We do not compete with corporate ETL or database replication products; we make CAP apps self-sufficient for the data movement they own.

---

## Design principles

These principles guide what we build and what we refuse to add.

1. **Idiomatic CAP** — Pipelines use `cds` services, `cds.spawn` / queued scheduling, consumption views, and the standard `before` / `on` / `after` hook API. No parallel hook system; lifecycle events are `PIPELINE.START` → `READ` → `MAP` → `WRITE` → `DONE`.
2. **Behavior from config shape** — Replicate vs materialize vs move-to-service is inferred from how you configure source and target, not from a pile of mode flags. Defaults should match what most configs need; invalid combinations fail at registration with clear errors.
3. **One source, one target, linear flow** — Each pipeline is easy to reason about. Fan-in is modeled as sibling pipelines into one table (with origin labeling), not as a hidden multi-source graph inside the engine.
4. **Pluggable edges, fixed core** — OData, REST, CQN, and custom adapters on the read side; DB, OData, and custom adapters on the write side. The phase machine and tracker stay stable.
5. **Observable by default** — Every run is recorded; statistics and history are queryable at `/pipeline` and in the Pipeline Monitor. Operations should not depend on log spelunking.
6. **Consumer owns security** — Authorization for who may trigger or configure pipelines stays in the host application. The plugin does not impose global `@requires` on the management surface.
7. **Minimal magic, maximal clarity** — Sensible defaults (batch size, schedule, delta vs full for entity vs query shape) with explicit overrides. Retry, concurrency guards, and watermark behavior should be predictable and documented.

---

## What success looks like

- A developer adds `cds-data-pipeline`, defines a consumption view (or target entity), calls `addPipeline(...)`, and has a working scheduled replication with delta and a visible run history — without writing paging or watermark code.
- Operations can see pipeline status, last sync, run history, and errors through OData and the monitor UI, and can trigger or flush runs through the management API.
- Advanced teams extend behavior through event hooks and custom adapters without forking the engine.
- The same patterns work across replicate, materialize, move-to-service, and multi-source fan-in recipes documented in the project — one mental model, different config shapes.

---

## Out of scope (by design)

- Cross-landscape, non-CAP, or heavy transformation / orchestration products
- Runtime DDL or HDI deploy ownership (consumers deploy schema)
- Replacing CAP Data Federation for live reads — pipelines complement federation when a **local copy** or **persisted snapshot** is the right trade-off
- Unauthenticated or weakly secured public ingestion endpoints without a deliberate auth story

When a requirement clearly belongs in Integration Suite or the database tier, we point there rather than grow the plugin into a mini-ESB.

---

## Direction

The project is a **work in progress** toward a stable release: APIs, tracker schema, and docs may still evolve, but the vision is stable — **make scheduled, traceable data movement a first-class CAP capability**.

Near-term evolution stays aligned with that vision: stronger event-driven ingestion alongside batch runs (same phase machine and observability), richer adapter coverage, and tighter integration with CDS-first configuration (e.g. federation-style wiring) — always without sacrificing the simplicity of one pipeline, one line of data flow, and one place to see what happened.

---

## Further reading

- [README.md](README.md) — overview and quick start  
- [Documentation](https://mikezaschka.github.io/cds-data/pipeline/) — guides, concepts, recipes, reference  
- [docs/guide/introduction.md](docs/guide/introduction.md) — what it is, why it exists, scope  
- [decisions/](decisions/) — architecture decisions that refine the vision in code

