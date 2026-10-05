import { EventStore } from "./store.js";
import { reducer } from "./reducer.js";
import { checkApprovedClaims, checkProposedRelease, checkRelease } from "./gate.js";
import { assessCorrectionImpact } from "./impact.js";

// 说明：本文件是可运行的演示样例。史料线索（严复 1879 年归国、先在福州船政学堂任教习，
// 1880 年奉调至天津参与筹建北洋水师学堂）来自通行年表；具体档号、奏片题名、评阅学者姓名
// 均为占位，落地前须由文化研究中心以原档核对替换。场景目的是展示事件流、门禁、影响评估
// 与授权投影如何协同，不作为史实结论本身。

function logBuilder() {
  const versions = new Map();
  const list = [];
  let seq = 0;
  return {
    list,
    add(eventType, aggregateType, aggregateId, payload, { at, id, summary }) {
      const key = `${aggregateType}:${aggregateId}`;
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      seq += 1;
      const event = {
        event_id: id ?? `tjjczx-${String(seq).padStart(4, "0")}`,
        event_type: eventType,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        occurred_at: at,
        version,
        summary,
        payload,
      };
      list.push(event);
      return event;
    },
  };
}

export function buildYanfuScenario() {
  const b = logBuilder();
  const e = (type, agg, id, payload, meta) => b.add(type, agg, id, payload, meta);
  const stages = {};

  // ---------- 2024 秋：首批建档，旧通行说"1879 年到津" ----------
  e("PERSON_RECORDED", "person", "person-yanfu", {
    person: {
      id: "person-yanfu",
      name: "严复",
      born: "1854-01-08",
      died: "1921-10-27",
      public_note: "近代启蒙思想家、翻译家、教育家，福州侯官人，长期在天津任职办学。",
    },
  }, { at: "2024-09-01T09:00:00+08:00", summary: "登记人物：严复（生卒 1854—1921）" });

  for (const place of [
    { id: "place-tj-academy", name: "天津·北洋水师学堂（东局子）", existed_from: "1880", public_note: "1880 年李鸿章奏设，次年开学。" },
    { id: "place-fz-academy", name: "福州·马尾船政学堂", existed_from: "1866", public_note: "严复早年求学与归国后短暂任教之处。" },
    { id: "place-greenwich", name: "英国·格林威治皇家海军学院", existed_from: "1873" },
  ]) {
    e("PLACE_RECORDED", "place", place.id, { place }, { at: "2024-09-01T09:10:00+08:00", summary: `登记地点：${place.name}` });
  }

  const sources2024 = [
    {
      id: "src-old-chronology",
      kind: "secondary_scholarship",
      access_class: "public",
      citation: "《天津近代名人展陈年表（2009 内部修订本）》第 47 页【样例占位】",
      public_excerpt_note: null,
    },
  ];
  for (const source of sources2024) {
    e("SOURCE_REGISTERED", "source_record", source.id, { source },
      { at: "2024-09-02T10:00:00+08:00", summary: `登记来源：${source.id}` });
  }

  e("CLAIM_DRAFTED", "historical_claim", "claim-arrival", {
    claim_id: "claim-arrival",
    claim_version_id: "cv-arrival-1879",
    subject_person_id: "person-yanfu",
    topic: "严复首次抵达天津的时间",
    fact_class: "established_fact",
    statement: "严复于 1879 年到天津，参与北洋水师学堂筹建。",
    temporal: { start: "1879", start_certainty: "circa" },
    place_id: "place-tj-academy",
  }, { at: "2024-09-03T10:00:00+08:00", summary: "起草主张版本：1879 年到津说（旧通行说）" });

  e("EVIDENCE_CITED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1879",
    source_id: "src-old-chronology",
    support: "indirect",
    excerpt: "光绪五年，严氏北赴天津，襄办水师学堂。【按：此年表后经档案核对修正】",
    note: "二手年表，未注原始出处。",
  }, { at: "2024-09-03T10:20:00+08:00", summary: "旧年表作为 1879 说的证据登记（原证据保留）" });

  e("CLAIM_REVIEWED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1879",
    reviewer: "中心编审委员会（样例占位）",
    reviewer_role: "编审",
    verdict: "supports",
    rationale: "沿用既有展陈通行说，先核准上线；注明仅有二手年表支撑，待原档。",
  }, { at: "2024-09-05T14:00:00+08:00", summary: "评阅：暂从旧说，限期补档" });

  e("CLAIM_APPROVED", "historical_claim", "claim-arrival", {
    claim_id: "claim-arrival",
    approved_claim_version_id: "cv-arrival-1879",
    rationale: "2024 年秋展上线节点，从旧通行说核准，证据等级标注为间接。",
  }, { at: "2024-09-06T14:00:00+08:00", summary: "首次核准：1879 年到津说" });

  // ---------- 2024 秋展发布 ----------
  e("ASSET_LINKED", "interpretive_asset", "asset-panel", {
    asset: { id: "asset-panel", carrier: "park_panel", title: "严复公园·生平年表展板", live: true },
    asset_version_id: "av-panel-2024",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "公园中区展板第 2 板",
    qr_code: "QR-PANEL-2024",
  }, { at: "2024-09-20T10:00:00+08:00", summary: "2024 秋展板引用 1879 说" });

  e("RELEASE_PUBLISHED", "release_version", "rel-2024-autumn", {
    release_id: "rel-2024-autumn",
    asset_version_ids: ["av-panel-2024"],
    public_note: "2024 秋季版展陈。",
  }, { at: "2024-10-01T09:00:00+08:00", summary: "发布 2024 秋季版" });

  // ---------- 2025 春：多载体扩展前的门禁检查 ----------
  // 供问题版本使用的主张（均留下记录，但不进最终发布）
  e("SOURCE_REGISTERED", "source_record", "src-essay-tabloid", {
    source: {
      id: "src-essay-tabloid",
      kind: "published_material",
      access_class: "public",
      citation: "民国小报《津门杂记》新编本（样例占位）",
    },
  }, { at: "2025-03-01T10:00:00+08:00", summary: "登记一条薄弱公开来源" });

  e("SOURCE_REGISTERED", "source_record", "src-modern-paper", {
    source: {
      id: "src-modern-paper",
      kind: "secondary_scholarship",
      access_class: "public",
      citation: "今人论文《严复与北洋水师学堂》（样例占位）",
    },
  }, { at: "2025-03-01T10:10:00+08:00", summary: "登记后世研究来源" });

  e("CLAIM_DRAFTED", "historical_claim", "claim-final-essay", {
    claim_id: "claim-final-essay",
    claim_version_id: "cv-essay-1922",
    subject_person_id: "person-yanfu",
    topic: "严复在津最后撰述时间",
    fact_class: "established_fact",
    statement: "严复 1922 年在天津完成最后一篇政论。",
    temporal: { start: "1922" },
    place_id: "place-tj-academy",
  }, { at: "2025-03-02T10:00:00+08:00", summary: "起草：1922 年撰述说（晚于卒年，门禁应拦截）" });
  e("EVIDENCE_CITED", "historical_claim", "claim-final-essay", {
    claim_version_id: "cv-essay-1922",
    source_id: "src-essay-tabloid",
    support: "indirect",
    excerpt: "坊间笔记称先生晚年尚有政论。",
  }, { at: "2025-03-02T10:05:00+08:00", summary: "补薄弱证据（有来源但跨年代矛盾仍应拦截）" });

  e("CLAIM_DRAFTED", "historical_claim", "claim-meet-li", {
    claim_id: "claim-meet-li",
    claim_version_id: "cv-meetli-inference",
    subject_person_id: "person-yanfu",
    topic: "严复到津后拜会李鸿章的时间",
    fact_class: "reasonable_inference",
    statement: "严复到津后不久即拜会李鸿章禀陈办学事宜。",
    temporal: { start: "1879", start_certainty: "circa" },
    place_id: "place-tj-academy",
  }, { at: "2025-03-02T11:00:00+08:00", summary: "起草合理推断：到津即拜会李鸿章" });
  e("EVIDENCE_CITED", "historical_claim", "claim-meet-li", {
    claim_version_id: "cv-meetli-inference",
    source_id: "src-modern-paper",
    support: "contextual",
    excerpt: "论文据办学时序推测二人到津之初当有会面。",
  }, { at: "2025-03-02T11:05:00+08:00", summary: "推断的旁证" });
  e("CLAIM_APPROVED", "historical_claim", "claim-meet-li", {
    claim_id: "claim-meet-li",
    approved_claim_version_id: "cv-meetli-inference",
    rationale: "时序合理但无直证，按合理推断核准，不得当作确定事实呈现。",
  }, { at: "2025-03-03T09:00:00+08:00", summary: "按合理推断核准（分级纪律的测试对象）" });

  e("CLAIM_DRAFTED", "historical_claim", "claim-uk-study", {
    claim_id: "claim-uk-study",
    claim_version_id: "cv-uk-1879",
    subject_person_id: "person-yanfu",
    topic: "严复 1879 年行踪",
    fact_class: "established_fact",
    statement: "严复 1879 年全年仍在英国格林威治海军学院学习。",
    temporal: { start: "1879" },
    place_id: "place-greenwich",
  }, { at: "2025-03-02T12:00:00+08:00", summary: "起草：1879 年仍在英说（无来源，且与到津说行踪冲突）" });

  // 问题载体版本（草案）
  e("ASSET_LINKED", "interpretive_asset", "asset-video", {
    asset: { id: "asset-video", carrier: "ai_video", title: "AI 视频《严复与天津》", live: true },
    asset_version_id: "av-video-draft",
    claim_version_id: "cv-essay-1922",
    presentation_class: "established_fact",
    locator: "片尾解说卡",
  }, { at: "2025-03-04T10:00:00+08:00", summary: "视频草案：1922 年卡（越出生卒年）" });
  e("ASSET_LINKED", "interpretive_asset", "asset-video", {
    asset: { id: "asset-video", carrier: "ai_video", title: "AI 视频《严复与天津》", live: true },
    asset_version_id: "av-video-draft",
    claim_version_id: "cv-meetli-inference",
    presentation_class: "established_fact",
    locator: "第二幕旁白",
  }, { at: "2025-03-04T10:01:00+08:00", summary: "视频草案：把合理推断抬成确定事实" });

  e("ASSET_LINKED", "interpretive_asset", "asset-puzzle", {
    asset: { id: "asset-puzzle", carrier: "night_tour_puzzle", title: "夜游解谜·东局子密令", live: true, year_encoded_in_answer: true },
    asset_version_id: "av-puzzle-draft",
    claim_version_id: "cv-uk-1879",
    presentation_class: "established_fact",
    locator: "谜题 03 题干",
  }, { at: "2025-03-04T11:00:00+08:00", summary: "谜题草案：引用无来源的在英说" });
  e("ASSET_LINKED", "interpretive_asset", "asset-puzzle", {
    asset: { id: "asset-puzzle", carrier: "night_tour_puzzle", title: "夜游解谜·东局子密令", live: true, year_encoded_in_answer: true },
    asset_version_id: "av-puzzle-draft",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "谜题 03 答案口令",
  }, { at: "2025-03-04T11:01:00+08:00", summary: "谜题草案：与在英说同年异地（行踪矛盾）" });

  e("ASSET_LINKED", "interpretive_asset", "asset-prologue", {
    asset: { id: "asset-prologue", carrier: "night_tour_script", title: "夜游开场独白·码头", live: true, live_performance: true },
    asset_version_id: "av-prologue-draft",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "artistic_dramatization",
    dramatization_disclosed: false,
    line: "海风裹着马尾的潮气，我一脚踏上天津卫的码头，这一留，就是二十年。",
    locator: "开场独白",
  }, { at: "2025-03-04T12:00:00+08:00", summary: "开场独白草案：艺术演绎未明示" });

  // 合规载体版本（与草案同时备好）
  e("ASSET_LINKED", "interpretive_asset", "asset-panel", {
    asset: { id: "asset-panel", carrier: "park_panel", title: "严复公园·生平年表展板", live: true },
    asset_version_id: "av-panel-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "公园中区展板第 3 板",
    qr_code: "QR-PANEL-2025",
  }, { at: "2025-03-05T09:00:00+08:00", summary: "2025 展板定稿" });
  e("ASSET_LINKED", "interpretive_asset", "asset-video", {
    asset: { id: "asset-video", carrier: "ai_video", title: "AI 视频《严复与天津》", live: true },
    asset_version_id: "av-video-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "第一幕年份字幕",
    qr_code: "QR-VIDEO-2025",
  }, { at: "2025-03-05T09:10:00+08:00", summary: "视频定稿：删除问题卡片" });
  e("ASSET_LINKED", "interpretive_asset", "asset-tram", {
    asset: { id: "asset-tram", carrier: "themed_tram", title: "主题铛铛车·严复线车厢讲解", live: true },
    asset_version_id: "av-tram-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "第 2 站语音讲解",
    qr_code: "QR-TRAM-2025",
  }, { at: "2025-03-05T09:20:00+08:00", summary: "铛铛车讲解定稿" });
  e("ASSET_LINKED", "interpretive_asset", "asset-tour-script", {
    asset: { id: "asset-tour-script", carrier: "night_tour_script", title: "夜游正剧台词·办学", live: true, live_performance: true },
    asset_version_id: "av-tour-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    line: "光绪五年，严先生初到天津，奉旨襄办水师学堂。",
    locator: "第二场台词",
    qr_code: "QR-TOUR-2025",
  }, { at: "2025-03-05T09:30:00+08:00", summary: "夜游正剧台词定稿（现场演出）" });
  e("ASSET_LINKED", "interpretive_asset", "asset-puzzle", {
    asset: { id: "asset-puzzle", carrier: "night_tour_puzzle", title: "夜游解谜·东局子密令", live: true, year_encoded_in_answer: true },
    asset_version_id: "av-puzzle-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "谜题 03 答案口令“一八七九”",
    qr_code: "QR-PUZZLE-2025",
  }, { at: "2025-03-05T09:40:00+08:00", summary: "谜题定稿：年份编入答案口令" });
  e("ASSET_LINKED", "interpretive_asset", "asset-prologue", {
    asset: { id: "asset-prologue", carrier: "night_tour_script", title: "夜游开场独白·码头", live: true, live_performance: true },
    asset_version_id: "av-prologue-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "artistic_dramatization",
    dramatization_disclosed: true,
    line: "海风裹着马尾的潮气，我一脚踏上天津卫的码头，这一留，就是二十年。",
    locator: "开场独白（节目单已标注“戏剧加工”）",
    qr_code: "QR-PROLOGUE-2025",
  }, { at: "2025-03-05T09:50:00+08:00", summary: "开场独白定稿：已明示艺术演绎" });
  e("ASSET_LINKED", "interpretive_asset", "asset-scene", {
    asset: { id: "asset-scene", carrier: "digital_scene", title: "数字场景·海河码头 1879", live: true },
    asset_version_id: "av-scene-2025",
    claim_version_id: "cv-arrival-1879",
    presentation_class: "established_fact",
    locator: "入场年份地屏",
    qr_code: "QR-SCENE-2025",
  }, { at: "2025-03-05T10:00:00+08:00", summary: "数字场景定稿" });

  const store = new EventStore(reducer);
  store.appendAll(b.list);
  b.list.length = 0;

  // 门禁第一轮：草案集合必须失败，并给出全部五类问题
  stages.preflightBad = checkProposedRelease(store.state, ["av-video-draft", "av-puzzle-draft", "av-prologue-draft"], "2025 春季扩展（草案）");
  // 门禁第二轮：定稿集合通过
  const springVersions = ["av-panel-2025", "av-video-2025", "av-tram-2025", "av-tour-2025", "av-puzzle-2025", "av-prologue-2025", "av-scene-2025"];
  stages.preflightFixed = checkProposedRelease(store.state, springVersions, "2025 春季扩展（定稿）");

  e("RELEASE_RETIRED", "release_version", "rel-2024-autumn", {
    release_id: "rel-2024-autumn",
    replacement_release_id: null,
    retain_snapshot: true,
    public_note: "2024 秋展板随 2025 春季多载体改版撤换，旧版说明原样保留。",
  }, { at: "2025-03-20T18:00:00+08:00", summary: "停用 2024 秋发布（保留快照与当时说明）" });
  e("RELEASE_PUBLISHED", "release_version", "rel-2025-spring", {
    release_id: "rel-2025-spring",
    asset_version_ids: springVersions,
    public_note: "2025 春季版：展板、AI 视频、铛铛车讲解、夜游正剧与谜题、数字场景同步上线；开场独白标注为艺术演绎。",
  }, { at: "2025-04-01T09:00:00+08:00", summary: "发布 2025 春季版（门禁通过后投用）" });
  store.appendAll(b.list);
  b.list.length = 0;
  stages.release2025 = checkRelease(store.state, "rel-2025-spring");

  // ---------- 2026 年夏：新档案研究 ----------
  const newSources = [
    {
      id: "src-li-memorial-1880",
      kind: "archival_document",
      access_class: "restricted_original",
      citation: "李鸿章《调员差遣片》（光绪六年六月），馆藏奏片胶片【档号占位】",
      internal_location: "特藏库 K-排 12-柜 03【授权字段】",
      access_note: "原件纸质脆弱，仅经申请在监护下调阅；释文已经编审公开放行。",
      public_restriction_notice: "原奏片为受限原件，公众所见为经编审放行的释文。",
      holding_org: "城市文化研究中心特藏部",
      contact: "特藏部阅览预约（内线占位）",
    },
    {
      id: "src-yanfu-letters",
      kind: "published_material",
      access_class: "public",
      citation: "《严复集》所收自叙函札（卷次页码占位）",
    },
    {
      id: "src-navy-roster",
      kind: "archival_document",
      access_class: "internal_location",
      citation: "船政学堂与水师学堂教习履历衔名档（档号占位）",
      internal_location: "内部档案库 FZ-籍-0761【授权字段】",
      access_note: "内部存放位置与数字件路径仅限档案员。",
    },
    {
      id: "src-family-oral",
      kind: "oral_history",
      access_class: "unpublished_personal",
      citation: "严氏后人访谈记录（编号 OH-YF-2026-02，未公开）",
      personal_materials: "含家书照片与家族信息，授权范围限本课题。",
    },
  ];
  for (const source of newSources) {
    e("SOURCE_REGISTERED", "source_record", source.id, { source },
      { at: "2026-08-05T10:00:00+08:00", summary: `登记新见来源：${source.id}（密级 ${source.access_class}）` });
  }

  // 福州任教经历：与 1879 到津说同年异地
  e("CLAIM_DRAFTED", "historical_claim", "claim-fuzhou-teach", {
    claim_id: "claim-fuzhou-teach",
    claim_version_id: "cv-fuzhou-1879",
    subject_person_id: "person-yanfu",
    topic: "严复 1879 年归国后的任教地点",
    fact_class: "established_fact",
    statement: "严复 1879 年归国后在福州马尾船政学堂任教习。",
    temporal: { start: "1879-08", start_certainty: "circa" },
    place_id: "place-fz-academy",
  }, { at: "2026-08-10T10:00:00+08:00", summary: "起草：1879 年在福州任教说" });
  e("EVIDENCE_CITED", "historical_claim", "claim-fuzhou-teach", {
    claim_version_id: "cv-fuzhou-1879",
    source_id: "src-yanfu-letters",
    support: "direct",
    excerpt: "（自叙）已卯秋归里，主讲马江学堂。",
    public_excerpt: "我自光绪五年秋天回到福建，在马尾的学堂任教。",
  }, { at: "2026-08-10T10:10:00+08:00", summary: "严复自叙函札直接证明 1879 秋在福州" });
  e("EVIDENCE_CITED", "historical_claim", "claim-fuzhou-teach", {
    claim_version_id: "cv-fuzhou-1879",
    source_id: "src-navy-roster",
    support: "direct",
    excerpt: "教习衔名册：光绪五年，严复，在堂授课。【内部档】",
  }, { at: "2026-08-10T10:15:00+08:00", summary: "教习衔名档佐证（内部位置不公开）" });
  e("CLAIM_APPROVED", "historical_claim", "claim-fuzhou-teach", {
    claim_id: "claim-fuzhou-teach",
    approved_claim_version_id: "cv-fuzhou-1879",
    rationale: "自叙直证加衔名档，按确定事实核准。",
  }, { at: "2026-08-12T09:00:00+08:00", summary: "核准：1879 年在福州任教" });

  store.appendAll(b.list);
  b.list.length = 0;
  // 全库核准一致性：1879 福州 与 1879 到津 同年异地 → 必须报矛盾
  stages.approvedConflict = checkApprovedClaims(store.state);

  // 1880 新说与竞争解释（1879 冬奉命、1880 初到津）共存
  e("CLAIM_DRAFTED", "historical_claim", "claim-arrival", {
    claim_id: "claim-arrival",
    claim_version_id: "cv-arrival-1880",
    subject_person_id: "person-yanfu",
    topic: "严复首次抵达天津的时间",
    fact_class: "established_fact",
    statement: "严复于 1880 年（光绪六年）奉调抵达天津，参与北洋水师学堂筹建。",
    temporal: { start: "1880-07", start_certainty: "circa" },
    place_id: "place-tj-academy",
  }, { at: "2026-08-15T10:00:00+08:00", summary: "起草主张版本：1880 年到津说" });
  e("EVIDENCE_CITED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1880",
    source_id: "src-li-memorial-1880",
    support: "direct",
    excerpt: "查有船政学堂教习严复，堪资差遣，拟调赴天津学堂。光绪六年六月。【受限原件释文】",
    public_excerpt: "光绪六年（1880 年）六月的官方奏片提出，将船政学堂教习严复读调到天津的学堂任职。",
    note: "原件受限，释文已经编审公开放行。",
  }, { at: "2026-08-15T10:20:00+08:00", summary: "光绪六年奏片为 1880 说提供直接证据" });
  e("EVIDENCE_CITED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1880",
    source_id: "src-yanfu-letters",
    support: "direct",
    excerpt: "（自叙）庚辰夏，李相札调北上，遂赴天津。",
    public_excerpt: "光绪六年（1880 年）夏天，我接到李鸿章的调令北上，前往天津。",
  }, { at: "2026-08-15T10:25:00+08:00", summary: "自叙函札互证" });
  e("EVIDENCE_CITED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1880",
    source_id: "src-navy-roster",
    support: "indirect",
    excerpt: "天津学堂教习衔名：光绪六年七月起列严复名。【内部档】",
  }, { at: "2026-08-15T10:30:00+08:00", summary: "衔名档起列月份为间接旁证（内部）" });

  e("CLAIM_DRAFTED", "historical_claim", "claim-arrival", {
    claim_id: "claim-arrival",
    claim_version_id: "cv-arrival-1879winter",
    subject_person_id: "person-yanfu",
    topic: "严复首次抵达天津的时间",
    fact_class: "reasonable_inference",
    statement: "严复或在 1879 年冬已先期赴津接洽、1880 年正式到任。",
    temporal: { start: "1879-12", start_certainty: "circa", end: "1880-02", end_certainty: "circa" },
    place_id: "place-tj-academy",
  }, { at: "2026-08-16T10:00:00+08:00", summary: "起草竞争解释：1879 冬先期赴津说（合理推断）" });
  e("EVIDENCE_CITED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1879winter",
    source_id: "src-family-oral",
    support: "contextual",
    excerpt: "后人口述：祖辈相传他那年冬天出过一趟远门，过年前后才定下北上去向。【未公开】",
  }, { at: "2026-08-16T10:10:00+08:00", summary: "口述为竞争解释提供情境性支撑（未公开，不进游客视图）" });

  e("CLAIM_REVIEWED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1879",
    reviewer: "合作高校近代史研究团队（样例占位）",
    reviewer_role: "外审学者",
    verdict: "refutes",
    rationale: "旧说仅据二手年表；严复自叙明言光绪五年秋在马尾任教，1879 年人在福州。",
    competing_version_id: "cv-arrival-1880",
  }, { at: "2026-08-20T09:00:00+08:00", summary: "外审评阅：旧说不成立" });
  e("CLAIM_REVIEWED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1880",
    reviewer: "合作高校近代史研究团队（样例占位）",
    reviewer_role: "外审学者",
    verdict: "supports",
    rationale: "奏片与自叙双向直证，衔名档起列月份吻合，按确定事实核准。",
  }, { at: "2026-08-20T09:10:00+08:00", summary: "外审评阅：支持 1880 说" });
  e("CLAIM_REVIEWED", "historical_claim", "claim-arrival", {
    claim_version_id: "cv-arrival-1879winter",
    reviewer: "地方史研究者（样例占位）",
    reviewer_role: "独立研究者",
    verdict: "questions",
    rationale: "口述线索可备一说，但无法确认“远门”即天津，且为家族转述，暂列合理推断并存。",
  }, { at: "2026-08-20T09:20:00+08:00", summary: "竞争解释保留：质疑并存，不取代核准结论" });
  e("DISSENT_FILED", "historical_claim", "claim-arrival", {
    claim_id: "claim-arrival",
    against_claim_version_id: "cv-arrival-1880",
    proposed_claim_version_id: "cv-arrival-1879winter",
    scholar: "地方史研究者（样例占位）",
    rationale: "官方文书的奏调时间不等于实际到津时间，建议保留“先期接洽”的解释窗口。",
  }, { at: "2026-08-21T10:00:00+08:00", summary: "异议登记：竞争解释与核准结论共存" });

  e("CORRECTION_APPROVED", "historical_claim", "claim-arrival", {
    claim_id: "claim-arrival",
    superseded_claim_version_id: "cv-arrival-1879",
    approved_claim_version_id: "cv-arrival-1880",
    rationale: "光绪六年奏片、严复自叙、衔名档三重证据链；旧说年表无原始出处。1879 冬先期赴津说留作合理推断并存。",
    public_note: "更正：严复到天津的时间由“1879 年”更正为“1880 年（光绪六年）”。1879 年他归国后在福州马尾船政学堂任教；1880 年夏奉调北上天津，参与北洋水师学堂筹建。旧版展陈依据的二手年表未注原始出处，特此更正。",
  }, { at: "2026-09-10T14:00:00+08:00", id: "evt-correction-arrival-1880", summary: "核准修订：到津时间 1879 → 1880（旧版本保留）" });

  // 同一批档案还修正了衍生推断：拜会李鸿章只能在 1880 年到津之后
  e("CLAIM_DRAFTED", "historical_claim", "claim-meet-li", {
    claim_id: "claim-meet-li",
    claim_version_id: "cv-meetli-1880",
    subject_person_id: "person-yanfu",
    topic: "严复到津后拜会李鸿章的时间",
    fact_class: "reasonable_inference",
    statement: "严复 1880 年夏奉调抵津后不久拜会李鸿章禀陈办学事宜。",
    temporal: { start: "1880-08", start_certainty: "circa" },
    place_id: "place-tj-academy",
  }, { at: "2026-09-08T10:00:00+08:00", summary: "起草衍生推断的新版本：拜会时间随到津年份改为 1880" });
  e("EVIDENCE_CITED", "historical_claim", "claim-meet-li", {
    claim_version_id: "cv-meetli-1880",
    source_id: "src-li-memorial-1880",
    support: "contextual",
    excerpt: "奏片调严赴津差遣，会面禀陈当在到津之后。【据时序推断】",
    public_excerpt: "官方奏片把严复调往天津，他与李鸿章见面商谈办学应在 1880 年夏天到津之后。",
  }, { at: "2026-09-08T10:10:00+08:00", summary: "1880 拜会说的时序依据" });
  e("CORRECTION_APPROVED", "historical_claim", "claim-meet-li", {
    claim_id: "claim-meet-li",
    superseded_claim_version_id: "cv-meetli-inference",
    approved_claim_version_id: "cv-meetli-1880",
    rationale: "到津既已更正为 1880 年，旧推断的时间前提不再成立；会面时间整体顺移。",
    public_note: "更正：“严复到津后不久拜会李鸿章”的时间推断由 1879 年顺移至 1880 年夏到津之后。",
  }, { at: "2026-09-10T14:05:00+08:00", id: "evt-correction-meetli-1880", summary: "核准衍生修订：拜会推断 1879 → 1880" });

  store.appendAll(b.list);
  b.list.length = 0;
  // 修订后全库复检：已核准主张间不应再有行踪矛盾
  stages.approvedConflictAfter = checkApprovedClaims(store.state);

  stages.impact = assessCorrectionImpact(store.state, "evt-correction-arrival-1880");

  // 按评估签发载体决策（immediate 两场、其余排期）
  for (const a of stages.impact.affected_active_carriers) {
    e("CARRIER_DECISION_ISSUED", "interpretive_asset", a.asset_id, {
      asset_id: a.asset_id,
      release_id: a.release_id,
      decision: a.recommended_decision,
      deadline: a.recommended_decision === "scheduled_replacement" ? deadlineFor(a.risk_level) : null,
      triggered_by_event_id: "evt-correction-arrival-1880",
      risk: a.risk_level,
      reason: `到津年份修订（1879→1880）：${a.risk_factors.join("；")}`,
    }, {
      at: "2026-09-10T15:00:00+08:00",
      summary: a.recommended_decision === "immediate_withdraw"
        ? `立即停用：${a.title}`
        : `排期更换：${a.title}（${a.deadline_days} 日内）`,
    });
  }

  // 2026 秋替换载体版本，全部引用 1880 新核准版本
  const replacements = [
    ["asset-panel", "park_panel", "av-panel-2026", "av-panel-2025", "QR-PANEL-2026", "公园中区展板第 3 板（换版）"],
    ["asset-video", "ai_video", "av-video-2026", "av-video-2025", "QR-VIDEO-2026", "第一幕年份字幕（换版）"],
    ["asset-tram", "themed_tram", "av-tram-2026", "av-tram-2025", "QR-TRAM-2026", "第 2 站语音讲解（换版）"],
    ["asset-tour-script", "night_tour_script", "av-tour-2026", "av-tour-2025", "QR-TOUR-2026", "第二场台词（换词）"],
    ["asset-puzzle", "night_tour_puzzle", "av-puzzle-2026", "av-puzzle-2025", "QR-PUZZLE-2026", "答案口令“一八八〇”（换版）"],
    ["asset-prologue", "night_tour_script", "av-prologue-2026", "av-prologue-2025", "QR-PROLOGUE-2026", "开场独白（节目单保留“戏剧加工”标注）"],
    ["asset-scene", "digital_scene", "av-scene-2026", "av-scene-2025", "QR-SCENE-2026", "入场年份地屏（换版）"],
  ];
  for (const [assetId, carrier, newVersion, oldVersion, qr, locator] of replacements) {
    const asset = store.state.assets.get(assetId);
    const isDrama = assetId === "asset-prologue";
    e("ASSET_LINKED", "interpretive_asset", assetId, {
      asset: { id: assetId, carrier, title: asset.title, live: true },
      asset_version_id: newVersion,
      claim_version_id: "cv-arrival-1880",
      presentation_class: isDrama ? "artistic_dramatization" : "established_fact",
      dramatization_disclosed: isDrama,
      line: assetId === "asset-tour-script" ? "光绪六年夏天，严先生奉调北上，初到天津。" : undefined,
      locator,
      qr_code: qr,
    }, { at: "2026-09-20T10:00:00+08:00", summary: `换版 ${oldVersion} → ${newVersion}，引用 1880 新核准版本` });
  }

  e("RELEASE_PUBLISHED", "release_version", "rel-2026-autumn", {
    release_id: "rel-2026-autumn",
    asset_version_ids: replacements.map((r) => r[2]),
    public_note: "2026 秋季版：按光绪六年奏片与严复自叙，将到津年份全面更正为 1880 年；夜游谜题答案同步更换。",
  }, { at: "2026-09-25T09:00:00+08:00", summary: "发布 2026 秋季更正版" });
  e("RELEASE_RETIRED", "release_version", "rel-2025-spring", {
    release_id: "rel-2025-spring",
    replacement_release_id: "rel-2026-autumn",
    retain_snapshot: true,
    public_note: "本版使用的到津年份 1879 已更正为 1880；旧版全部物料与说明留档，扫码可见更正记录。",
  }, { at: "2026-09-25T09:30:00+08:00", summary: "停用 2025 春发布并指向 2026 秋更正版（快照保留）" });

  store.appendAll(b.list);

  // 修订后复检：新发布通过；已停用的 2025 春发布若被复查，应明确列出被取代版本
  stages.release2026 = checkRelease(store.state, "rel-2026-autumn");
  stages.oldReleaseRecheck = checkRelease(store.state, "rel-2025-spring");

  return {
    store,
    stages,
    ids: {
      correctionEvent: "evt-correction-arrival-1880",
      correctionMeetLiEvent: "evt-correction-meetli-1880",
      claim: "claim-arrival",
      v1879: "cv-arrival-1879",
      v1880: "cv-arrival-1880",
      vWinter: "cv-arrival-1879winter",
      springRelease: "rel-2025-spring",
      autumnRelease: "rel-2026-autumn",
      qrOldPanel: "QR-PANEL-2025",
      qrNewPanel: "QR-PANEL-2026",
      qrOldTour: "QR-TOUR-2025",
      restrictedSource: "src-li-memorial-1880",
      internalSource: "src-navy-roster",
      oralSource: "src-family-oral",
    },
  };
}

function deadlineFor(level) {
  const days = { high: 0, medium: 14, low: 60 }[level];
  return new Date(Date.parse("2026-09-10T15:00:00+08:00") + days * 86_400_000).toISOString();
}
