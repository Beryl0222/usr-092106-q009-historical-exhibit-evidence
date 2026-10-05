import { buildYanfuScenario } from "../src/scenario.js";
import { visitorScan, researcherTrace } from "../src/projections.js";

const line = (title) => console.log(`\n=== ${title} ===`);
const zhSeverity = { block: "拦截", warn: "警告", info: "提示" };

const r = buildYanfuScenario();
const { stages, store, ids } = r;

line("① 发布前门禁（2025 春季扩展草案）");
console.log(`结论：${stages.preflightBad.passed ? "通过" : "不予发布"}，共 ${stages.preflightBad.issues.length} 项`);
for (const i of stages.preflightBad.issues) {
  console.log(`  [${zhSeverity[i.severity]}] ${i.code}：${i.message}`);
}

line("② 同一批内容整改后复检（定稿）");
console.log(`结论：${stages.preflightFixed.passed ? "通过，准予发布" : "仍有拦截项"}`);
for (const i of stages.preflightFixed.issues) console.log(`  [${zhSeverity[i.severity]}] ${i.message}`);

line("③ 新档案研究：全库已核准主张一致性扫描");
console.log("修订前：");
for (const i of stages.approvedConflict.issues) console.log(`  [拦截] ${i.code}：${i.message}`);
console.log(`修订（含衍生推断 1879→1880）后：${stages.approvedConflictAfter.passed ? "矛盾消解" : "仍有矛盾"}`);

line("④ 结论修订后的影响评估");
for (const a of stages.impact.affected_active_carriers) {
  const when = a.recommended_decision === "immediate_withdraw" ? "立即停用" : `排期 ${a.deadline_days} 日内更换`;
  console.log(`  ${a.title}（${a.locators.map((l) => l.locator).join("、")}）→ 风险 ${a.risk_level}：${when}`);
  for (const f of a.risk_factors) console.log(`      · ${f}`);
}
console.log("  曾经公开、现已停用的历史引用（保留快照，不要求处置）：");
for (const h of stages.impact.historical_references) console.log(`      · ${h.release_id} / ${h.title}`);

line("⑤ 游客扫描旧展板二维码");
const oldView = visitorScan(store.state, ids.qrOldPanel);
const old = oldView.sections[0];
console.log(`展项：${old.title}（${old.release_status}）｜呈现分级：${old.presentation}`);
console.log(`更正提示：${old.correction.notice}`);
console.log(`公众说明：${old.correction.public_note}`);

line("⑥ 研究者由一句台词追溯采用理由");
const trace = researcherTrace(store.state, { line_keyword: "光绪六年夏天" })[0];
console.log(`台词：“${trace.asset.line}”（${trace.asset.title} · ${trace.asset.locator}）`);
console.log(`当前核准版本：${trace.current_approved_claim_version_id}；库中并存版本：${trace.versions.map((v) => v.claim_version_id).join("、")}`);
for (const v of trace.versions) {
  console.log(`  版本 ${v.claim_version_id}（${v.fact_class_zh}）：${v.statement}`);
  for (const rv of v.reviews) console.log(`      评阅[${rv.verdict}] ${rv.reviewer}：${rv.rationale}`);
}
console.log("  异议：");
for (const d of trace.dissents) console.log(`      ${d.scholar}：${d.rationale}`);
console.log(`  （未获逐件授权时，受限奏片与未公开口述的原文不出现在本视图；内部排架位置任何研究账号都不可见）`);

line("⑦ 事件流统计");
console.log(`累计事件 ${store.events.length} 条，全部深度冻结；可执行 data/yanfu-events.json 导出供联调。`);
