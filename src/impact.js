import { addDays } from "./time.js";

// 结论修订后的影响评估：
// 枚举全部（含曾经公开的）引用旧版本的载体，按风险给出"立即停用 / 排期更换"。
// 风险只依据可核验的载体属性（是否现场演出、是否把年份编进谜题答案、呈现分级、是否已披露演绎），
// 不替演出方做艺术性裁量；决策事件仍须由编审按此建议签发。

export function assessCorrectionImpact(state, correctionEventId) {
  const correctionEvent = state.eventsById.get(correctionEventId);
  if (!correctionEvent || correctionEvent.event_type !== "CORRECTION_APPROVED") {
    throw new Error("影响评估必须针对一条 CORRECTION_APPROVED 事件");
  }
  const p = correctionEvent.payload;
  const affected = [];
  const historical = [];

  for (const release of state.releases.values()) {
    for (const entry of release.snapshot) {
      const hitLinks = entry.links.filter((l) => l.claim_version_id === p.superseded_claim_version_id);
      if (hitLinks.length === 0) continue;
      const asset = state.assets.get(entry.asset_id);
      const record = {
        release_id: release.id,
        release_active: release.active,
        asset_id: entry.asset_id,
        carrier: entry.carrier,
        title: entry.title,
        asset_version_id: entry.asset_version_id,
        live: entry.live,
        live_performance: entry.live_performance,
        year_encoded_in_answer: entry.year_encoded_in_answer,
        superseded_claim_version_id: p.superseded_claim_version_id,
        current_claim_version_id: p.approved_claim_version_id,
        locators: hitLinks.map((l) => ({ locator: l.locator, line: l.line, presentation_class: l.presentation_class, dramatization_disclosed: l.dramatization_disclosed })),
      };
      if (release.active) {
        affected.push({ ...record, ...riskFor(entry, hitLinks, asset) });
      } else {
        historical.push(record); // 曾经公开的旧发布：保留，不要求更换，只留更正索引
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  affected.sort((a, b) => order[a.risk_level] - order[b.risk_level]);
  return {
    correction_event_id: correctionEventId,
    claim_id: p.claim_id,
    superseded_claim_version_id: p.superseded_claim_version_id,
    approved_claim_version_id: p.approved_claim_version_id,
    public_note: p.public_note,
    affected_active_carriers: affected,
    historical_references: historical,
    immediate_withdrawals: affected.filter((a) => a.recommended_decision === "immediate_withdraw"),
    scheduled_replacements: affected.filter((a) => a.recommended_decision === "scheduled_replacement"),
  };
}

function riskFor(entry, links, asset) {
  const riskFactors = [];
  let level = "low";
  let decision = "scheduled_replacement";
  let deadlineDays = 60;

  const hasFact = links.some((l) => l.presentation_class === "established_fact");
  const hasInference = links.some((l) => l.presentation_class === "reasonable_inference");
  const hasDrama = links.some((l) => l.presentation_class === "artistic_dramatization");
  const undisclosedDrama = links.some((l) => l.presentation_class === "artistic_dramatization" && !l.dramatization_disclosed);

  if (hasFact) riskFactors.push("旧结论以“确定事实”分级对客呈现");
  if (hasInference) riskFactors.push("旧结论以“合理推断”分级对客呈现");
  if (hasDrama) riskFactors.push("含艺术演绎段落");
  if (entry.live_performance) riskFactors.push("现场演出：每场都在复述，无法靠物料事后补救");
  if (entry.year_encoded_in_answer) riskFactors.push("年份被编进谜题答案/打卡口令，错误日期会阻断或误导游客行动");
  if (undisclosedDrama) riskFactors.push("艺术演绎未向观众明示（本身应为发布门禁拦截项）");

  // 最高优先：未披露的戏剧加工，或事实级错误出现在"每场复述/编入答案"的载体 → 立即停用
  if (undisclosedDrama || (hasFact && (entry.live_performance || entry.year_encoded_in_answer))) {
    level = "high";
    decision = "immediate_withdraw";
    deadlineDays = null;
  } else if (hasFact) {
    // 展板、AI视频、铛铛车固定解说、数字场景：事实级错误但可挂更正并排期重制
    level = "medium";
    deadlineDays = 14;
    riskFactors.push("固定物料重制需要周期，扫码更正页须即时先行");
  } else if (hasInference && entry.live_performance) {
    level = "medium";
    deadlineDays = 7; // 现场改词比重制物料快
  } else if (hasInference) {
    level = "low";
    deadlineDays = 30;
  } else if (hasDrama) {
    level = "low";
    deadlineDays = 60;
    riskFactors.push("演绎已明示，随下一轮内容更新更换即可，扫码页补演绎与史实对照");
  }

  // 已有更新载体版本或已被停用，降低执行紧急度（但结论仍然列出）
  if (asset && asset.current_version_id && asset.current_version_id !== entry.asset_version_id) {
    riskFactors.push("该载体已有更新版本，仅需确认旧版本下线");
  }
  const alreadyWithdrawn = asset?.decisions.some((d) => d.decision === "immediate_withdraw");
  if (alreadyWithdrawn) riskFactors.push("载体已被停用");

  return {
    risk_level: level,
    risk_factors: riskFactors,
    recommended_decision: decision,
    deadline_days: deadlineDays,
  };
}

// 由评估结果生成可签发的 CARRIER_DECISION_ISSUED 事件草稿（编排层负责 append）。
export function decisionDrafts(impact, { now, idSeq } = {}) {
  if (!now) throw new Error("decisionDrafts 需要 now（ISO 时间）");
  let seq = idSeq ?? 1;
  const nextId = (prefix) => `${prefix}-${String(seq++).padStart(3, "0")}`;
  return impact.affected_active_carriers.map((a) => ({
    event_type: "CARRIER_DECISION_ISSUED",
    aggregate_type: "interpretive_asset",
    aggregate_id: a.asset_id,
    payload: {
      asset_id: a.asset_id,
      release_id: a.release_id,
      decision: a.recommended_decision,
      deadline: a.recommended_decision === "scheduled_replacement" ? addDays(now, a.deadline_days) : null,
      triggered_by_event_id: impact.correction_event_id,
      risk: a.risk_level,
      reason: `主张 ${impact.superseded_claim_version_id} 已被 ${impact.approved_claim_version_id} 取代：${a.risk_factors.join("；")}`,
    },
    _draft_id: nextId("decision"),
  }));
}
