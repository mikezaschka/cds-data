namespace example03;

// Transactional source — an in-process CAP service exposes Orders over
// this table. The materialize pipeline treats `SalesService.Orders` as a
// CQN-native source and writes the aggregate to DailyCustomerRevenue.
entity Orders {
    key ID         : String(20);
        customerId : String(10);
        status     : String(20);
        amount     : Decimal(12, 2);
        placedAt   : Date;
        modifiedAt : Timestamp;
}

// Materialized aggregate — full refresh target. Every run rebuilds the
// whole snapshot; the aggregate reflects every completed order at the
// time of the last run. Never written to directly from client code.
@cds.persistence.table
entity DailyCustomerRevenue {
    key customerId   : String(10);
        totalAmount  : Decimal(15, 2);
        orderCount   : Integer;
        lastActivity : Timestamp;
}

// Partial-refresh variant — same shape, but the pipeline only rebuilds
// the slice of aggregate rows that moved since the last run. Giving it a
// separate target table keeps the two demos independent; in a real app
// you'd pick one refresh mode per aggregate.
@cds.persistence.table
entity RecentCustomerRevenue {
    key customerId   : String(10);
        totalAmount  : Decimal(15, 2);
        orderCount   : Integer;
        lastActivity : Timestamp;
}
