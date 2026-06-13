# AI Team 长内容端到端处理方案

## 一、问题全景图

### 1.1 今天遇到的问题回顾

| 问题现象                | 根因                   | 影响范围    |
| ----------------------- | ---------------------- | ----------- |
| 任务分配不均（43 vs 8） | `#N` 后缀被错误移除    | 任务分配    |
| 成员匹配全部失败        | `AI-` 前缀被错误移除   | 任务创建    |
| 上下文溢出报错          | description 无长度管理 | Leader 规划 |
| 哑巴角色说话了          | 约束未传递给 Agent     | Agent 执行  |
| Leader 审核长内容溢出   | 审核内容无截断保护     | Leader 审核 |
| 审核结果误判            | 解析逻辑不够鲁棒       | Leader 审核 |
| 修改循环无限            | 退出条件不明确         | 任务修订    |

### 1.2 深层系统性问题

```
┌─────────────────────────────────────────────────────────────────┐
│                    用户输入 (可能 100K+ 字符)                     │
│  包含：任务描述、人物设定、世界观、约束条件、示例等                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ❌ 问题1: 全部塞入 description 字段
                            │    无结构化存储
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Leader 规划阶段                               │
│  buildLeaderPlanningPrompt()                                    │
│  ❌ 问题2: description 被截断到 8000 字符                        │
│  ❌ 问题3: 无 token 预算管理                                     │
│  ❌ 问题4: 成员名称匹配靠运气                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TaskBreakdown + ContextPackage               │
│  ❌ 问题5: ContextPackage 提取失败时无可靠降级                   │
│  ❌ 问题6: 部分任务因名称匹配失败被静默丢弃                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent 执行阶段                                │
│  buildAgentSystemPromptWithContext()                            │
│  ❌ 问题7: 约束信息可能不完整或缺失                              │
│  ❌ 问题8: mission.description 再次被截断                        │
│  ✅ 已有: SlidingWindowContext (但整合度不够)                    │
│  ✅ 已有: ContinuationProtocol (但触发条件可优化)                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    最终输出                                      │
│  ❌ 问题9: 无端到端的内容一致性校验                              │
│  ❌ 问题10: 质量监控未充分利用                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、核心设计理念

### 2.1 分层上下文管理

```
用户输入 (100K)
    │
    ├─── 结构化拆分 ────┬─── 核心约束 (MUST, 永不截断)
    │                   ├─── 实体定义 (按需检索)
    │                   ├─── 背景描述 (可压缩/摘要)
    │                   └─── 示例参考 (按需检索)
    │
    ▼
各阶段按需组装上下文:
  - Leader 规划: 核心约束 + 背景摘要 + 粒度指导
  - Agent 执行: 核心约束 + 相关实体 + 任务上下文
  - Leader 审核: 核心约束 + 任务要求 + 产出摘要
```

### 2.2 Token 预算驱动

```
每次 AI 调用前:
  1. 计算可用 token 预算 = modelContextWindow - maxOutputTokens - buffer
  2. 按优先级分配预算:
     - P0: 系统提示 (固定)
     - P1: 核心约束 (不可截断)
     - P2: 当前任务上下文
     - P3: 相关历史 (可伸缩)
     - P4: 背景信息 (可压缩/截断)
  3. 如果超预算: 智能压缩 P4 → P3
  4. 如果仍超: 使用更大 context 的模型
```

### 2.3 约束优先传递

```
约束分级:
  MUST (硬约束): 永远传递，违反即失败
    例: "钟叔是哑巴，不能说话"

  SHOULD (软约束): 尽量传递，可容忍偏差
    例: "文风接近金庸"

  MAY (建议): 按需传递
    例: "可以适当增加环境描写"

传递机制:
  - MUST 约束写入 contextPackage.hardConstraints
  - 每次 Agent 调用都注入 MUST 约束
  - Agent 输出时校验 MUST 约束
```

---

## 三、端到端架构设计

### 3.1 新增/改造服务

```
新增服务:
├── MissionInputService (输入结构化服务)
│   ├── parseStructuredInput(): 拆分用户输入
│   ├── validateConstraints(): 校验约束完整性
│   └── buildInputSummary(): 生成输入摘要
│
├── TokenBudgetService (Token 预算服务)
│   ├── calculateBudget(): 计算可用预算
│   ├── allocateBudget(): 按优先级分配
│   ├── compressIfNeeded(): 超预算时压缩
│   └── selectModel(): 选择合适模型
│
└── ConstraintEnforcementService (约束执行服务)
    ├── extractMustConstraints(): 提取硬约束
    ├── validateOutput(): 校验输出是否违反约束
    └── generateViolationReport(): 生成违规报告

改造服务:
├── TeamMissionService
│   ├── 输入层: 调用 MissionInputService 结构化处理
│   ├── 规划层: 调用 TokenBudgetService 管理上下文
│   └── 执行层: 调用 ConstraintEnforcementService 校验
│
├── MissionContextService
│   ├── 增强 ContextPackage 提取可靠性
│   └── 增加约束确认流程
│
└── MissionPromptService
    ├── 动态 Prompt 构建（基于 Token 预算）
    └── 分层上下文注入
