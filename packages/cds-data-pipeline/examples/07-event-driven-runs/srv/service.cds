using { example07 } from '../db/schema';

service ExampleService @(path: '/odata/v4/example') {
    entity Shipments as projection on example07.Shipments;

    /** Demo helper — calls `executeEvent` with `action: delete` (ADR 0013). */
    action runEventDelete(id : UUID) returns { ok : Boolean; };
}
