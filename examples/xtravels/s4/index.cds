// Entry point to allow imports like: using from '@capire/s4';
using from './srv/external/API_BUSINESS_PARTNER';

// Switch on level 2 minification for clients, so that only those entities
// of the imported service definitions are kept in our runtime models, which 
// are referred to from own definitions, such as the consumption views above.
annotate API_BUSINESS_PARTNER 
with @cds.external:2;

// Minify A_BusinessPartner to keep only elements used in consumption views
annotate API_BUSINESS_PARTNER.A_BusinessPartner 
with @cds.minify:'unused-elements';

// Avoid re-serving mocked S4 service in client projects
// annotate API_BUSINESS_PARTNER 
// with @cds.api.ignore;
