import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";
import { EVENT_TYPES, AGGREGATE_TYPES } from "../src/vocab.js";

const readJson = (p) => readFile(new URL(p, import.meta.url), "utf8").then(JSON.parse);

test("样例符合领域约定（含 payload）", async () => {
  const sample = await readJson("../data/sample.json");
  assert.deepEqual(validateEvent(sample), []);
  assert.equal(sample.event_type, "CORRECTION_APPROVED");
});

test("schema 与受控词表的事件枚举一致", async () => {
  const vocab = await readJson("../contracts/vocabularies.json");
  assert.deepEqual([...EVENT_TYPES].sort(), [...vocab.$defs.eventTypes.enum].sort());
  assert.deepEqual([...AGGREGATE_TYPES].sort(), [...vocab.$defs.aggregateTypes.enum].sort());
  // 初始契约的五个事件名必须保留
  for (const legacy of ["SOURCE_REGISTERED", "CLAIM_REVIEWED", "ASSET_LINKED", "CORRECTION_APPROVED", "RELEASE_RETIRED"]) {
    assert.ok(EVENT_TYPES.includes(legacy), `${legacy} 是初始契约事件，不得删除`);
  }
});

test("schema 引用词表而不是各自维护枚举", async () => {
  const schema = await readJson("../contracts/domain.schema.json");
  assert.deepEqual(schema.properties.event_type.$ref, "vocabularies.json#/$defs/eventTypes");
  assert.deepEqual(schema.properties.aggregate_type.$ref, "vocabularies.json#/$defs/aggregateTypes");
});

test("信封校验：缺字段、坏版本、坏时间、契约外字段", () => {
  assert.ok(validateEvent({}).length >= 7);
  assert.ok(validateEvent({ event_id: "x", event_type: "NOPE", aggregate_type: "person", aggregate_id: "p", occurred_at: "2026-01-01T00:00:00Z", version: 1, summary: "s", payload: {} }).some((e) => e.includes("未知事件类型")));
  assert.ok(validateEvent({ event_id: "x", event_type: "PERSON_RECORDED", aggregate_type: "person", aggregate_id: "p", occurred_at: "昨天", version: 1, summary: "s", payload: {} }).some((e) => e.includes("date-time")));
  assert.ok(validateEvent({ event_id: "x", event_type: "PERSON_RECORDED", aggregate_type: "person", aggregate_id: "p", occurred_at: "2026-01-01T00:00:00Z", version: 0, summary: "s", payload: {} }).some((e) => e.includes("正整数")));
  assert.ok(validateEvent({ event_id: "x", event_type: "PERSON_RECORDED", aggregate_type: "person", aggregate_id: "p", occurred_at: "2026-01-01T00:00:00Z", version: 1, summary: "s", payload: {}, stray: 1 }).some((e) => e.includes("契约外字段")));
});
