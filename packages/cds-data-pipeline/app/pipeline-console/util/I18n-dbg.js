sap.ui.define([], function () {
  "use strict";

  async function getText(controller, key, args) {
    const component = "getOwnerComponent" in controller ? controller.getOwnerComponent() : controller;
    const i18nModel = component?.getModel("i18n");
    const bundle = await i18nModel?.getResourceBundle();
    return bundle?.getText(key, args) ?? key;
  }
  function getTextSync(controller, key, args) {
    const i18nModel = controller.getOwnerComponent()?.getModel("i18n");
    const bundle = i18nModel?.getResourceBundle();
    return bundle?.getText(key, args) ?? key;
  }
  var __exports = {
    __esModule: true
  };
  __exports.getText = getText;
  __exports.getTextSync = getTextSync;
  return __exports;
});
//# sourceMappingURL=I18n-dbg.js.map
