sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/suite/ui/commons/networkgraph/Node",
    "sap/suite/ui/commons/networkgraph/Line",
    "sap/suite/ui/commons/networkgraph/Group",
    "sap/suite/ui/commons/networkgraph/ElementAttribute",
], function (Controller, Filter, FilterOperator, MessageToast, Node, Line, Group, ElementAttribute) {
    "use strict";

    /** Node keys need a stable prefix per kind so services and views cannot collide. */
    var SERVICE = "svc:";
    var ENTITY = "ent:";
    var REMOTE_GROUP = "remote";

    return Controller.extend("federation.console.controller.List", {

        onInit: function () {
            this.ui().setProperty("/strategyFilter", "all");
            this.ui().setProperty("/landscapeReady", false);
            this._syncMetricsState();
            this.getOwnerComponent().getRouter()
                .getRoute("detail").attachPatternMatched(this._syncSelection, this);
        },

        ui: function () {
            return this.getOwnerComponent().getModel("ui");
        },

        table: function () {
            return this.byId("entityTable");
        },

        /** Keep the row highlighted when a detail URL is opened directly. */
        _syncSelection: function (event) {
            var entity = decodeURIComponent(event.getParameter("arguments").entity || "");
            var table = this.table();
            if (!table) return;
            var item = table.getItems().find(function (row) {
                var ctx = row.getBindingContext();
                return ctx && ctx.getProperty("entity") === entity;
            });
            if (item) table.setSelectedItem(item);
        },

        onSelectionChange: function (event) {
            var ctx = event.getParameter("listItem").getBindingContext();
            var entity = ctx && ctx.getProperty("entity");
            if (!entity) return;
            this.ui().setProperty("/layout", "TwoColumnsMidExpanded");
            this.getOwnerComponent().getRouter()
                .navTo("detail", { entity: encodeURIComponent(entity) }, false);
        },

        onSearch: function (event) {
            var query = (event.getParameter("query") || "").trim();
            this._applyFilters(query);
        },

        onFilterStrategy: function () {
            this._applyFilters();
        },

        _applyFilters: function (query) {
            var binding = this.table().getBinding("items");
            if (!binding) return;
            if (query !== undefined) this._query = query;

            var filters = [];
            var strategy = this.ui().getProperty("/strategyFilter");
            if (strategy && strategy !== "all") {
                filters.push(new Filter("strategy", FilterOperator.EQ, strategy));
            }
            if (this._query) {
                filters.push(new Filter({
                    filters: [
                        new Filter("entity", FilterOperator.Contains, this._query),
                        new Filter("sourceService", FilterOperator.Contains, this._query),
                    ],
                    and: false,
                }));
            }
            binding.filter(filters);
        },

        /**
         * Pause or resume metric collection. Only reachable when metrics are
         * configured; the switch is hidden otherwise, because a runtime toggle
         * cannot instrument handlers that were never wrapped (ADR 0019).
         */
        onToggleMetrics: function (event) {
            var that = this;
            var wanted = event.getParameter("state");
            var model = this.getOwnerComponent().getModel();
            var op = model.bindContext("/setMetricsCollection(...)");
            op.setParameter("enabled", wanted);
            op.invoke()
                .then(function () {
                    var result = op.getBoundContext().getObject();
                    that.ui().setProperty("/metricsCollecting", result.collecting);
                    MessageToast.show(result.message);
                    model.refresh();
                })
                .catch(function (err) {
                    // Put the switch back where it was: the server did not move.
                    that.ui().setProperty("/metricsCollecting", !wanted);
                    MessageToast.show(err && err.message ? err.message : "Could not change metric collection");
                });
        },

        /** Mirror the metrics state onto the ui model so the header can bind it. */
        _syncMetricsState: function () {
            var that = this;
            this.getOwnerComponent().getModel()
                .bindList("/FederatedEntities").requestContexts(0, 1)
                .then(function (contexts) {
                    var row = contexts.length ? contexts[0].getObject() : null;
                    that.ui().setProperty("/metricsEnabled", !!(row && row.metricsEnabled));
                    that.ui().setProperty("/metricsCollecting", !!(row && row.metricsCollecting));
                })
                .catch(function () {
                    that.ui().setProperty("/metricsEnabled", false);
                });
        },

        onRefresh: function () {
            this.getOwnerComponent().getModel().refresh();
            this._landscapeLoaded = false;
            if (this.ui().getProperty("/selectedTab") === "overview") this._loadLandscape();
        },

        onTabSelect: function (event) {
            var key = event.getParameter("key");
            // The landscape is a full-width view: in the begin column of a
            // two-column layout it renders into ~290px and is unreadable.
            if (key === "overview") {
                this._layoutBeforeGraph = this.ui().getProperty("/layout");
                this.ui().setProperty("/layout", "OneColumn");
                if (!this._landscapeLoaded) this._loadLandscape();
            } else if (this._layoutBeforeGraph) {
                this.ui().setProperty("/layout", this._layoutBeforeGraph);
                this._layoutBeforeGraph = null;
            }
        },

        /**
         * The landscape: remote services on the left, consumption views on the
         * right, one line per federated entity. Built from the same inventory
         * the table shows, because /federation already carries sourceService,
         * strategy and cacheStrategy.
         */
        _loadLandscape: function () {
            var graph = this.byId("landscapeGraph");
            var that = this;
            if (!graph) return;

            this.getOwnerComponent().getModel()
                .bindList("/FederatedEntities").requestContexts(0, 500)
                .then(function (contexts) {
                    that._renderLandscape(graph, contexts.map(function (c) { return c.getObject(); }));
                    that._landscapeLoaded = true;
                })
                .catch(function () {
                    graph.destroyNodes();
                    graph.destroyLines();
                    graph.destroyGroups();
                    that.ui().setProperty("/landscapeReady", false);
                });
        },

        _renderLandscape: function (graph, rows) {
            // destroy, not removeAll: the control keeps the detached aggregation
            // content alive otherwise, and a refresh then doubles every node.
            graph.destroyNodes();
            graph.destroyLines();
            graph.destroyGroups();

            if (!rows.length) {
                this.ui().setProperty("/landscapeReady", false);
            this._syncMetricsState();
                return;
            }

            // Every node naming a group needs that group to exist, or the whole
            // graph refuses to render with "Inconsistent model: Node belonging
            // to a nonexistent group" — and paints nothing but its toolbar.
            graph.addGroup(new Group({ key: REMOTE_GROUP, title: "Remote services" }));

            var services = {};
            rows.forEach(function (row) {
                if (row.sourceService) services[row.sourceService] = true;
            });

            Object.keys(services).forEach(function (name) {
                graph.addNode(new Node({
                    key: SERVICE + name,
                    title: name,
                    group: REMOTE_GROUP,
                    shape: "Box",
                }));
            });

            rows.forEach(function (row) {
                graph.addNode(new Node({
                    key: ENTITY + row.entity,
                    title: row.name,
                    shape: "Box",
                    // A delegate is live, a replica is a local table: the status
                    // colour carries that distinction at a glance.
                    status: row.strategy === "replicate" ? "Success" : "Standard",
                    attributes: [
                        new ElementAttribute({ label: "strategy", value: row.strategy }),
                        new ElementAttribute({ label: "cache", value: row.cacheStrategy || "none" }),
                    ],
                }));
                if (row.sourceService) {
                    graph.addLine(new Line({ from: SERVICE + row.sourceService, to: ENTITY + row.entity }));
                }
            });

            this.ui().setProperty("/landscapeReady", true);
        },


    });
});
