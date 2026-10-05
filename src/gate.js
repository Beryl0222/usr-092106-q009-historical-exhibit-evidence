import { dayToNumber, toWindow, windowsOverlap, describeTemporal } from "./time.js";

// 只记到年份的存世界（如"1880 年奏设"）与筹建/到任主张可能相差一整年：
// 年份精度的地点界向两侧各放宽一年，避免把"1879 年筹建、1880 年开学"误判为年代不符。
const YEAR_BOUND_TOLERANCE_DAYS = 366;

// 发布前门禁：在 RELEASE 实际投用前查出
//  1) 无来源断言、分级抬高（合理推断/艺术演绎冒充确定事实）、艺术演绎未向观众明示；
//  2) 引用了从未核准或已被修订取代的版本；
//  3) 跨年代矛盾：越出生卒年、同一时间异地行踪、地点年代不符；
//  4) 面向公众的展项缺少可公开证据（游客扫码将看不到证据）。
// block 必须清零才允许发布；warn/info 留给编审记录。

export function checkRelease(state, releaseId) {
  const release = state.releases.get(releaseId);
  if (!release) throw new Error(`发布不存在：${releaseId}`);
  const issues = [];
  const entries = release.snapshot.map((e) => ({ ...e, links: e.links.map((l) => ({ ...l })) }));
  runEntryChecks(state, entries, issues);
  return finalize(issues, { release_id: releaseId });
}

// 不依赖发布的全库一致性检查：核准前研究者可用它扫描已核准主张间的矛盾。
export function checkApprovedClaims(state) {
  const issues = [];
  const refs = [];
  for (const claim of state.claims.values()) {
    if (!claim.approved_version_id) continue;
    refs.push({ claim, version: claim.versions.get(claim.approved_version_id) });
  }
  checkTemporalConflicts(state, refs, issues, { scope: "全部已核准主张" });
  return finalize(issues, { scope: "approved" });
}

// 拟发布检查：发布事件尚未入库时，对一组载体版本跑同一套门禁。
export function checkProposedRelease(state, assetVersionIds, label = "拟发布") {
  const entries = entriesForVersions(state, assetVersionIds);
  const missing = assetVersionIds.filter((id) => !entries.some((e) => e.asset_version_id === id));
  const issues = [];
  if (missing.length) issues.push(block("UNKNOWN_ASSET_VERSION", `载体版本不存在：${missing.join("、")}`, { asset_version_ids: missing }));
  runEntryChecks(state, entries, issues);
  return finalize(issues, { scope: label });
}

function entriesForVersions(state, assetVersionIds) {
  const entries = [];
  for (const avId of assetVersionIds) {
    for (const asset of state.assets.values()) {
      const av = asset.versions.get(avId);
      if (!av) continue;
      entries.push({
        asset_id: asset.id,
        carrier: asset.carrier,
        title: asset.title,
        live: asset.live,
        live_performance: asset.live_performance,
        year_encoded_in_answer: asset.year_encoded_in_answer,
        asset_version_id: avId,
        links: av.links.map((l) => ({ ...l })),
      });
    }
  }
  return entries;
}

function runEntryChecks(state, entries, issues) {
  const linked = [];
  for (const entry of entries) {
    for (const link of entry.links) {
      const ref = locateVersion(state, link.claim_version_id);
      const ctx = {
        asset_id: entry.asset_id,
        carrier: entry.carrier,
        title: entry.title,
        asset_version_id: entry.asset_version_id,
        locator: link.locator,
        claim_version_id: link.claim_version_id,
      };
      if (!ref) {
        issues.push(block("ORPHAN_LINK", `载体《${entry.title}》引用了不存在的主张版本 ${link.claim_version_id}`, ctx));
        continue;
      }
      linked.push({ entry, link, ref });
      checkLinkAgainstClaim(state, entry, link, ref, issues);
    }
  }
  const factLike = linked
    .filter(({ link }) => link.presentation_class !== "artistic_dramatization")
    .map(({ ref }) => ref);
  checkTemporalConflicts(state, factLike, issues, { scope: "发布门禁" });
}

