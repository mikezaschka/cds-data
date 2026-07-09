import Controller from "sap/ui/core/mvc/Controller";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import JSONModel from "sap/ui/model/json/JSONModel";
import MessageToast from "sap/m/MessageToast";
import Graph from "sap/suite/ui/commons/networkgraph/Graph";
import type IconTabBar from "sap/m/IconTabBar";
import type Table from "sap/m/Table";
import type ColumnListItem from "sap/m/ColumnListItem";
import type ListBinding from "sap/ui/model/ListBinding";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type UIComponent from "sap/ui/core/UIComponent";
import { parseFlowGraphPayload, renderFlowGraph, fitFlowGraphToView } from "pipeline/monitor/fcl/util/FlowGraph";
import { getText, getTextSync } from "pipeline/monitor/fcl/util/I18n";
import {
    statusState,
    statusIcon,
    statusBadgeIcon,
    errorState,
    formatRelativeTime,
    isScheduleEnabled,
    hasActiveSchedule,
    isSchedulePaused,
    showScheduleExpression,
    schedulingLabel,
    schedulingState,
    schedulingIcon,
    scheduleCellLabel,
} from "pipeline/monitor/fcl/util/Formatters";

/**
 * @namespace pipeline.monitor.fcl.controller
 */
export default class Master extends Controller {
    private selectedName: string | null = null;
    private applyingSelection = false;
    private summaryAttached = false;
    private overviewLoaded = false;

    onInit(): void {
        const router = (this.getOwnerComponent() as UIComponent).getRouter();
        router.getRoute("master")?.attachPatternMatched(this.onMasterMatched, this);
        router.getRoute("detail")?.attachPatternMatched(this.onDetailMatched, this);

        this.getView().setModel(
            new JSONModel({
                total: 0,
                running: 0,
                failed: 0,
                summary: "",
                landscapeReady: false,
                selectedTab: "pipelines",
            }),
            "master"
        );
    }

    private masterModel(): JSONModel {
        return this.getView().getModel("master") as JSONModel;
    }

    private pipelineTable(): Table | undefined {
        return this.byId("pipelineTable") as Table | undefined;
    }

    private landscapeGraph(): Graph | undefined {
        return this.byId("landscapeGraph") as Graph | undefined;
    }

    private async setSummaryText(total: number, running: number, failed: number): Promise<void> {
        const text = await getText(this, "masterSummary", [
            String(total),
            String(running),
            String(failed),
        ]);
        this.masterModel().setProperty("/summary", text);
    }

    private attachSummaryListener(): void {
        if (this.summaryAttached) {
            return;
        }
        const binding = this.pipelineTable()?.getBinding("items") as ListBinding | undefined;
        if (binding) {
            this.summaryAttached = true;
            binding.attachEvent("change", this.updateSummary.bind(this));
        }
    }

