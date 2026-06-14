# AI Slides 现状梳理与共识对齐

**Date**: 2026-05-09
**Status**: Draft (Rev 1 — 等待集体评审)
**Scope**: `frontend/{components,hooks,stores,types}/**/slides*`、`backend/src/modules/ai-app/office/slides/**`、`docs/architecture/ai-app/office/features-office/`
**Owner**: Jason / Claude Code
**Related**:

- 既有设计:`slides-engine-design.md`(v3.0)、`slides-v3-iteration-plan.md`、`ai-slides-improvement-plan.md`、`ppt-template-system.md`
- SOTA 对标:`docs/research/ai-slides-sota-2026.md`

> 本文目的:把"用户两条诉求 + 三条 pipeline 要求"对齐到当前实现,识别 GAP,组织集体评审,迭代到共识。
> 不重复 v3.0 设计文档的内容,只关注**当前差距**和**待决议项**。

---

## 1. 用户原始诉求(逐字回放,不替用户解读)

> "AI Slides 目前的实现再梳理一下,我的基本诉求是两个:
> 1、**导入**:从平台选择数据导入(但导入不应该是直接精简的,应该是可以提供 API 访问数据吧,要啥访问啥),进入 Slides 加工
> 2、**自主**:从互联网自己搜索获取数据,然后进入 Slides 加工
> Slides 加工应该有一个完整的 pipeline 吧,应该可视化中间所有的过程吧,尤其是**脚本生成应该先于 preview 吧**,并且**应该是流式输出吧**"

提炼为五条可验证目标(等评审定义验收标准):

| #   | 诉求                           | 关键词                               |
| --- | ------------------------------ | ------------------------------------ |
| R1  | 平台数据"按需取数"导入         | `API access on demand`,非全量预拉    |
| R2  | 互联网自主搜索路径             | `web search`,Slides 自带,非外挂      |
| R3  | 完整 pipeline + 中间过程可视化 | `step viewer / agent log / 中间产物` |
| R4  | 脚本生成早于 preview           | `narration before render`            |
| R5  | 全程流式输出                   | `SSE end-to-end`                     |

---

## 2. 当前实现现状(快照,以 file_path:line 为锚)

### 2.1 生成 Pipeline 阶段

后端 SSE 五阶段(`backend/src/modules/ai-app/office/slides/orchestrator/slides.controller.ts:323` 处 `@Post("generate")` + `text/event-stream`):

| Phase | 名称                 | 流式? | 前端事件                                                   |
| ----- | -------------------- | ----- | ---------------------------------------------------------- |
| P1    | `task_decomposition` | 是    | `useSlideGeneration.ts:73-74` setTaskDecomposition         |
| P2    | `outline_planning`   | 是    | `useSlideGeneration.ts:76-88` setOutlinePlan + setPages    |
| P3    | `page_rendering`     | 是    | `useSlideGeneration.ts:219-280` slide:generated(逐页 HTML) |
| P4    | `quality_review`     | 是    | `useSlideGeneration.ts:89-91` setQualityReport             |
| P5    | done                 | -     | checkpoint 写入                                            |

Team 模式(`useSlideGenerationTeam.ts`)在此基础上加 `agent:thinking` / `agent:working` / `agent:completed`(:348-384)、`PageDesignThinking`(:460-483)、`review:issue_found` / `review:auto_fixed` / `review:scoring`(:530-596)。

**Narration(脚本)**:独立非流式 POST,`useNarration.ts:91-98` `await fetch(...)` + `:105 await response.json()`,触发时机在主流程**完成之后**。

### 2.2 数据导入路径

- 5 个硬编码源类型(`frontend/hooks/features/slides/useDataImport.ts:32-37`):
  `'research' | 'research-project' | 'writing' | 'teams' | 'library'`
- 拉取方式(:129-307):每个源一个 endpoint,**一次性把 sourceText / sections / charts / images 全量拉到客户端**,后续 LLM 调用从客户端 body 传入。
- **无 connector 抽象、无按需取数 / tool calling on data source**。

### 2.3 互联网自主搜索

