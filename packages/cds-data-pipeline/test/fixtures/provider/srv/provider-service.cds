using { provider } from '../db/schema';

/**
 * test-only events for file-based messaging (topic = @topic or default FQN).
 */
service ProviderService {
    @cds.redirection.target
    entity Customers as projection on provider.Customers;
    entity Products  as projection on provider.Products;
    entity Orders    as projection on provider.Orders;
    entity Addresses as projection on provider.Addresses;

    @cds.query.limit: { max: 2 }
    @cds.redirection.target: false
    entity PagedCustomers as projection on provider.Customers;

    @topic: 'test.provider.ProviderService.CustomerKeyTest'
    event CustomerKeyTest {
        key ID : String(10);
    }

    @topic: 'test.provider.ProviderService.CustomerPayloadTest'
    event CustomerPayloadTest {
        key ID         : String(10);
        name         : String(100);
        city         : String(50);
        country      : String(3);
        email        : String(100);
        blocked      : Boolean;
        modifiedAt   : Timestamp;
    }

    action emitCustomerKeyTest(ID: String(10))             returns { ok: Boolean; };
    action emitCustomerPayloadTest(ID: String(10))        returns { ok: Boolean; };
}
