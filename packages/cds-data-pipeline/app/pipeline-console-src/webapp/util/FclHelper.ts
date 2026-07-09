import FlexibleColumnLayout from "sap/f/FlexibleColumnLayout";
import FlexibleColumnLayoutSemanticHelper from "sap/f/FlexibleColumnLayoutSemanticHelper";

export const Layout = {
    one: "OneColumn",
    twoMid: "TwoColumnsMidExpanded",
    threeMid: "ThreeColumnsMidExpanded",
    twoBegin: "TwoColumnsBeginExpanded",
    threeEnd: "ThreeColumnsEndExpanded",
    midFullScreen: "MidColumnFullScreen",
} as const;

export function getFcl(view: { byId: (id: string) => unknown }): FlexibleColumnLayout {
    return view.byId("fcl") as FlexibleColumnLayout;
}

export function getSemanticHelper(fcl: FlexibleColumnLayout) {
    return FlexibleColumnLayoutSemanticHelper.getInstanceFor(fcl, {
        defaultTwoColumnLayoutType: Layout.twoMid,
        defaultThreeColumnLayoutType: Layout.threeMid,
    });
}

type ColumnActionInfo = {
    fullScreen?: string | null;
    exitFullScreen?: string | null;
    closeColumn?: string | null;
};

type ColumnActionFlags = {
    fullScreen: boolean;
    exitFullScreen: boolean;
    closeColumn: boolean;
};

function columnActionFlags(info: ColumnActionInfo): ColumnActionFlags {
    return {
        fullScreen: info.fullScreen != null,
        exitFullScreen: info.exitFullScreen != null,
        closeColumn: info.closeColumn != null,
    };
}

/** Push current FCL semantic state (close / fullscreen visibility) into the shared `fcl` model. */
export function syncFclActionButtons(component: { getRootControl: () => { byId: (id: string) => unknown }; getModel: (name: string) => { setProperty: (path: string, value: unknown) => void } | undefined }): void {
    const fclModel = component.getModel("fcl");
    if (!fclModel) {
        return;
    }
    const fcl = getFcl(component.getRootControl());
    const uiState = getSemanticHelper(fcl).getCurrentUIState();
    fclModel.setProperty("/actionButtonsInfo", uiState.actionButtonsInfo);
    fclModel.setProperty("/midColumnActions", columnActionFlags(uiState.actionButtonsInfo.midColumn));
    fclModel.setProperty("/endColumnActions", columnActionFlags(uiState.actionButtonsInfo.endColumn));
}

/** Defer sync until after the FCL applies a layout change from routing or binding. */
export function syncFclActionButtonsDeferred(component: Parameters<typeof syncFclActionButtons>[0]): void {
    const run = () => syncFclActionButtons(component);
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(run));
    } else {
        setTimeout(run, 0);
    }
}

export function isMidColumnFullScreen(layout: unknown): boolean {
    return layout === Layout.midFullScreen;
}

export function setFclLayout(
    component: { getRootControl: () => { byId: (id: string) => unknown }; getModel: (name: string) => { setProperty: (path: string, value: string) => void } | undefined },
    layout: string
): void {
    component.getModel("fcl")?.setProperty("/layout", layout);
}

export function updateLayoutFromRoute(
    fclModel: { setProperty: (path: string, value: string) => void },
    routeName: string,
    queryLayout?: string
) {
    if (queryLayout) {
        fclModel.setProperty("/layout", queryLayout);
        return;
    }
    if (routeName === "master") {
        fclModel.setProperty("/layout", Layout.one);
    } else     if (routeName === "detail") {
        fclModel.setProperty("/layout", Layout.twoMid);
    }
}