**完全缺失**。`useDataImport` 与 `useSlideGeneration*` 无任何 web search 调用;后端 slides controller / orchestrator 也无对接 `ai-engine/content/fetch` 或 `ai-app/research/` 的搜索能力。
对比:`ai-app/research/` 有完整 web search,但**未与 slides 打通**。

### 2.4 中间过程可视化

- 后端事件**已经全部流出**(thinking / working / design / review)。
- 前端 store(`stores/ai-office/slidesStore.ts` 的 `teamState` / `teamEvents[]`)**已经接收**。
- UI 层只暴露了 `PhaseTimeline`(阶段进度条),**没有 step viewer / agent log 面板 / 中间产物预览**。
- 用户最终看到的是终态幻灯片,**中间产物(大纲/分镜/检索片段/审校 issue)对用户不可见**。

### 2.5 流式

- 主生成路径:**已 SSE 端到端**(后端 `@Post("generate")` 手设 `text/event-stream`,前端 `fetch + ReadableStream` 拆 SSE)。
- Narration:**不流式**。
- 数据导入:**不流式**(全量拉)。

---

## 3. GAP 矩阵(诉求 vs 现状)

| #   | 诉求             | 现状评估                   | GAP                                                                                                                                                  |
| --- | ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 按需取数导入     | ❌ 全量预拉                | 需要 connector 抽象 + 服务端 tool(getSection / getChart / queryEntity);LLM 在 outline_planning / page_rendering 阶段按需调用,而不是把全量塞进 prompt |
| R2  | 互联网自主搜索   | ❌ 完全缺失                | 需要把 `ai-engine/tools` 的 `web_search` / `fetch_url` 接到 slides 的 task_decomposition 或新加的 `research_collection` 阶段                         |
| R3  | 中间过程可视化   | ⚠ 数据有,UI 缺             | `teamEvents[]` 已在 store,需要在 slides 主页面加 "Thinking / Pipeline" Tab,把 5 类事件按阶段渲染                                                     |
| R4  | 脚本先于 preview | ❌ 顺序相反                | 把 narration 提前到 outline_planning **之后**、page_rendering **之前**,让脚本先成形,再据脚本驱动版式选择                                             |
| R5  | 端到端流式       | ⚠ 主路径 OK,narration 不流 | narration 改 SSE,token 级流出;数据导入路径若改为 connector 调用,响应也走流式 chunk                                                                   |

---

## 4. Pipeline 目标态(草案,等评审)

```
[Source Selection]
    ├─ A. 平台导入(connector,只取索引/元数据)
    │     └─ getList / getMeta → 不预拉正文
    └─ B. 自主研究(web_search + fetch_url)
          └─ 检索词由 task_decomposition 产出

         ▼ (流式)
[P1] task_decomposition
         ▼ (流式,首次按需取数:getSummary / getOutline)
[P2] outline_planning
         ▼ (流式,新增,token 级)
[P3] narration_drafting    ← 脚本生成(R4 关键阶段)
         ▼ (流式,按需取数 chart/section/quote)
[P4] page_rendering
         ▼ (流式)
[P5] quality_review
         ▼
[Done] checkpoint + version
```

**中间产物对用户的可见性**(R3 落地):

| 阶段               | 用户可见产物                        |
| ------------------ | ----------------------------------- |
| Source Selection   | 选源列表 + 元数据 + connector 状态  |
| task_decomposition | 任务分解树 + 子目标 + 检索/取数计划 |
| outline_planning   | 大纲 + 每页类型预选 + 数据需求清单  |
| narration_drafting | 每页脚本(token 级流式渲染)          |
| page_rendering     | 设计 thinking + 每页 HTML(已有)     |
| quality_review     | issue 列表 + auto_fix diff(已有)    |

---

## 5. 待审视的多义点(暴露给评审,不替用户选 — Karpathy 原则)

> 以下每条都有≥2 个合理解读,需要在评审环节定向。

### Q1 「按需取数」的粒度

- 解读 A:**段落级**(getSection(id))。最贴近"要啥访问啥",但要求源端有结构化分段 API,改造工作量较大。
- 解读 B:**文档级摘要 + 段落级回查**。先取摘要让 LLM planning,page_rendering 时再 getSection。改造小、对 LLM context 友好。
- 解读 C:**实体级 / 数据点级**(图表的某个数据点、某个引用)。最贴近"agentic tool calling",但需要内容侧建索引。