    private updateSummary(): void {
        const binding = this.pipelineTable()?.getBinding("items") as ListBinding | undefined;
        const contexts = binding?.getContexts() || [];
        let running = 0;
        let failed = 0;
        contexts.forEach((ctx) => {
            const status = ctx.getProperty("status") as string;
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

        const component = this.getOwnerComponent() as UIComponent & {
            setFastPolling?: (enabled: boolean) => void;
        };
        component.setFastPolling?.(running > 0);
    }

    private onMasterMatched = (): void => {
        this.selectedName = null;
        this.pipelineTable()?.removeSelections();
    };

    private onDetailMatched = (event: { getParameter: (name: string) => { name?: string } }): void => {
        const args = event.getParameter("arguments");
        this.selectedName = args?.name ? decodeURIComponent(String(args.name)) : null;
        this.applySelection();
    };

    private applySelection(): void {
        const table = this.pipelineTable();
        const name = this.selectedName;
        if (!table || !name) {
            return;
        }
        this.applyingSelection = true;
        const items = table.getItems() as ColumnListItem[];
        for (const item of items) {
            const ctx = item.getBindingContext();
            if (ctx?.getProperty("name") === name) {
                table.setSelectedItem(item, true);
                break;
            }
        }
        this.applyingSelection = false;
    }

    onTableUpdateFinished(): void {
        this.attachSummaryListener();
        this.applySelection();
        this.updateSummary();
        if (this.masterModel().getProperty("/selectedTab") === "overview") {
            void this.loadLandscapeGraph();
        }
    }

    onMasterTabSelect(event: { getParameter: (name: string) => { getKey: () => string } | undefined }): void {
        const key = event.getParameter("item")?.getKey() || "pipelines";
        this.masterModel().setProperty("/selectedTab", key);
        if (key === "overview" && !this.overviewLoaded) {
            void this.loadLandscapeGraph();
        }
    }

    private async loadLandscapeGraph(): Promise<void> {
        const graph = this.landscapeGraph();
        if (!graph) {
            return;
        }
        try {
            const model = (this.getOwnerComponent() as UIComponent).getModel() as ODataModel;
            const binding = model.bindContext("/landscapeMetadata(...)", null, { $$groupId: "$direct" });
            await binding.execute();
            const raw = binding.getBoundContext()?.getObject();
            const payload = parseFlowGraphPayload(raw);
            const hasNodes = !!payload?.nodes?.length;
            this.masterModel().setProperty("/landscapeReady", hasNodes);
            renderFlowGraph(graph, payload);
            this.overviewLoaded = true;
            if (hasNodes) {
                fitFlowGraphToView(graph);
            }
        } catch {
            renderFlowGraph(graph, null);
            this.masterModel().setProperty("/landscapeReady", false);
        }
    }

    onSelectionChange(event: { getParameter: (name: string) => ColumnListItem | null }): void {
        if (this.applyingSelection) {
            return;
        }
        const item = event.getParameter("listItem");
        const ctx = item?.getBindingContext();
        const name = ctx?.getProperty("name");
        if (!name) {
            return;
        }
        (this.getOwnerComponent() as UIComponent)
            .getRouter()
            .navTo("detail", { name: encodeURIComponent(String(name)) }, true);
    }

    onSearch(event: { getParameter: (name: string) => string }): void {
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
    }

    async onRefresh(): Promise<void> {
        const model = (this.getOwnerComponent() as UIComponent).getModel() as ODataModel;
        model?.refresh();
        if (this.masterModel().getProperty("/selectedTab") === "overview") {
            void this.loadLandscapeGraph();
        }
        MessageToast.show(await getText(this, "refreshDone"));
    }

    statusState = statusState;
    statusIcon = statusIcon;
    statusBadgeIcon = statusBadgeIcon;
    errorState = errorState;
    formatRelativeTime = formatRelativeTime;

    /** Treat null/undefined as enabled so list does not flash Paused. */
    isScheduleEnabled = isScheduleEnabled;
    isSchedulePaused = isSchedulePaused;
    showScheduleExpression = showScheduleExpression;

    formatScheduleCellLabel(schedule: unknown, enabled: unknown): string {
        return scheduleCellLabel(schedule, enabled, {
            notScheduled: getTextSync(this, "notScheduled"),
            active: getTextSync(this, "statusEnabled"),
            paused: getTextSync(this, "statusPaused"),
        });
    }

    formatSchedulingLabel(schedule: unknown, enabled: unknown): string {
        return this.formatScheduleCellLabel(schedule, enabled);
    }

    formatSchedulingState(schedule: unknown, enabled: unknown): string {
        return schedulingState(schedule, enabled);
    }

    formatSchedulingIcon(schedule: unknown, enabled: unknown): string {
        return schedulingIcon(schedule, enabled);
    }

    formatEnabledLabel(enabled: unknown): string {
        return this.isScheduleEnabled(enabled)
            ? getTextSync(this, "statusEnabled")
            : getTextSync(this, "statusPaused");
    }

    formatEnabledState(enabled: unknown): string {
        return this.isScheduleEnabled(enabled) ? "Success" : "Warning";
    }

    formatLastRun(value: string | number | Date | null): string {
        if (value == null || value === "") {
            return getTextSync(this, "neverRun");
        }
        return formatRelativeTime(value);
    }

    formatCount(value: unknown): string {
        if (value === null || value === undefined || value === "") {
            return "0";
        }
        return String(value);
    }

    rowHighlight(status: string, schedule?: unknown, enabled?: unknown): string {
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
}
