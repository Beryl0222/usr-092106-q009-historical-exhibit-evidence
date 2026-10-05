import assert from "node:assert/strict";
import test from "node:test";

import { EventStore } from "../src/store.js";
import { reducer } from "../src/reducer.js";
import { checkProposedRelease, checkApprovedClaims } from "../src/gate.js";

// 构造最小状态的便捷装配
function harness() {
  const store = new EventStore(reducer);
  const seq = new Map();
  const add = (event_type, aggregate_type, aggregate_id, payload) => {
    const key = `${aggregate_type}:${aggregate_id}`;
    const version = (seq.get(key) ?? 0) + 1;
    seq.set(key, version);
    return store.append({
      event_id: `ev-${Math.random().toString(36).slice(2, 9)}`,
      event_type, aggregate_type, aggregate_id,
      occurred_at: `2026-01-01T00:${String(version).padStart(2, "0")}:00+08:00`,
      version, summary: "t", payload,
    });
  };
  add("PERSON_RECORDED", "person", "p", { person: { id: "p", name: "严复", born: "1854", died: "1921" } });
  add("PLACE_RECORDED", "place", "tj", { place: { id: "tj", name: "天津学堂", existed_from: "1880" } });
  add("PLACE_RECORDED", "place", "fz", { place: { id: "fz", name: "马尾学堂", existed_from: "1866" } });
  add("SOURCE_REGISTERED", "source_record", "s", { source: { id: "s", kind: "published_material", access_class: "public", citation: "书" } });

  const claim = (id, factClass, statement, { temporal, place = "tj", evidence = true, approve = true } = {}) => {
    add("CLAIM_DRAFTED", "historical_claim", "c", { claim_id: "c", claim_version_id: id, subject_person_id: "p", topic: "t", fact_class: factClass, statement, temporal, place_id: place });
    if (evidence) add("EVIDENCE_CITED", "historical_claim", "c", { claim_version_id: id, source_id: "s", support: "direct", excerpt: "x" });
    if (approve) add("CLAIM_APPROVED", "historical_claim", "c", { claim_id: "c", approved_claim_version_id: id });
  };

  const link = (assetId, carrier, avId, claimVersionId, presentation, extra = {}) => {
    add("ASSET_LINKED", "interpretive_asset", assetId, {
      asset: { id: assetId, carrier, title: assetId, ...(extra.asset ?? {}) },
      asset_version_id: avId, claim_version_id: claimVersionId, presentation_class: presentation, ...extra.link,
    });
  };

  return { store, add, claim, link };
}

test("无来源断言被门禁拦截", () => {
  const h = harness();
  // 无证据 → 不能核准；门禁应同时报无来源与未核准
  h.add("CLAIM_DRAFTED", "historical_claim", "cx", { claim_id: "cx", claim_version_id: "vx", fact_class: "established_fact", statement: "无来源" });
  h.link("a1", "park_panel", "av", "vx", "established_fact");
  const r = checkProposedRelease(h.store.state, ["av"]);
  assert.ok(r.issues.some((i) => i.code === "UNSOURCED_CLAIM"));
  assert.equal(r.passed, false);
});

test("分级抬高：合理推断不得当作确定事实呈现", () => {
  const h = harness();
  h.claim("vi", "reasonable_inference", "推断", { temporal: { start: "1880" } });
  h.link("a1", "ai_video", "av", "vi", "established_fact");
  const r = checkProposedRelease(h.store.state, ["av"]);
  assert.ok(r.issues.some((i) => i.code === "CLASS_ELEVATION"));
});

test("艺术演绎未明示被拦截；明示后放行（info 提示）", () => {
  const h = harness();
  h.claim("vf", "established_fact", "事实", { temporal: { start: "1880" } });
  h.link("a1", "night_tour_script", "av-hidden", "vf", "artistic_dramatization", { link: { dramatization_disclosed: false } });
  const bad = checkProposedRelease(h.store.state, ["av-hidden"]);
  assert.ok(bad.issues.some((i) => i.code === "DRAMATIZATION_UNDISCLOSED"));

  h.link("a2", "night_tour_script", "av-shown", "vf", "artistic_dramatization", { link: { dramatization_disclosed: true } });
  const good = checkProposedRelease(h.store.state, ["av-shown"]);
  assert.equal(good.passed, true);
  assert.ok(good.issues.some((i) => i.code === "DRAMATIZATION_DISCLOSED"));
});

