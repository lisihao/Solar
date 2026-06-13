# Playground 前瞻洞察能力建设方案（Foresight）

> 目标：让 Agent Playground 的洞察从"回看（描述 + 诊断）"升级为"既回看、又向前看（预测 + 判断）"，
> 对标业界最强的前瞻方法论，并落到现有 12 阶段 pipeline，不破坏拓扑、不新增模块层。
>
> 状态：**已确认，实施中**。维护者：Claude Code。创建：2026-05-29。
>
> **决策（2026-05-29）**：(1) 三层全做（L1+L2+L3），目标品类级护城河；(2) L3 校准裁决采用**全自动**
> CalibratorAgent（web 检索 + LLM 判定 outcome），强制记录 `outcomeEvidenceUrl` 供回溯，低置信裁决
> 标 `needs-review` 但不阻塞 Brier 计算（仅在已裁决样本上算）。实施顺序 L1 → L2 → L3。

---

## 0. 问题陈述

当前 Playground 唯一产出洞察的环节是 **s6 Analyst**，其 `AnalystOutputShape` 全部字段都是"回看"：

- `insights / themeSummary / crossDimAnalysis / keyFindingsByDimension` —— 现状归纳
- `trendsByDimension{direction, timeframe}` —— 历史曲线方向标注（非外推）
- `contradictions` —— 跨源冲突的事后裁决
- 仅 `riskMatrix{probability, timeframe}` 和 `recommendationsByAudience{shortTerm, midTerm}` 带一点前瞻，但是顺带的副产品

**缺口**：没有一段"基于已对账证据、可证伪、带概率与置信度、配早期信号"的未来判断。读者看完知道"现在怎样、有何风险、建议怎么做"，但拿不到"接下来最可能往哪走、为什么、错了会怎样"。

## 1. 对标的业界标杆与可迁移配方

AI 深度研究产品（OpenAI/Gemini/Perplexity Deep Research）普遍**回避**校准预测——这是差异化机会。真正的方法论在另外三个领域：

| 来源     | 标杆                                                         | 可迁移机制                                                                                   |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 校准预测 | Tetlock 超预测 / IARPA ACE                                   | 问题分解 → 外部视角(基准率)优先 → 数字概率 → 集成多估计 → Brier 追踪校准                     |
| 情报分析 | CIA / Heuer 结构化分析技术(SATs)                             | 竞争性假设分析(ACH，主动找证伪) / 路标信号(Indicators) / 事前验尸 / ICD-203 概率与置信度分离 |
| 情景规划 | Shell / Pierre Wack                                          | 多情景叙事 / 预定元素 vs 关键不确定性 / 每情景配早期预警                                     |
| 学术     | Halawi et al. "Approaching Human-Level Forecasting with LMs" | 检索 → 对多结局分别推理 → 输出校准概率 → 多次集成（最贴合 LLM 栈）                           |

**提炼为 8 步配方**（本方案的设计准绳）：

1. 分解成可裁决问题（带裁决标准 + 时间点，可证伪）
2. 外部视角 / 基准率优先
3. 竞争性假设 + 主动找证伪（ACH）
4. 数字概率 + 置信度分离（不用"高/中/低"）
5. 情景分叉 + 路标信号（区分预定元素 vs 关键不确定性）
6. 对抗式复核（事前验尸 / 红队）
7. 集成多次独立预测
8. 事后校准追踪（Brier）→ 反哺

## 2. 总体架构：三层渐进，互不阻塞

```
L1 前瞻产出（让"向前看"成为一等公民）         ← 快赢，用户立即可感
   s6 Analyst 增 foresight 块 + Writer 固定出 Outlook 章节 + 前端 quickView 卡片

L2 严谨化（让预测抗打）                         ← 中档，复用已有评审/对账角色
   Reconciler(s5) 扩 ACH 竞争假设 + 新增 s9c Forecast 红队（事前验尸）+ 评分维度可配

L3 校准闭环（品类级护城河，OpenAI/Gemini 都没有） ← 长线，复用 scheduler + s12 + 向量记忆
   预测留痕(新表) → 到期回扫裁决(scheduler) → Brier 打分 → s12 反哺下次 Leader 规划
```

设计映射到配方：L1 覆盖步骤 1/4/5；L2 覆盖步骤 2/3/6；L3 覆盖步骤 7/8。

---

## 3. L1 —— 前瞻产出（快赢）

### 3.1 数据契约：s6 Analyst 新增 `foresight` 块

