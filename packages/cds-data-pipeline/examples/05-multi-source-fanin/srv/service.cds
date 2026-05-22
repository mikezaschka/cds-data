using { example05 } from '../db/schema';
using from 'cds-data-pipeline/srv/monitor-annotations';

service ExampleService @(path: '/odata/v4/example') {
    @readonly
    entity Shipments as projection on example05.Shipments;

    // Convenience view dropping the `source` discriminator — use when
    // the UI wants "one row per business key" and doesn't care which
    // origin it came from. Typically you'd pick the latest row via a
    // more sophisticated projection (modifiedAt desc + group by), kept
    // simple here.
    @readonly
    entity ShipmentsByOrigin as projection on example05.Shipments;
}
