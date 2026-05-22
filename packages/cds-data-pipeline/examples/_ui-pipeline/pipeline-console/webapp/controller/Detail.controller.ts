import Controller from "sap/ui/core/mvc/Controller";
import Fragment from "sap/ui/core/Fragment";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataPath from "pipeline/monitor/fcl/util/ODataPath";
import type Dialog from "sap/m/Dialog";
import type VBox from "sap/m/VBox";
import type HBox from "sap/m/HBox";

const BOUND_START = "DataPipelineManagementService.start";
const BOUND_SET_SCHED = "DataPipelineManagementService.setSchedule";
const BOUND_CLEAR = "DataPipelineManagementService.clearSchedule";

type ODataCtx = {
    invoke: (n: string, p: object) => Promise<unknown>;
};

const Detail = Controller.extend("pipeline.monitor.fcl.controller.Detail", {
    _oStartDialog: undefined as Dialog | undefined,
    _oSchedDialog: undefined as Dialog | undefined,

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

    onNavBack() {
        this.getOwnerComponent().getRouter().navTo("master", {}, true);
    },

    statusState(s: string) {
        const m: Record<string, string> = { idle: "Success", running: "Information", failed: "Error" };
        return m[s] || "None";
    },

    errorState(n: number) {
        if (n > 0) {
            return "Error";
        }
        return "None";
    },

    _getBoundContext() {
        return this.getView().getBindingContext() as ODataCtx | null;
    },

    onStartDialog() {
        const oView = this.getView();
        if (!this._oStartDialog) {
            Fragment.load({
                id: oView,
                name: "pipeline.monitor.fcl.fragments.StartDialog",
                controller: this,
            }).then((oDialog: Dialog) => {
                this._oStartDialog = oDialog;
                oView.addDependent(oDialog);
                this._openStartWithDefaults();
            });
        } else {
            this._openStartWithDefaults();
        }
    },

    _openStartWithDefaults() {
        const oVBox = this._oStartDialog!.getContent()[0] as VBox;
        oVBox.getItems()[1].setSelectedKey("delta");
        oVBox.getItems()[3].setSelectedKey("manual");
        (oVBox.getItems()[4] as HBox).getItems()[1].setSelected(false);
        this._oStartDialog!.open();
    },

    onStartCancel() {
        this._oStartDialog!.close();
    },

    onStartConfirm() {
        const oCtx = this._getBoundContext();
        if (!oCtx) {
            return;
        }
        const oVBox = this._oStartDialog!.getContent()[0] as VBox;
        const sMode = oVBox.getItems()[1].getSelectedKey() as string;
        const sTrigger = oVBox.getItems()[3].getSelectedKey() as string;
        const bAsync = (oVBox.getItems()[4] as HBox).getItems()[1].getSelected() as boolean;
        oCtx
            .invoke(BOUND_START, { mode: sMode, trigger: sTrigger, async: bAsync })
            .then(() => {
                const oB = this.getView().getModel("i18n").getResourceBundle();
                MessageToast.show(oB.getText("actionSuccess"));
                this._oStartDialog!.close();
            })
            .catch((oErr: { message?: string } | string) => {
                MessageBox.error(
                    (typeof oErr === "object" && oErr && oErr.message) || String(oErr)
                );
            });
    },

    onSetScheduleDialog() {
        const oView = this.getView();
        if (!this._oSchedDialog) {
            Fragment.load({
                id: oView,
                name: "pipeline.monitor.fcl.fragments.SetScheduleDialog",
                controller: this,
            }).then((oDialog: Dialog) => {
                this._oSchedDialog = oDialog;
                oView.addDependent(oDialog);
                (oDialog.getContent()[0] as VBox).getItems()[1].setValue("60000");
                oDialog.open();
            });
        } else {
            (this._oSchedDialog.getContent()[0] as VBox).getItems()[1].setValue("60000");
            this._oSchedDialog.open();
        }
    },

    onSetScheduleCancel() {
        this._oSchedDialog!.close();
    },

    onSetScheduleConfirm() {
        const oCtx = this._getBoundContext();
        if (!oCtx) {
            return;
        }
        const sVal = (this._oSchedDialog!.getContent()[0] as VBox).getItems()[1].getValue() as string;
        const iEvery = parseInt(sVal, 10);
        if (Number.isNaN(iEvery) || iEvery <= 0) {
            const oB = this.getView().getModel("i18n").getResourceBundle();
            MessageBox.error(oB.getText("scheduleInvalid"));
            return;
        }
        oCtx
            .invoke(BOUND_SET_SCHED, { every: iEvery })
            .then(() => {
                const oB = this.getView().getModel("i18n").getResourceBundle();
                MessageToast.show(oB.getText("actionSuccess"));
                this._oSchedDialog!.close();
            })
            .catch((oErr: { message?: string } | string) => {
                MessageBox.error(
                    (typeof oErr === "object" && oErr && oErr.message) || String(oErr)
                );
            });
    },

    onClearSchedule() {
        const oCtx = this._getBoundContext();
        if (!oCtx) {
            return;
        }
        oCtx
            .invoke(BOUND_CLEAR, {})
            .then(() => {
                const oB = this.getView().getModel("i18n").getResourceBundle();
                MessageToast.show(oB.getText("actionSuccess"));
            })
            .catch((oErr: { message?: string } | string) => {
                MessageBox.error(
                    (typeof oErr === "object" && oErr && oErr.message) || String(oErr)
                );
            });
    },
});

export default Detail;
