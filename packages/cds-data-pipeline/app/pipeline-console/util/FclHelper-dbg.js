sap.ui.define(["sap/f/FlexibleColumnLayoutSemanticHelper"], function (FlexibleColumnLayoutSemanticHelper) {
  "use strict";

  const Layout = {
    one: "OneColumn",
    twoMid: "TwoColumnsMidExpanded",
    threeMid: "ThreeColumnsMidExpanded",
    twoBegin: "TwoColumnsBeginExpanded",
    threeEnd: "ThreeColumnsEndExpanded",
    midFullScreen: "MidColumnFullScreen"
  };
  function getFcl(view) {
    return view.byId("fcl");
  }
  function getSemanticHelper(fcl) {
    return FlexibleColumnLayoutSemanticHelper.getInstanceFor(fcl, {
      defaultTwoColumnLayoutType: Layout.twoMid,
      defaultThreeColumnLayoutType: Layout.threeMid
    });
  }
  function columnActionFlags(info) {
    return {
      fullScreen: info.fullScreen != null,
      exitFullScreen: info.exitFullScreen != null,
      closeColumn: info.closeColumn != null
    };
  }

  /** Push current FCL semantic state (close / fullscreen visibility) into the shared `fcl` model. */
  function syncFclActionButtons(component) {
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
  function syncFclActionButtonsDeferred(component) {
    const run = () => syncFclActionButtons(component);
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(run));
    } else {
      setTimeout(run, 0);
    }
  }
  function isMidColumnFullScreen(layout) {
    return layout === Layout.midFullScreen;
  }
  function setFclLayout(component, layout) {
    component.getModel("fcl")?.setProperty("/layout", layout);
  }
  function updateLayoutFromRoute(fclModel, routeName, queryLayout) {
    if (queryLayout) {
      fclModel.setProperty("/layout", queryLayout);
      return;
    }
    if (routeName === "master") {
      fclModel.setProperty("/layout", Layout.one);
    } else if (routeName === "detail") {
      fclModel.setProperty("/layout", Layout.twoMid);
    }
  }
  var __exports = {
    __esModule: true
  };
  __exports.Layout = Layout;
  __exports.getFcl = getFcl;
  __exports.getSemanticHelper = getSemanticHelper;
  __exports.syncFclActionButtons = syncFclActionButtons;
  __exports.syncFclActionButtonsDeferred = syncFclActionButtonsDeferred;
  __exports.isMidColumnFullScreen = isMidColumnFullScreen;
  __exports.setFclLayout = setFclLayout;
  __exports.updateLayoutFromRoute = updateLayoutFromRoute;
  return __exports;
});
//# sourceMappingURL=FclHelper-dbg.js.map
