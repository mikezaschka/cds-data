// xtravels bundles HotelsService as a "late-cut" microservice: annotated
// `@agent @mcp` and `@cds.external:2`, so the app itself never serves it over
// HTTP. The showcase delegates to it as a genuine remote, which needs an OData
// endpoint — added here rather than by patching the submodule's services.cds.
using { sap.capire.hotels.HotelsService } from '../../xtravels/srv/hotels/services';

annotate HotelsService with @odata @rest;
