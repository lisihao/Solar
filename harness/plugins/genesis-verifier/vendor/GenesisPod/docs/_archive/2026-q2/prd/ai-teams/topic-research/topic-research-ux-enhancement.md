# 专题研究 UX 增强 PRD v1.0

> **Version**: 1.0
> **Author**: PM Agent
> **Created**: 2026-01-14
> **Updated**: 2026-01-14
> **Status**: Draft

---

## Document Information

| Item             | Value                               |
| ---------------- | ----------------------------------- |
| Module           | topic-research                      |
| Feature          | UX Enhancement - Tab合并 + TODO机制 |
| Priority         | P0                                  |
| Estimated Effort | 3-4 weeks                           |
| Dependencies     | topic-research v1.0                 |

---

## 1. Executive Summary

### 1.1 背景

当前 AI Research 功能有 6 个 Tab：

- 团队互动 Tab：显示研究事件流、Agent 之间的消息
- Agent思考 Tab：显示各 Agent 的思考过程
- 洞察报告 Tab：显示研究报告
- 可信度 Tab：显示来源可信度
- 研究历史 Tab：显示历次研究的时间线
- 参考文献 Tab：显示引用来源

用户提出两个核心优化方向：

1. **Agent思考 vs 研究历史 是否应该合并？** - 两个 Tab 存在功能重叠
2. **借鉴 Claude Code TODO 机制改进团队互动区** - 提升用户与 Agent 的交互透明度

### 1.2 目标

1. 优化信息架构，减少用户认知负担
2. 引入 TODO List 机制，让用户清晰了解研究进度
3. 建立用户与 Agent 的双向交互通道
4. 提升整体研究过程的透明度和可控性

---

## 2. 问题分析

### 2.1 问题一：Agent思考 vs 研究历史 的功能割裂

#### 2.1.1 现状分析

**Agent思考 Tab (AgentThinkingTimeline.tsx)**：

- 功能定位：展示当前研究中 Agent 的实时思考过程
- 数据来源：AgentActivity 实时数据
- 信息维度：
  - Agent 角色（Leader/Researcher/Reviewer/Synthesizer）
  - 思考阶段（理解/搜索/撰写/审核/整合）
  - 进度百分比
  - 阶段详情（搜索结果、撰写进度等）
- 分组方式：按维度分组显示

**研究历史 Tab (ResearchTimeline.tsx)**：

- 功能定位：展示历次研究的完整记录
- 数据来源：ResearchHistory + AgentActivity + TeamMessage
- 信息维度：
  - 第 N 次研究标识
  - Leader 研究规划（目标、策略）
  - 维度研究进展（复用 AgentActivity）
  - 团队互动消息
  - 研究成果统计
- 分组方式：按研究会话分组

#### 2.1.2 问题识别

| 问题           | 描述                                                    |
| -------------- | ------------------------------------------------------- |
| **信息重叠**   | 两个 Tab 都展示 AgentActivity，但视角不同导致重复展示   |
| **上下文割裂** | Agent思考缺少历史上下文，研究历史缺少实时状态           |
| **切换成本**   | 用户需要频繁切换 Tab 才能获得完整信息                   |
| **定位模糊**   | "Agent思考"名称不够直观，用户难以理解与"研究历史"的区别 |

#### 2.1.3 用户使用场景分析

| 场景                     | 当前行为                 | 痛点                       |
| ------------------------ | ------------------------ | -------------------------- |
| 研究进行中，查看当前进度 | 打开 Agent思考 Tab       | 只能看实时，无法回顾历史   |
| 研究完成后，复盘过程     | 打开研究历史 Tab         | 信息太多，难以定位关键节点 |
| 跨次研究对比             | 切换研究历史 + Agent思考 | 需要频繁切换，对比困难     |
| 定位某个维度的问题       | 在两个 Tab 中分别查找    | 信息分散，定位效率低       |

### 2.2 问题二：团队互动区缺乏结构化反馈

#### 2.2.1 现状分析

**团队互动 Tab (TeamInteractionTabContent)**：

- 功能：展示 WebSocket 事件流、持久化消息
- 呈现方式：时间线消息流，类似聊天记录
- 交互方式：底部有 @Leader 输入框

