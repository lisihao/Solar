# 迭代研究功能 - 用户旅程分析与改进方案

> 产品经理深度分析报告
> 日期: 2026-03-11
> 状态: 草稿

---

## 一、完整用户旅程图

### 1.1 用户发起迭代研究

```
用户操作: 在研究项目中输入查询 → 选择"迭代模式" → 点击开始

前端流程:
  ResearchProjectLayout.handleStartResearch(query, 'iterative')
  → useIterativeResearch.startResearch(query, { mode: 'iterative' })
  → fetch POST /ai-studio/projects/{id}/deep-research/stream (SSE)
  → 前端切换到 discussion tab

后端流程:
  DiscussionController.startResearchStream()
  → IterativeResearchService.startResearch(projectId, dto)
  → mode=iterative → runIterativeLoop() (异步启动)
  → 返回 Observable, controller 通过 SSE 推送事件

用户看到: 讨论面板开始显示 AI Agent 对话，搜索进度条
```

### 1.2 Round 0 (初始研究) 执行中

```
后端流程:
  runIterativeLoop() → runInnerResearch()
  → DiscussionOrchestratorService.startResearch()
  → 4 阶段: Ideation → Execution(搜索) → Findings → Synthesis(报告生成)

SSE 事件流 (→ 前端):
  discussion.phase → discussion.message → search_progress → content.delta
  → interaction.complete (报告完成)

后处理:
  → classifyTopic() (话题分类)
  → extractIdeas() (提取洞察, 存入 DB)
  → emit iteration.session (sessionId)
  → emit iteration.research (round 0 搜索数据)
  → createAndPollDemo() (生成 Demo, 轮询 DB 等待完成, 最多 120s)
  → evaluateDemo() 或 estimateReportQuality() (评分)
  → emit iteration.eval (分数 + gaps)
  → saveIterationSnapshot() (持久化到 DB)
  → emit iteration.awaiting_feedback (等待用户反馈, 30s)
  → waitForFeedback() (Promise + 30s 超时)

用户看到:
  - Discussion tab: Agent 对话流, 搜索进度
  - Iterations tab: 收到 eval 事件后出现 Round 0 卡片 (数据/认知/质量三层)
  - 出现反馈输入框 (30s 倒计时)
```

### 1.3 Round 1+ (迭代轮次)

```
触发条件:
  exitDecisionService.decide() 返回 { exit: false }
  (Round 1 之前强制不退出，即使满足其他条件)

后端流程 (for 循环 round=1..maxIterations):
  1. 检查退出条件 → 不退出则继续
  2. emit iteration.start
  3. buildFollowUpQuery() (基于 gaps + 用户反馈构建追加查询)
  4. runInnerResearch() (新一轮完整研究)
     → 创建新 session → 搜索 → 生成报告 → interaction.complete
  5. extractIdeas() (从新 session 提取)
  6. createAndPollDemo() (生成新 Demo)
  7. evaluateDemo() (重新评分)
  8. 合并数据到原始 session:
     - 报告覆盖更新
     - 讨论消息追加合并
     - Ideas 迁移到原始 session
     - 删除中间 session
  9. emit iteration.eval
  10. saveIterationSnapshot() (持久化)
  11. emit iteration.awaiting_feedback (等反馈)
  12. waitForFeedback() (30s)

用户看到:
  - Discussion tab: 新一轮 Agent 对话流追加
  - Iterations tab: 新 Round 卡片出现
  - 反馈输入框 (每轮间)
```

### 1.4 收敛/退出条件

