import type UIComponent from "sap/ui/core/UIComponent";
import type Controller from "sap/ui/core/mvc/Controller";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";

export async function getText(
    controller: Controller | UIComponent,
    key: string,
    args?: string[]
): Promise<string> {
    const component =
        "getOwnerComponent" in controller
            ? (controller as Controller).getOwnerComponent()
            : (controller as UIComponent);
    const i18nModel = component?.getModel("i18n") as
        | { getResourceBundle: () => ResourceBundle | Promise<ResourceBundle> }
        | undefined;
    const bundle = await i18nModel?.getResourceBundle();
    return bundle?.getText(key, args) ?? key;
}

export function getTextSync(controller: Controller, key: string, args?: string[]): string {
    const i18nModel = controller.getOwnerComponent()?.getModel("i18n") as
        | { getResourceBundle: () => ResourceBundle }
        | undefined;
    const bundle = i18nModel?.getResourceBundle();
    return bundle?.getText(key, args) ?? key;
}