**当前问题**：

| 问题               | 描述                                                           |
| ------------------ | -------------------------------------------------------------- |
| **无结构化进度**   | 用户只能看到消息流，无法快速了解整体进度                       |
| **缺乏 TODO 概念** | 没有明确的任务列表，用户不知道"还有什么要做"                   |
| **反馈不透明**     | 用户发送指令后，不知道 Leader 是否理解、何时执行、执行结果如何 |
| **无法主动干预**   | 用户只能被动等待，无法主动调整正在进行的任务                   |

#### 2.2.2 Claude Code TODO 机制核心优势

通过分析 Claude Code 的 TODO 机制，我们识别出以下核心优势：

1. **任务可视化**：所有待完成任务一目了然
2. **状态透明**：每个任务的状态（待处理/进行中/完成/失败）清晰可见
3. **进度追踪**：支持任务进度百分比展示
4. **可展开详情**：支持查看任务的详细执行过程
5. **用户可控**：用户可以取消、暂停、调整优先级
6. **实时更新**：状态变化实时同步到界面

---

## 3. 决策建议

### 3.1 问题一决策：合并 Agent思考 与 研究历史

**决策：建议合并，创建新的"研究进程"Tab**

#### 3.1.1 合并理由

| 维度         | 分析                                                       |
| ------------ | ---------------------------------------------------------- |
| **功能内聚** | 两者都在回答"研究是怎么进行的"这个问题，本质上是同一个功能 |
| **用户心智** | 用户不区分"当前研究"和"历史研究"，只关心"研究过程"         |
| **数据复用** | 两个组件已经共用 AgentActivity 数据模型                    |
| **减少切换** | 合并后用户无需在两个 Tab 间切换                            |

#### 3.1.2 合并后的信息架构

```
研究进程 Tab (新)
├── 当前研究状态
│   ├── 整体进度条
│   ├── 当前阶段指示
│   └── 预计剩余时间
├── TODO List (核心)
│   ├── 待完成任务列表
│   ├── 进行中任务（带进度）
│   └── 已完成任务
├── Agent 活动时间线
│   ├── 按维度分组
│   ├── 可展开详情
│   └── 阶段进度可视化
└── 研究会话切换器
    ├── 第 N 次研究标签
    ├── 历史会话列表
    └── 一键对比功能
```

#### 3.1.3 不合并的风险

| 风险           | 评估     | 缓解措施                           |
| -------------- | -------- | ---------------------------------- |
| 页面信息过多   | 中等风险 | 采用渐进式展开，默认只显示关键信息 |
| 历史数据加载慢 | 低风险   | 采用分页加载 + 懒加载              |
| 用户习惯适应   | 低风险   | 提供引导提示                       |

### 3.2 问题二决策：引入 TODO 机制

**决策：在团队互动区引入 TODO List，采用 Claude Code 风格设计**

#### 3.2.1 核心设计原则

1. **任务可视化优先**：TODO List 作为主要信息展示方式
2. **消息流为辅**：保留消息流但降低视觉权重
3. **双向交互**：用户指令能够直接影响 TODO List
4. **实时同步**：所有状态变化通过 WebSocket 实时推送

---

## 4. 详细功能设计

### 4.1 新 Tab 结构设计

#### 4.1.1 Tab 重组方案

**优化后的 Tab 结构（6 -> 5）**：

| 原 Tab    | 新 Tab         | 变化说明                      |
| --------- | -------------- | ----------------------------- |
| 团队互动  | **研究协作**   | 重点强化 TODO + 用户交互      |
| Agent思考 | 合并到研究协作 | 作为 TODO 详情的一部分        |
| 洞察报告  | 洞察报告       | 保持不变                      |
| 可信度    | 可信度         | 保持不变                      |
| 研究历史  | 研究历史       | 简化为历史会话列表 + 对比功能 |
| 参考文献  | 参考文献       | 保持不变                      |

