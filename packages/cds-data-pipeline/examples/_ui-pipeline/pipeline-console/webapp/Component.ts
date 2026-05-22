import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";

const MANIFEST_REFRESH = "/sap.ui5/pipelineConsole/refreshIntervalSeconds";

const L = {
    one: "OneColumn",
    twoBegin: "TwoColumnsBeginExpanded",
    threeMid: "ThreeColumnsMidExpanded",
} as const;

function refreshODataV4Model(oModel: object | undefined) {
    const m = oModel as { getGroupId?: () => string; refresh?: (g: string) => void };
    if (!m || typeof m.getGroupId !== "function" || typeof m.refresh !== "function") {
        return;
    }
    m.refresh(m.getGroupId());
}

const PipelineConsoleComponent = UIComponent.extend("pipeline.monitor.fcl.Component", {
    metadata: { manifest: "json" },
    _oRefreshTimer: null as ReturnType<typeof setInterval> | null,

    init() {
        (UIComponent.prototype as { init: (this: unknown) => void }).init.call(this);
        this.setModel(
            new JSONModel({
                layout: L.one,
            }) as object,
            "fcl"
        );
        this.getRouter().attachRouteMatched(this._onRouteMatched, this);
        this.getRouter().initialize();
        this._ensureInitialRoute();

        const iSec = (this.getManifestEntry(MANIFEST_REFRESH) as number | undefined) ?? 30;
        if (iSec > 0) {
            const that = this;
            this._oRefreshTimer = setInterval(function (this: void) {
                if (typeof document !== "undefined" && document.hidden) {
                    return;
                }
                refreshODataV4Model(that.getModel() as ODataModel);
            }, iSec * 1000);
        }
    },

    _ensureInitialRoute() {
        const oRouter = this.getRouter();
        const fnRun = function (this: void) {
            const oHC = oRouter.getHashChanger && oRouter.getHashChanger();
            let sHash = "";
            if (oHC && typeof oHC.getHash === "function") {
                sHash = oHC.getHash() || "";
            } else if (typeof window !== "undefined" && window.location && window.location.hash) {
                sHash = window.location.hash;
            }
            sHash = sHash.replace(/^#/, "");
            const bDetail = /(^|\/)Pipelines\//.test(sHash);
            if (!bDetail) {
                oRouter.navTo("master", {}, true);
            }
        };
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(fnRun);
            });
        } else {
            setTimeout(fnRun, 0);
        }
    },

    _onRouteMatched(oEvent: { getParameter: (n: string) => string | undefined | object }) {
        const sName = oEvent.getParameter("name");
        const oFcl = this.getModel("fcl") as { setProperty: (p: string, v: string) => void };
        if (sName === "master") {
            oFcl.setProperty("/layout", L.one);
        } else if (sName === "detail") {
            oFcl.setProperty("/layout", sap.ui.Device.system.phone ? L.twoBegin : L.threeMid);
        }
    },

    exit() {
        if (this._oRefreshTimer) {
            clearInterval(this._oRefreshTimer);
            this._oRefreshTimer = null;
        }
        (UIComponent.prototype as { exit: (this: unknown) => void }).exit.call(this);
    },
});

export default PipelineConsoleComponent;
