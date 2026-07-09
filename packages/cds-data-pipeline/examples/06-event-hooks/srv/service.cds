using { example06 } from '../db/schema';

service ExampleService @(path: '/odata/v4/example') {
    entity Shipments    as projection on example06.Shipments;

    @readonly
    entity BatchMetrics as projection on example06.BatchMetrics;
}
