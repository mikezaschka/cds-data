import AppComponent from "sap/fe/core/AppComponent";

const MANIFEST_REFRESH = "/sap.ui5/pipelineMonitor/refreshIntervalSeconds";

function refreshPipelineMonitorModel(oModel: object | undefined) {
    const m = oModel as {
        getGroupId: () => string;
        refresh?: (g: string) => void;
        getAllBindings: () => { refresh?: (a?: string) => void; isRoot?: () => boolean; isResolved?: () => boolean; isSuspended?: () => boolean }[];
    };
    if (!m || typeof m.getGroupId !== "function" || typeof m.getAllBindings !== "function") {
        return;
    }
    const sGroup = m.getGroupId();
    if (typeof m.refresh === "function") {
        m.refresh(sGroup);
    }
    m.getAllBindings().forEach((oBinding) => {
        if (!oBinding || typeof oBinding.refresh !== "function") {
            return;
        }
        if (oBinding.isRoot && oBinding.isRoot()) {
            return;
        }
        if (oBinding.isResolved && !oBinding.isResolved()) {
            return;
        }
        const bSuspended = oBinding.isSuspended && oBinding.isSuspended();
        try {
            oBinding.refresh(bSuspended ? undefined : sGroup);
        } catch (e) {
            /* may not support */
        }
    });
}

export default AppComponent.extend("pipeline.monitor.Component", {
    metadata: { manifest: "json" },

    init(this: { getManifestEntry: (p: string) => unknown; getModel: () => object | undefined; _oPipelineRefreshTimer?: ReturnType<typeof setInterval> }) {
        (AppComponent.prototype as { init: (this: unknown) => void }).init.call(this);
        let iSec = this.getManifestEntry(MANIFEST_REFRESH) as number | undefined;
        if (iSec === undefined) {
            iSec = 30;
        }
        if (iSec <= 0) {
            return;
        }
        const that = this;
        this._oPipelineRefreshTimer = setInterval(function () {
            if (typeof document !== "undefined" && document.hidden) {
                return;
            }
            refreshPipelineMonitorModel(that.getModel());
        }, iSec * 1000);
    },

    exit(this: { _oPipelineRefreshTimer?: ReturnType<typeof setInterval> }) {
        if (this._oPipelineRefreshTimer) {
            clearInterval(this._oPipelineRefreshTimer);
            this._oPipelineRefreshTimer = undefined;
        }
        (AppComponent.prototype as { exit: (this: unknown) => void }).exit.call(this);
    },
});
