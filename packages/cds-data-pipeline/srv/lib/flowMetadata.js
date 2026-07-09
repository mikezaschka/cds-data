const LIFECYCLE_EVENTS = [
    { id: 'PIPELINE.START', label: 'START', phase: 'lifecycle', icon: 'sap-icon://begin' },
    { id: 'PIPELINE.READ', label: 'READ', phase: 'read', icon: 'sap-icon://download' },
    { id: 'PIPELINE.MAP', label: 'MAP', phase: 'map', icon: 'sap-icon://journey-change' },
    { id: 'PIPELINE.WRITE', label: 'WRITE', phase: 'write', icon: 'sap-icon://upload' },
    { id: 'PIPELINE.DONE', label: 'DONE', phase: 'lifecycle', icon: 'sap-icon://complete' },
]

function serviceGroupKey(side, service) {
    return `grp:${side}:${service}`
}

function entityNodeKey(side, service, entity) {
    return `${side}:${service}.${entity}`
}

function adapterLabel(pipeline) {
    const name = pipeline?.adapter?.constructor?.name
    return name || 'UnknownAdapter'
}

function resolveSourceServiceType(config, pipeline) {
    const source = config?.source || {}
    if (source.query || source.kind === 'cqn') {
        return 'CQN'
    }
    if (source.kind === 'rest' || config?.rest?.path) {
        return 'REST'
    }
    if (source.adapter) {
        return 'Custom source'
    }
    const adapter = adapterLabel(pipeline)
    if (adapter === 'RestAdapter') return 'REST'
    if (adapter === 'CqnAdapter') return 'CQN'
    if (adapter === 'RemoteCqnAdapter') return 'OData'
    return 'OData'
}

function resolveTargetServiceType(config, pipeline) {
    const target = config?.target || {}
    if (target.service && target.service !== 'db') {
        const writeAdapter = targetAdapterLabel(pipeline)
        if (writeAdapter === 'ODataTargetAdapter') return 'OData'
        return 'Remote service'
    }
    return 'Database'
}

function targetAdapterLabel(pipeline) {
    const name = pipeline?.targetAdapter?.constructor?.name
    return name || 'DbTargetAdapter'
}

function resolveSourceParts(sourceCfg) {
    const service = sourceCfg.service || 'Source'
    const entity = sourceCfg.entity || (sourceCfg.query ? '<query>' : 'entity')
    return { service, entity }
}

function resolveTargetParts(targetCfg) {
    const service = targetCfg.service || 'db'
    const entity = targetCfg.entity || 'entity'
    return { service, entity }
}

function customizationsForEvent(customizations, eventId) {
    return (customizations || []).filter(
        (c) => customizationAnchor(c) === eventId
    )
}

function hasCustomizationOnEvent(customizations, eventId) {
    return customizationsForEvent(customizations, eventId).length > 0
}

function customizationAttributes(customizations, eventId) {
    return customizationsForEvent(customizations, eventId).map((c) => ({
        label: c.kind === 'hook' ? `Hook (${c.phase})` : 'Config',
        value: c.label,
    }))
}

function eventNodeStatus(eventId, customizations, runStatus) {
    if (hasCustomizationOnEvent(customizations, eventId)) {
        return 'Warning'
    }
    if (runStatus === 'running') {
        return 'Success'
    }
    if (runStatus === 'failed') {
        return 'Error'
    }
    return 'Success'
}

/**
 * Detect configuration-driven deviations from the default entity-shape → db UPSERT path.
 *
 * @param {import('./Pipeline')} pipeline
 * @returns {Array<{ id: string, label: string, kind: 'config'|'hook', event?: string, phase?: string }>}
 */
function collectConfigCustomizations(pipeline) {
    const config = pipeline.config || {}
    const source = config.source || {}
    const target = config.target || {}
    const custom = []

    if (source.query) {
        custom.push({ id: 'query-shape', label: 'Query-shape read (source.query)', kind: 'config' })
    }
    if (config.rest?.path || source.kind === 'rest') {
        custom.push({ id: 'rest-source', label: 'REST source adapter', kind: 'config' })
    }
    if (source.adapter) {
        custom.push({ id: 'custom-source-adapter', label: 'Custom source adapter', kind: 'config' })
    }
    if (target.service && target.service !== 'db') {
        custom.push({ id: 'remote-target', label: `Remote target (${target.service})`, kind: 'config' })
    }
    if (source.origin) {
        custom.push({ id: 'fan-in', label: `Multi-source fan-in (origin=${source.origin})`, kind: 'config' })
    }
    if (config.schedule) {
        custom.push({ id: 'schedule', label: 'Internal schedule', kind: 'config' })
    }
    if (config.mode === 'partial-refresh') {
        custom.push({ id: 'partial-refresh', label: 'Partial refresh mode', kind: 'config' })
    }
    if (config.mode === 'full') {
        custom.push({ id: 'full-mode', label: 'Full refresh mode', kind: 'config' })
    }
    const deltaMode = config.delta?.mode
    if (deltaMode && deltaMode !== 'timestamp') {
        custom.push({ id: 'delta-mode', label: `Delta mode: ${deltaMode}`, kind: 'config' })
    }
    const vm = config.viewMapping
    if (vm?.remoteToLocal && Object.keys(vm.remoteToLocal).length > 0) {
        custom.push({ id: 'view-mapping', label: 'Column rename mapping', kind: 'config' })
    }
    const readAdapter = adapterLabel(pipeline)
    if (readAdapter !== 'RemoteCqnAdapter' && readAdapter !== 'CqnAdapter' && readAdapter !== 'UnknownAdapter') {
        custom.push({ id: 'read-adapter', label: `Read adapter: ${readAdapter}`, kind: 'config' })
    }
    const writeAdapter = targetAdapterLabel(pipeline)
    if (writeAdapter !== 'DbTargetAdapter') {
        custom.push({ id: 'write-adapter', label: `Write adapter: ${writeAdapter}`, kind: 'config' })
    }

    return custom
}

