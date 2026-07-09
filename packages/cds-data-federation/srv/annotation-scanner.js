const cds = require('@sap/cds')
const { buildColumnMappingsFromProjection, projectedColumnToSelectArg, projectedColumnToRemoteKey } = require('cds-data-pipeline/srv/lib/columnRefPath')

const LOG = cds.log('cds-data-federation')
const { injectEntityCacheDefinitions } = require('./entity-cache/cache-schema')

function sourceHasFederationAnnotation(sourceDef) {
    if (!sourceDef) return false
    return sourceDef['@federation.delegate'] !== undefined ||
        sourceDef['@federation.replicate'] !== undefined ||
        Object.keys(sourceDef).some(
            k => k.startsWith('@federation.delegate.') || k.startsWith('@federation.replicate.')
        )
}

function sourceIsDelegateStrategy(sourceDef) {
    if (!sourceDef) return false
    return sourceDef['@federation.delegate'] !== undefined ||
        Object.keys(sourceDef).some(k => k.startsWith('@federation.delegate.'))
}

function resolveProjectionSource(csn, entityName, ref) {
    if (!ref?.length) return null
    const joined = ref.join('.')
    if (csn.definitions?.[joined]) return csn.definitions[joined]

    // Fallbacks only apply to *unqualified*, single-segment refs (e.g. a derived
    // read model projecting on `ReplicatedFlights` within the same service). A
    // multi-segment ref (e.g. `['Remote','Ent']`) is already service-qualified;
    // guessing a same-service target there would wrongly resolve to the entity
    // itself and mis-classify a genuine federated entity as a derived projection.
    if (ref.length !== 1) return null

    const lastSegment = ref[ref.length - 1]
    const entityParts = entityName.split('.')
    if (entityParts.length >= 2) {
        const serviceQualified = [...entityParts.slice(0, -1), lastSegment].join('.')
        if (serviceQualified !== entityName && csn.definitions?.[serviceQualified]) {
            return csn.definitions[serviceQualified]
        }
    }

    const lastDot = entityName.lastIndexOf('.')
    if (lastDot > 0) {
        const nsQualified = `${entityName.substring(0, lastDot + 1)}${lastSegment}`
        if (nsQualified !== entityName && csn.definitions?.[nsQualified]) {
            return csn.definitions[nsQualified]
        }
    }

    return null
}

/**
 * A projection whose source already carries a `@federation.*` annotation is a
 * *derived* model — the underlying entity is the real federation target, not this
 * surface. How it must persist depends on the source strategy:
 *
 * - **replicate** source (real local table): keep this as a SQL **view** over the
 *   replicated table (`table:false`, no `skip`), so filtered/aggregate read models
 *   read live from the replicated data.
 * - **delegate** source (`@cds.persistence.skip`, live proxy, no table): this
 *   projection is itself a live proxy and must stay **non-persisted** (`skip:true`).
 *   Turning it into a view over a skip entity is invalid — cds 10's compiler (v7)
 *   rejects navigation to a `@cds.persistence.skip` target during SQL generation.
 */
function markDerivedReadModel(def, sourceIsDelegate) {
    if (sourceIsDelegate) {
        def['@cds.persistence.skip'] = true
        delete def['@cds.persistence.table']
        return
    }
    def['@cds.persistence.table'] = false
    delete def['@cds.persistence.skip']
}

/**
 * Scans the loaded CSN model for @federation.delegate / @federation.replicate
 * annotations and:
 * 1. For 'replicate': sets @cds.persistence.table and @cds.persistence.skip: false
 * 2. Builds federation config objects for each annotated entity
 *
 * Called from cds.on('loaded', csn).
 */
