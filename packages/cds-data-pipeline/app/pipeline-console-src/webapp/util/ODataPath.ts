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
