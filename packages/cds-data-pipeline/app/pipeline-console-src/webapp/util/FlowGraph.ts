import Graph from "sap/suite/ui/commons/networkgraph/Graph";
import Node from "sap/suite/ui/commons/networkgraph/Node";
import Line from "sap/suite/ui/commons/networkgraph/Line";
import Group from "sap/suite/ui/commons/networkgraph/Group";
import ElementAttribute from "sap/suite/ui/commons/networkgraph/ElementAttribute";
import library from "sap/suite/ui/commons/library";

const ElementStatus = library.networkgraph.ElementStatus;

const FIT_MAX_ATTEMPTS = 24;
const FIT_RETRY_MS = 50;

export interface FlowGraphGroupPayload {
    key: string;
    title: string;
    description?: string;
    icon?: string;
    status?: string;
}

export interface FlowGraphNodePayload {
    key: string;
    title: string;
    icon?: string;
    status?: string;
    group?: string;
    event?: string;
    attributes?: Array<{ label: string; value: string }>;
}

export interface FlowGraphLinePayload {
    from: string;
    to: string;
    title?: string;
    status?: string;
}

export interface FlowGraphPayload {
    nodes: FlowGraphNodePayload[];
    lines: FlowGraphLinePayload[];
    groups?: FlowGraphGroupPayload[];
}

export interface FlowGraphRenderOptions {
    /** Zoom the graph so the full flow fits the viewport (detail tab). */
    fitToView?: boolean;
}

function mapNodeStatus(status?: string): string {
    switch (status) {
        case "Warning":
            return ElementStatus.Warning;
        case "Error":
            return ElementStatus.Error;
        case "Information":
            return ElementStatus.Information;
        default:
            return ElementStatus.Success;
    }
}

function mapAttributes(attributes?: Array<{ label: string; value: string }>): ElementAttribute[] | undefined {
    if (!attributes?.length) {
        return undefined;
    }
    return attributes.map(
        (a) =>
            new ElementAttribute({
                label: a.label,
                value: a.value,
            })
    );
}

type GraphWithLayout = Graph & {
    _fitToScreen?: () => void;
    _bIsLayedOut?: boolean;
};

function graphHasVisibleSize(graph: Graph): boolean {
    const dom = graph.getDomRef();
    return (dom?.clientWidth ?? 0) > 0 && (dom?.clientHeight ?? 0) > 0;
}

function invokeFitToScreen(graph: Graph): void {
    (graph as GraphWithLayout)._fitToScreen?.();
}

/** Fit the full graph into the visible viewport (same as the toolbar “fit to screen” action). */
export function fitFlowGraphToView(graph: Graph | undefined, attempt = 0): void {
    if (!graph) {
        return;
    }

    if (!graphHasVisibleSize(graph)) {
        if (attempt < FIT_MAX_ATTEMPTS) {
            window.setTimeout(() => fitFlowGraphToView(graph, attempt + 1), FIT_RETRY_MS);
        }
        return;
    }

    const runFit = (): void => {
        if (!graphHasVisibleSize(graph)) {
            if (attempt < FIT_MAX_ATTEMPTS) {
                window.setTimeout(() => fitFlowGraphToView(graph, attempt + 1), FIT_RETRY_MS);
            }
            return;
        }
        invokeFitToScreen(graph);
    };

    if ((graph as GraphWithLayout)._bIsLayedOut) {
        runFit();
        return;
    }

    const onReady = (): void => {
        graph.detachGraphReady(onReady);
        runFit();
    };
    graph.attachGraphReady(onReady);
}

export function renderFlowGraph(
    graph: Graph,
    payload: FlowGraphPayload | null | undefined,
    options?: FlowGraphRenderOptions
): void {
    graph.destroyNodes();
    graph.destroyLines();
    if (typeof (graph as Graph & { destroyGroups?: () => void }).destroyGroups === "function") {
        (graph as Graph & { destroyGroups: () => void }).destroyGroups();
    }

    if (!payload?.nodes?.length) {
        return;
    }

    for (const group of payload.groups || []) {
        graph.addGroup(
            new Group({
                key: group.key,
                title: group.title,
                description: group.description,
                icon: group.icon,
                status: mapNodeStatus(group.status),
            })
        );
    }

    for (const node of payload.nodes) {
        graph.addNode(
            new Node({
                key: node.key,
                title: node.title,
                icon: node.icon,
                group: node.group,
                status: mapNodeStatus(node.status),
                attributes: mapAttributes(node.attributes),
            })
        );
    }

    for (const line of payload.lines || []) {
        graph.addLine(
            new Line({
                from: line.from,
                to: line.to,
                title: line.title,
                status: line.status ? mapNodeStatus(line.status) : undefined,
            })
        );
    }

    if (options?.fitToView) {
        fitFlowGraphToView(graph);
    }
}

export function parseFlowGraphPayload(raw: unknown): FlowGraphPayload | null {
    if (!raw) {
        return null;
    }
    const value = typeof raw === "object" && raw !== null && "value" in raw ? (raw as { value: unknown }).value : raw;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    const graph = (parsed as { graph?: FlowGraphPayload }).graph;
    if (graph?.nodes) {
        return graph;
    }
    if ((parsed as FlowGraphPayload).nodes) {
        return parsed as FlowGraphPayload;
    }
    return null;
}