```
ExitDecisionService.decide() 判断逻辑 (按优先级):

1. budget_exhausted: round >= MAX_ITERATIONS[depth]
   (quick=2, standard=4, thorough=6)
2. quality_met: latestScore >= QUALITY_THRESHOLD[depth]
   (quick=0.6, standard=0.75, thorough=0.85) — 需 round > 1
3. no_gaps: dataGaps=0 && ideaGaps=0 && score >= 0.3 — 需 round > 1
4. information_saturated: informationGain < 0.05 — 需 round > 1
5. converged: 连续2轮 delta < 0.05 && score >= 0.3 — 需 >= 3 轮分数

特殊: round 失败 → exitDecision = { exit: true, reason: "budget_exhausted" }

用户感知:
  - 当前: 退出条件仅在 iteration.exit 事件中以 reason 字段呈现
  - 前端翻译: formatExitReason() 将 reason 映射为中文
  - 问题: 用户无法预知何时退出，缺乏进度预期
```

### 1.5 研究完成

```
后端流程:
  → generateSummaryRecord() (总结 Markdown)
  → saveIterationMetadata() (保存所有 Markdown 到 session.directions.iterationRecords)
  → saveIterationMeta() (保存退出原因/最终分数到 session.directions.iterationMeta)
  → session.status = COMPLETED
  → memoryService.saveSessionMeta() (fire-and-forget)
  → emit iteration.exit

前端流程:
  useIterativeResearch 收到 iteration.exit:
  → phase = 'completed'
  → 触发 onComplete callback
  → ResearchProjectLayout:
    - 创建 newSession 对象
    - setSessions / setViewingSession
    - setActiveTab('report')
    - extractInsights() → extractCreativeIdeas() (自动提取)
    - reloadSessions() (从 API 刷新)
```

---

## 二、用户反馈问题逐一分析

### 问题 1: 第二轮开始各种异常（异常终止、异常显示）

#### 根因分析

**根因 A: SSE 连接断开导致后端研究被终止**

- 文件: `discussion.controller.ts:136-142`
- 问题: `res.on("close")` 中调用了 `subscription.unsubscribe()`，这意味着当 SSE 连接因为网络抖动、代理超时（Railway/Cloudflare 60s idle timeout）断开时，整个研究 Observable 被取消订阅。
- 然而 `runIterativeLoop()` 是一个异步 Promise，它通过 `Subject` 推送事件。当 `subscription.unsubscribe()` 被调用时：
  - Subject 的 subscriber 被移除
  - 但 `runIterativeLoop()` 中的 `await` 链仍在运行
  - `subject.next()` 调用会被静默丢弃（没有 subscriber）
  - 关键问题: `runInnerResearch()` 内部也订阅了 orchestrator 的 Observable，当外层 subscription 被取消，**内层研究的 SSE 事件流也停止了**
- 影响: 迭代研究的每一轮（Round 1+）都涉及新的 `runInnerResearch()`，连接断开后内层 Observable 的订阅也断了，导致 Promise reject → catch 块触发 → 研究提前终止

**根因 B: 中间 session 删除导致数据丢失竞态**

- 文件: `iterative-research.service.ts:640-654`
- 问题: 每轮迭代创建新 session → 合并到原始 session → 删除中间 session。这个过程中如果合并失败（DB 写入超时），中间 session 被删除后数据丢失
- catch 块 (655-659) 仅 warn 不重试，后续轮次基于不完整数据继续

**根因 C: Demo 生成超时阻塞迭代进度**

- 文件: `iterative-research.service.ts:1003-1039`
- 问题: `pollDemoCompletion()` 每 3s 轮询一次，最多等 120s。在 Demo 生成 LLM 调用缓慢时，一轮迭代的 Demo 等待可能耗时 2 分钟，导致后续轮次被延迟，总耗时过长触发 30 分钟超时

#### 涉及文件

- `backend/.../discussion/discussion.controller.ts:136-142` (SSE close handler)
- `backend/.../iteration/iterative-research.service.ts:640-654` (session 合并)
- `backend/.../iteration/iterative-research.service.ts:1003-1039` (Demo 轮询)

---

### 问题 2: 迭代没有达到轮次就提前结束

#### 根因分析

