sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/core/Fragment", "sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/model/json/JSONModel", "pipeline/monitor/fcl/util/ODataPath"], function (Controller, Fragment, MessageBox, MessageToast, JSONModel, __ODataPath) {
  "use strict";

  function _interopRequireDefault(obj) {
    return obj && obj.__esModule && typeof obj.default !== "undefined" ? obj.default : obj;
  }
  const ODataPath = _interopRequireDefault(__ODataPath);
  const BOUND_START = "DataPipelineManagementService.start";
  const BOUND_SET_SCHED = "DataPipelineManagementService.setSchedule";
  const BOUND_CLEAR = "DataPipelineManagementService.clearSchedule";
  const Detail = Controller.extend("pipeline.monitor.fcl.controller.Detail", {
    _oStartDialog: undefined,
    _oSchedDialog: undefined,
    onInit() {
      const oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("detail").attachPatternMatched(this._onRouteMatched, this);
      this.getView().setModel(new JSONModel({
        showBack: !!sap.ui.Device.system.phone
      }), "device");
    },
    _onRouteMatched(oEvent) {
      const oArgs = oEvent.getParameter("arguments");
      const sName = oArgs && oArgs.name ? decodeURIComponent(String(oArgs.name)) : null;
      if (!sName) {
        return;
      }
      this.getView().bindElement({
        path: ODataPath.pipelinesEntity(sName)
      });
    },
    onNavBack() {
      this.getOwnerComponent().getRouter().navTo("master", {}, true);
    },
    statusState(s) {
      const m = {
        idle: "Success",
        running: "Information",
        failed: "Error"
      };
      return m[s] || "None";
    },
    errorState(n) {
      if (n > 0) {
        return "Error";
      }
      return "None";
    },
    _getBoundContext() {
      return this.getView().getBindingContext();
    },
    onStartDialog() {
      const oView = this.getView();
      if (!this._oStartDialog) {
        Fragment.load({
          id: oView,
          name: "pipeline.monitor.fcl.fragments.StartDialog",
          controller: this
        }).then(oDialog => {
          this._oStartDialog = oDialog;
          oView.addDependent(oDialog);
          this._openStartWithDefaults();
        });
      } else {
        this._openStartWithDefaults();
      }
    },
    _openStartWithDefaults() {
      const oVBox = this._oStartDialog.getContent()[0];
      oVBox.getItems()[1].setSelectedKey("delta");
      oVBox.getItems()[3].setSelectedKey("manual");
      oVBox.getItems()[4].getItems()[1].setSelected(false);
      this._oStartDialog.open();
    },
    onStartCancel() {
      this._oStartDialog.close();
    },
    onStartConfirm() {
      const oCtx = this._getBoundContext();
      if (!oCtx) {
        return;
      }
      const oVBox = this._oStartDialog.getContent()[0];
      const sMode = oVBox.getItems()[1].getSelectedKey();
      const sTrigger = oVBox.getItems()[3].getSelectedKey();
      const bAsync = oVBox.getItems()[4].getItems()[1].getSelected();
      oCtx.invoke(BOUND_START, {
        mode: sMode,
        trigger: sTrigger,
        async: bAsync
      }).then(() => {
        const oB = this.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(oB.getText("actionSuccess"));
        this._oStartDialog.close();
      }).catch(oErr => {
        MessageBox.error(typeof oErr === "object" && oErr && oErr.message || String(oErr));
      });
    },
    onSetScheduleDialog() {
      const oView = this.getView();
      if (!this._oSchedDialog) {
        Fragment.load({
          id: oView,
          name: "pipeline.monitor.fcl.fragments.SetScheduleDialog",
          controller: this
        }).then(oDialog => {
          this._oSchedDialog = oDialog;
          oView.addDependent(oDialog);
          oDialog.getContent()[0].getItems()[1].setValue("60000");
          oDialog.open();
        });
      } else {
        this._oSchedDialog.getContent()[0].getItems()[1].setValue("60000");
        this._oSchedDialog.open();
      }
    },
    onSetScheduleCancel() {
      this._oSchedDialog.close();
    },
    onSetScheduleConfirm() {
      const oCtx = this._getBoundContext();
      if (!oCtx) {
        return;
      }
      const sVal = this._oSchedDialog.getContent()[0].getItems()[1].getValue();
      const iEvery = parseInt(sVal, 10);
      if (Number.isNaN(iEvery) || iEvery <= 0) {
        const oB = this.getView().getModel("i18n").getResourceBundle();
        MessageBox.error(oB.getText("scheduleInvalid"));
        return;
      }
      oCtx.invoke(BOUND_SET_SCHED, {
        every: iEvery
      }).then(() => {
        const oB = this.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(oB.getText("actionSuccess"));
        this._oSchedDialog.close();
      }).catch(oErr => {
        MessageBox.error(typeof oErr === "object" && oErr && oErr.message || String(oErr));
      });
    },
    onClearSchedule() {
      const oCtx = this._getBoundContext();
      if (!oCtx) {
        return;
      }
      oCtx.invoke(BOUND_CLEAR, {}).then(() => {
        const oB = this.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(oB.getText("actionSuccess"));
      }).catch(oErr => {
        MessageBox.error(typeof oErr === "object" && oErr && oErr.message || String(oErr));
      });
    }
  });
  return Detail;
});
//# sourceMappingURL=Detail-dbg.controller.js.map
