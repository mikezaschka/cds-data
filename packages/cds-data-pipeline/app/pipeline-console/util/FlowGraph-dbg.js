sap.ui.define(["sap/suite/ui/commons/networkgraph/Node", "sap/suite/ui/commons/networkgraph/Line", "sap/suite/ui/commons/networkgraph/Group", "sap/suite/ui/commons/networkgraph/ElementAttribute", "sap/suite/ui/commons/library"], function (Node, Line, Group, ElementAttribute, library) {
  "use strict";

  const ElementStatus = library.networkgraph.ElementStatus;
  const FIT_MAX_ATTEMPTS = 24;
  const FIT_RETRY_MS = 50;
  function mapNodeStatus(status) {
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
  function mapAttributes(attributes) {
    if (!attributes?.length) {
      return undefined;
    }
    return attributes.map(a => new ElementAttribute({
      label: a.label,
      value: a.value
    }));
  }
  function graphHasVisibleSize(graph) {
    const dom = graph.getDomRef();
    return (dom?.clientWidth ?? 0) > 0 && (dom?.clientHeight ?? 0) > 0;
  }
  function invokeFitToScreen(graph) {
    graph._fitToScreen?.();
  }

  /** Fit the full graph into the visible viewport (same as the toolbar “fit to screen” action). */
  function fitFlowGraphToView(graph, attempt = 0) {
    if (!graph) {
      return;
    }
    if (!graphHasVisibleSize(graph)) {
      if (attempt < FIT_MAX_ATTEMPTS) {
        window.setTimeout(() => fitFlowGraphToView(graph, attempt + 1), FIT_RETRY_MS);
      }
      return;
    }
    const runFit = () => {
      if (!graphHasVisibleSize(graph)) {
        if (attempt < FIT_MAX_ATTEMPTS) {
          window.setTimeout(() => fitFlowGraphToView(graph, attempt + 1), FIT_RETRY_MS);
        }
        return;
      }
      invokeFitToScreen(graph);
    };
    if (graph._bIsLayedOut) {
      runFit();
      return;
    }
    const onReady = () => {
      graph.detachGraphReady(onReady);
      runFit();
    };
    graph.attachGraphReady(onReady);
  }
  function renderFlowGraph(graph, payload, options) {
    graph.destroyNodes();
    graph.destroyLines();
    if (typeof graph.destroyGroups === "function") {
      graph.destroyGroups();
    }
    if (!payload?.nodes?.length) {
      return;
    }
    for (const group of payload.groups || []) {
      graph.addGroup(new Group({
        key: group.key,
        title: group.title,
        description: group.description,
        icon: group.icon,
        status: mapNodeStatus(group.status)
      }));
    }
    for (const node of payload.nodes) {
      graph.addNode(new Node({
        key: node.key,
        title: node.title,
        icon: node.icon,
        group: node.group,
        status: mapNodeStatus(node.status),
        attributes: mapAttributes(node.attributes)
      }));
    }
    for (const line of payload.lines || []) {
      graph.addLine(new Line({
        from: line.from,
        to: line.to,
        title: line.title,
        status: line.status ? mapNodeStatus(line.status) : undefined
      }));
    }
    if (options?.fitToView) {
      fitFlowGraphToView(graph);
    }
  }
  function parseFlowGraphPayload(raw) {
    if (!raw) {
      return null;
    }
    const value = typeof raw === "object" && raw !== null && "value" in raw ? raw.value : raw;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const graph = parsed.graph;
    if (graph?.nodes) {
      return graph;
    }
    if (parsed.nodes) {
      return parsed;
    }
    return null;
  }
  var __exports = {
    __esModule: true
  };
  __exports.fitFlowGraphToView = fitFlowGraphToView;
  __exports.renderFlowGraph = renderFlowGraph;
  __exports.parseFlowGraphPayload = parseFlowGraphPayload;
  return __exports;
});
//# sourceMappingURL=FlowGraph-dbg.js.map
