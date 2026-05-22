using { logistics } from '../db/schema';

service LogisticsService @(path: '/odata/v4/logistics') {

    @readonly
    entity Carriers  as projection on logistics.Carriers;

    @readonly
    entity Shipments as projection on logistics.Shipments;

    @readonly
    entity TrackingEvents as projection on logistics.TrackingEvents;
}