```

### 3.2 数据模型改造

```prisma
model TeamMission {
  // 现有字段...

  // 新增: 结构化输入
  inputBackground    String?  @db.Text    // 背景描述
  inputConstraints   Json?                 // 约束列表 [{type, rule, severity}]
  inputEntities      Json?                 // 实体定义 [{name, type, definition}]
  inputExamples      Json?                 // 示例 [{title, content}]

  // 新增: 约束追踪
  mustConstraints    Json?                 // 提取的硬约束
  constraintViolations Json?              // 违规记录

  // 新增: 处理状态
  inputProcessed     Boolean @default(false)
  inputSummary       String? @db.Text      // 输入摘要 (用于长内容)
}
```

### 3.3 完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 1: 输入处理 (MissionInputService)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户输入 (CreateMissionDto)                                    │
│       │                                                         │
│       ▼                                                         │
│  parseStructuredInput()                                         │
│       ├─── 检测输入长度                                          │
│       │    IF > 10K 字符: 标记为长内容任务                        │
│       │                                                         │
│       ├─── 提取约束 (正则 + AI 辅助)                             │
│       │    MUST: /必须|禁止|不能|硬性约束/                        │
│       │    SHOULD: /建议|最好|应该/                              │
│       │                                                         │
│       ├─── 提取实体 (表格 + 结构化描述)                          │
│       │    人物: {name, attributes, relations}                   │
│       │    概念: {name, definition}                              │
│       │                                                         │
│       └─── 生成背景摘要 (如果 > 8K)                              │
│            调用 AI 压缩保留关键信息                              │
│                                                                 │
│  输出: StructuredMissionInput                                   │
│       ├─ background: string (可能被压缩)                         │
│       ├─ constraints: Constraint[] (MUST/SHOULD/MAY)            │
│       ├─ entities: Entity[]                                      │
│       ├─ examples: Example[]                                     │
│       └─ originalLength: number                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 2: Leader 规划 (TokenBudgetService + TeamMissionService)   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  calculateBudget(leaderModel)                                   │
│       ├─ modelContextWindow: 128K (gpt-5.1) / 200K (claude)     │
│       ├─ maxOutputTokens: 8000                                  │
│       ├─ systemPromptTokens: ~2000                              │
│       └─ availableBudget: contextWindow - output - system       │
│                                                                 │
│  allocateBudget(structuredInput, availableBudget)               │
│       ├─ P0 系统提示: 固定 2000 tokens                          │
│       ├─ P1 MUST 约束: 全部 (不截断)                             │
│       ├─ P2 成员列表: 全部 (不截断)                              │
│       ├─ P3 粒度指导: ~1000 tokens                              │
│       └─ P4 背景摘要: 剩余预算                                   │
│                                                                 │
│  buildLeaderPlanningPrompt(...)                                 │
│       ├─ 注入 MUST 约束 (显著标记)                               │
│       ├─ 注入成员精确名称列表                                    │
│       ├─ 注入粒度约束                                            │
│       └─ 注入背景摘要 (在预算内)                                 │
│                                                                 │
│  调用 Leader AI                                                  │
│       │                                                         │
│       ▼                                                         │
│  解析输出 + 约束确认                                             │
│       ├─ parseTaskBreakdown(): 提取任务列表                      │
│       ├─ extractContextPackage(): 提取上下文包                   │
│       │                                                         │
│       └─ confirmConstraints(): [新增] 约束确认                   │
│            ├─ 比对提取的约束 vs 原始 MUST 约束                    │
│            ├─ 如有遗漏: 警告或要求重新规划                        │
│            └─ 确认后存储为 mission.mustConstraints               │
│                                                                 │
│  名称匹配增强:                                                   │
│       ├─ 匹配失败时: 记录详细信息到日志                          │
│       ├─ 失败率 > 10%: 视为规划失败, 要求重新规划                │
│       └─ 发送消息给用户: 列出失败的任务分配                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 3: Agent 执行 (ConstraintEnforcementService + 现有服务)    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FOR 每个待执行任务:                                             │
│                                                                 │
│  buildAgentContext(task, mission)                               │
│       ├─ 获取 SlidingWindowContext                              │
│       │    ├─ globalSummary: 项目整体进展                        │
│       │    ├─ recentTasks: 最近 5 个任务摘要                     │
│       │    └─ relevantHistory: 相关历史片段                      │
│       │                                                         │
│       ├─ 注入 MUST 约束 (永远在最前面)                           │
│       │    【硬性约束 - 违反将导致任务失败】                      │
│       │    • HC-001: 钟叔是哑巴，不能说话                        │
│       │    • HC-002: ...                                         │
│       │                                                         │
│       ├─ 注入相关实体定义                                        │
│       │    基于任务关键词检索相关实体                            │
│       │                                                         │
│       └─ 注入任务上下文 (在预算内)                               │
│                                                                 │
│  调用 Agent AI (带续写支持)                                      │
│       │                                                         │
│       ▼                                                         │
│  validateOutput(output, mustConstraints)                        │
│       ├─ 检查是否违反 MUST 约束                                  │
│       │    例: 检测 "钟叔说" → 违反 HC-001                       │
│       │                                                         │
│       ├─ 如有违规:                                               │
│       │    ├─ 记录到 mission.constraintViolations               │
│       │    ├─ 状态变为 REVISION_NEEDED                          │
│       │    └─ 自动修订 (注入违规信息)                            │
│       │                                                         │
│       └─ 无违规: 正常完成                                        │
│                                                                 │
│  updateSlidingWindow(task, output)                              │
│       ├─ 生成任务摘要                                            │
│       ├─ 更新 recentTasks                                        │
│       └─ 定期更新 globalSummary                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 3.5: Leader 审核 (leaderReviewTask)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ★ 触发时机: Agent 执行完成后立即触发                            │
│                                                                 │
│  leaderReviewTask(mission, task, taskResult)                    │
│       │                                                         │
│       ├─ Step 1: 发送审核中信号                                  │
│       │    广播 "mission:agent_working" (thinking 状态)          │
│       │                                                         │
│       ├─ Step 2: 长内容摘要处理 [关键增强点]                     │
│       │    IF taskResult.length > 3000:                         │
│       │      └─ 调用 summarizeForLeaderReview()                  │
│       │         ├─ 生成 AI 摘要                                  │
│       │         └─ 提取关键片段 (首尾截取)                       │
│       │                                                         │
│       ├─ Step 3: 质量预警检查                                    │
│       │    qualityCheck = checkQualityIntervention(mission.id)  │
│       │    IF qualityCheck.needed:                              │
│       │      └─ 注入质量预警上下文                               │
│       │                                                         │
│       ├─ Step 4: 构建审核 Prompt                                 │
│       │    buildLeaderReviewPrompt(...)                         │
│       │    包含:                                                │
│       │      ├─ 整体任务背景 (主题/描述/目标)                    │
│       │      ├─ 强制约束条件 (MUST 约束)                         │
│       │      ├─ 本次审核任务 (名称/描述/负责人)                  │
│       │      ├─ 任务产出 (截断到 2500 字符)                      │
│       │      ├─ 已完成任务摘要 (最近 2 个, 用于一致性)           │
│       │      └─ 审核规则 (硬性错误 vs 软性建议)                  │
│       │                                                         │
│       ├─ Step 5: 调用 Leader AI 审核                             │
│       │    使用 Leader 的 AI 模型                                │
│       │    maxTokens: 4000, temperature: 0.5                    │
│       │                                                         │
│       ├─ Step 6: 解析审核结果                                    │
│       │    parseReviewResult(aiResponse.content)                │
│       │    策略:                                                │
│       │      ├─ 优先检查否定词 (不通过 > 通过)                   │
│       │      │   否定模式: "不通过"/"需要修改"/"❌"              │
│       │      ├─ 检查明确通过标记                                 │
│       │      │   通过模式: "审核通过"/"✅ 通过"                  │
│       │      └─ 上下文检查 (避免"未通过"误判为"通过")            │
│       │                                                         │
│       ├─ Step 7: 发送 Leader 反馈消息                            │
│       │    格式: "[Leader反馈]\n\n@AgentName 反馈内容"           │
│       │                                                         │
│       └─ Step 8: 根据审核结果处理                                │
│            │                                                    │
│            ├─ 通过 (isApproved = true)                          │
│            │    ├─ status = COMPLETED                           │
│            │    ├─ 保存 leaderFeedback                          │
│            │    ├─ updateMissionProgress()                      │
│            │    └─ executeNextTasks()                           │
│            │                                                    │
│            └─ 不通过 (isApproved = false)                       │
│                 └─ handleRejection()                            │
│                      │                                          │
│                      ├─ IF revisionCount >= maxRevisions (3次)  │
│                      │    ├─ 有有效内容:                         │
│                      │    │   └─ 强制通过 + 警告 "建议人工审核"  │
│                      │    └─ 无有效内容:                         │
│                      │        └─ status = BLOCKED               │
│                      │            + 记录到 CircuitBreaker        │
│                      │                                          │
│                      └─ IF revisionCount < maxRevisions         │
│                           ├─ status = REVISION_NEEDED           │
│                           ├─ revisionCount++                    │
│                           └─ executeTaskRevision()              │
│                                │                                │
│                                ├─ 构建修改 Prompt                │
│                                │   (原产出 + Leader 反馈)        │
│                                ├─ 调用 Agent AI 修改             │
│                                ├─ status = AWAITING_REVIEW      │
│                                └─ 递归: leaderReviewTask() ↩    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 4: 质量监控与整合 (QualityMonitorService)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FOR 每个完成的任务:                                             │
│       ├─ evaluateQuality(): 计算质量分数                         │
│       ├─ detectAnomalies(): 检测异常                             │
│       └─ updateTrend(): 更新质量趋势                             │
│                                                                 │
│  IF 质量下降趋势:                                                │
│       ├─ Level 1: 注入质量提醒 Prompt                            │
│       ├─ Level 2: 调整参数 (temperature, tokens)                │
│       ├─ Level 3: 暂停执行, 通知用户                             │
│       └─ Level 4: 建议升级模型或拆分任务                         │
│                                                                 │
│  completeMission()                                               │
│       ├─ 收集所有任务输出                                        │
│       ├─ 生成最终报告                                            │
│       ├─ 附带质量仪表盘                                          │
│       └─ 列出约束违规记录 (如有)                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、关键实现细节

### 4.1 输入结构化处理

```typescript
// MissionInputService

