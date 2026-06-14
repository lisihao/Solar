# AI Evolution System — 系统设计方案

> **版本**: v1.0
> **日期**: 2026-02-24
> **状态**: 待实施

---

## 背景与目标

让系统能在 Admin 页面远程调用 Claude Code 执行任务，收集执行反馈，并通过 AI 分析驱动以下对象的自动迭代优化：

- **Prompt 模板** — 根据反馈自动优化各模块的 system prompt / few-shot examples
- **Skill/Agent 配置** — 自动调整 Skill 定义、Agent 参数、TaskProfile 等
- **CLAUDE.md 规则** — 自动更新项目的 AI 行为规则和约束
- **代码本身** — Claude Code 直接修改业务代码，生成 PR 草稿（需人工 merge）

**门控策略**：低风险变更自动应用，高风险变更进入人工审核队列。

---

## 核心飞轮

```
任务执行 → Trace 采集 → 用户/自动反馈 → 模式分析
    ↑                                         ↓
  新配置生效 ← 安全门控应用 ← AI 提案生成 ← Claude 分析
```

---

## 架构分层

```
Admin Portal (前端)
  └── /admin/evolution/           ← 独立一级菜单「AI 进化」
        ├── playground/           ← 提交任务、看执行流、打分
        ├── proposals/            ← 审核队列（高风险变更）
        ├── patterns/             ← 聚合模式分析
        └── history/              ← 已应用变更历史

Evolution API (后端 NestJS 模块)
  └── /api/v1/evolution/
        ├── ClaudeCodeGatewayService  ← 调用 Claude Code CLI
        ├── FeedbackAggregatorService ← 收集+评分
        ├── PatternAnalysisService    ← Claude 分析失败模式
        ├── ProposalGeneratorService  ← 生成变更提案
        ├── SafetyClassifierService   ← 风险分级
        └── EvolutionApplyService     ← 应用变更 + 版本控制

AI Engine (复用现有)
  ├── TraceCollectorService   ← 已有，直接复用
  ├── EvalPipelineService     ← 已有，作为 Layer1/2 评分
  ├── QualityGateService      ← 已有，作为输出质量门控
  └── StreamingService        ← 已有，SSE 流

Evolution Store (DB)
  ├── TaskExecution           ← 新增
  ├── ExecutionFeedback       ← 新增
  ├── EvolutionProposal       ← 新增
  ├── EvolutionAbTest         ← 新增
  └── ConfigSnapshot          ← 新增（版本快照）
```

---

## 一、Claude Code Gateway

**文件**: `backend/src/modules/ai-engine/evolution/services/claude-code-gateway.service.ts`

**职责**: 将 Claude Code CLI 包装为可远程调用的服务，每次执行在独立 git worktree 中隔离运行。

```typescript
interface ClaudeCodeSession {
  sessionId: string
  taskType: ClaudeTaskType       // coding | analysis | refactor | review
  input: ClaudeTaskInput
  worktreePath: string           // 隔离执行目录
  status: 'running' | 'complete' | 'error'
  output?: string
  traceId?: string
}

// 核心方法
async createSession(task: ClaudeTaskInput): Promise<string>          // 创建隔离 worktree
streamExecution(sessionId: string): Observable<SSEEvent>            // SSE 流 → 前端
async getResult(sessionId: string): Promise<ClaudeExecutionResult>
async cleanupSession(sessionId: string): Promise<void>              // 删除 worktree
```

**执行方式**:

- `child_process.spawn('claude', ['--print', task], { cwd: worktreePath })`
- stdout 实时转发至 `StreamingService`（复用现有 `/backend/src/common/streaming/streaming.service.ts`）
- stderr 作为错误事件
- 每次执行创建临时 git worktree，执行完毕自动清理

**安全约束**:

- 仅允许在 `.claude/worktrees/evolution-*` 下运行
- 禁止执行 `git push`、`rm -rf`、`git reset --hard` 等危险命令
- 超时 10 分钟强制终止

---

