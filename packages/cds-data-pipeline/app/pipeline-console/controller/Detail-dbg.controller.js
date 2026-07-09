sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/core/Fragment", "sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/model/json/JSONModel", "sap/ui/Device", "sap/m/Column", "sap/m/ColumnListItem", "sap/m/Text", "sap/ui/core/Item", "pipeline/monitor/fcl/util/ODataPath", "pipeline/monitor/fcl/util/ODataAction", "pipeline/monitor/fcl/util/I18n", "pipeline/monitor/fcl/util/FclHelper", "pipeline/monitor/fcl/util/FlowGraph", "pipeline/monitor/fcl/util/Formatters", "pipeline/monitor/fcl/util/OverrideFields"], function (Controller, Fragment, MessageBox, MessageToast, JSONModel, Device, Column, ColumnListItem, Text, Item, __pipeline_monitor_fcl_util_ODataPath, __pipeline_monitor_fcl_util_ODataAction, __pipeline_monitor_fcl_util_I18n, __pipeline_monitor_fcl_util_FclHelper, __pipeline_monitor_fcl_util_FlowGraph, __pipeline_monitor_fcl_util_Formatters, __pipeline_monitor_fcl_util_OverrideFields) {
  "use strict";

  const pipelinesEntity = __pipeline_monitor_fcl_util_ODataPath["pipelinesEntity"];
  const inspectCapabilitiesFunction = __pipeline_monitor_fcl_util_ODataPath["inspectCapabilitiesFunction"];
  const inspectDataFunction = __pipeline_monitor_fcl_util_ODataPath["inspectDataFunction"];
  const getEntityContext = __pipeline_monitor_fcl_util_ODataAction["getEntityContext"];
  const invokeBoundAction = __pipeline_monitor_fcl_util_ODataAction["invokeBoundAction"];
  const invokeBoundFunction = __pipeline_monitor_fcl_util_ODataAction["invokeBoundFunction"];
  const invokeUnboundAction = __pipeline_monitor_fcl_util_ODataAction["invokeUnboundAction"];
  const parseODataJsonValue = __pipeline_monitor_fcl_util_ODataAction["parseODataJsonValue"];
  const getText = __pipeline_monitor_fcl_util_I18n["getText"];
  const getTextSync = __pipeline_monitor_fcl_util_I18n["getTextSync"];
  const getFcl = __pipeline_monitor_fcl_util_FclHelper["getFcl"];
  const getSemanticHelper = __pipeline_monitor_fcl_util_FclHelper["getSemanticHelper"];
  const setFclLayout = __pipeline_monitor_fcl_util_FclHelper["setFclLayout"];
  const syncFclActionButtonsDeferred = __pipeline_monitor_fcl_util_FclHelper["syncFclActionButtonsDeferred"];
  const isMidColumnFullScreen = __pipeline_monitor_fcl_util_FclHelper["isMidColumnFullScreen"];
  const parseFlowGraphPayload = __pipeline_monitor_fcl_util_FlowGraph["parseFlowGraphPayload"];
  const renderFlowGraph = __pipeline_monitor_fcl_util_FlowGraph["renderFlowGraph"];
  const fitFlowGraphToView = __pipeline_monitor_fcl_util_FlowGraph["fitFlowGraphToView"];
  const statusState = __pipeline_monitor_fcl_util_Formatters["statusState"];
  const statusIcon = __pipeline_monitor_fcl_util_Formatters["statusIcon"];
  const errorState = __pipeline_monitor_fcl_util_Formatters["errorState"];
  const formatJson = __pipeline_monitor_fcl_util_Formatters["formatJson"];
  const formatTimestamp = __pipeline_monitor_fcl_util_Formatters["formatTimestamp"];
  const formatRelativeTime = __pipeline_monitor_fcl_util_Formatters["formatRelativeTime"];
  const placeholder = __pipeline_monitor_fcl_util_Formatters["placeholder"];
  const runDuration = __pipeline_monitor_fcl_util_Formatters["runDuration"];
  const errorPreview = __pipeline_monitor_fcl_util_Formatters["errorPreview"];
  const isScheduleEnabled = __pipeline_monitor_fcl_util_Formatters["isScheduleEnabled"];
  const hasActiveSchedule = __pipeline_monitor_fcl_util_Formatters["hasActiveSchedule"];
  const isSchedulePaused = __pipeline_monitor_fcl_util_Formatters["isSchedulePaused"];
  const schedulingState = __pipeline_monitor_fcl_util_Formatters["schedulingState"];
  const schedulingIcon = __pipeline_monitor_fcl_util_Formatters["schedulingIcon"];
  const scheduleCellLabel = __pipeline_monitor_fcl_util_Formatters["scheduleCellLabel"];
  const createOverrideEditState = __pipeline_monitor_fcl_util_OverrideFields["createOverrideEditState"];
  const buildOverrideValue = __pipeline_monitor_fcl_util_OverrideFields["buildOverrideValue"];
  const overrideFieldI18nKey = __pipeline_monitor_fcl_util_OverrideFields["overrideFieldI18nKey"];
  const BOUND_START = "DataPipelineManagementService.start";
  const BOUND_SET_SCHED = "DataPipelineManagementService.setSchedule";
  const BOUND_CLEAR = "DataPipelineManagementService.clearSchedule";
  const BOUND_SET_ENABLED = "DataPipelineManagementService.setEnabled";
  const BOUND_SET_OVERRIDES = "DataPipelineManagementService.setOverrides";
  const BOUND_CLEAR_OVERRIDES = "DataPipelineManagementService.clearOverrides";
  const BOUND_FLOW = "DataPipelineManagementService.flowMetadata";
  const BOUND_CONFIG_VIEW = "DataPipelineManagementService.configView";
  const DEFAULT_SCHEDULE_MS = 60000;
  const INSPECT_PAGE_SIZE = 50;
  const EMPTY_INSPECT_SIDE = {
    busy: false,
    ready: false,
    loaded: false,
    hasMore: false,
    limitedSupport: false,
    rowCount: 0,
    columns: [],
    rows: []
  };

  /**
   * @namespace pipeline.monitor.fcl.controller
   */
  const Detail = Controller.extend("pipeline.monitor.fcl.controller.Detail", {
    constructor: function constructor() {
      Controller.prototype.constructor.apply(this, arguments);
      this.pipelineName = null;
      this.inspectSkip = {
        source: 0,
        target: 0
      };
      this.inspectFilters = {
        source: [],
        target: []
      };
      this.inspectSelectedColumns = {
        source: [],
        target: []
      };
      this.inspectLoaded = {
        source: false,
        target: false
      };
      this.filterDialogSide = "source";
      this.onRouteMatched = event => {
        const args = event.getParameter("arguments");
        const name = args?.name ? decodeURIComponent(String(args.name)) : null;
        if (!name) {
          return;
        }
        this.pipelineName = name;
        const detail = this.detailModel();
        detail.setProperty("/ready", false);
        detail.setProperty("/bindError", "");
        detail.setProperty("/runCount", 0);
        detail.setProperty("/schedulePaused", false);
        detail.setProperty("/flowReady", false);
        detail.setProperty("/inspectSourceEnabled", false);
        detail.setProperty("/inspectTargetEnabled", false);
        detail.setProperty("/inspectSourceLimited", false);
        detail.setProperty("/inspectTargetLimited", false);
        detail.setProperty("/inspect/source", {
          ...EMPTY_INSPECT_SIDE
        });
        detail.setProperty("/inspect/target", {
          ...EMPTY_INSPECT_SIDE
        });
        this.inspectSkip = {
          source: 0,
          target: 0
        };
        this.inspectFilters = {
          source: [],
          target: []
        };
        this.inspectSelectedColumns = {
          source: [],
          target: []
        };
        this.inspectLoaded = {
          source: false,
          target: false
        };
        this.getView().bindElement({
          path: pipelinesEntity(name),
          parameters: {
            $expand: "runs"
          },
          events: {
            dataRequested: () => detail.setProperty("/busy", true),
            dataReceived: () => {
              detail.setProperty("/busy", false);
              detail.setProperty("/ready", true);
              this.updateDetailFromEntity();
              void this.loadFlowGraph();
              void this.loadInspectCapabilities();
              void this.loadConfigView();
              this.updatePolling();
            },
            change: changeEvent => {
              if (changeEvent.getParameter("reason") === "Change") {
                this.updateDetailFromEntity();
                void this.loadFlowGraph();
                void this.loadConfigView();
                this.updatePolling();
              }
            }
          }
        });
        syncFclActionButtonsDeferred(this.getOwnerComponent());
      };
      /**
       * True when scheduling is active. Treats null/undefined as enabled so the
       * badge does not flicker to "Paused" before the entity binding resolves.
       * Accepts OData booleans and SQLite 0/1 that may surface before casting.
       */
      this.isScheduleEnabled = isScheduleEnabled;
      this.isSchedulePaused = isSchedulePaused;
      this.statusState = statusState;
      this.statusIcon = statusIcon;
      this.errorState = errorState;
      this.formatJson = formatJson;
      this.formatTimestamp = formatTimestamp;
      this.formatRelativeTime = formatRelativeTime;
      this.runDuration = runDuration;
      this.errorPreview = errorPreview;
    },
    onInit: function _onInit() {
      const router = this.getOwnerComponent().getRouter();
      router.getRoute("detail")?.attachPatternMatched(this.onRouteMatched, this);
      this.getView().setModel(new JSONModel({
        showBack: !!Device.system.phone
      }), "device");
      this.getView().setModel(new JSONModel({
        ready: false,
        busy: false,
        flowReady: false,
        bindError: "",
        runCount: 0,
        schedulePaused: false,
        inspectSourceEnabled: false,
        inspectTargetEnabled: false,
        inspectSourceLimited: false,
        inspectTargetLimited: false,
        configView: {
          fields: [],
          meta: {
            scheduleLiveChangeSupported: true,
            overridablePaths: []
          },
          overrides: {}
        },
        overrideEdit: {
          path: "",
          kind: "string",
          selectKey: "",
          textValue: "",
          booleanValue: true,
          scheduleKind: "interval",
          scheduleEvery: "60000",
          scheduleCron: "",
          scheduleEngine: "spawn"
        },
        inspect: {
          source: {
            ...EMPTY_INSPECT_SIDE
          },
          target: {
            ...EMPTY_INSPECT_SIDE
          }
        }
      }), "detail");
      const fclModel = this.getOwnerComponent().getModel("fcl");
      if (fclModel) {
        this.getView().setModel(fclModel, "fcl");
      }
    },
    detailModel: function _detailModel() {
      return this.getView().getModel("detail");
    },
    updatePolling: function _updatePolling() {
      const status = getEntityContext(this)?.getProperty("status");
      const component = this.getOwnerComponent();
      component.setFastPolling?.(status === "running");
    },
    updateDetailFromEntity: function _updateDetailFromEntity() {
      const ctx = getEntityContext(this);
      if (!ctx) {
        return;
      }
      const data = ctx.getObject();
      const runs = data?.runs || [];
      const detail = this.detailModel();
      detail.setProperty("/runCount", runs.length);
      detail.setProperty("/schedulePaused", isSchedulePaused(ctx.getProperty("schedule"), ctx.getProperty("enabled")));
    },
    onCloseMidColumn: function _onCloseMidColumn() {
      const component = this.getOwnerComponent();
      const fcl = getFcl(component.getRootControl());
      const closeLayout = getSemanticHelper(fcl).getCurrentUIState().actionButtonsInfo.midColumn.closeColumn;
      if (closeLayout) {
        setFclLayout(component, closeLayout);
      }
      component.getRouter().navTo("master", {}, true);
    },
    onMidFullScreen: function _onMidFullScreen() {
      const component = this.getOwnerComponent();
      const fcl = getFcl(component.getRootControl());
      const info = getSemanticHelper(fcl).getCurrentUIState().actionButtonsInfo.midColumn;
      if (info.fullScreen) {
        setFclLayout(component, info.fullScreen);
      } else if (info.exitFullScreen) {
        setFclLayout(component, info.exitFullScreen);
      }
      syncFclActionButtonsDeferred(component);
    },
    formatMidFullScreenIcon: function _formatMidFullScreenIcon(layout) {
      return isMidColumnFullScreen(layout) ? "sap-icon://exit-full-screen" : "sap-icon://full-screen";
    },
    formatMidFullScreenTooltip: function _formatMidFullScreenTooltip(layout) {
      return isMidColumnFullScreen(layout) ? getTextSync(this, "exitFullScreen") : getTextSync(this, "enterFullScreen");
    },
    refreshAfterAction: function _refreshAfterAction() {
      this.getView().getElementBinding()?.refresh();
      this.getOwnerComponent().getModel()?.refresh();
      void this.loadConfigView();
    },
    loadConfigView: async function _loadConfigView() {
      if (!this.pipelineName || !getEntityContext(this)) {
        return;
      }
      try {
        // Relative name + entity context (same pattern as flowMetadata).
        // Do NOT pass an absolute /Pipelines(...)/... path — bindContext
        // would concatenate it onto the context and CAP returns 404.
        const raw = await invokeBoundFunction(this, BOUND_CONFIG_VIEW);
        const view = parseODataJsonValue(raw);
        this.detailModel().setProperty("/configView", {
          fields: view?.fields || [],
          meta: view?.meta || {
            scheduleLiveChangeSupported: true,
            overridablePaths: []
          },
          overrides: view?.overrides || {}
        });
      } catch {
        // Non-fatal: overview still works without the diff table.
        this.detailModel().setProperty("/configView/fields", []);
      }
    },
    formatScheduleCellLabel: function _formatScheduleCellLabel(schedule, enabled) {
      return scheduleCellLabel(schedule, enabled, {
        notScheduled: getTextSync(this, "notScheduled"),
        active: getTextSync(this, "statusEnabled"),
        paused: getTextSync(this, "statusPaused")
      });
    },
    formatSchedulingState: function _formatSchedulingState(schedule, enabled) {
      return schedulingState(schedule, enabled);
    },
    formatSchedulingIcon: function _formatSchedulingIcon(schedule, enabled) {
      return schedulingIcon(schedule, enabled);
    },
    canToggleSchedulePause: function _canToggleSchedulePause(schedule, ready) {
      return !!ready && hasActiveSchedule(schedule);
    },
    pauseScheduleTooltip: function _pauseScheduleTooltip(schedule, ready) {
      return this.canToggleSchedulePause(schedule, ready) ? "" : getTextSync(this, "pauseNoScheduleTooltip");
    },
    formatEnabledLabel: function _formatEnabledLabel(enabled) {
      return this.isScheduleEnabled(enabled) ? getTextSync(this, "statusEnabled") : getTextSync(this, "statusPaused");
    },
    formatEnabledState: function _formatEnabledState(enabled) {
      return this.isScheduleEnabled(enabled) ? "Success" : "Warning";
    },
    formatOverrideCell: function _formatOverrideCell(value) {
      if (value === null || value === undefined) {
        return "—";
      }
      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    },
    formatOverrideFieldLabel: function _formatOverrideFieldLabel(path) {
      const key = overrideFieldI18nKey(path, "overrideLabel");
      const text = getTextSync(this, key);
      return text === key ? path : text;
    },
    formatOverrideFieldHelp: function _formatOverrideFieldHelp(path) {
      const key = overrideFieldI18nKey(path, "overrideHelp");
      const text = getTextSync(this, key);
      return text === key ? "" : text;
    },
    showActionError: function _showActionError(error) {
      MessageBox.error(typeof error === "object" && error?.message ? error.message : String(error));
    },
    requireContext: function _requireContext() {
      const ctx = getEntityContext(this);
      if (!ctx) {
        void getText(this, "contextNotReady").then(text => MessageBox.warning(text));
      }
      return ctx;
    },
    onNavBack: function _onNavBack() {
      this.getOwnerComponent().getRouter().navTo("master", {}, true);
    },
    selectInspectTab: function _selectInspectTab(side) {
      const enabled = this.detailModel().getProperty(side === "source" ? "/inspectSourceEnabled" : "/inspectTargetEnabled");
      if (!enabled) {
        return;
      }
      const tabBar = this.byId("iconTabBar");
      tabBar?.setSelectedKey(side === "source" ? "inspectSource" : "inspectTarget");
    },
    onGraphNodePress: function _onGraphNodePress(event) {
      const node = event.getParameter("node");
      const key = node?.getKey();
      if (key === "source") {
        this.selectInspectTab("source");
      } else if (key === "target") {
        this.selectInspectTab("target");
      }
    },
    onDetailTabSelect: function _onDetailTabSelect(event) {
      const key = event.getParameter("key");
      if (key === "flow") {
        void this.loadFlowGraph({
          fit: true
        });
      }
    },
    isFlowTabSelected: function _isFlowTabSelected() {
      return this.byId("iconTabBar")?.getSelectedKey() === "flow";
    },
    onInspectSourceLoadData: function _onInspectSourceLoadData() {
      void this.loadInspectSide("source");
    },
    onInspectTargetLoadData: function _onInspectTargetLoadData() {
      void this.loadInspectSide("target");
    },
    onInspectSourceColumnsChange: function _onInspectSourceColumnsChange(event) {
      this.onInspectColumnsChange("source", event);
    },
    onInspectTargetColumnsChange: function _onInspectTargetColumnsChange(event) {
      this.onInspectColumnsChange("target", event);
    },
    onInspectSourceRefresh: function _onInspectSourceRefresh() {
      void this.refreshInspectSide("source");
    },
    onInspectTargetRefresh: function _onInspectTargetRefresh() {
      void this.refreshInspectSide("target");
    },
    onInspectSourceLoadMore: function _onInspectSourceLoadMore() {
      this.onInspectLoadMore("source");
    },
    onInspectTargetLoadMore: function _onInspectTargetLoadMore() {
      this.onInspectLoadMore("target");
    },
    onInspectSourceAdvancedFilter: function _onInspectSourceAdvancedFilter() {
      void this.openInspectFilterDialog("source");
    },
    onInspectTargetAdvancedFilter: function _onInspectTargetAdvancedFilter() {
      void this.openInspectFilterDialog("target");
    },
    loadInspectCapabilities: async function _loadInspectCapabilities() {
      if (!this.pipelineName) {
        return;
      }
      try {
        const odata = this.getOwnerComponent().getModel();
        const binding = odata.bindContext(inspectCapabilitiesFunction(this.pipelineName));
        await binding.requestObject();
        const caps = parseODataJsonValue(binding.getBoundContext()?.getObject());
        const detail = this.detailModel();
        detail.setProperty("/inspectSourceEnabled", caps?.source === "full" || caps?.source === "limited");
        detail.setProperty("/inspectTargetEnabled", caps?.target === "full" || caps?.target === "limited");
        detail.setProperty("/inspectSourceLimited", caps?.source === "limited");
        detail.setProperty("/inspectTargetLimited", caps?.target === "limited");
      } catch {
        this.detailModel().setProperty("/inspectSourceEnabled", false);
        this.detailModel().setProperty("/inspectTargetEnabled", false);
        this.detailModel().setProperty("/inspectSourceLimited", false);
        this.detailModel().setProperty("/inspectTargetLimited", false);
      }
    },
    loadInspectSide: async function _loadInspectSide(side) {
      this.inspectSkip[side] = 0;
      await this.loadInspectData(side, false);
    },
    refreshInspectSide: async function _refreshInspectSide(side) {
      this.inspectSkip[side] = 0;
      await this.loadInspectData(side, false);
      MessageToast.show(await getText(this, "refreshDone"));
    },
    onInspectColumnsChange: function _onInspectColumnsChange(side, event) {
      if (!this.inspectLoaded[side]) {
        return;
      }
      this.inspectSelectedColumns[side] = event.getParameter("selectedKeys") || [];
      this.inspectSkip[side] = 0;
      void this.loadInspectData(side, false);
    },
    onInspectLoadMore: function _onInspectLoadMore(side) {
      const path = `/inspect/${side}/hasMore`;
      if (!this.detailModel().getProperty(path)) {
        return;
      }
      this.inspectSkip[side] += INSPECT_PAGE_SIZE;
      void this.loadInspectData(side, true);
    },
    loadInspectData: async function _loadInspectData(side, append) {
      if (!this.pipelineName) {
        return;
      }
      const detail = this.detailModel();
      const sidePath = `/inspect/${side}`;
      detail.setProperty(`${sidePath}/busy`, true);
      try {
        const columnsJson = this.inspectSelectedColumns[side].length > 0 ? JSON.stringify(this.inspectSelectedColumns[side]) : undefined;
        const filtersJson = this.inspectFilters[side].length > 0 ? JSON.stringify(this.inspectFilters[side]) : undefined;
        const path = inspectDataFunction(this.pipelineName, side, INSPECT_PAGE_SIZE, this.inspectSkip[side], columnsJson, filtersJson);
        const odata = this.getOwnerComponent().getModel();
        const binding = odata.bindContext(path);
        await binding.requestObject();
        const payload = parseODataJsonValue(binding.getBoundContext()?.getObject());
        if (!payload) {
          throw new Error("Invalid inspectData response");
        }
        const prevRows = append ? detail.getProperty(`${sidePath}/rows`) : [];
        const rows = append ? prevRows.concat(payload.rows || []) : payload.rows || [];
        detail.setProperty(`${sidePath}/rows`, rows);
        detail.setProperty(`${sidePath}/columns`, payload.columns || []);
        detail.setProperty(`${sidePath}/hasMore`, !!payload.hasMore);
        detail.setProperty(`${sidePath}/limitedSupport`, !!payload.limitedSupport);
        detail.setProperty(`${sidePath}/rowCount`, rows.length);
        detail.setProperty(`${sidePath}/ready`, true);
        detail.setProperty(`${sidePath}/loaded`, true);
        this.syncInspectColumnSelector(side, payload.columns || []);
        this.renderInspectTable(side);
        this.inspectLoaded[side] = true;
      } catch (err) {
        detail.setProperty(`${sidePath}/ready`, true);
        MessageToast.show(String(err.message || err));
      } finally {
        detail.setProperty(`${sidePath}/busy`, false);
      }
    },
    syncInspectColumnSelector: function _syncInspectColumnSelector(side, columns) {
      const combo = this.byId(side === "source" ? "columnSelectorSource" : "columnSelectorTarget");
      if (!combo) {
        return;
      }
      combo.removeAllItems();
      columns.forEach(col => {
        combo.addItem(new Item({
          key: col.name,
          text: col.name
        }));
      });
      const selected = this.inspectSelectedColumns[side].length > 0 ? this.inspectSelectedColumns[side] : columns.map(c => c.name);
      combo.setSelectedKeys(selected);
      if (this.inspectSelectedColumns[side].length === 0) {
        this.inspectSelectedColumns[side] = selected;
      }
    },
    renderInspectTable: function _renderInspectTable(side) {
      const table = this.byId(side === "source" ? "inspectSourceTable" : "inspectTargetTable");
      const sidePath = `/inspect/${side}`;
      const columns = this.detailModel().getProperty(`${sidePath}/columns`);
      const rows = this.detailModel().getProperty(`${sidePath}/rows`);
      table.destroyColumns();
      table.destroyItems();
      columns.forEach(col => {
        table.addColumn(new Column({
          header: new Text({
            text: col.name
          })
        }));
      });
      rows.forEach(row => {
        const cells = columns.map(col => new Text({
          text: row[col.name] == null ? "" : String(row[col.name]),
          wrapping: false
        }));
        table.addItem(new ColumnListItem({
          cells
        }));
      });
    },
    openInspectFilterDialog: async function _openInspectFilterDialog(side) {
      this.filterDialogSide = side;
      if (!this.filterDialog) {
        this.filterDialog = await Fragment.load({
          id: this.getView().getId(),
          name: "pipeline.monitor.fcl.fragments.AdvancedFilterDialog",
          controller: this
        });
        this.getView().addDependent(this.filterDialog);
      }
      const filterModel = new JSONModel({
        rows: this.inspectFilters[side].length ? this.inspectFilters[side] : [{
          field: "",
          op: "eq",
          value: ""
        }]
      });
      this.filterDialog.setModel(filterModel, "filters");
      this.filterDialog.open();
    },
    onFilterCancel: function _onFilterCancel() {
      this.filterDialog?.close();
    },
    onFilterApply: function _onFilterApply() {
      const side = this.filterDialogSide;
      const rows = this.filterDialog?.getModel("filters")?.getProperty("/rows") || [];
      this.inspectFilters[side] = rows.filter(row => row.field && row.value !== "");
      this.inspectSkip[side] = 0;
      this.filterDialog?.close();
      void this.loadInspectData(side, false);
    },
    onFilterReset: function _onFilterReset() {
      this.filterDialog?.getModel("filters")?.setProperty("/rows", [{
        field: "",
        op: "eq",
        value: ""
      }]);
    },
    onAddFilterRow: function _onAddFilterRow() {
      const model = this.filterDialog?.getModel("filters");
      const rows = model?.getProperty("/rows") || [];
      model?.setProperty("/rows", rows.concat({
        field: "",
        op: "eq",
        value: ""
      }));
    },
    applyFlowMetadata: function _applyFlowMetadata(raw, options) {
      const graph = this.byId("flowGraph");
      if (!graph) {
        return;
      }
      const payload = parseFlowGraphPayload(raw);
      const hasNodes = !!payload?.nodes?.length;
      if (!hasNodes) {
        renderFlowGraph(graph, null);
        this.detailModel().setProperty("/flowReady", false);
        return;
      }

      // Graph is bound to visible="{detail>/flowReady}" — show it before fit-to-view
      // so layout uses the real viewport size (not 0×0 while hidden).
      this.detailModel().setProperty("/flowReady", true);
      renderFlowGraph(graph, payload);
      if (options?.fit ?? this.isFlowTabSelected()) {
        fitFlowGraphToView(graph);
      }
    },
    loadFlowGraph: async function _loadFlowGraph(options) {
      if (!getEntityContext(this)) {
        return;
      }
      try {
        const raw = await invokeBoundFunction(this, BOUND_FLOW);
        this.applyFlowMetadata(raw, options);
      } catch {
        renderFlowGraph(this.byId("flowGraph"), null);
        this.detailModel().setProperty("/flowReady", false);
      }
    },
    onRunsUpdateFinished: function _onRunsUpdateFinished() {
      this.updateDetailFromEntity();
    },
    onShowError: function _onShowError(event) {
      const ctx = event.getSource().getBindingContext();
      const message = ctx?.getProperty("error");
      if (message) {
        void getText(this, "errDetailTitle").then(title => MessageBox.information(message, {
          title
        }));
      }
    },
    formatLastRun: function _formatLastRun(value) {
      return value != null && value !== "" ? formatRelativeTime(value) : placeholder(null, "Never run yet");
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
    formatRunStatusLabel: function _formatRunStatusLabel(status) {
      const key = String(status ?? "").trim().toLowerCase();
      const i18nKeys = {
        completed: "runStatusCompleted",
        running: "statusLabelRunning",
        failed: "statusLabelFailed"
      };
      const i18nKey = i18nKeys[key];
      return i18nKey ? getTextSync(this, i18nKey) : String(status ?? "");
    },
    formatCount: function _formatCount(value) {
      if (value === null || value === undefined || value === "") {
        return "0";
      }
      return String(value);
    },
    showOrigin: function _showOrigin(origin) {
      return !!origin;
    },
    showLastKey: function _showLastKey(lastKey) {
      return !!lastKey;
    },
    isRunning: function _isRunning(status) {
      return String(status ?? "").trim().toLowerCase() === "running";
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
    },
    runBoundAction: function _runBoundAction(action, params, onSuccess, dialog, confirm) {
      dialog?.setBusy(true);
      confirm?.setEnabled(false);
      invokeBoundAction(this, action, params).then(async () => {
        MessageToast.show(await getText(this, "actionSuccess"));
        onSuccess();
        this.refreshAfterAction();
        this.getOwnerComponent().triggerRefresh?.();
        this.getOwnerComponent().setFastPolling?.(true);
      }).catch(err => this.showActionError(err)).finally(() => {
        dialog?.setBusy(false);
        confirm?.setEnabled(true);
      });
    },
    onStartDialog: async function _onStartDialog() {
      if (!this.startDialog) {
        this.startDialog = await Fragment.load({
          id: this.getView().getId(),
          name: "pipeline.monitor.fcl.fragments.StartDialog",
          controller: this
        });
        this.getView().addDependent(this.startDialog);
      }
      this.openStartWithDefaults();
    },
    openStartWithDefaults: function _openStartWithDefaults() {
      const viewId = this.getView().getId();
      const mode = Fragment.byId(viewId, "startMode");
      const trigger = Fragment.byId(viewId, "startTrigger");
      const asyncBox = Fragment.byId(viewId, "startAsync");
      const configuredMode = this.getView().getBindingContext()?.getProperty("mode");
      mode.setSelectedKey(configuredMode === "full" ? "full" : "delta");
      trigger.setSelectedKey("manual");
      asyncBox.setSelected(false);
      this.startDialog?.open();
    },
    onStartCancel: function _onStartCancel() {
      this.startDialog?.close();
    },
    onStartConfirm: function _onStartConfirm() {
      if (!this.requireContext()) {
        return;
      }
      const viewId = this.getView().getId();
      this.runBoundAction(BOUND_START, {
        mode: Fragment.byId(viewId, "startMode").getSelectedKey(),
        trigger: Fragment.byId(viewId, "startTrigger").getSelectedKey(),
        async: Fragment.byId(viewId, "startAsync").getSelected()
      }, () => this.startDialog?.close(), this.startDialog, Fragment.byId(viewId, "startConfirmBtn"));
    },
    onSetScheduleDialog: async function _onSetScheduleDialog() {
      if (!this.schedDialog) {
        this.schedDialog = await Fragment.load({
          id: this.getView().getId(),
          name: "pipeline.monitor.fcl.fragments.SetScheduleDialog",
          controller: this
        });
        this.getView().addDependent(this.schedDialog);
      }
      const viewId = this.getView().getId();
      Fragment.byId(viewId, "scheduleEvery").setValue(String(DEFAULT_SCHEDULE_MS));
      Fragment.byId(viewId, "scheduleCron").setValue("");
      Fragment.byId(viewId, "scheduleEngine").setSelectedKey("spawn");
      const kind = Fragment.byId(viewId, "scheduleKind");
      kind?.setSelectedKey?.("interval");
      this.applyScheduleKindVisibility("interval");
      this.schedDialog.open();
    },
    onScheduleKindChange: function _onScheduleKindChange(event) {
      const item = event.getParameter("item");
      this.applyScheduleKindVisibility(item?.getKey() || "interval");
    },
    applyScheduleKindVisibility: function _applyScheduleKindVisibility(kind) {
      const viewId = this.getView().getId();
      const isCron = kind === "cron";
      Fragment.byId(viewId, "scheduleEvery")?.setVisible(!isCron);
      Fragment.byId(viewId, "scheduleEveryLabel")?.setVisible(!isCron);
      Fragment.byId(viewId, "scheduleCron")?.setVisible(isCron);
      Fragment.byId(viewId, "scheduleCronLabel")?.setVisible(isCron);
      if (isCron) {
        Fragment.byId(viewId, "scheduleEngine")?.setSelectedKey("queued");
      }
    },
    onSetScheduleCancel: function _onSetScheduleCancel() {
      this.schedDialog?.close();
    },
    onSetScheduleConfirm: function _onSetScheduleConfirm() {
      if (!this.requireContext()) {
        return;
      }
      const viewId = this.getView().getId();
      const kindCtrl = Fragment.byId(viewId, "scheduleKind");
      const kind = kindCtrl?.getSelectedKey?.() || "interval";
      const engine = Fragment.byId(viewId, "scheduleEngine").getSelectedKey();
      const payload = {
        engine
      };
      if (kind === "cron") {
        const cron = Fragment.byId(viewId, "scheduleCron").getValue().trim();
        if (!cron || cron.split(/\s+/).length !== 5) {
          void getText(this, "scheduleCronInvalid").then(text => MessageBox.error(text));
          return;
        }
        payload.cron = cron;
      } else {
        const every = parseInt(Fragment.byId(viewId, "scheduleEvery").getValue(), 10);
        if (Number.isNaN(every) || every <= 0) {
          void getText(this, "scheduleInvalid").then(text => MessageBox.error(text));
          return;
        }
        payload.every = every;
      }
      this.runBoundAction(BOUND_SET_SCHED, payload, () => this.schedDialog?.close(), this.schedDialog, Fragment.byId(viewId, "scheduleConfirmBtn"));
    },
    onClearSchedule: function _onClearSchedule() {
      if (!this.requireContext()) {
        return;
      }
      void getText(this, "clearScheduleConfirm").then(text => {
        MessageBox.confirm(text, {
          onClose: action => {
            if (action !== MessageBox.Action.OK) {
              return;
            }
            invokeBoundAction(this, BOUND_CLEAR, {}).then(async () => {
              MessageToast.show(await getText(this, "actionSuccess"));
              this.refreshAfterAction();
            }).catch(err => this.showActionError(err));
          }
        });
      });
    },
    onToggleEnabled: function _onToggleEnabled() {
      const ctx = this.requireContext();
      if (!ctx) {
        return;
      }
      const currentlyEnabled = this.isScheduleEnabled(ctx.getProperty("enabled"));
      const next = !currentlyEnabled;
      invokeBoundAction(this, BOUND_SET_ENABLED, {
        enabled: next
      }).then(async () => {
        MessageToast.show(await getText(this, next ? "enabledToast" : "pausedToast"));
        this.refreshAfterAction();
        this.getOwnerComponent().triggerRefresh?.();
      }).catch(err => this.showActionError(err));
    },
    formatPauseActionText: function _formatPauseActionText(enabled) {
      return this.isScheduleEnabled(enabled) ? getTextSync(this, "actionPause") : getTextSync(this, "actionEnable");
    },
    formatPauseActionIcon: function _formatPauseActionIcon(enabled) {
      return this.isScheduleEnabled(enabled) ? "sap-icon://media-pause" : "sap-icon://media-play";
    },
    formatPauseActionType: function _formatPauseActionType(enabled) {
      return this.isScheduleEnabled(enabled) ? "Transparent" : "Attention";
    },
    onResetOverrides: function _onResetOverrides() {
      if (!this.requireContext()) {
        return;
      }
      void getText(this, "resetOverridesConfirm").then(text => {
        MessageBox.confirm(text, {
          onClose: action => {
            if (action !== MessageBox.Action.OK) {
              return;
            }
            invokeBoundAction(this, BOUND_CLEAR_OVERRIDES, {
              keys: ""
            }).then(async () => {
              MessageToast.show(await getText(this, "actionSuccess"));
              this.refreshAfterAction();
            }).catch(err => this.showActionError(err));
          }
        });
      });
    },
    onEditOverride: function _onEditOverride(event) {
      const rowCtx = event.getSource().getBindingContext("detail");
      if (!rowCtx) {
        return;
      }
      const path = String(rowCtx.getProperty("path") || "");
      const current = rowCtx.getProperty("override") ?? rowCtx.getProperty("effective");
      this.detailModel().setProperty("/overrideEdit", createOverrideEditState(path, current));
      void this.openEditOverrideDialog();
    },
    openEditOverrideDialog: async function _openEditOverrideDialog() {
      if (!this.editOverrideDialog) {
        this.editOverrideDialog = await Fragment.load({
          id: this.getView().getId(),
          name: "pipeline.monitor.fcl.fragments.EditOverrideDialog",
          controller: this
        });
        this.getView().addDependent(this.editOverrideDialog);
      }
      this.applyOverrideScheduleKindVisibility(this.detailModel().getProperty("/overrideEdit/scheduleKind"));
      const path = this.detailModel().getProperty("/overrideEdit/path");
      this.editOverrideDialog?.setTitle(`${getTextSync(this, "actionEditOverride")} — ${this.formatOverrideFieldLabel(path)}`);
      this.editOverrideDialog.open();
    },
    onEditOverrideCancel: function _onEditOverrideCancel() {
      this.editOverrideDialog?.close();
    },
    onOverrideScheduleKindChange: function _onOverrideScheduleKindChange(event) {
      const item = event.getParameter("item");
      this.applyOverrideScheduleKindVisibility(item?.getKey() || "interval");
    },
    applyOverrideScheduleKindVisibility: function _applyOverrideScheduleKindVisibility(kind) {
      if (kind === "cron") {
        this.detailModel().setProperty("/overrideEdit/scheduleEngine", "queued");
      }
    },
    onEditOverrideConfirm: function _onEditOverrideConfirm() {
      if (!this.requireContext()) {
        return;
      }
      const editState = this.detailModel().getProperty("/overrideEdit");
      const built = buildOverrideValue(editState);
      if (built.errorKey) {
        void getText(this, built.errorKey).then(text => MessageBox.error(text));
        return;
      }
      const patch = this.pathToOverridePatch(editState.path, built.value);
      const dialog = this.editOverrideDialog;
      dialog?.setBusy(true);
      invokeBoundAction(this, BOUND_SET_OVERRIDES, {
        overrides: JSON.stringify(patch)
      }).then(async () => {
        MessageToast.show(await getText(this, "actionSuccess"));
        dialog?.close();
        this.refreshAfterAction();
      }).catch(err => this.showActionError(err)).finally(() => dialog?.setBusy(false));
    },
    onClearFieldOverride: function _onClearFieldOverride(event) {
      const rowCtx = event.getSource().getBindingContext("detail");
      if (!rowCtx) {
        return;
      }
      const path = String(rowCtx.getProperty("path") || "");
      invokeBoundAction(this, BOUND_CLEAR_OVERRIDES, {
        keys: path
      }).then(async () => {
        MessageToast.show(await getText(this, "actionSuccess"));
        this.refreshAfterAction();
      }).catch(err => this.showActionError(err));
    },
    pathToOverridePatch: function _pathToOverridePatch(path, value) {
      const parts = path.split(".");
      if (parts.length === 1) {
        return {
          [parts[0]]: value
        };
      }
      const root = {};
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const next = {};
        cur[parts[i]] = next;
        cur = next;
      }
      cur[parts[parts.length - 1]] = value;
      return root;
    },
    onFlush: function _onFlush() {
      const ctx = this.requireContext();
      if (!ctx) {
        return;
      }
      const name = String(ctx.getProperty("name") || "");
      const origin = ctx.getProperty("origin");
      const hasOrigin = origin != null && String(origin).trim() !== "";
      const confirmKey = hasOrigin ? "flushConfirmOrigin" : "flushConfirm";
      const confirmArgs = hasOrigin ? [name, String(origin)] : [name];
      void getText(this, confirmKey, confirmArgs).then(text => {
        MessageBox.confirm(text, {
          onClose: action => {
            if (action !== MessageBox.Action.OK) {
              return;
            }
            this.detailModel().setProperty("/busy", true);
            invokeUnboundAction(this, "/flush", {
              name
            }).then(async () => {
              MessageToast.show(await getText(this, "actionSuccess"));
              this.refreshAfterAction();
            }).catch(err => this.showActionError(err)).finally(() => this.detailModel().setProperty("/busy", false));
          }
        });
      });
    }
  });
  return Detail;
});
//# sourceMappingURL=Detail-dbg.controller.js.map
