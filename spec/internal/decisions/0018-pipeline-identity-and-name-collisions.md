# ADR 0018 — Pipeline identity: keep short names, add a stable address

Status: Proposed
Date: 2026-09-20
Supersedes: —
Relates to: [ADR 0012 — Multi-source fan-in](0012-multi-source-into-one-entity.md), [ADR 0017 — Federation management surface](0017-federation-management-surface.md)

## Context

`Pipelines` is keyed by `name`, a single flat string:

```cds
entity Pipelines {
    key name : String;
```

All three plugins derive that name the same way, and none of them namespaces it:

| Producer | Rule | Source |
|---|---|---|
| `@federation.replicate` | `config.options.name \|\| config.entityName` | `cds-data-federation/srv/pipeline-binding.js:35` |
| `@materialize.snapshot` | `config.options.name \|\| config.entityName` | `cds-data-materialization/srv/pipeline-binding.js:31` |
| `@federation.delegate` + entity cache | `` `data-federation-cache:${cfg.entityFullName}` `` | `cds-data-federation/srv/entity-cache/cache-schema.js:141` |

`entityName` is the **last segment** of the consumption view's FQN, while the FQN itself is already carried alongside it and discarded for naming purposes:

```js
// cds-data-federation/srv/annotation-scanner.js:275
entityName: entityName.split('.').pop(),
entityFullName: entityName,
```

So `sap.capire.xflights.Flights` registers as `Flights`. Two consequences.

**Collisions are possible, including across plugins.** Two `@federation.replicate` views whose last segment matches, or a `@materialize.snapshot` on `analytics.Flights` next to a `@federation.replicate` on `sap.capire.xflights.Flights`, both claim `Flights`. Neither plugin author can see the conflict from their own code.

**They are detected, not prevented.** `addPipeline` refuses a duplicate:

```js
// cds-data-pipeline/srv/DataPipelineService.js:156
if (this.pipelines.has(name)) {
    throw new Error(`Pipeline configuration '${name}' already exists`)
}
```

Verified by adding a second `@federation.replicate` view named `Flights` under a different namespace to the xtravels demo and booting it. The application does not start:

```
[cds-data-federation] - Failed to bind @federation.replicate configs: Error: Pipeline configuration 'Flights' already exists
```

That is the correct failure mode — loud, at startup, no silent overwrite — but the message names neither colliding entity, nor which plugin registered each, nor the remedy.

The entity-cache producer shows the alternative already in use: fully qualified, collision-free by construction, and unreadable. The xtravels console lists `data-federation-cache:sap.capire.travels.showcase.FederationShowcaseService.SnapshotFlights` beside `Flights`, `Supplements` and `Customers`.

## Decision

**Keep short names as identity and display. Add the FQN as a stable address. Make the collision explain itself.**

### 1. Do not rename pipelines to FQNs

`Pipelines.name` is a published contract and a persisted key:

- `POST /pipeline/execute {"name":"Flights"}` and `Pipelines('Flights')` appear in user scripts, external schedulers (BTP Job Scheduling, Kubernetes CronJobs) and our own docs and tests.
- Tracker rows are stored under that key, so a rename orphans run history unless migrated.
- Readability is a feature of the operator surface, and FQN names demonstrably degrade it — the entity-cache name above is the evidence.

The existing escape hatch stays the remedy for a genuine clash: `@federation.replicate: { name: '...' }`, already documented in [the annotation reference](../../../docs/federation/reference/annotations.md).

### 2. Add `entityFullName` to `Pipelines`

A new optional element carrying the consumption-view FQN for pipelines derived from an annotation, written at registration alongside `baseConfig`.

`origin` cannot serve this purpose: per ADR 0012 it labels the source backend for multi-source fan-in, stamped into `target.source`, and is echoed per run. Overloading it would conflate data provenance with model provenance.

This decouples **addressing** from **naming**, which is the same principle ADR 0017 applies one layer up: `/federation` addresses an entity by FQN and resolves it to whatever its pipeline happens to be called, so the pipeline name never becomes part of federation's public contract.

It also lets the entity-cache producer take a readable name (`cache:SnapshotFlights`, or the short entity name) while keeping the FQN as the stable address — cleaning up the machine name without losing uniqueness.

### 3. Make the collision message diagnostic

The duplicate-name error should name both sides and the fix. Registration therefore has to carry enough context to say:

```
Pipeline name 'Flights' is claimed twice:
  - sap.capire.xflights.Flights   (@federation.replicate)
  - probe.other.Flights           (@federation.replicate)
Set an explicit name on one of them, e.g.
  @federation.replicate: { name: 'ProbeFlights' }
```

This requires the registering plugin to pass its own identity and the source FQN into `addPipeline`, which §2 supplies anyway.

**This is the part that actually matters.** Collisions are rare; a collision that costs an hour to diagnose from a bare `already exists` is the real defect.

## Alternatives considered

**Namespace every derived name with the FQN.** Unique by construction, and no `name` option needed. Rejected: it breaks the published contract and the persisted key for every existing consumer, and it makes the operator surface worse for the overwhelming majority of apps, which have no collision at all.

**Namespace by producing plugin** (`federation:Flights`, `materialize:Flights`). Cheaper than FQN and solves the cross-plugin case only. Rejected: it leaves same-plugin collisions unsolved, and still breaks every existing name.

**Auto-disambiguate on collision** (append a suffix). Rejected: a pipeline whose name depends on model load order is worse than a startup failure, and it would silently break scripts referring to the original name.

**Leave it entirely.** Tempting, since the failure is already loud and correct. Rejected only for the diagnosis in §3 and the addressing need in §2; the naming itself is genuinely fine.

## Consequences

- `Pipelines` gains an optional element. Existing rows have it empty; nothing reads it until ADR 0017's API does.
- `addPipeline` grows optional registration metadata (producer, source FQN). Programmatic callers that pass neither keep working and get today's message.
- Federation and materialization both pass the new metadata, so the cross-plugin case produces a message naming both plugins.
- The entity-cache rename in §2 is optional and deferrable; it is a console readability fix, not a correctness one. It *is* a name change to an existing pipeline, so it carries the same migration caveat as §1 and should ship with a release note if taken.

## Acceptance criteria (when implemented)

1. Two annotated views with the same last segment, in different namespaces, still fail at startup — with a message naming both FQNs, both producers, and the `name` option.
2. `Pipelines.entityFullName` is populated for every pipeline derived from a `@federation.*` or `@materialize.*` annotation, and empty for hand-written `addPipeline` calls that do not supply it.
3. No existing pipeline name changes as a result of this ADR alone.
4. A pipeline can be resolved by FQN without the caller knowing its name.