## 二、Feedback 数据模型

**新增 Prisma Models**（追加至 `backend/prisma/schema/models.prisma`）:

```prisma
model TaskExecution {
  id            String    @id @default(cuid())
  sessionId     String    @unique
  taskType      String    // coding | analysis | refactor | review
  input         Json      // 任务输入（prompt、context、files）
  output        Json?     // 执行结果（输出文本、修改文件列表）
  traceId       String?   // → AgentTrace
  configVersion String?   // 执行时的配置版本 hash

  feedback      ExecutionFeedback[]
  proposals     EvolutionProposal[]

  userId        String?
  createdAt     DateTime  @default(now())
  completedAt   DateTime?

  @@index([taskType, createdAt])
  @@index([configVersion])
}

model ExecutionFeedback {
  id              String    @id @default(cuid())
  executionId     String
  execution       TaskExecution @relation(fields: [executionId], references: [id])

  // 显式反馈
  overallRating   Int?      // 1-5 星
  dimensions      Json?     // { accuracy, completeness, relevance, style }
  issues          Json?     // [{ type, description, severity }]
  suggestion      String?   // 用户文字建议

  // 隐式信号
  outputAccepted  Boolean?  // 用户是否采纳了输出
  retried         Boolean   @default(false)

  // 自动评分（来自 EvalPipelineService）
  evalScore       Float?
  structuralScore Float?
  judgeScore      Float?

  source          String    // user | automated
  userId          String?
  createdAt       DateTime  @default(now())

  @@index([executionId])
}

model EvolutionProposal {
  id              String    @id @default(cuid())

  // 分析依据
  targetType      String    // prompt | skill | agent | claude_md | code
  targetId        String    // 被改进的对象 ID
  patternSummary  String    // AI 发现的失败模式描述
  sampleCount     Int       // 分析了多少次执行
  avgScoreBefore  Float     // 改进前平均分

  // 提案内容
  changeDiff      String    // unified diff 格式
  changeReason    String    // AI 的改进理由
  riskLevel       String    // low | medium | high

  // 状态流转
  status          String    // pending | approved | rejected | applied | rolled_back
  autoApplied     Boolean   @default(false)
  appliedAt       DateTime?
  reviewedBy      String?
  reviewNote      String?

  // 效果验证
  avgScoreAfter   Float?
  abTestId        String?

  executions      TaskExecution[]
  abTest          EvolutionAbTest?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([targetType, targetId, status])
  @@index([riskLevel, status])
}

model EvolutionAbTest {
  id              String    @id @default(cuid())
  proposalId      String    @unique
  proposal        EvolutionProposal @relation(fields: [proposalId], references: [id])

  startAt         DateTime
  endAt           DateTime?
  targetSamples   Int       @default(50)
  splitRatio      Float     @default(0.5)

  controlScore    Float?    // 旧配置分数
  treatmentScore  Float?    // 新配置分数
  confidence      Float?    // 统计置信度（95% = 显著）
  winner          String?   // control | treatment | inconclusive
  status          String    // running | completed

  createdAt       DateTime  @default(now())
}

model ConfigSnapshot {
  id              String    @id @default(cuid())
  targetType      String    // prompt | skill | agent | claude_md | code
  targetId        String
  version         Int       // 递增版本号
  content         String    // 完整内容快照
  diff            String?   // 与上一版本的 diff
  changeReason    String?
  appliedBy       String    // evolution | human
  proposalId      String?
  createdAt       DateTime  @default(now())

  @@index([targetType, targetId, version])
}
```

---

## 三、进化引擎服务

### 3.1 PatternAnalysisService

**文件**: `evolution/services/pattern-analysis.service.ts`

**触发条件**: 每 24h 定时，或累计 50 次低分执行后触发

**逻辑**:

1. 查询最近 N 次执行的 feedback，过滤低分样本（evalScore < 60）
2. 调用 Claude（`AiChatService.chat()` + `taskProfile: { creativity: 'low' }`）分析失败模式
3. 输出结构化 `PatternReport`

