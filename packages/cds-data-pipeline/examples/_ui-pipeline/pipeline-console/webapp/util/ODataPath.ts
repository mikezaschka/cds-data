const ODataPath = {
    /**
     * @param sKey OData string key (single-quoted in URL path)
     */
    pipelinesEntity(sKey: string): string {
        return "/Pipelines('" + String(sKey).replace(/'/g, "''") + "')";
    },
};
export default ODataPath;
