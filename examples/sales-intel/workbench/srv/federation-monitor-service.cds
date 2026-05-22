// Pulls the engine's pipeline management service into this app so the
// Pipeline Monitor tile (still served under the legacy "federation-monitor"
// UI app id for now) and the `.http` scenarios can trigger runs, flush, and
// inspect run history.
//
// The engine's `statistics` inline struct flattens to `statistics_created` etc.
// in OData v4. Referencing `statistics.created` in UI annotations emits
// `Path="statistics/created"`, which UI5 then mis-reads as a navigation
// property. We use the flattened names via the `![name]` escape instead.
using { DataPipelineManagementService } from 'cds-data-pipeline/srv/DataPipelineManagementService';

annotate DataPipelineManagementService.Pipelines with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Pipeline',
            TypeNamePlural : 'Pipelines',
            Title          : { Value: name },
            Description    : { Value: kind }
        },
        LineItem: [
            { Value: name,                       Label: 'Name' },
            { Value: kind,                       Label: 'Kind' },
            { Value: status,                     Label: 'Status' },
            { Value: mode,                       Label: 'Mode' },
            { Value: lastSync,                   Label: 'Last Sync' },
            { Value: errorCount,                 Label: 'Errors' },
            { Value: ![statistics_created],      Label: 'Created' },
            { Value: ![statistics_updated],      Label: 'Updated' }
        ],
        SelectionFields: [ kind, status ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Overview', Target: '@UI.FieldGroup#Overview' },
            { $Type: 'UI.ReferenceFacet', Label: 'Runs',     Target: 'runs/@UI.LineItem' }
        ],
        FieldGroup #Overview: {
            Data: [
                { Value: name },
                { Value: kind },
                { Value: status },
                { Value: mode },
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
            { Value: ![statistics_created],      Label: 'Created' },
            { Value: ![statistics_updated],      Label: 'Updated' },
            { Value: error,                      Label: 'Error' }
        ]
    }
);
