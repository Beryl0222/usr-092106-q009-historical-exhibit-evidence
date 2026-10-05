import assert from "node:assert/strict";
import test from "node:test";

import { buildYanfuScenario } from "../src/scenario.js";
import { visitorScan, researcherTrace, claimDossier, archivistRegister, projectSource } from "../src/projections.js";

test("游客扫旧展项：看到适合公众的证据与更正记录", () => {
  const r = buildYanfuScenario();
  const view = visitorScan(r.store.state, r.ids.qrOldPanel);
  assert.ok(view);
  const section = view.sections[0];
  assert.equal(section.release_status.includes("历史版本"), true);
  assert.ok(section.correction.notice.includes("更正前"));
  assert.ok(section.correction.current_statement.includes("1880"));
  assert.ok(section.correction.public_note.includes("1880"));
  // 游客视图绝不包含内部字段
  const json = JSON.stringify(view);
  for (const forbidden of ["internal_location", "personal_materials", "contact"]) {
    assert.ok(!json.includes(forbidden), `游客视图不得出现 ${forbidden}`);
  }
  // 旧版所据的公开二手年表原文仍可查看；更正后的说法与说明在 correction 中
  assert.ok(section.evidence.some((e) => !e.excerpt_redacted && e.excerpt?.includes("光绪五年")));
});

test("游客扫新展项：受限原件只见公开释文，内部档完全遮蔽", () => {
  const r = buildYanfuScenario();
  const view = visitorScan(r.store.state, r.ids.qrNewPanel);
  const section = view.sections.find((s) => s.release_status === "现行版本");
  assert.ok(section);
  const internal = section.evidence.find((e) => e.source.access_class_zh?.startsWith("内部"));
  assert.equal(internal.excerpt_redacted, true);
  assert.equal(internal.excerpt, null);
});

test("艺术演绎展项扫码同时给出演绎声明与史实依据", () => {
  const r = buildYanfuScenario();
  const view = visitorScan(r.store.state, "QR-PROLOGUE-2026");
  const section = view.sections[0];
  assert.equal(section.presentation, "艺术演绎");
  assert.ok(section.dramatization_notice.includes("艺术演绎"));
  assert.ok(section.evidence.length >= 1);
});

test("研究者由一句台词追到采用理由、评阅、异议与竞争解释", () => {
  const r = buildYanfuScenario();
  const trace = researcherTrace(r.store.state, { line_keyword: "光绪六年夏天" });
  assert.ok(trace);
  const dossier = trace[0];
  assert.equal(dossier.current_approved_claim_version_id, r.ids.v1880);
  const versions = dossier.versions.map((v) => v.claim_version_id);
  assert.deepEqual(versions.sort(), [r.ids.v1879, r.ids.v1880, r.ids.vWinter].sort());
  // 竞争解释（1879 冬）作为合理推断共存
  const winter = dossier.versions.find((v) => v.claim_version_id === r.ids.vWinter);
  assert.equal(winter.fact_class_zh, "合理推断");
  // 异议保留
  assert.equal(dossier.dissents.length, 1);
  assert.equal(dossier.dissents[0].proposed_claim_version_id, r.ids.vWinter);
  // 外审的 refutes / supports 采用理由都在
  const reviews = dossier.versions.flatMap((v) => v.reviews);
  assert.ok(reviews.some((rv) => rv.verdict === "refutes" && rv.rationale.includes("马尾")));
  assert.ok(reviews.some((rv) => rv.verdict === "supports"));
});

test("研究者无逐件授权时：受限原件只见题录与公开释文，未公开口述不出现原文", () => {
  const r = buildYanfuScenario();
  const dossier = claimDossier(r.store.state, "claim-arrival", "researcher");
  const winter = dossier.versions.find((v) => v.claim_version_id === r.ids.vWinter);
  const oral = winter.evidence.find((e) => e.source.id === r.ids.oralSource);
  assert.equal(oral.excerpt_redacted, true);
  assert.ok(!JSON.stringify(dossier).includes("internal_location"));

  // 逐件授权后可看受限释文，但研究身份本身不解锁内部排架位置
  const granted = claimDossier(r.store.state, "claim-arrival", "researcher", { grantedSources: new Set([r.ids.restrictedSource, r.ids.oralSource]) });
  const v1880 = granted.versions.find((v) => v.claim_version_id === r.ids.v1880);
  const memorial = v1880.evidence.find((e) => e.source.id === r.ids.restrictedSource);
  assert.equal(memorial.excerpt_redacted, false);
  assert.ok(!JSON.stringify(granted).includes("internal_location"), "内部存放位置始终只在档案员视图");
});

test("档案员可见内部位置与管理字段；游客投影一个来源都不漏这些字段", () => {
  const r = buildYanfuScenario();
  const register = archivistRegister(r.store.state);
  const internal = register.find((s) => s.id === r.ids.internalSource);
  assert.ok(internal.internal_location.includes("FZ-籍-0761"));
  const restricted = register.find((s) => s.id === r.ids.restrictedSource);
  assert.ok(restricted.holding_org);

  const visitor = projectSource(r.store.state.sources.get(r.ids.internalSource), "visitor");
  assert.equal(visitor.internal_location, undefined);
  assert.ok(!JSON.stringify(visitor).includes("FZ-籍-0761"));
});
