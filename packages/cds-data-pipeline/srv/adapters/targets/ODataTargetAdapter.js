const cds = require('../../runtime-cds')
const BaseTargetAdapter = require('./BaseTargetAdapter')
const { withRetry } = require('../../lib/retry')

/**
 * Target adapter for remote OData services (v2 and v4).
 *
 * Writes are routed through CAP's connected service via CQN and CAP's
 * remote-service runtime translates them into HTTP calls (POST / PUT /
 * PATCH / DELETE, with `$batch` change sets when the provider supports
 * them). This keeps the adapter minimal and inherits whatever protocol
 * nuances CAP already handles (v2 MERGE vs v4 PATCH, key encoding,
 * navigation-property writes, etc.).
 *
 * ## Operations
 *
 * - `writeBatch({ mode: 'upsert' })` → `INSERT.into(...)` on the remote service.
 *   CAP's OData client does not translate `UPSERT` CQN to HTTP; use full refresh
 *   or a custom adapter if you need true merge semantics against a remote entity.
 * - `writeBatch({ mode: 'snapshot' })` → `INSERT.into(target.entity).entries(records)`.
 * - `truncate(target)` → page `SELECT` of keys, then one DELETE per row.
 * - `deleteSlice(target, predicate)` → page `SELECT` of keys matching
 *   `predicate`, then one DELETE per row. An empty predicate delegates
 *   to `truncate`.
 *
 * ## Cost
 *
 * OData has no bulk DELETE; `truncate` and `deleteSlice` cost O(n)
 * round-trips against the remote (modulo `$batch` change sets). Use
 * `target.batchSize` to tune the key-scan page size. For large targets
 * prefer `mode: 'delta'` or a provider-side clear action exposed via a
 * custom adapter.
 *
 * ## Tuning
 *
 * | Config key               | Default                                           | Purpose                                  |
 * |--------------------------|---------------------------------------------------|------------------------------------------|
 * | `target.batchSize`       | `1000`                                            | Page size for key-scan SELECTs           |
 * | `target.keyColumns`      | `Object.keys(cds.model.definitions[entity].keys)` | Override key columns used for DELETEs    |
 * | `target.maxRetries`      | `3`                                               | Retries per CQN call                     |
 * | `target.retryDelay`      | `1000`                                            | Base delay (ms) before first retry       |
 *
 * ## Known limitations
 *
 * - Truncate / deleteSlice perform a read-then-delete without `If-Match`
 *   / ETag guards; a concurrent writer on the provider can leak rows
 *   past the sweep.
 * - Statistics from `writeBatch` attribute all rows to `created`; CAP's
 *   remote runtime does not distinguish inserts from updates during
 *   UPSERT.
 */
class ODataTargetAdapter extends BaseTargetAdapter {
    _retryOptions() {
        const t = (this.config && this.config.target) || {}
        return {
            maxRetries: t.maxRetries || 3,
            baseDelay: t.retryDelay || 1000,
            retryOn: (err) => {
                const status = err.status || err.statusCode || (err.reason && err.reason.status)
                return !(typeof status === 'number' && status >= 400 && status < 500)
            },
        }
    }

    /**
     * Remote OData services expect CQN entity refs relative to the service
     * (e.g. MirroredCustomers), while the composed model uses fully qualified
     * names (InventoryService.MirroredCustomers) for definitions lookup.
     */
    _entityForRemoteCqn(entity) {
        if (!entity || typeof entity !== 'string') return entity
        const svc = this.service && this.service.name
        if (svc) {
            const prefix = `${svc}.`
            if (entity.startsWith(prefix)) return entity.slice(prefix.length)
        }
        const dot = entity.lastIndexOf('.')
        return dot === -1 ? entity : entity.slice(dot + 1)
    }

    /** Drop navigation properties and unknown fields so OData POST payloads match the entity shape. */
    _rowForTargetEntity(row, entityFqn) {
        const def = cds.model && cds.model.definitions && cds.model.definitions[entityFqn]
        if (!def || !def.elements) return { ...row }
        const out = {}
        for (const k of Object.keys(row)) {
            if (def.elements[k] && !def.elements[k].target) out[k] = row[k]
        }
        return out
    }

    _resolveKeyColumns(entity) {
        const t = (this.config && this.config.target) || {}
        if (Array.isArray(t.keyColumns) && t.keyColumns.length > 0) {
            return t.keyColumns
        }
        const def = cds.model && cds.model.definitions && cds.model.definitions[entity]
        if (!def || !def.keys) {
            throw new Error(
                `ODataTargetAdapter: cannot resolve key columns for '${entity}'. ` +
                `Supply target.keyColumns or ensure the entity is in the CDS model.`
            )
        }
        const keys = Object.keys(def.keys).filter(k => k !== 'IsActiveEntity')
        if (keys.length === 0) {
            throw new Error(
                `ODataTargetAdapter: entity '${entity}' has no key columns. ` +
                `Supply target.keyColumns to override.`
            )
        }
        return keys
    }

    _pickKey(row, keyColumns) {
        const key = {}
        for (const k of keyColumns) key[k] = row[k]
        return key
    }

    async writeBatch(records, { mode, target }) {
        if (!records || records.length === 0) {
            return { created: 0, updated: 0, deleted: 0 }
        }
        const entity = target && target.entity
        if (!entity) {
            throw new Error(`ODataTargetAdapter.writeBatch: target.entity is required`)
        }
        const into = this._entityForRemoteCqn(entity)

        const retryOpts = this._retryOptions()

        for (const row of records) {
            const payload = this._rowForTargetEntity(row, entity)
            await withRetry(
                () => this.service.run(INSERT.into(into).entries(payload)),
                retryOpts
            )
        }

        return {
            created: records.length,
            updated: 0,
            deleted: 0,
        }
    }

    async _sweep(target, predicate) {
        const entity = target && target.entity
        if (!entity) {
            throw new Error(`ODataTargetAdapter._sweep: target.entity is required`)
        }
        const from = this._entityForRemoteCqn(entity)
        const keyColumns = this._resolveKeyColumns(entity)
        const batchSize = (this.config && this.config.target && this.config.target.batchSize) || 1000
        const retryOpts = this._retryOptions()

        const hasPredicate = predicate && (
            (Array.isArray(predicate) && predicate.length > 0) ||
            (!Array.isArray(predicate) && typeof predicate === 'object' && Object.keys(predicate).length > 0)
        )

        let deleted = 0
        let hasMore = true

        while (hasMore) {
            let query = SELECT.from(from).columns(...keyColumns).limit(batchSize, 0)
            if (hasPredicate) {
                query = query.where(predicate)
            }

            const page = await withRetry(() => this.service.run(query), retryOpts)
            if (!page || page.length === 0) {
                hasMore = false
                break
            }

            for (const row of page) {
                const key = this._pickKey(row, keyColumns)
                await withRetry(
                    () => this.service.run(DELETE.from(from).where(key)),
                    retryOpts
                )
                deleted++
            }

            // The next SELECT with limit(batchSize, 0) naturally re-scans
            // from the top because we just deleted the previous page; we
            // stop when a page comes back shorter than batchSize.
            if (page.length < batchSize) hasMore = false
        }

        return deleted
    }

    async truncate(target) {
        await this._sweep(target, null)
    }

    async deleteSlice(target, predicate) {
        await this._sweep(target, predicate)
    }

    capabilities() {
        return {
            batchInsert: true,
            keyAddressableUpsert: true,
            batchDelete: true,
            truncate: true,
        }
    }
}

module.exports = ODataTargetAdapter
