using { example03 } from '../db/schema';
using from 'cds-data-pipeline/srv/monitor-annotations';

// Transactional OData service — source of the aggregate pipeline.
service SalesService @(path: '/odata/v4/sales') {
    entity Orders as projection on example03.Orders;
}

// Reporting OData service — reads the materialized snapshot. Clients
// query here for the pre-computed aggregate; no GROUP BY at request time.
service ReportingService @(path: '/odata/v4/reporting') {
    @readonly
    entity DailyCustomerRevenue  as projection on example03.DailyCustomerRevenue;

    @readonly
    entity RecentCustomerRevenue as projection on example03.RecentCustomerRevenue;
}
