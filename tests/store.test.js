import assert from "node:assert/strict";
import test from "node:test";

import { EventStore, EventRejectedError } from "../src/store.js";
import { reducer } from "../src/reducer.js";

const base = (over) => ({
  event_id: "e1",
  event_type: "PERSON_RECORDED",
  aggregate_type: "person",
  aggregate_id: "p1",
  occurred_at: "2026-01-01T00:00:00+08:00",
  version: 1,
  summary: "登记人物",
  payload: { person: { id: "p1", name: "严复" } },
  ...over,
});

test("事件接收后深度冻结：业务层无法覆盖原证据", () => {
  const store = new EventStore(reducer);
  const frozen = store.append(base());
  assert.throws(() => { frozen.payload.person.name = "改写"; }, TypeError);
  assert.equal(frozen.payload.person.name, "严复");
  assert.throws(() => { store.events[0].summary = "x"; }, TypeError);
});

test("同一聚合版本必须连续递增：乱序/重号/原地改写一律拒收", () => {
  const store = new EventStore(reducer);
  store.append(base());
  assert.throws(
    () => store.append(base({ event_id: "e2", version: 1, payload: { person: { id: "p1", name: "第二个" } } })),
    EventRejectedError
  );
  assert.throws(
    () => store.append(base({ event_id: "e3", version: 3 })),
    /版本冲突/
  );
  assert.doesNotThrow(() => store.append(base({ event_id: "e3", version: 1, event_type: "PLACE_RECORDED", aggregate_type: "place", aggregate_id: "pl1", payload: { place: { id: "pl1", name: "东局子" } } })));
});

test("event_id 全局唯一", () => {
  const store = new EventStore(reducer);
  store.append(base());
  assert.throws(() => store.append(base({ aggregate_id: "p2", payload: { person: { id: "p2", name: "另一位" } } })), /event_id 重复/);
});

test("原证据只追加：同来源重复登记被拒，评审/证据只增不删", () => {
  const store = new EventStore(reducer);
  const src = { id: "s1", kind: "archival_document", access_class: "public", citation: "奏片" };
  store.append(base({ event_id: "s", event_type: "SOURCE_REGISTERED", aggregate_type: "source_record", aggregate_id: "s1", payload: { source: src } }));
  assert.throws(
    () => store.append(base({ event_id: "s2", version: 2, event_type: "SOURCE_REGISTERED", aggregate_type: "source_record", aggregate_id: "s1", payload: { source: { ...src, citation: "被覆盖的题录" } } })),
    /来源已登记/
  );
});

test("修订只能取代当前核准版本，且必须附公众更正说明；旧版本保留", () => {
  const store = new EventStore(reducer);
  const ev = (event_id, version, event_type, aggregate_id, payload) =>
    store.append(base({ event_id, version, event_type, aggregate_type: "historical_claim", aggregate_id, occurred_at: `2026-01-0${version}T00:00:00+08:00`, payload }));

  ev("c1", 1, "CLAIM_DRAFTED", "c1", { claim_id: "c1", claim_version_id: "v1", fact_class: "established_fact", statement: "旧说" });
  ev("s1", 1, "SOURCE_REGISTERED", "s1", { source: { id: "s1", kind: "published_material", access_class: "public", citation: "书" } });
  ev("e1", 2, "EVIDENCE_CITED", "c1", { claim_version_id: "v1", source_id: "s1", support: "direct", excerpt: "x" });
  ev("a1", 3, "CLAIM_APPROVED", "c1", { claim_id: "c1", approved_claim_version_id: "v1", rationale: "r" });
  ev("c2", 4, "CLAIM_DRAFTED", "c1", { claim_id: "c1", claim_version_id: "v2", fact_class: "established_fact", statement: "新说" });
  ev("e2", 5, "EVIDENCE_CITED", "c1", { claim_version_id: "v2", source_id: "s1", support: "direct", excerpt: "y" });

  // 不能重复首次核准（拒收不推进版本号，后续事件仍从同一 version 尝试）
  assert.throws(() => ev("a2", 6, "CLAIM_APPROVED", "c1", { claim_id: "c1", approved_claim_version_id: "v2" }), /修订必须使用 CORRECTION_APPROVED/);
  // 修订缺公众说明
  assert.throws(
    () => ev("cor-bad", 6, "CORRECTION_APPROVED", "c1", { claim_id: "c1", superseded_claim_version_id: "v1", approved_claim_version_id: "v2" }),
    /公众的更正说明/
  );
  ev("cor", 6, "CORRECTION_APPROVED", "c1", { claim_id: "c1", superseded_claim_version_id: "v1", approved_claim_version_id: "v2", public_note: "更正说明", rationale: "档案证据" });

  const claim = store.state.claims.get("c1");
  assert.equal(claim.approved_version_id, "v2");
  assert.ok(claim.versions.has("v1"), "被取代的旧版本必须保留");
  assert.equal(claim.versions.get("v1").evidence[0].excerpt, "x", "旧版本证据原样保留，未被覆盖");
  assert.equal(claim.corrections[0].public_note, "更正说明");
});

