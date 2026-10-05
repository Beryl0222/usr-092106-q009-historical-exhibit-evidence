import {
  ACCESS_CLASS_ZH,
  CARRIER_KIND_ZH,
  FACT_CLASS_ZH,
  PRESENTATION_CLASS_ZH,
  SOURCE_KIND_ZH,
} from "./vocab.js";
import { describeTemporal } from "./time.js";

// 三种授权边界：
//  visitor（游客扫码）：适合公众的证据摘录、题录与更正记录；
//  researcher（研究者）：可由一句台词追到采用理由、全部评阅/异议/竞争解释；
//    受限原件与未公开个人材料还须逐件授权（grantedSources），仅有研究者身份不够；
//  archivist（档案员）：额外可见内部档案位置、利用限制等管理字段。
// 投影是唯一出域通道：内部位置、受限原件细节、未公开个人材料永远不会从低权限视图漏出。

export function projectSource(source, role = "visitor", { grantedSources = new Set() } = {}) {
  const granted = grantedSources.has(source.id);
  const base = {
    id: source.id,
    kind_zh: SOURCE_KIND_ZH[source.kind] ?? source.kind,
    access_class_zh: ACCESS_CLASS_ZH[source.access_class] ?? source.access_class,
  };

  if (role === "archivist") {
    return {
      ...base,
      citation: source.citation,
      internal_location: source.internal_location ?? null,
      access_note: source.access_note ?? null,
      holding_org: source.holding_org ?? null,
      contact: source.contact ?? null,
      personal_materials: source.personal_materials ?? null,
    };
  }

  if (source.access_class === "public") {
    return { ...base, citation: source.citation };
  }
  if (source.access_class === "restricted_original") {
    const view = { ...base, citation: source.citation, restriction_notice: source.public_restriction_notice ?? "原件利用受限，公众所见为经编审放行的释文" };
    if (role === "researcher") {
      if (!granted) return { ...view, access_note: "未获该原件利用授权，仅展示题录与公开释文" };
      return { ...view, access_note: source.access_note ?? null };
    }
    return view;
  }
  if (source.access_class === "internal_location") {
    if (role === "researcher") {
      return {
        ...base,
        citation: granted ? source.citation : "内部资料，题录与位置需另行授权",
        access_note: granted ? source.access_note ?? null : "未授权",
      };
    }
    return { ...base, citation: "内部档案资料（详情请咨询文化研究中心）" };
  }
  if (source.access_class === "unpublished_personal") {
    if (role === "researcher" && granted) {
      return { ...base, citation: source.citation, access_note: source.access_note ?? "未公开个人材料，限授权研究使用，不得外传" };
    }
    return { ...base, citation: "未公开私人材料，经权利人授权后用于本展考证" };
  }
  return base;
}

function evidenceView(state, version, role, opts) {
  return version.evidence.map((e) => {
    const source = state.sources.get(e.source_id);
    const text =
      role === "visitor"
        ? e.public_excerpt ?? (source?.access_class === "public" ? e.excerpt : null)
        : opts?.grantedSources?.has(e.source_id)
          ? e.excerpt ?? e.public_excerpt
          : e.public_excerpt ?? (source?.access_class === "public" ? e.excerpt : null);
    return {
      source: source ? projectSource(source, role, opts) : { id: e.source_id },
      support: e.support,
      excerpt: text,
      excerpt_redacted: text == null,
      note: role === "visitor" ? null : e.note,
    };
  });
}

function claimCore(state, claim, version, role, opts) {
  return {
    claim_id: claim.id,
    claim_version_id: version.id,
    topic: claim.topic,
    fact_class_zh: FACT_CLASS_ZH[version.fact_class],
    statement: version.statement,
    temporal: describeTemporal(version.temporal ?? {}),
    is_current_approved: claim.approved_version_id === version.id,
    evidence: evidenceView(state, version, role, opts),
  };
}

function correctionChain(state, claim) {
  return claim.corrections.map((c) => ({
    superseded_claim_version_id: c.superseded_claim_version_id,
    approved_claim_version_id: c.approved_claim_version_id,
    public_note: c.public_note,
    at: c.at,
    event_id: c.event_id,
  }));
}

