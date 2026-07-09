'use strict'

/**
 * Normalize the return value of a CAP write statement (`UPDATE` / `UPSERT` /
 * `INSERT` / `DELETE`) into a plain affected-row count, across CDS versions.
 *
 * - CDS 9 and earlier: write statements resolve to a `number` (affected rows).
 * - CDS 10: write statements resolve to a uniform shape — an array carrying an
 *   `.affected` property (the array itself is reserved for SQL `RETURNING` rows
 *   and is currently empty for UPDATE/UPSERT/DELETE). See the June 2026 release
 *   notes, "Consolidated Service APIs".
 *
 * Keeping this behind one helper lets the engine's optimistic concurrency guard
 * work unchanged on both CDS 9 and CDS 10.
 *
 * @param {number|{affected?:number}|Array|null|undefined} result
 * @returns {number}
 */
function rowsAffected(result) {
    if (typeof result === 'number') return result
    if (result == null) return 0
    // CDS 10: `.affected` holds the true count even when the array is empty,
    // so it must be checked before the array-length fallback.
    if (typeof result.affected === 'number') return result.affected
    if (Array.isArray(result)) return result.length
    return 0
}

module.exports = { rowsAffected }