落在 `analyst.agent.ts` 的 zod `Output`（与现有字段平级），把 tradecraft 编码进 schema：

```typescript
foresight: z.object({
  // 步骤1/4 基准判断：可证伪 + 数字概率 + 置信度分离(ICD-203)
  baseCase: z.array(z.object({
    judgment: z.string(),                                  // 未来判断
    probability: z.number().min(0).max(1),                 // 事件发生概率（数字，非高/中/低）
    confidence: z.enum(["low", "moderate", "high"]),       // 对该判断的信心（与概率分离）
    horizon: z.enum(["0-6m", "6-18m", "18m-3y", "3y+"]),
    resolutionCriteria: z.string(),                        // 裁决标准（可证伪）
    baseRate: z.string().optional(),                       // 参照类基准率（外部视角）
    evidenceIds: z.array(z.string()),                      // 引用 reconciler factTable
  })).min(1),
  // 步骤5 情景分叉
  scenarios: z.array(z.object({
    kind: z.enum(["bull", "base", "bear"]),
    narrative: z.string(),
    trigger: z.string(),                                   // 触发条件
    probability: z.number().min(0).max(1),
  })),
  predeterminedElements: z.array(z.string()),              // 近乎必然（无论哪个情景）
  criticalUncertainties: z.array(z.string()),              // 关键不确定性 = 分叉点
  // 情报路标：让判断可跟踪、可证伪
  leadingIndicators: z.array(z.object({
    signal: z.string(),
    watchFor: z.string(),                                  // 出现什么算应验/证伪
  })),
}).optional(),
```

> 说明：保留 `.optional()`，沿用 s6 现有"双轮防 null + 空兜底"机制——foresight 缺失时报告退化但不崩。

### 3.2 阶段与渲染改动（精确文件）

| 文件                                                                    | 改动                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `mission/agents/analyst/analyst.agent.ts`                               | Output 加 `foresight`；systemPrompt 增前瞻写作指导（强制外部视角/概率/裁决标准/反指标）      |
| `mission/pipeline/stages/s6-analyst-synthesize-insights.stage.ts`       | `AnalystOutputShape` 接口补 `foresight`；空兜底对象补 `foresight: undefined`                 |
| `mission/artifacts/util/segment-extractors.util.ts`                     | 接口 + `quickViewData` 透传 `foresight`                                                      |
| `ai-harness/.../report-artifact/report-segments.dto.ts`                 | `quickViewData` 加 `foresight`                                                               |
| `ai-harness/.../report-artifact/report-artifact.dto.ts`                 | `ArtifactQuickView` 加 `foresight`（含 baseCase/scenarios/leadingIndicators）                |
| `ai-harness/.../report-artifact/structural-report-assembler.service.ts` | `buildQuickView()` 派生前瞻卡片（baseCase 概率条 / 情景三分支 / 信号清单）                   |
| `mission/agents/writer/single-shot-writer.agent.ts`                     | Input 加 foresight；`buildOutlineGuidance` 固定追加最后一章 **Outlook**，注入 foresight 内容 |
| `mission/pipeline/stages/s8-writer-draft-report.stage.ts`               | invoke 时把 `analystOutput.foresight` 传入 Writer Input                                      |
| 前端 `components/agent-playground/artifact/*` quickView 区块            | 新增"未来推演"卡片：base case 概率条、bull/base/bear、信号 watchlist、反指标                 |

### 3.3 验证标准（强成功标准）

- s6 输出含 `foresight.baseCase ≥ 1`，每条带 `probability ∈ [0,1]` + `resolutionCriteria` 非空
- 报告固定出现 "Outlook" 章节，正文引用 foresight 判断且带 `[N]` 证据角标
- 前端 quickView 渲染未来推演卡片；foresight 缺失时不渲染该卡片（不报错）
- `npm run verify:changed` 全绿；架构边界 `npm run verify:arch` 不退化

---

## 4. L2 —— 严谨化（中档）

### 4.1 Reconciler(s5) 扩 ACH 竞争性假设分析

复用 Reconciler 已有"跨维度对账 + conflicts"能力，让它对**未来假设**也列举 + 找证伪证据。

`reconciler.agent.ts` Output 增：

```typescript
alternativeHypotheses: z.array(z.object({
  id: z.string(),
  statement: z.string().min(20),                          // "若 X，则 Y" 因果陈述
  likelihood: z.enum(["low", "medium", "high"]),
  refutingEvidence: z.array(z.object({                    // 主动找证伪（ACH 核心）
    claim: z.string(),
    source: z.string(),
    strength: z.enum(["weak", "moderate", "strong"]),
  })).min(1),
  status: z.enum(["plausible", "unlikely", "refuted"]),
})).default([]),
```

