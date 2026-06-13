# Topic Research UI 优化 PRD

## 文档信息

- 版本: 1.0
- 作者: PM Agent
- 创建日期: 2026-01-13
- 状态: 已确认

---

## 1. 概述

### 1.1 背景

用户对 AI Research (Topic Research) 模块的 UI 体验非常不满意，提出了多个核心问题。现有实现虽然功能上可用，但在信息透明度、Agent 可辨识性、交互反馈等方面存在明显不足，严重影响用户对 AI 研究过程的理解和信任感。

### 1.2 目标

1. **信息透明**：让用户清楚看到 AI 理解了什么、在做什么
2. **Agent 可辨识**：每个 Agent 有独特的名称和视觉标识
3. **交互可响应**：点击 Agent 能看到详细信息
4. **状态可追踪**：维度研究列表显示有意义的状态信息

### 1.3 非目标

- 本次不涉及研究算法的优化
- 本次不涉及报告生成质量的改进
- 本次不涉及新功能的添加

---

## 2. 问题分析

### 2.1 现状分析

#### 相关代码文件

**前端核心组件：**
| 文件 | 职责 |
|------|------|
| `frontend/app/ai-studio/topic-research/page.tsx` | 专题研究列表页 |
| `frontend/components/ai-research/TopicDetail.tsx` | 专题详情入口 |
| `frontend/components/ai-research/TopicResearchLayout.tsx` | 主布局组件 |
| `frontend/components/ai-research/TopicTeamPanel.tsx` | 左侧团队面板 |
| `frontend/components/ai-research/TopicContentPanel.tsx` | 右侧内容面板 |
| `frontend/components/ai-research/ResearchTeamPanel.tsx` | 团队可视化（SVG） |

**后端核心服务：**
| 文件 | 职责 |
|------|------|
| `backend/.../research-leader.service.ts` | Leader 规划和协调 |
| `backend/.../research-mission.service.ts` | 任务执行管理 |
| `backend/.../research-event-emitter.service.ts` | WebSocket 事件推送 |

#### 现有数据流

```
研究开始
  ↓
ResearchLeaderService.planResearch()
  → 生成 LeaderPlan（包含 agentName、taskUnderstanding 等）
  ↓
ResearchMissionService.createTasksFromPlan()
  → 创建任务时使用 getAgentNameFromTaskType() 生成名称
  → 但实际都返回 "研究员"、"维度研究员" 等通用名称
  ↓
WebSocket 事件推送
  → 事件中包含 agentName，但前端显示不够友好
  ↓
前端 TopicContentPanel
  → 转换 WebSocket 事件为 UIMessage
  → Agent 详情点击已实现（RESEARCH_AGENT_DETAILS）
```

### 2.2 问题列表

| ID  | 问题                              | 影响                     | 优先级 |
| --- | --------------------------------- | ------------------------ | ------ |
| P1  | AI理解结果没有输出                | 用户不知道 AI 理解了什么 | P0     |
| P2  | Agent 都叫"研究员"，无法区分      | 用户无法知道谁在分析什么 | P0     |
| P3  | 点击 Agent 没有反应（左侧团队图） | 交互断裂                 | P1     |
| P4  | 维度研究列表的三角形无功能        | 界面元素无意义           | P2     |

---

## 3. 需求详情

### 3.1 P1 - AI 理解结果输出

#### 问题描述

Leader 在理解用户意图时，用户看不到 AI 理解了什么。右侧消息只显示 "Leader 正在规划研究方案..." 等模糊信息。

#### 现有实现分析

- `ResearchLeaderService.planResearch()` 返回 `LeaderPlan`，包含完整的 `taskUnderstanding`
- `TopicContentPanel` 中有 `LeaderPlanPreview` 组件，但数据未正确传递
- WebSocket 事件 `leader:plan_ready` 包含规划信息，但前端解析不完整

#### 解决方案

**后端改动：**

1. 在 `research-event-emitter.service.ts` 中增加 `leader:understanding` 事件
2. 在 Leader 完成理解后立即推送理解结果