interface StructuredMissionInput {
  // 原始信息
  originalDescription: string;
  originalLength: number;

  // 结构化提取
  background: string;           // 背景描述 (可能被压缩)
  constraints: Constraint[];    // 约束列表
  entities: Entity[];           // 实体定义
  examples: Example[];          // 示例

  // 处理状态
  isLongContent: boolean;       // > 10K 字符
  compressionApplied: boolean;  // 是否压缩过
  extractionConfidence: number; // 提取置信度
}

interface Constraint {
  id: string;                   // HC-001, SC-001, MC-001
  type: 'MUST' | 'SHOULD' | 'MAY';
  rule: string;                 // 约束规则
  source: string;               // 来源文本
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface Entity {
  name: string;
  type: 'character' | 'location' | 'concept' | 'organization' | 'item';
  definition: string;
  attributes: Record<string, string>;  // 例: {性格: "沉默寡言", 门派: "青崖观"}
  relations: EntityRelation[];
}

async parseStructuredInput(description: string): Promise<StructuredMissionInput> {
  // 1. 检测长度
  const isLongContent = description.length > 10000;

  // 2. 提取约束
  const constraints = await this.extractConstraints(description);

  // 3. 提取实体
  const entities = await this.extractEntities(description);

  // 4. 提取示例
  const examples = this.extractExamples(description);

  // 5. 生成背景 (移除已提取内容后)
  let background = this.removeExtractedContent(description, constraints, entities, examples);

  // 6. 如果背景仍太长, 压缩
  let compressionApplied = false;
  if (background.length > 8000) {
    background = await this.compressBackground(background, 8000);
    compressionApplied = true;
  }

  return {
    originalDescription: description,
    originalLength: description.length,
    background,
    constraints,
    entities,
    examples,
    isLongContent,
    compressionApplied,
    extractionConfidence: this.calculateConfidence(constraints, entities),
  };
}
```

### 4.2 Token 预算管理

```typescript
// TokenBudgetService

interface TokenBudget {
  total: number;           // 模型上下文窗口
  maxOutput: number;       // 预留给输出
  system: number;          // 系统提示
  mustConstraints: number; // 硬约束 (不可压缩)
  available: number;       // 可分配给其他内容
}

interface BudgetAllocation {
  systemPrompt: string;        // 系统提示
  mustConstraints: string;     // 硬约束区块
  priorityContent: string;     // 高优先级内容
  flexibleContent: string;     // 可伸缩内容
  totalTokens: number;
  withinBudget: boolean;
}

async calculateBudget(modelId: string): Promise<TokenBudget> {
  const modelConfig = await this.getModelConfig(modelId);

  // 动态获取模型实际的 contextWindow
  const contextWindow = modelConfig.contextWindow || this.getDefaultContextWindow(modelId);

  const maxOutput = 8000;  // 保守估计
  const system = 2000;     // 系统提示预留
  const buffer = 1000;     // 安全缓冲

  return {
    total: contextWindow,
    maxOutput,
    system,
    mustConstraints: 0,  // 动态计算
    available: contextWindow - maxOutput - system - buffer,
  };
}

async allocateBudget(
  input: StructuredMissionInput,
  budget: TokenBudget,
  contentPriority: ContentPriority[]
): Promise<BudgetAllocation> {
  let remainingBudget = budget.available;
  const allocation: Partial<BudgetAllocation> = {};

  // P0: 系统提示 (固定)
  allocation.systemPrompt = this.buildSystemPrompt();
  remainingBudget -= this.countTokens(allocation.systemPrompt);

  // P1: MUST 约束 (不可压缩)
  const mustConstraintsText = this.formatMustConstraints(
    input.constraints.filter(c => c.type === 'MUST')
  );
  allocation.mustConstraints = mustConstraintsText;
  remainingBudget -= this.countTokens(mustConstraintsText);

  // P2-P4: 按优先级分配剩余预算
  for (const priority of contentPriority) {
    const content = await this.getContentForPriority(priority, input);
    const tokens = this.countTokens(content);

    if (tokens <= remainingBudget) {
      // 完整加入
      allocation[priority.key] = content;
      remainingBudget -= tokens;
    } else if (priority.compressible) {
      // 压缩后加入
      const compressed = await this.compress(content, remainingBudget);
      allocation[priority.key] = compressed;
      remainingBudget -= this.countTokens(compressed);
    } else {
      // 跳过或截断
      this.logger.warn(`Skipping ${priority.key} due to budget constraints`);
    }
  }

  return {
    ...allocation,
    totalTokens: budget.available - remainingBudget,
    withinBudget: remainingBudget >= 0,
  } as BudgetAllocation;
}
```

### 4.3 约束执行与校验

```typescript
// ConstraintEnforcementService

interface ConstraintViolation {
  constraintId: string;
  rule: string;
  violatingText: string;
  position: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

async validateOutput(
  output: string,
  mustConstraints: Constraint[]
): Promise<{
  isValid: boolean;
  violations: ConstraintViolation[];
}> {
  const violations: ConstraintViolation[] = [];

  for (const constraint of mustConstraints) {
    // 根据约束类型选择检测策略
    const detected = await this.detectViolation(output, constraint);
    if (detected) {
      violations.push({
        constraintId: constraint.id,
        rule: constraint.rule,
        violatingText: detected.text,
        position: detected.position,
        severity: constraint.severity,
      });
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

private async detectViolation(
  output: string,
  constraint: Constraint
): Promise<{ text: string; position: number } | null> {
  // 示例：检测 "钟叔是哑巴，不能说话"
  // 策略：查找 "钟叔说" "钟叔道" "钟叔笑道" 等模式

  // 1. 提取约束中的关键实体和禁止动作
  const { entity, forbiddenActions } = this.parseConstraint(constraint.rule);

  // 2. 构建检测模式
  const patterns = forbiddenActions.map(action =>
    new RegExp(`${entity}[^，。]{0,5}${action}`, 'g')
  );

  // 3. 执行检测
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) {
      return { text: match[0], position: match.index };
    }
  }

  // 4. 如果简单模式检测不到，使用 AI 辅助检测
  if (constraint.severity === 'critical') {
    return await this.aiAssistedDetection(output, constraint);
  }

  return null;
}
```

### 4.4 名称匹配增强

```typescript
// member-matching.utils.ts (增强版)

export function findMemberByName<
  T extends { agentName?: string | null; displayName: string },
>(
  assigneeName: string,
  teamMembers: T[],
  logger?: Logger,
): { member: T | undefined; matchInfo: MatchInfo } {
  const cleanedInput = cleanMemberName(assigneeName).toLowerCase();

  // 精确匹配
  const exactMatch = teamMembers.find((m) => {
    const memberName = m.agentName || m.displayName;
    return memberName.toLowerCase() === cleanedInput;
  });

  if (exactMatch) {
    return {
      member: exactMatch,
      matchInfo: { type: "exact", confidence: 1.0 },
    };
  }

  // 模糊匹配 (新增): 尝试找到最相似的成员
  const similarities = teamMembers.map((m) => ({
    member: m,
    similarity: calculateSimilarity(
      cleanedInput,
      (m.agentName || m.displayName).toLowerCase(),
    ),
  }));

  const bestMatch = similarities.sort((a, b) => b.similarity - a.similarity)[0];

  if (bestMatch.similarity > 0.8) {
    // 高相似度，建议使用
    logger?.warn(
      `[findMemberByName] Fuzzy match: "${assigneeName}" → "${bestMatch.member.agentName || bestMatch.member.displayName}" (similarity: ${bestMatch.similarity})`,
    );
    return {
      member: bestMatch.member,
      matchInfo: {
        type: "fuzzy",
        confidence: bestMatch.similarity,
        originalInput: assigneeName,
        suggestion: bestMatch.member.agentName || bestMatch.member.displayName,
      },
    };
  }

  // 完全无法匹配
  logger?.error(
    `[findMemberByName] No match for "${assigneeName}". Available: [${teamMembers.map((m) => m.agentName || m.displayName).join(", ")}]`,
  );

  return {
    member: undefined,
    matchInfo: {
      type: "none",
      confidence: 0,
      originalInput: assigneeName,
      availableMembers: teamMembers.map((m) => m.agentName || m.displayName),
    },
  };
}

// 在 parseTaskBreakdown 中使用
const matchResult = findMemberByName(assigneeName, teamMembers, this.logger);

if (!matchResult.member) {
  // 记录失败
  matchStats.unmatched.push({
    taskTitle: title,
    inputName: assigneeName,
    availableMembers: matchResult.matchInfo.availableMembers,
  });
} else if (matchResult.matchInfo.type === "fuzzy") {
  // 记录模糊匹配
  matchStats.fuzzyMatched.push({
    taskTitle: title,
    inputName: assigneeName,
    matchedTo: matchResult.matchInfo.suggestion,
    confidence: matchResult.matchInfo.confidence,
  });
}

// 如果失败率 > 10%，视为规划失败
if (matchStats.unmatched.length / matchStats.totalRows > 0.1) {
  throw new Error(
    `任务分配失败率过高 (${matchStats.unmatched.length}/${matchStats.totalRows})。\n` +
      `无法匹配的名称: ${matchStats.unmatched.map((u) => u.inputName).join(", ")}\n` +
      `可用成员: ${teamMembers.map((m) => m.agentName || m.displayName).join(", ")}`,
  );
}
```

### 4.5 Leader 审核增强

#### 4.5.1 审核服务架构

```typescript
// LeaderReviewService (建议从 TeamMissionService 中拆分)

interface ReviewContext {
  mission: {
    id: string;
    title: string;
    description: string;
    goals: string;
    constraints: string[]; // MUST 约束列表
    completedTasks: TaskSummary[]; // 已完成任务摘要
  };
  task: {
    id: string;
    title: string;
    description: string;
    assignedTo: AgentInfo;
    revisionCount: number;
    maxRevisions: number;
  };
  taskResult: string;
  qualityContext?: string; // 质量预警上下文
}

interface ReviewResult {
  isApproved: boolean;
  feedback: string;
  violations: ConstraintViolation[]; // 约束违规
  suggestions: string[]; // 改进建议
  confidenceScore: number; // 审核置信度
}

interface TaskSummary {
  id: string;
  title: string;
  summary: string; // AI 生成的摘要
  keyExcerpts: string; // 关键片段
}
```

#### 4.5.2 长内容审核处理

```typescript
// 审核前的内容摘要处理
async summarizeForLeaderReview(
  taskResult: string,
  mission: any,
  task: any
): Promise<{ summary: string; keyExcerpts: string }> {
  const MAX_SUMMARY_LENGTH = 2000;
  const MAX_EXCERPTS_LENGTH = 800;

  // 1. 如果内容不长，直接返回
  if (taskResult.length <= 3000) {
    return {
      summary: taskResult,
      keyExcerpts: '',
    };
  }

  // 2. 提取关键片段（首尾截取策略）
  const head = taskResult.substring(0, 1500);
  const tail = taskResult.substring(taskResult.length - 800);
  const keyExcerpts = `【开头片段】\n${head}\n\n【结尾片段】\n${tail}`;

  // 3. AI 生成摘要（可选，增加成本但提高审核质量）
  let summary: string;
  try {
    const summaryPrompt = `请为以下任务产出生成简洁摘要，突出关键内容和质量亮点：

任务: ${task.title}
产出（${taskResult.length}字）:
${taskResult.substring(0, 4000)}...

请用 200 字以内总结核心内容和完成质量。`;

    const aiResponse = await this.callAIWithConfig(
      'gpt-4o-mini', // 使用轻量模型降低成本
      [{ role: 'user', content: summaryPrompt }],
      '你是一个任务审核助手，擅长提炼关键信息。',
      { maxTokens: 500, temperature: 0.3 }
    );
    summary = aiResponse.content;
  } catch {
    // 降级：使用简单截断
    summary = taskResult.substring(0, MAX_SUMMARY_LENGTH) +
      `\n\n...[内容过长，已省略 ${taskResult.length - MAX_SUMMARY_LENGTH} 字]...`;
  }

  return { summary, keyExcerpts };
}
```

#### 4.5.3 审核 Prompt 构建

```typescript
// buildLeaderReviewPrompt 增强版
buildLeaderReviewPrompt(
  context: ReviewContext
): string {
  const { mission, task, taskResult, qualityContext } = context;

  // 1. 构建约束提示（MUST 约束放在最前面）
  const constraintsSection = mission.constraints.length > 0
    ? `\n【⚠️ 强制约束条件 - 必须严格遵守】\n${mission.constraints.map((c, i) =>
        `${i + 1}. ${c}`
      ).join('\n')}\n`
    : '';

  // 2. 构建已完成任务摘要（用于一致性检查）
  const completedTasksSection = mission.completedTasks.length > 0
    ? `\n【已完成的相关任务】\n${mission.completedTasks.slice(-2).map(t =>
        `- ${t.title}: ${t.summary}`
      ).join('\n')}\n`
    : '';

  // 3. 处理任务产出（智能截断）
  let processedResult = taskResult;
  if (taskResult.length > 2500) {
    const head = taskResult.substring(0, 1500);
    const tail = taskResult.substring(taskResult.length - 800);
    processedResult = `${head}\n\n...[中间内容已省略，共 ${taskResult.length} 字]...\n\n${tail}`;
  }

  // 4. 质量预警（如有）
  const qualitySection = qualityContext
    ? `\n【质量预警】${qualityContext}\n`
    : '';

  return `你是团队 Leader，正在审核成员提交的任务。

【整体任务背景】
任务主题：${mission.title}
任务目标：${mission.goals}
${constraintsSection}
【本次审核任务】
任务名称：${task.title}
任务描述：${task.description}
负责人：${task.assignedTo.displayName}
修改次数：${task.revisionCount}/${task.maxRevisions}

【任务产出】
${processedResult}
${completedTasksSection}${qualitySection}
【⚠️ 审核规则 - 请严格区分】

🚫 硬性错误（必须修改才能通过）：
  ✗ 违反强制约束条件
  ✗ 严重偏离任务要求
  ✗ 关键内容缺失
  ✗ 与已完成任务存在明显矛盾
  ✗ 字数严重不足（低于要求的 50%）

💡 软性建议（可选改进，不影响通过）：
  ✓ 文笔优化建议
  ✓ 细节补充建议
  ✓ 风格微调

【审核决策】
- 如果只有软性建议，没有硬性错误 → 审核通过 + 附带改进建议
- 如果存在硬性错误 → 需要修改 + 明确列出必须修复的问题

请给出你的审核结论：`;
}
```

#### 4.5.4 审核结果解析增强

```typescript
// parseReviewResult 增强版
parseReviewResult(content: string): {
  isApproved: boolean;
  confidence: number;
  reason: string;
} {
  const contentLower = content.toLowerCase();

  // 1. 否定模式检测（优先级最高）
  const rejectPatterns = [
    { pattern: /不通过|暂不通过|未通过|未能通过/, weight: 1.0 },
    { pattern: /无法通过|没通过|不合格/, weight: 1.0 },
    { pattern: /需要修改|需修改|请修改|请重新/, weight: 0.9 },
    { pattern: /需要改进|存在问题|有待改进/, weight: 0.8 },
    { pattern: /❌/, weight: 1.0 },
  ];

  for (const { pattern, weight } of rejectPatterns) {
    if (pattern.test(content)) {
      return {
        isApproved: false,
        confidence: weight,
        reason: `检测到否定词: ${pattern.source}`,
      };
    }
  }

  // 2. 明确通过标记检测
  const approvePatterns = [
    { pattern: /审核通过|评审通过|审批通过/, weight: 1.0 },
    { pattern: /✅\s*通过|✅通过/, weight: 1.0 },
    { pattern: /approved|passed/i, weight: 0.9 },
  ];

  for (const { pattern, weight } of approvePatterns) {
    if (pattern.test(content)) {
      return {
        isApproved: true,
        confidence: weight,
        reason: `检测到通过标记: ${pattern.source}`,
      };
    }
  }

  // 3. 上下文感知的"通过"检测
  if (content.includes('通过') || content.includes('合格')) {
    const passIndex = content.indexOf('通过');
    if (passIndex > 0) {
      const beforePass = content.substring(Math.max(0, passIndex - 10), passIndex);
      // 检查前面是否有否定词
      if (/未|不|没|无法|暂/.test(beforePass)) {
        return {
          isApproved: false,
          confidence: 0.9,
          reason: '上下文检测: "通过"前有否定词',
        };
      }
    }
    return {
      isApproved: true,
      confidence: 0.7,
      reason: '检测到"通过"或"合格"',
    };
  }

  // 4. 默认不通过（更保守的策略）
  return {
    isApproved: false,
    confidence: 0.5,
    reason: '未检测到明确的审核结论',
  };
}
```

#### 4.5.5 修改循环控制

```typescript
// 修改循环的完整控制逻辑
async handleRejection(
  mission: any,
  task: any,
  feedback: string
): Promise<void> {
  const currentRevisions = task.revisionCount || 0;
  const maxRevisions = task.maxRevisions || 3;

  // 情况1: 已达最大修改次数
  if (currentRevisions >= maxRevisions) {
    const hasValidContent = this.validateTaskContent(task.result);

    if (hasValidContent) {
      // 强制通过，但添加警告
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.COMPLETED,
          leaderFeedback: feedback +
            `\n\n⚠️ 【系统提示】已达最大修改次数(${currentRevisions}/${maxRevisions})，` +
            `内容已保留。建议后续人工审核。`,
          completedAt: new Date(),
        },
      });

      // 发送警告消息
      await this.sendSystemMessage(
        mission.topicId,
        `⚠️ 任务"${task.title}"已达最大修改次数，已强制通过。建议人工审核。`
      );

      // 继续执行后续任务
      await this.executeNextTasks(mission.id);
    } else {
      // 内容无效，标记为 BLOCKED
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.BLOCKED,
          leaderFeedback: feedback +
            `\n\n❌ 【系统提示】已达最大修改次数但内容质量不足，任务已阻塞。`,
        },
      });

      // 记录失败到 CircuitBreaker
      this.circuitBreaker.recordFailure(
        task.assignedTo.id,
        TaskCompletionType.CONTENT_ERROR
      );

      // 继续执行其他任务（跳过被阻塞的）
      await this.executeNextTasks(mission.id);
    }
    return;
  }

  // 情况2: 还有修改机会
  await this.prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: AgentTaskStatus.REVISION_NEEDED,
      revisionCount: currentRevisions + 1,
      leaderFeedback: feedback,
      needsRevision: true,
    },
  });

  // 触发修改流程
  await this.executeTaskRevision(mission, task, feedback);
}