#### 4.1.2 研究协作 Tab 详细设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│  研究协作                                                    [本次研究] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 📊 研究进度                                              75%    │   │
│  │ ████████████████████████░░░░░░░░                                │   │
│  │ 预计剩余时间: 约 3 分钟                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 📋 任务列表 (TODO)                                   [展开全部] │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │                                                                 │   │
│  │  ⏳ 进行中 (2)                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ 🔍 技术趋势维度研究                              65%    │   │   │
│  │  │    研究员正在分析 ArXiv 论文...                         │   │   │
│  │  │    [查看详情] [暂停]                                    │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ 🔍 市场格局维度研究                              40%    │   │   │
│  │  │    研究员正在检索市场报告...                            │   │   │
│  │  │    [查看详情] [暂停]                                    │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │                                                                 │   │
│  │  ⏸️ 待处理 (3)                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ ⬜ 投资动态维度研究                                     │   │   │
│  │  │    等待前置任务完成                                     │   │   │
│  │  │    [提高优先级]                                         │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ ⬜ 报告撰写                                             │   │   │
│  │  │    等待所有维度研究完成                                 │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ ⬜ 质量审核                                             │   │   │
│  │  │    等待报告撰写完成                                     │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │                                                                 │   │
│  │  ✅ 已完成 (4)                                       [收起]    │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ ✅ Leader 任务理解与规划                         100%   │   │   │
│  │  │    已完成 - 耗时 45秒                                   │   │   │
│  │  │    [查看详情]                                           │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ ✅ 政策法规维度研究                              100%   │   │   │
│  │  │    已完成 - 找到 12 条来源                              │   │   │
│  │  │    [查看详情]                                           │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │  ... 更多已完成任务                                         │   │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 💬 团队消息 (可选展开)                               [展开]    │   │
│  │    最近 3 条消息...                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 💬 @Leader 发送指令...                              [发送]     │   │
│  │ [深入分析] [扩展研究] [加快进度] [暂停任务]                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 TODO 数据模型设计

#### 4.2.1 核心数据结构

```typescript
// TODO 任务状态
enum TodoStatus {
  PENDING = "PENDING", // 待处理（等待前置任务）
  QUEUED = "QUEUED", // 已排队（等待执行）
  IN_PROGRESS = "IN_PROGRESS", // 进行中
  PAUSED = "PAUSED", // 已暂停
  COMPLETED = "COMPLETED", // 已完成
  FAILED = "FAILED", // 失败
  CANCELLED = "CANCELLED", // 已取消
}

// TODO 任务类型
enum TodoType {
  LEADER_PLANNING = "LEADER_PLANNING", // Leader 规划
  DIMENSION_RESEARCH = "DIMENSION_RESEARCH", // 维度研究
  REPORT_WRITING = "REPORT_WRITING", // 报告撰写
  QUALITY_REVIEW = "QUALITY_REVIEW", // 质量审核
  USER_REQUEST = "USER_REQUEST", // 用户请求
}

// TODO 任务
interface ResearchTodo {
  id: string;
  topicId: string;
  missionId: string;

  // 任务基本信息
  type: TodoType;
  title: string;
  description?: string;

  // 关联信息
  dimensionId?: string;
  dimensionName?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;

  // 状态与进度
  status: TodoStatus;
  progress: number; // 0-100
  statusMessage?: string; // 当前状态描述

  // 依赖关系
  dependsOn?: string[]; // 依赖的任务ID列表
  blockedBy?: string[]; // 被阻塞的原因

  // 执行信息
  startedAt?: Date;
  completedAt?: Date;
  estimatedDuration?: number; // 预估耗时（ms）
  actualDuration?: number; // 实际耗时（ms）

  // 结果信息
  result?: {
    sourcesFound?: number;
    wordCount?: number;
    keyFindings?: number;
    error?: string;
  };

  // 用户交互
  userCanPause: boolean;
  userCanCancel: boolean;
  userCanPrioritize: boolean;

  // 详情（可展开查看）
  activities?: AgentActivity[];

  createdAt: Date;
  updatedAt: Date;
}

// TODO 列表分组
interface TodoGroup {
  status: "in_progress" | "pending" | "completed" | "failed";
  label: string;
  todos: ResearchTodo[];
  isExpanded: boolean;
}
```

#### 4.2.2 与现有数据模型的关系

