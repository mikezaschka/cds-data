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
        /** Stops the in-process `cds.spawn({ every })` schedule. Not supported for `schedule.engine: 'queued'` (change requires restart). */
        action clearSchedule() returns String;
        /**
         * Sets or replaces the internal **spawn** schedule: `every` is the interval in ms between delta runs.
         * Fails if the pipeline was registered with `schedule.engine: 'queued'`.
         */
        action setSchedule( every : Integer ) returns String;
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
}
