const cds = require('@sap/cds')

function findServingService(entityFullName) {
    for (const [, srv] of Object.entries(cds.services)) {
        if (!srv.entities) continue
        if (srv.kind !== 'app-service' && srv.kind !== 'service') continue
        for (const entity of srv.entities) {
            if (entity.name === entityFullName) return srv
            const projRef = entity.projection?.from?.ref?.[0]
            if (projRef === entityFullName) return srv
        }
    }
    return null
}

function findEntityNameInService(service, entityFullName) {
    for (const entity of service.entities) {
        if (entity.name === entityFullName) return entity.name.split('.').pop()
        const projRef = entity.projection?.from?.ref?.[0]
        if (projRef === entityFullName) return entity.name.split('.').pop()
    }
    return null
}

module.exports = { findServingService, findEntityNameInService }
