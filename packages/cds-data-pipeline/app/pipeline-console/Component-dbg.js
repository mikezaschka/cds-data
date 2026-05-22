sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"], function (UIComponent, JSONModel) {
  "use strict";

  const MANIFEST_REFRESH = "/sap.ui5/pipelineConsole/refreshIntervalSeconds";
  const L = {
    one: "OneColumn",
    twoBegin: "TwoColumnsBeginExpanded",
    threeMid: "ThreeColumnsMidExpanded"
  };
  function refreshODataV4Model(oModel) {
    const m = oModel;
    if (!m || typeof m.getGroupId !== "function" || typeof m.refresh !== "function") {
      return;
    }
    m.refresh(m.getGroupId());
  }
  const PipelineConsoleComponent = UIComponent.extend("pipeline.monitor.fcl.Component", {
    metadata: {
      manifest: "json"
    },
    _oRefreshTimer: null,
    init() {
      UIComponent.prototype.init.call(this);
      this.setModel(new JSONModel({
        layout: L.one
      }), "fcl");
      this.getRouter().attachRouteMatched(this._onRouteMatched, this);
      this.getRouter().initialize();
      this._ensureInitialRoute();
      const iSec = this.getManifestEntry(MANIFEST_REFRESH) ?? 30;
      if (iSec > 0) {
        const that = this;
        this._oRefreshTimer = setInterval(function () {
          if (typeof document !== "undefined" && document.hidden) {
            return;
          }
          refreshODataV4Model(that.getModel());
        }, iSec * 1000);
      }
    },
    _ensureInitialRoute() {
      const oRouter = this.getRouter();
      const fnRun = function () {
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
    _onRouteMatched(oEvent) {
      const sName = oEvent.getParameter("name");
      const oFcl = this.getModel("fcl");
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
      UIComponent.prototype.exit.call(this);
    }
  });
  return PipelineConsoleComponent;
});
//# sourceMappingURL=Component-dbg.js.map
