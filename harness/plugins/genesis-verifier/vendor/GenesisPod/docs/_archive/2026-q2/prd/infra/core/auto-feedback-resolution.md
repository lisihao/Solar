# 自动化反馈处理闭环系统 PRD

> **版本**: v1.0
> **日期**: 2024-12-25
> **状态**: 设计中

---

## 一、背景与目标

### 1.1 现状分析

当前 Feedback 系统流程：

```
用户反馈 → 邮件通知 → 人工查看 → 手动分析 → 手动修复 → 手动回复
    ↓
  [平均响应时间: 24-48小时]
  [解决率: 依赖人工排期]
```

### 1.2 目标状态

```
用户反馈 → AI实时感知 → 自动分析 → 自动修复/生成方案 → 自动通知 → 闭环
    ↓
  [目标响应时间: < 5分钟]
  [自动解决率: 30%+ (简单问题)]
```

### 1.3 核心价值

| 指标             | 当前  | 目标  | 提升 |
| ---------------- | ----- | ----- | ---- |
| 首次响应时间     | 24h   | 5min  | 99%↓ |
| 简单问题解决时间 | 2-3天 | 30min | 99%↓ |
| 研发介入率       | 100%  | 50%   | 50%↓ |

---

## 二、系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户反馈入口                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │ Web反馈 │  │ 截图上传 │  │ 错误日志 │  │ 控制台  │                 │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘                 │
│       └────────────┴────────────┴────────────┘                      │
│                           ↓                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  🆕 Triage Agent (分诊代理)                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │ 合理性判断   │  │ 优先级评估   │  │ 路由决策    │           │   │
│  │  │ 是否有效问题 │  │ 紧急/影响度  │  │ 自动/人工   │           │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │   │
│  │         └────────────────┴────────────────┘                   │   │
│  │                          ↓                                    │   │
│  │              ┌───────────┴───────────┐                        │   │
│  │              ↓                       ↓                        │   │
│  │     [可自动处理]              [需人工介入]                     │   │
│  │         ↓                           ↓                         │   │
│  │  ┌─────────────┐            ┌─────────────┐                   │   │
│  │  │ AI分析+修复 │            │ 创建任务    │                   │   │
│  │  │ 自动创建PR  │            │ 分配研发    │                   │   │
│  │  └─────────────┘            └─────────────┘                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                           ↓                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    反馈处理引擎                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │ 实时监听器   │  │ AI 分析器   │  │ 自动修复器  │           │   │
│  │  │ EventEmitter│  │ Vision+LLM  │  │ CodeAgent   │           │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │   │
│  │         │                │                │                   │   │
│  │         ↓                ↓                ↓                   │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │
│  │  │              问题诊断 & 解决方案生成                  │     │   │
│  │  │  • 截图OCR识别 • 错误堆栈分析 • 代码定位             │     │   │
│  │  │  • 相似问题匹配 • 自动修复生成 • PR创建              │     │   │
│  │  └─────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                           ↓                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      通知 & 闭环                              │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│  │  │ 飞书通知 │  │ GitHub  │  │ 用户邮件 │  │ 状态更新 │          │   │
│  │  │ 钉钉/Slack│  │ Issue/PR│  │ 进度通知 │  │ 自动闭环 │          │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块

| 模块                     | 职责            | 技术方案               |
| ------------------------ | --------------- | ---------------------- |
| **FeedbackEventEmitter** | 反馈事件发布    | NestJS EventEmitter    |
| **FeedbackTriageAgent**  | 🆕 问题分诊决策 | LLM Agent + 规则引擎   |
| **FeedbackAnalyzer**     | AI 问题分析     | GPT-4V / Claude Vision |
| **FeedbackResolver**     | 自动修复引擎    | Coding Agent + Git     |
| **FeedbackNotifier**     | 多渠道通知      | 飞书/钉钉/Slack Bot    |
| **FeedbackTracker**      | 进度追踪        | 状态机 + 时间线        |

---

## 2.5 🆕 Triage Agent（分诊代理）

### 2.5.1 核心职责

Triage Agent 是整个自动化闭环的"守门人"，负责：

1. **合理性判断** - 判断反馈是否是有效的问题/需求
2. **优先级评估** - 评估问题的紧急程度和影响范围
3. **可行性分析** - 判断是否可以自动处理
4. **路由决策** - 决定走自动修复还是人工处理流程

### 2.5.2 决策流程