// 内容有效性验证
private validateTaskContent(result: string | null): boolean {
  if (!result) return false;

  const trimmed = result.trim();

  // 基本长度检查
  if (trimmed.length < 100) return false;

  // 检查是否为错误内容
  const errorPatterns = [
    '[自动完成]',
    '[错误]',
    'API Error',
    'Rate limit',
    '任务执行失败',
  ];

  for (const pattern of errorPatterns) {
    if (trimmed.includes(pattern)) return false;
  }

  return true;
}
```

#### 4.5.6 审核状态流转图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        任务状态流转详解                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   PENDING ─────────────────────► IN_PROGRESS                        │
│      │                               │                              │
│      │ (等待依赖完成)                 │ (Agent 开始执行)              │
│                                      │                              │
│                                      ▼                              │
│                              AWAITING_REVIEW                        │
│                                      │                              │
│                                      │ (Leader 开始审核)             │
│                                      │                              │
│            ┌─────────────────────────┼─────────────────────────┐    │
│            │                         │                         │    │
│            ▼                         ▼                         ▼    │
│       COMPLETED              REVISION_NEEDED              BLOCKED   │
│            │                         │                         │    │
│            │                         │ (Agent 修改)             │    │
│            │                         │                         │    │
│            │                         ▼                         │    │
│            │                    IN_PROGRESS                    │    │
│            │                         │                         │    │
│            │                         │                         │    │
│            │                         ▼                         │    │
│            │                  AWAITING_REVIEW ────────────────►│    │
│            │                         │        (强制完成)        │    │
│            │                         │                         │    │
│            │                    (循环最多3次)                   │    │
│            │                                                   │    │
│            └───────────────────┬───────────────────────────────┘    │
│                                │                                    │
│                                ▼                                    │
│                         executeNextTasks()                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

状态说明:
  PENDING        - 等待依赖任务完成
  IN_PROGRESS    - Agent 正在执行或修改
  AWAITING_REVIEW - 等待 Leader 审核
  REVISION_NEEDED - Leader 要求修改
  COMPLETED      - 审核通过或强制完成
  BLOCKED        - 无法完成，已阻塞
  CANCELLED      - 已取消
```

