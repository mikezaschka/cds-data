/**
 * The scanned `@federation.*` configs, held for whoever needs to read them
 * after startup — today the management service (ADR 0017).
 *
 * `cds-plugin.js` owns the scan and pushes the result here on every `loaded`
 * event. Nothing is persisted: this is the compiled model, and it is rebuilt
 * from annotations on every boot.
 */

let _configs = []

/** @param {object[]} configs output of `scanAnnotations(csn).configs` */
function setFederationConfigs(configs) {
    _configs = Array.isArray(configs) ? configs : []
}

/** @returns {object[]} every scanned config, in scan order */
function getFederationConfigs() {
    return _configs
}

/**
 * @param {string} entityFullName fully qualified consumption-view name
 * @returns {object|undefined}
 */
function getFederationConfig(entityFullName) {
    if (!entityFullName) return undefined
    return _configs.find(c => c.entityFullName === entityFullName)
}

module.exports = {
    setFederationConfigs,
    getFederationConfigs,
    getFederationConfig,
}
