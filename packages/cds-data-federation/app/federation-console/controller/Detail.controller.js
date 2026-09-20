sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("federation.console.controller.Detail", {

        onInit: function () {
            this.getView().setModel(new JSONModel({ busy: true, renames: [] }), "detail");
            this.getOwnerComponent().getRouter()
                .getRoute("detail").attachPatternMatched(this._onMatched, this);
        },

        model: function () {
            return this.getView().getModel("detail");
        },

        odata: function () {
            return this.getOwnerComponent().getModel();
        },

        _onMatched: function (event) {
            this._entity = decodeURIComponent(event.getParameter("arguments").entity || "");
            this._load();
        },

        _load: function () {
            var m = this.model();
            var that = this;
            m.setProperty("/busy", true);

            var path = "/FederatedEntities('" + encodeURIComponent(this._entity) + "')";
            this.odata().bindContext(path).requestObject()
                .then(function (row) {
                    if (!row) throw new Error("not found");
                    m.setData(Object.assign({ busy: false, renames: [] }, row));
                    m.setProperty("/projectionLabel", row.wildcardProjection
                        ? that._text("projectionWildcard")
                        : (row.projectedColumns || []).join(", "));
                    m.setProperty("/noActions",
                        row.strategy !== "replicate" && !row.cacheStrategy);
                    return that._loadMetrics(row.entity);
                })
                .catch(function () {
                    m.setProperty("/busy", false);
                    MessageBox.error(that._text("loadFailed", [that._entity]));
                });
        },

        /**
         * Metrics are optional: the DelegateMetrics entity only exists when
         * metrics.enabled is set (ADR 0019).
         *
         * Three states, and they must not be conflated — "no rows" says nothing
         * on its own about whether collection is on:
         *   off      metrics.enabled is not set; the entity is not in the model
         *   idle     collecting, but this entity has had no traffic since the
         *            last flush
         *   counted  rows to roll up
         * The API reports `metricsEnabled` so this is read from configuration
         * rather than guessed from an empty result.
         */
        _loadMetrics: function (entity) {
            var m = this.model();
            var that = this;
            var enabled = m.getProperty("/metricsEnabled") === true;

            var settle = function (rows) {
                m.setProperty("/metrics", that._rollup(rows));
                m.setProperty("/hasMetrics", rows.length > 0);
                m.setProperty("/metricsOff", !enabled);
                m.setProperty("/metricsIdle", enabled && rows.length === 0);
                m.setProperty("/busy", false);
            };

            if (!enabled) {
                settle([]);
                return Promise.resolve();
            }

            var filter = "entity eq '" + String(entity).replace(/'/g, "''") + "'";
            return this.odata()
                .bindList("/DelegateMetrics", null, null, null, { $filter: filter })
                .requestContexts(0, 500)
                .then(function (contexts) {
                    settle(contexts.map(function (c) { return c.getObject(); }));
                })
                .catch(function () {
                    // Configuration says on but the entity is unreadable: report
                    // it as off rather than claiming counters that do not exist.
                    enabled = false;
                    settle([]);
                });
        },

        /**
         * Sum the buckets. Averages are recomputed from the summed latency and
         * request count — averaging the per-bucket averages would weight a
         * quiet hour the same as a busy one.
         */
        _rollup: function (rows) {
            var total = rows.reduce(function (acc, r) {
                acc.requests += r.requests || 0;
                acc.errors += r.errors || 0;
                acc.writes += r.writes || 0;
                acc.writeErrors += r.writeErrors || 0;
                acc.latencySumMs += r.latencySumMs || 0;
                return acc;
            }, { requests: 0, errors: 0, writes: 0, writeErrors: 0, latencySumMs: 0 });

            total.avgLatency = total.requests > 0
                ? Math.round(total.latencySumMs / total.requests)
                : 0;
            return total;
        },

        onRefreshReplica: function () {
            this._invoke("refreshReplica");
        },

        onRefreshEntityCache: function () {
            this._invoke("refreshEntityCache");
        },

        onInvalidate: function () {
            this._invoke("invalidate");
        },

        _invoke: function (action) {
            var that = this;
            var m = this.model();
            m.setProperty("/busy", true);
            // The V4 model needs the action's *qualified* name. Over plain HTTP
            // CAP accepts the short form, which is why this only shows up in
            // the UI: "Unknown operation: .../invalidate(...)".
            var path = "/FederatedEntities('" + encodeURIComponent(this._entity) + "')/"
                + "FederationManagementService." + action + "(...)";
            var op = this.odata().bindContext(path);
            op.invoke()
                .then(function () {
                    var result = op.getBoundContext().getObject();
                    MessageToast.show(result && result.message ? result.message : that._text("actionDone"));
                    return that._loadMetrics(that._entity);
                })
                .catch(function (err) {
                    m.setProperty("/busy", false);
                    MessageBox.error(err && err.message ? err.message : that._text("actionFailed"));
                });
        },

        onNavBack: function () {
            this.getOwnerComponent().getModel("ui").setProperty("/layout", "OneColumn");
            this.getOwnerComponent().getRouter().navTo("list", {}, true);
        },

        _text: function (key, args) {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
        },
    });
});