```
                    ┌─────────────────────────────────┐
                    │        新反馈到达               │
                    └────────────────┬────────────────┘
                                     ↓
                    ┌─────────────────────────────────┐
                    │      Triage Agent 分析          │
                    │  • 理解问题内容                 │
                    │  • 分析截图/日志                │
                    │  • 查询历史相似问题             │
                    └────────────────┬────────────────┘
                                     ↓
              ┌──────────────────────┼──────────────────────┐
              ↓                      ↓                      ↓
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
    │  有效问题/需求   │   │   无效/重复      │   │   需要澄清       │
    │  (confidence>80%)│   │   (spam/dup)     │   │  (info不足)      │
    └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
             │                     │                     │
             ↓                     ↓                     ↓
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
    │   评估可修复性   │   │   自动关闭       │   │   请求更多信息   │
    │                 │   │   + 通知用户     │   │   + 等待回复     │
    └────────┬────────┘   └─────────────────┘   └─────────────────┘
             │
    ┌────────┴────────────────────────┐
    ↓                                 ↓
┌─────────────────┐          ┌─────────────────┐
│  可自动修复      │          │  需人工介入      │
│  (低风险+高置信) │          │  (复杂/高风险)   │
└────────┬────────┘          └────────┬────────┘
         │                            │
         ↓                            ↓
┌─────────────────┐          ┌─────────────────┐
│  执行自动修复    │          │  创建任务并分配  │
│  + 创建PR       │          │  + 通知研发     │
└─────────────────┘          └─────────────────┘
```

### 2.5.3 决策维度

```typescript
interface TriageDecision {
  // 合理性判断
  validity: {
    isValid: boolean;
    confidence: number; // 0-100
    reason: string;
    invalidReason?: "spam" | "duplicate" | "unclear" | "not_a_bug" | "wont_fix";
  };

  // 分类结果
  classification: {
    type: "bug" | "feature" | "improvement" | "question" | "other";
    subType?: string; // e.g., 'ui_bug', 'logic_error', 'performance'
    affectedModule: string; // e.g., 'ai-office/ppt', 'ai-ask'
  };

  // 优先级评估
  priority: {
    level: "critical" | "high" | "medium" | "low";
    score: number; // 0-100
    factors: {
      userImpact: number; // 影响用户数
      severity: number; // 问题严重程度
      frequency: number; // 发生频率
      businessImpact: number; // 业务影响
    };
  };

  // 处理路由
  routing: {
    action: "auto_fix" | "manual_fix" | "request_info" | "reject" | "defer";
    confidence: number;
    reasoning: string;

    // 如果是自动修复
    autoFixPlan?: {
      approach: string;
      estimatedComplexity: "trivial" | "simple" | "moderate" | "complex";
      riskLevel: "low" | "medium" | "high";
      requiresReview: boolean;
    };

    // 如果需要人工
    manualAssignment?: {
      suggestedOwner?: string;
      estimatedEffort: string; // e.g., "2h", "1d"
      blockers?: string[];
    };
  };

  // 相似问题
  similarIssues: {
    feedbackId: string;
    similarity: number;
    status: string;
    resolution?: string;
  }[];
}
```

### 2.5.4 Agent Prompt 设计

```typescript
const TRIAGE_AGENT_SYSTEM_PROMPT = `
你是 GenesisPod 的反馈分诊专家（Triage Agent）。

你的职责是分析用户提交的反馈，判断其合理性，并决定最佳处理方式。

## 输入信息
你会收到：
1. 反馈标题和描述
2. 截图分析结果（如有）
3. 错误日志/堆栈（如有）
4. 用户环境信息
5. 历史相似问题

## 判断标准

### 1. 合理性判断
- 描述是否清晰、具体
- 是否能复现或理解问题
- 是否属于产品范围内的问题
- 是否与已有反馈重复

### 2. 优先级评估
- Critical: 系统崩溃、数据丢失、安全漏洞
- High: 核心功能不可用、严重影响用户体验
- Medium: 功能异常但有绕过方案
- Low: 视觉问题、小优化

### 3. 可自动修复判断
以下情况可考虑自动修复：
- 文案/Typo 错误
- 简单样式问题
- 明确的配置错误
- 有明确修复模式的已知问题

以下情况需要人工：
- 涉及业务逻辑变更
- 需要产品决策的功能需求
- 影响范围不明确的问题
- 可能有副作用的修改

## 输出格式
返回 JSON 格式的 TriageDecision 对象。
`;
```

### 2.5.5 拒绝策略

| 拒绝原因      | 判断条件             | 处理方式                   |
| ------------- | -------------------- | -------------------------- |
| **垃圾信息**  | 无意义内容、广告     | 直接关闭，不通知           |
| **重复反馈**  | 与已有反馈相似度>90% | 关闭并关联原反馈，通知用户 |
| **信息不足**  | 无法理解问题         | 保持开放，请求补充信息     |
| **非Bug**     | 用户误解产品功能     | 提供使用指导，关闭         |
| **Won't Fix** | 设计如此/超出范围    | 解释原因，关闭             |
| **延期处理**  | 有效但优先级低       | 归档到 Backlog             |

