import { validateEvent } from "./validator.js";

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

// 只追加事件存储：
// - 事件一旦接收即深度冻结，标识/发生时间/版本永不原地改写；
// - 同一聚合的 version 必须连续递增，乱序或重号一律拒绝；
// - 业务更正只能以后继事件表达（CORRECTION_APPROVED / CARRIER_DECISION_ISSUED / RELEASE_RETIRED）。
export class EventStore {
  #events = [];
  #versions = new Map(); // aggregate key -> 最新版本
  #ids = new Set();
  #reduce;
  #state;

  constructor(reducer) {
    this.#reduce = reducer;
    this.#state = reducer(undefined, { type: "__init__" });
  }

  append(record) {
    const envelopeErrors = validateEvent(record);
    if (envelopeErrors.length > 0) {
      throw new EventRejectedError(record, envelopeErrors);
    }
    const key = `${record.aggregate_type}:${record.aggregate_id}`;
    const expected = (this.#versions.get(key) ?? 0) + 1;
    if (record.version !== expected) {
      throw new EventRejectedError(record, [`聚合 ${key} 版本冲突：期望 ${expected}，收到 ${record.version}（事件只追加，不得改写历史）`]);
    }
    if (this.#ids.has(record.event_id)) {
      throw new EventRejectedError(record, [`event_id 重复：${record.event_id}`]);
    }

    // 先交给业务层试归约；引用完整性等业务不变量不通过则整事件拒收
    let nextState;
    try {
      nextState = this.#reduce(this.#state, record);
    } catch (err) {
      throw new EventRejectedError(record, [err.message]);
    }

    const frozen = deepFreeze(structuredClone(record));
    this.#events.push(frozen);
    this.#ids.add(frozen.event_id);
    this.#versions.set(key, frozen.version);
    this.#state = nextState;
    return frozen;
  }

  appendAll(records) {
    return records.map((r) => this.append(r));
  }

  get events() {
    return this.#events.slice();
  }

  get state() {
    return this.#state;
  }
}

export class EventRejectedError extends Error {
  constructor(record, errors) {
    super(`事件 ${record?.event_id ?? "?" } 被拒收：${errors.join("；")}`);
    this.name = "EventRejectedError";
    this.errors = errors;
    this.event_id = record?.event_id ?? null;
  }
}
