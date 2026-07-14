sap.ui.define([], function () {
  "use strict";

  /**
   * Explicit OData $select lists for Pipeline Console bindings.
   * autoExpandSelect misses Timestamp fields on programmatic bindElement / $expand.
   */
  const PIPELINES_LIST_SELECT = "name,description,status,mode,schedule,enabled,lastSync,errorCount";
  const PIPELINE_DETAIL_SELECT = "name,description,status,enabled,schedule,mode,lastSync,lastKey,origin,source,target,errorCount,lastError,statistics_created,statistics_updated,statistics_deleted";
  const PIPELINE_RUNS_LIST_SELECT = "ID,startTime,endTime,status,trigger,mode,origin,error,statistics_created,statistics_updated,statistics_deleted";
  const PIPELINE_RUNS_EXPAND = `runs($select=${PIPELINE_RUNS_LIST_SELECT})`;
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
  __exports.PIPELINES_LIST_SELECT = PIPELINES_LIST_SELECT;
  __exports.PIPELINE_DETAIL_SELECT = PIPELINE_DETAIL_SELECT;
  __exports.PIPELINE_RUNS_LIST_SELECT = PIPELINE_RUNS_LIST_SELECT;
  __exports.PIPELINE_RUNS_EXPAND = PIPELINE_RUNS_EXPAND;
  __exports.pipelinesEntity = pipelinesEntity;
  __exports.inspectCapabilitiesFunction = inspectCapabilitiesFunction;
  __exports.configViewFunction = configViewFunction;
  __exports.inspectDataFunction = inspectDataFunction;
  return __exports;
});
//# sourceMappingURL=ODataPath-dbg.js.map
