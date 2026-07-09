using { plugin.data_pipeline as pipeline } from '../db/index.cds';

service DataPipelineManagementService @(path: '/pipeline') {

    @readonly
    @cds.persistence.skip: true
    @cds.odata.valuelist: true
    entity PipelineRunModes {
        key code : String;
            name : String;
    }

    @readonly
    @cds.persistence.skip: true
    @cds.odata.valuelist: true
    entity PipelineRunTriggers {
        key code : String;
            name : String;
    }

    @readonly
    entity Pipelines as projection on pipeline.Pipelines actions {
        /** Stops the internal schedule and persists `schedule: null` as an override. */
        action clearSchedule() returns String;
        /**
         * Sets or replaces the internal schedule via a persisted override.
         * Pass `every` (ms) **or** `cron` (5-field expression). Optional `engine`:
         * `'spawn'` | `'queued'`. Cron requires `queued` (and live change requires CDS 10+).
         */
        action setSchedule(
            every  : Integer,
            cron   : String,
            engine : String
        ) returns String;
        /**
         * Merge a JSON overrides patch onto the coded baseline. Body:
         * `{ "mode": "full", "source": { "batchSize": 500 }, ... }`.
         * Returns configView JSON.
         */
        action setOverrides( overrides : LargeString ) returns LargeString;
        /**
         * Clear override keys (comma-separated paths) or all overrides when `keys` is empty.
         * Returns configView JSON.
         */
        action clearOverrides( keys : String ) returns LargeString;
        /** Pause (`false`) or resume (`true`) scheduled ticks. Manual start still works. */
        action setEnabled( enabled : Boolean ) returns LargeString;
        /**
         * Baseline / overrides / effective config + per-field meta for the console diff view.
         */
        function configView() returns LargeString;
        /**
         * Preview source or target data for the Pipeline Console data inspector.
         * Returns JSON: `{ columns, rows, hasMore, limitedSupport? }`.
         */
        function inspectData(
            side        : String,
            columnsJson : LargeString,
            filters     : LargeString,
            top         : Integer,
            skip        : Integer
        ) returns LargeString;
        /**
         * Inspect tab availability for the Pipeline Console.
         * Returns JSON: `{ source: 'full'|'limited'|'none', target: 'full'|'limited'|'none' }`.
         */
        function inspectCapabilities() returns LargeString;
        /**
         * Data-flow graph metadata for the Pipeline Console: lifecycle events,
         * configuration deviations, registered hooks, and graph nodes/lines.
         */
        function flowMetadata() returns LargeString;
        action start(
            @(Common: {
                ValueListWithFixedValues : true,
                ValueList                : {
                    Label          : 'Mode',
                    CollectionPath : 'PipelineRunModes',
                    Parameters     : [
                        {
                            $Type             : 'Common.ValueListParameterInOut',
                            ValueListProperty : 'code',
                            LocalDataProperty : mode,
                        },
                        {
                            $Type             : 'Common.ValueListParameterDisplayOnly',
                            ValueListProperty : 'name',
                        },
                    ],
                },
            })
            mode    : pipeline.ReplicationMode,
            @(Common: {
                ValueListWithFixedValues : true,
                ValueList                : {
                    Label          : 'Trigger',
                    CollectionPath : 'PipelineRunTriggers',
                    Parameters     : [
                        {
                            $Type             : 'Common.ValueListParameterInOut',
                            ValueListProperty : 'code',
                            LocalDataProperty : trigger,
                        },
                        {
                            $Type             : 'Common.ValueListParameterDisplayOnly',
                            ValueListProperty : 'name',
                        },
                    ],
                },
            })
            trigger : pipeline.RunTrigger,
            async   : Boolean
        ) returns String;
    }

    @readonly
    entity PipelineRuns as projection on pipeline.PipelineRuns;

    action execute(
        name    : String,
        mode    : String,
        trigger : String,
        async   : Boolean
    ) returns String;

    action flush(name : String) returns String;

    function status(name : String) returns Pipelines;

    /** All pipelines as a deduplicated source → pipeline → target landscape graph. */
    function landscapeMetadata() returns LargeString;
}