// 游客扫码：返回该处展项的公众版证据、分级提示、艺术演绎声明与更正记录。
export function visitorScan(state, qrCode) {
  const hits = [];
  for (const release of [...state.releases.values()].sort((a, b) => (a.published_at < b.published_at ? 1 : -1))) {
    for (const entry of release.snapshot) {
      for (const link of entry.links) {
        if (link.qr_code !== qrCode) continue;
        const ref = findVersion(state, link.claim_version_id);
        hits.push({ release, entry, link, ref });
      }
    }
  }
  if (hits.length === 0) return null;

  const sections = [];
  for (const { release, entry, link, ref } of hits) {
    if (!ref) continue;
    const { claim, version } = ref;
    const section = {
      carrier: CARRIER_KIND_ZH[entry.carrier] ?? entry.carrier,
      title: entry.title,
      locator: link.locator,
      presentation: PRESENTATION_CLASS_ZH[link.presentation_class] ?? link.presentation_class,
      release_id: release.id,
      release_status: release.active ? "现行版本" : "历史版本（已停用，保留当时说明）",
      ...claimCore(state, claim, version, "visitor"),
    };
    if (link.presentation_class === "artistic_dramatization") {
      section.dramatization_notice = "本段为叙事需要进行的艺术演绎，非史实陈述；以下为其参考的史实依据。";
    }
    if (claim.approved_version_id && claim.approved_version_id !== version.id) {
      const current = claim.versions.get(claim.approved_version_id);
      const correction = claim.corrections.find((c) => c.approved_claim_version_id === claim.approved_version_id);
      section.correction = {
        notice: "您扫描的展项内容基于更正前的说法",
        previous_statement: version.statement,
        current_statement: current?.statement ?? null,
        public_note: correction?.public_note ?? null,
        at: correction?.at ?? null,
      };
    } else {
      const records = claim.corrections.filter((c) => c.approved_claim_version_id === version.id);
      if (records.length) section.correction_record = correctionChain(state, claim);
    }
    sections.push(section);
  }
  return { qr_code: qrCode, sections };
}

// 研究者：由载体定位（或一句台词关键词）追到主张版本、证据、评阅理由、异议与竞争解释。
export function researcherTrace(state, query, { grantedSources = new Set() } = {}) {
  const matches = [];
  for (const asset of state.assets.values()) {
    for (const av of asset.versions.values()) {
      for (const link of av.links) {
        const byLocator = query.asset_id && asset.id === query.asset_id && (!query.locator || link.locator === query.locator);
        const byLine = query.line_keyword && link.line && link.line.includes(query.line_keyword);
        if (!byLocator && !byLine) continue;
        const ref = findVersion(state, link.claim_version_id);
        if (!ref) continue;
        matches.push({ asset, assetVersionId: av.id, link, ...ref });
      }
    }
  }
  if (matches.length === 0) return null;

  return matches.map(({ asset, assetVersionId, link, claim, version }) => ({
    asset: {
      id: asset.id,
      carrier_zh: CARRIER_KIND_ZH[asset.carrier] ?? asset.carrier,
      title: asset.title,
      asset_version_id: assetVersionId,
      locator: link.locator,
      line: link.line,
    },
    link: {
      presentation_class_zh: PRESENTATION_CLASS_ZH[link.presentation_class] ?? link.presentation_class,
      dramatization_disclosed: link.dramatization_disclosed,
    },
    ...claimDossier(state, claim.id, "researcher", { grantedSources, focusVersionId: version.id }),
  }));
}

// 主张完整档案：研究者/编审用，含全部竞争版本与评阅理由。
export function claimDossier(state, claimId, role = "researcher", { grantedSources = new Set(), focusVersionId = null } = {}) {
  const claim = state.claims.get(claimId);
  if (!claim) return null;
  const opts = { grantedSources };

  const versions = claim.order.map((id) => {
    const v = claim.versions.get(id);
    return {
      ...claimCore(state, claim, v, role, opts),
      reviews: v.reviews.map((r) => ({
        reviewer: r.reviewer,
        reviewer_role: r.reviewer_role,
        verdict: r.verdict,
        rationale: role === "visitor" ? null : r.rationale,
        at: r.at,
      })),
    };
  });

  return {
    claim_id: claim.id,
    topic: claim.topic,
    subject_person_id: claim.subject_person_id,
    current_approved_claim_version_id: claim.approved_version_id,
    focus_claim_version_id: focusVersionId,
    versions,
    dissents: claim.dissents.map((d) => ({
      against_claim_version_id: d.against_claim_version_id,
      proposed_claim_version_id: d.proposed_claim_version_id,
      scholar: d.scholar,
      rationale: role === "visitor" ? null : d.rationale,
      at: d.at,
    })),
    approval_history: claim.approval_history.map((h) => ({
      claim_version_id: h.claim_version_id,
      rationale: role === "visitor" ? null : h.rationale,
      at: h.at,
    })),
    corrections: claim.corrections.map((c) => ({
      superseded_claim_version_id: c.superseded_claim_version_id,
      approved_claim_version_id: c.approved_claim_version_id,
      public_note: c.public_note,
      rationale: role === "visitor" ? null : c.rationale,
      at: c.at,
    })),
  };
}

// 档案员：来源登记册（含内部位置与受限原件管理信息）。
export function archivistRegister(state) {
  return [...state.sources.values()].map((source) => projectSource(source, "archivist"));
}

export function findVersion(state, claimVersionId) {
  for (const claim of state.claims.values()) {
    const version = claim.versions.get(claimVersionId);
    if (version) return { claim, version };
  }
  return null;
}