test("跨年代矛盾：越出卒年、地点年代不符、同年异地", () => {
  const h = harness();
  // 晚于卒年
  h.claim("v-late", "established_fact", "1922 年撰文", { temporal: { start: "1922" }, place: "tj" });
  h.link("a-late", "ai_video", "av-late", "v-late", "established_fact");
  const late = checkProposedRelease(h.store.state, ["av-late"]);
  assert.ok(late.issues.some((i) => i.code === "AFTER_DEATH"));

  // 地点年代：1870 早于 1880 设立，超出一年容差
  const h2 = harness();
  h2.claim("v-early", "established_fact", "1870 年在此", { temporal: { start: "1870" }, place: "tj" });
  h2.link("a-early", "park_panel", "av-early", "v-early", "established_fact");
  const early = checkProposedRelease(h2.store.state, ["av-early"]);
  assert.ok(early.issues.some((i) => i.code === "PLACE_ANACHRONISM"));

  // 1879（设立前一年）落在容差内：不报年代不符（筹建跨年）
  const h3 = harness();
  h3.claim("v-1879", "established_fact", "1879 年筹备", { temporal: { start: "1879" }, place: "tj" });
  h3.link("a-1879", "park_panel", "av-1879", "v-1879", "established_fact");
  const pre = checkProposedRelease(h3.store.state, ["av-1879"]);
  assert.ok(!pre.issues.some((i) => i.code === "PLACE_ANACHRONISM"));

  // 同年异地行踪矛盾
  const h4 = harness();
  h4.claim("v-tj", "established_fact", "在天津", { temporal: { start: "1880-07", start_certainty: "exact", end: "1880-08", end_certainty: "exact" }, place: "tj" });
  // 第二个主张用新的聚合装配
  h4.add("CLAIM_DRAFTED", "historical_claim", "c2", { claim_id: "c2", claim_version_id: "v-fz", subject_person_id: "p", fact_class: "established_fact", statement: "在福州", temporal: { start: "1880-07", start_certainty: "exact", end: "1880-08", end_certainty: "exact" }, place_id: "fz" });
  h4.add("EVIDENCE_CITED", "historical_claim", "c2", { claim_version_id: "v-fz", source_id: "s", support: "direct" });
  h4.add("CLAIM_APPROVED", "historical_claim", "c2", { claim_id: "c2", approved_claim_version_id: "v-fz" });
  h4.link("a4", "night_tour_puzzle", "av4a", "v-tj", "established_fact", { asset: { year_encoded_in_answer: true } });
  h4.link("a4", "night_tour_puzzle", "av4a", "v-fz", "established_fact", { asset: { year_encoded_in_answer: true } });
  const conflict = checkProposedRelease(h4.store.state, ["av4a"]);
  assert.ok(conflict.issues.some((i) => i.code === "WHEREABOUTS_CONFLICT"));
});

test("同一问题的竞争版本互不矛盾", () => {
  const h = harness();
  h.add("CLAIM_DRAFTED", "historical_claim", "cc", { claim_id: "cc", claim_version_id: "w1", subject_person_id: "p", fact_class: "established_fact", statement: "夏到", temporal: { start: "1880-07", start_certainty: "exact" }, place_id: "tj" });
  h.add("EVIDENCE_CITED", "historical_claim", "cc", { claim_version_id: "w1", source_id: "s", support: "direct" });
  h.add("CLAIM_APPROVED", "historical_claim", "cc", { claim_id: "cc", approved_claim_version_id: "w1" });
  const r = checkApprovedClaims(h.store.state);
  assert.equal(r.passed, true);
});
