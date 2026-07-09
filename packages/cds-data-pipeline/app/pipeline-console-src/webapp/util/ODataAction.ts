import type Controller from "sap/ui/core/mvc/Controller";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ODataContext from "sap/ui/model/odata/v4/Context";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";

export function getEntityContext(controller: Controller): ODataContext | null {
    const view = controller.getView();
    const elementBinding = view.getElementBinding() as ODataContextBinding | undefined;
    return (elementBinding?.getBoundContext() ?? view.getBindingContext()) as ODataContext | null;
}

export function invokeBoundAction(
    controller: Controller,
    action: string,
    params: Record<string, unknown> = {}
): Promise<unknown> {
    const context = getEntityContext(controller);
    if (!context) {
        return Promise.reject(new Error("No binding context"));
    }
    const model = controller.getView().getModel() as ODataModel;
    const binding = model.bindContext(`${action}(...)`, context, {
        $$groupId: "$direct",
    }) as ODataContextBinding;
    Object.entries(params).forEach(([key, value]) => {
        binding.setParameter(key, value);
    });
    return binding.execute();
}

export function invokeUnboundAction(
    controller: Controller,
    action: string,
    params: Record<string, unknown> = {},
): Promise<unknown> {
    const model = controller.getView().getModel() as ODataModel;
    const actionPath = action.endsWith("(...)") ? action : `${action.replace(/\(.*\)$/, "")}(...)`;
    const binding = model.bindContext(actionPath, null, {
        $$groupId: "$direct",
    }) as ODataContextBinding;
    Object.entries(params).forEach(([key, value]) => {
        binding.setParameter(key, value);
    });
    return binding.execute();
}

export function parseODataJsonValue<T>(raw: unknown): T | null {
    if (raw == null) {
        return null;
    }
    const value =
        typeof raw === "object" && raw !== null && "value" in raw
            ? (raw as { value: unknown }).value
            : raw;
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }
    if (typeof value === "object") {
        return value as T;
    }
    return null;
}

export async function invokeBoundFunction(
    controller: Controller,
    functionName: string
): Promise<unknown> {
    const context = getEntityContext(controller);
    if (!context) {
        return Promise.reject(new Error("No binding context"));
    }
    const model = controller.getView().getModel() as ODataModel;
    const binding = model.bindContext(`${functionName}(...)`, context, {
        $$groupId: "$direct",
    }) as ODataContextBinding;
    await binding.execute();
    return binding.getBoundContext()?.getObject();
}