function locateVersion(state, claimVersionId) {
  for (const claim of state.claims.values()) {
    const version = claim.versions.get(claimVersionId);
    if (version) return { claim, version };
  }
  return null;
}

function checkLinkAgainstClaim(state, entry, link, ref, issues) {
  const { claim, version } = ref;
  const ctx = {
    asset_id: entry.asset_id,
    carrier: entry.carrier,
    title: entry.title,
    asset_version_id: entry.asset_version_id,
    locator: link.locator,
    claim_id: claim.id,
    claim_version_id: version.id,
  };

  // 1. 无来源断言
  if (version.evidence.length === 0) {
    issues.push(block("UNSOURCED_CLAIM", `《${entry.title}》使用的主张版本 ${version.id} 没有任何来源证据（无来源断言不得上线）`, ctx));
  }

  // 2. 引用版本的核准状态
  if (claim.approved_version_id !== version.id) {
    const wasApproved = claim.approval_history.some((h) => h.claim_version_id === version.id);
    issues.push(
      block(
        "SUPERSEDED_VERSION",
        wasApproved
          ? `《${entry.title}》引用的 ${version.id} 已被修订取代（当前核准 ${claim.approved_version_id ?? "无"}），须更换或明示"更正前说法"`
          : `《${entry.title}》引用的 ${version.id} 从未经核准`,
        ctx
      )
    );
  }

  // 3. 分级纪律
  if (link.presentation_class === "established_fact" && version.fact_class === "reasonable_inference") {
    issues.push(block("CLASS_ELEVATION", `《${entry.title}》把合理推断（${version.id}）当作确定事实呈现，观众会误读为史实`, ctx));
  }
  if (link.presentation_class === "artistic_dramatization") {
    if (!link.dramatization_disclosed) {
      issues.push(block("DRAMATIZATION_UNDISCLOSED", `《${entry.title}》中的艺术演绎未向观众明示（须在展板/节目单/开场提示中标注"戏剧加工"）`, ctx));
    } else {
      issues.push(info("DRAMATIZATION_DISCLOSED", `《${entry.title}》的艺术演绎已明示，扫码页将同时给出史实与演绎说明`, ctx));
    }
  }

  // 4. 公众证据：确定事实对游客扫码必须有可公开摘录（无来源断言已另行拦截，不重复告警）
  if (link.presentation_class === "established_fact" && version.evidence.length > 0) {
    const publicEvidence = version.evidence.filter((e) => hasPublicExcerpt(state, e));
    if (publicEvidence.length === 0) {
      issues.push(warn("NO_PUBLIC_EVIDENCE", `《${entry.title}》所据证据全部来自受限/内部/未公开来源，游客扫码看不到适合公开的证据摘录`, ctx));
    }
  }
}

function hasPublicExcerpt(state, evidence) {
  // 经编审标记的公开释文（可来自受限原件的誊录），或公开来源的原文摘录
  if (evidence.public_excerpt) return true;
  if (evidence.excerpt && evidenceIsPubliclyCleared(state.sources.get(evidence.source_id))) return true;
  return false;
}

function evidenceIsPubliclyCleared(source) {
  if (!source) return false;
  // 受限原件/未公开材料本身不公开，但其释文经编审标记 public_excerpt 时可展示；
  // 这里按来源密级判定：题录公开、内部位置/受限原件/未公开个人材料一律不进游客视图。
  return source.access_class === "public";
}