```
┌───────────────────┐      ┌───────────────────┐
│   ResearchMission │──1:N──│   ResearchTodo    │
└───────────────────┘      └─────────┬─────────┘
                                     │
                                     │ 1:N
                                     ▼
                           ┌───────────────────┐
                           │   AgentActivity   │
                           └───────────────────┘
```

- **ResearchMission**: 一次完整的研究任务
- **ResearchTodo**: 研究任务分解后的 TODO 项
- **AgentActivity**: TODO 项执行过程中的 Agent 活动记录

### 4.3 用户交互设计

#### 4.3.1 用户指令 -> TODO 转换流程

```
用户输入: "请深入分析技术趋势维度"
         │
         ▼
┌─────────────────────────────────┐
│      Leader 意图识别             │
│  capability: INCREASE_DEPTH     │
│  target: 技术趋势               │
│  confidence: 0.92               │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│      生成新 TODO                 │
│  type: USER_REQUEST             │
│  title: "深入分析技术趋势维度"   │
│  status: QUEUED                 │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│      推送到前端                  │
│  WebSocket: todo:created        │
│  TODO List 实时更新             │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│      执行并更新进度              │
│  WebSocket: todo:progress       │
│  TODO 进度条实时更新            │
└─────────────────────────────────┘
```

#### 4.3.2 用户可执行的操作

| 操作       | 适用状态                | 效果                           |
| ---------- | ----------------------- | ------------------------------ |
| 查看详情   | 所有状态                | 展开显示 AgentActivity 时间线  |
| 暂停任务   | IN_PROGRESS             | 暂停当前执行，状态变为 PAUSED  |
| 继续任务   | PAUSED                  | 恢复执行，状态变为 IN_PROGRESS |
| 取消任务   | PENDING, QUEUED, PAUSED | 取消任务，状态变为 CANCELLED   |
| 提高优先级 | PENDING, QUEUED         | 调整执行顺序                   |
| 重试任务   | FAILED                  | 重新执行失败的任务             |
| 发送新指令 | 任意时刻                | 创建新的 USER_REQUEST TODO     |

#### 4.3.3 快捷指令设计

```typescript
const QuickCommands = [
  {
    id: "deep_analysis",
    label: "深入分析",
    icon: "🔍",
    template: "请对 ${target} 进行更深入的分析",
    requiresTarget: true,
  },
  {
    id: "expand_scope",
    label: "扩展研究",
    icon: "📐",
    template: "请扩展当前研究范围，补充相关内容",
    requiresTarget: false,
  },
  {
    id: "speed_up",
    label: "加快进度",
    icon: "⚡",
    template: "请加快研究进度，优先完成核心内容",
    requiresTarget: false,
  },
  {
    id: "pause_all",
    label: "暂停任务",
    icon: "⏸️",
    template: "请暂停当前所有研究任务",
    requiresTarget: false,
  },
  {
    id: "add_dimension",
    label: "新增维度",
    icon: "➕",
    template: "请新增研究维度: ${dimensionName}",
    requiresInput: true,
    inputPlaceholder: "维度名称",
  },
  {
    id: "focus_on",
    label: "聚焦方向",
    icon: "🎯",
    template: "请重点关注 ${focus} 方面的内容",
    requiresInput: true,
    inputPlaceholder: "关注方向",
  },
];
```

### 4.4 WebSocket 事件设计

#### 4.4.1 TODO 相关事件

```typescript
// TODO 创建
interface TodoCreatedEvent {
  type: "todo:created";
  topicId: string;
  todo: ResearchTodo;
}

// TODO 状态更新
interface TodoStatusChangedEvent {
  type: "todo:status_changed";
  topicId: string;
  todoId: string;
  oldStatus: TodoStatus;
  newStatus: TodoStatus;
  message?: string;
}

// TODO 进度更新
interface TodoProgressEvent {
  type: "todo:progress";
  topicId: string;
  todoId: string;
  progress: number;
  statusMessage?: string;
}

// TODO 完成
interface TodoCompletedEvent {
  type: "todo:completed";
  topicId: string;
  todoId: string;
  result: {
    sourcesFound?: number;
    wordCount?: number;
    keyFindings?: number;
  };
  duration: number;
}

// TODO 失败
interface TodoFailedEvent {
  type: "todo:failed";
  topicId: string;
  todoId: string;
  error: string;
  canRetry: boolean;
}

// TODO 取消
interface TodoCancelledEvent {
  type: "todo:cancelled";
  topicId: string;
  todoId: string;
  reason: string;
}
```