### 2.5.6 自动修复准入条件

```typescript
function canAutoFix(decision: TriageDecision): boolean {
  const { routing, priority, validity } = decision;

  // 必须是有效问题
  if (!validity.isValid || validity.confidence < 80) return false;

  // 路由决策必须是 auto_fix
  if (routing.action !== "auto_fix") return false;

  // 置信度检查
  if (routing.confidence < 85) return false;

  // 风险检查
  if (routing.autoFixPlan?.riskLevel === "high") return false;

  // 复杂度检查
  if (
    ["moderate", "complex"].includes(
      routing.autoFixPlan?.estimatedComplexity || "",
    )
  ) {
    return false;
  }

  // Critical 问题需要人工确认
  if (priority.level === "critical") return false;

  return true;
}
```

---

## 三、详细设计

### 3.1 反馈事件系统

```typescript
// feedback-events.ts
export enum FeedbackEvent {
  CREATED = "feedback.created",
  ANALYZED = "feedback.analyzed",
  FIX_STARTED = "feedback.fix.started",
  FIX_COMPLETED = "feedback.fix.completed",
  FIX_FAILED = "feedback.fix.failed",
  RESOLVED = "feedback.resolved",
  CLOSED = "feedback.closed",
}

export interface FeedbackEventPayload {
  feedbackId: string;
  type: "BUG" | "FEATURE" | "IMPROVEMENT" | "OTHER";
  title: string;
  description: string;
  attachments: Attachment[];
  metadata: {
    userEmail?: string;
    pageUrl?: string;
    userAgent?: string;
    errorStack?: string;
    consoleErrors?: string[];
  };
}
```

### 3.2 AI 分析器

#### 3.2.1 分析能力矩阵

| 输入类型   | 分析能力            | 输出               |
| ---------- | ------------------- | ------------------ |
| 文字描述   | NLP理解 + 意图识别  | 问题分类、关键词   |
| 截图       | Vision OCR + UI识别 | 错误信息、页面定位 |
| 错误堆栈   | 代码分析            | 出错文件、行号     |
| 控制台日志 | 日志解析            | 错误模式识别       |

#### 3.2.2 分析输出结构

```typescript
interface FeedbackAnalysis {
  // 问题分类
  category:
    | "ui_bug"
    | "logic_error"
    | "performance"
    | "feature_request"
    | "ux_improvement";
  severity: "critical" | "high" | "medium" | "low";

  // 问题定位
  affectedModule: string; // e.g., "ai-office/ppt"
  affectedFiles: string[]; // e.g., ["frontend/components/..."]
  errorLocation?: {
    file: string;
    line: number;
    column: number;
  };

  // 问题理解
  summary: string; // AI 生成的问题摘要
  rootCause: string; // 推测的根因
  reproductionSteps: string[]; // 复现步骤

  // 解决方案
  suggestedFix: {
    type: "auto_fix" | "manual_fix" | "needs_investigation";
    confidence: number; // 0-100
    description: string;
    codeChanges?: CodeChange[]; // 如果可自动修复
  };

  // 相似问题
  similarIssues: {
    feedbackId: string;
    similarity: number;
    resolution?: string;
  }[];
}
```

### 3.3 自动修复引擎

#### 3.3.1 可自动修复的问题类型

| 问题类型      | 自动修复策略 | 置信度阈值 |
| ------------- | ------------ | ---------- |
| 文案错误/Typo | 直接替换     | 95%        |
| 样式问题      | CSS调整      | 90%        |
| 缺失翻译      | i18n补充     | 85%        |
| 简单逻辑错误  | 代码修复     | 80%        |
| 配置问题      | 配置更新     | 90%        |

#### 3.3.2 修复流程

```
问题分析结果
     ↓
[置信度 >= 阈值?] ──否──→ 创建 GitHub Issue + 通知研发
     │
    是
     ↓
创建修复分支 (fix/feedback-{id})
     ↓
应用代码修改
     ↓
运行测试套件
     ↓
[测试通过?] ──否──→ 回滚 + 通知研发人工处理
     │
    是
     ↓
创建 Pull Request
     ↓
[需要审核?] ──是──→ 请求代码审核
     │
    否 (低风险修复)
     ↓
自动合并 + 部署
     ↓
更新反馈状态为 RESOLVED
     ↓
通知用户问题已修复
```

