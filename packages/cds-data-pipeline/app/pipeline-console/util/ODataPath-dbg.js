sap.ui.define([], function () {
  "use strict";

  const ODataPath = {
    /**
     * @param sKey OData string key (single-quoted in URL path)
     */
    pipelinesEntity(sKey) {
      return "/Pipelines('" + String(sKey).replace(/'/g, "''") + "')";
    }
  };
  return ODataPath;
});
//# sourceMappingURL=ODataPath-dbg.js.map
