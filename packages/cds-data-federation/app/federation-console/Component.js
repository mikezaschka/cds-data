sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
], function (UIComponent, JSONModel) {
    "use strict";

    return UIComponent.extend("federation.console.Component", {
        metadata: { manifest: "json" },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(new JSONModel({
                selectedTab: "entities",
                layout: "OneColumn",
                busy: false,
            }), "ui");
            this.getRouter().initialize();
        },
    });
});