```typescript
// 新增事件类型
emitLeaderUnderstanding(topicId: string, understanding: TaskUnderstanding) {
  this.emit(topicId, 'leader:understanding', {
    topic: understanding.topic,
    scope: understanding.scope,
    objectives: understanding.objectives,
    constraints: understanding.constraints,
    message: `Leader 已理解任务：${understanding.topic}`
  });
}
```

**前端改动：**

1. 在 `TopicContentPanel.tsx` 的 `uiMessages` 转换逻辑中，增加对 `leader:understanding` 事件的处理
2. 创建 `TaskUnderstandingPreview` 组件展示理解结果

```typescript
// 新增预览组件
function TaskUnderstandingPreview({ data }) {
  return (
    <div className="space-y-3 p-4 bg-purple-50 rounded-lg border border-purple-200">
      <div className="flex items-center gap-2">
        <span className="text-lg">🧠</span>
        <span className="font-medium text-purple-700">Leader 任务理解</span>
      </div>
      <div>
        <h5 className="text-xs font-semibold text-gray-500">研究主题</h5>
        <p className="text-sm text-gray-700">{data.topic}</p>
      </div>
      <div>
        <h5 className="text-xs font-semibold text-gray-500">研究范围</h5>
        <p className="text-sm text-gray-700">{data.scope}</p>
      </div>
      {data.objectives?.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-gray-500">研究目标</h5>
          <ul className="list-disc list-inside text-sm text-gray-700">
            {data.objectives.map((obj, i) => <li key={i}>{obj}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```

#### 验收标准

- [ ] 研究开始后，右侧消息区显示 "Leader 正在理解任务..."
- [ ] Leader 理解完成后，显示一个可展开的卡片，包含：研究主题、研究范围、研究目标
- [ ] 卡片样式使用紫色主题，与 Leader 标识一致

---

### 3.2 P2 - Agent 名称区分

#### 问题描述

左侧团队图和右侧消息列表中，所有 Agent 都显示为"研究员"，用户无法知道谁在分析什么。

#### 现有实现分析

- `ResearchLeaderService` 的 `LEADER_PLAN_PROMPT` 中已要求 AI 生成有区分度的 `agentName`
- 但 `ResearchMissionService.getAgentNameFromTaskType()` 硬编码返回通用名称
- `TopicTeamPanel.CompactTeamVisualization` 只显示图标，没有显示名称

#### 解决方案

**后端改动：**

1. 修改 `research-mission.service.ts`，使用 Leader 规划中的 `agentName`

```typescript
// 修改 createTasksFromPlan 方法
for (const assignment of leaderPlan.agentAssignments) {
  // 使用 Leader 规划的 agentName，而非 getAgentNameFromTaskType()
  const agentName =
    assignment.agentName || this.getAgentNameFromTaskType(assignment.agentType);
  // ... 创建任务时保存 agentName
}
```

2. 修改 Task 数据模型，增加 `agentName` 字段（如果尚未存在）

**前端改动 - 左侧团队图：**

1. 修改 `TopicTeamPanel.tsx` 的 `CompactTeamVisualization` 组件
2. 每个研究员节点显示其具体名称（如 "市场分析师"）
3. 正在工作的 Agent 添加呼吸动画效果

```tsx
// CompactTeamVisualization 改进
{
  dimensionTasks.map((task, i) => (
    <div
      key={task.id}
      className={`flex flex-col items-center ${
        task.status === "EXECUTING" ? "animate-pulse" : ""
      }`}
    >
      <div
        className={`h-10 w-10 rounded-full border-2 flex items-center justify-center ${
          task.status === "EXECUTING"
            ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
            : task.status === "COMPLETED"
              ? "border-green-400 bg-green-50"
              : "border-gray-300 bg-gray-50"
        }`}
      >
        <span className="text-lg">🔍</span>
      </div>
      <span className="mt-1 text-xs text-gray-600 text-center max-w-[60px] truncate">
        {task.agentName || `研究员${i + 1}`}
      </span>
    </div>
  ));
}
```

**前端改动 - 右侧消息：**

1. `TopicContentPanel.tsx` 的消息转换逻辑中使用具体的 `agentName`
2. 消息头部显示 Agent 具体名称

