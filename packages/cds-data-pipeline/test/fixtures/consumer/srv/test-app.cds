using { consumer } from '../db/schema';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';

/**
 * OData surface for tests: local pipeline targets + plugin management API (/pipeline).
 */
service TestConsumerService @(path: '/consumer') {
    entity ReplicatedCustomers        as projection on consumer.ReplicatedCustomers;
    entity ReplicatedCustomersV2    as projection on consumer.ReplicatedCustomersV2;
    entity ReplicatedProducts         as projection on consumer.ReplicatedProducts;
    entity InferredViewProducts       as projection on consumer.InferredViewProducts;
    entity ReplicatedPagedCustomers  as projection on consumer.ReplicatedPagedCustomers;
    entity ReplicatedRestCustomers   as projection on consumer.ReplicatedRestCustomers;
    entity SourceOrders              as projection on consumer.SourceOrders;
    entity ReplicatedSourceOrders    as projection on consumer.ReplicatedSourceOrders;
    entity DailyCustomerRevenue      as projection on consumer.DailyCustomerRevenue;
    entity FanInCustomers            as projection on consumer.FanInCustomers;
}
