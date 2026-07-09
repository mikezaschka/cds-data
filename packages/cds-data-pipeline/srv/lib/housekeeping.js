/**
 * Pipeline run retention — age- and count-based pruning of PipelineRuns rows.
 */

const cds = require('../runtime-cds')
const { normalizeRetentionInt } = require('../../lib/config-normalizer')
const { rowsAffected } = require('./rowsAffected')

const LOG = cds.log('cds-data-pipeline')
const RUNS = 'plugin_data_pipeline_PipelineRuns'
const DELETE_BATCH_SIZE = 500

/**
 * Merge global defaults with per-pipeline retention overrides.
 *
 * @param {object|null|undefined} pipelineRetention
 * @param {object|null|undefined} globalDefault
 * @returns {{ enabled: boolean, retentionDays?: number, maxRuns?: number }}
 */
function resolvePolicy(pipelineRetention, globalDefault) {
    const global = globalDefault && globalDefault.enabled ? globalDefault : {}
    const pipeline = pipelineRetention && typeof pipelineRetention === 'object' ? pipelineRetention : {}

    const retentionDays = pipeline.retentionDays !== undefined
        ? normalizeRetentionInt(pipeline.retentionDays)
        : global.retentionDays
    const maxRuns = pipeline.maxRuns !== undefined
        ? normalizeRetentionInt(pipeline.maxRuns)
        : global.maxRuns

    const enabled =
        retentionDays !== undefined ||
        maxRuns !== undefined

    return {
        enabled: !!enabled,
        retentionDays,
        maxRuns,
    }
}

/**
 * Delete finished runs older than the retention cutoff.
 *
 * @param {string} pipelineName
 * @param {number} retentionDays
 * @returns {Promise<number>}
 */
async function _purgeByAge(pipelineName, retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
    const affected = await DELETE.from(RUNS).where({
        pipeline_name: pipelineName,
        status: { '!=': 'running' },
        endTime: { '<': cutoff },
    })
    return rowsAffected(affected)
}

/**
 * Keep only the newest maxRuns finished runs (by startTime).
 *
 * @param {string} pipelineName
 * @param {number} maxRuns
 * @returns {Promise<number>}
 */
async function _purgeByCount(pipelineName, maxRuns) {
    const rows = await SELECT.from(RUNS)
        .columns('ID', 'startTime')
        .where({ pipeline_name: pipelineName, status: { '!=': 'running' } })
        .orderBy({ startTime: 'desc' })

    const toDelete = rows.slice(maxRuns)
    if (toDelete.length === 0) return 0

    let deleted = 0
    for (let i = 0; i < toDelete.length; i += DELETE_BATCH_SIZE) {
        const batch = toDelete.slice(i, i + DELETE_BATCH_SIZE).map((row) => row.ID)
        const affected = await DELETE.from(RUNS).where({ ID: { in: batch } })
        deleted += rowsAffected(affected)
    }
    return deleted
}

/**
 * Apply retention policy for one pipeline.
 *
 * @param {string} pipelineName
 * @param {{ enabled?: boolean, retentionDays?: number, maxRuns?: number }} policy
 * @returns {Promise<{ deleted: number }>}
 */
async function purgeRunsForPipeline(pipelineName, policy) {
    if (!policy || !policy.enabled) {
        return { deleted: 0 }
    }

    let deleted = 0

    if (policy.retentionDays !== undefined) {
        deleted += await _purgeByAge(pipelineName, policy.retentionDays)
    }

    if (policy.maxRuns !== undefined) {
        deleted += await _purgeByCount(pipelineName, policy.maxRuns)
    }

    if (deleted > 0) {
        LOG.info(`Housekeeping purged ${deleted} run(s) for pipeline '${pipelineName}'`)
    }

    return { deleted }
}

module.exports = {
    resolvePolicy,
    purgeRunsForPipeline,
}