#### 4.5.7 关键数据库字段

```prisma
model AgentTask {
  // 现有字段...

  // 审核相关
  leaderFeedback     String?   @db.Text @map("leader_feedback")
  feedbackMessageId  String?   @map("feedback_message_id")

  // 修改控制
  needsRevision      Boolean   @default(false)
  revisionCount      Int       @default(0) @map("revision_count")
  maxRevisions       Int       @default(3) @map("max_revisions")

  // 状态追踪
  status             AgentTaskStatus @default(PENDING)

  // 新增: 审核追踪
  reviewHistory      Json?     // 审核历史 [{time, result, feedback}]
  constraintViolations Json?   // 约束违规 [{constraintId, text}]
}

enum AgentTaskStatus {
  PENDING           // 待开始
  IN_PROGRESS       // 执行中
  AWAITING_REVIEW   // 等待审核
  REVISION_NEEDED   // 需要修改
  COMPLETED         // 已完成
  BLOCKED           // 已阻塞
  CANCELLED         // 已取消
}
```

---

## 五、实施计划

### Phase 1: 紧急修复 (1-2 天)

**目标**: 解决当前阻塞问题

1. **修复名称匹配** ✅ 已完成
   - 移除错误的 `AI-` 前缀处理
   - 添加诊断日志

