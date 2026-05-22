using { example01 } from '../db/schema';
using from 'cds-data-pipeline/srv/monitor-annotations';

// Public OData service over the replicated local table so you can query
// the copied rows at `/odata/v4/example/Shipments`. The `@cds.persistence.skip: false`
// override is not needed here because the consumption view is annotated
// with `@cds.persistence.table`, which already pins it to a local table.
service ExampleService @(path: '/odata/v4/example') {
    entity Shipments as projection on example01.Shipments;
}
