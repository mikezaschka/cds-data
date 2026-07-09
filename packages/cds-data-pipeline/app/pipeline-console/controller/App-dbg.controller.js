sap.ui.define(["sap/ui/core/mvc/Controller", "pipeline/monitor/fcl/util/FclHelper"], function (Controller, __pipeline_monitor_fcl_util_FclHelper) {
  "use strict";

  const getFcl = __pipeline_monitor_fcl_util_FclHelper["getFcl"];
  const syncFclActionButtonsDeferred = __pipeline_monitor_fcl_util_FclHelper["syncFclActionButtonsDeferred"];
  /**
   * @namespace pipeline.monitor.fcl.controller
   */
  const App = Controller.extend("pipeline.monitor.fcl.controller.App", {
    onInit: function _onInit() {
      const component = this.getOwnerComponent();
      getFcl(this.getView()).attachStateChange(() => {
        syncFclActionButtonsDeferred(component);
      });
    }
  });
  return App;
});
//# sourceMappingURL=App-dbg.controller.js.map