改动：`reconciler.agent.ts`(schema + prompt + `validateBusinessRules` 校验每假设≥1证伪)、
`s5-...stage.ts`(emit `reconciliation:ach-generated` + narrate 条数)、对应 SKILL duty。
s6 Analyst 的 foresight 应消费 `alternativeHypotheses`（已证伪的假设不进 baseCase）。

### 4.2 新增 s9c —— Forecast 红队（事前验尸）

挂在 s9b（客观评审）后、s10（Leader 署名）前，独立 stage，与 s9 Critic 区分（Critic 评当下质量；红队评未来脆性）。

新增 `mission/agents/reviewer/forecast-red-team.agent.ts`：

```typescript
const Output = z
  .object({
    vulnerabilities: z
      .array(
        z.object({
          statement: z.string(), // foresight 里的核心假设
          failureScenario: z.string(), // "若…则该判断崩塌"
          timeHorizon: z.enum(["6m", "12m", "2y"]),
          likelihood: z.number().min(0).max(1),
          impactIfFails: z.enum(["minor", "moderate", "critical"]),
        }),
      )
      .default([]),
    couldBeWrongIf: z.array(z.string()).default([]), // 反指标
    overallRobustness: z.number().min(0).max(100),
    rationale: z.string().min(50),
  })
  .optional();
```

改动：新建 agent + `reviewer.service.ts` 加 `forecastRedTeam()` + 新建 `s9c-forecast-red-team.stage.ts`

- pipeline bindings 在 s9b 后插入 s9c + `mission-context.ts` 加 `reportRedTeamVerdict?`。
  红队结果写入 `reportArtifact.quality.warnings`，并把 `couldBeWrongIf` 回灌 Outlook 章节的"判断可能错在哪"小节。
  触发可与现有 `auditLayers`（thorough/thorough+）对齐，避免低档 mission 增加成本。

### 4.3 评分维度可配化

`report-evaluation.service.ts` 的 `evaluateReport()` 增 `customDimensions?` 参数（默认沿用现有 6 轴），
为 forecast 类 mission 提供"假设有效性 / 未来韧性"评分集。

### 4.4 验证标准

- 单维度 mission 时 ACH/红队短路跳过（沿用 reconciler 单维短路约定），不报错
- foresight.baseCase 不得包含 reconciler 标记为 `refuted` 的假设（spec 断言）
- s9c 产出 `overallRobustness` 且 `couldBeWrongIf` 出现在报告 Outlook 章节
- 新 stage 不破坏 rerun / DAG（DAG 视图能渲染 s9c 节点）

---

## 5. L3 —— 校准闭环（护城河）

### 5.1 预测留痕（新表，非 JSON 字段）

新增 Prisma model `AgentPlaygroundPredictionRecord`（手写 migration）：

```prisma
model AgentPlaygroundPredictionRecord {
  id                 String                 @id @default(uuid())
  missionId          String                 @map("mission_id")
  mission            AgentPlaygroundMission @relation(fields: [missionId], references: [id], onDelete: Cascade)
  userId             String                 @map("user_id")
  predictionText     String                 @db.Text
  probability        Float
  confidence         String                                  // low/moderate/high
  horizon            String
  targetDate         DateTime               @map("target_date")
  resolutionCriteria String                 @db.Text
  actualOutcome      Boolean?               @map("actual_outcome")     // 裁决后填
  outcomeEvidenceUrl String?                @map("outcome_evidence_url")
  judgmentAt         DateTime?              @map("judgment_at")
  brierScore         Float?                 @map("brier_score")        // (probability - actual)^2
  context            Json?                                            // {topic, dimension, section}
  createdAt          DateTime               @default(now()) @map("created_at")
  updatedAt          DateTime               @updatedAt @map("updated_at")
  @@index([userId, targetDate])
  @@index([missionId])
  @@map("agent_playground_prediction_records")
}
```

理由：独立表支持"到期 targetDate"索引查询、时间序列校准聚合、按 user/topic/model 维度分析；JSON 字段做不到。

### 5.2 留痕 → 到期裁决 → 打分 → 反哺

