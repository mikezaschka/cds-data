using { consumer } from '../db/schema';

service ConsumerService {
  entity SourceOrders        as projection on consumer.SourceOrders;
  entity DailyCustomerRevenue as projection on consumer.DailyCustomerRevenue;
}