**根因 A: information_saturated 过早触发**

- 文件: `evaluation/exit-decision.service.ts:82-84`
- 问题: `informationGain < 0.05` 时退出。informationGain 计算方式是 `newSources / prevTotalSources` (iterative-research.service.ts:484)
- 当 Round 0 已收集大量 sources（如 30+），Round 1 只找到 1-2 个新 source，informationGain = 1/30 = 0.033 < 0.05，触发 information_saturated
- 但 informationGain 低不意味着研究不需要深入——可能是搜索查询需要调整，而非信息已饱和

**根因 B: 分数虚高导致 quality_met 过早触发**

- 文件: `iterative-research.service.ts:1260-1331` (estimateReportQuality)
- 问题: 当 Demo 生成失败（demoAvailable=false），使用 estimateReportQuality 作为 fallback。这个启发式评分基于报告结构而非内容质量，容易给出虚高分数
- 例如: 5 个 section + 20 个 refs + 10K chars = sectionScore=1 + refScore=1 + depthScore=1 → baseScore 很高 → 轻易超过 0.75 阈值

**根因 C: Round 失败静默退出**

- 文件: `iterative-research.service.ts:765-793`
- 问题: 任何一轮 catch 到异常，exitDecision 被强制设为 `{ exit: true, reason: "budget_exhausted" }`，然后 break。用户看到的退出原因是"达到最大迭代次数"，实际是出错了
- 这掩盖了真实原因（如 LLM 调用失败、DB 写入超时），用户无法判断是正常退出还是异常

#### 涉及文件

- `backend/.../evaluation/exit-decision.service.ts:82-84`
- `backend/.../iteration/iterative-research.service.ts:1260-1331`
- `backend/.../iteration/iterative-research.service.ts:765-793`

---

### 问题 3: 迭代过程中，观点/创意/Demo 页面不自动更新

#### 根因分析

**根因: 前端 Ideas/Demos hooks 没有实时更新机制**

- 文件: `frontend/hooks/features/useResearchIdeas.ts`
- 问题: `useResearchIdeas` 只在挂载时 fetchIdeas 一次 (line 232-237)，**没有轮询，没有 WebSocket，没有 SSE 事件驱动**
- 后端在迭代过程中通过 `extractIdeas()` 写入 DB (iterative-research.service.ts:227, 498)，但前端永远不知道
- Demo hook (`useResearchDemos.ts`) 虽有轮询（line 159-172），但只在有 PENDING/GENERATING demo 时才启动轮询，初始没有 demo 时不会轮询

**数据流断裂点:**

```
后端 extractIdeas() → DB 写入 ✓
            ↓
前端 useResearchIdeas → mount 时 fetch 一次 → 不再更新 ✗
```

- Insights tab: 只显示 mount 时从 API 获取的旧数据
- Ideas tab: 同上，且 extractCreativeIdeas 只在 onComplete 回调中触发（研究全部结束后）
- Demos tab: 迭代中 Demo 由后端 `createAndPollDemo()` 创建，前端不知道新 Demo 存在

#### 涉及文件

- `frontend/hooks/features/useResearchIdeas.ts:232-237` (仅 mount 时 fetch)
- `frontend/hooks/features/useResearchDemos.ts:143-148` (仅 mount 时 fetch)
- `frontend/components/ai-research/ResearchProjectLayout.tsx:164-167` (仅 onComplete 时提取)

---

### 问题 4: 退出再进入才能看部分信息，创意始终空

#### 根因分析

**根因 A: 创意提取仅在 onComplete 回调中触发**

- 文件: `ResearchProjectLayout.tsx:164-167`

```typescript
// onComplete 回调中:
void extractInsights(sessionId)
  .then(() => extractCreativeIdeas())
  .catch((err) => logger.error("Auto-extract failed:", err));
```