### 4.5 研究历史 Tab 简化设计

合并后，原研究历史 Tab 简化为"历史会话"功能：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  研究历史                                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 📊 研究概览                                                     │   │
│  │ 共 5 次研究 | 成功 4 次 | 失败 1 次                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 🟢 第 5 次研究 (当前)                           2026-01-14 10:30 │   │
│  │    状态: 进行中 (75%)                                           │   │
│  │    更新维度: 3 | 新增来源: 18                                   │   │
│  │    [查看详情] [切换到此版本]                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✅ 第 4 次研究                                  2026-01-13 15:20 │   │
│  │    状态: 已完成 | 耗时: 8分钟                                   │   │
│  │    更新维度: 5 | 新增来源: 32 | 报告版本: v4                    │   │
│  │    [查看详情] [对比 v4↔v5] [切换到此版本]                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✅ 第 3 次研究                                  2026-01-12 09:15 │   │
│  │    状态: 已完成 | 耗时: 12分钟                                  │   │
│  │    更新维度: 8 | 新增来源: 45 | 报告版本: v3                    │   │
│  │    [查看详情] [对比 v3↔v4] [切换到此版本]                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ... 更多历史记录                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. UI 组件设计

### 5.1 新增组件

| 组件名                    | 功能            | 位置                    |
| ------------------------- | --------------- | ----------------------- |
| `ResearchTodoList`        | TODO 列表展示   | 研究协作 Tab            |
| `TodoItem`                | 单个 TODO 项    | ResearchTodoList 子组件 |
| `TodoProgress`            | TODO 进度条     | TodoItem 子组件         |
| `TodoActionButtons`       | TODO 操作按钮组 | TodoItem 子组件         |
| `TodoDetailPanel`         | TODO 详情面板   | 展开时显示              |
| `QuickCommandBar`         | 快捷指令栏      | 研究协作 Tab 底部       |
| `ResearchProgressSummary` | 研究进度汇总    | 研究协作 Tab 顶部       |
| `HistorySessionList`      | 历史会话列表    | 研究历史 Tab            |
| `SessionCompareModal`     | 会话对比弹窗    | 点击对比时显示          |

### 5.2 组件层级结构

```
TopicContentPanel
├── ResearchCollaborationTab (新)
│   ├── ResearchProgressSummary
│   ├── ResearchTodoList
│   │   ├── TodoGroup (进行中)
│   │   │   └── TodoItem[]
│   │   │       ├── TodoProgress
│   │   │       ├── TodoActionButtons
│   │   │       └── TodoDetailPanel (可展开)
│   │   │           └── AgentThinkingTimeline
│   │   ├── TodoGroup (待处理)
│   │   │   └── TodoItem[]
│   │   └── TodoGroup (已完成)
│   │       └── TodoItem[]
│   ├── TeamMessageList (可折叠)
│   └── QuickCommandBar
│
├── ReportTab (保持)
├── CredibilityTab (保持)
├── HistoryTab (简化)
│   ├── HistorySessionList
│   │   └── HistorySessionCard[]
│   └── SessionCompareModal
└── ReferencesTab (保持)
```

### 5.3 视觉设计规范

#### 5.3.1 TODO 状态颜色

| 状态        | 颜色                  | 图标 |
| ----------- | --------------------- | ---- |
| IN_PROGRESS | Blue (bg-blue-50)     | ⏳   |
| PENDING     | Gray (bg-gray-50)     | ⬜   |
| QUEUED      | Yellow (bg-yellow-50) | ⏱️   |
| PAUSED      | Orange (bg-orange-50) | ⏸️   |
| COMPLETED   | Green (bg-green-50)   | ✅   |
| FAILED      | Red (bg-red-50)       | ❌   |
| CANCELLED   | Gray (bg-gray-100)    | 🚫   |

#### 5.3.2 进度条设计