2. **添加上下文截断保护** ✅ 已完成
   - description 截断 + 重试机制
   - 智能截断保留首尾

3. **名称匹配失败检测**
   - 失败率 > 10% 视为规划失败
   - 发送消息给用户列出失败项

### Phase 2: Leader 审核增强 (2-3 天)

**目标**: 提升审核质量和可靠性

1. **审核内容处理优化**
   - 长内容智能摘要 (> 3000 字符)
   - 首尾截取保留关键信息
   - 可选 AI 摘要提高审核质量

2. **审核结果解析增强**
   - 多模式匹配 (否定优先)
   - 上下文感知避免误判
   - 返回置信度评分

3. **修改循环控制**
   - 最大修改次数限制 (默认 3 次)
   - 强制完成机制 (有效内容)
   - BLOCKED 状态处理 (无效内容)

4. **审核追踪**
   - 审核历史记录
   - 约束违规追踪
   - CircuitBreaker 集成

5. **关键文件**:
   - `team-mission.service.ts:1901-2137` (leaderReviewTask)
   - `team-mission.service.ts:4232-4312` (parseReviewResult)
   - `team-mission.service.ts:2141-2316` (executeTaskRevision)

### Phase 3: 约束传递增强 (3-5 天)

**目标**: 确保约束从输入到输出全程传递