- 问题: `extractCreativeIdeas()` 是在 `extractInsights()` 成功后才调用（链式 .then）
- 如果 `extractInsights()` 失败或研究异常终止，`extractCreativeIdeas()` 永远不会被调用
- 并且迭代过程中不会触发——只有最终完成时触发一次

**根因 B: 后端 extractIdeas 与 extractCreativeIdeas 是两个独立流程**

- `extractFromSession()` (research-idea.service.ts:131-213): 从 session discussion 中提取 INSIGHT 类型
- `extractCreativeIdeas()` (research-idea.service.ts:411+): 基于已有 INSIGHTs 生成 CREATIVE_IDEA 类型
- 迭代中后端的 `this.extractIdeas()` (iterative-research.service.ts:1056-1074) 调用的是 `ideaService.extractFromSession()`，它只提取 INSIGHT 类型
- **CREATIVE_IDEA 在整个迭代过程中从未被后端自动提取**

**根因 C: 退出再进入时数据部分恢复**

- 重新进入页面 → `useResearchIdeas` mount → fetchIdeas() → 获取 DB 中已有的 insights
- 但 creative ideas 如果从未被提取过，DB 中没有，所以始终为空
- Demo 数据在 DB 中（由后端 createAndPollDemo 创建），重新进入后通过 fetchDemos 可以看到

#### 涉及文件

- `frontend/components/ai-research/ResearchProjectLayout.tsx:164-167`
- `backend/.../idea/research-idea.service.ts:131-213` (extractFromSession)
- `backend/.../iteration/iterative-research.service.ts:1056-1074` (extractIdeas)

---

### 问题 5: 收敛和退出条件不清晰

#### 根因分析

**根因: 退出条件对用户不透明**

- 后端 `ExitDecisionService` 有5种退出原因，但前端只在最终 `iteration.exit` 事件中展示一次
- 迭代过程中用户看不到:
  - 当前距离退出还有多远
  - 分数需要达到多少才能"质量达标"
  - 信息增益下降到什么程度会"饱和退出"
  - 还剩多少轮次

- 前端 `IterationTimeline` 的进度指示器 (line 879-882):

  ```
  进度 {iterations.length}/{maxIterations + 1}
  ```

  - maxIterations 硬编码为 4 (ResearchProjectLayout.tsx:882)，不反映实际深度设置
  - 不展示退出条件达成进度（如分数 vs 阈值）

**信息缺失清单:**

1. 质量阈值（threshold）不展示给用户
2. 当前信息增益趋势不可见
3. 收敛判定（连续2轮 delta < 5%）不可见
4. 退出原因为 "budget_exhausted" 但实际可能是异常（问题2根因C）

#### 涉及文件

- `backend/.../evaluation/exit-decision.service.ts` (退出逻辑)
- `frontend/.../iteration/IterationTimeline.tsx:879-882` (进度展示)
- `frontend/.../ResearchProjectLayout.tsx:882` (maxIterations 硬编码)

---

### 问题 6: 工程/流程/架构/DFX 问题

#### 6.1 SSE 连接脆弱性 (可靠性)

- `discussion.controller.ts:136-142`: 客户端断开 → unsubscribe → 研究中断
- 没有断线重连机制：前端的 `onStreamEndIncomplete` 回调启动了 10s 轮询（最多 90 次），但：
  - 只检查 session 是否 COMPLETED，不检查是否还在运行
  - 如果后端还在运行但连接断了，前端无法重新连接 SSE 流
  - 轮询只找 "COMPLETED" session，而迭代中的 session 是 "SEARCHING" 状态

#### 6.2 数据持久化时序风险 (数据完整性)

- 迭代过程中的数据通过 JSONB 字段 (`directions`) 存储快照
- 每轮快照保存需要: 读取 → 合并 → 写回，没有乐观锁或 CAS
- 如果两个异步操作同时写 `directions`，后写的会覆盖先写的
- `saveIterationSnapshot` 和 `saveIterationMetadata` 之间有竞态可能

