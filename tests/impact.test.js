import assert from "node:assert/strict";
import test from "node:test";

import { buildYanfuScenario } from "../src/scenario.js";
import { assessCorrectionImpact, decisionDrafts } from "../src/impact.js";

test("严复场景：一次修订枚举全部在运营载体并分级给出处置", () => {
  const r = buildYanfuScenario();
  const impact = r.stages.impact;

  const byId = Object.fromEntries(impact.affected_active_carriers.map((a) => [a.asset_id, a]));
  // 现场演出 + 年份编入答案 → 立即停用
  assert.equal(byId["asset-tour-script"].recommended_decision, "immediate_withdraw");
  assert.equal(byId["asset-tour-script"].risk_level, "high");
  assert.equal(byId["asset-puzzle"].recommended_decision, "immediate_withdraw");
  // 固定物料事实级错误 → 排期 14 天
  for (const id of ["asset-panel", "asset-video", "asset-tram", "asset-scene"]) {
    assert.equal(byId[id].recommended_decision, "scheduled_replacement");
    assert.equal(byId[id].deadline_days, 14);
  }
  // 已明示的艺术演绎 → 低风险、随季更换
  assert.equal(byId["asset-prologue"].recommended_decision, "scheduled_replacement");
  assert.equal(byId["asset-prologue"].risk_level, "low");
  // 曾经公开的 2024 秋展板列入历史引用，但不要求处置
  assert.ok(impact.historical_references.some((h) => h.release_id === "rel-2024-autumn"));
  assert.equal(impact.immediate_withdrawals.length, 2);
});

test("决策草稿必须由修订事件触发，且立即停用不设期限", () => {
  const r = buildYanfuScenario();
  const drafts = decisionDrafts(r.stages.impact, { now: "2026-09-10T15:00:00+08:00" });
  for (const d of drafts) {
    assert.equal(d.payload.triggered_by_event_id, "evt-correction-arrival-1880");
    if (d.payload.decision === "immediate_withdraw") assert.equal(d.payload.deadline, null);
    else assert.ok(d.payload.deadline != null);
  }
});

test("评估必须针对 CORRECTION_APPROVED 事件", () => {
  const r = buildYanfuScenario();
  assert.throws(() => assessCorrectionImpact(r.store.state, "tjjczx-0001"), /CORRECTION_APPROVED/);
});
