const cds = require('@sap/cds')
const {
    compileProjectionToQuery,
    resolveSourceFrom,
    validateSupportedProjection,
} = require('./projection-to-query')

const LOG = cds.log('cds-data-materialization')

const NON_CQN_SOURCE_KINDS = new Set(['odata', 'odata-v2', 'rest'])

function scanAnnotations(csn) {
    const configs = []

    for (const [name, def] of Object.entries(csn.definitions || {})) {
        const directSourceRef = def.projection?.from?.ref
        if (directSourceRef && directSourceRef.length > 0) {
            const directSourceName = directSourceRef.join('.')
            const directSourceDef = csn.definitions?.[directSourceName]
            const directSourceHasMaterialize =
                directSourceDef &&
                (directSourceDef['@materialize.snapshot'] !== undefined ||
                    Object.keys(directSourceDef).some(k => k.startsWith('@materialize.snapshot.')))
            if (directSourceHasMaterialize) {
                LOG.debug(`Skipping '${name}': inherits @materialize.snapshot from '${directSourceName}'`)
                continue
            }
        }

        const config = buildConfigFromAnnotation(name, def, csn)
        if (!config) continue

        def['@cds.persistence.table'] = true
        def['@cds.persistence.skip'] = false

        configs.push(config)
        LOG.debug(`Found @materialize.snapshot on '${name}'`)
    }

    return { configs }
}

function buildConfigFromAnnotation(entityName, entityDef, csn) {
    const options = collectSnapshotOptions(entityDef)
    if (!hasSnapshotAnnotation(entityDef, options)) return null

    assertNoFederationAnnotations(entityName, entityDef)

    const projection = entityDef.projection
    validateSupportedProjection(entityName, projection)

    const explicitSource = options.source
    const inferred = inferSourceFromProjection(entityDef)

    let sourceService
    let sourceEntity

    if (explicitSource?.service) {
        sourceService = explicitSource.service
        sourceEntity = explicitSource.entity || inferred?.entityName || null
    } else if (inferred?.serviceName) {
        sourceService = inferred.serviceName
        sourceEntity = inferred.entityName
    } else {
        throw new Error(
            `@materialize.snapshot on '${entityName}': cannot infer source service. ` +
            `Use projection on Service.Entity or set @materialize.snapshot.source.service.`
        )
    }

    if (options.refresh && typeof options.refresh === 'object') {
        throw new Error(
            `@materialize.snapshot on '${entityName}': partial refresh from annotation is not supported in v1`
        )
    }

    const sourceFrom = resolveSourceFrom({
        projection,
        entityFqn: entityName,
    })

    const compiledQuery = compileProjectionToQuery({ sourceFrom, projection })

    return {
        entityName: entityName.split('.').pop(),
        entityFullName: entityName,
        sourceService,
        sourceEntity,
        sourceFrom,
        options,
        compiledQuery,
        csnTargetElements: entityDef.elements,
    }
}

function hasSnapshotAnnotation(entityDef, options) {
    if (entityDef['@materialize.snapshot'] !== undefined && entityDef['@materialize.snapshot'] !== null) {
        return true
    }
    return Object.keys(options).length > 0
}

function collectSnapshotOptions(entityDef) {
    const options = {}
    const anno = entityDef['@materialize.snapshot']
    if (anno !== undefined && anno !== null && typeof anno === 'object' && anno !== true) {
        Object.assign(options, anno)
    }
    const dotPrefix = '@materialize.snapshot.'
    for (const key of Object.keys(entityDef)) {
        if (!key.startsWith(dotPrefix)) continue
        const path = key.slice(dotPrefix.length).split('.')
        let target = options
        for (let i = 0; i < path.length - 1; i++) {
            if (!(path[i] in target)) target[path[i]] = {}
            target = target[path[i]]
        }
        target[path[path.length - 1]] = entityDef[key]
    }
    return options
}

function assertNoFederationAnnotations(entityName, entityDef) {
    for (const key of Object.keys(entityDef)) {
        if (key.startsWith('@federation.')) {
            throw new Error(
                `@materialize.snapshot on '${entityName}': cannot combine with ${key}`
            )
        }
    }
}

function inferSourceFromProjection(entityDef) {
    const ref = entityDef.projection?.from?.ref
    if (!ref || ref.length === 0) return null

    const from = ref.join('.')
    const parts = from.split('.')
    if (parts.length < 2) return null

    return {
        serviceName: parts[0],
        entityName: parts.slice(1).join('.'),
    }
}

function assertCqnNativeSource(serviceName) {
    const req = cds.env?.requires?.[serviceName]
    const kind = req?.kind
    if (kind && NON_CQN_SOURCE_KINDS.has(kind)) {
        throw new Error(
            `@materialize.snapshot: source service '${serviceName}' has kind '${kind}'. ` +
            `Aggregate reads require a CQN-native source (e.g. db or an in-process CAP service). ` +
            `Replicate remote data first, then materialize from the local table.`
        )
    }
}

module.exports = {
    scanAnnotations,
    buildConfigFromAnnotation,
    assertCqnNativeSource,
}
