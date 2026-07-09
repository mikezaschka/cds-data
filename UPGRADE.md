# Upgrade Guide

This file tracks user-impacting upgrades for the `cds-data-pipeline` + `cds-data-federation` monorepo. Architectural background lives in the [ADRs](./spec/internal/decisions/).

---

## Upgrading Pipeline Console / management activation (cds-caching pattern)

Pipeline Console and management API activation now follow the same config-driven reuse pattern as [cds-caching](https://github.com/mikezaschka/cds-caching) (`metrics.reuse.*`).

### What changed

- **Removed:** `require('cds-data-pipeline/lib/mount-pipeline-console')` and `cds add data-pipeline-monitor`.
- **Added:** `cds.requires.datapipeline.management.reuse.api` / `.console` and `cds add pipeline-console`.
- **Added:** `using from 'cds-data-pipeline/index.cds'` as the single manual import for tracker + management service.
- **Added:** `cds.connect.to('datapipeline')` as the canonical service name (`DataPipelineService` remains a kind alias).

### Migrate from manual mount

**Before:**

```javascript
const cds = require('@sap/cds')
require('cds-data-pipeline/lib/mount-pipeline-console')
module.exports = cds.server
```

**After** — add to `package.json`:

```json
{
  "cds": {
    "requires": {
      "datapipeline": {
        "impl": "cds-data-pipeline",
        "management": {
          "reuse": {
            "api": true,
            "console": true
          }
        }
      }
    }
  }
}
```

Remove the `mount-pipeline-console` require from `server.js`.

### Migrate from `cds add data-pipeline-monitor`

Run `cds add pipeline-console` for BTP HTML5 repo deployments, or use `management.reuse.console` for local reuse. See [Feature activation](./docs/pipeline/guide/feature-activation.md).

### Manual CDS imports

You may replace separate imports:

```cds
using from 'cds-data-pipeline/db';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';
```

with:

```cds
using from 'cds-data-pipeline/index.cds';
```

---

## Upgrading to shape-based pipeline inference (ADR 0007)

[ADR 0007](./spec/internal/decisions/0007-infer-pipeline-intent-from-config-shape.md) removes the `kind` discriminator from the **public** `addPipeline` API. The engine now **infers** pipeline intent (`replicate` / `materialize` / `move`) from the configuration shape — consumers no longer pass `kind`. The derived kind is still persisted on the `Pipelines` tracker row and returned on `GET /pipeline/Pipelines`; only the input side changed.

### What changes

- `addPipeline({ kind: 'replicate', name, source, target, ... })` → `addPipeline({ name, source, target, ... })`. The engine derives `kind` from:
    - `source.query` present ⇒ `kind: 'materialize'` (query-shape read, snapshot write).
    - `target.service` set to anything other than `'db'` ⇒ `kind: 'move'` (entity-shape read, non-db target).
    - Otherwise (`source.entity` or `rest.path` + db target) ⇒ `kind: 'replicate'` (entity-shape read, row-preserving UPSERT).
- Default `mode` is now also inferred — entity-shape reads default to `delta`, query-shape reads default to `full`. The previous explicit `mode: 'delta'` on entity-shape configs is now a no-op (same default) but still accepted.
- Validation switched from kind-based to **shape-based** (see [`concepts/inference.md`](./packages/cds-data-pipeline/spec/concepts/inference.md)). Misconfigurations raise errors like *missing source shape* (neither `source.query` nor `source.entity`/`rest.path`) or *ambiguous source shape* (`source.query` + `source.entity` together).
- Passing `kind` to `addPipeline` is ignored (the derived kind wins). Future releases may warn on it; don't rely on it.

### Migrating programmatic callers

Drop the `kind` key. That's the whole change:

```diff
 await pipelines.addPipeline({
-    kind: 'replicate',
     name: 'BusinessPartners',
     source: { service: 'API_BUSINESS_PARTNER', entity: 'A_BusinessPartner' },
-    target: { service: 'db', entity: 'db.BusinessPartners' },
-    mode: 'delta',
+    target: { entity: 'db.BusinessPartners' },
     delta: { field: 'modifiedAt', mode: 'timestamp' },
 });
```

`mode: 'delta'` and `target.service: 'db'` are both already the defaults for an entity-shape config; leaving them in is harmless but redundant.

### No action needed for annotation users

`@federation.delegate` / `@federation.replicate` are unchanged. The federation plugin's internal call to `addPipeline` was updated in lockstep — consumer CDS models and any hook registrations still work as before.

### No DB changes

The `Pipelines.kind` column stays. Existing rows (from ADR 0005 upgrades) continue to work — the engine simply populates the column from the derived kind rather than from an input argument.

---

## Upgrading to the `cds-data-pipeline` split (ADR 0005)

Before ADR 0005 the engine lived inline inside `cds-data-federation`. After ADR 0005:

- The engine is published as its own package: **`cds-data-pipeline`**.
- The annotation plugin **`cds-data-federation`** remains, with an unchanged `@federation.*` surface. It peer-depends on `cds-data-pipeline` when `@federation.replicate` annotations are present.
- Tracker entities renamed: `Federations` → `Pipelines`, `ReplicationRuns` → `PipelineRuns`. A new `kind` column distinguishes `replicate` / `materialize` / `move`.
- Management service renamed: `DataFederationService` at `/federation` → `DataPipelineManagementService` at `/pipeline`.
- Service stub renamed: `cds.connect.to('DataReplicationService')` → `cds.connect.to('DataPipelineService')`.
- Event namespace renamed: `REPLICATE.READ | MAP | WRITE` → `PIPELINE.READ | MAP | WRITE`.
- Programmatic API: `addReplication({...})` → `addPipeline({ ... })`. Originally `kind: 'replicate' | 'materialize' | 'move'` was a required input; [ADR 0007](./spec/internal/decisions/0007-infer-pipeline-intent-from-config-shape.md) (see the section above) made it derived instead — see that section for the current shape of the call.

The `@federation.delegate` and `@federation.replicate` annotations themselves are **unchanged** — consumer CDS models that only use annotations don't need edits.

### 1. Update `package.json`

```jsonc
{
  "dependencies": {
    "cds-data-federation": "^1.0.0",
    "cds-data-pipeline": "^1.0.0"
  }
}
```

Install with `npm install`. If you only use `@federation.delegate` (no replicate), `cds-data-pipeline` is optional but harmless.

### 2. Update any `using` / programmatic references in your code

- CDS: `using from 'cds-data-federation/srv/data-replication-management-service'` → `using from 'cds-data-pipeline/srv/DataPipelineManagementService'`.
- JS: `cds.connect.to('DataReplicationService')` → `cds.connect.to('DataPipelineService')`.
- JS: `srv.before('REPLICATE.MAP', name, fn)` → `srv.before('PIPELINE.MAP', name, fn)` (and likewise `READ` / `WRITE`).
- JS: `srv.addReplication({ ... })` → `srv.addPipeline({ ... })`. Per [ADR 0007](./spec/internal/decisions/0007-infer-pipeline-intent-from-config-shape.md), the engine derives `kind` from the config shape — do **not** pass `kind`. See the ADR 0007 section above for the exact migration diff.

### 3. Rebuild + redeploy the CDS model

The plugin does no runtime DDL. Tracker tables materialize through the standard CAP deployment flow.

**HANA HDI:**

```bash
cds build --production
cf push            # or your CI's HDI deploy step
```

The HDI deployer sees the renamed entities (`Pipelines`, `PipelineRuns`) and the new `kind` column, and generates appropriate `.hdbmigrationtable` artifacts. If your HDI pipeline refuses the rename (HDI sometimes requires an explicit table-rename allow-list), add a `cdsmc` whitelist entry for `plugin_data_federation_Federations` → `plugin_data_pipeline_Pipelines` and `plugin_data_federation_ReplicationRuns` → `plugin_data_pipeline_PipelineRuns`.

Existing row data is preserved through the rename, but the `kind` column is added empty and must be backfilled. For federation-originated rows, set `kind = 'replicate'`; for programmatic pipelines, set the kind you registered with. A simple post-deploy SQL:

```sql
UPDATE plugin_data_pipeline_Pipelines SET kind = 'replicate' WHERE kind IS NULL;
```

**SQLite (local dev / tests):** use the bundled migration script, or wipe and redeploy if your tracker is ephemeral.

```bash
# Dry-run first
node packages/cds-data-pipeline/scripts/migrate-sqlite-federations-to-pipelines.js \
    --url ./db.sqlite --dry-run

# Apply
node packages/cds-data-pipeline/scripts/migrate-sqlite-federations-to-pipelines.js \
    --url ./db.sqlite
```

The script renames the two tables, adds the `kind` column, backfills it with `'replicate'`, and renames the `tracker_name` FK on the runs table to `pipeline_name`. It is idempotent — re-running is a no-op.

### 4. Verify

- `GET /pipeline/Pipelines` returns your known pipelines with the derived `kind: 'replicate'` set on the tracker row (see [ADR 0007](./spec/internal/decisions/0007-infer-pipeline-intent-from-config-shape.md) — the kind is populated by the engine, not supplied by callers).
- Scheduled runs continue as before; the first run after upgrade reuses the `lastSync` timestamp (delta unaffected).
- Any custom `before / on / after` hooks registered against `REPLICATE.*` must be renamed to `PIPELINE.*` — they will not fire otherwise.

### What changes for end users?

Nothing visible, assuming you only use `@federation.delegate` / `@federation.replicate` annotations. Query shape, URL paths on your consumer services, and `$expand` semantics are unchanged. Only the `cds-data-federation`-internal tracker namespace and the management OData URL (`/federation` → `/pipeline`) shift.