```css
/* 进行中进度条 - 蓝色渐变 + 动画 */
.progress-in-progress {
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  animation: pulse 2s infinite;
}

/* 已完成进度条 - 绿色 */
.progress-completed {
  background: #22c55e;
}

/* 失败进度条 - 红色 */
.progress-failed {
  background: #ef4444;
}
```

---

## 6. API 设计

### 6.1 新增 API 端点

```typescript
// TODO 相关 API

// 获取研究任务的 TODO 列表
GET /api/topic-research/topics/:topicId/todos
Query: { missionId?: string, status?: TodoStatus[] }
Response: { todos: ResearchTodo[], summary: TodoSummary }

// 暂停 TODO
POST /api/topic-research/topics/:topicId/todos/:todoId/pause
Response: { success: boolean, todo: ResearchTodo }

// 恢复 TODO
POST /api/topic-research/topics/:topicId/todos/:todoId/resume
Response: { success: boolean, todo: ResearchTodo }

// 取消 TODO
POST /api/topic-research/topics/:topicId/todos/:todoId/cancel
Body: { reason?: string }
Response: { success: boolean, todo: ResearchTodo }

// 重试 TODO
POST /api/topic-research/topics/:topicId/todos/:todoId/retry
Response: { success: boolean, todo: ResearchTodo }

// 调整 TODO 优先级
PATCH /api/topic-research/topics/:topicId/todos/:todoId/priority
Body: { priority: 'high' | 'normal' | 'low' }
Response: { success: boolean, todo: ResearchTodo }

// 获取 TODO 详情（包含 activities）
GET /api/topic-research/topics/:topicId/todos/:todoId/details
Response: { todo: ResearchTodo, activities: AgentActivity[] }
```

### 6.2 WebSocket 订阅

```typescript
// 订阅 TODO 更新
socket.emit("subscribe", {
  channel: "topic:todos",
  topicId: "xxx",
});

// 接收 TODO 事件
socket.on("todo:created", handler);
socket.on("todo:status_changed", handler);
socket.on("todo:progress", handler);
socket.on("todo:completed", handler);
socket.on("todo:failed", handler);
socket.on("todo:cancelled", handler);
```

---

## 7. 后端服务设计

### 7.1 新增服务

```typescript
// research-todo.service.ts
@Injectable()
export class ResearchTodoService {
  // TODO CRUD
  async createTodo(
    missionId: string,
    data: CreateTodoDto,
  ): Promise<ResearchTodo>;
  async getTodos(topicId: string, filter?: TodoFilter): Promise<ResearchTodo[]>;
  async updateTodoStatus(
    todoId: string,
    status: TodoStatus,
  ): Promise<ResearchTodo>;
  async updateTodoProgress(
    todoId: string,
    progress: number,
    message?: string,
  ): Promise<void>;

  // 用户操作
  async pauseTodo(todoId: string): Promise<ResearchTodo>;
  async resumeTodo(todoId: string): Promise<ResearchTodo>;
  async cancelTodo(todoId: string, reason?: string): Promise<ResearchTodo>;
  async retryTodo(todoId: string): Promise<ResearchTodo>;
  async prioritizeTodo(
    todoId: string,
    priority: Priority,
  ): Promise<ResearchTodo>;

  // 任务编排
  async generateTodosFromMission(missionId: string): Promise<ResearchTodo[]>;
  async checkDependencies(todoId: string): Promise<boolean>;
  async getNextExecutableTodo(missionId: string): Promise<ResearchTodo | null>;

  // 事件推送
  async emitTodoEvent(event: TodoEvent): Promise<void>;
}
```

### 7.2 与现有服务的集成

```
ResearchMissionService
       │
       │ 创建 Mission 时
       ▼
ResearchTodoService.generateTodosFromMission()
       │
       │ 生成 TODO 列表
       ▼
DimensionMissionService / ReportSynthesisService
       │
       │ 执行时更新进度
       ▼
ResearchTodoService.updateTodoProgress()
       │
       │ WebSocket 推送
       ▼
Frontend ResearchTodoList
```

---

## 8. 数据库变更

### 8.1 新增表

