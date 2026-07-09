import type { ValueState } from "sap/ui/core/library";

function normalizeStatus(status: unknown): string {
    return String(status ?? "").trim().toLowerCase();
}

export function statusState(status: string): ValueState {
    const map: Record<string, ValueState> = {
        idle: "Success",
        running: "Information",
        failed: "Error",
    };
    return map[normalizeStatus(status)] || "None";
}

export function statusIcon(status: string): string {
    const map: Record<string, string> = {
        idle: "sap-icon://status-positive",
        running: "sap-icon://refresh",
        failed: "sap-icon://error",
    };
    return map[normalizeStatus(status)] || "sap-icon://question-mark";
}

/** ObjectStatus icon — running uses a separate animated refresh control. */
export function statusBadgeIcon(status: string): string {
    if (normalizeStatus(status) === "running") {
        return "";
    }
    return statusIcon(status);
}

export function isRunningStatus(status: unknown): boolean {
    return normalizeStatus(status) === "running";
}

export function isScheduleEnabled(enabled: unknown): boolean {
    return enabled !== false && enabled !== 0 && enabled !== "false";
}

export function hasActiveSchedule(schedule: unknown): boolean {
    return schedule != null && String(schedule).trim() !== "";
}

export function formatScheduleText(schedule: unknown, notScheduledLabel = "Not scheduled"): string {
    return hasActiveSchedule(schedule) ? String(schedule) : notScheduledLabel;
}

export function showScheduleExpression(schedule: unknown): boolean {
    return hasActiveSchedule(schedule);
}

export interface SchedulingLabels {
    notScheduled: string;
    active: string;
    paused: string;
}

export function isSchedulePaused(schedule: unknown, enabled: unknown): boolean {
    return hasActiveSchedule(schedule) && !isScheduleEnabled(enabled);
}

export function schedulingIcon(schedule: unknown, enabled: unknown): string {
    if (!hasActiveSchedule(schedule)) {
        return "";
    }
    return isScheduleEnabled(enabled) ? "sap-icon://date-time" : "sap-icon://pause";
}

export function schedulingLabel(
    schedule: unknown,
    enabled: unknown,
    labels: SchedulingLabels,
): string {
    if (!hasActiveSchedule(schedule)) {
        return labels.notScheduled;
    }
    return isScheduleEnabled(enabled) ? labels.active : labels.paused;
}

export function schedulingState(schedule: unknown, enabled: unknown): ValueState {
    if (!hasActiveSchedule(schedule)) {
        return "None";
    }
    return isScheduleEnabled(enabled) ? "Success" : "Warning";
}

export function scheduleCellLabel(
    schedule: unknown,
    enabled: unknown,
    labels: SchedulingLabels,
): string {
    if (!hasActiveSchedule(schedule)) {
        return labels.notScheduled;
    }
    const status = isScheduleEnabled(enabled) ? labels.active : labels.paused;
    return `${String(schedule)} · ${status}`;
}

export function errorState(count: number): ValueState {
    return count > 0 ? "Error" : "None";
}

export function formatJson(json: string | null | undefined): string {
    if (!json) {
        return "—";
    }
    try {
        return JSON.stringify(JSON.parse(String(json)), null, 2);
    } catch {
        return String(json);
    }
}

function toTimestamp(value: string | number | Date | null | undefined): number | null {
    if (value == null || value === "") {
        return null;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return null;
        }
        // Unix seconds (10 digits in 2020s) vs milliseconds (13 digits).
        return Math.abs(value) < 1e12 ? value * 1000 : value;
    }
    const text = String(value).trim();
    const v2Match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);
    if (v2Match) {
        const ticks = Number(v2Match[1]);
        return Number.isFinite(ticks) ? ticks : null;
    }
    if (/^\d+$/.test(text)) {
        const numeric = Number(text);
        const time = text.length <= 10 ? numeric * 1000 : numeric;
        return Number.isFinite(time) ? time : null;
    }
    const time = new Date(text).getTime();
    return Number.isNaN(time) ? null : time;
}

export function formatTimestamp(value: string | number | Date | null | undefined): string {
    const time = toTimestamp(value);
    if (time == null) {
        return "";
    }
    return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelativeTime(value: string | number | Date | null | undefined): string {
    const time = toTimestamp(value);
    if (time == null) {
        return "";
    }
    const diffMs = Date.now() - time;
    // Server timestamp ahead of local clock (or skew) — show absolute time instead of "-Ns ago".
    if (diffMs < -60_000) {
        return formatTimestamp(value);
    }
    const seconds = Math.round(Math.max(0, diffMs) / 1000);
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
        return `${hours}h ago`;
    }
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

export function runDuration(start: string | number | Date | null, end: string | number | Date | null): string {
    const startTime = toTimestamp(start);
    const endTime = toTimestamp(end);
    if (startTime == null || endTime == null) {
        return "—";
    }
    const ms = endTime - startTime;
    if (Number.isNaN(ms) || ms < 0) {
        return "—";
    }
    if (ms < 1000) {
        return `${ms} ms`;
    }
    if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)} s`;
    }
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min} m ${sec} s`;
}

export function errorPreview(error: string | null | undefined): string {
    if (!error) {
        return "";
    }
    const text = String(error);
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function placeholder(value: unknown, emptyText = "—"): string {
    if (value === null || value === undefined || value === "") {
        return emptyText;
    }
    return String(value);
}

export function parseConfigJson(json: string | null | undefined): Record<string, unknown> {
    if (!json) {
        return {};
    }
    try {
        return JSON.parse(String(json)) as Record<string, unknown>;
    } catch {
        return {};
    }
}
