import {
  ACCESS_CLASSES,
  CARRIER_DECISIONS,
  CARRIER_KINDS,
  EVIDENCE_SUPPORTS,
  FACT_CLASSES,
  PRESENTATION_CLASSES,
  REVIEW_VERDICTS,
  SOURCE_KINDS,
} from "./vocab.js";

// 从只追加事件流归约当前状态。
// 关键纪律：
//  - 业务层在任何环节都不覆盖原证据：EVIDENCE_CITED 只追加，旧主张版本与旧发布快照永不删除；
//  - 首次核准走 CLAIM_APPROVED，结论修订只能走 CORRECTION_APPROVED（旧版本保留）；
//  - 引用完整性在这里拒收，防止出现"指向不存在版本"的事件。
export function reducer(state, event) {
  if (event.type === "__init__") return initState();
  const s = cloneState(state);
  const p = event.payload ?? {};
  switch (event.event_type) {
    case "PERSON_RECORDED": return onPerson(s, event, p);
    case "PLACE_RECORDED": return onPlace(s, event, p);
    case "SOURCE_REGISTERED": return onSource(s, event, p);
    case "CLAIM_DRAFTED": return onClaimDrafted(s, event, p);
    case "EVIDENCE_CITED": return onEvidenceCited(s, event, p);
    case "CLAIM_REVIEWED": return onClaimReviewed(s, event, p);
    case "DISSENT_FILED": return onDissentFiled(s, event, p);
    case "CLAIM_APPROVED": return onClaimApproved(s, event, p);
    case "CORRECTION_APPROVED": return onCorrectionApproved(s, event, p);
    case "ASSET_LINKED": return onAssetLinked(s, event, p);
    case "RELEASE_PUBLISHED": return onReleasePublished(s, event, p);
    case "CARRIER_DECISION_ISSUED": return onCarrierDecision(s, event, p);
    case "RELEASE_RETIRED": return onReleaseRetired(s, event, p);
    default: throw new Error(`未实现的事件归约：${event.event_type}`);
  }
}

function initState() {
  return {
    persons: new Map(),
    places: new Map(),
    sources: new Map(),
    claims: new Map(),
    assets: new Map(),
    releases: new Map(),
    eventsById: new Map(),
  };
}

function cloneState(state) {
  return {
    persons: new Map(state.persons),
    places: new Map(state.places),
    sources: new Map(state.sources),
    claims: new Map(state.claims),
    assets: new Map(state.assets),
    releases: new Map(state.releases),
    eventsById: new Map(state.eventsById),
  };
}

const requireEnum = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new Error(`${label} 取值非法：${value}`);
};

