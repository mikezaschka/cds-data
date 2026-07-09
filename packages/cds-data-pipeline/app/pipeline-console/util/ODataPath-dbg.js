sap.ui.define([], function () {
  "use strict";

  function pipelinesEntity(name) {
    return `/Pipelines('${String(name).replace(/'/g, "''")}')`;
  }
  function inspectCapabilitiesFunction(name) {
    return `${pipelinesEntity(name)}/DataPipelineManagementService.inspectCapabilities()`;
  }
  function configViewFunction(name) {
    return `${pipelinesEntity(name)}/DataPipelineManagementService.configView()`;
  }
  function inspectDataFunction(name, side, top, skip, columnsJson, filters) {
    const params = [`side='${side}'`, `top=${top}`, `skip=${skip}`];
    if (columnsJson) {
      params.push(`columnsJson='${columnsJson.replace(/'/g, "''")}'`);
    }
    if (filters) {
      params.push(`filters='${filters.replace(/'/g, "''")}'`);
    }
    return `${pipelinesEntity(name)}/DataPipelineManagementService.inspectData(${params.join(",")})`;
  }
  var __exports = {
    __esModule: true
  };
  __exports.pipelinesEntity = pipelinesEntity;
  __exports.inspectCapabilitiesFunction = inspectCapabilitiesFunction;
  __exports.configViewFunction = configViewFunction;
  __exports.inspectDataFunction = inspectDataFunction;
  return __exports;
});
//# sourceMappingURL=ODataPath-dbg.js.map