```typescript
// uiMessages 转换逻辑
if (eventType.startsWith("dimension:")) {
  // 使用事件中的 agentName，而非通用的 "研究员"
  agent = (data.agentName as string) || "研究员";
  // ...
}
```

#### 验收标准

- [ ] 左侧团队图中，每个 Agent 显示具体名称（如 "市场趋势研究员"）
- [ ] 右侧消息中，显示具体的 Agent 名称
- [ ] 正在工作的 Agent 有明显的视觉高亮（呼吸动画）
- [ ] 如果 Leader 未提供具体名称，回退到 "研究员1"、"研究员2" 编号形式

---

### 3.3 P3 - Agent 点击响应

#### 问题描述

点击左侧团队图中的 Agent 头像，没有任何响应。

#### 现有实现分析

- `TopicContentPanel.tsx` 中已实现 Agent 详情弹窗（`RESEARCH_AGENT_DETAILS` + Modal）
- 但 `TopicTeamPanel.tsx` 的团队可视化组件没有添加点击事件
- AI Writing 的 `WritingCanvas.tsx` 是很好的参考

#### 参考实现：AI Writing Canvas

```tsx
// WritingCanvas.tsx 中的 Agent 节点（参考设计）
const WRITING_AGENTS = [
  {
    id: "story-architect",
    name: "故事架构师",
    role: "leader",
    icon: "📐",
    bgColor: "#8B5CF6",
  },
  {
    id: "bible-keeper",
    name: "设定守护者",
    role: "member",
    icon: "📚",
    bgColor: "#6366F1",
  },
  // ...
];

// 节点渲染有名称、图标、状态徽章
// 点击节点可显示详情
```

#### 解决方案

**前端改动 - TopicTeamPanel：**

1. 为每个 Agent 节点添加 `onClick` 事件
2. 点击后显示 Agent 详情弹窗（复用 TopicContentPanel 的实现）

```tsx
// TopicTeamPanel.tsx
function CompactTeamVisualization({
  // ... 原有 props
  onAgentClick, // 新增
}: {
  // ...
  onAgentClick?: (agentType: string, agentName?: string) => void;
}) {
  return (
    // ...
    <button
      onClick={() => onAgentClick?.("researcher", task.agentName)}
      className="cursor-pointer hover:scale-110 transition-transform"
    >
      {/* Agent 节点内容 */}
    </button>
  );
}
```

2. 创建通用的 `AgentDetailModal` 组件，从 `TopicContentPanel` 抽离

```tsx
// 新建 components/ai-research/AgentDetailModal.tsx
interface AgentDetailModalProps {
  agentType: string;
  agentName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AgentDetailModal({
  agentType,
  agentName,
  isOpen,
  onClose,
}: AgentDetailModalProps) {
  const details = RESEARCH_AGENT_DETAILS[agentType];
  if (!isOpen || !details) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      {/* 弹窗内容 - 参考 TopicContentPanel 现有实现 */}
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4">
        {/* Header: 图标 + 名称 + 角色 */}
        {/* Body: 描述 + 技能 + 工具 */}
        {/* Footer: 关闭按钮 */}
      </div>
    </div>
  );
}
```

3. 详情弹窗内容增强：显示当前 Agent 正在执行的任务

```tsx
{
  /* 当前任务 */
}
{
  currentTask && (
    <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
      <h4 className="text-sm font-semibold text-blue-800">当前任务</h4>
      <p className="text-sm text-blue-600">{currentTask.dimensionName}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-blue-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500"
            style={{ width: `${currentTask.progress}%` }}
          />
        </div>
        <span className="text-xs text-blue-500">{currentTask.progress}%</span>
      </div>
    </div>
  );
}
```

#### 验收标准

- [ ] 点击左侧团队图中任意 Agent 节点，弹出详情弹窗
- [ ] 弹窗包含：Agent 名称、角色、描述、技能列表、工具列表
- [ ] 如果 Agent 正在执行任务，显示当前任务信息和进度
- [ ] 点击弹窗外部或关闭按钮可关闭弹窗
- [ ] Leader 节点点击也应显示详情

