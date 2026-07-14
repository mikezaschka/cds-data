import Controller from "sap/ui/core/mvc/Controller";
import Fragment from "sap/ui/core/Fragment";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import JSONModel from "sap/ui/model/json/JSONModel";
import Device from "sap/ui/Device";
import Graph from "sap/suite/ui/commons/networkgraph/Graph";
import Column from "sap/m/Column";
import ColumnListItem from "sap/m/ColumnListItem";
import Text from "sap/m/Text";
import Item from "sap/ui/core/Item";
import Dialog from "sap/m/Dialog";
import Button from "sap/m/Button";
import Input from "sap/m/Input";
import type Select from "sap/m/Select";
import type CheckBox from "sap/m/CheckBox";
import type IconTabBar from "sap/m/IconTabBar";
import type Table from "sap/m/Table";
import type MultiComboBox from "sap/m/MultiComboBox";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type UIComponent from "sap/ui/core/UIComponent";
import {
    pipelinesEntity,
    inspectCapabilitiesFunction,
    inspectDataFunction,
    PIPELINE_DETAIL_SELECT,
    PIPELINE_RUNS_EXPAND,
} from "pipeline/monitor/fcl/util/ODataPath";
import { getEntityContext, invokeBoundAction, invokeBoundFunction, invokeUnboundAction, parseODataJsonValue } from "pipeline/monitor/fcl/util/ODataAction";
import { getText, getTextSync } from "pipeline/monitor/fcl/util/I18n";
import { getFcl, getSemanticHelper, setFclLayout, syncFclActionButtonsDeferred, isMidColumnFullScreen } from "pipeline/monitor/fcl/util/FclHelper";
import { parseFlowGraphPayload, renderFlowGraph, fitFlowGraphToView } from "pipeline/monitor/fcl/util/FlowGraph";
import {
    statusState,
    statusIcon,
    errorState,
    formatJson,
    formatTimestamp,
    formatRelativeTime,
    runDuration,
    errorPreview,
    isScheduleEnabled,
    hasActiveSchedule,
    isSchedulePaused,
    schedulingState,
    schedulingIcon,
    scheduleCellLabel,
} from "pipeline/monitor/fcl/util/Formatters";
import {
    createOverrideEditState,
    buildOverrideValue,
    overrideFieldI18nKey,
    type OverrideEditState,
} from "pipeline/monitor/fcl/util/OverrideFields";

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

type InspectSide = "source" | "target";
type InspectColumn = { name: string; type?: string };
type InspectPayload = {
    columns: InspectColumn[];
    rows: Record<string, unknown>[];
    hasMore: boolean;
    limitedSupport?: boolean;
};
type FilterRow = { field: string; op: string; value: string };
type InspectCapabilities = { source: string; target: string };

const EMPTY_INSPECT_SIDE = {
    busy: false,
    ready: false,
    loaded: false,
    hasMore: false,
    limitedSupport: false,
    rowCount: 0,
    columns: [] as InspectColumn[],
    rows: [] as Record<string, unknown>[],
};

/**
 * @namespace pipeline.monitor.fcl.controller
 */
export default class Detail extends Controller {
    private startDialog?: Dialog;
    private schedDialog?: Dialog;
    private editOverrideDialog?: Dialog;
    private filterDialog?: Dialog;
    private pipelineName: string | null = null;
    private inspectSkip = { source: 0, target: 0 };
    private inspectFilters: { source: FilterRow[]; target: FilterRow[] } = { source: [], target: [] };
    private inspectSelectedColumns: { source: string[]; target: string[] } = { source: [], target: [] };
    private inspectLoaded = { source: false, target: false };
    private filterDialogSide: InspectSide = "source";

    onInit(): void {
        const router = (this.getOwnerComponent() as UIComponent).getRouter();
        router.getRoute("detail")?.attachPatternMatched(this.onRouteMatched, this);

        this.getView().setModel(new JSONModel({ showBack: !!Device.system.phone }), "device");
        this.getView().setModel(
            new JSONModel({
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
                    meta: { scheduleLiveChangeSupported: true, overridablePaths: [] },
                    overrides: {},
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
                    scheduleEngine: "spawn",
                } as OverrideEditState,
                inspect: {
                    source: { ...EMPTY_INSPECT_SIDE },
                    target: { ...EMPTY_INSPECT_SIDE },
                },
            }),
            "detail"
        );

