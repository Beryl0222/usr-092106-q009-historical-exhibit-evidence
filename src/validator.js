import { AGGREGATE_TYPES, EVENT_TYPES } from "./vocab.js";

// 基础事件信封校验：只管契约层（统一标识、类型、版本、时间、载荷存在）。
// 业务不变量（引用完整性、证据充分性等）由 reducer 与发布门禁负责，
// 校验器不覆盖、不改写任何业务内容。
const REQUIRED = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary", "payload"];
const ALLOWED = new Set(REQUIRED);

export function validateEvent(record) {
  const errors = [];
  if (record === null || typeof record !== "object") return ["事件必须是对象"];

  for (const name of REQUIRED) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  for (const key of Object.keys(record)) {
    if (!ALLOWED.has(key)) errors.push(`契约外字段：${key}`);
  }
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知事件类型：${record.event_type}`);
  }
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未知聚合类型：${record.aggregate_type}`);
  }
  if ("occurred_at" in record && Number.isNaN(Date.parse(record.occurred_at))) {
    errors.push("occurred_at 必须是合法的 date-time");
  }
  if ("payload" in record && (record.payload === null || typeof record.payload !== "object" || Array.isArray(record.payload))) {
    errors.push("payload 必须是对象");
  }
  if ("event_id" in record && (typeof record.event_id !== "string" || record.event_id.trim() === "")) {
    errors.push("event_id 必须是非空字符串");
  }
  if ("aggregate_id" in record && (typeof record.aggregate_id !== "string" || record.aggregate_id.trim() === "")) {
    errors.push("aggregate_id 必须是非空字符串");
  }
  if ("summary" in record && (typeof record.summary !== "string" || record.summary.trim() === "")) {
    errors.push("summary 必须是非空字符串");
  }
  return errors;
}