/**
 * @param {Map<string, { before?: Set<string>, after?: Set<string>, on?: Set<string> }>} hookRegistry
 * @param {string} pipelineName
 */
function collectHookCustomizations(hookRegistry, pipelineName) {
    const entry = hookRegistry?.get(pipelineName)
    if (!entry) return []
    const custom = []
    for (const phase of ['before', 'after', 'on']) {
        const raw = entry[phase]
        if (!raw) continue
        const events = raw instanceof Set ? [...raw] : raw
        for (const event of events) {
            custom.push({
                id: `${phase}:${event}`,
                label: `${phase.toUpperCase()} ${event.replace('PIPELINE.', '')} hook`,
                kind: 'hook',
                event,
                phase,
            })
        }
    }
    return custom
}

function configCustomizationAnchor(id) {
    const anchors = {
        'query-shape': 'PIPELINE.READ',
        'rest-source': 'PIPELINE.READ',
        'custom-source-adapter': 'PIPELINE.READ',
        'read-adapter': 'PIPELINE.READ',
        'delta-mode': 'PIPELINE.READ',
        'view-mapping': 'PIPELINE.MAP',
        'fan-in': 'PIPELINE.MAP',
        'remote-target': 'PIPELINE.WRITE',
        'write-adapter': 'PIPELINE.WRITE',
        'partial-refresh': 'PIPELINE.WRITE',
        'full-mode': 'PIPELINE.WRITE',
        'schedule': 'PIPELINE.START',
    }
    return anchors[id] || 'PIPELINE.READ'
}

function customizationAnchor(custom) {
    if (custom.kind === 'hook' && custom.event) {
        return custom.event
    }
    return configCustomizationAnchor(custom.id)
}

/**
 * Build nodes/lines for a single pipeline run flow including lifecycle events.
 */
function buildPipelineFlowGraph(opts) {
    const source = resolveSourceParts(opts.sourceCfg || {})
    const target = resolveTargetParts(opts.targetCfg || {})
    const customizations = opts.customizations || []
    const runStatus = opts.status || 'idle'
    const nodeStatus = runStatus === 'running' ? 'Information' : runStatus === 'failed' ? 'Error' : 'Success'

    const sourceGroup = serviceGroupKey('source', source.service)
    const targetGroup = serviceGroupKey('target', target.service)
    const eventsGroup = `grp:events:${opts.name || 'pipeline'}`
    const sourceType = opts.sourceType || resolveSourceServiceType({ source: opts.sourceCfg }, opts.pipeline)
    const targetType = opts.targetType || resolveTargetServiceType({ target: opts.targetCfg }, opts.pipeline)

    const groups = [
        {
            key: sourceGroup,
            title: source.service,
            description: sourceType,
            icon: 'sap-icon://cloud',
            status: nodeStatus,
        },
        {
            key: eventsGroup,
            title: opts.name || 'Pipeline',
            icon: 'sap-icon://process',
            status: nodeStatus,
        },
        {
            key: targetGroup,
            title: target.service,
            description: targetType,
            icon: 'sap-icon://database',
            status: nodeStatus,
        },
    ]

    const sourceKey = 'source'
    const targetKey = 'target'

    const nodes = [
        {
            key: sourceKey,
            title: source.entity,
            icon: 'sap-icon://document',
            status: nodeStatus,
            group: sourceGroup,
            attributes: [{ label: 'Service', value: source.service }],
        },
        ...LIFECYCLE_EVENTS.map((ev) => {
            const attributes = customizationAttributes(customizations, ev.id)
            return {
                key: ev.id,
                title: ev.label,
                icon: ev.icon,
                status: eventNodeStatus(ev.id, customizations, runStatus),
                group: eventsGroup,
                event: ev.id,
                ...(attributes.length ? { attributes } : {}),
            }
        }),
        {
            key: targetKey,
            title: target.entity,
            icon: 'sap-icon://document',
            status: nodeStatus,
            group: targetGroup,
            attributes: [{ label: 'Service', value: target.service }],
        },
    ]

    const chain = [sourceKey, ...LIFECYCLE_EVENTS.map((e) => e.id), targetKey]
    const lines = []
    for (let i = 0; i < chain.length - 1; i++) {
        const from = chain[i]
        const to = chain[i + 1]
        const eventNode = LIFECYCLE_EVENTS.find((e) => e.id === to)
        lines.push({
            from,
            to,
            title: eventNode ? eventNode.label : opts.mode || '',
            status: hasCustomizationOnEvent(customizations, to) ? 'Warning' : undefined,
        })
    }

    return {
        nodes,
        lines,
        groups,
        events: LIFECYCLE_EVENTS,
        customizations,
    }
}

