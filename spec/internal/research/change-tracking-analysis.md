# Change Tracking Analysis: @cap-js/change-tracking

This document analyzes the [`@cap-js/change-tracking`](https://github.com/cap-js/change-tracking) plugin, whether it can add value to cds-data-federation's delegate or replicate strategies, and where it genuinely complements the plugin versus where it would mislead users.

This is **exploratory research**, not a design decision. No code or documentation surface in the plugin reacts to change-tracking today, and this analysis does not commit the plugin to any integration path.

---

## What @cap-js/change-tracking Is

`@cap-js/change-tracking` is a CDS plugin published by SAP under the `cap-js` org that captures, stores, and surfaces change records for modelled entities. With v2.0 (beta as of 2026-04) the implementation was rewritten to track changes via **database triggers** rather than application-layer handlers, removing the prior performance penalty on larger projects.

| Aspect | Detail |
|---|---|
| **Activation** | `npm add @cap-js/change-tracking` plus `@changelog` annotations on entities/elements in a separate `db/change-tracking.cds` file (separation-of-concerns convention). |
| **Mechanism** | v2 installs database triggers on tracked tables. Fires on every CREATE / UPDATE / DELETE at the DB layer — captures changes made via unions, joined views, direct SQL, etc. |
| **Supported databases** | HANA Cloud, SQLite, PostgreSQL, H2. |
| **Storage** | Changes persisted into `sap.changelog.Changes` with columns for `entity`, `attribute`, `valueDataType`, `valueChangedFrom`, `valueChangedTo`, `entityKey`, `parentKey`, `parentObjectID`, etc. |
| **UI surface** | Auto-generates `sap.changelog.ChangeView` and injects a `Change History` facet into Fiori Object Pages of tracked entities. |
| **Multi-tenancy** | Requires `@sap/cds >= 8.6` and `mtx >= 2.5`. Plugin must also be added to the MTX sidecar's `package.json`. |
| **Human-readable output** | Annotations: `@title` / `@Common.Label` for type/field names, `@changelog: [path]` at entity level for Object ID, `@changelog: [path...]` at element level for resolved values, expression-based labels (`@changelog: (expr)`), localized value labels. |
| **PII handling** | Fields annotated `@PersonalData` are explicitly **not** tracked (to prevent audit-log circumvention). Datetime fields with `@Common.Timezone` carry their timezone into the log. |
| **Composition semantics** | For compositions-of-one, composition entries use the child entity's `@changelog` for Object ID (falls back to parent); for compositions-of-many, always the parent's `@changelog`. Customizable via path or expression on the composition element. |
| **Selective tracking** | Global `disableCreateTracking` / `disableUpdateTracking` / `disableDeleteTracking` config flags. |
| **Retention** | Changelog of a record is deleted when the record is deleted. Opt-in `preserveDeletes: true` preserves the log but transfers full responsibility for a retention strategy to the application. |
| **Hierarchy depth** | `maxDisplayHierarchyDepth` (default 3) bounds how deep the UI walks compositions. Increasing it has a performance cost. |
| **Opt-out points** | `@changelog.disable_assoc` suppresses the auto-generated association to `changes` (and thus the UI facet) when the association does not make sense (e.g. on `UNION`s). `@Capabilities.NavigationRestrictions.RestrictedProperties` with `Readable: false` on `changes` achieves the same for the UI only. |

---

## Intersection with Federation Strategies

The core constraint of v2's trigger-based implementation: **a local database table must exist for triggers to be installed on.** This is the single hard gate that determines whether the plugin can apply at all to a federation scenario.

| Plugin entity type | Local table? | Change-tracking applicable? |
|---|---|---|
| `@federation.delegate` (read-only) | No (`@cds.persistence.skip` by construction) | No — nothing to trigger on |
| `@federation.delegate` (writable CUD via `writable`/`create`/`update`/`delete`) | No — writes go through `remote.run(req.query)` | No — the change lands in the remote DB, which the local change-tracking plugin cannot see |
| `@federation.replicate` | Yes — annotation scanner sets `@cds.persistence.table: true` and `@cds.persistence.skip: false` | Yes, technically |
| Local enrichment entities (`Reviews`, `Bookmarks`, `LightBookmarks`, `ProductCategories`, etc.) | Yes | Yes — works with zero plugin integration |

So delegate entities are structurally out of scope. The only case worth analyzing is **replicated entities**, plus the observation that local enrichment entities around federation are already a natural fit and need no federation-plugin changes at all.

---

## Applying Change-Tracking to Replicated Entities

Suppose a developer adds `@changelog` on fields of `ReplicatedCustomers` (our wildcard-projection test entity) or `ReplicatedProducts` (renamed fields). The DB triggers installed by change-tracking fire on every row written by `DataReplication._defaultWriteHandler` in `srv/lib/DataReplication.js`, which today executes:

```js
await db.run(UPSERT.into(targetEntity).entries(records))
```

The resulting behavior has several problems that are fundamental rather than incidental.

### Problem 1 — Attribution mismatch

`sap.changelog.Changes.createdBy` records the CAP user running the write. For replication, this is the **technical user** executing the scheduled job (`cds.spawn` in `DataPipelineService._scheduleJob`), not the user on the source system who actually made the change. The audit trail therefore claims that every source change was authored by the replication service itself, which is the opposite of what an audit trail is supposed to show.

### Problem 2 — Noise on full-sync

`DataReplication._fullSync()` does `DELETE.from(targetEntity)` followed by the delta pipeline — re-UPSERTing every record. With change-tracking enabled:

- The DELETE triggers N `delete` changelog entries (all attributed to the replication user, all at T+0).
- Every subsequent UPSERT re-creates the record, triggering N `create` changelog entries.
- Default behavior (`preserveDeletes: false`) then deletes the just-created "delete" log entries because their associated record no longer exists after the DELETE — yet the inserts from the UPSERT survive.

The result is a changelog that looks like a wholesale recreation at every full sync, with none of the prior history preserved.

### Problem 3 — Noise on delta-sync

Delta-sync writes happen in a single transaction per batch (`DataReplication._deltaSync` dispatches one `PIPELINE.WRITE` per batch). All N rows in a batch appear in the Fiori Change History facet as N simultaneous entries at identical timestamps by the same technical user. This visually resembles a single bulk edit — a consumer has no way to distinguish "the source system was edited" from "a replication run just happened."

### Problem 4 — Performance cost

DB triggers on every UPSERT against a large replicated table add per-row overhead to every batch. For high-volume replications (the scenario replicate is actually chosen for) this conflicts with the plugin's performance posture. Change-tracking's own README warns that increasing `maxDisplayHierarchyDepth` has a performance cost; trigger overhead on hot-path UPSERTs is a similar concern we would inherit without mitigation.

### Problem 5 — Scope mismatch

Change-tracking answers the question **"who changed this row locally?"** Replication needs to answer a different question: **"what changed on the remote between runs?"** These are structurally distinct:

| Question | Right tool |
|---|---|
| Who changed this row locally? | `@cap-js/change-tracking` |
| What changed on the remote between runs? | Replication-native per-run diff |
| What fields were edited in this user transaction? | `@cap-js/change-tracking` |
| Which source records did the last sync create / update / delete? | Replication-native per-run diff |

Using change-tracking to answer the replication question produces data that looks like an answer but is attributed to the wrong actor, lacks the concept of a "run," and is fragile under full-sync semantics.

---

## Where Change-Tracking Genuinely Fits

Despite the mismatch with replicated tables, change-tracking is the right tool for a narrow and important case in a federation-enabled application: **user edits on local enrichment entities.**

The plugin's test consumer and example apps contain several such entities: `Reviews`, `Bookmarks`, `LightBookmarks`, `AddressNotes`, `ProductCategories`, `InventoryReports`, and in `examples/consumer` the movie-themed `Watchlists`, `Reviews`, `Bookmarks`. These hold locally-authored data that associates to federated entities. User edits on these entities benefit from change-tracking in exactly the way the plugin intends — triggers fire, the acting user is captured, the Fiori Change History facet appears on Object Pages.

No plugin integration is required for this. `@cap-js/change-tracking` is orthogonal here. The federation plugin should simply not interfere.

### Expected compatibility matrix

| Scenario | Expected behavior | Notes |
|---|---|---|
| `@changelog` on local enrichment entity | Works out of the box | Triggers fire, user is captured correctly, Fiori facet appears |
| `@changelog` on `@federation.delegate` entity (read-only) | Annotation has no effect | No local table → no triggers installed |
| `@changelog` on `@federation.delegate` entity (writable) | Annotation has no effect | CUD forwards to remote via `remote.run(req.query)`, never writes locally |
| `@changelog` on `@federation.replicate` entity | Triggers fire on every UPSERT | Produces misleading audit (see problems above) |
| `@changelog` on local entity with association to a federated entity | Local edits tracked | Federated side is not tracked (has no local table) — that's expected |

The third and fourth rows are the footguns. A user who naively adds `@changelog` to a delegate or replicate entity expecting "audit trail" will get either silent no-op (delegate) or a log that attributes every source change to the replication service (replicate).

---

## Better Answers to the Replication Audit Question

If the underlying goal is "what did my last sync actually change?", the plugin already has most of the pieces.

- `plugin.data_federation.ReplicationRuns` in `index.cds` tracks per-run metadata (start/end time, trigger, mode, aggregate counts).
- `DataReplication._defaultWriteHandler` today reports every record as `created` because it UPSERTs without diffing. A `SELECT`-before-UPSERT could classify each record as `insert` / `update` / `unchanged` at negligible cost during the write.
- The WRITE phase has both the incoming record and can cheaply fetch the existing row by key, so a field-level diff is mechanically straightforward.

A hypothetical replication-native per-run audit would:

| Property | Value |
|---|---|
| Attribution | Run (`ReplicationRuns.ID`), not a user |
| Granularity | Per-record (`insert` / `update` / `unchanged` / `delete`) with optional field-level diffs |
| Scope | Replicated entities only — orthogonal to user-edit auditing |
| Truncate semantics | Records survive full-sync DELETE (they're linked to `ReplicationRuns`, not FK-cascaded from the target entity) |
| Opt-in | Annotation option on `@federation.replicate` (default off, because field-level diffs grow tables quickly) |

This is **not proposed as a requirement in this document** — it is mentioned to show that the "what changed?" question for replication has a clean answer that does not require (or benefit from) `@cap-js/change-tracking`.

---

## Summary

| Claim | Verdict |
|---|---|
| `@cap-js/change-tracking` can power an audit trail for `@federation.delegate` entities | **No** — no local table to trigger on |
| `@cap-js/change-tracking` can power an audit trail for `@federation.replicate` entities | **Technically yes, substantively no** — wrong attribution, full-sync noise, performance cost, scope mismatch |
| `@cap-js/change-tracking` is the right tool for user edits on local enrichment entities around federation | **Yes** — zero integration work needed |
| Replication-run visibility ("what did the last sync change?") is a different concern | **Yes** — belongs in the plugin's own pipeline, not in change-tracking |

The takeaway for this plugin's direction: change-tracking is not a building block for federation features, but it remains a recommended tool for application developers building on top of the plugin and should keep working unchanged. If we later decide to answer the replication-audit question, we build it natively in the WRITE phase rather than reusing change-tracking's machinery.

---

## References

| Resource | URL |
|---|---|
| `@cap-js/change-tracking` (GitHub) | https://github.com/cap-js/change-tracking |
| `@cap-js/change-tracking` README (v2.0-beta, 2026-04) | https://github.com/cap-js/change-tracking#readme |
| CAP Service Integration guide | https://cap.cloud.sap/docs/guides/integration/calesi |
| Feature Matrix — Replicate Strategy (4.4) | [../../reference/requirements.md](../../reference/requirements.md) |
| Feature Matrix — Security / Audit trail (4.12.3) | [../../reference/requirements.md](../../reference/requirements.md) |
| Plugin source: `DataReplication._defaultWriteHandler` | `srv/lib/DataReplication.js` |
| Plugin source: annotation scanner (persistence setup) | `srv/annotation-scanner.js` |