        const fclModel = (this.getOwnerComponent() as UIComponent).getModel("fcl");
        if (fclModel) {
            this.getView().setModel(fclModel, "fcl");
        }
    }

    private detailModel(): JSONModel {
        return this.getView().getModel("detail") as JSONModel;
    }

    private onRouteMatched = (event: {
        getParameter: (name: string) => { name?: string } | undefined;
    }): void => {
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
        detail.setProperty("/inspect/source", { ...EMPTY_INSPECT_SIDE });
        detail.setProperty("/inspect/target", { ...EMPTY_INSPECT_SIDE });
        this.inspectSkip = { source: 0, target: 0 };
        this.inspectFilters = { source: [], target: [] };
        this.inspectSelectedColumns = { source: [], target: [] };
        this.inspectLoaded = { source: false, target: false };

        this.getView().bindElement({
            path: pipelinesEntity(name),
            parameters: {
                $select: `${PIPELINE_DETAIL_SELECT},runs`,
                $expand: PIPELINE_RUNS_EXPAND,
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
                change: (changeEvent: { getParameter: (name: string) => unknown }) => {
                    if (changeEvent.getParameter("reason") === "Change") {
                        this.updateDetailFromEntity();
                        void this.loadFlowGraph();
                        void this.loadConfigView();
                        this.updatePolling();
                    }
                },
            },
        });
        syncFclActionButtonsDeferred(this.getOwnerComponent() as UIComponent);
    };

    private updatePolling(): void {
        const status = getEntityContext(this)?.getProperty("status") as string;
        const component = this.getOwnerComponent() as UIComponent & {
            setFastPolling?: (enabled: boolean) => void;
        };
        component.setFastPolling?.(status === "running");
    }

    private updateDetailFromEntity(): void {
        const ctx = getEntityContext(this);
        if (!ctx) {
            return;
        }
        const data = ctx.getObject() as { runs?: unknown[] } | undefined;
        const runs = data?.runs || [];
        const detail = this.detailModel();
        detail.setProperty("/runCount", runs.length);
        detail.setProperty(
            "/schedulePaused",
            isSchedulePaused(ctx.getProperty("schedule"), ctx.getProperty("enabled")),
        );
    }

    onCloseMidColumn(): void {
        const component = this.getOwnerComponent() as UIComponent;
        const fcl = getFcl(component.getRootControl());
        const closeLayout = getSemanticHelper(fcl).getCurrentUIState().actionButtonsInfo.midColumn.closeColumn;
        if (closeLayout) {
            setFclLayout(component, closeLayout);
        }
        component.getRouter().navTo("master", {}, true);
    }

    onMidFullScreen(): void {
        const component = this.getOwnerComponent() as UIComponent;
        const fcl = getFcl(component.getRootControl());
        const info = getSemanticHelper(fcl).getCurrentUIState().actionButtonsInfo.midColumn;
        if (info.fullScreen) {
            setFclLayout(component, info.fullScreen);
        } else if (info.exitFullScreen) {
            setFclLayout(component, info.exitFullScreen);
        }
        syncFclActionButtonsDeferred(component);
    }

    formatMidFullScreenIcon(layout: unknown): string {
        return isMidColumnFullScreen(layout)
            ? "sap-icon://exit-full-screen"
            : "sap-icon://full-screen";
    }

    formatMidFullScreenTooltip(layout: unknown): string {
        return isMidColumnFullScreen(layout)
            ? getTextSync(this, "exitFullScreen")
            : getTextSync(this, "enterFullScreen");
    }

    private refreshAfterAction(): void {
        this.getView().getElementBinding()?.refresh();
        ((this.getOwnerComponent() as UIComponent).getModel() as ODataModel)?.refresh();
        void this.loadConfigView();
    }

    private async loadConfigView(): Promise<void> {
        if (!this.pipelineName || !getEntityContext(this)) {
            return;
        }
        try {
            // Relative name + entity context (same pattern as flowMetadata).
            // Do NOT pass an absolute /Pipelines(...)/... path — bindContext
            // would concatenate it onto the context and CAP returns 404.
            const raw = await invokeBoundFunction(this, BOUND_CONFIG_VIEW);
            const view = parseODataJsonValue(raw) as {
                fields?: Array<Record<string, unknown>>;
                meta?: { scheduleLiveChangeSupported?: boolean; overridablePaths?: string[] };
                overrides?: Record<string, unknown>;
            };
            this.detailModel().setProperty("/configView", {
                fields: view?.fields || [],
                meta: view?.meta || { scheduleLiveChangeSupported: true, overridablePaths: [] },
                overrides: view?.overrides || {},
            });
        } catch {
            // Non-fatal: overview still works without the diff table.
            this.detailModel().setProperty("/configView/fields", []);
        }
    }

    /**
     * True when scheduling is active. Treats null/undefined as enabled so the
     * badge does not flicker to "Paused" before the entity binding resolves.
     * Accepts OData booleans and SQLite 0/1 that may surface before casting.
     */
    isScheduleEnabled = isScheduleEnabled;
    isSchedulePaused = isSchedulePaused;

    formatScheduleCellLabel(schedule: unknown, enabled: unknown): string {
        return scheduleCellLabel(schedule, enabled, {
            notScheduled: getTextSync(this, "notScheduled"),
            active: getTextSync(this, "statusEnabled"),
            paused: getTextSync(this, "statusPaused"),
        });
    }

    formatSchedulingState(schedule: unknown, enabled: unknown): string {
        return schedulingState(schedule, enabled);
    }

    formatSchedulingIcon(schedule: unknown, enabled: unknown): string {
        return schedulingIcon(schedule, enabled);
    }

    canToggleSchedulePause(schedule: unknown, ready: boolean): boolean {
        return !!ready && hasActiveSchedule(schedule);
    }

    pauseScheduleTooltip(schedule: unknown, ready: boolean): string {
        return this.canToggleSchedulePause(schedule, ready)
            ? ""
            : getTextSync(this, "pauseNoScheduleTooltip");
    }

    formatEnabledLabel(enabled: unknown): string {
        return this.isScheduleEnabled(enabled)
            ? getTextSync(this, "statusEnabled")
            : getTextSync(this, "statusPaused");
    }

    formatEnabledState(enabled: unknown): string {
        return this.isScheduleEnabled(enabled) ? "Success" : "Warning";
    }

    formatOverrideCell(value: unknown): string {
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
    }

    formatOverrideFieldLabel(path: string): string {
        const key = overrideFieldI18nKey(path, "overrideLabel");
        const text = getTextSync(this, key);
        return text === key ? path : text;
    }

    formatOverrideFieldHelp(path: string): string {
        const key = overrideFieldI18nKey(path, "overrideHelp");
        const text = getTextSync(this, key);
        return text === key ? "" : text;
    }

    private showActionError(error: { message?: string } | string): void {
        MessageBox.error(typeof error === "object" && error?.message ? error.message : String(error));
    }

    private requireContext() {
        const ctx = getEntityContext(this);
        if (!ctx) {
            void getText(this, "contextNotReady").then((text) => MessageBox.warning(text));
        }
        return ctx;
    }

    onNavBack(): void {
        (this.getOwnerComponent() as UIComponent).getRouter().navTo("master", {}, true);
    }

    private selectInspectTab(side: InspectSide): void {
        const enabled = this.detailModel().getProperty(
            side === "source" ? "/inspectSourceEnabled" : "/inspectTargetEnabled"
        );
        if (!enabled) {
            return;
        }
        const tabBar = this.byId("iconTabBar") as IconTabBar | undefined;
        tabBar?.setSelectedKey(side === "source" ? "inspectSource" : "inspectTarget");
    }

    onGraphNodePress(event: { getParameter: (name: string) => { getKey: () => string } | undefined }): void {
        const node = event.getParameter("node");
        const key = node?.getKey();
        if (key === "source") {
            this.selectInspectTab("source");
        } else if (key === "target") {
            this.selectInspectTab("target");
        }
    }

    onDetailTabSelect(event: { getParameter: (name: string) => string }): void {
        const key = event.getParameter("key");
        if (key === "flow") {
            void this.loadFlowGraph({ fit: true });
        }
    }

    private isFlowTabSelected(): boolean {
        return (this.byId("iconTabBar") as IconTabBar | undefined)?.getSelectedKey() === "flow";
    }

    onInspectSourceLoadData(): void {
        void this.loadInspectSide("source");
    }

    onInspectTargetLoadData(): void {
        void this.loadInspectSide("target");
    }

    onInspectSourceColumnsChange(event: { getParameter: (name: string) => string[] }): void {
        this.onInspectColumnsChange("source", event);
    }

    onInspectTargetColumnsChange(event: { getParameter: (name: string) => string[] }): void {
        this.onInspectColumnsChange("target", event);
    }

    onInspectSourceRefresh(): void {
        void this.refreshInspectSide("source");
    }

    onInspectTargetRefresh(): void {
        void this.refreshInspectSide("target");
    }

    onInspectSourceLoadMore(): void {
        this.onInspectLoadMore("source");
    }

    onInspectTargetLoadMore(): void {
        this.onInspectLoadMore("target");
    }

    onInspectSourceAdvancedFilter(): void {
        void this.openInspectFilterDialog("source");
    }

    onInspectTargetAdvancedFilter(): void {
        void this.openInspectFilterDialog("target");
    }

    private async loadInspectCapabilities(): Promise<void> {
        if (!this.pipelineName) {
            return;
        }
        try {
            const odata = (this.getOwnerComponent() as UIComponent).getModel() as ODataModel;
            const binding = odata.bindContext(inspectCapabilitiesFunction(this.pipelineName));
            await binding.requestObject();
            const caps = parseODataJsonValue<InspectCapabilities>(binding.getBoundContext()?.getObject());
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
    }

    private async loadInspectSide(side: InspectSide): Promise<void> {
        this.inspectSkip[side] = 0;
        await this.loadInspectData(side, false);
    }

    private async refreshInspectSide(side: InspectSide): Promise<void> {
        this.inspectSkip[side] = 0;
        await this.loadInspectData(side, false);
        MessageToast.show(await getText(this, "refreshDone"));
    }

    onInspectColumnsChange(
        side: InspectSide,
        event: { getParameter: (name: string) => string[] }
    ): void {
        if (!this.inspectLoaded[side]) {
            return;
        }
        this.inspectSelectedColumns[side] = event.getParameter("selectedKeys") || [];
        this.inspectSkip[side] = 0;
        void this.loadInspectData(side, false);
    }

    private onInspectLoadMore(side: InspectSide): void {
        const path = `/inspect/${side}/hasMore`;
        if (!this.detailModel().getProperty(path)) {
            return;
        }
        this.inspectSkip[side] += INSPECT_PAGE_SIZE;
        void this.loadInspectData(side, true);
    }

    private async loadInspectData(side: InspectSide, append: boolean): Promise<void> {
        if (!this.pipelineName) {
            return;
        }
        const detail = this.detailModel();
        const sidePath = `/inspect/${side}`;
        detail.setProperty(`${sidePath}/busy`, true);
        try {
            const columnsJson =
                this.inspectSelectedColumns[side].length > 0
                    ? JSON.stringify(this.inspectSelectedColumns[side])
                    : undefined;
            const filtersJson =
                this.inspectFilters[side].length > 0
                    ? JSON.stringify(this.inspectFilters[side])
                    : undefined;
            const path = inspectDataFunction(
                this.pipelineName,
                side,
                INSPECT_PAGE_SIZE,
                this.inspectSkip[side],
                columnsJson,
                filtersJson
            );
            const odata = (this.getOwnerComponent() as UIComponent).getModel() as ODataModel;
            const binding = odata.bindContext(path);
            await binding.requestObject();
            const payload = parseODataJsonValue<InspectPayload>(binding.getBoundContext()?.getObject());
            if (!payload) {
                throw new Error("Invalid inspectData response");
            }
            const prevRows = append
                ? (detail.getProperty(`${sidePath}/rows`) as Record<string, unknown>[])
                : [];
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
            MessageToast.show(String((err as Error).message || err));
        } finally {
            detail.setProperty(`${sidePath}/busy`, false);
        }
    }

    private syncInspectColumnSelector(side: InspectSide, columns: InspectColumn[]): void {
        const combo = this.byId(
            side === "source" ? "columnSelectorSource" : "columnSelectorTarget"
        ) as MultiComboBox | undefined;
        if (!combo) {
            return;
        }
        combo.removeAllItems();
        columns.forEach((col) => {
            combo.addItem(new Item({ key: col.name, text: col.name }));
        });
        const selected =
            this.inspectSelectedColumns[side].length > 0
                ? this.inspectSelectedColumns[side]
                : columns.map((c) => c.name);
        combo.setSelectedKeys(selected);
        if (this.inspectSelectedColumns[side].length === 0) {
            this.inspectSelectedColumns[side] = selected;
        }
    }

    private renderInspectTable(side: InspectSide): void {
        const table = this.byId(
            side === "source" ? "inspectSourceTable" : "inspectTargetTable"
        ) as Table;
        const sidePath = `/inspect/${side}`;
        const columns = this.detailModel().getProperty(`${sidePath}/columns`) as InspectColumn[];
        const rows = this.detailModel().getProperty(`${sidePath}/rows`) as Record<string, unknown>[];

        table.destroyColumns();
        table.destroyItems();
        columns.forEach((col) => {
            table.addColumn(new Column({ header: new Text({ text: col.name }) }));
        });
        rows.forEach((row) => {
            const cells = columns.map(
                (col) =>
                    new Text({
                        text: row[col.name] == null ? "" : String(row[col.name]),
                        wrapping: false,
                    })
            );
            table.addItem(new ColumnListItem({ cells }));
        });
    }

    private async openInspectFilterDialog(side: InspectSide): Promise<void> {
        this.filterDialogSide = side;
        if (!this.filterDialog) {
            this.filterDialog = (await Fragment.load({
                id: this.getView().getId(),
                name: "pipeline.monitor.fcl.fragments.AdvancedFilterDialog",
                controller: this,
            })) as Dialog;
            this.getView().addDependent(this.filterDialog);
        }
        const filterModel = new JSONModel({
            rows: this.inspectFilters[side].length
                ? this.inspectFilters[side]
                : [{ field: "", op: "eq", value: "" }],
        });
        this.filterDialog.setModel(filterModel, "filters");
        this.filterDialog.open();
    }

    onFilterCancel(): void {
        this.filterDialog?.close();
    }

    onFilterApply(): void {
        const side = this.filterDialogSide;
        const rows =
            ((this.filterDialog?.getModel("filters") as JSONModel)?.getProperty("/rows") as FilterRow[]) ||
            [];
        this.inspectFilters[side] = rows.filter((row) => row.field && row.value !== "");
        this.inspectSkip[side] = 0;
        this.filterDialog?.close();
        void this.loadInspectData(side, false);
    }

    onFilterReset(): void {
        (this.filterDialog?.getModel("filters") as JSONModel)?.setProperty("/rows", [
            { field: "", op: "eq", value: "" },
        ]);
    }

    onAddFilterRow(): void {
        const model = this.filterDialog?.getModel("filters") as JSONModel;
        const rows = (model?.getProperty("/rows") as FilterRow[]) || [];
        model?.setProperty("/rows", rows.concat({ field: "", op: "eq", value: "" }));
    }

    private applyFlowMetadata(raw: unknown, options?: { fit?: boolean }): void {
        const graph = this.byId("flowGraph") as Graph | undefined;
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
    }

    private async loadFlowGraph(options?: { fit?: boolean }): Promise<void> {
        if (!getEntityContext(this)) {
            return;
        }
        try {
            const raw = await invokeBoundFunction(this, BOUND_FLOW);
            this.applyFlowMetadata(raw, options);
        } catch {
            renderFlowGraph(this.byId("flowGraph") as Graph, null);
            this.detailModel().setProperty("/flowReady", false);
        }
    }

    onRunsUpdateFinished(): void {
        this.updateDetailFromEntity();
    }

    onShowError(event: { getSource: () => { getBindingContext: () => { getProperty: (n: string) => string } | null } }): void {
        const ctx = event.getSource().getBindingContext();
        const message = ctx?.getProperty("error");
        if (message) {
            void getText(this, "errDetailTitle").then((title) => MessageBox.information(message, { title }));
        }
    }

    statusState = statusState;
    statusIcon = statusIcon;
    errorState = errorState;
    formatJson = formatJson;
    formatTimestamp = formatTimestamp;
    formatRelativeTime = formatRelativeTime;
    runDuration = runDuration;
    errorPreview = errorPreview;

    formatLastRun(value: unknown): string {
        if (value == null || value === "") {
            return getTextSync(this, "neverRun");
        }
        return formatRelativeTime(value) || getTextSync(this, "neverRun");
    }

    formatStatusLabel(status: string): string {
        const key = String(status ?? "").trim().toLowerCase();
        const i18nKeys: Record<string, string> = {
            idle: "statusLabelIdle",
            running: "statusLabelRunning",
            failed: "statusLabelFailed",
        };
        const i18nKey = i18nKeys[key];
        return i18nKey ? getTextSync(this, i18nKey) : String(status ?? "");
    }

    formatRunStatusLabel(status: string): string {
        const key = String(status ?? "").trim().toLowerCase();
        const i18nKeys: Record<string, string> = {
            completed: "runStatusCompleted",
            running: "statusLabelRunning",
            failed: "statusLabelFailed",
        };
        const i18nKey = i18nKeys[key];
        return i18nKey ? getTextSync(this, i18nKey) : String(status ?? "");
    }

    formatCount(value: unknown): string {
        if (value === null || value === undefined || value === "") {
            return "0";
        }
        return String(value);
    }

    showOrigin(origin: string | null): boolean {
        return !!origin;
    }

    showLastKey(lastKey: string | null): boolean {
        return !!lastKey;
    }

    isRunning(status: string): boolean {
        return String(status ?? "").trim().toLowerCase() === "running";
    }

    statusTooltip(status: string): string {
        const key = String(status ?? "").trim().toLowerCase();
        if (key === "running") {
            return getTextSync(this, "statusTooltipRunning");
        }
        if (key === "failed") {
            return getTextSync(this, "statusTooltipFailed");
        }
        return getTextSync(this, "statusTooltipIdle");
    }

    private runBoundAction(
        action: string,
        params: Record<string, unknown>,
        onSuccess: () => void,
        dialog?: Dialog,
        confirm?: Button
    ): void {
        dialog?.setBusy(true);
        confirm?.setEnabled(false);
        invokeBoundAction(this, action, params)
            .then(async () => {
                MessageToast.show(await getText(this, "actionSuccess"));
                onSuccess();
                this.refreshAfterAction();
                (this.getOwnerComponent() as UIComponent & { triggerRefresh?: () => void }).triggerRefresh?.();
                (this.getOwnerComponent() as UIComponent & { setFastPolling?: (b: boolean) => void }).setFastPolling?.(true);
            })
            .catch((err) => this.showActionError(err))
            .finally(() => {
                dialog?.setBusy(false);
                confirm?.setEnabled(true);
            });
    }

    async onStartDialog(): Promise<void> {
        if (!this.startDialog) {
            this.startDialog = (await Fragment.load({
                id: this.getView().getId(),
                name: "pipeline.monitor.fcl.fragments.StartDialog",
                controller: this,
            })) as Dialog;
            this.getView().addDependent(this.startDialog);
        }
        this.openStartWithDefaults();
    }

    private openStartWithDefaults(): void {
        const viewId = this.getView().getId();
        const mode = Fragment.byId(viewId, "startMode") as Select;
        const trigger = Fragment.byId(viewId, "startTrigger") as Select;
        const asyncBox = Fragment.byId(viewId, "startAsync") as CheckBox;
        const configuredMode = this.getView().getBindingContext()?.getProperty("mode") as string | undefined;
        mode.setSelectedKey(configuredMode === "full" ? "full" : "delta");
        trigger.setSelectedKey("manual");
        asyncBox.setSelected(false);
        this.startDialog?.open();
    }

    onStartCancel(): void {
        this.startDialog?.close();
    }

    onStartConfirm(): void {
        if (!this.requireContext()) {
            return;
        }
        const viewId = this.getView().getId();
        this.runBoundAction(
            BOUND_START,
            {
                mode: (Fragment.byId(viewId, "startMode") as Select).getSelectedKey(),
                trigger: (Fragment.byId(viewId, "startTrigger") as Select).getSelectedKey(),
                async: (Fragment.byId(viewId, "startAsync") as CheckBox).getSelected(),
            },
            () => this.startDialog?.close(),
            this.startDialog,
            Fragment.byId(viewId, "startConfirmBtn") as Button
        );
    }

    async onSetScheduleDialog(): Promise<void> {
        if (!this.schedDialog) {
            this.schedDialog = (await Fragment.load({
                id: this.getView().getId(),
                name: "pipeline.monitor.fcl.fragments.SetScheduleDialog",
                controller: this,
            })) as Dialog;
            this.getView().addDependent(this.schedDialog);
        }
        const viewId = this.getView().getId();
        (Fragment.byId(viewId, "scheduleEvery") as Input).setValue(String(DEFAULT_SCHEDULE_MS));
        (Fragment.byId(viewId, "scheduleCron") as Input).setValue("");
        (Fragment.byId(viewId, "scheduleEngine") as Select).setSelectedKey("spawn");
        const kind = Fragment.byId(viewId, "scheduleKind") as { setSelectedKey?: (k: string) => void };
        kind?.setSelectedKey?.("interval");
        this.applyScheduleKindVisibility("interval");
        this.schedDialog.open();
    }

    onScheduleKindChange(event: { getParameter: (name: string) => { getKey: () => string } | undefined }): void {
        const item = event.getParameter("item");
        this.applyScheduleKindVisibility(item?.getKey() || "interval");
    }

    private applyScheduleKindVisibility(kind: string): void {
        const viewId = this.getView().getId();
        const isCron = kind === "cron";
        (Fragment.byId(viewId, "scheduleEvery") as Input)?.setVisible(!isCron);
        (Fragment.byId(viewId, "scheduleEveryLabel") as { setVisible: (v: boolean) => void })?.setVisible(!isCron);
        (Fragment.byId(viewId, "scheduleCron") as Input)?.setVisible(isCron);
        (Fragment.byId(viewId, "scheduleCronLabel") as { setVisible: (v: boolean) => void })?.setVisible(isCron);
        if (isCron) {
            (Fragment.byId(viewId, "scheduleEngine") as Select)?.setSelectedKey("queued");
        }
    }

    onSetScheduleCancel(): void {
        this.schedDialog?.close();
    }

    onSetScheduleConfirm(): void {
        if (!this.requireContext()) {
            return;
        }
        const viewId = this.getView().getId();
        const kindCtrl = Fragment.byId(viewId, "scheduleKind") as { getSelectedKey?: () => string };
        const kind = kindCtrl?.getSelectedKey?.() || "interval";
        const engine = (Fragment.byId(viewId, "scheduleEngine") as Select).getSelectedKey();
        const payload: { every?: number; cron?: string; engine: string } = { engine };
        if (kind === "cron") {
            const cron = (Fragment.byId(viewId, "scheduleCron") as Input).getValue().trim();
            if (!cron || cron.split(/\s+/).length !== 5) {
                void getText(this, "scheduleCronInvalid").then((text) => MessageBox.error(text));
                return;
            }
            payload.cron = cron;
        } else {
            const every = parseInt((Fragment.byId(viewId, "scheduleEvery") as Input).getValue(), 10);
            if (Number.isNaN(every) || every <= 0) {
                void getText(this, "scheduleInvalid").then((text) => MessageBox.error(text));
                return;
            }
            payload.every = every;
        }
        this.runBoundAction(
            BOUND_SET_SCHED,
            payload,
            () => this.schedDialog?.close(),
            this.schedDialog,
            Fragment.byId(viewId, "scheduleConfirmBtn") as Button
        );
    }

    onClearSchedule(): void {
        if (!this.requireContext()) {
            return;
        }
        void getText(this, "clearScheduleConfirm").then((text) => {
            MessageBox.confirm(text, {
                onClose: (action) => {
                    if (action !== MessageBox.Action.OK) {
                        return;
                    }
                    invokeBoundAction(this, BOUND_CLEAR, {})
                        .then(async () => {
                            MessageToast.show(await getText(this, "actionSuccess"));
                            this.refreshAfterAction();
                        })
                        .catch((err) => this.showActionError(err));
                },
            });
        });
    }

    onToggleEnabled(): void {
        const ctx = this.requireContext();
        if (!ctx) {
            return;
        }
        const currentlyEnabled = this.isScheduleEnabled(ctx.getProperty("enabled"));
        const next = !currentlyEnabled;
        invokeBoundAction(this, BOUND_SET_ENABLED, { enabled: next })
            .then(async () => {
                MessageToast.show(await getText(this, next ? "enabledToast" : "pausedToast"));
                this.refreshAfterAction();
                (this.getOwnerComponent() as UIComponent & { triggerRefresh?: () => void }).triggerRefresh?.();
            })
            .catch((err) => this.showActionError(err));
    }

    formatPauseActionText(enabled: unknown): string {
        return this.isScheduleEnabled(enabled)
            ? getTextSync(this, "actionPause")
            : getTextSync(this, "actionEnable");
    }

    formatPauseActionIcon(enabled: unknown): string {
        return this.isScheduleEnabled(enabled) ? "sap-icon://media-pause" : "sap-icon://media-play";
    }

    formatPauseActionType(enabled: unknown): string {
        return this.isScheduleEnabled(enabled) ? "Transparent" : "Attention";
    }

    onResetOverrides(): void {
        if (!this.requireContext()) {
            return;
        }
        void getText(this, "resetOverridesConfirm").then((text) => {
            MessageBox.confirm(text, {
                onClose: (action) => {
                    if (action !== MessageBox.Action.OK) {
                        return;
                    }
                    invokeBoundAction(this, BOUND_CLEAR_OVERRIDES, { keys: "" })
                        .then(async () => {
                            MessageToast.show(await getText(this, "actionSuccess"));
                            this.refreshAfterAction();
                        })
                        .catch((err) => this.showActionError(err));
                },
            });
        });
    }

    onEditOverride(event: { getSource: () => { getBindingContext: (m: string) => { getProperty: (p: string) => unknown } | null } }): void {
        const rowCtx = event.getSource().getBindingContext("detail");
        if (!rowCtx) {
            return;
        }
        const path = String(rowCtx.getProperty("path") || "");
        const current = rowCtx.getProperty("override") ?? rowCtx.getProperty("effective");
        this.detailModel().setProperty("/overrideEdit", createOverrideEditState(path, current));
        void this.openEditOverrideDialog();
    }

    private async openEditOverrideDialog(): Promise<void> {
        if (!this.editOverrideDialog) {
            this.editOverrideDialog = (await Fragment.load({
                id: this.getView().getId(),
                name: "pipeline.monitor.fcl.fragments.EditOverrideDialog",
                controller: this,
            })) as Dialog;
            this.getView().addDependent(this.editOverrideDialog);
        }
        this.applyOverrideScheduleKindVisibility(
            this.detailModel().getProperty("/overrideEdit/scheduleKind") as string
        );
        const path = this.detailModel().getProperty("/overrideEdit/path") as string;
        this.editOverrideDialog?.setTitle(
            `${getTextSync(this, "actionEditOverride")} — ${this.formatOverrideFieldLabel(path)}`
        );
        this.editOverrideDialog.open();
    }

    onEditOverrideCancel(): void {
        this.editOverrideDialog?.close();
    }

    onOverrideScheduleKindChange(event: { getParameter: (name: string) => { getKey: () => string } | undefined }): void {
        const item = event.getParameter("item");
        this.applyOverrideScheduleKindVisibility(item?.getKey() || "interval");
    }

    private applyOverrideScheduleKindVisibility(kind: string): void {
        if (kind === "cron") {
            this.detailModel().setProperty("/overrideEdit/scheduleEngine", "queued");
        }
    }

    onEditOverrideConfirm(): void {
        if (!this.requireContext()) {
            return;
        }
        const editState = this.detailModel().getProperty("/overrideEdit") as OverrideEditState;
        const built = buildOverrideValue(editState);
        if (built.errorKey) {
            void getText(this, built.errorKey).then((text) => MessageBox.error(text));
            return;
        }
        const patch = this.pathToOverridePatch(editState.path, built.value);
        const dialog = this.editOverrideDialog;
        dialog?.setBusy(true);
        invokeBoundAction(this, BOUND_SET_OVERRIDES, {
            overrides: JSON.stringify(patch),
        })
            .then(async () => {
                MessageToast.show(await getText(this, "actionSuccess"));
                dialog?.close();
                this.refreshAfterAction();
            })
            .catch((err) => this.showActionError(err))
            .finally(() => dialog?.setBusy(false));
    }

    onClearFieldOverride(event: { getSource: () => { getBindingContext: (m: string) => { getProperty: (p: string) => unknown } | null } }): void {
        const rowCtx = event.getSource().getBindingContext("detail");
        if (!rowCtx) {
            return;
        }
        const path = String(rowCtx.getProperty("path") || "");
        invokeBoundAction(this, BOUND_CLEAR_OVERRIDES, { keys: path })
            .then(async () => {
                MessageToast.show(await getText(this, "actionSuccess"));
                this.refreshAfterAction();
            })
            .catch((err) => this.showActionError(err));
    }

    private pathToOverridePatch(path: string, value: unknown): Record<string, unknown> {
        const parts = path.split(".");
        if (parts.length === 1) {
            return { [parts[0]]: value };
        }
        const root: Record<string, unknown> = {};
        let cur: Record<string, unknown> = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const next: Record<string, unknown> = {};
            cur[parts[i]] = next;
            cur = next;
        }
        cur[parts[parts.length - 1]] = value;
        return root;
    }

    onFlush(): void {
        const ctx = this.requireContext();
        if (!ctx) {
            return;
        }
        const name = String(ctx.getProperty("name") || "");
        const origin = ctx.getProperty("origin");
        const hasOrigin = origin != null && String(origin).trim() !== "";
        const confirmKey = hasOrigin ? "flushConfirmOrigin" : "flushConfirm";
        const confirmArgs = hasOrigin ? [name, String(origin)] : [name];
        void getText(this, confirmKey, confirmArgs).then((text) => {
            MessageBox.confirm(text, {
                onClose: (action) => {
                    if (action !== MessageBox.Action.OK) {
                        return;
                    }
                    this.detailModel().setProperty("/busy", true);
                    invokeUnboundAction(this, "/flush", { name })
                        .then(async () => {
                            MessageToast.show(await getText(this, "actionSuccess"));
                            this.refreshAfterAction();
                        })
                        .catch((err) => this.showActionError(err))
                        .finally(() => this.detailModel().setProperty("/busy", false));
                },
            });
        });
    }
}
