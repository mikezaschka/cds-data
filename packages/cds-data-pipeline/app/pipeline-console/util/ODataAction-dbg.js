sap.ui.define([], function () {
  "use strict";

  function getEntityContext(controller) {
    const view = controller.getView();
    const elementBinding = view.getElementBinding();
    return elementBinding?.getBoundContext() ?? view.getBindingContext();
  }
  function invokeBoundAction(controller, action, params = {}) {
    const context = getEntityContext(controller);
    if (!context) {
      return Promise.reject(new Error("No binding context"));
    }
    const model = controller.getView().getModel();
    const binding = model.bindContext(`${action}(...)`, context, {
      $$groupId: "$direct"
    });
    Object.entries(params).forEach(([key, value]) => {
      binding.setParameter(key, value);
    });
    return binding.execute();
  }
  function invokeUnboundAction(controller, action, params = {}) {
    const model = controller.getView().getModel();
    const actionPath = action.endsWith("(...)") ? action : `${action.replace(/\(.*\)$/, "")}(...)`;
    const binding = model.bindContext(actionPath, null, {
      $$groupId: "$direct"
    });
    Object.entries(params).forEach(([key, value]) => {
      binding.setParameter(key, value);
    });
    return binding.execute();
  }
  function parseODataJsonValue(raw) {
    if (raw == null) {
      return null;
    }
    const value = typeof raw === "object" && raw !== null && "value" in raw ? raw.value : raw;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (typeof value === "object") {
      return value;
    }
    return null;
  }
  async function invokeBoundFunction(controller, functionName) {
    const context = getEntityContext(controller);
    if (!context) {
      return Promise.reject(new Error("No binding context"));
    }
    const model = controller.getView().getModel();
    const binding = model.bindContext(`${functionName}(...)`, context, {
      $$groupId: "$direct"
    });
    await binding.execute();
    return binding.getBoundContext()?.getObject();
  }
  var __exports = {
    __esModule: true
  };
  __exports.getEntityContext = getEntityContext;
  __exports.invokeBoundAction = invokeBoundAction;
  __exports.invokeUnboundAction = invokeUnboundAction;
  __exports.parseODataJsonValue = parseODataJsonValue;
  __exports.invokeBoundFunction = invokeBoundFunction;
  return __exports;
});
//# sourceMappingURL=ODataAction-dbg.js.map