/**
 * Landscape graph: service groups with entity / consumption-view nodes and pipeline connectors.
 */
function buildLandscapeGraph(pipelines) {
    const nodes = new Map()
    const groups = new Map()
    const lines = []

    const ensureGroup = (key, title, icon, status = 'Success', serviceType) => {
        if (!groups.has(key)) {
            groups.set(key, { key, title, icon, status, description: serviceType })
        } else if (serviceType && !groups.get(key).description) {
            groups.get(key).description = serviceType
        }
    }

    const ensureEntityNode = (side, service, entity, status = 'Success', serviceType) => {
        const groupKey = serviceGroupKey(side, service)
        const nodeKey = entityNodeKey(side, service, entity)
        ensureGroup(
            groupKey,
            service,
            side === 'target' ? 'sap-icon://database' : 'sap-icon://cloud',
            status,
            serviceType,
        )
        if (!nodes.has(nodeKey)) {
            nodes.set(nodeKey, {
                key: nodeKey,
                title: entity,
                icon: 'sap-icon://document',
                status,
                group: groupKey,
                attributes: [{ label: 'Service', value: service }],
            })
        }
        return nodeKey
    }

    for (const p of pipelines) {
        const source = { service: p.sourceService, entity: p.sourceEntity }
        const target = { service: p.targetService, entity: p.targetEntity }
        const pipelineKey = `pl:${p.name}`
        const pipelineStatus = p.status === 'running' ? 'Information' : p.status === 'failed' ? 'Error' : 'Success'

        const srcNode = ensureEntityNode('source', source.service, source.entity, pipelineStatus, p.sourceType)
        const tgtNode = ensureEntityNode('target', target.service, target.entity, pipelineStatus, p.targetType)

        nodes.set(pipelineKey, {
            key: pipelineKey,
            title: p.name,
            icon: 'sap-icon://process',
            status: pipelineStatus,
            group: undefined,
            attributes: [{ label: 'Mode', value: p.mode || '' }],
        })

        const warn = p.customizations.length ? 'Warning' : undefined
        lines.push({
            from: srcNode,
            to: pipelineKey,
            title: p.mode,
            status: warn,
        })
        lines.push({
            from: pipelineKey,
            to: tgtNode,
            title: p.mode,
            status: warn,
        })
    }

    return {
        nodes: [...nodes.values()],
        groups: [...groups.values()],
        lines,
        pipelineCount: pipelines.length,
    }
}

/**
 * @param {import('./Pipeline')} pipeline
 * @param {Map} hookRegistry
 * @param {string} [status]
 * @param {object} [opts]
 */
function flowMetadataForPipeline(pipeline, hookRegistry, status = 'idle', opts = {}) {
    const config = pipeline.config || {}
    const sourceCfg = config.source || {}
    const targetCfg = config.target || {}
    const source = resolveSourceParts(sourceCfg)
    const target = resolveTargetParts(targetCfg)
    const customizations = [
        ...collectConfigCustomizations(pipeline),
        ...collectHookCustomizations(hookRegistry, pipeline.name),
    ]
    const sourceType = resolveSourceServiceType(config, pipeline)
    const targetType = resolveTargetServiceType(config, pipeline)

    return {
        name: pipeline.name,
        mode: config.mode,
        status,
        sourceService: source.service,
        sourceEntity: source.entity,
        sourceType,
        targetService: target.service,
        targetEntity: target.entity,
        targetType,
        sourceLabel: `${source.service} · ${source.entity}`,
        targetLabel: `${target.service} · ${target.entity}`,
        sourceKey: `${source.service}.${source.entity}`,
        targetKey: `${target.service}.${target.entity}`,
        events: LIFECYCLE_EVENTS,
        customizations,
        graph: buildPipelineFlowGraph({
            name: pipeline.name,
            sourceCfg,
            targetCfg,
            mode: config.mode,
            status,
            customizations,
            sourceType,
            targetType,
            pipeline,
        }),
    }
}

module.exports = {
    LIFECYCLE_EVENTS,
    collectConfigCustomizations,
    collectHookCustomizations,
    buildPipelineFlowGraph,
    buildLandscapeGraph,
    flowMetadataForPipeline,
    resolveSourceServiceType,
    resolveTargetServiceType,
}