### 3.4 通知系统

#### 3.4.1 通知渠道配置

```typescript
interface NotificationConfig {
  // 飞书/Lark
  feishu?: {
    webhookUrl: string;
    mentionUsers?: string[]; // @具体人
    atAll?: boolean; // @所有人（仅高优先级）
  };

  // 钉钉
  dingtalk?: {
    webhookUrl: string;
    secret?: string;
  };

  // Slack
  slack?: {
    webhookUrl: string;
    channel: string;
  };

  // GitHub
  github?: {
    repo: string;
    labels: string[];
    assignees?: string[];
  };
}
```

#### 3.4.2 通知模板

**飞书卡片消息示例**:

```
🐛 新用户反馈 #FB-20241225-001

【问题类型】BUG - 高优先级
【影响模块】AI Office / PPT生成
【问题摘要】生成的PPT页面布局溢出

📸 截图分析:
- 检测到第5页内容超出安全区域
- 可能原因: bullet points 过多导致溢出

🤖 AI诊断:
- 置信度: 85%
- 建议修复: 调整 slide-renderer.service.ts 的 MAX_BULLETS 限制

[查看详情] [开始修复] [标记为误报]
```

### 3.5 闭环追踪

#### 3.5.1 状态机

```
PENDING ─────────────────────────────────────────────────────────→ CLOSED
    │                                                                  ↑
    ↓                                                                  │
ANALYZING ──→ ANALYZED ──→ FIX_IN_PROGRESS ──→ FIX_DEPLOYED ──→ RESOLVED
    │              │              │                                    ↑
    │              │              ↓                                    │
    │              │         NEEDS_MANUAL ──→ ASSIGNED ────────────────┘
    │              │
    │              └──→ CANNOT_REPRODUCE ──→ NEED_MORE_INFO
    │
    └──→ ANALYSIS_FAILED ──→ NEEDS_MANUAL
```

#### 3.5.2 时间线记录

```typescript
interface FeedbackTimeline {
  feedbackId: string;
  events: {
    timestamp: Date;
    event: string;
    actor: 'system' | 'ai' | 'human';
    details: Record<string, any>;
  }[];
}

// 示例时间线
{
  feedbackId: "fb-001",
  events: [
    { timestamp: "10:00:00", event: "feedback.created", actor: "system", details: {} },
    { timestamp: "10:00:05", event: "analysis.started", actor: "ai", details: {} },
    { timestamp: "10:00:15", event: "analysis.completed", actor: "ai", details: { confidence: 85 } },
    { timestamp: "10:00:20", event: "fix.started", actor: "ai", details: { branch: "fix/fb-001" } },
    { timestamp: "10:02:00", event: "fix.pr_created", actor: "ai", details: { pr: "#123" } },
    { timestamp: "10:05:00", event: "fix.merged", actor: "human", details: { reviewer: "dev@team" } },
    { timestamp: "10:10:00", event: "deployed", actor: "system", details: { env: "production" } },
    { timestamp: "10:10:05", event: "user.notified", actor: "system", details: {} },
    { timestamp: "10:10:10", event: "status.resolved", actor: "system", details: {} },
  ]
}
```

---

## 四、技术实现

### 4.1 新增文件结构

```
backend/src/modules/ai-infra/feedback/
├── feedback.module.ts              # 更新
├── feedback.service.ts             # 更新
├── feedback.controller.ts          # 更新
├── dto/
│   └── create-feedback.dto.ts      # 现有
├── events/
│   ├── feedback-events.ts          # 新增: 事件定义
│   └── feedback-event.listener.ts  # 新增: 事件监听器
├── triage/                         # 🆕 分诊代理
│   ├── triage-agent.service.ts         # 新增: 分诊Agent核心逻辑
│   ├── triage-decision.types.ts        # 新增: 决策类型定义
│   ├── similarity-matcher.service.ts   # 新增: 相似问题匹配
│   └── triage-rules.config.ts          # 新增: 分诊规则配置
├── analyzer/
│   ├── feedback-analyzer.service.ts    # 新增: AI分析服务
│   ├── screenshot-analyzer.service.ts  # 新增: 截图分析(Vision)
│   └── error-stack-parser.service.ts   # 新增: 错误堆栈解析
├── resolver/
│   ├── feedback-resolver.service.ts    # 新增: 自动修复服务
│   ├── code-fix-generator.service.ts   # 新增: 代码修复生成
│   └── github-integration.service.ts   # 新增: GitHub集成
├── notifier/
│   ├── feedback-notifier.service.ts    # 新增: 通知服务
│   ├── feishu-notifier.service.ts      # 新增: 飞书通知
│   ├── dingtalk-notifier.service.ts    # 新增: 钉钉通知
│   └── slack-notifier.service.ts       # 新增: Slack通知
└── tracker/
    ├── feedback-tracker.service.ts     # 新增: 进度追踪
    └── feedback-timeline.service.ts    # 新增: 时间线记录
```