### 3.2 ProposalGeneratorService

**文件**: `evolution/services/proposal-generator.service.ts`

**输入**: PatternReport + 当前目标配置内容（从 ConfigSnapshot 读取）
**输出**: EvolutionProposal（含 unified diff）

**逻辑**:

1. 读取当前配置的最新 ConfigSnapshot
2. 调用 Claude："基于以下失败模式，对此配置提出具体修改，输出 unified diff 格式"
3. 解析 diff，交由 SafetyClassifier 判断风险级别

### 3.3 SafetyClassifierService

**文件**: `evolution/services/safety-classifier.service.ts`

**风险分级规则**:

| 目标类型         | 变更规模        | 风险级别 | 处理方式   |
| ---------------- | --------------- | -------- | ---------- |
| prompt           | 只改文字描述    | low      | 自动应用   |
| prompt           | 改结构/格式要求 | medium   | 需人工审核 |
| skill/agent 配置 | 参数调整        | low      | 自动应用   |
| claude_md        | 新增规则        | medium   | 需人工审核 |
| claude_md        | 修改/删除规则   | high     | 需人工审核 |
| code             | 任何变更        | high     | 需人工审核 |
| 任何             | diff > 50 行    | high     | 需人工审核 |

### 3.4 EvolutionApplyService

**文件**: `evolution/services/evolution-apply.service.ts`

**职责**:

1. 备份当前版本到 ConfigSnapshot
2. 应用 unified diff 到目标文件/配置
3. 启动 A/B 测试（针对低风险变更）
4. 统计效果 delta，自动晋升或触发回滚

---

## 四、API 端点

**模块**: `backend/src/modules/ai-engine/evolution/`

```
POST   /api/v1/evolution/sessions              → 创建 Claude Code 执行会话
GET    /api/v1/evolution/sessions/:id/stream   → SSE 实时流（复用 StreamingService）
POST   /api/v1/evolution/sessions/:id/feedback → 提交反馈
GET    /api/v1/evolution/sessions/:id          → 查询执行结果

GET    /api/v1/evolution/proposals             → 列表（过滤 status/riskLevel）
GET    /api/v1/evolution/proposals/:id/diff    → 查看 diff 内容
POST   /api/v1/evolution/proposals/:id/review  → 审核（approve/reject + note）
POST   /api/v1/evolution/proposals/:id/apply   → 手动触发应用

GET    /api/v1/evolution/patterns              → 模式分析报告
POST   /api/v1/evolution/patterns/trigger      → 手动触发模式分析

GET    /api/v1/evolution/history               → 已应用变更历史
POST   /api/v1/evolution/history/:id/rollback  → 回滚到指定版本

GET    /api/v1/evolution/dashboard             → 仪表盘指标
```

---

## 五、前端页面

**路由**: `frontend/app/admin/evolution/`（独立一级菜单「AI 进化」，不归属 `/admin/ai/`）

### Playground (`playground/page.tsx`)

- 左侧：任务提交表单（类型选择、prompt 输入、关联文件）
- 右侧：Claude Code 执行实时流（复用现有 `useStream` hook）
- 底部：反馈区（1-5 星 + 维度评分 + 问题注释 + 建议文本）

### Proposals (`proposals/page.tsx`)

- 高/中风险变更的审核队列（Badge 显示待审核数量）
- Syntax-highlighted unified diff 查看器
- 一键 Approve / Reject（带 note 输入框）

### Patterns (`patterns/page.tsx`)

- 各 targetType 的失败模式分析
- 平均质量分趋势图
- 手动触发分析按钮

### History (`history/page.tsx`)

- 已应用变更时间线
- 每条变更显示应用前/后分数对比
- 一键回滚按钮

---

## 六、进化目标的具体实现