```prisma
// 研究 TODO
model ResearchTodo {
  id          String   @id @default(cuid())
  topicId     String   @map("topic_id")
  missionId   String   @map("mission_id")

  // 任务信息
  type        TodoType
  title       String   @db.VarChar(200)
  description String?  @db.Text

  // 关联信息
  dimensionId   String?  @map("dimension_id")
  dimensionName String?  @map("dimension_name")
  agentId       String?  @map("agent_id")
  agentName     String?  @map("agent_name")
  agentRole     String?  @map("agent_role")

  // 状态
  status        TodoStatus @default(PENDING)
  progress      Int        @default(0)
  statusMessage String?    @map("status_message")
  priority      Int        @default(0)

  // 依赖
  dependsOn     String[]   @map("depends_on")

  // 时间
  startedAt     DateTime?  @map("started_at")
  completedAt   DateTime?  @map("completed_at")
  estimatedMs   Int?       @map("estimated_ms")
  actualMs      Int?       @map("actual_ms")

  // 结果
  result        Json?

  // 用户控制
  userCanPause      Boolean @default(true) @map("user_can_pause")
  userCanCancel     Boolean @default(true) @map("user_can_cancel")
  userCanPrioritize Boolean @default(true) @map("user_can_prioritize")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // 关系
  topic     ResearchTopic  @relation(fields: [topicId], references: [id])
  dimension TopicDimension? @relation(fields: [dimensionId], references: [id])

  @@index([topicId, missionId])
  @@index([status])
  @@map("research_todos")
}

enum TodoType {
  LEADER_PLANNING
  DIMENSION_RESEARCH
  REPORT_WRITING
  QUALITY_REVIEW
  USER_REQUEST
}

enum TodoStatus {
  PENDING
  QUEUED
  IN_PROGRESS
  PAUSED
  COMPLETED
  FAILED
  CANCELLED
}
```

---

## 9. 前端状态管理

### 9.1 Store 扩展

```typescript
// topicResearchStore 扩展
interface TopicResearchState {
  // ... existing state

  // TODO 相关
  todos: ResearchTodo[];
  todosLoading: boolean;
  selectedTodoId: string | null;
  todoFilter: TodoFilter;

  // Actions
  fetchTodos: (topicId: string) => Promise<void>;
  pauseTodo: (todoId: string) => Promise<void>;
  resumeTodo: (todoId: string) => Promise<void>;
  cancelTodo: (todoId: string, reason?: string) => Promise<void>;
  retryTodo: (todoId: string) => Promise<void>;
  prioritizeTodo: (todoId: string, priority: Priority) => Promise<void>;
  selectTodo: (todoId: string | null) => void;
  updateTodoFromWs: (event: TodoEvent) => void;
}
```

### 9.2 WebSocket Hook 扩展

```typescript
// useResearchWebSocket 扩展
function useResearchWebSocket(topicId: string) {
  // ... existing logic

  useEffect(() => {
    // 订阅 TODO 事件
    socket.on("todo:created", (event) => {
      store.updateTodoFromWs(event);
    });

    socket.on("todo:progress", (event) => {
      store.updateTodoFromWs(event);
    });

    socket.on("todo:status_changed", (event) => {
      store.updateTodoFromWs(event);
    });

    // ... 其他事件
  }, [topicId]);
}
```

---

## 10. 实施计划

### Phase 1: 基础 TODO 机制 (Week 1)

| 任务                       | 优先级 | 工作量 |
| -------------------------- | ------ | ------ |
| 设计并创建 ResearchTodo 表 | P0     | 0.5d   |
| 实现 ResearchTodoService   | P0     | 1d     |
| 实现 TODO API 端点         | P0     | 1d     |
| 前端 ResearchTodoList 组件 | P0     | 1.5d   |
| 前端 TodoItem 组件         | P0     | 1d     |
| WebSocket TODO 事件        | P0     | 0.5d   |

### Phase 2: 用户交互 (Week 2)

| 任务                  | 优先级 | 工作量 |
| --------------------- | ------ | ------ |
| 暂停/恢复/取消功能    | P0     | 1d     |
| 优先级调整功能        | P1     | 0.5d   |
| 重试功能              | P1     | 0.5d   |
| QuickCommandBar 组件  | P0     | 1d     |
| 用户指令 -> TODO 转换 | P0     | 1.5d   |
| Leader 能力集成       | P0     | 1d     |