test("无证据的主张不能核准", () => {
  const store = new EventStore(reducer);
  const ev = (event_id, version, payload) =>
    store.append(base({ event_id, version, event_type: "CLAIM_DRAFTED", aggregate_type: "historical_claim", aggregate_id: "c1", payload }));
  ev("c1", 1, { claim_id: "c1", claim_version_id: "v1", fact_class: "established_fact", statement: "无来源断言" });
  assert.throws(
    () => store.append(base({ event_id: "a1", version: 2, event_type: "CLAIM_APPROVED", aggregate_type: "historical_claim", aggregate_id: "c1", payload: { claim_id: "c1", approved_claim_version_id: "v1" } })),
    /至少需要一条来源证据/
  );
});

test("停用发布必须保留快照", () => {
  const store = new EventStore(reducer);
  store.append(base({ event_id: "s1", event_type: "SOURCE_REGISTERED", aggregate_type: "source_record", aggregate_id: "s1", version: 1, payload: { source: { id: "s1", kind: "published_material", access_class: "public", citation: "书" } } }));
  store.append(base({ event_id: "c1", event_type: "CLAIM_DRAFTED", aggregate_type: "historical_claim", aggregate_id: "c1", version: 1, payload: { claim_id: "c1", claim_version_id: "v1", fact_class: "established_fact", statement: "x" } }));
  store.append(base({ event_id: "e1", event_type: "EVIDENCE_CITED", aggregate_type: "historical_claim", aggregate_id: "c1", version: 2, payload: { claim_version_id: "v1", source_id: "s1", support: "direct" } }));
  store.append(base({ event_id: "a1", event_type: "CLAIM_APPROVED", aggregate_type: "historical_claim", aggregate_id: "c1", version: 3, payload: { claim_id: "c1", approved_claim_version_id: "v1" } }));
  store.append(base({ event_id: "l1", event_type: "ASSET_LINKED", aggregate_type: "interpretive_asset", aggregate_id: "as1", version: 1, payload: { asset: { id: "as1", carrier: "park_panel", title: "板" }, asset_version_id: "av1", claim_version_id: "v1", presentation_class: "established_fact" } }));
  store.append(base({ event_id: "r1", event_type: "RELEASE_PUBLISHED", aggregate_type: "release_version", aggregate_id: "rel1", version: 1, payload: { release_id: "rel1", asset_version_ids: ["av1"] } }));
  assert.throws(
    () => store.append(base({ event_id: "ret-bad", event_type: "RELEASE_RETIRED", aggregate_type: "release_version", aggregate_id: "rel1", version: 2, payload: { release_id: "rel1", retain_snapshot: false } })),
    /保留快照/
  );
  store.append(base({ event_id: "ret", event_type: "RELEASE_RETIRED", aggregate_type: "release_version", aggregate_id: "rel1", version: 2, payload: { release_id: "rel1", retain_snapshot: true, public_note: "当时说明" } }));
  const release = store.state.releases.get("rel1");
  assert.equal(release.active, false);
  assert.equal(release.snapshot.length, 1, "历史发布快照仍然留档");
});