function onPerson(s, event, p) {
  const person = p.person;
  if (!person?.id) throw new Error("PERSON_RECORDED 缺少 person.id");
  if (s.persons.has(person.id)) throw new Error(`人物已存在：${person.id}（人物记录不可原地改写，请另发后继事件）`);
  s.persons.set(person.id, { ...person, recorded_event_id: event.event_id, recorded_at: event.occurred_at });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onPlace(s, event, p) {
  const place = p.place;
  if (!place?.id) throw new Error("PLACE_RECORDED 缺少 place.id");
  if (s.places.has(place.id)) throw new Error(`地点已存在：${place.id}`);
  s.places.set(place.id, { ...place, recorded_event_id: event.event_id, recorded_at: event.occurred_at });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onSource(s, event, p) {
  const src = p.source;
  if (!src?.id) throw new Error("SOURCE_REGISTERED 缺少 source.id");
  if (s.sources.has(src.id)) throw new Error(`来源已登记：${src.id}（原证据不可覆盖，只允许追加）`);
  requireEnum(src.kind, SOURCE_KINDS, "source.kind");
  requireEnum(src.access_class, ACCESS_CLASSES, "source.access_class");
  if (!src.citation) throw new Error("来源必须包含 citation（题录/口述编号等公开引注）");
  s.sources.set(src.id, { ...src, registered_event_id: event.event_id, registered_at: event.occurred_at });
  s.eventsById.set(event.event_id, event);
  return s;
}

function ensureClaim(s, claimId) {
  const claim = s.claims.get(claimId);
  if (!claim) throw new Error(`主张不存在：${claimId}`);
  return claim;
}

function findClaimOfVersion(s, claimVersionId) {
  for (const claim of s.claims.values()) {
    if (claim.versions.has(claimVersionId)) return claim;
  }
  return null;
}

function onClaimDrafted(s, event, p) {
  if (!p.claim_id || !p.claim_version_id) throw new Error("CLAIM_DRAFTED 缺少 claim_id / claim_version_id");
  requireEnum(p.fact_class, FACT_CLASSES, "fact_class（艺术演绎请登记为载体呈现分级，不是史实主张）");
  if (!p.statement) throw new Error("主张缺少 statement");
  if (findClaimOfVersion(s, p.claim_version_id)) throw new Error(`主张版本标识已存在：${p.claim_version_id}`);
  if (p.subject_person_id && !s.persons.has(p.subject_person_id)) throw new Error(`引用的人物不存在：${p.subject_person_id}`);
  if (p.place_id && !s.places.has(p.place_id)) throw new Error(`引用的地点不存在：${p.place_id}`);

  let claim = s.claims.get(p.claim_id);
  if (!claim) {
    claim = {
      id: p.claim_id,
      subject_person_id: p.subject_person_id ?? null,
      topic: p.topic ?? null,
      versions: new Map(),
      order: [],
      approved_version_id: null,
      approval_history: [],
      corrections: [],
      dissents: [],
    };
    s.claims.set(p.claim_id, claim);
  }
  claim.versions.set(p.claim_version_id, {
    id: p.claim_version_id,
    claim_id: p.claim_id,
    fact_class: p.fact_class,
    statement: p.statement,
    temporal: p.temporal ?? null,
    place_id: p.place_id ?? null,
    drafted_event_id: event.event_id,
    drafted_at: event.occurred_at,
    evidence: [],
    reviews: [],
  });
  claim.order.push(p.claim_version_id);
  s.eventsById.set(event.event_id, event);
  return s;
}

function onEvidenceCited(s, event, p) {
  if (!p.claim_version_id || !p.source_id) throw new Error("EVIDENCE_CITED 缺少 claim_version_id / source_id");
  const claim = findClaimOfVersion(s, p.claim_version_id);
  if (!claim) throw new Error(`主张版本不存在：${p.claim_version_id}`);
  if (!s.sources.has(p.source_id)) throw new Error(`引用的来源不存在：${p.source_id}`);
  requireEnum(p.support ?? "contextual", EVIDENCE_SUPPORTS, "evidence.support");
  const version = claim.versions.get(p.claim_version_id);
  version.evidence.push({
    source_id: p.source_id,
    support: p.support ?? "contextual",
    excerpt: p.excerpt ?? null,
    public_excerpt: p.public_excerpt ?? null,
    note: p.note ?? null,
    event_id: event.event_id,
    at: event.occurred_at,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onClaimReviewed(s, event, p) {
  const claim = findClaimOfVersion(s, p.claim_version_id);
  if (!claim) throw new Error(`主张版本不存在：${p.claim_version_id}`);
  requireEnum(p.verdict, REVIEW_VERDICTS, "review.verdict");
  if (!p.reviewer) throw new Error("评阅缺少 reviewer");
  const version = claim.versions.get(p.claim_version_id);
  version.reviews.push({
    reviewer: p.reviewer,
    reviewer_role: p.reviewer_role ?? null,
    verdict: p.verdict,
    rationale: p.rationale ?? "",
    competing_version_id: p.competing_version_id ?? null,
    event_id: event.event_id,
    at: event.occurred_at,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onDissentFiled(s, event, p) {
  const claim = ensureClaim(s, p.claim_id);
  if (!claim.versions.has(p.against_claim_version_id)) throw new Error("异议指向的主张版本不存在");
  if (p.proposed_claim_version_id && !claim.versions.has(p.proposed_claim_version_id)) {
    throw new Error("异议提出的竞争版本必须属于同一主张聚合");
  }
  claim.dissents.push({
    against_claim_version_id: p.against_claim_version_id,
    proposed_claim_version_id: p.proposed_claim_version_id ?? null,
    scholar: p.scholar ?? null,
    rationale: p.rationale ?? "",
    event_id: event.event_id,
    at: event.occurred_at,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function versionReady(version) {
  // 核准的最低门槛：至少一条来源证据。竞争解释同样适用。
  return version.evidence.length > 0;
}

function onClaimApproved(s, event, p) {
  const claim = ensureClaim(s, p.claim_id);
  if (claim.approved_version_id) {
    throw new Error("主张已有核准版本；修订必须使用 CORRECTION_APPROVED，不得重复首次核准");
  }
  const version = claim.versions.get(p.approved_claim_version_id);
  if (!version) throw new Error("核准的主张版本不存在");
  if (!versionReady(version)) throw new Error("核准版本至少需要一条来源证据");
  claim.approved_version_id = p.approved_claim_version_id;
  claim.approval_history.push({
    claim_version_id: p.approved_claim_version_id,
    rationale: p.rationale ?? "",
    event_id: event.event_id,
    at: event.occurred_at,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onCorrectionApproved(s, event, p) {
  const claim = ensureClaim(s, p.claim_id);
  if (claim.approved_version_id !== p.superseded_claim_version_id) {
    throw new Error("CORRECTION_APPROVED 只能取代当前核准版本；旧版本保留、不删除");
  }
  const next = claim.versions.get(p.approved_claim_version_id);
  if (!next) throw new Error("新核准版本不存在");
  if (p.approved_claim_version_id === p.superseded_claim_version_id) throw new Error("新版本不能与被取代版本相同");
  if (!versionReady(next)) throw new Error("新核准版本至少需要一条来源证据");
  if (!p.public_note) throw new Error("修订必须附面向公众的更正说明（扫码可见）");

  claim.approved_version_id = p.approved_claim_version_id;
  claim.approval_history.push({
    claim_version_id: p.approved_claim_version_id,
    rationale: p.rationale ?? "",
    event_id: event.event_id,
    at: event.occurred_at,
  });
  claim.corrections.push({
    superseded_claim_version_id: p.superseded_claim_version_id,
    approved_claim_version_id: p.approved_claim_version_id,
    public_note: p.public_note,
    rationale: p.rationale ?? "",
    event_id: event.event_id,
    at: event.occurred_at,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onAssetLinked(s, event, p) {
  if (!p.asset?.id) throw new Error("ASSET_LINKED 缺少 asset.id");
  requireEnum(p.asset.carrier, CARRIER_KINDS, "asset.carrier");
  if (!p.asset_version_id) throw new Error("缺少 asset_version_id");
  if (!p.claim_version_id) throw new Error("载体引用必须精确到 claim_version_id");
  const claim = findClaimOfVersion(s, p.claim_version_id);
  if (!claim) throw new Error(`引用的主张版本不存在：${p.claim_version_id}`);
  requireEnum(p.presentation_class, PRESENTATION_CLASSES, "presentation_class");

  let asset = s.assets.get(p.asset.id);
  if (!asset) {
    asset = {
      id: p.asset.id,
      carrier: p.asset.carrier,
      title: p.asset.title ?? p.asset.id,
      live: p.asset.live ?? true,
      live_performance: p.asset.live_performance ?? false,
      year_encoded_in_answer: p.asset.year_encoded_in_answer ?? false,
      versions: new Map(),
      version_order: [],
      current_version_id: null,
      decisions: [],
    };
    s.assets.set(asset.id, asset);
  } else if (typeof p.asset.live === "boolean" && !asset.versions.has(p.asset_version_id)) {
    // 换用新版本可让被"立即停用"的载体随替换版重新上线；仅补链接不改变停用状态
    asset.live = p.asset.live;
  }
  if (!asset.versions.has(p.asset_version_id)) {
    asset.versions.set(p.asset_version_id, {
      id: p.asset_version_id,
      asset_id: asset.id,
      links: [],
    });
    asset.version_order.push(p.asset_version_id);
    asset.current_version_id = p.asset_version_id;
  }
  asset.versions.get(p.asset_version_id).links.push({
    claim_version_id: p.claim_version_id,
    presentation_class: p.presentation_class,
    dramatization_disclosed: p.dramatization_disclosed ?? false,
    locator: p.locator ?? null,
    qr_code: p.qr_code ?? null,
    line: p.line ?? null,
    event_id: event.event_id,
    at: event.occurred_at,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function snapshotOf(s, assetVersionIds) {
  // 发布即固化：发布时每个载体版本引用了哪些主张版本、当时如何分级，全部留档。
  const assets = [];
  for (const avId of assetVersionIds) {
    for (const asset of s.assets.values()) {
      const av = asset.versions.get(avId);
      if (!av) continue;
      assets.push({
        asset_id: asset.id,
        carrier: asset.carrier,
        title: asset.title,
        live: asset.live,
        live_performance: asset.live_performance,
        year_encoded_in_answer: asset.year_encoded_in_answer,
        asset_version_id: avId,
        links: av.links.map((l) => ({
          claim_version_id: l.claim_version_id,
          presentation_class: l.presentation_class,
          dramatization_disclosed: l.dramatization_disclosed,
          locator: l.locator,
          qr_code: l.qr_code,
          line: l.line,
        })),
      });
      break;
    }
  }
  return assets;
}

function onReleasePublished(s, event, p) {
  if (!p.release_id) throw new Error("RELEASE_PUBLISHED 缺少 release_id");
  if (s.releases.has(p.release_id)) throw new Error(`发布标识已存在：${p.release_id}`);
  const ids = [...new Set(p.asset_version_ids ?? [])];
  if (ids.length === 0) throw new Error("发布至少包含一个载体版本");
  const known = new Set();
  for (const asset of s.assets.values()) for (const id of asset.versions.keys()) known.add(id);
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`发布引用了不存在的载体版本：${missing.join("、")}`);

  s.releases.set(p.release_id, {
    id: p.release_id,
    public_note: p.public_note ?? null,
    asset_version_ids: ids,
    snapshot: snapshotOf(s, ids),
    active: true,
    published_event_id: event.event_id,
    published_at: event.occurred_at,
    retired_event_id: null,
    replacement_release_id: null,
  });
  s.eventsById.set(event.event_id, event);
  return s;
}

function onCarrierDecision(s, event, p) {
  const asset = s.assets.get(p.asset_id);
  if (!asset) throw new Error(`载体不存在：${p.asset_id}`);
  requireEnum(p.decision, CARRIER_DECISIONS, "decision");
  const trigger = p.triggered_by_event_id ? s.eventsById.get(p.triggered_by_event_id) : null;
  if (p.triggered_by_event_id && (!trigger || trigger.event_type !== "CORRECTION_APPROVED")) {
    throw new Error("停用/排期决策必须由一条 CORRECTION_APPROVED 触发");
  }
  if (p.decision === "scheduled_replacement" && !p.deadline) throw new Error("排期更换必须给出 deadline");
  if (p.decision === "immediate_withdraw" && p.deadline) throw new Error("立即停用不应设置 deadline");

  asset.decisions.push({
    decision: p.decision,
    deadline: p.deadline ?? null,
    reason: p.reason ?? "",
    risk: p.risk ?? null,
    triggered_by_event_id: p.triggered_by_event_id ?? null,
    release_id: p.release_id ?? null,
    event_id: event.event_id,
    at: event.occurred_at,
  });
  asset.live = p.decision === "immediate_withdraw" ? false : asset.live;
  s.eventsById.set(event.event_id, event);
  return s;
}

function onReleaseRetired(s, event, p) {
  const release = s.releases.get(p.release_id);
  if (!release) throw new Error(`发布不存在：${p.release_id}`);
  if (!release.active) throw new Error("发布已停用");
  if (p.retain_snapshot !== true) {
    throw new Error("曾经公开的材料必须连同当时说明保留快照：retain_snapshot 必须为 true");
  }
  if (p.replacement_release_id && !s.releases.has(p.replacement_release_id)) {
    throw new Error(`后继发布不存在：${p.replacement_release_id}`);
  }
  release.active = false;
  release.retired_event_id = event.event_id;
  release.retired_at = event.occurred_at;
  release.replacement_release_id = p.replacement_release_id ?? null;
  release.retire_note = p.public_note ?? null;
  s.eventsById.set(event.event_id, event);
  return s;
}
