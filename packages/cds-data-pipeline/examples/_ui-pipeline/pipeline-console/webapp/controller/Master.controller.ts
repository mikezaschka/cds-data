import Controller from "sap/ui/core/mvc/Controller";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import type { default as ListItem } from "sap/m/ColumnListItem";
import type Table from "sap/m/Table";

type MasterController = {
    _sSelectedName?: string | null;
    _bApplyingSelection?: boolean;
    byId: (id: string) => Table | null;
} & {
    getOwnerComponent: () => { getRouter: () => { getRoute: (n: string) => { attachPatternMatched: (fn: unknown, ctx: object) => void } } };
};

const Master = Controller.extend("pipeline.monitor.fcl.controller.Master", {
    onInit(this: MasterController) {
        const oRouter = this.getOwnerComponent().getRouter();
        oRouter.getRoute("master").attachPatternMatched(this._onMasterMatched, this);
        oRouter.getRoute("detail").attachPatternMatched(this._onDetailMatched, this);
    },

    _onMasterMatched(this: MasterController) {
        this._sSelectedName = null;
        const oTable = this.byId("pipelineTable");
        if (oTable) {
            oTable.removeSelections();
        }
    },

    _onDetailMatched(this: MasterController, oEvent: { getParameter: (n: string) => { name?: string } | undefined }) {
        const oArgs = oEvent.getParameter("arguments");
        this._sSelectedName = oArgs && oArgs.name ? decodeURIComponent(String(oArgs.name)) : null;
        this._applySelection();
    },

    _applySelection(this: MasterController) {
        const sName = this._sSelectedName;
        const oTable = this.byId("pipelineTable");
        if (!oTable || !sName) {
            return;
        }
        this._bApplyingSelection = true;
        const aItems = oTable.getItems() as ListItem[];
        for (let i = 0; i < aItems.length; i++) {
            const oCtx = aItems[i].getBindingContext();
            if (oCtx && oCtx.getProperty("name") === sName) {
                oTable.setSelectedItem(aItems[i], true);
                break;
            }
        }
        this._bApplyingSelection = false;
    },

    onTableUpdateFinished(this: MasterController) {
        this._applySelection();
    },

    onSelectionChange(
        this: MasterController,
        oEvent: { getParameter: (n: string) => ListItem | null | undefined }
    ) {
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
        this.getOwnerComponent()
            .getRouter()
            .navTo("detail", { name: encodeURIComponent(String(sName)) }, true);
    },

    onSearch(this: MasterController, oEvent: { getParameter: (n: string) => string }) {
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
});

export default Master;