#### 6.3 内存泄漏风险

- `feedbackResolvers` Map (iterative-research.service.ts:103-109): 如果研究异常终止，cleanup 代码在 line 884-889 可能不被执行（如 Promise reject 未被 catch）
- 不过当前代码在 884-889 有清理，且外层 `.catch()` 在 137-151 中 complete() subject，这部分还算健壮

#### 6.4 @Optional() 依赖导致的静默降级

- `iterative-research.service.ts:113-122`: 核心服务如 `TopicClassifierService`, `DemoEvaluatorService`, `ExitDecisionService` 都是 @Optional()
- 当这些服务不可用时（如 module 未正确注入），行为静默降级:
  - 无 topicClassifier → 默认 "market"
  - 无 demoEvaluator → fallback 分数 0.5
  - 无 exitDecisionService → 仅靠 `round >= maxIterations` 退出
- 生产环境如果模块加载顺序问题导致注入失败，整个评分和退出系统失效

---

## 三、系统性改进方案

### P0 - 紧急修复（影响可用性）

#### P0-1: SSE 断线不应终止后端研究

**问题**: 客户端 SSE 断开后 `subscription.unsubscribe()` 终止整个研究流程

**方案**:

- 后端: `res.on("close")` 中仅标记 `connectionOpen = false`，不调用 `subscription.unsubscribe()`
- 后端: `runIterativeLoop` 改为检查 `subject.observed`，未被订阅时跳过 `subject.next()` 但继续执行
- 前端: 断线后通过轮询 API 获取最新 session 状态和数据
- 替代: 将研究 Observable 与 SSE 连接解耦——研究始终在后台完成，SSE 只是"旁观者"

**涉及文件**:

- `backend/.../discussion/discussion.controller.ts` (close handler)
- `backend/.../iteration/iterative-research.service.ts` (subject 写入保护)

**工作量**: 后端 1d, 前端 0.5d

---

#### P0-2: 迭代中实时同步 Ideas/Demos 到前端

**问题**: 前端 Ideas/Demos 在迭代过程中不更新

**方案 A (快速修复 - 轮询)**:

- 前端: 在迭代进行中（isIterating=true），启动 Ideas/Demos 定时轮询（每 15s fetchIdeas + fetchDemos）
- 在 ResearchProjectLayout 中添加 useEffect 监听 isIterating

**方案 B (SSE 驱动 - 推荐)**:

- 后端: 在 `iteration.ideas` 事件中携带完整的 idea list（不仅是标题）
- 后端: 每轮 Demo 完成后发送新的 SSE 事件 `iteration.demos_updated`
- 前端: 收到这些事件后触发 fetchIdeas/fetchDemos 刷新

**方案 C (长期 - WebSocket)**:

- 利用现有 WebSocket 基础设施推送研究状态变更通知

**推荐**: 先做方案 A（0.5d），后续演进到方案 B（1d）

**涉及文件**:

- `frontend/hooks/features/useResearchIdeas.ts` (添加轮询)
- `frontend/hooks/features/useResearchDemos.ts` (添加轮询)
- `frontend/components/ai-research/ResearchProjectLayout.tsx` (协调)

**工作量**: 方案 A 0.5d, 方案 B 1.5d

---

#### P0-3: 创意(Creative Ideas)自动提取

**问题**: 创意在整个迭代过程中从未被自动提取

**方案**:

- 后端: 在 `runIterativeLoop()` 的每轮结束后（eval 之后），自动调用 `extractCreativeIdeas()`
- 或者: 在 Round 0 完成后以及每轮结束后，都触发一次完整的 insights + creative ideas 提取
- 前端: onComplete 中的 extractCreativeIdeas() 改为并行调用而非链式（避免 insights 失败阻塞 creative）

**涉及文件**:

- `backend/.../iteration/iterative-research.service.ts` (添加 extractCreativeIdeas 调用)
- `frontend/.../ResearchProjectLayout.tsx:164-167` (改为 Promise.allSettled)

**工作量**: 后端 0.5d, 前端 0.5d

---

#### P0-4: 异常退出应使用真实原因而非 "budget_exhausted"

**问题**: 轮次异常被伪装为"达到最大迭代次数"

**方案**:

- 新增退出原因: `"round_error"`
- catch 块中: `exitDecision = { exit: true, reason: "round_error" }`
- 前端: `formatExitReason` 添加 `round_error: '研究轮次执行异常'`
- 附带错误信息传递到前端（在 iteration.exit 事件的 data 中增加 errorMessage 字段）

**涉及文件**:

- `backend/.../evaluation/exit-decision.service.ts` (新增 reason 类型)
- `backend/.../iteration/iterative-research.service.ts:777` (使用真实 reason)
- `backend/.../iteration/types.ts` (IterationExitEvent 增加 errorMessage)
- `frontend/.../iteration/IterationTimeline.tsx:68` (formatExitReason)

**工作量**: 0.5d

---

### P1 - 重要改进（影响用户体验）

#### P1-1: 退出条件透明化

**问题**: 用户不知道研究何时会结束、为什么结束

**方案**:

- 后端: 在 `iteration.eval` 事件中增加退出预测信息:
  ```json
  {
    "exitPrediction": {
      "qualityProgress": 65, // 当前分数占阈值的百分比
      "qualityThreshold": 75, // 阈值
      "remainingRounds": 3, // 剩余可用轮次
      "saturationTrend": "declining", // 信息增益趋势
      "convergenceWarning": false // 是否接近收敛
    }
  }
  ```
- 前端: IterationTimeline 中显示质量进度条（当前分数 vs 阈值）
- 前端: 显示剩余轮次
- 前端: 退出原因使用更友好的文案 + 详细解释

**涉及文件**:

- `backend/.../iteration/iterative-research.service.ts` (eval 事件增加字段)
- `backend/.../iteration/types.ts` (IterationEvalEvent 增加字段)
- `frontend/.../iteration/IterationTimeline.tsx` (新增进度展示组件)
- `frontend/hooks/features/useIterativeResearch.ts` (处理新字段)

**工作量**: 后端 0.5d, 前端 1.5d

---

#### P1-2: information_saturated 退出条件优化

**问题**: 低信息增益不等于研究饱和

**方案**:

- 修改 informationGain 计算: 不仅看 source 数量，还考虑内容覆盖度变化
- 或者: 将 SATURATION_GAIN_THRESHOLD 从 0.05 提高到 0.02
- 或者: 要求连续 2 轮信息增益低于阈值才判定为饱和（类似 convergence 判定）
- 推荐: 连续 2 轮 + 阈值提高到 0.03

**涉及文件**:

- `backend/.../evaluation/exit-decision.service.ts:82-84`

**工作量**: 0.5d

---

#### P1-3: estimateReportQuality 分数校准

**问题**: 报告结构评分虚高导致 quality_met 提前退出

**方案**:

- 降低各维度满分阈值（如 10+ sections 才满分、50+ refs 才满分）
- 增加内容质量维度（如段落平均长度、引用密度）
- 添加跨轮次对比惩罚（如果报告内容与上一轮高度重叠，降低分数）
- 或: 当使用 fallback 评分时，ceiling 设为 0.6（永远不触发 quality_met）

**涉及文件**:

- `backend/.../iteration/iterative-research.service.ts:1260-1331`

**工作量**: 0.5d

---

#### P1-4: maxIterations 前端参数化

**问题**: 前端 maxIterations 硬编码为 4

**方案**:

- 从 `iteration.session` 或新的 `iteration.config` 事件中传递实际 maxIterations
- IterationTimeline 使用真实值显示进度
- 允许用户在启动时选择深度（quick/standard/thorough），前端展示对应的 maxIterations