function scanAnnotations(csn) {
    const configs = []
    const viewMappingRegistry = {}

    for (const [name, def] of Object.entries(csn.definitions || {})) {
        // CDS propagates annotations from a db-level entity to projections on it,
        // so a service-level projection of a replicated entity also shows up here.
        // Skip those — the underlying entity is the real replication target, and
        // re-running setup on the service surface creates a duplicate config and
        // forces the OData projection to materialize as a separate (empty) table
        // instead of a view. Detect by checking if the projection source already
        // carries @federation.* annotations.
        const directSourceRef = def.projection?.from?.ref || def.query?.SELECT?.from?.ref
        if (directSourceRef && directSourceRef.length > 0) {
            const directSourceName = directSourceRef.join('.')
            const directSourceDef = resolveProjectionSource(csn, name, directSourceRef)
            if (sourceHasFederationAnnotation(directSourceDef)) {
                LOG.debug(`Skipping '${name}': inherits @federation.* from '${directSourceName}' (derived projection)`)
                markDerivedReadModel(def, sourceIsDelegateStrategy(directSourceDef))
                continue
            }
        }

        const config = buildConfigFromAnnotation(name, def)
        if (!config) continue

        // For projection-inferred sources, verify the source is a service definition.
        // For explicit sources (REST), the service is in cds.requires, not in CSN definitions.
        if (!config.options.source) {
            const sourceDef = csn.definitions?.[config.sourceService]
            if (!sourceDef || sourceDef.kind !== 'service') {
                LOG.debug(`Skipping '${name}': source '${config.sourceService}' is not a service`)
                markDerivedReadModel(def)
                continue
            }
        }

        // For replicate strategy, ensure the entity gets a persistent local table.
        // @cds.persistence.skip: false overrides `skip: true` inherited from imported
        // external CSN (e.g. when projecting on a remote service entity).
        // @cds.persistence.table: true forces a separate local table when projecting
        // on a remote service entity — without it the projection collapses to a view
        // over the imported table, so data would go to provider_Customers instead of
        // consumer_ReplicatedCustomers. Derived service-level projections are filtered
        // out above, so this only runs on the real replication target.
        if (config.strategy === 'replicate') {
            def['@cds.persistence.table'] = true
            def['@cds.persistence.skip'] = false
        }

        // Resolve write flags from annotation options (create/update/delete/writable).
        // Strip @readonly when any write flag is enabled so CUD requests reach our handlers.
        // Actively set @readonly when NO write flags are enabled so CAP's protocol layer
        // rejects writes with 405, regardless of what the external CSN defines.
        const writeFlags = resolveWriteFlags(config.options)
        config.writeFlags = writeFlags
        const anyWrite = writeFlags.create || writeFlags.update || writeFlags.delete
        if (anyWrite) {
            delete def['@readonly']
            const sourceDef2 = csn.definitions?.[`${config.sourceService}.${config.sourceEntity}`]
            if (sourceDef2) delete sourceDef2['@readonly']
        } else if (config.strategy === 'delegate') {
            def['@readonly'] = true
        }

        // Register view mapping for expand resolution across entities
        viewMappingRegistry[config.entityFullName] = config.viewMapping
        viewMappingRegistry[`${config.sourceService}.${config.sourceEntity}`] = config.viewMapping

        configs.push(config)
        LOG.debug(`Found @federation.${config.strategy} on '${name}'`)
    }

    injectEntityCacheDefinitions(csn, configs)

    return { configs, viewMappingRegistry }
}

/**
 * CDS compiler flattens structured annotation values into dot-separated keys:
 *   @federation.delegate: { cache: { ttl: 60000 } }
 * becomes:
 *   @federation.delegate.cache.ttl: 60000
 *
 * This function collects all @federation.<strategy>.* keys and reconstructs
 * the nested options object.
 */
