/**
 * Explicit OData $select lists for Pipeline Console bindings.
 * autoExpandSelect misses Timestamp fields on programmatic bindElement / $expand.
 */
export const PIPELINES_LIST_SELECT =
    "name,description,status,mode,schedule,enabled,lastSync,errorCount";

export const PIPELINE_DETAIL_SELECT =
    "name,description,status,enabled,schedule,mode,lastSync,lastKey,origin,source,target,errorCount,lastError,statistics_created,statistics_updated,statistics_deleted";

export const PIPELINE_RUNS_LIST_SELECT =
    "ID,startTime,endTime,status,trigger,mode,origin,error,statistics_created,statistics_updated,statistics_deleted";

export const PIPELINE_RUNS_EXPAND = `runs($select=${PIPELINE_RUNS_LIST_SELECT})`;

export function pipelinesEntity(name: string): string {
    return `/Pipelines('${String(name).replace(/'/g, "''")}')`;
}

export function inspectCapabilitiesFunction(name: string): string {
    return `${pipelinesEntity(name)}/DataPipelineManagementService.inspectCapabilities()`;
}

export function configViewFunction(name: string): string {
    return `${pipelinesEntity(name)}/DataPipelineManagementService.configView()`;
}

export function inspectDataFunction(
    name: string,
    side: string,
    top: number,
    skip: number,
    columnsJson?: string,
    filters?: string
): string {
    const params = [`side='${side}'`, `top=${top}`, `skip=${skip}`];
    if (columnsJson) {
        params.push(`columnsJson='${columnsJson.replace(/'/g, "''")}'`);
    }
    if (filters) {
        params.push(`filters='${filters.replace(/'/g, "''")}'`);
    }
    return `${pipelinesEntity(name)}/DataPipelineManagementService.inspectData(${params.join(",")})`;
}
