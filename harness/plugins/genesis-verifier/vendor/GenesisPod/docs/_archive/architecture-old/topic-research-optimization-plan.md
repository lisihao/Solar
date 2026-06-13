# Topic Research 产品设计审视与优化方案

> **版本**: v1.0
> **日期**: 2026-01-13
> **作者**: AI 产品经理
> **状态**: 设计评审

---

## 目录

1. [核心问题与解答](#一核心问题与解答)
2. [现有实现分析](#二现有实现分析)
3. [优化方案设计](#三优化方案设计)
4. [实施路线图](#四实施路线图)
5. [技术设计要点](#五技术设计要点)

---

## 一、核心问题与解答

### 1.1 增量更新机制：如何在上次基础上更新？

**现有实现：**

- ResearchChange 表进行段落级 Diff 检测
- 每次研究生成新版本 (TopicReport.version 递增)
- **不足：没有真正的"增量更新"逻辑**

**现状问题：**

```
当前流程：
用户点击"刷新研究" → 完全重新研究所有维度 → 生成全新报告 → 与上一版本做 Diff

实际应该是：
用户点击"刷新研究" → 检测哪些维度数据过时 → 只更新过时维度 → 合并生成报告
```

**优化建议方案：**

```typescript
// 新增：维度数据新鲜度检测
interface DimensionFreshnessCheck {
  dimensionId: string;
  lastUpdated: Date;
  dataSourcesCount: number;
  hasNewSources: boolean;      // 是否有新数据源
  staleSources: number;        // 过时来源数量
  recommendation: "KEEP" | "UPDATE" | "REFRESH";
}

// 增量更新流程
async incrementalRefresh(topicId: string) {
  // 1. 检查每个维度的数据新鲜度
  const freshnessReport = await checkDimensionFreshness(topicId);

  // 2. 只更新需要更新的维度
  const dimensionsToUpdate = freshnessReport
    .filter(d => d.recommendation !== "KEEP");

  // 3. 保留未变化的维度分析结果
  const existingAnalysis = await getExistingDimensionAnalysis(topicId);

  // 4. 合并新旧结果生成报告
  await synthesizeReport(existingAnalysis, newAnalysis);
}
```

---

### 1.2 变更追踪：用户如何看到每次更新了什么？

**现有实现：**

- `TopicReportRevision` 记录每次修订
- `ReportChange` 表存储段落级变更
- `compareReports` API 支持版本对比
- **不足：前端没有直观的变更展示界面**

**优化建议方案：变更审核界面**

```
┌─────────────────────────────────────────────────────────────────┐
│  报告更新摘要 (2026-01-13 v3)                                    │
├─────────────────────────────────────────────────────────────────┤
│  本次更新概览                                                    │
│  ├─ 新增内容: 3 处 (+1,245 字)                                  │
│  ├─ 修改内容: 5 处                                              │
│  ├─ 删除内容: 1 处 (-320 字)                                    │
│  └─ 更新维度: 技术原理、市场概览                                 │
├─────────────────────────────────────────────────────────────────┤
│  变更详情                            [全部确认] [逐条审核]        │
│                                                                 │
│  ┌─ [新增] 第3章：最新技术进展                                  │
│  │  + "2025年底，OpenAI发布了GPT-5..."                         │
│  │  引用来源: Reuters, TechCrunch                               │
│  │                                    [确认] [撤销]             │
│  │                                                             │
│  ├─ [修改] 执行摘要                                             │
│  │  - "市场规模达到500亿美元"                                   │
│  │  + "市场规模已突破680亿美元"                                 │
│  │  数据更新来源: Gartner 2025报告                              │
│  │                                    [确认] [撤销]             │
│  └─ ...                                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.3 可信度：如何让用户相信分析是完整可靠的？

**现有实现：**

- `qualityScore` 质量评分
- `TopicEvidence` 证据管理
- 引用标记 `[1]` 链接到原文
- **不足：缺乏透明的"可信度报告"**

**优化建议方案：新增「研究可信度面板」**

```
┌─────────────────────────────────────────────────────────────────┐
│  研究可信度报告                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  整体可信度: ████████░░ 85%                                    │
│                                                                 │
│  ┌─ 数据来源评估 ──────────────────────────────────────────────│
│  │  • 权威来源 (政府/学术): 23 篇 (42%)                        │
│  │  • 行业报告: 18 篇 (33%)                                    │
│  │  • 新闻媒体: 14 篇 (25%)                                    │
│  │  来源多样性: ★★★★☆                                          │
│  │                                                             │
│  ├─ 时效性评估 ────────────────────────────────────────────────│
│  │  • 1个月内: 28 篇 (51%)                                     │
│  │  • 1-3个月: 15 篇 (27%)                                     │
│  │  • 3个月以上: 12 篇 (22%)                                   │
│  │  时效性: ★★★★☆                                              │
│  │                                                             │
│  ├─ 覆盖度评估 ────────────────────────────────────────────────│
│  │  ✓ 技术原理: 充分 (12/10 来源)                              │
│  │  ✓ 市场概览: 充分 (15/10 来源)                              │
│  │  ! 专利分析: 一般 (6/10 来源)                               │
│  │  ✗ 人才生态: 不足 (3/10 来源)                               │
│  │                                                             │
│  ├─ AI 分析质量 ───────────────────────────────────────────────│
│  │  • Leader 规划次数: 2 轮                                    │
│  │  • Agent 修订次数: 平均 1.5 轮/章节                          │
│  │  • 审核通过率: 92%                                          │
│  │                                                             │
│  └─ 局限性声明 ────────────────────────────────────────────────│
│     ! 专利数据仅覆盖中美两国                                    │
│     ! 人才生态数据来源有限，建议补充调研                        │
│     ! 部分预测基于历史趋势外推                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.4 信息组织：团队互动区和Agent思考区如何清晰呈现？

**现有问题：**

- 所有消息混在一起，缺乏层次
- Agent 思考过程只显示任务和结果，缺乏中间推理
- 多次研究的历史记录无法区分

**优化建议方案：三层信息架构**

```
┌─────────────────────────────────────────────────────────────────┐
│  研究历史时间线                    [本次] [上一次] [全部历史]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ═══ 第3次研究 (2026-01-13 14:30) ═══════════════════════════  │
│                                                                 │
│  ┌─ 研究规划 (Leader) ─────────────────────────────────────────│
│  │  目标: 更新市场数据和技术进展                                │
│  │  策略: 重点刷新"技术原理"和"市场概览"两个维度               │
│  │  预计: 3个Agent并行，约15分钟                               │
│  │                                      [展开详细规划]          │
│  │                                                             │
│  ├─ 维度研究进展 ──────────────────────────────────────────────│
│  │                                                             │
│  │  ┌─ 技术原理研究员 ────────────────────────────────────────│
│  │  │  ✓ 完成 | 耗时 8分钟 | 引用 12 篇                        │
│  │  │                                                         │
│  │  │  思考过程:                          [收起]               │
│  │  │  ├─ 理解阶段 (0:00-0:45)                                │
│  │  │  │  "分析维度要求：需要覆盖AI基础理论、模型架构..."     │
│  │  │  │                                                       │
│  │  │  ├─ 搜索阶段 (0:45-3:20)                                │
│  │  │  │  "检索到 45 条相关结果，筛选权威来源..."             │
│  │  │  │  来源: arXiv(12), IEEE(8), Nature(5)...              │
│  │  │  │                                                       │
│  │  │  ├─ 撰写阶段 (3:20-6:40)                                │
│  │  │  │  章节1: Transformer架构演进 → 审核通过               │
│  │  │  │  章节2: 多模态融合技术 → 修订1次后通过               │
│  │  │  │  章节3: 效率优化方法 → 审核通过                      │
│  │  │  │                                                       │
│  │  │  └─ 整合阶段 (6:40-8:00)                                │
│  │  │     "整合3个章节，生成维度分析报告..."                  │
│  │  │                                                         │
│  │  │  关键发现:                                               │
│  │  │  • GPT-5 采用了新的 MoE 架构                            │
│  │  │  • 推理效率提升 40%                                      │
│  │  └────────────────────────────────────────────────────────│
│  │                                                             │
│  │  ┌─ 市场概览研究员 ────────────────────────────────────────│
│  │  │  进行中 (75%) | 已耗时 6分钟                            │
│  │  │  当前: 撰写"竞争格局"章节                               │
│  │  └────────────────────────────────────────────────────────│
│  │                                                             │
│  ├─ 团队互动 ──────────────────────────────────────────────────│
│  │  14:32 [Leader] 规划完成，开始分配任务                      │
│  │  14:35 [技术原理研究员] 发现重要更新：GPT-5 技术文档已公开  │
│  │  14:38 [用户] @Leader 请重点关注开源模型的进展              │
│  │  14:39 [Leader] 收到，已通知相关研究员补充开源模型内容      │
│  │                                                             │
│  └─ 研究成果 ──────────────────────────────────────────────────│
│     报告更新: +2,340 字 | 新增引用: 18 篇                      │
│     [查看变更详情] [对比上一版本]                              │
│                                                                 │
│  ═══ 第2次研究 (2026-01-06 10:15) ═══════════════════════════  │
│  ...                                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.5 团队协作：是否支持多人协作审核？

**现有实现：**

- `TopicCollaborator` 支持邀请协作者
- `TopicVisibility` 支持私有/共享/公开
- 角色权限: VIEWER / EDITOR / ADMIN
- **不足：缺乏协作审核流程**

**优化建议方案：新增「协作审核工作流」**

```
┌─────────────────────────────────────────────────────────────────┐
│  协作审核面板                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  当前协作者:                                                    │
│  ├─ 张三 (Owner) - 在线                                        │
│  ├─ 李四 (Editor) - 正在审核"技术原理"章节                     │
│  └─ 王五 (Viewer) - 离线                                       │
│                                                                 │
│  ┌─ 审核任务分配 ──────────────────────────────────────────────│
│  │                                                             │
│  │  章节              负责人      状态      截止时间            │
│  │  ────────────────────────────────────────────────────────   │
│  │  执行摘要          张三        ✓ 已审核   -                  │
│  │  技术原理          李四        ~ 审核中   今天 18:00         │
│  │  市场概览          待分配      - 待审核   明天 12:00         │
│  │  竞争格局          王五        - 待审核   明天 12:00         │
│  │                                                             │
│  │                            [分配任务] [催促审核]            │
│  │                                                             │
│  ├─ 审核意见汇总 ──────────────────────────────────────────────│
│  │                                                             │
│  │  李四 (技术原理 - 第3段):                                   │
│  │  "这里的数据需要更新，目前引用的是2024年的报告"            │
│  │  状态: 待处理                    [接受] [讨论] [忽略]       │
│  │                                                             │
│  │  张三 (执行摘要):                                           │
│  │  "整体结构清晰，建议补充一句关于风险的总结"                │
│  │  状态: 已采纳                                               │
│  │                                                             │
│  └─ 版本发布 ──────────────────────────────────────────────────│
│     ! 还有 2 个章节待审核                                      │
│     审核进度: ████████░░ 75%                                   │
│                                                                 │
│     [保存草稿] [发布为正式版本]                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、现有实现分析

### 2.1 架构优势

| 优势项   | 说明                                               |
| -------- | -------------------------------------------------- |
| 分层清晰 | Controller → Service → Repository 标准分层         |
| 事件驱动 | EventEmitter2 进行实时推送和日志记录               |
| 版本管理 | TopicReport + TopicReportRevision 完整版本控制     |
| 变更追踪 | ReportChange 表支持段落级 Diff 和 Checkin          |
| 团队交互 | ResearchTeamMessage + ResearchAgentActivity 持久化 |
| 并行处理 | 多维度并行研究，提高效率                           |
| 权限控制 | TopicCollaborator + Visibility 支持多角色协作      |
| 模板系统 | 预定义维度模板，开箱即用                           |

### 2.2 功能完整性

| 功能      | 状态 | 说明                               |
| --------- | ---- | ---------------------------------- |
| 完整 CRUD | ✓    | Topic、Dimension、Report 全操作    |
| 高级编辑  | ✓    | AI 编辑、手动编辑、版本回滚        |
| 批注系统  | ✓    | 创建、更新、解决批注，支持状态流转 |
| 导出功能  | ✓    | PDF/DOCX 导出集成                  |
| 对比工具  | ✓    | 版本之间的差异对比                 |
| 定时刷新  | ✓    | TopicRefreshScheduler 支持自动化   |
| 证据管理  | ✓    | EvidenceManagementService 追踪来源 |
| 质量审核  | ✓    | ResearchReviewerService 多层验证   |

### 2.3 现有问题

| 问题                     | 影响                             | 严重程度 |
| ------------------------ | -------------------------------- | -------- |
| Mission 与 Task 关系冗余 | 代码复杂度高                     | 中       |
| 团队消息持久化不完整     | Agent 活动没有关联到具体 Message | 高       |
| 增量更新逻辑简单         | 每次全量刷新，效率低             | 高       |
| 实时性依赖轮询           | 前端 2 秒轮询一次，效率低        | 中       |
| 缺少数据一致性保证       | 取消后数据清理不完善             | 中       |
| Agent 权限与隔离         | 并发执行缺乏资源隔离             | 低       |

---

## 三、优化方案设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Topic Research 优化架构                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│  │  增量更新    │────▶│  变更追踪    │────▶│  可信度报告  │              │
│  │  引擎       │     │  系统       │     │  生成       │              │
│  └─────────────┘     └─────────────┘     └─────────────┘              │
│         │                   │                   │                      │
│         ▼                   ▼                   ▼                      │
│  ┌─────────────────────────────────────────────────────┐              │
│  │                   统一展示层                          │              │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │              │
│  │  │ 研究时间线 │  │ 变更审核  │  │ 可信度面板 │          │              │
│  │  └──────────┘  └──────────┘  └──────────┘          │              │
│  └─────────────────────────────────────────────────────┘              │
│         │                   │                   │                      │
│         ▼                   ▼                   ▼                      │
│  ┌─────────────────────────────────────────────────────┐              │
│  │                   协作工作流                          │              │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │              │
│  │  │ 任务分配  │  │ 审核流程  │  │ 版本发布  │          │              │
│  │  └──────────┘  └──────────┘  └──────────┘          │              │
│  └─────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 新增数据模型

#### 3.2.1 维度新鲜度检测

```prisma
model DimensionFreshness {
  id              String   @id @default(cuid())
  topicId         String   @map("topic_id")
  dimensionId     String   @map("dimension_id")

  // 新鲜度指标
  lastAnalyzedAt  DateTime @map("last_analyzed_at")
  sourcesCount    Int      @map("sources_count")
  newSourcesCount Int      @map("new_sources_count")
  staleSourcesCount Int    @map("stale_sources_count")

  // 推荐操作
  recommendation  String   // KEEP | UPDATE | REFRESH
  confidenceScore Float    @map("confidence_score")

  // 检查时间
  checkedAt       DateTime @map("checked_at")

  @@index([topicId, dimensionId])
  @@map("dimension_freshness")
}
```

#### 3.2.2 可信度报告

```prisma
model CredibilityReport {
  id              String   @id @default(cuid())
  reportId        String   @map("report_id")

  // 整体评分
  overallScore    Float    @map("overall_score")

  // 来源评估
  authorityScore  Float    @map("authority_score")    // 权威性
  diversityScore  Float    @map("diversity_score")    // 多样性
  timelinessScore Float    @map("timeliness_score")   // 时效性
  coverageScore   Float    @map("coverage_score")     // 覆盖度

  // 详细数据 (JSON)
  sourceBreakdown Json     @map("source_breakdown")
  timeBreakdown   Json     @map("time_breakdown")
  coverageDetails Json     @map("coverage_details")
  limitations     String[] // 局限性声明列表

  createdAt       DateTime @default(now())

  @@index([reportId])
  @@map("credibility_reports")
}
```

#### 3.2.3 协作审核任务

```prisma
model ReviewTask {
  id              String   @id @default(cuid())
  reportId        String   @map("report_id")
  sectionId       String?  @map("section_id")
  sectionName     String   @map("section_name")

  // 分配信息
  assigneeId      String?  @map("assignee_id")
  assigneeName    String?  @map("assignee_name")
  assignedAt      DateTime? @map("assigned_at")
  dueAt           DateTime? @map("due_at")

  // 状态
  status          String   // PENDING | IN_PROGRESS | COMPLETED | SKIPPED
  completedAt     DateTime? @map("completed_at")

  // 审核结果
  approved        Boolean?
  comments        String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([reportId, status])
  @@map("review_tasks")
}
```

### 3.3 Agent 思考过程增强

```prisma
// 扩展现有 ResearchAgentActivity 模型
model ResearchAgentActivity {
  // ... 现有字段 ...

  // 新增：思考链详情
  thinkingPhase   String?  @map("thinking_phase")  // understanding | searching | writing | integrating
  thinkingContent String?  @map("thinking_content") @db.Text

  // 新增：阶段性指标
  searchResults   Json?    @map("search_results")   // { total, filtered, sources[] }
  writingProgress Json?    @map("writing_progress") // { sections[], current, revisions }

  // 新增：时间追踪
  phaseStartedAt  DateTime? @map("phase_started_at")
  phaseEndedAt    DateTime? @map("phase_ended_at")
}
```

---

## 四、实施路线图

### 4.1 优先级矩阵

| 优化项            | 用户价值 | 实现复杂度 | 优先级 |
| ----------------- | -------- | ---------- | ------ |
| 变更审核界面      | ★★★★★    | ★★☆☆☆      | **P0** |
| Agent思考过程展示 | ★★★★☆    | ★★☆☆☆      | **P0** |
| 研究历史时间线    | ★★★★☆    | ★★★☆☆      | **P1** |
| 可信度报告面板    | ★★★★★    | ★★★☆☆      | **P1** |
| 增量更新引擎      | ★★★★☆    | ★★★★☆      | **P2** |
| 协作审核工作流    | ★★★☆☆    | ★★★★☆      | **P2** |

### 4.2 实施阶段

#### Phase 1: 信息展示优化 (1-2周)

**目标**: 让用户看得清楚

| 任务                      | 工作量 | 依赖     |
| ------------------------- | ------ | -------- |
| 实现变更审核界面组件      | 3天    | 无       |
| 完善 Agent 思考过程持久化 | 2天    | 无       |
| 优化团队互动区信息层次    | 2天    | 无       |
| 前端 UI 组件开发          | 3天    | 上述任务 |

**交付物**:

- `ChangeReviewPanel.tsx` - 变更审核面板组件
- `AgentThinkingTimeline.tsx` - Agent 思考时间线组件
- `TeamActivityPanel.tsx` - 团队活动面板组件 (优化版)

#### Phase 2: 可信度与追溯 (2-3周)

**目标**: 让用户信得过

| 任务               | 工作量 | 依赖     |
| ------------------ | ------ | -------- |
| 设计可信度评估算法 | 2天    | 无       |
| 实现可信度报告服务 | 3天    | 算法设计 |
| 实现研究历史时间线 | 3天    | Phase 1  |
| 完善引用溯源功能   | 2天    | 无       |
| 前端 UI 组件开发   | 4天    | 上述任务 |

**交付物**:

- `CredibilityReportService` - 可信度报告服务
- `CredibilityPanel.tsx` - 可信度面板组件
- `ResearchTimeline.tsx` - 研究历史时间线组件

#### Phase 3: 智能更新与协作 (3-4周)

**目标**: 让用户用得爽

| 任务                   | 工作量 | 依赖       |
| ---------------------- | ------ | ---------- |
| 实现维度新鲜度检测服务 | 3天    | 无         |
| 实现增量更新引擎       | 4天    | 新鲜度服务 |
| 实现协作审核工作流     | 4天    | 无         |
| 优化实时通信机制       | 3天    | 无         |
| 前端 UI 组件开发       | 5天    | 上述任务   |

**交付物**:

- `DimensionFreshnessService` - 维度新鲜度服务
- `IncrementalRefreshService` - 增量刷新服务
- `ReviewWorkflowService` - 审核工作流服务
- `CollaborationPanel.tsx` - 协作面板组件

---

## 五、技术设计要点

### 5.1 变更审核界面技术方案

```typescript
// frontend/components/ai-research/ChangeReviewPanel.tsx

interface ReportChange {
  id: string;
  changeType: "ADDED" | "MODIFIED" | "DELETED";
  sectionName: string;
  previousContent: string;
  currentContent: string;
  wordsDiff: number;
  checkedInAt: Date | null;
  checkedInById: string | null;
}

interface ChangeReviewPanelProps {
  reportId: string;
  changes: ReportChange[];
  onCheckin: (changeId: string) => Promise<void>;
  onCheckinAll: (changeIds: string[]) => Promise<void>;
  onRevert: (changeId: string) => Promise<void>;
}

// 变更高亮样式
const changeStyles = {
  ADDED: "bg-green-50 border-l-4 border-green-500",
  MODIFIED: "bg-yellow-50 border-l-4 border-yellow-500",
  DELETED: "bg-red-50 border-l-4 border-red-500 line-through",
};
```

### 5.2 可信度计算算法

```typescript
// backend/src/modules/ai-app/research/topic-research/services/credibility.service.ts

interface CredibilityMetrics {
  // 权威性评分 (0-100)
  authorityScore: number;
  // 多样性评分 (0-100)
  diversityScore: number;
  // 时效性评分 (0-100)
  timelinessScore: number;
  // 覆盖度评分 (0-100)
  coverageScore: number;
}

function calculateCredibility(evidence: TopicEvidence[]): CredibilityMetrics {
  // 1. 权威性: 按来源类型加权
  const authorityWeights = {
    government: 1.0,
    academic: 0.95,
    industry_report: 0.85,
    news_major: 0.75,
    news_other: 0.5,
    blog: 0.3,
  };

  // 2. 多样性: 香农熵计算
  // H = -Σ p(x) * log2(p(x))

  // 3. 时效性: 指数衰减
  // score = e^(-λt), λ = 0.05, t = days

  // 4. 覆盖度: 各维度来源数 / 目标来源数

  return { authorityScore, diversityScore, timelinessScore, coverageScore };
}
```

### 5.3 增量更新流程

```typescript
// backend/src/modules/ai-app/research/topic-research/services/incremental-refresh.service.ts

async incrementalRefresh(topicId: string): Promise<RefreshResult> {
  // 1. 获取当前报告和维度分析
  const currentReport = await this.getLatestReport(topicId);
  const dimensions = await this.getDimensions(topicId);

  // 2. 检查每个维度的新鲜度
  const freshnessChecks = await Promise.all(
    dimensions.map(d => this.checkDimensionFreshness(d))
  );

  // 3. 筛选需要更新的维度
  const staleList = freshnessChecks.filter(
    f => f.recommendation !== 'KEEP'
  );

  // 4. 只更新过时的维度
  const newAnalyses = await Promise.all(
    staleList.map(s => this.refreshDimension(s.dimensionId))
  );

  // 5. 合并新旧分析结果
  const mergedAnalyses = this.mergeAnalyses(
    currentReport.dimensionAnalyses,
    newAnalyses
  );

  // 6. 重新生成报告
  const newReport = await this.synthesizeReport(mergedAnalyses);

  // 7. 检测并记录变更
  await this.detectAndRecordChanges(currentReport, newReport);

  return {
    reportId: newReport.id,
    updatedDimensions: staleList.map(s => s.dimensionId),
    keptDimensions: freshnessChecks
      .filter(f => f.recommendation === 'KEEP')
      .map(f => f.dimensionId),
  };
}
```

### 5.4 实时通信优化

```typescript
// 升级为 WebSocket + 降级轮询的双通道模式

class RealtimeChannel {
  private ws: WebSocket | null = null;
  private pollingInterval: NodeJS.Timer | null = null;
  private eventQueue: QueuedEvent[] = [];

  connect(topicId: string) {
    // 尝试 WebSocket 连接
    this.ws = new WebSocket(`wss://api/topics/${topicId}/events`);

    this.ws.onopen = () => {
      // 连接成功，停止轮询
      this.stopPolling();
      // 处理离线期间的事件队列
      this.flushQueue();
    };

    this.ws.onerror = () => {
      // 降级到轮询模式
      this.startPolling(topicId);
    };

    this.ws.onclose = () => {
      // 尝试重连，带指数退避
      this.reconnect(topicId);
    };
  }

  private startPolling(topicId: string) {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      const events = await fetchEvents(topicId, this.lastEventId);
      events.forEach((e) => this.handleEvent(e));
    }, 2000);
  }
}
```

---

## 附录

### A. 关键文件清单

| 类别         | 核心文件                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------ |
| 前端存储     | `frontend/stores/topicResearchStore.ts`                                                          |
| 前端布局     | `frontend/components/ai-research/TopicResearchLayout.tsx`                                        |
| 前端详情     | `frontend/components/ai-research/TopicDetail.tsx`                                                |
| 后端服务     | `backend/src/modules/ai-app/research/topic-research/topic-research.service.ts`                   |
| 业务编排     | `backend/src/modules/ai-app/research/topic-research/services/topic-team-orchestrator.service.ts` |
| Mission 管理 | `backend/src/modules/ai-app/research/topic-research/services/research-mission.service.ts`        |
| 事件系统     | `backend/src/modules/ai-app/research/topic-research/services/research-event-emitter.service.ts`  |
| 变更追踪     | `backend/src/modules/ai-app/research/topic-research/services/report-change.service.ts`           |

### B. 相关文档

- [Topic Research PRD v1.0](../prd/topic-research/topic-research-prd-v1.0.md)
- [Topic Research UI 优化](../prd/topic-research-ui-optimization.md)
- [Topic Research Leader 交互](../prd/topic-research-leader-interaction.md)
- [Topic Research 重构设计 v7](./topic-research-redesign-v7.md)

---

**文档版本历史**

| 版本 | 日期       | 作者  | 变更说明                   |
| ---- | ---------- | ----- | -------------------------- |
| v1.0 | 2026-01-13 | AI PM | 初始版本，完成产品设计审视 |
