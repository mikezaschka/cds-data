sap.ui.define([
    "sap/fe/core/AppComponent"
], function (AppComponent) {
    "use strict";

    var MANIFEST_REFRESH = "/sap.ui5/pipelineMonitor/refreshIntervalSeconds";

    function refreshPipelineMonitorModel(oModel) {
        if (!oModel || typeof oModel.getGroupId !== "function" || typeof oModel.getAllBindings !== "function") {
            return;
        }
        var sGroup = oModel.getGroupId();
        if (typeof oModel.refresh === "function") {
            oModel.refresh(sGroup);
        }
        oModel.getAllBindings().forEach(function (oBinding) {
            if (!oBinding || typeof oBinding.refresh !== "function") {
                return;
            }
            if (oBinding.isRoot && oBinding.isRoot()) {
                return;
            }
            if (oBinding.isResolved && !oBinding.isResolved()) {
                return;
            }
            var bSuspended = oBinding.isSuspended && oBinding.isSuspended();
            try {
                oBinding.refresh(bSuspended ? undefined : sGroup);
            } catch (e) {
                /* property bindings etc. may not support refresh */
            }
        });
    }

    return AppComponent.extend("pipeline.monitor.Component", {
        metadata: { manifest: "json" },

        init: function () {
            AppComponent.prototype.init.apply(this, arguments);
            var iSec = this.getManifestEntry(MANIFEST_REFRESH);
            if (iSec === undefined) {
                iSec = 30;
            }
            if (iSec <= 0) {
                return;
            }
            var iMs = iSec * 1000;
            var that = this;
            this._oPipelineRefreshTimer = setInterval(function () {
                if (typeof document !== "undefined" && document.hidden) {
                    return;
                }
                refreshPipelineMonitorModel(that.getModel());
            }, iMs);
        },

        exit: function () {
            if (this._oPipelineRefreshTimer) {
                clearInterval(this._oPipelineRefreshTimer);
                this._oPipelineRefreshTimer = null;
            }
            AppComponent.prototype.exit.apply(this, arguments);
        }
    });
});
