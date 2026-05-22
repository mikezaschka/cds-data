using from 'cds-data-pipeline/db';

namespace consumer;

entity SourceOrders {
  key ID         : String(36);
      customerId : String(10);
      amount     : Decimal(10, 2);
      status     : String(20);
      modifiedAt : Timestamp;
}

@materialize.snapshot: {
  source : { service: 'db' }
}
entity DailyCustomerRevenue as projection on SourceOrders {
  key customerId,
      sum(amount)     as totalAmount  : Decimal(15, 2),
      count(*)        as orderCount   : Integer,
      max(modifiedAt) as lastActivity : Timestamp
}
group by customerId;