### 4.2 数据库扩展

```sql
-- 添加分析结果字段
ALTER TABLE feedbacks ADD COLUMN analysis JSONB;
ALTER TABLE feedbacks ADD COLUMN timeline JSONB DEFAULT '[]';
ALTER TABLE feedbacks ADD COLUMN auto_fix_result JSONB;
ALTER TABLE feedbacks ADD COLUMN github_issue_url TEXT;
ALTER TABLE feedbacks ADD COLUMN github_pr_url TEXT;

-- 添加索引
CREATE INDEX idx_feedbacks_status ON feedbacks(status);
CREATE INDEX idx_feedbacks_created_at ON feedbacks(created_at DESC);
```

### 4.3 环境变量

```env
# AI 分析
FEEDBACK_AI_MODEL=gpt-4-vision-preview
FEEDBACK_ANALYSIS_ENABLED=true

# GitHub 集成
GITHUB_TOKEN=ghp_xxx
GITHUB_REPO=owner/genesis
GITHUB_AUTO_PR_ENABLED=true

# 通知配置
FEISHU_WEBHOOK_URL=https://open.feishu.cn/...
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/...
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

# 自动修复配置
AUTO_FIX_ENABLED=true
AUTO_FIX_CONFIDENCE_THRESHOLD=85
AUTO_MERGE_LOW_RISK=false
```

---

## 五、实施计划

### Phase 1: 事件系统 + Triage Agent (Week 1)

- [ ] 实现 FeedbackEventEmitter
- [ ] 🆕 实现 Triage Agent 核心逻辑
- [ ] 🆕 实现相似问题匹配服务
- [ ] 🆕 实现分诊决策规则引擎
- [ ] 集成 GPT-4V 进行截图分析
- [ ] 实现问题分类和定位
- [ ] 添加分析结果存储

### Phase 2: 通知系统 (Week 1)

- [ ] 实现飞书 Webhook 通知
- [ ] 实现 GitHub Issue 自动创建
- [ ] 添加通知模板和格式化
- [ ] 🆕 添加分诊结果通知（研发群）

### Phase 3: 自动修复 (Week 2)

- [ ] 实现简单问题自动修复
- [ ] 集成 Git 操作
- [ ] 实现 PR 自动创建
- [ ] 添加测试验证流程
- [ ] 🆕 添加风险评估和人工审批流程

### Phase 4: 闭环追踪 (Week 2)

- [ ] 实现状态机
- [ ] 实现时间线记录
- [ ] 实现用户通知
- [ ] 添加统计报表
- [ ] 🆕 添加分诊准确率监控

---

## 六、风险与应对

| 风险               | 影响         | 应对措施                       |
| ------------------ | ------------ | ------------------------------ |
| AI 分析错误        | 误判问题     | 设置置信度阈值，低于阈值转人工 |
| 自动修复引入新 bug | 系统不稳定   | 强制测试通过，高风险需人工审核 |
| 通知过多干扰       | 研发效率下降 | 智能聚合，设置静默时间         |
| 隐私泄露           | 合规风险     | 脱敏处理，审计日志             |

---

## 七、成功指标

| 指标               | 目标               | 测量方式             |
| ------------------ | ------------------ | -------------------- |
| 首次响应时间       | < 5分钟            | 从创建到首次分析完成 |
| AI 分析准确率      | > 80%              | 人工验证抽样         |
| 自动修复成功率     | > 90% (尝试的问题) | 修复后测试通过率     |
| 简单问题自动解决率 | > 30%              | 无需人工介入的闭环   |
| 用户满意度         | > 4.0/5.0          | 反馈后调查           |

---

## 附录 A: API 设计

### A.1 获取反馈分析结果

```
GET /api/feedback/{id}/analysis

Response:
{
  "feedbackId": "fb-001",
  "analysis": { ... },
  "timeline": [ ... ],
  "suggestedActions": ["auto_fix", "create_issue"]
}
```

### A.2 触发自动修复

```
POST /api/feedback/{id}/auto-fix

Response:
{
  "success": true,
  "branch": "fix/fb-001",
  "prUrl": "https://github.com/.../pull/123"
}
```

### A.3 更新反馈状态

```
PATCH /api/feedback/{id}/status

Body:
{
  "status": "RESOLVED",
  "resolution": "Auto-fixed in PR #123"
}
```
