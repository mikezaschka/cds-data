sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"], function (Controller, Filter, FilterOperator) {
  "use strict";

  const Master = Controller.extend("pipeline.monitor.fcl.controller.Master", {
    onInit() {
      const oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("master").attachPatternMatched(this._onMasterMatched, this);
      oRouter.getRoute("detail").attachPatternMatched(this._onDetailMatched, this);
    },
    _onMasterMatched() {
      this._sSelectedName = null;
      const oTable = this.byId("pipelineTable");
      if (oTable) {
        oTable.removeSelections();
      }
    },
    _onDetailMatched(oEvent) {
      const oArgs = oEvent.getParameter("arguments");
      this._sSelectedName = oArgs && oArgs.name ? decodeURIComponent(String(oArgs.name)) : null;
      this._applySelection();
    },
    _applySelection() {
      const sName = this._sSelectedName;
      const oTable = this.byId("pipelineTable");
      if (!oTable || !sName) {
        return;
      }
      this._bApplyingSelection = true;
      const aItems = oTable.getItems();
      for (let i = 0; i < aItems.length; i++) {
        const oCtx = aItems[i].getBindingContext();
        if (oCtx && oCtx.getProperty("name") === sName) {
          oTable.setSelectedItem(aItems[i], true);
          break;
        }
      }
      this._bApplyingSelection = false;
    },
    onTableUpdateFinished() {
      this._applySelection();
    },
    onSelectionChange(oEvent) {
      if (this._bApplyingSelection) {
        return;
      }
      const oItem = oEvent.getParameter("listItem");
      if (!oItem) {
        return;
      }
      const oCtx = oItem.getBindingContext();
      if (!oCtx) {
        return;
      }
      const sName = oCtx.getProperty("name");
      if (!sName) {
        return;
      }
      this.getOwnerComponent().getRouter().navTo("detail", {
        name: encodeURIComponent(String(sName))
      }, true);
    },
    onSearch(oEvent) {
      const sQuery = oEvent.getParameter("query");
      const oTable = this.byId("pipelineTable");
      if (!oTable) {
        return;
      }
      const oBinding = oTable.getBinding("items");
      if (!oBinding) {
        return;
      }
      if (!sQuery || sQuery.trim() === "") {
        oBinding.filter([]);
        return;
      }
      oBinding.filter([new Filter("name", FilterOperator.Contains, sQuery.trim())]);
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
    }
  });
  return Master;
});
//# sourceMappingURL=Master-dbg.controller.js.map
