import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { updateLayoutFromRoute, syncFclActionButtonsDeferred } from "pipeline/monitor/fcl/util/FclHelper";

const MANIFEST_REFRESH = "/sap.ui5/pipelineConsole/refreshIntervalSeconds";
const MANIFEST_RUNNING_REFRESH = "/sap.ui5/pipelineConsole/runningRefreshIntervalSeconds";

function refreshODataModel(model: ODataModel | undefined) {
    if (!model?.refresh || !model.getGroupId) {
        return;
    }
    model.refresh(model.getGroupId());
}

/**
 * @namespace pipeline.monitor.fcl
 */
export default class Component extends UIComponent {
    static metadata = {
        manifest: "json",
    };

    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private refreshIntervalMs = 30000;
    private runningIntervalMs = 3000;
    private fastPolling = false;

    init(): void {
        super.init();

        this.setModel(
            new JSONModel({
                layout: "OneColumn",
                actionButtonsInfo: {
                    midColumn: { fullScreen: null, exitFullScreen: null, closeColumn: null },
                    endColumn: { fullScreen: null, exitFullScreen: null, closeColumn: null },
                },
                midColumnActions: { fullScreen: false, exitFullScreen: false, closeColumn: false },
                endColumnActions: { fullScreen: false, exitFullScreen: false, closeColumn: false },
            }),
            "fcl"
        );

        this.setModel(
            new JSONModel({
                fastPolling: false,
            }),
            "appState"
        );

        const idleSec = (this.getManifestEntry(MANIFEST_REFRESH) as number | undefined) ?? 30;
        const runningSec =
            (this.getManifestEntry(MANIFEST_RUNNING_REFRESH) as number | undefined) ?? 3;
        this.refreshIntervalMs = Math.max(idleSec, 5) * 1000;
        this.runningIntervalMs = Math.max(runningSec, 1) * 1000;

        this.getRouter().attachRouteMatched(this.onRouteMatched, this);
        this.getRouter().initialize();
        this.ensureInitialRoute();
        this.startPolling(false);
    }

    setFastPolling(enabled: boolean): void {
        if (this.fastPolling === enabled) {
            return;
        }
        this.fastPolling = enabled;
        (this.getModel("appState") as JSONModel).setProperty("/fastPolling", enabled);
        this.startPolling(enabled);
    }

    triggerRefresh(): void {
        refreshODataModel(this.getModel() as ODataModel | undefined);
    }

    private startPolling(fast: boolean): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        const interval = fast ? this.runningIntervalMs : this.refreshIntervalMs;
        this.refreshTimer = setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) {
                return;
            }
            refreshODataModel(this.getModel() as ODataModel | undefined);
        }, interval);
    }

    private ensureInitialRoute(): void {
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
    }

    private onRouteMatched(event: Route$PatternMatchedEvent): void {
        const routeName = event.getParameter("name") as string;
        const query = event.getParameter("arguments")?.["?query"] as
            | { layout?: string }
            | undefined;
        updateLayoutFromRoute(
            this.getModel("fcl") as JSONModel,
            routeName,
            query?.layout
        );
        syncFclActionButtonsDeferred(this);
        if (routeName === "master") {
            this.setFastPolling(false);
        }
    }

    exit(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        super.exit();
    }
}

interface Route$PatternMatchedEvent {
    getParameter(name: "name"): string;
    getParameter(name: "arguments"): Record<string, string | undefined> & {
        "?query"?: { layout?: string };
    };
}

declare global {
    interface Window {
        requestAnimationFrame: (callback: FrameRequestCallback) => number;
    }
}
