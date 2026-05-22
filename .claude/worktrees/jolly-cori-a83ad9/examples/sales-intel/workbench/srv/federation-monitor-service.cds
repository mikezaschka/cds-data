// Pulls the plugin's federation management service into this app so the
// Federation Monitor tile and the `.http` scenarios can trigger runs, flush
// caches, and inspect run history.
//
// The plugin's `statistics` inline struct flattens to `statistics_created` etc.
// in OData v4. Referencing `statistics.created` in UI annotations emits
// `Path="statistics/created"`, which UI5 then mis-reads as a navigation
// property. We use the flattened names via the `![name]` escape instead.
using { DataFederationService } from 'cds-data-federation/srv/data-replication-management-service';

annotate DataFederationService.Federations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Federation',
            TypeNamePlural : 'Federations',
            Title          : { Value: name },
            Description    : { Value: strategy }
        },
        LineItem: [
            { Value: name,                       Label: 'Name' },
            { Value: strategy,                   Label: 'Strategy' },
            { Value: status,                     Label: 'Status' },
            { Value: mode,                       Label: 'Mode' },
            { Value: lastSync,                   Label: 'Last Sync' },
            { Value: errorCount,                 Label: 'Errors' },
            { Value: ![statistics_created],      Label: 'Created' },
            { Value: ![statistics_updated],      Label: 'Updated' }
        ],
        SelectionFields: [ strategy, status ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: 'Overview', Target: '@UI.FieldGroup#Overview' },
            { $Type: 'UI.ReferenceFacet', Label: 'Runs',     Target: 'runs/@UI.LineItem' }
        ],
        FieldGroup #Overview: {
            Data: [
                { Value: name },
                { Value: strategy },
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

annotate DataFederationService.ReplicationRuns with @(
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
