// Stub service definition so CAP auto-wires `srv/DataReplicationService.js`
// by name matching. Enables `cds.connect.to('DataReplicationService')` and
// removes the need for a global service locator.
//
// This service has no entities or actions — it is a code-only orchestrator
// used programmatically by the plugin to drive replications. The OData
// management surface lives in `data-replication-management-service.cds`
// (DataFederationService, exposed at `/federation`).

@protocol: 'none'
service DataReplicationService {}