---

### 3.4 P4 - 维度研究列表优化

#### 问题描述

左侧"维度研究(8)"列表中，每行后面有个三角形，功能不明。

#### 现有实现分析

- `TopicTeamPanel.tsx` 的 `TaskItem` 组件
- 三角形是展开/收起指示器（`isExpanded ? '▲' : '▼'`）
- 但展开后只显示 `reviewStatus`，信息量少

#### 解决方案

**选项 A：移除三角形，简化显示（推荐）**

```tsx
function TaskItem({ task }: { task: TaskStatus }) {
  const colors = statusColors[task.status];
  const icon = statusIcons[task.status];

  return (
    <div className={`mb-2 rounded-lg border ${colors.border} ${colors.bg} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${colors.text}`}>{icon}</span>
          <span className="text-sm text-gray-800 truncate max-w-[120px]">
            {task.dimensionName || task.title}
          </span>
        </div>
        {/* 显示 Agent 编号或名称 */}
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
          {task.agentName || `#${task.index + 1}`}
        </span>
      </div>
    </div>
  );
}
```

**选项 B：保留三角形，增强展开内容**

如果保留展开功能，展开后显示更多信息：

- Agent 名称
- 开始时间
- 预计完成时间
- 已收集的证据数量

#### 验收标准

- [ ] 移除无功能的三角形（选项 A）或增强展开内容（选项 B）
- [ ] 每行显示维度名称 + 状态图标 + Agent 编号/名称
- [ ] 正在执行的任务有明显的视觉区分

---

## 4. UI 设计规范

### 4.1 Agent 视觉标识

| Agent 类型 | 图标 | 主色                   | 背景色                 |
| ---------- | ---- | ---------------------- | ---------------------- |
| Leader     | 👑   | `#8B5CF6` (purple-500) | `#F3E8FF` (purple-100) |
| 研究员     | 🔍   | `#3B82F6` (blue-500)   | `#DBEAFE` (blue-100)   |
| 审核员     | ✅   | `#10B981` (green-500)  | `#D1FAE5` (green-100)  |
| 撰写员     | 📊   | `#F59E0B` (amber-500)  | `#FEF3C7` (amber-100)  |

### 4.2 状态视觉

| 状态   | 图标 | 样式                         |
| ------ | ---- | ---------------------------- |
| 待开始 | ○    | 灰色边框，灰色填充           |
| 执行中 | ◐    | 蓝色边框，呼吸动画，蓝色发光 |
| 已完成 | ✓    | 绿色边框，绿色填充           |
| 失败   | ✕    | 红色边框，红色填充           |
| 需修订 | ↻    | 黄色边框，黄色填充           |

### 4.3 动画规范

```css
/* 呼吸动画 - 正在工作的 Agent */
@keyframes pulse-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
  }
}

.agent-working {
  animation: pulse-glow 2s ease-in-out infinite;
}
```

---

## 5. 任务拆分

### Epic: Topic Research UI 优化

#### Story 1: AI 理解结果输出 (P0)

优先级: P0
预估: 1.5d

**Tasks:**

- [ ] T1.1 后端：增加 `leader:understanding` 事件 (0.5d)
- [ ] T1.2 前端：创建 `TaskUnderstandingPreview` 组件 (0.5d)
- [ ] T1.3 前端：在消息流中显示理解结果 (0.5d)

#### Story 2: Agent 名称区分 (P0)

优先级: P0
预估: 2d

**Tasks:**

- [ ] T2.1 后端：修改任务创建逻辑使用 Leader 的 agentName (0.5d)
- [ ] T2.2 前端：修改左侧团队图显示 Agent 名称 (0.5d)
- [ ] T2.3 前端：修改右侧消息显示具体 Agent 名称 (0.5d)
- [ ] T2.4 前端：添加正在工作的 Agent 呼吸动画 (0.5d)

#### Story 3: Agent 点击响应 (P1)

优先级: P1
预估: 1.5d

**Tasks:**

- [ ] T3.1 前端：抽离 AgentDetailModal 组件 (0.5d)
- [ ] T3.2 前端：为左侧团队图添加点击事件 (0.5d)
- [ ] T3.3 前端：增强详情弹窗显示当前任务 (0.5d)

