const cds = require('../../runtime-cds')
const BaseTargetAdapter = require('./BaseTargetAdapter')

/**
 * Default target adapter: writes to the local `db` service via CQN.
 *
 * - `writeBatch({ mode: 'upsert' })` → `UPSERT.into(target.entity).entries(records)`.
 * - `writeBatch({ mode: 'snapshot' })` → `INSERT.into(target.entity).entries(records)`.
 *   The engine has already cleared the slice via `truncate` /
 *   `deleteSlice` inside the surrounding tx.
 * - `truncate(target)` → `DELETE.from(target.entity)`.
 * - `deleteSlice(target, predicate)` → `DELETE.from(target.entity).where(predicate)`.
 *
 * Reports all four capabilities as `true` — the local DB can UPSERT by
 * key, truncate, delete by predicate, and bulk-insert.
 */
class DbTargetAdapter extends BaseTargetAdapter {
    async _db() {
        const flags = this.config.flags || {}
        if (flags.entityCachePerTenantDb) {
            const { resolveEntityCacheTargetDb } = require('../../lib/entity-cache-target-registry')
            const pipelineName = this.config.name
            if (!pipelineName) {
                throw new Error('DbTargetAdapter: entityCachePerTenantDb requires config.name (pipeline name)')
            }
            return resolveEntityCacheTargetDb(pipelineName)
        }
        if (!this._dbService) {
            const svc = (this.config.target && this.config.target.service) || 'db'
            this._dbService = await cds.connect.to(svc)
        }
        return this._dbService
    }

    async writeBatch(records, { mode, target }) {
        if (!records || records.length === 0) {
            return { created: 0, updated: 0, deleted: 0 }
        }
        const db = await this._db()
        const entity = target && target.entity
        if (!entity) {
            throw new Error(`DbTargetAdapter.writeBatch: target.entity is required`)
        }

        if (mode === 'snapshot') {
            await db.run(INSERT.into(entity).entries(records))
        } else {
            await db.run(UPSERT.into(entity).entries(records))
        }

        return {
            created: records.length,
            updated: 0,
            deleted: 0,
        }
    }

    async truncate(target) {
        const db = await this._db()
        const entity = target && target.entity
        if (!entity) {
            throw new Error(`DbTargetAdapter.truncate: target.entity is required`)
        }
        await db.run(DELETE.from(entity))
    }

    async deleteSlice(target, predicate) {
        const db = await this._db()
        const entity = target && target.entity
        if (!entity) {
            throw new Error(`DbTargetAdapter.deleteSlice: target.entity is required`)
        }
        if (predicate && (Array.isArray(predicate) || typeof predicate === 'object')) {
            await db.run(DELETE.from(entity).where(predicate))
        } else {
            await db.run(DELETE.from(entity))
        }
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

module.exports = DbTargetAdapter
