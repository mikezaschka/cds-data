using { sap.common } from '@sap/cds/common';

//  Workaround for @cds.autoexpose kicking in too eagerly ...
//
//  - cds.autoexpose should only apply to UI/Fiori backend services, not API services
//  - cds.autoexpose should be supported on individual assocs, not only targets
//  - associations to stay in models for non-exposed targets -> currently skipped by 4odata

annotate common.Currencies with @cds.autoexpose:false;
annotate common.Countries with @cds.autoexpose:false;
annotate common.Languages with @cds.autoexpose:false;
