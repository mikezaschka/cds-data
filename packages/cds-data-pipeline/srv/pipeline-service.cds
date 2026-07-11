// Stub service definition for typer / optional `cds.serve` wiring. Runtime
// resolution for `cds.connect.to('data-pipeline')` is provided by this
// package's `package.json` → `cds.requires.kinds['data-pipeline'].impl` (see CAPire
// “CDS Plugin Packages” / “Connecting to Required Services”).
//
// This service has no entities or actions — it is a code-only orchestrator
// used programmatically by the plugin to drive pipelines. The OData
// management surface lives in `DataPipelineManagementService.cds`.

@protocol: 'none'
service DataPipelineService {}