```
s12-self-evolution（已有向量 postmortem 沉淀）
  └─ 新增：把本次 foresight.baseCase 落 AgentPlaygroundPredictionRecord（actualOutcome=null）

PredictionRecalibrationScheduler（新建，仿 explore/radar scheduler，@Cron 每 6h）
  └─ 查 targetDate<=now 且 actualOutcome=null 的预测（分批、并发限流、单 pod 守门）
  └─ CalibratorAgent 裁决（web 检索/引用核验，沿用 verifier 的 citation 能力）
  └─ 回填 actualOutcome + brierScore + judgmentAt

s12 / Leader S1（复用 harness_vector_memory + consolidation）
  └─ 聚合该 topic 历史 Brier → 写校准记忆 → 下次同 topic Leader 规划时 RAG 召回，
     调 foresight 概率的保守度（系统老高估则收敛）
```

改动文件：`models.prisma` + 新 migration、`prediction-recalibration.scheduler.ts`(新)、
`calibrator.agent.ts`(新)、`mission-store.service.ts`(加 `recordPrediction/getExpiredPredictions/recordCalibration`)、
`s12-self-evolution.stage.ts`(留痕 + 反哺)、`agent-playground.module.ts`(注册 scheduler + `ScheduleModule`)。

### 5.3 关键决策点（裁决可靠性）

自动裁决未来事件不可能 100% 可靠。两条路：

- **A 全自动**：CalibratorAgent 用 web 检索 + LLM 判定 outcome。覆盖广、零人工，但有误判风险 → 必须记 `outcomeEvidenceUrl` 供回溯，低置信裁决标记 `needs-review`。
- **B 人工/半自动**：到期预测进一个"待裁决"队列，前端给用户/运营确认。准但有运营成本。

建议 A 为主、低置信进 B 队列（混合）。

### 5.4 验证标准

- 新表 migration 用手写 SQL（禁 `prisma migrate dev`、禁 `DO $$ EXCEPTION` 包 ALTER）
- s12 对每条 signed mission 的 baseCase 落库，`targetDate` 正确（horizon 映射）
- scheduler 守门：单 pod 不重复裁决同一预测；分批上限；fire-and-forget 不阻塞
- Brier 计算正确：`(probability - (actual?1:0))^2`；产品页可展示"历史校准曲线"

---

## 6. 风险与权衡

| 风险                                    | 缓解                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| foresight 增大 s6 输出 → token/成本上升 | foresight 与红队按 `auditLayers`/`depth` 分档启用；quick 档可关                           |
| LLM 概率不校准（爱给 70%）              | L3 Brier 反哺收敛；prompt 强制外部视角/基准率先行                                         |
| 自动裁决误判                            | 强制记证据 URL；低置信进人工队列；Brier 只在已裁决样本上算                                |
| 改动面大                                | 三层解耦、互不阻塞，可单独上线；L1 即有用户价值                                           |
| 架构边界                                | 全部落在 ai-app/agent-playground 与既有 ai-harness 评审/记忆设施，走 facade，不新增模块层 |

## 7. 落地节奏（每阶段独立可交付、可验证）

1. **L1 前瞻产出**（最高优先，用户立即可感）→ verify: 报告出 Outlook 章节 + 前端卡片 + 类型/边界测试绿
2. **L2 严谨化**（ACH + 红队 + 可配评分）→ verify: 已证伪假设不进 baseCase + s9c 产出韧性分 + DAG/rerun 不破
3. **L3 校准闭环**（留痕 + scheduler + Brier + 反哺）→ verify: migration 部署 + 裁决回填 + Brier 正确 + 校准曲线可展示

---

## 附：本方案依据的实际代码勘察（已读文件）

- s6：`mission/pipeline/stages/s6-analyst-synthesize-insights.stage.ts`、`mission/roles/analyst.service.ts`、`mission/agents/analyst/analyst.agent.ts`
- 产出链：`mission/agents/writer/single-shot-writer.agent.ts`、`mission-outline-planner.agent.ts`、`s7/s8 stage`、`segment-extractors.util.ts`、`structural-report-assembler.service.ts`
- 评审/对账：`reconciler.{service,agent}.ts` + `s5`、`reviewer/verifier.service.ts` + agents + `s9/s9b`、`report-evaluation.service.ts`
- 闭环：`s12-self-evolution.stage.ts`、`models.prisma`(AgentPlaygroundMission)、`explore/.../resource-health-check.scheduler.ts`、`radar/.../radar-refresh.scheduler.ts`、`ai-harness/memory/consolidation/memory-consolidation.service.ts`、`mission-store.service.ts`