#### Story 4: 维度列表优化 (P2)

优先级: P2
预估: 0.5d

**Tasks:**

- [ ] T4.1 前端：移除三角形，优化列表项显示 (0.5d)

---

## 6. 排期计划

### 里程碑

| 里程碑 | 日期  | 内容                                  |
| ------ | ----- | ------------------------------------- |
| M1     | +2d   | 完成 P0 需求（理解输出 + Agent 名称） |
| M2     | +3.5d | 完成 P1 需求（Agent 点击响应）        |
| M3     | +4d   | 完成 P2 需求（维度列表优化）          |

### 建议执行顺序

```
Day 1: T1.1 + T2.1 (后端改动)
Day 2: T1.2 + T1.3 + T2.2 (前端：理解输出 + 左侧名称)
Day 3: T2.3 + T2.4 + T3.1 (前端：右侧名称 + 动画 + Modal 抽离)
Day 4: T3.2 + T3.3 + T4.1 (前端：点击事件 + 详情增强 + 列表优化)
```

---

## 7. 风险和依赖

### 风险

| 风险                               | 影响 | 缓解措施                         |
| ---------------------------------- | ---- | -------------------------------- |
| Leader 生成的 agentName 质量不稳定 | 中   | 增加 Prompt 约束 + 前端 fallback |
| WebSocket 事件丢失                 | 中   | 前端增加轮询兜底                 |

### 依赖

| 依赖项                     | 状态   | 负责人 |
| -------------------------- | ------ | ------ |
| WebSocket 实时推送基础设施 | 已完成 | -      |
| Leader 规划服务            | 已完成 | -      |

---

## 8. 附录

### 参考资料

- AI Writing Canvas 实现：`frontend/components/ai-writing/WritingCanvas.tsx`
- AI Teams Canvas 实现：`frontend/components/ai-teams/TeamCanvasView.tsx`
- 现有 Agent 详情配置：`TopicContentPanel.tsx` 中的 `RESEARCH_AGENT_DETAILS`

### 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2026-01-13 | 初始版本 | PM Agent |

---

## 9. 技术实现要点

### 9.1 后端数据流改进

```
研究开始
  ↓
ResearchLeaderService.planResearch()
  ↓
★ 新增: emitLeaderUnderstanding(topicId, plan.taskUnderstanding)
  ↓
ResearchMissionService.createTasksFromPlan()
  ↓
★ 改进: 使用 assignment.agentName 而非 getAgentNameFromTaskType()
  ↓
emitAgentEvent() 推送事件，包含具体 agentName
```

### 9.2 前端组件关系

```
TopicResearchLayout
├── TopicTeamPanel (左侧)
│   ├── CompactTeamVisualization
│   │   ├── Leader 节点 (可点击)
│   │   ├── Researcher 节点[] (可点击, 显示名称)
│   │   └── Reviewer/Synthesizer 节点 (可点击)
│   └── TaskList (维度列表)
│       └── TaskItem[] (显示名称+状态)
│
├── TopicContentPanel (右侧)
│   └── TeamInteractionTabContent
│       ├── UIMessage[] (使用具体 agentName)
│       └── AgentDetailModal (点击弹出)
│
└── AgentDetailModal (共享组件)
    ├── Header (图标+名称+角色)
    ├── Description
    ├── Skills
    ├── Tools
    └── CurrentTask (如有)
```

### 9.3 关键代码位置

| 改动点         | 文件路径                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------- |
| 新增理解事件   | `backend/src/modules/ai-app/research/topic-research/services/research-event-emitter.service.ts` |
| 使用 agentName | `backend/src/modules/ai-app/research/topic-research/services/research-mission.service.ts`       |
| 左侧团队图     | `frontend/components/ai-research/TopicTeamPanel.tsx`                                            |
| 右侧消息处理   | `frontend/components/ai-research/TopicContentPanel.tsx`                                         |
| 共享 Modal     | `frontend/components/ai-research/AgentDetailModal.tsx` (新建)                                   |
