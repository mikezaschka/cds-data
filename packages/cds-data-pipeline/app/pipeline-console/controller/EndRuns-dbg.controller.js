sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageBox", "sap/ui/model/json/JSONModel", "pipeline/monitor/fcl/util/ODataPath"], function (Controller, MessageBox, JSONModel, __ODataPath) {
  "use strict";

  function _interopRequireDefault(obj) {
    return obj && obj.__esModule && typeof obj.default !== "undefined" ? obj.default : obj;
  }
  const ODataPath = _interopRequireDefault(__ODataPath);
  const EndRuns = Controller.extend("pipeline.monitor.fcl.controller.EndRuns", {
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
    onNavBackMid() {
      const oApp = this.getOwnerComponent().getRootControl();
      const oFcl = oApp.byId("fcl");
      if (oFcl) {
        oFcl.setLayout("TwoColumnsBeginExpanded");
      }
    },
    runStatusState(s) {
      const m = {
        idle: "Success",
        running: "Information",
        failed: "Error"
      };
      return m[s] || "None";
    },
    errorPreview(sErr) {
      if (!sErr) {
        return "";
      }
      const t = String(sErr);
      return t.length > 60 ? t.slice(0, 60) + "…" : t;
    },
    onShowError(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext();
      if (!oCtx) {
        return;
      }
      const sMsg = oCtx.getProperty("error");
      if (sMsg) {
        const oB = this.getView().getModel("i18n").getResourceBundle();
        MessageBox.information(sMsg, {
          title: oB.getText("errDetailTitle")
        });
      }
    }
  });
  return EndRuns;
});
//# sourceMappingURL=EndRuns-dbg.controller.js.map
