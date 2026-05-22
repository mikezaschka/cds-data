import Controller from "sap/ui/core/mvc/Controller";
import MessageBox from "sap/m/MessageBox";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataPath from "pipeline/monitor/fcl/util/ODataPath";
import type FlexibleColumnLayout from "sap/f/FlexibleColumnLayout";

const EndRuns = Controller.extend("pipeline.monitor.fcl.controller.EndRuns", {
    onInit() {
        const oRouter = this.getOwnerComponent().getRouter();
        oRouter.getRoute("detail").attachPatternMatched(this._onRouteMatched, this);
        this.getView().setModel(
            new JSONModel({
                showBack: !!sap.ui.Device.system.phone,
            }) as object,
            "device"
        );
    },

    _onRouteMatched(oEvent: { getParameter: (n: string) => { name?: string } | undefined }) {
        const oArgs = oEvent.getParameter("arguments");
        const sName = oArgs && oArgs.name ? decodeURIComponent(String(oArgs.name)) : null;
        if (!sName) {
            return;
        }
        this.getView().bindElement({ path: ODataPath.pipelinesEntity(sName) });
    },

    onNavBackMid() {
        const oApp = this.getOwnerComponent().getRootControl();
        const oFcl = oApp.byId("fcl") as FlexibleColumnLayout;
        if (oFcl) {
            oFcl.setLayout("TwoColumnsBeginExpanded");
        }
    },

    runStatusState(s: string) {
        const m: Record<string, string> = { idle: "Success", running: "Information", failed: "Error" };
        return m[s] || "None";
    },

    errorPreview(sErr: string | null | undefined) {
        if (!sErr) {
            return "";
        }
        const t = String(sErr);
        return t.length > 60 ? t.slice(0, 60) + "…" : t;
    },

    onShowError(oEvent: { getSource: () => { getBindingContext: () => { getProperty: (n: string) => string } | null } }) {
        const oCtx = oEvent.getSource().getBindingContext();
        if (!oCtx) {
            return;
        }
        const sMsg = oCtx.getProperty("error");
        if (sMsg) {
            const oB = this.getView().getModel("i18n").getResourceBundle();
            MessageBox.information(sMsg, { title: oB.getText("errDetailTitle") });
        }
    },
});

export default EndRuns;
