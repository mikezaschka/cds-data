# First Delegation

This walkthrough takes a CAP app that already connects to a remote OData service and turns one of its entities into a transparent live proxy.

## Prerequisites

- An `@sap/cds` app (`cds init` output will do).
- A remote OData service configured in `cds.requires`. The example below uses SAP S/4HANA Cloud's `API_BUSINESS_PARTNER`, but any OData V2 / V4 / HCQL service works.

## 1. Import the remote service model

```bash
cds import https://api.sap.com/.../API_BUSINESS_PARTNER.edmx
```

This creates `./srv/external/API_BUSINESS_PARTNER.csn` and adds a `cds.requires.API_BUSINESS_PARTNER` entry to `package.json`.

## 2. Declare a consumption view

```cds title="srv/external-service.cds"
using { API_BUSINESS_PARTNER as remote } from './external/API_BUSINESS_PARTNER';

service ExternalService {

    @federation.delegate
    entity Partners as projection on remote.A_BusinessPartner {
        BusinessPartner         as ID,
        BusinessPartnerFullName as name,
        BusinessPartnerCategory as category
    };

}
```

The projection IS the federation contract. The plugin reads:

- **source** — from `projection on remote.A_BusinessPartner` → `API_BUSINESS_PARTNER.A_BusinessPartner`
- **projected columns** — only these three fields are ever requested from the remote
- **rename mapping** — `BusinessPartner ↔ ID`, `BusinessPartnerFullName ↔ name`, `BusinessPartnerCategory ↔ category`

See [Concepts → Consumption Views](../concepts/consumption-views.md) for more projection patterns (renames, `excluding`, entity-level renames).

## 3. Run it

```bash
cds watch
```

Query the federated entity like any local one:

```http
GET /external/Partners?$filter=contains(name,'Acme')&$orderby=name&$top=5
```

The plugin:

1. Registers an `on('READ', Partners, ...)` handler automatically.
2. Translates `name` → `BusinessPartnerFullName` in `$filter` / `$orderby` / `$select`.
3. Restricts `$select` to the three projected columns (bandwidth optimization).
4. Calls `remote.run(req.query)` under the hood — CAP does the CQN → OData URL conversion.
5. Maps the response fields back to the consumer schema.

No JavaScript handler was written, no CQN was touched by hand.

## What you get for free

- `$filter` operators (`eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`, `and`, `or`, `not`) on renamed fields.
- String functions (`contains`, `startswith`, `endswith`, `tolower`, `toupper`).
- `$orderby`, `$select`, `$top`, `$skip`, `$count`, `$search`.
- Lambda operators `any()` / `all()` on to-many associations.
- Cross-service `$expand` (see [Cross-Service Scenarios](../concepts/cross-service-scenarios.md)).
- CQL via the projection chain — `SELECT.one(Partners).where({ category: 'Z001' })` works too.

## Next steps

- [First Replication](first-replication.md) — copy remote data locally for joins and analytics.
- [First Cache](first-cache.md) — reduce remote-service load with TTL caching.
- [Reference → Annotations](../reference/annotations.md) — every option with types and defaults.
- [Concepts → Cross-Service Scenarios](../concepts/cross-service-scenarios.md) — how cross-service expand works.
