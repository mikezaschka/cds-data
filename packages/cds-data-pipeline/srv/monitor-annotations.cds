// Shared Fiori Elements UI annotations for the Pipeline Monitor over
// `DataPipelineManagementService` (exposed at `/pipeline/`).
//
// Each example adds:
//   using from 'cds-data-pipeline/srv/monitor-annotations';
// next to its own services. The `using` below is package-relative so CDS
// resolves it when this file is loaded from `node_modules/cds-data-pipeline`.
//
// The tracker has no `kind` column; `origin` is shown for multi-source
// fan-in. `statistics` flattens to `statistics_*` in OData V4; `![...]`
// escapes property names for the UI5 binding parser.
using { DataPipelineManagementService } from './DataPipelineManagementService';

annotate DataPipelineManagementService.Pipelines with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Pipeline',
            TypeNamePlural : 'Pipelines',
            Title          : { Value: name },
            Description    : { Value: description }
        },
        Identification: [
            {
                $Type              : 'UI.DataFieldForAction',
                Action             : 'DataPipelineManagementService.start',
                Label              : 'Start pipeline',
                InvocationGrouping : #Isolated
            },
            {
                $Type              : 'UI.DataFieldForAction',
                Action             : 'DataPipelineManagementService.setSchedule',
                Label              : 'Set internal schedule',
                InvocationGrouping : #Isolated
            },
            {
                $Type              : 'UI.DataFieldForAction',
                Action             : 'DataPipelineManagementService.clearSchedule',
                Label              : 'Clear internal schedule',
                InvocationGrouping : #Isolated
            }
        ],
        LineItem: [
            { Value: name,                       Label: 'Name' },
            { Value: description,                Label: 'Description' },
            { Value: status,                     Label: 'Status' },
            { Value: mode,                       Label: 'Mode' },
            { Value: origin,                     Label: 'Origin' },
            { Value: lastSync,                   Label: 'Last Sync' },
            { Value: errorCount,                 Label: 'Errors' },
            { Value: ![statistics_created],      Label: 'Created' },
            { Value: ![statistics_updated],      Label: 'Updated' },
            { Value: ![statistics_deleted],      Label: 'Deleted' }
        ],
        SelectionFields: [ status, mode, origin ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Overview', Target: '@UI.FieldGroup#Overview' },
            { $Type: 'UI.ReferenceFacet', Label: 'Runs',     Target: 'runs/@UI.LineItem' }
        ],
        FieldGroup #Overview: {
            Data: [
                { Value: name },
                { Value: description, Label: 'Description' },
                { Value: status },
                { Value: mode },
                { Value: origin },
                { Value: lastSync },
                { Value: lastKey },
                { Value: errorCount },
                { Value: lastError },
                { Value: ![statistics_created], Label: 'Created' },
                { Value: ![statistics_updated], Label: 'Updated' },
                { Value: ![statistics_deleted], Label: 'Deleted' }
            ]
        }
    }
);

annotate DataPipelineManagementService.PipelineRuns with @(
    UI: {
        LineItem: [
            { Value: startTime,                  Label: 'Start' },
            { Value: endTime,                    Label: 'End' },
            { Value: status,                     Label: 'Status' },
            { Value: trigger,                    Label: 'Trigger' },
            { Value: mode,                       Label: 'Mode' },
            { Value: origin,                     Label: 'Origin' },
            { Value: ![statistics_created],      Label: 'Created' },
            { Value: ![statistics_updated],      Label: 'Updated' },
            { Value: ![statistics_deleted],      Label: 'Deleted' },
            { Value: error,                      Label: 'Error' }
        ]
    }
);