**涉及文件**:

- `frontend/.../ResearchProjectLayout.tsx:882`
- `backend/.../iteration/iterative-research.service.ts` (添加 config 事件)

**工作量**: 0.5d

---

### P2 - 体验改善

#### P2-1: 迭代过程中 Tab 数据实时指示

**问题**: 用户不知道哪个 Tab 有新数据

**方案**:

- 已有 tabBadges 机制（ResearchProjectLayout.tsx:89-91, 344-354）
- 增强: 在 ideas badge 中显示数量变化（如 "+3"）
- 增强: demos badge 在 demo 完成时显示

**工作量**: 0.5d

---

#### P2-2: 历史迭代 session 查看体验

**问题**: 切换到历史 session 时 Iteration tab 数据可能不显示

**方案**:

- 已有 Priority 1/2/3 的查看逻辑 (ResearchProjectLayout.tsx:873-972)
- 需要确保 viewingSession 切换时，Iteration tab 能正确从 session.directions 恢复
- 添加: 从历史 session 恢复时也显示 Ideas/Demos 关联数据

**工作量**: 0.5d

---

#### P2-3: Demo 生成超时优化

**问题**: Demo 轮询 120s 阻塞迭代进度

**方案**:

- Demo 生成改为非阻塞: 启动后不等待完成，继续下一步评分
- 评分使用 estimateReportQuality（无 Demo 场景的 fallback）
- Demo 生成完成后异步更新快照
- 或: 降低轮询超时到 60s

**工作量**: 1d

---

#### P2-4: 错误恢复增强

**问题**: 研究中断后无法恢复

**方案**:

- 后端: 支持从已有 session 的最后一个快照恢复迭代
- 前端: 提供"继续研究"按钮（当 session 状态为 SEARCHING 且有快照时）
- 利用 `directions.iterationSnapshots` 恢复已有进度

**工作量**: 后端 2d, 前端 1d

---

## 四、优先级排序总结

| ID   | 问题                      | 优先级 | 前端 | 后端 | 总工作量 |
| ---- | ------------------------- | ------ | ---- | ---- | -------- |
| P0-1 | SSE 断线终止研究          | P0     | 0.5d | 1d   | 1.5d     |
| P0-2 | Ideas/Demos 不实时更新    | P0     | 0.5d | 0d   | 0.5d     |
| P0-3 | Creative Ideas 不自动提取 | P0     | 0.5d | 0.5d | 1d       |
| P0-4 | 异常退出伪装为正常        | P0     | 0.5d | 0.5d | 1d       |
| P1-1 | 退出条件不透明            | P1     | 1.5d | 0.5d | 2d       |
| P1-2 | info_saturated 过早触发   | P1     | 0d   | 0.5d | 0.5d     |
| P1-3 | fallback 分数虚高         | P1     | 0d   | 0.5d | 0.5d     |
| P1-4 | maxIterations 硬编码      | P1     | 0.5d | 0d   | 0.5d     |
| P2-1 | Tab badge 增强            | P2     | 0.5d | 0d   | 0.5d     |
| P2-2 | 历史 session 查看         | P2     | 0.5d | 0d   | 0.5d     |
| P2-3 | Demo 超时优化             | P2     | 0d   | 1d   | 1d       |
| P2-4 | 错误恢复                  | P2     | 1d   | 2d   | 3d       |

**建议迭代计划**:

- Sprint 1 (4d): P0-1 + P0-2 + P0-3 + P0-4 — 解决"不可用"问题
- Sprint 2 (3.5d): P1-1 + P1-2 + P1-3 + P1-4 — 提升可理解性和可靠性
- Sprint 3 (5d): P2-1 + P2-2 + P2-3 + P2-4 — 体验优化

---

## 五、验收标准

### P0 验收标准

