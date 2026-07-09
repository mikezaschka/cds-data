import Controller from "sap/ui/core/mvc/Controller";
import type UIComponent from "sap/ui/core/UIComponent";
import { getFcl, syncFclActionButtonsDeferred } from "pipeline/monitor/fcl/util/FclHelper";

/**
 * @namespace pipeline.monitor.fcl.controller
 */
export default class App extends Controller {
    onInit(): void {
        const component = this.getOwnerComponent() as UIComponent;
        getFcl(this.getView()).attachStateChange(() => {
            syncFclActionButtonsDeferred(component);
        });
    }
}
