const cds = require('../runtime-cds')

const LOG = cds.log('cds-data-pipeline')

function isSensitiveElement(element) {
    return element?.['@PersonalData.IsPotentiallySensitive'] === true
        || element?.['@PersonalData.IsPotentiallySensitive'] === ''
}

/**
 * Best-effort audit log for sensitive columns returned by the pipeline data inspector.
 * No-op unless `cds.env.requires['audit-log']` is configured.
 *
 * @param {string} entityName
 * @param {string[]} returnedColumns
 * @param {object} [ctx]
 */
async function auditSensitiveRead(entityName, returnedColumns, ctx = {}) {
    if (!cds.env.requires?.['audit-log']) return
    if (!entityName || !returnedColumns?.length) return

    const def = cds.model?.definitions?.[entityName]
        || Object.values(cds.model?.definitions || {}).find(
            (d) => d.kind === 'entity' && (d.name === entityName || d.name?.endsWith(`.${entityName}`)),
        )
    if (!def?.elements) return

    const sensitive = returnedColumns.filter((col) => isSensitiveElement(def.elements[col]))
    if (!sensitive.length) return

    try {
        const audit = await cds.connect.to('audit-log')
        await audit.log('SensitiveDataRead', {
            object: { type: entityName },
            attributes: sensitive.map((name) => ({ name })),
            ...(ctx.user ? { user: ctx.user } : {}),
        })
    } catch (err) {
        LOG.warn('inspectData auditSensitiveRead failed', err)
    }
}

module.exports = {
    auditSensitiveRead,
    isSensitiveElement,
}