- [ ] 网络断线后研究继续在后台执行，重新进入页面可看到完整结果
- [ ] 迭代过程中切换到 Ideas/Demos tab 可看到实时新增的数据
- [ ] 迭代结束后 Creative Ideas tab 有数据（不为空）
- [ ] 异常终止时用户看到"研究执行异常"而非"达到最大迭代次数"

### P1 验收标准

- [ ] 迭代过程中可看到: 当前分数、目标分数、剩余轮次、退出条件预测
- [ ] standard 深度下至少执行 2 轮实际迭代才可能退出（非异常情况）
- [ ] fallback 评分不会导致 standard 深度在 Round 1 就 quality_met 退出

---

## 六、技术附录

### 关键文件索引

| 文件                                                              | 职责                                  |
| ----------------------------------------------------------------- | ------------------------------------- |
| `backend/.../iteration/iterative-research.service.ts`             | 迭代研究主流程（外层循环）            |
| `backend/.../iteration/iteration-record.service.ts`               | Markdown 记录生成                     |
| `backend/.../iteration/types.ts`                                  | 迭代 SSE 事件类型定义                 |
| `backend/.../evaluation/exit-decision.service.ts`                 | 退出条件判定                          |
| `backend/.../discussion/discussion-orchestrator.service.ts`       | 内层研究编排                          |
| `backend/.../discussion/discussion.controller.ts`                 | SSE 端点 + 反馈端点                   |
| `backend/.../idea/research-idea.service.ts`                       | Ideas 提取（INSIGHT + CREATIVE_IDEA） |
| `backend/.../demo/research-demo.service.ts`                       | Demo 生成                             |
| `frontend/hooks/features/useIterativeResearch.ts`                 | 迭代研究前端 hook                     |
| `frontend/hooks/features/useResearchIdeas.ts`                     | Ideas API hook                        |
| `frontend/hooks/features/useResearchDemos.ts`                     | Demos API hook                        |
| `frontend/components/ai-research/ResearchProjectLayout.tsx`       | 主布局 + Tab 管理                     |
| `frontend/components/ai-research/iteration/IterationTimeline.tsx` | 迭代时间线组件                        |
| `frontend/components/ai-research/types.ts`                        | 前端类型定义                          |

### 数据流图

```
[用户] → POST /stream → [DiscussionController]
                              ↓
                     [IterativeResearchService.startResearch()]
                              ↓
                     mode=iterative → runIterativeLoop()
                              ↓
                    ┌─── Round 0 ──────────────────────────────┐
                    │ runInnerResearch() → orchestrator         │
                    │ classifyTopic() → topicClassifier LLM     │
                    │ extractIdeas() → ideaService → DB         │
                    │ createAndPollDemo() → demoService → DB    │
                    │ evaluateDemo() / estimateReportQuality()  │
                    │ saveIterationSnapshot() → DB              │
                    │ waitForFeedback(30s)                       │
                    └──────────────────────────────────────────┘
                              ↓
                    ┌─── Round N (loop) ───────────────────────┐
                    │ exitDecisionService.decide()              │
                    │ buildFollowUpQuery(gaps + feedback)       │
                    │ runInnerResearch() → new session          │
                    │ extractIdeas() → from new session          │
                    │ createAndPollDemo()                        │
                    │ evaluateDemo()                             │
                    │ merge report + discussion → original       │
                    │ reassign ideas → original session          │
                    │ delete intermediate session                │
                    │ saveIterationSnapshot()                    │
                    │ waitForFeedback(30s)                       │
                    └──────────────────────────────────────────┘
                              ↓
                    ┌─── Summary ──────────────────────────────┐
                    │ generateSummaryRecord()                    │
                    │ saveIterationMetadata()                    │
                    │ saveIterationMeta()                        │
                    │ session.status = COMPLETED                 │
                    │ memoryService.saveSessionMeta()            │
                    │ emit iteration.exit                        │
                    └──────────────────────────────────────────┘
```