1. **约束提取增强**

   ```typescript
   // 从 mission.description 中提取 MUST 约束
   // 支持多种格式：
   // - "必须：钟叔不能说话"
   // - "硬性约束：所有对话需要半文半白"
   // - "禁止：不能出现现代词汇"
   ```

2. **约束确认流程**
   - Leader 规划后，系统展示提取的约束
   - 如有遗漏，提示 Leader 补充

3. **Agent 执行时注入约束**
   - 每次调用都在 System Prompt 最前面注入 MUST 约束
   - 使用显著标记：`【硬性约束 - 违反将导致任务失败】`

4. **Leader 审核时校验约束**
   - 在审核 Prompt 中显著展示约束
   - AI 自动检测约束违规
   - 违规时强制要求修改

5. **输出校验**
   - 每个 Agent 输出后校验是否违反 MUST 约束
   - 违反时自动修订

### Phase 4: Token 预算管理 (1 周)

**目标**: 系统性管理上下文大小

1. **TokenBudgetService 实现**
   - 动态获取模型 contextWindow
   - 按优先级分配 token 预算
   - 超预算时智能压缩

2. **模型配置增强**
   - 从数据库读取真实的 contextWindow
   - 支持模型自动选择（根据任务需求）

3. **Prompt 动态构建**
   - 根据预算动态调整内容量
   - 优先保证 MUST 约束和当前任务

### Phase 5: 输入结构化 (1 周)

**目标**: 结构化存储用户输入，支持按需检索

1. **数据模型改造**
   - 新增 inputBackground, inputConstraints, inputEntities, inputExamples 字段

2. **MissionInputService 实现**
   - 输入解析和结构化
   - 长内容压缩
   - 实体/约束提取

3. **前端适配**
   - 创建任务时可选择结构化输入
   - 或自动从描述中提取

### Phase 6: 端到端监控 (1 周)

**目标**: 全流程可观测和异常恢复

1. **质量监控整合**
   - 充分利用 QualityMonitorService
   - 自动干预机制

2. **约束违规追踪**
   - 记录所有违规
   - 生成违规报告

3. **最终报告增强**
   - 包含质量仪表盘
   - 包含约束执行情况
   - 包含异常任务列表

---

## 六、验收标准

### 功能验收