function checkTemporalConflicts(state, refs, issues, meta) {
  for (const { claim, version } of refs) {
    if (!version.temporal) continue;
    const win = toWindow(version.temporal);

    // 越出生卒年
    if (claim.subject_person_id) {
      const person = state.persons.get(claim.subject_person_id);
      if (person) {
        const life = {
          lo: person.born ? toWindow({ start: person.born, start_certainty: isYear(person.born) ? "circa" : "exact" }).lo : null,
          hi: person.died ? toWindow({ start: person.died, start_certainty: isYear(person.died) ? "circa" : "exact" }).hi : null,
        };
        if (life.lo != null && win.hi != null && win.hi < life.lo) {
          issues.push(block("BEFORE_BIRTH", `${meta.scope}：主张“${version.statement}”时间（${describeTemporal(version.temporal)}）早于 ${person.name} 出生`, { claim_id: claim.id, claim_version_id: version.id }));
        }
        if (life.hi != null && win.lo != null && win.lo > life.hi) {
          issues.push(block("AFTER_DEATH", `${meta.scope}：主张“${version.statement}”时间（${describeTemporal(version.temporal)}）晚于 ${person.name} 去世`, { claim_id: claim.id, claim_version_id: version.id }));
        }
      }
    }

    // 地点年代不符
    if (version.place_id) {
      const place = state.places.get(version.place_id);
      if (place?.existed_from || place?.existed_to) {
        // existed_from / existed_to 是开放端：只约束一侧，缺省端不封口
        const pWin = { lo: null, hi: null };
        if (place.existed_from) {
          const y = isYear(place.existed_from);
          pWin.lo = dayToNumber(y ? `${place.existed_from}-01-01` : place.existed_from) - (y ? YEAR_BOUND_TOLERANCE_DAYS : 0);
        }
        if (place.existed_to) {
          const y = isYear(place.existed_to);
          pWin.hi = dayToNumber(y ? `${place.existed_to}-12-31` : place.existed_to) + (y ? YEAR_BOUND_TOLERANCE_DAYS : 0);
        }
        const conflict =
          (pWin.lo != null && win.hi != null && win.hi < pWin.lo) ||
          (pWin.hi != null && win.lo != null && win.lo > pWin.hi);
        if (conflict) {
          issues.push(block("PLACE_ANACHRONISM", `${meta.scope}：“${version.statement}”（${describeTemporal(version.temporal)}）与地点 ${place.name} 的存世年代不符`, { claim_id: claim.id, claim_version_id: version.id, place_id: place.id }));
        }
      }
    }
  }

  // 同一人物、同一时段、不同地点：行踪跨年代矛盾
  const located = refs.filter(({ version }) => version.temporal && version.place_id);
  for (let i = 0; i < located.length; i += 1) {
    for (let j = i + 1; j < located.length; j += 1) {
      const a = located[i];
      const b = located[j];
      if (a.claim.subject_person_id !== b.claim.subject_person_id || !a.claim.subject_person_id) continue;
      if (a.claim.id === b.claim.id) continue; // 同一问题的竞争版本不互斥
      if (a.version.place_id === b.version.place_id) continue;
      if (windowsOverlap(toWindow(a.version.temporal), toWindow(b.version.temporal))) {
        const pa = state.places.get(a.version.place_id);
        const pb = state.places.get(b.version.place_id);
        issues.push(
          block(
            "WHEREABOUTS_CONFLICT",
            `${meta.scope}：${state.persons.get(a.claim.subject_person_id)?.name ?? "人物"} 在 ${describeTemporal(a.version.temporal)} 不可能同时在 ${pa?.name ?? a.version.place_id} 与 ${pb?.name ?? b.version.place_id}`,
            { claim_versions: [a.version.id, b.version.id] }
          )
        );
      }
    }
  }
}

const isYear = (v) => typeof v === "string" && /^\d{4}$/.test(v);

const issue = (severity, code, message, context) => ({ severity, code, message, context });
const block = (code, message, context) => issue("block", code, message, context);
const warn = (code, message, context) => issue("warn", code, message, context);
const info = (code, message, context) => issue("info", code, message, context);

function finalize(issues, meta) {
  // 同一矛盾在多个载体链接上会重复命中，按 code + 归一化上下文去重
  const seen = new Set();
  const deduped = [];
  for (const i of issues) {
    const ctx = { ...i.context };
    if (Array.isArray(ctx.claim_versions)) ctx.claim_versions = [...ctx.claim_versions].sort();
    const key = `${i.code}:${JSON.stringify(ctx)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(i);
  }
  deduped.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return {
    ...meta,
    issues: deduped,
    blocks: deduped.filter((i) => i.severity === "block"),
    passed: !deduped.some((i) => i.severity === "block"),
  };
}

const severityRank = { block: 0, warn: 1, info: 2 };
