# Installation

## Install the plugin

```bash
npm add cds-data-federation
```

The plugin auto-activates on load via `cds-plugin.js` — no manual wiring in your `server.js` or `package.json`.

## Peer dependencies

| Package | Version | Required? |
|---|---|---|
| `@sap/cds` | `>= 8` | **Yes** |
| `@sap-cloud-sdk/http-client` | `^4` | Yes, for OData remote services |
| `@sap-cloud-sdk/resilience` | `^4` | Yes, for OData remote services |
| [`cds-caching`](https://github.com/mikezaschka/cds-caching) | `>= 1` | Optional — only if you use `cache: { ttl }` |

The SAP Cloud SDK HTTP client and resilience packages are what CAP uses under the hood for OData remote service calls. If you already have CAP connected to a remote OData service, these are already installed.

## Verifying the install

Boot your CAP app and look for a line like this in the log:

```
[cds-data-federation] discovered 3 @federation.* entities
```

That confirms the plugin is active and found annotations. From there, head to [First Delegation](first-delegation.md).

## Node.js version

The plugin requires Node.js 24 or newer (aligned with `@sap/cds` >= 8 requirements).

## Project layout

The plugin makes no assumptions about your project layout. The only prerequisite is that your remote service is configured in `cds.requires` (e.g., via a `package.json`'s `cds.requires` block or a service binding), following CAP's [Reuse & Compose — Service Integration](https://cap.cloud.sap/docs/guides/integration/reuse-and-compose#service-integration) pattern.
