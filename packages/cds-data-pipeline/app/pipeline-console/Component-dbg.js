sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel", "pipeline/monitor/fcl/util/FclHelper"], function (UIComponent, JSONModel, __pipeline_monitor_fcl_util_FclHelper) {
  "use strict";

  const updateLayoutFromRoute = __pipeline_monitor_fcl_util_FclHelper["updateLayoutFromRoute"];
  const syncFclActionButtonsDeferred = __pipeline_monitor_fcl_util_FclHelper["syncFclActionButtonsDeferred"];
  const MANIFEST_REFRESH = "/sap.ui5/pipelineConsole/refreshIntervalSeconds";
  const MANIFEST_RUNNING_REFRESH = "/sap.ui5/pipelineConsole/runningRefreshIntervalSeconds";
  function refreshODataModel(model) {
    if (!model?.refresh || !model.getGroupId) {
      return;
    }
    model.refresh(model.getGroupId());
  }

  /**
   * @namespace pipeline.monitor.fcl
   */
  const Component = UIComponent.extend("pipeline.monitor.fcl.Component", {
    constructor: function constructor() {
      UIComponent.prototype.constructor.apply(this, arguments);
      this.refreshTimer = null;
      this.refreshIntervalMs = 30000;
      this.runningIntervalMs = 3000;
      this.fastPolling = false;
    },
    metadata: {
      manifest: "json"
    },
    init: function _init() {
      UIComponent.prototype.init.call(this);
      this.setModel(new JSONModel({
        layout: "OneColumn",
        actionButtonsInfo: {
          midColumn: {
            fullScreen: null,
            exitFullScreen: null,
            closeColumn: null
          },
          endColumn: {
            fullScreen: null,
            exitFullScreen: null,
            closeColumn: null
          }
        },
        midColumnActions: {
          fullScreen: false,
          exitFullScreen: false,
          closeColumn: false
        },
        endColumnActions: {
          fullScreen: false,
          exitFullScreen: false,
          closeColumn: false
        }
      }), "fcl");
      this.setModel(new JSONModel({
        fastPolling: false
      }), "appState");
      const idleSec = this.getManifestEntry(MANIFEST_REFRESH) ?? 30;
      const runningSec = this.getManifestEntry(MANIFEST_RUNNING_REFRESH) ?? 3;
      this.refreshIntervalMs = Math.max(idleSec, 5) * 1000;
      this.runningIntervalMs = Math.max(runningSec, 1) * 1000;
      this.getRouter().attachRouteMatched(this.onRouteMatched, this);
      this.getRouter().initialize();
      this.ensureInitialRoute();
      this.startPolling(false);
    },
    setFastPolling: function _setFastPolling(enabled) {
      if (this.fastPolling === enabled) {
        return;
      }
      this.fastPolling = enabled;
      this.getModel("appState").setProperty("/fastPolling", enabled);
      this.startPolling(enabled);
    },
    triggerRefresh: function _triggerRefresh() {
      refreshODataModel(this.getModel());
    },
    startPolling: function _startPolling(fast) {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      const interval = fast ? this.runningIntervalMs : this.refreshIntervalMs;
      this.refreshTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) {
          return;
        }
        refreshODataModel(this.getModel());
      }, interval);
    },
    ensureInitialRoute: function _ensureInitialRoute() {
      const router = this.getRouter();
      const run = () => {
        const hashChanger = router.getHashChanger?.();
        let hash = hashChanger?.getHash?.() || window.location.hash.replace(/^#/, "");
        if (!/(^|\/)Pipelines\//.test(hash)) {
          router.navTo("master", {}, true);
        }
      };
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(run));
      } else {
        setTimeout(run, 0);
      }
    },
    onRouteMatched: function _onRouteMatched(event) {
      const routeName = event.getParameter("name");
      const args = event.getParameter("arguments");
      const query = event.getParameter("arguments")?.["?query"];
      updateLayoutFromRoute(this.getModel("fcl"), routeName, query?.layout);
      syncFclActionButtonsDeferred(this);
      if (routeName === "master") {
        this.setFastPolling(false);
      }
      if (args?.name && routeName !== "master") {
        // detail routes may need fast polling once status is running
      }
    },
    exit: function _exit() {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      UIComponent.prototype.exit.call(this);
    }
  });
  return Component;
});
//# sourceMappingURL=Component-dbg.js.map
