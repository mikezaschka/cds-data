using { example } from '../db/schema';
using from 'cds-data-pipeline/srv/DataPipelineManagementService';

/**
 * Agent-facing service: federated remote data exposed via MCP.
 * Use `describe` to inspect entities, then `query` to read.
 */
@mcp: 'agent'
@mcp.instructions: 'Customers and Products are live-delegated from a remote OData provider (renamed fields on Products). ReplicatedCustomers is a local SQLite copy — run the ReplicatedCustomers pipeline first if empty.'
annotate FederationAgentService with @odata;

service FederationAgentService {

    /** Remote customer master (delegated). Keys: ID. */
    entity Customers as projection on example.Customers {
        ID, name, city, country, email, blocked
    };

    /** Remote product catalog with rename mapping (delegated). */
    entity Products as projection on example.Products;

    /** Local replica of customers (replicated). Same shape as delegated Customers. */
    entity ReplicatedCustomers as projection on example.ReplicatedCustomers;
}
