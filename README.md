# 名人展陈史实发布库

城市文化研究中心用于统一管理名人展陈（公园展板、AI 视频、夜游台词与解谜、主题铛铛车、数字场景）所引用史实的领域服务。
解决两个核心痛点：

1. **一处修订，多载体联动**——一次生平日期修订，能列出全部正在运营与曾经公开的受影响版本，并按风险决定立即停用还是排期更换；
2. **史实与演绎不再混淆**——确定事实 / 合理推断 / 艺术演绎三级分离，戏剧压缩时间线必须向观众明示，扫码即可看到证据与更正记录。

> ⚠️ 样例数据说明：`src/scenario.js` 以严复 1879/1880 到津日期修订为演示（线索取自通行年表：1879 年归国后在福州船政学堂任教，1880 年奉调至天津参与筹建北洋水师学堂），但**奏片档号、函札卷次、评阅学者姓名均为占位**，上线前须以原档核对替换。

## 核心纪律

- **事件只追加**：事件标识、发生时间、聚合版本一旦接收即深度冻结；更正只能产生后继事件（新主张版本 → `CORRECTION_APPROVED` → `CARRIER_DECISION_ISSUED` → 换版 → `RELEASE_RETIRED`）。
- **业务层不得覆盖原证据**：来源登记不可重复覆盖；被取代的主张版本、旧发布快照连同当时说明永久保留（`retain_snapshot: true` 是停用发布的强制条件）。
- **引用精确到版本**：每个展板、每句台词、每道谜题都记录 `asset_version_id → claim_version_id`，研究者可由一句台词追到采用理由。
- **授权边界内不出域**：内部档案位置、受限原件、未公开个人材料只经 `projections` 的角色投影输出。

## 事实分级

| 分级 | 含义 | 呈现要求 |
|---|---|---|
| `established_fact` 确定事实 | 有直接来源、经核准 | 可作确定陈述；游客扫码须有适合公开的证据 |
| `reasonable_inference` 合理推断 | 有据但无直证 | 不得以"确定事实"呈现（门禁 `CLASS_ELEVATION` 拦截） |
| `artistic_dramatization` 艺术演绎 | 仅载体呈现分级，不是史实主张 | 必须向观众明示（节目单/开场提示/字幕），扫码页同时给出演绎声明与史实依据 |

多个学者的竞争解释可以共存：`DISSENT_FILED` 登记异议，竞争版本保留在同一主张聚合内；核准结论与异议并列可见。

## 来源密级

| `access_class` | 游客 | 研究者 | 档案员 |
|---|---|---|---|
| `public` | 题录+公开摘录 | 同左 | 全字段 |
| `internal_location` 内部存放位置 | 遮蔽 | 须逐件授权（`grantedSources`），排架号仍不可见 | 可见 |
| `restricted_original` 受限原件 | 只见经编审放行的 `public_excerpt` | 无授权只见题录与公开释文 | 全字段 |
| `unpublished_personal` 未公开个人材料 | 遮蔽原文，仅通用说明 | 须逐件授权 | 全字段 |

研究者身份不自动解锁任何受限材料；授权是**逐件来源**授予的；内部排架位置任何研究账号都不可见。

## 发布前门禁（`src/gate.js`）

对拟发布或已发布载体版本运行，`block` 清零才允许上线：

- `UNSOURCED_CLAIM`：无来源断言；
- `SUPERSEDED_VERSION`：引用从未核准或已被修订取代的主张版本；
- `CLASS_ELEVATION`：合理推断被当作确定事实；
- `DRAMATIZATION_UNDISCLOSED`：艺术演绎未向观众明示；
- `AFTER_DEATH` / `BEFORE_BIRTH`：时间主张越出人物生卒年；
- `WHEREABOUTS_CONFLICT`：同一人物同一时段出现在不同地点（同年异地行踪矛盾；同一问题的竞争版本不互斥）；
- `PLACE_ANACHRONISM`：与地点存世年代不符（年份精度边界放宽一年，兼容"筹建跨年"）；
- `NO_PUBLIC_EVIDENCE`（warn）：事实级展项的证据全部不公开，游客扫码将无据可看。

另有 `checkApprovedClaims()`：不依赖发布，对全库已核准主张做一致性扫描——新档案研究阶段即能发现旧核准与新证据的矛盾。

## 修订影响评估（`src/impact.js`）

`CORRECTION_APPROVED` 后，枚举**全部**引用旧版本的载体（含已停用历史发布，单列不处置），按可核验属性分级：

| 情形 | 风险 | 处置 |
|---|---|---|
| 事实级错误 + 现场演出（每场复述）或年份编入谜题答案/口令 | high | **立即停用** |
| 事实级错误 + 固定物料（展板/视频/铛铛车/数字场景） | medium | 排期 14 日更换，扫码更正页即时先行 |
| 推断级 + 现场演出 | medium | 排期 7 日改词 |
| 推断级固定物料 | low | 排期 30 日 |
| 已明示的艺术演绎 | low | 排期 60 日随季更新 |

`decisionDrafts()` 生成可签发的 `CARRIER_DECISION_ISSUED` 事件草稿（必须回链触发它的修订事件）。

## 目录

```
contracts/
  domain.schema.json     事件信封契约（required、additionalProperties:false）
  vocabularies.json      受控词表：事件/聚合/分级/密级/载体/处置（单一事实源）
data/
  sample.json            单条事件联调样例
  yanfu-events.json      严复完整场景的 71 条事件导出（npm run export-events）
                         注意：事件日志含内部/受限字段，外部分发必须经 projections 授权投影
src/
  vocab.js               词表加载
  validator.js           信封校验（不碰业务内容）
  time.js                年份/日精度时间窗口（exact/circa/before/after）
  store.js               只追加存储：深度冻结、版本连续、业务试归约
  reducer.js             状态归约：引用完整性与业务不变量拒收
  gate.js                发布前门禁 + 全库一致性扫描
  impact.js              修订影响枚举与停用/排期建议、决策草稿
  projections.js         visitor / researcher / archivist 授权投影与溯源
  scenario.js            严复端到端场景（2024 旧说 → 2025 多载体 → 2026 修订换版）
scripts/
  demo.js                七段端到端演示
  export-events.js       事件流导出
tests/                   25 项测试：契约/存储不可变/门禁/影响评估/投影
```

## 运行

```bash
npm test            # 25 项测试
npm run demo        # 严复场景端到端演示
npm run export-events
```

## 领域事件（13 类）

`PERSON_RECORDED`、`PLACE_RECORDED`、`SOURCE_REGISTERED`、`CLAIM_DRAFTED`、`EVIDENCE_CITED`、
`CLAIM_REVIEWED`、`DISSENT_FILED`、`CLAIM_APPROVED`、`CORRECTION_APPROVED`、
`ASSET_LINKED`、`RELEASE_PUBLISHED`、`CARRIER_DECISION_ISSUED`、`RELEASE_RETIRED`。

初始契约的 5 个事件名（`SOURCE_REGISTERED` 等）语义保持不变，仅做扩展，测试交叉校验枚举一致。

## 聚合与关键标识

- `historical_claim`：同一史实问题一个聚合，下挂多个永不删除的 `claim_version_id`；
  `approved_version_id` 指向当前核准版本，`corrections[]` 记录取代链与公众说明。
- `interpretive_asset`：展项载体（可区分 `live_performance`、`year_encoded_in_answer`），
  下挂 `asset_version_id`，每个链接记录呈现分级、演绎披露、台词原文、扫码码 `qr_code`。
- `release_version`：发布即固化全部载体版本引用的快照；停用只置 `active=false`，快照保留。
