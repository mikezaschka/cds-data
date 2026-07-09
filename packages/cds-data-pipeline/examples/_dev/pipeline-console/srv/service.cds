using { consoleDev } from '../db/schema';

service DevService @(path: '/odata/v4/dev') {
    entity Shipments          as projection on consoleDev.Shipments;
    entity ShipmentsWithHooks as projection on consoleDev.ShipmentsWithHooks;
    entity Carriers           as projection on consoleDev.Carriers;
    entity FxRates            as projection on consoleDev.FxRates;

    @readonly
    entity BatchMetrics as projection on consoleDev.BatchMetrics;
}
