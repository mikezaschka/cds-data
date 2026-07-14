sap.ui.define(["sap/ui/model/odata/type/DateTimeOffset"], function (DateTimeOffset) {
  "use strict";

  function normalizeStatus(status) {
    return String(status ?? "").trim().toLowerCase();
  }
  function statusState(status) {
    const map = {
      idle: "Success",
      running: "Information",
      failed: "Error"
    };
    return map[normalizeStatus(status)] || "None";
  }
  function statusIcon(status) {
    const map = {
      idle: "sap-icon://status-positive",
      running: "sap-icon://refresh",
      failed: "sap-icon://error"
    };
    return map[normalizeStatus(status)] || "sap-icon://question-mark";
  }

  /** ObjectStatus icon — running uses a separate animated refresh control. */
  function statusBadgeIcon(status) {
    if (normalizeStatus(status) === "running") {
      return "";
    }
    return statusIcon(status);
  }
  function isRunningStatus(status) {
    return normalizeStatus(status) === "running";
  }
  function isScheduleEnabled(enabled) {
    return enabled !== false && enabled !== 0 && enabled !== "false";
  }
  function hasActiveSchedule(schedule) {
    return schedule != null && String(schedule).trim() !== "";
  }
  function formatScheduleText(schedule, notScheduledLabel = "Not scheduled") {
    return hasActiveSchedule(schedule) ? String(schedule) : notScheduledLabel;
  }
  function showScheduleExpression(schedule) {
    return hasActiveSchedule(schedule);
  }
  function isSchedulePaused(schedule, enabled) {
    return hasActiveSchedule(schedule) && !isScheduleEnabled(enabled);
  }
  function schedulingIcon(schedule, enabled) {
    if (!hasActiveSchedule(schedule)) {
      return "";
    }
    return isScheduleEnabled(enabled) ? "sap-icon://date-time" : "sap-icon://pause";
  }
  function schedulingLabel(schedule, enabled, labels) {
    if (!hasActiveSchedule(schedule)) {
      return labels.notScheduled;
    }
    return isScheduleEnabled(enabled) ? labels.active : labels.paused;
  }
  function schedulingState(schedule, enabled) {
    if (!hasActiveSchedule(schedule)) {
      return "None";
    }
    return isScheduleEnabled(enabled) ? "Success" : "Warning";
  }
  function scheduleCellLabel(schedule, enabled, labels) {
    if (!hasActiveSchedule(schedule)) {
      return labels.notScheduled;
    }
    const status = isScheduleEnabled(enabled) ? labels.active : labels.paused;
    return `${String(schedule)} · ${status}`;
  }
  function errorState(count) {
    return count > 0 ? "Error" : "None";
  }
  function formatJson(json) {
    if (!json) {
      return "—";
    }
    try {
      return JSON.stringify(JSON.parse(String(json)), null, 2);
    } catch {
      return String(json);
    }
  }

  /** CAP / OData V4 DateTimeOffset uses millisecond precision (metadata precision 7). */
  let oDataDateTimeOffset;
  function getODataDateTimeOffsetType() {
    if (!oDataDateTimeOffset) {
      oDataDateTimeOffset = new DateTimeOffset({}, {
        precision: 7,
        V4: true,
        nullable: true
      });
    }
    return oDataDateTimeOffset;
  }
  function isDateLike(value) {
    return typeof value === "object" && value !== null && typeof value.getTime === "function";
  }
  function toTimestamp(value) {
    if (value == null || value === "") {
      return null;
    }
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isNaN(time) ? null : time;
    }
    if (isDateLike(value)) {
      const time = value.getTime();
      return Number.isFinite(time) ? time : null;
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
  function formatTimestamp(value) {
    if (value == null || value === "") {
      return "";
    }
    try {
      return getODataDateTimeOffsetType().formatValue(value, "string");
    } catch {
      const time = toTimestamp(value);
      if (time == null) {
        return "";
      }
      return new Date(time).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    }
  }
  function formatRelativeTime(value) {
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
  function runDuration(start, end) {
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
    const sec = Math.round(ms % 60000 / 1000);
    return `${min} m ${sec} s`;
  }
  function errorPreview(error) {
    if (!error) {
      return "";
    }
    const text = String(error);
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }
  function placeholder(value, emptyText = "—") {
    if (value === null || value === undefined || value === "") {
      return emptyText;
    }
    return String(value);
  }
  function parseConfigJson(json) {
    if (!json) {
      return {};
    }
    try {
      return JSON.parse(String(json));
    } catch {
      return {};
    }
  }
  var __exports = {
    __esModule: true
  };
  __exports.statusState = statusState;
  __exports.statusIcon = statusIcon;
  __exports.statusBadgeIcon = statusBadgeIcon;
  __exports.isRunningStatus = isRunningStatus;
  __exports.isScheduleEnabled = isScheduleEnabled;
  __exports.hasActiveSchedule = hasActiveSchedule;
  __exports.formatScheduleText = formatScheduleText;
  __exports.showScheduleExpression = showScheduleExpression;
  __exports.isSchedulePaused = isSchedulePaused;
  __exports.schedulingIcon = schedulingIcon;
  __exports.schedulingLabel = schedulingLabel;
  __exports.schedulingState = schedulingState;
  __exports.scheduleCellLabel = scheduleCellLabel;
  __exports.errorState = errorState;
  __exports.formatJson = formatJson;
  __exports.formatTimestamp = formatTimestamp;
  __exports.formatRelativeTime = formatRelativeTime;
  __exports.runDuration = runDuration;
  __exports.errorPreview = errorPreview;
  __exports.placeholder = placeholder;
  __exports.parseConfigJson = parseConfigJson;
  return __exports;
});
//# sourceMappingURL=Formatters-dbg.js.map
