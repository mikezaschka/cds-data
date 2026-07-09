sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/Filter", "sap/ui/model/FilterOperator", "sap/ui/model/json/JSONModel", "sap/m/MessageToast", "pipeline/monitor/fcl/util/FlowGraph", "pipeline/monitor/fcl/util/I18n", "pipeline/monitor/fcl/util/Formatters"], function (Controller, Filter, FilterOperator, JSONModel, MessageToast, __pipeline_monitor_fcl_util_FlowGraph, __pipeline_monitor_fcl_util_I18n, __pipeline_monitor_fcl_util_Formatters) {
  "use strict";

  const parseFlowGraphPayload = __pipeline_monitor_fcl_util_FlowGraph["parseFlowGraphPayload"];
  const renderFlowGraph = __pipeline_monitor_fcl_util_FlowGraph["renderFlowGraph"];
  const getText = __pipeline_monitor_fcl_util_I18n["getText"];
  const getTextSync = __pipeline_monitor_fcl_util_I18n["getTextSync"];
  const statusState = __pipeline_monitor_fcl_util_Formatters["statusState"];
  const statusIcon = __pipeline_monitor_fcl_util_Formatters["statusIcon"];
  const statusBadgeIcon = __pipeline_monitor_fcl_util_Formatters["statusBadgeIcon"];
  const errorState = __pipeline_monitor_fcl_util_Formatters["errorState"];
  const formatRelativeTime = __pipeline_monitor_fcl_util_Formatters["formatRelativeTime"];
  const isScheduleEnabled = __pipeline_monitor_fcl_util_Formatters["isScheduleEnabled"];
  const isSchedulePaused = __pipeline_monitor_fcl_util_Formatters["isSchedulePaused"];
  const showScheduleExpression = __pipeline_monitor_fcl_util_Formatters["showScheduleExpression"];
  const schedulingState = __pipeline_monitor_fcl_util_Formatters["schedulingState"];
  const schedulingIcon = __pipeline_monitor_fcl_util_Formatters["schedulingIcon"];
  const scheduleCellLabel = __pipeline_monitor_fcl_util_Formatters["scheduleCellLabel"];
  /**
   * @namespace pipeline.monitor.fcl.controller
   */
  const Master = Controller.extend("pipeline.monitor.fcl.controller.Master", {
    constructor: function constructor() {
      Controller.prototype.constructor.apply(this, arguments);
      this.selectedName = null;
      this.applyingSelection = false;
      this.summaryAttached = false;
      this.overviewLoaded = false;
      this.onMasterMatched = () => {
        this.selectedName = null;
        this.pipelineTable()?.removeSelections();
      };
      this.onDetailMatched = event => {
        const args = event.getParameter("arguments");
        this.selectedName = args?.name ? decodeURIComponent(String(args.name)) : null;
        this.applySelection();
      };
      this.statusState = statusState;
      this.statusIcon = statusIcon;
      this.statusBadgeIcon = statusBadgeIcon;
      this.errorState = errorState;
      this.formatRelativeTime = formatRelativeTime;
      /** Treat null/undefined as enabled so list does not flash Paused. */
      this.isScheduleEnabled = isScheduleEnabled;
      this.isSchedulePaused = isSchedulePaused;
      this.showScheduleExpression = showScheduleExpression;
    },
    onInit: function _onInit() {
      const router = this.getOwnerComponent().getRouter();
      router.getRoute("master")?.attachPatternMatched(this.onMasterMatched, this);
      router.getRoute("detail")?.attachPatternMatched(this.onDetailMatched, this);
      this.getView().setModel(new JSONModel({
        total: 0,
        running: 0,
        failed: 0,
        summary: "",
        landscapeReady: false,
        selectedTab: "pipelines"
      }), "master");
    },
    masterModel: function _masterModel() {
      return this.getView().getModel("master");
    },
    pipelineTable: function _pipelineTable() {
      return this.byId("pipelineTable");
    },
    landscapeGraph: function _landscapeGraph() {
      return this.byId("landscapeGraph");
    },
    setSummaryText: async function _setSummaryText(total, running, failed) {
      const text = await getText(this, "masterSummary", [String(total), String(running), String(failed)]);
      this.masterModel().setProperty("/summary", text);
    },
    attachSummaryListener: function _attachSummaryListener() {
      if (this.summaryAttached) {
        return;
      }
      const binding = this.pipelineTable()?.getBinding("items");
      if (binding) {
        this.summaryAttached = true;
        binding.attachEvent("change", this.updateSummary.bind(this));
      }
    },
    updateSummary: function _updateSummary() {
      const binding = this.pipelineTable()?.getBinding("items");
      const contexts = binding?.getContexts() || [];
      let running = 0;
      let failed = 0;
      contexts.forEach(ctx => {
        const status = ctx.getProperty("status");
        if (status === "running") {
          running++;
        }
        if (status === "failed") {
          failed++;
        }
      });
      this.masterModel().setProperty("/total", contexts.length);
      this.masterModel().setProperty("/running", running);
      this.masterModel().setProperty("/failed", failed);
      void this.setSummaryText(contexts.length, running, failed);
      const component = this.getOwnerComponent();
      component.setFastPolling?.(running > 0);
    },
    applySelection: function _applySelection() {
      const table = this.pipelineTable();
      const name = this.selectedName;
      if (!table || !name) {
        return;
      }
      this.applyingSelection = true;
      const items = table.getItems();
      for (const item of items) {
        const ctx = item.getBindingContext();
        if (ctx?.getProperty("name") === name) {
          table.setSelectedItem(item, true);
          break;
        }
      }
      this.applyingSelection = false;
    },
    onTableUpdateFinished: function _onTableUpdateFinished() {
      this.attachSummaryListener();
      this.applySelection();
      this.updateSummary();
      if (this.masterModel().getProperty("/selectedTab") === "overview") {
        void this.loadLandscapeGraph();
      }
    },
    onMasterTabSelect: function _onMasterTabSelect(event) {
      const key = event.getParameter("item")?.getKey() || "pipelines";
      this.masterModel().setProperty("/selectedTab", key);
      if (key === "overview" && !this.overviewLoaded) {
        void this.loadLandscapeGraph();
      }
    },
    loadLandscapeGraph: async function _loadLandscapeGraph() {
      const graph = this.landscapeGraph();
      if (!graph) {
        return;
      }
      try {
        const model = this.getOwnerComponent().getModel();
        const binding = model.bindContext("/landscapeMetadata(...)", null, {
          $$groupId: "$direct"
        });
        await binding.execute();
        const raw = binding.getBoundContext()?.getObject();
        const payload = parseFlowGraphPayload(raw);
        renderFlowGraph(graph, payload);
        this.masterModel().setProperty("/landscapeReady", !!payload?.nodes?.length);
        this.overviewLoaded = true;
      } catch {
        renderFlowGraph(graph, null);
        this.masterModel().setProperty("/landscapeReady", false);
      }
    },
    onSelectionChange: function _onSelectionChange(event) {
      if (this.applyingSelection) {
        return;
      }
      const item = event.getParameter("listItem");
      const ctx = item?.getBindingContext();
      const name = ctx?.getProperty("name");
      if (!name) {
        return;
      }
      this.getOwnerComponent().getRouter().navTo("detail", {
        name: encodeURIComponent(String(name))
      }, true);
    },
    onSearch: function _onSearch(event) {
      const query = event.getParameter("query");
      const binding = this.pipelineTable()?.getBinding("items");
      if (!binding) {
        return;
      }
      if (!query?.trim()) {
        binding.filter([]);
        return;
      }
      binding.filter([new Filter("name", FilterOperator.Contains, query.trim())]);
    },
    onRefresh: async function _onRefresh() {
      const model = this.getOwnerComponent().getModel();
      model?.refresh();
      if (this.masterModel().getProperty("/selectedTab") === "overview") {
        void this.loadLandscapeGraph();
      }
      MessageToast.show(await getText(this, "refreshDone"));
    },
    formatScheduleCellLabel: function _formatScheduleCellLabel(schedule, enabled) {
      return scheduleCellLabel(schedule, enabled, {
        notScheduled: getTextSync(this, "notScheduled"),
        active: getTextSync(this, "statusEnabled"),
        paused: getTextSync(this, "statusPaused")
      });
    },
    formatSchedulingLabel: function _formatSchedulingLabel(schedule, enabled) {
      return this.formatScheduleCellLabel(schedule, enabled);
    },
    formatSchedulingState: function _formatSchedulingState(schedule, enabled) {
      return schedulingState(schedule, enabled);
    },
    formatSchedulingIcon: function _formatSchedulingIcon(schedule, enabled) {
      return schedulingIcon(schedule, enabled);
    },
    formatEnabledLabel: function _formatEnabledLabel(enabled) {
      return this.isScheduleEnabled(enabled) ? getTextSync(this, "statusEnabled") : getTextSync(this, "statusPaused");
    },
    formatEnabledState: function _formatEnabledState(enabled) {
      return this.isScheduleEnabled(enabled) ? "Success" : "Warning";
    },
    formatLastRun: function _formatLastRun(value) {
      if (value == null || value === "") {
        return getTextSync(this, "neverRun");
      }
      return formatRelativeTime(value);
    },
    rowHighlight: function _rowHighlight(status, schedule, enabled) {
      const key = String(status ?? "").trim().toLowerCase();
      if (key === "failed") {
        return "Error";
      }
      if (key === "running") {
        return "Information";
      }
      if (isSchedulePaused(schedule, enabled)) {
        return "Warning";
      }
      return "None";
    },
    formatStatusLabel: function _formatStatusLabel(status) {
      const key = String(status ?? "").trim().toLowerCase();
      const i18nKeys = {
        idle: "statusLabelIdle",
        running: "statusLabelRunning",
        failed: "statusLabelFailed"
      };
      const i18nKey = i18nKeys[key];
      return i18nKey ? getTextSync(this, i18nKey) : String(status ?? "");
    },
    statusTooltip: function _statusTooltip(status) {
      const key = String(status ?? "").trim().toLowerCase();
      if (key === "running") {
        return getTextSync(this, "statusTooltipRunning");
      }
      if (key === "failed") {
        return getTextSync(this, "statusTooltipFailed");
      }
      return getTextSync(this, "statusTooltipIdle");
    }
  });
  return Master;
});
//# sourceMappingURL=Master-dbg.controller.js.map