### Phase 3: Tab 重组 (Week 3)

| 任务                        | 优先级 | 工作量 |
| --------------------------- | ------ | ------ |
| 合并 Agent思考 到 TODO 详情 | P0     | 1d     |
| 研究协作 Tab 整体布局       | P0     | 1d     |
| 研究历史 Tab 简化           | P1     | 1d     |
| ResearchProgressSummary     | P1     | 0.5d   |
| 会话对比功能                | P2     | 1d     |

### Phase 4: 优化与测试 (Week 4)

| 任务                   | 优先级 | 工作量 |
| ---------------------- | ------ | ------ |
| 性能优化（虚拟列表等） | P1     | 1d     |
| 边界情况处理           | P0     | 1d     |
| 单元测试               | P0     | 1d     |
| 集成测试               | P0     | 1d     |
| 用户体验调优           | P1     | 1d     |

---

## 11. 验收标准

### 11.1 功能验收

- [ ] TODO 列表正确显示所有研究任务
- [ ] TODO 状态实时更新
- [ ] TODO 进度条正确反映执行进度
- [ ] 用户可以暂停/恢复进行中的任务
- [ ] 用户可以取消待处理的任务
- [ ] 用户可以重试失败的任务
- [ ] 用户可以调整任务优先级
- [ ] 快捷指令正确触发对应操作
- [ ] 用户指令正确转换为 TODO
- [ ] TODO 详情正确展示 Agent 活动

### 11.2 性能验收

- [ ] TODO 列表加载时间 < 500ms
- [ ] TODO 状态更新延迟 < 200ms
- [ ] WebSocket 消息处理无丢失
- [ ] 100+ TODO 项时页面流畅

### 11.3 用户体验验收

- [ ] Tab 切换无闪烁
- [ ] 状态变化有清晰的视觉反馈
- [ ] 加载状态有友好的占位符
- [ ] 错误状态有明确的提示和恢复建议

---

## 12. 风险评估

| 风险                  | 影响 | 可能性 | 缓解措施                 |
| --------------------- | ---- | ------ | ------------------------ |
| TODO 与现有流程不兼容 | 高   | 低     | 增量迁移，保留旧逻辑兼容 |
| WebSocket 消息量过大  | 中   | 中     | 消息节流，批量更新       |
| 用户操作与 Agent 冲突 | 中   | 中     | 操作锁定机制，冲突提示   |
| Tab 合并影响用户习惯  | 低   | 中     | 提供引导提示，渐进式切换 |

---

## 13. 成功指标

| 指标                 | 目标   | 测量方式         |
| -------------------- | ------ | ---------------- |
| Tab 切换频率降低     | -50%   | 用户行为分析     |
| 研究过程理解度提升   | +30%   | 用户调研         |
| 用户主动交互次数提升 | +50%   | 指令发送次数统计 |
| 研究中途放弃率降低   | -20%   | 完成率统计       |
| 用户满意度提升       | 4.2+/5 | 功能满意度调研   |

---

## 14. 附录

### A. 竞品分析：Claude Code TODO 机制

Claude Code 的 TODO 机制核心特点：

1. **任务自动提取**：从对话中自动识别任务
2. **状态可视化**：清晰的完成状态标识
3. **进度追踪**：支持子任务和进度百分比
4. **可交互**：用户可以勾选、删除、重新排序
5. **持久化**：任务状态保存，刷新不丢失

### B. 参考设计

- [Claude Code TODO Screenshot](参考 Claude Code 的任务列表设计)
- [Linear Issue Tracker](参考 Linear 的任务状态设计)
- [GitHub Projects](参考 GitHub Projects 的看板设计)

### C. 相关文档

- [专题研究 PRD v1.0](./topic-research-prd.md)
- [@Leader 交互功能 PRD](../topic-research-leader-interaction.md)
- [AI Teams 产品愿景](../../ai-group/ai-group-team-collaboration.md)

---

## Document History

| Version | Date       | Author   | Changes                              |
| ------- | ---------- | -------- | ------------------------------------ |
| 1.0     | 2026-01-14 | PM Agent | 初始版本：Tab合并分析 + TODO机制设计 |