### Q2 「互联网自主搜索」的边界

- 解读 A:**只补充事实**(数据点、最新数字、引用)。slides 主体仍然来自平台导入。
- 解读 B:**完全自主主题**(只给 topic,LLM 全网查 + 抓取 + 写 slides),平台导入是可选输入。
- 解读 C:**双轨并行**(平台导入为基线,web 搜索作为补充链路,LLM 决定何时切换)。

### Q3 「脚本先于 preview」中"脚本"的范围

- 解读 A:**narration(演讲稿)**——目前 useNarration 的产物。
- 解读 B:**script(分镜稿/章节叙事)**——比 narration 更结构化,包含每页核心论点 + 数据需求 + 视觉建议,作为 page_rendering 的驱动输入。
- 解读 C:两者都生成,B 给到 renderer,A 给到主持人/导出。

### Q4 「中间过程可视化」的展示密度

- 解读 A:**默认隐藏**,加"开发者面板"开关,常规用户不看。
- 解读 B:**默认显示**,作为生成体验的一部分(Genspark / Manus 路线)。
- 解读 C:**分层渐进**,默认只显示阶段标题,点击展开看每阶段产物。

### Q5 与既有 v3.0 设计文档的关系

- 解读 A:**本文是 v3.0 的增量/对齐**(v3.0 仍然是主体,本文补 R1/R2 + Pipeline 时序调整)。
- 解读 B:**本文升级为 v3.1**(narration 提前 + connector + web search 是 pipeline 级变更,需要重写阶段图)。
- 解读 C:**本文先共识,再统一改 v3.0**(本文不入主线,等共识达成回写)。

---

## 6. Reviewer 意见(等填)

> 评审格式:每位评审者按 R1–R5 + Q1–Q5 给立场。✅ 同意 / ⚠ 有保留 / ❌ 反对。保留 / 反对必须附理由 + 替代方案。

### Reviewer A — 架构 & 数据流(关注层次依赖、Engine/Harness 边界)

- _待填_

### Reviewer B — 产品 & UX 一致性(关注与 Research / Library 的复用、用户认知负担)

- _待填_

### Reviewer C — 安全 & 成本(关注 web search 引入的注入/抓取风险、token 成本)

- _待填_

---

## 7. 共识与分歧(待 Rev 2 填写)

| 议题  | 共识(✅) | 分歧(⚠/❌) | 决议或下一轮焦点 |
| ----- | -------- | ---------- | ---------------- |
| R1–R5 | -        | -          | -                |
| Q1–Q5 | -        | -          | -                |

---

## 8. 验收标准建议(可验证目标 — 强成功标准)

| #   | 强成功标准                                                                              |
| --- | --------------------------------------------------------------------------------------- |
| R1  | LLM prompt 中**不再出现** sourceText 全量;改为 tool call 拉取段落;p95 prompt token < 5k |
| R2  | 给定 `{topic}` 无平台源,Slides 能产出≥10 页带引用的 deck;引用可点击溯源                 |
| R3  | 主页面新增 Pipeline Tab,5 阶段中间产物可见,事件延迟 < 500ms                             |
| R4  | narration 阶段在 outline 后 / rendering 前完成,token 级 SSE                             |
| R5  | 所有用户可见的"思考/产出"路径走 SSE,无一次性 await json 路径                            |

---

## 9. 下一轮行动(Rev 2 触发条件)

- 三位 Reviewer 在本文 §6 填写意见 → 主 Owner 在 §7 汇总共识/分歧 → 分歧项保留到 Rev 2
- 共识项达到 R1–R5 全部 ✅ + Q1–Q5 至少 4/5 ✅ → 进入 v3.1 PRD/设计阶段,本文冻结
- 任一项 ❌ 持续 2 轮未消解 → 升级到产品+架构联合评审

---

**Revision 历史**

- Rev 1 (2026-05-09):初稿,事实快照 + GAP 矩阵 + 多义点暴露,等评审。
