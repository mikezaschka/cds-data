// This file acts as a central facade to exported service definitions.
// You can modify it to tweak things, without your changes being overridden.
using from './services';

// Workaround for @cds.autoexpose kicking in too eagerly ...
annotate sap.common.Currencies with @cds.autoexpose:false;
annotate sap.common.Countries with @cds.autoexpose:false;
annotate sap.common.Languages with @cds.autoexpose:false;
