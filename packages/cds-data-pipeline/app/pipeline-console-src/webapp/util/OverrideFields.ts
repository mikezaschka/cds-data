export type OverrideFieldKind =
    | "boolean"
    | "mode"
    | "deltaMode"
    | "description"
    | "string"
    | "integer"
    | "schedule"
    | "json";

export interface OverrideEditState {
    path: string;
    kind: OverrideFieldKind;
    selectKey: string;
    textValue: string;
    booleanValue: boolean;
    scheduleKind: "interval" | "cron";
    scheduleEvery: string;
    scheduleCron: string;
    scheduleEngine: string;
}

export function overrideFieldKind(path: string): OverrideFieldKind {
    switch (path) {
        case "enabled":
            return "boolean";
        case "mode":
            return "mode";
        case "delta.mode":
            return "deltaMode";
        case "description":
            return "description";
        case "schedule":
            return "schedule";
        case "flags":
            return "json";
        default:
            if (path.startsWith("source.") || path.startsWith("retention.")) {
                return "integer";
            }
            return "string";
    }
}

function parseScheduleForEdit(current: unknown): Pick<
    OverrideEditState,
    "scheduleKind" | "scheduleEvery" | "scheduleCron" | "scheduleEngine"
> {
    const defaults = {
        scheduleKind: "interval" as const,
        scheduleEvery: "60000",
        scheduleCron: "",
        scheduleEngine: "spawn",
    };
    if (current == null) {
        return defaults;
    }
    if (typeof current === "number") {
        return { ...defaults, scheduleEvery: String(current) };
    }
    if (typeof current === "string") {
        const trimmed = current.trim();
        if (/^\d+$/.test(trimmed)) {
            return { ...defaults, scheduleEvery: trimmed };
        }
        return defaults;
    }
    if (typeof current === "object") {
        const schedule = current as Record<string, unknown>;
        if (schedule.cron != null && String(schedule.cron).trim()) {
            return {
                scheduleKind: "cron",
                scheduleEvery: "",
                scheduleCron: String(schedule.cron),
                scheduleEngine: String(schedule.engine || "queued"),
            };
        }
        return {
            scheduleKind: "interval",
            scheduleEvery: schedule.every != null ? String(schedule.every) : defaults.scheduleEvery,
            scheduleCron: "",
            scheduleEngine: String(schedule.engine || "spawn"),
        };
    }
    return defaults;
}

export function createOverrideEditState(path: string, current: unknown): OverrideEditState {
    const kind = overrideFieldKind(path);
    const state: OverrideEditState = {
        path,
        kind,
        selectKey: "",
        textValue: "",
        booleanValue: true,
        scheduleKind: "interval",
        scheduleEvery: "60000",
        scheduleCron: "",
        scheduleEngine: "spawn",
    };

    switch (kind) {
        case "boolean":
            state.booleanValue = current !== false && current !== 0 && current !== "false";
            break;
        case "mode":
            state.selectKey = current != null && String(current) !== "" ? String(current) : "delta";
            break;
        case "deltaMode":
            state.selectKey = current != null && String(current) !== "" ? String(current) : "timestamp";
            break;
        case "integer":
            state.textValue = current != null && current !== "" ? String(current) : "";
            break;
        case "description":
        case "string":
            state.textValue = current != null ? String(current) : "";
            break;
        case "schedule":
            Object.assign(state, parseScheduleForEdit(current));
            break;
        case "json":
            state.textValue =
                current == null
                    ? "{}"
                    : typeof current === "object"
                      ? JSON.stringify(current, null, 2)
                      : String(current);
            break;
        default:
            break;
    }

    return state;
}

export function overrideFieldI18nKey(path: string, prefix: "overrideHelp" | "overrideLabel"): string {
    return `${prefix}_${path.replace(/\./g, "_")}`;
}

export function buildOverrideValue(state: OverrideEditState): { value?: unknown; errorKey?: string } {
    switch (state.kind) {
        case "boolean":
            return { value: state.booleanValue };
        case "mode":
        case "deltaMode":
            if (!state.selectKey) {
                return { errorKey: "overrideSelectRequired" };
            }
            return { value: state.selectKey };
        case "integer": {
            const parsed = Number.parseInt(state.textValue, 10);
            if (Number.isNaN(parsed)) {
                return { errorKey: "overrideIntegerInvalid" };
            }
            return { value: parsed };
        }
        case "description":
        case "string":
            return { value: state.textValue };
        case "schedule":
            if (state.scheduleKind === "cron") {
                const cron = state.scheduleCron.trim();
                if (!cron || cron.split(/\s+/).length !== 5) {
                    return { errorKey: "scheduleCronInvalid" };
                }
                return { value: { cron, engine: state.scheduleEngine || "queued" } };
            }
            {
                const every = Number.parseInt(state.scheduleEvery, 10);
                if (Number.isNaN(every) || every <= 0) {
                    return { errorKey: "scheduleInvalid" };
                }
                return { value: { every, engine: state.scheduleEngine || "spawn" } };
            }
        case "json":
            try {
                return { value: JSON.parse(state.textValue) as unknown };
            } catch {
                return { errorKey: "overrideJsonInvalid" };
            }
        default:
            return { value: state.textValue };
    }
}