| 场景                         | 预期行为                     |
| ---------------------------- | ---------------------------- |
| 100K 字符输入                | 正确处理，不报上下文溢出错误 |
| 包含硬约束（如"钟叔是哑巴"） | Agent 输出中不出现违反情况   |
| 96 个任务分解                | 成员名称全部正确匹配         |
| 任务执行过程                 | 质量监控正常，异常时自动干预 |
| 最终产出                     | 完整报告，无信息丢失         |

### 性能验收

| 指标           | 目标             |
| -------------- | ---------------- |
| 名称匹配成功率 | > 95%            |
| 约束传递完整率 | 100% (MUST 约束) |
| 上下文溢出率   | < 1%             |
| 任务完成率     | > 95%            |

---

## 七、风险与缓解

| 风险              | 影响           | 缓解措施                  |
| ----------------- | -------------- | ------------------------- |
| AI 提取约束不准确 | 关键约束遗漏   | 人工确认 + 规则提取兜底   |
| Token 计数不准确  | 仍可能溢出     | 保守预算 + 重试机制       |
| 模糊匹配误判      | 分配给错误成员 | 相似度阈值 0.8 + 日志记录 |
| 约束校验漏检      | 违规内容通过   | AI 辅助检测 + 人工审核    |

---

## 八、附录：关键文件清单

### 需要新建的文件

```
backend/src/modules/ai-app/teams/services/
├── input/
│   └── mission-input.service.ts      # 输入结构化处理
│
├── budget/
│   └── token-budget.service.ts       # Token 预算管理
│
├── enforcement/
│   └── constraint-enforcement.service.ts  # 约束执行与校验
│
└── review/
    └── leader-review.service.ts      # Leader 审核服务 (可选拆分)
```

### 需要修改的文件

```
backend/src/modules/ai-app/teams/
├── services/collaboration/
│   ├── team-mission.service.ts       # 主流程整合 + Leader 审核逻辑
│   │   ├── leaderReviewTask()        [L1901-2137] 审核核心
│   │   ├── parseReviewResult()       [L4232-4312] 结果解析
│   │   ├── handleRejection()         [L2034-2121] 拒绝处理
│   │   ├── executeTaskRevision()     [L2141-2316] 修改执行
│   │   ├── buildLeaderReviewPrompt() [L3807-3901] 审核Prompt
│   │   └── buildTaskRevisionPrompt() [L3904-3938] 修改Prompt
│   │
│   ├── mission-context.service.ts    # 约束确认流程
│   ├── mission-prompt.service.ts     # 动态 Prompt 构建
│   │   ├── buildLeaderReviewPrompt() [L438-512]
│   │   └── parseReviewResult()       [L843+]
│   │
│   └── member-matching.utils.ts      # 名称匹配增强
│
├── interfaces/
│   └── mission-context.interface.ts  # 新增类型定义
│
└── ai-teams.module.ts                # 注册新服务
```

### 需要修改的 Prisma Schema

```
backend/prisma/schema.prisma
├── TeamMission model                 # 新增结构化输入字段
│   ├── inputBackground
│   ├── inputConstraints
│   ├── inputEntities
│   ├── inputExamples
│   ├── mustConstraints
│   └── constraintViolations
│
└── AgentTask model                   # 审核相关字段
    ├── leaderFeedback               # 已有
    ├── feedbackMessageId            # 已有
    ├── needsRevision                # 已有
    ├── revisionCount                # 已有
    ├── maxRevisions                 # 已有
    ├── reviewHistory                # 新增: 审核历史
    └── constraintViolations         # 新增: 约束违规
```

---

## 九、Leader 审核流程完整代码路径

### 核心调用链

```
executeTask(mission, task)
  └─→ [L1615] leaderReviewTask(mission, task, finalContent)
        │
        ├─→ [L1920] emitToTopic("mission:agent_working", {status: "reviewing"})
        │
        ├─→ [L1930] IF taskResult.length > 3000:
        │     └─→ summarizeForLeaderReview()
        │
        ├─→ [L1945] checkQualityIntervention(mission.id)
        │
        ├─→ [L1955] buildLeaderReviewPrompt(mission, task, reviewContent)
        │
        ├─→ [L1970] callAIWithConfig(leader.aiModel, ...)
        │     └─→ maxTokens: 4000, temperature: 0.5
        │
        ├─→ [L2000] parseReviewResult(aiResponse.content)
        │     ├─→ 检查否定词: "不通过"/"需要修改"/"❌"
        │     ├─→ 检查通过词: "审核通过"/"✅ 通过"
        │     └─→ 上下文检查: 避免"未通过"误判
        │
        ├─→ [L2010] sendMessageToTopic("[Leader反馈]...")
        │
        ├─→ [L2020] createLog(MissionLogType.LEADER_FEEDBACK)
        │
        └─→ [L2028] IF isApproved:
              ├─→ status = COMPLETED
              ├─→ updateMissionProgress()
              └─→ executeNextTasks()
            ELSE:
              └─→ handleRejection(mission, task, feedback)
                    │
                    ├─→ IF revisionCount >= maxRevisions:
                    │     ├─→ 有效内容: 强制 COMPLETED + 警告
                    │     └─→ 无效内容: BLOCKED + CircuitBreaker
                    │
                    └─→ ELSE:
                          ├─→ status = REVISION_NEEDED
                          ├─→ revisionCount++
                          └─→ executeTaskRevision(mission, task, feedback)
                                │
                                ├─→ buildTaskRevisionPrompt(原结果 + 反馈)
                                ├─→ callAIWithConfig(agent.aiModel, ...)
                                ├─→ status = AWAITING_REVIEW
                                └─→ leaderReviewTask() [递归]
```

### 审核规则定义

```
【硬性错误 - 必须修改】            【软性建议 - 可选改进】
  ✗ 违反强制约束条件                 ✓ 文笔优化建议
  ✗ 严重偏离任务要求                 ✓ 细节补充建议
  ✗ 关键内容缺失                     ✓ 风格微调
  ✗ 与已完成任务矛盾
  ✗ 字数严重不足 (< 50%)

审核决策:
  只有软性建议 → 通过 + 附带建议
  存在硬性错误 → 不通过 + 列出问题
```