| targetType  | 存储位置                 | 变更方式                                 | 默认风险    |
| ----------- | ------------------------ | ---------------------------------------- | ----------- |
| `prompt`    | DB PromptTemplate        | 更新 DB + 重新加载缓存                   | low         |
| `skill`     | AgentConfigService DB    | 更新 DB + 通知 Registry 重载             | low         |
| `agent`     | AgentConfigService DB    | 更新 DB + 通知 Registry 重载             | medium      |
| `claude_md` | 磁盘 `.claude/CLAUDE.md` | git patch + commit                       | medium/high |
| `code`      | git worktree             | Claude Code 生成 PR 草稿（不自动 merge） | high        |

---

## 七、安全设计

1. **所有 Evolution API 仅 Admin 角色可访问**（复用现有 AdminGuard）
2. **代码变更永远只生成 PR 草稿，绝不自动 merge**
3. **CLAUDE.md 的删除/修改操作必须人工审核**，保留 7 天可回滚窗口
4. **ConfigSnapshot 保留最近 20 个版本**（参考现有 `OfficeDocumentVersion` 模式）
5. **Claude Code 执行环境**：独立 git worktree，超时 10 分钟自动终止

---

## 八、复用现有基础设施

| 已有组件                     | 路径                                                 | 用途                         |
| ---------------------------- | ---------------------------------------------------- | ---------------------------- |
| `StreamingService`           | `common/streaming/streaming.service.ts`              | Claude Code 输出 SSE 流      |
| `useStream` hook             | `frontend/hooks/core/useStream.ts`                   | 前端消费执行流               |
| `TraceCollectorService`      | `ai-engine/observability/trace-collector.service.ts` | 自动记录执行 trace           |
| `EvalPipelineService`        | `ai-engine/observability/eval-pipeline.service.ts`   | Layer1/2 自动质量评分        |
| `AiChatService.chat()`       | `ai-engine/core/`                                    | Pattern 分析 + Proposal 生成 |
| `AgentConfigService`         | `ai-engine/agents/config/`                           | Skill/Agent 配置动态更新     |
| `AdminGuard`                 | `common/guards/`                                     | API 权限控制                 |
| `OfficeDocumentVersion` 模式 | `ai-app/office/`                                     | ConfigSnapshot 版本化参考    |

---

## 九、关键文件路径

**新增后端**:

```
backend/src/modules/ai-engine/evolution/
  evolution.module.ts
  evolution.controller.ts
  services/
    claude-code-gateway.service.ts
    feedback-aggregator.service.ts
    pattern-analysis.service.ts
    proposal-generator.service.ts
    safety-classifier.service.ts
    evolution-apply.service.ts
backend/prisma/migrations/YYYYMMDD_add_evolution/migration.sql
```

**新增前端**:

```
frontend/app/admin/evolution/
  layout.tsx
  page.tsx                      ← Dashboard
  playground/page.tsx
  proposals/page.tsx
  patterns/page.tsx
  history/page.tsx
```

**修改**:

```
backend/prisma/schema/models.prisma         ← 新增 5 个 model
backend/src/modules/ai-engine/ai-engine.module.ts  ← 注册 Evolution 模块
frontend/components/admin/Sidebar.tsx       ← 新增「AI 进化」一级菜单
frontend/lib/i18n/locales/zh.json           ← 新增 evolution 命名空间
frontend/lib/i18n/locales/en.json           ← 同上
```

---

## 十、分阶段实施

### Phase 1 — 基础执行层

- Prisma 新模型 + 手写迁移 SQL
- `ClaudeCodeGatewayService`（subprocess + worktree + SSE）
- `ExecutionFeedback` API
- 前端 Playground 页面 + 侧边栏入口

### Phase 2 — 进化引擎

- `PatternAnalysisService` + `ProposalGeneratorService`
- `SafetyClassifierService` + `EvolutionApplyService`（Prompt/Skill 目标）
- 前端 Proposals / History 页面

### Phase 3 — 高级特性

- A/B 测试引擎
- CLAUDE.md 自动更新（git patch + commit）
- 代码变更 PR 草稿生成（`targetType: 'code'`）
- 前端 Patterns 仪表盘
