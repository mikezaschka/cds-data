using { example06 } from '../db/schema';
using from 'cds-data-pipeline/srv/monitor-annotations';

service ExampleService @(path: '/odata/v4/example') {
    entity Shipments    as projection on example06.Shipments;

    @readonly
    entity BatchMetrics as projection on example06.BatchMetrics;
}