function collectFlattenedOptions(entityDef, prefix) {
    const options = {}
    const dotPrefix = prefix + '.'
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

/**
 * Builds a federation config from annotations on an entity.
 *
 * Annotation forms (CSN representation depends on CDS compiler):
 *   @federation.delegate                                          -> delegate, no options
 *   @federation.delegate: { cache: { ttl: 60000 } }              -> delegate + cache
 *     CSN may flatten to: @federation.delegate.cache.ttl: 60000
 *   @federation.replicate                                         -> replicate, no options
 *   @federation.replicate: { mode: 'delta', schedule: '...' }    -> replicate with options
 *     CSN may flatten to: @federation.replicate.mode: 'delta', etc.
 */
function buildConfigFromAnnotation(entityName, entityDef) {
    let strategy = null
    let options = {}

    const delegateAnno = entityDef['@federation.delegate']
    const replicateAnno = entityDef['@federation.replicate']

    if (delegateAnno !== undefined && delegateAnno !== null) {
        strategy = 'delegate'
        if (typeof delegateAnno === 'object' && delegateAnno !== true) {
            options = { ...delegateAnno }
        }
    } else if (replicateAnno !== undefined && replicateAnno !== null) {
        strategy = 'replicate'
        if (typeof replicateAnno === 'object' && replicateAnno !== true) {
            options = { ...replicateAnno }
        }
    } else {
        const flatDelegate = collectFlattenedOptions(entityDef, '@federation.delegate')
        const flatReplicate = collectFlattenedOptions(entityDef, '@federation.replicate')
        if (Object.keys(flatDelegate).length > 0) {
            strategy = 'delegate'
            options = flatDelegate
        } else if (Object.keys(flatReplicate).length > 0) {
            strategy = 'replicate'
            options = flatReplicate
        }
    }

    if (!strategy) return null

    // Source resolution: explicit annotation option > projection inference.
    // REST services typically have no CDS model, so the source service must be
    // specified explicitly via options.source. OData services infer from projection.
    const explicitSource = options.source
    const inferredSource = inferSource(entityDef)

    if (!explicitSource && !inferredSource) {
        LOG.warn(`Cannot resolve source for @federation.${strategy} entity '${entityName}'. Skipping.`)
        return null
    }

    const sourceService = explicitSource || inferredSource.serviceName
    const sourceEntity = inferredSource?.entityName || null

    // Determine which service this entity belongs to
    const serviceName = inferServiceName(entityName)

    // Extract column mapping from the projection (renames via `as`)
    const viewMapping = extractViewMapping(entityDef)
    if (sourceEntity) viewMapping.sourceEntity = sourceEntity

    return {
        entityName: entityName.split('.').pop(),
        entityFullName: entityName,
        strategy,
        serviceName,
        sourceService,
        sourceEntity,
        options,
        viewMapping
    }
}

/**
 * Extracts the consumption view mapping from a projection.
 *
 * Note: For basic delegation, CAP's runtime handles query translation and result
 * mapping automatically through the projection chain (see Service Integration docs). This
 * mapping is only needed for cross-service expand: local → remote, where the
 * plugin must manually build remote queries and map results back, because CAP
 * cannot resolve $expand across service boundaries.
 *
 * - projectedColumns: remote field names that are projected (for $select on the remote fetch)
 * - localToRemote: map from local field name → remote field name
 * - remoteToLocal: map from remote field name → local field name
 * - isWildcard: true if projection uses { * } (no column restriction)
 */
function extractViewMapping(entityDef) {
    const staticWhere = entityDef.projection?.where || null
    const columns = entityDef.projection?.columns
    const excluding = entityDef.projection?.excluding

    if (!columns || columns.length === 0) {
        const excludedColumns = excluding
            ? excluding.map(e => typeof e === 'string' ? e : e.ref?.[0] || e).filter(Boolean)
            : []
        return { isWildcard: true, excludedColumns, projectedColumns: [], localToRemote: {}, remoteToLocal: {}, staticWhere }
    }

    // Check for wildcard: [{ '*': true }] or similar
    if (columns.some(c => c === '*' || c['*'])) {
        return { isWildcard: true, projectedColumns: [], localToRemote: {}, remoteToLocal: {}, staticWhere }
    }

    const projectedColumns = []
    const localToRemote = {}
    const remoteToLocal = {}

    const mapped = buildColumnMappingsFromProjection(columns)
    projectedColumns.push(...mapped.projectedColumns)
    Object.assign(localToRemote, mapped.localToRemote)
    Object.assign(remoteToLocal, mapped.remoteToLocal)

    return { isWildcard: false, projectedColumns, localToRemote, remoteToLocal, staticWhere }
}

/**
 * Infers the source service and entity from a projection definition.
 */
function inferSource(entityDef) {
    const ref = entityDef.projection?.from?.ref
             || entityDef.query?.SELECT?.from?.ref
    if (!ref || ref.length === 0) return null

    const from = ref.join('.')
    const parts = from.split('.')
    if (parts.length < 2) return null

    return {
        serviceName: parts[0],
        entityName: parts.slice(1).join('.')
    }
}

/**
 * Infers the CDS service name an entity belongs to by walking up the namespace.
 */
function inferServiceName(entityName) {
    const lastDot = entityName.lastIndexOf('.')
    if (lastDot > 0) {
        return entityName.substring(0, lastDot)
    }
    return null
}

/**
 * Resolves write operation flags from annotation options.
 * `writable: true` is shorthand for all three. Individual flags override.
 *
 *   resolveWriteFlags({})                                  → all false
 *   resolveWriteFlags({ writable: true })                  → all true
 *   resolveWriteFlags({ create: true })                    → create only
 *   resolveWriteFlags({ writable: true, delete: false })   → create + update
 */
function resolveWriteFlags(options) {
    const writable = options.writable ?? false
    return {
        create: options.create ?? writable,
        update: options.update ?? writable,
        delete: options.delete ?? writable
    }
}

module.exports = { scanAnnotations, resolveWriteFlags }
