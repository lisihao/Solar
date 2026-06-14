# Topic Research 重设计方案 v7.0

> **最终版本** - 整合前后端架构，实现 Leader 自主决策 + 团队自组织

---

## 执行摘要

### 核心变革

```
┌─────────────────────────────────────────────────────────────────┐
│  【从硬编码流程 → Leader 驱动的自组织团队】                       │
│                                                                 │
│  Before:                                                        │
│  ❌ 硬编码 24 个维度模板（3类×8维度）                           │
│  ❌ 固定流程（规划→并行采集→审核→撰写）                         │
│  ❌ Leader 角色仅概念存在                                       │
│  ❌ 用户无法干预执行过程                                        │
│                                                                 │
│  After:                                                         │
│  ✅ Leader（最强推理模型）动态规划维度和工作流                  │
│  ✅ Agent 按需创建和分配，弹性调整                              │
│  ✅ 用户通过 @Leader 补充提示，不直接控制流程                   │
│  ✅ Leader 全程监督、审核、干预                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 关键决策一览

| 决策项          | 选择                                                            |
| --------------- | --------------------------------------------------------------- |
| **架构理念**    | Leader 自主决策 + 团队自组织，无预设 Workflow                   |
| **Leader 模型** | 用户配置的推理模型（`isReasoning=true`），默认 Claude Opus / o1 |
| **用户交互**    | 通过 @Leader 提示补充，不直接干预 Agent                         |
| **前端布局**    | 左侧（团队+进度）+ 右侧（四Tab）+ 底部（指令输入）              |
| **四 Tab**      | 洞察报告 / 团队互动 / Agent思考架构 / 参考文献                  |
| **后端重构**    | 复用 AI Teams Mission 系统，新建 ResearchLeaderService          |

---

## 1. 架构设计

### 1.1 核心架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           【用户】                                   │
│                              │                                      │
│                    @Leader 我想研究 AI 大模型趋势                    │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    👑 Leader Agent                           │   │
│  │              (用户配置的推理模型: Claude Opus / o1)           │   │
│  │                                                              │   │
│  │  职责：                                                      │   │
│  │  1. 任务理解 - 深度分析研究目标和范围                        │   │
│  │  2. 维度规划 - 自主决定研究维度（非硬编码）                  │   │
│  │  3. Agent 分配 - 按需创建 Agent，分配任务                    │   │
│  │  4. 质量审核 - 审核所有输出，决定通过/修改/重研              │   │
│  │  5. 报告整合 - 汇总成果，生成完整报告                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│           ┌──────────────────┼──────────────────┐                  │
│           ▼                  ▼                  ▼                  │
│      ┌────────┐        ┌────────┐        ┌────────┐                │
│      │ 🔍 研究│        │ 🔍 研究│        │ 🔍 研究│  ← 动态创建    │
│      │ Agent A│        │ Agent B│        │ Agent C│                │
│      └────────┘        └────────┘        └────────┘                │
│           │                  │                  │                  │
│           └──────────────────┼──────────────────┘                  │
│                              ▼                                      │
│                    ┌──────────────────┐                            │
│                    │   Leader 审核     │                            │
│                    │  通过/修改/重研   │                            │
│                    └──────────────────┘                            │
│                              │                                      │
│                              ▼                                      │
│                    ┌──────────────────┐                            │
│                    │   📊 最终报告     │                            │
│                    └──────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 用户角色定义

**用户是「提示补充者」，不是「流程控制者」**

| 用户可以做的                      | 用户不需要做的               |
| --------------------------------- | ---------------------------- |
| 📝 提供研究目标和背景             | ❌ 手动配置 Agent 数量和角色 |
| 💡 补充 Leader 可能忽略的角度     | ❌ 定义工作流步骤            |
| 🔄 请求调整方向（如"更关注技术"） | ❌ 指定哪个 Agent 做哪个任务 |
| ❓ 询问进度和 Leader 决策理由     | ❌ 管理 Agent 之间的协调     |

### 1.3 Leader 模型配置

```typescript
// AI App 定义诉求，AI Engine 从用户配置的数据库选择模型
// 用户需在 AIModel 表配置：modelType=CHAT, isReasoning=true

// 方式 1: 直接使用 CHAT 类型（用户已配置推理模型为默认）
await this.aiChatService.chat({
  messages,
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "medium",       // temperature: 0.7
    outputLength: "extended",   // maxTokens: 16000+
  },
});

// 方式 2: 新增 getReasoningModel() 方法（推荐）
// 需要在 AiChatService 中新增：
async getReasoningModel(): Promise<AIModelConfig | null> {
  return this.prisma.aIModel.findFirst({
    where: { modelType: 'CHAT', isEnabled: true, isReasoning: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}
```

**用户数据库配置要求**（AIModel 表）：

| 字段          | 值                            | 说明             |
| ------------- | ----------------------------- | ---------------- |
| `modelType`   | `CHAT`                        | 文本聊天类型     |
| `modelId`     | `claude-opus-4` / `o1` / `o3` | 具体模型         |
| `isReasoning` | `true`                        | 标记为推理模型   |
| `isDefault`   | `true`                        | 设为默认（可选） |

---

## 2. 前端设计

### 2.1 详情页布局

```
┌─────────────────────────────────────────────────────────────┐
│  ← 返回   专题: AI 大模型发展趋势             [导出▾][刷新] │
├────────────────┬────────────────────────────────────────────┤
│   【左侧面板】  │            【主内容区】                    │
│   (280px)      │                                            │
│                │  ┌─ Tab: [洞察报告] [团队互动] ──────────┐ │
│  ┌───────────┐│  │       [思考架构] [参考文献]           │ │
│  │ 研究团队  ││  │                                       │ │
│  │ (星型拓扑)││  │  # 摘要                               │ │
│  │           ││  │  本研究聚焦于...                      │ │
│  │    👑     ││  │                                       │ │
│  │  Leader   ││  │  # 关键发现                           │ │
│  │   ╱│╲     ││  │  ## 1. GPT-4o 多模态能力              │ │
│  │  ╱ │ ╲    ││  │  ### 1.1 技术原理                     │ │
│  │ 🔍 🔍 🔍  ││  │  ...                                  │ │
│  │ 维度研究员 ││  │                                       │ │
│  │   │       ││  │                                       │ │
│  │   ▼       ││  │                                       │ │
│  │  ✅ 📊    ││  │                                       │ │
│  │ 审核 撰写 ││  └───────────────────────────────────────┘ │
│  └───────────┘│                                            │
│                │  ─────────────────────────────────────────│
│  ─────────────│                                            │
│  研究进度     │  ┌─────────────────────────────────────────┐
│  ─────────────│  │ 💬 @Leader 聚焦最新论文...      [发送] │
│  ████████░░   │  └─────────────────────────────────────────┘
│  67% | 3:25   │                                            │
└────────────────┴────────────────────────────────────────────┘
```

### 2.2 组件清单

#### 新建组件（9个）

| 组件                        | 职责                            | 行数 |
| --------------------------- | ------------------------------- | ---- |
| `ResearchTeamPanel.tsx`     | 左侧团队可视化（SVG 星型拓扑）  | ~400 |
| `ResearchCommandInput.tsx`  | 底部 @Leader 指令输入框         | ~150 |
| `ResearchProgressBar.tsx`   | 研究进度条                      | ~250 |
| `ReportEditor.tsx`          | 洞察报告编辑器（章节/小节结构） | ~600 |
| `ReportOutlineNav.tsx`      | 报告大纲导航树                  | ~200 |
| `ReportRevisionHistory.tsx` | 修订历史                        | ~300 |
| `ReportAnnotations.tsx`     | 批注功能                        | ~300 |
| `AgentThinkingGraph.tsx`    | Agent 思考架构可视化            | ~500 |
| `ReferencePanel.tsx`        | 参考文献管理                    | ~400 |

#### 重构/删除组件

| 组件                      | 操作                     | 原因                       |
| ------------------------- | ------------------------ | -------------------------- |
| `TopicResearchLayout.tsx` | 重写                     | 新布局结构                 |
| `TopicTeamPanel.tsx`      | 重写 → ResearchTeamPanel | SVG 星型拓扑               |
| `TopicContentPanel.tsx`   | 重构                     | 四 Tab 结构                |
| `TopicResearchCanvas.tsx` | 删除                     | 替换为 ResearchTeamPanel   |
| `RefreshProgress.tsx`     | 删除                     | 合并到 ResearchProgressBar |

### 2.3 团队可视化设计

**颜色配置：**

| Agent      | 图标 | 颜色           | 说明       |
| ---------- | ---- | -------------- | ---------- |
| Leader     | 👑   | `#8B5CF6` 紫色 | 研究协调员 |
| 维度研究员 | 🔍   | `#3B82F6` 蓝色 | 动态创建   |
| 质量审核   | ✅   | `#10B981` 绿色 | 一致性检查 |
| 报告撰写   | 📊   | `#F59E0B` 橙色 | 内容组织   |

**状态样式：**

| 状态     | 样式         | 动画       |
| -------- | ------------ | ---------- |
| ✓ 已完成 | 绿色实心圆   | 无         |
| ◉ 进行中 | 蓝色发光边框 | pulse 1.5s |
| ○ 待开始 | 灰色空心圆   | 无         |
| ✗ 失败   | 红色叉号     | 无         |

### 2.4 四 Tab 设计

| Tab               | 功能                                                       |
| ----------------- | ---------------------------------------------------------- |
| **洞察报告**      | 多层级结构（#/##/###），AI 编辑，导出 PDF/DOCX/MD/HTML/TXT |
| **团队互动**      | Agent 对话历史，Leader 决策过程                            |
| **Agent思考架构** | 每个 Agent 的思考架构 + 输出架构，可折叠                   |
| **参考文献**      | 引用管理，支持跳转原文和报告位置                           |

---

## 3. 后端设计

### 3.1 服务架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Topic Research 模块（重构后）                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ResearchLeaderService [新建]                                │   │
│  │  ├── planResearch()      - Leader 规划维度和工作流          │   │
│  │  ├── reviewAndDecide()   - 审核结果，决定通过/修改/重研     │   │
│  │  ├── handleUserPrompt()  - 处理 @Leader 用户提示            │   │
│  │  └── getLeaderModel()    - 获取用户配置的推理模型           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ResearchMissionService [新建]                               │   │
│  │  ├── createMission()     - 创建研究任务                      │   │
│  │  ├── executeTask()       - 执行单个任务                      │   │
│  │  ├── retryTask()         - 重试失败任务                      │   │
│  │  └── getMissionStatus()  - 获取任务状态                      │   │
│  │                                                              │   │
│  │  复用: AI Teams Mission 框架                                 │   │
│  │  - mission-execution.service.ts                              │   │
│  │  - mission-review.service.ts                                 │   │
│  │  - mission-retry.service.ts                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  现有服务（重构）                                            │   │
│  │  ├── TopicTeamOrchestratorService [重构]                     │   │
│  │  │   └── 集成 Mission 系统，移除硬编码流程                   │   │
│  │  ├── DimensionResearchService [修改]                         │   │
│  │  │   └── 支持 Leader 动态指令和提示词                        │   │
│  │  └── ResearchReviewerService [修改]                          │   │
│  │      └── 审核结果触发 Leader 决策                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 API 清单

#### Leader API（3个）

```
POST   /api/v1/topic-research/:id/leader/plan
       - Leader 生成研究规划（维度、Agent、执行策略）

POST   /api/v1/topic-research/:id/leader/message
       - 处理 @Leader 用户消息（补充提示、调整方向）

GET    /api/v1/topic-research/:id/leader/decisions
       - 获取 Leader 决策历史
```

#### Mission API（3个）

```
GET    /api/v1/topic-research/:id/mission
       - 获取当前 Mission 状态（任务列表、进度）

POST   /api/v1/topic-research/:id/mission/retry
       - 重试失败任务

POST   /api/v1/topic-research/:id/mission/adjust
       - 调整执行策略（Leader 决策后）
```

#### 报告 API（4个）

```
PATCH  /api/v1/topic-research/reports/:id
       - 更新报告内容

POST   /api/v1/topic-research/reports/:id/ai-edit
       - AI 编辑报告（重写/润色/扩写/缩写/风格）

GET    /api/v1/topic-research/reports/:id/revisions
       - 获取修订历史

POST   /api/v1/topic-research/reports/:id/rollback
       - 回滚到历史版本
```

#### 团队 API（1个）

```
GET    /api/v1/topic-research/:id/team
       - 获取当前团队组成（Leader 动态创建的 Agent 列表）
```

### 3.3 数据库 Schema

```prisma
// ==================== 研究 Mission ====================
model ResearchMission {
  id            String         @id @default(cuid())
  topicId       String         @unique
  topic         Topic          @relation(fields: [topicId], references: [id])
  leaderId      String         // Leader Agent ID
  status        MissionStatus
  leaderPlan    Json           // Leader 的规划决策
  tasks         ResearchTask[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

// ==================== 研究任务 ====================
model ResearchTask {
  id            String          @id @default(cuid())
  missionId     String
  mission       ResearchMission @relation(fields: [missionId], references: [id])
  dimensionId   String?
  dimensionName String?         // Leader 定义的维度名称
  assignedAgent String          // 分配的 Agent ID
  priority      Int             @default(0)
  dependencies  String[]        // 依赖的任务 ID
  status        TaskStatus
  result        Json?
  leaderReview  Json?           // Leader 审核意见
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

// ==================== Leader 决策记录 ====================
model LeaderDecision {
  id            String       @id @default(cuid())
  missionId     String
  type          DecisionType
  input         Json         // 输入上下文
  decision      Json         // 决策内容
  reasoning     String       // 决策理由（可展示给用户）
  createdAt     DateTime     @default(now())
}

// ==================== 枚举 ====================
enum MissionStatus {
  PLANNING    // Leader 规划中
  EXECUTING   // 执行中
  REVIEWING   // Leader 审核中
  COMPLETED   // 完成
  FAILED      // 失败
}

enum TaskStatus {
  PENDING         // 待分配
  ASSIGNED        // 已分配
  EXECUTING       // 执行中
  COMPLETED       // 完成
  NEEDS_REVISION  // 需要修订
  FAILED          // 失败
}

enum DecisionType {
  PLAN       // 初始规划
  REVIEW     // 审核决策
  ADJUST     // 调整策略
  INTERVENE  // 用户干预响应
}
```

### 3.4 复用 AI Teams 框架

```typescript
// 复用的现有组件
import { MissionExecutionService } from "ai-app/teams/services/collaboration/mission";
import { MissionReviewService } from "ai-app/teams/services/collaboration/mission";
import { MissionRetryService } from "ai-app/teams/services/collaboration/mission";

// @Leader 消息检测（参考 ai-teams.controller.ts）
// 已在 AI Teams 和 AI Writing 中实装

// 关键复用点：
// 1. mission-execution.service.ts - 任务执行逻辑
// 2. mission-review.service.ts - Leader 审核机制
// 3. mission-retry.service.ts - handleLeaderMentionCommand()
// 4. constraint-enforcement.service.ts - 质量约束
```

---

## 4. 实施计划

### Phase 1: 后端 Leader 服务（P0）

```
目标: 实现 Leader 规划和决策核心能力

[ ] 1.1 新建 ResearchLeaderService
    - planResearch(): 使用推理模型规划维度
    - reviewAndDecide(): 审核任务结果
    - handleUserPrompt(): 处理 @Leader 消息

[ ] 1.2 新建 ResearchMissionService
    - 复用 AI Teams Mission 框架
    - 实现任务创建、执行、重试

[ ] 1.3 重构 TopicTeamOrchestratorService
    - 移除硬编码维度模板
    - 集成 Mission 系统

[ ] 1.4 修改 topic-research.controller.ts
    - 添加 @Leader 消息检测
    - 新增 Leader/Mission API 路由

[ ] 1.5 数据库迁移
    - 添加 ResearchMission、ResearchTask、LeaderDecision 表
```

### Phase 2: 前端布局重构（P0）

```
目标: 实现新的 UI 布局

[ ] 2.1 重写 TopicResearchLayout.tsx
    - 左侧面板 280px（团队+进度）
    - 右侧主内容区（四Tab）
    - 底部指令输入框

[ ] 2.2 创建 ResearchTeamPanel.tsx
    - SVG 星型拓扑
    - 动态 Agent 显示
    - 活动状态闪光动画

[ ] 2.3 创建 ResearchCommandInput.tsx
    - @Leader 提及检测
    - 向上弹出菜单
    - 多行输入支持

[ ] 2.4 创建 ResearchProgressBar.tsx
    - 进度百分比
    - 阶段显示
    - 预计剩余时间
```

### Phase 3: 报告编辑功能（P0）

```
目标: 实现洞察报告 Tab

[ ] 3.1 创建 ReportEditor.tsx
    - 三种视图模式（预览/编辑/分屏）
    - 章节/小节多层级结构
    - AI 编辑工具（底部面板）

[ ] 3.2 创建 ReportOutlineNav.tsx
    - 报告目录树
    - 点击跳转
    - 字数统计

[ ] 3.3 实现导出功能
    - PDF / DOCX / Markdown / HTML / TXT
```

### Phase 4: Agent 思考架构 Tab（P1）

```
[ ] 4.1 创建 AgentThinkingGraph.tsx
    - 每个 Agent 可折叠区域
    - 思考架构树形图
    - 输出架构列表
```

### Phase 5: 参考文献 Tab（P1）

```
[ ] 5.1 创建 ReferencePanel.tsx
    - 分组筛选（按维度/来源/时间）
    - 跳转原文链接
    - 跳转报告引用位置
```

### Phase 6: 高级功能（P2）

```
[ ] 6.1 修订历史（ReportRevisionHistory.tsx）
[ ] 6.2 批注功能（ReportAnnotations.tsx）
[ ] 6.3 动态团队创建完善
```

---

## 5. 文件变更清单

### 前端

```
frontend/components/topic-research/
├── TopicResearchLayout.tsx      [重写]
├── TopicTeamPanel.tsx           [重写] → ResearchTeamPanel.tsx
├── TopicContentPanel.tsx        [重构] - 四 Tab
├── TopicResearchCanvas.tsx      [删除]
├── RefreshProgress.tsx          [删除]
├── TopicCard.tsx                [优化]
│
├── ResearchTeamPanel.tsx        [新建] - SVG 星型拓扑
├── ResearchCommandInput.tsx     [新建] - @Leader 输入
├── ResearchProgressBar.tsx      [新建] - 进度条
├── ReportEditor.tsx             [新建] - 报告编辑器
├── ReportOutlineNav.tsx         [新建] - 大纲导航
├── ReportRevisionHistory.tsx    [新建] - 修订历史
├── ReportAnnotations.tsx        [新建] - 批注
├── AgentThinkingGraph.tsx       [新建] - 思考架构
└── ReferencePanel.tsx           [新建] - 参考文献

frontend/stores/
└── topicResearchStore.ts        [扩展] - 新增状态和方法
```

### 后端

```
backend/src/modules/ai-app/topic-research/
├── topic-research.controller.ts [修改] - @Leader 检测 + 新 API
├── topic-research.module.ts     [修改] - 注入新服务
│
├── services/
│   ├── research-leader.service.ts        [新建] - Leader 核心服务
│   ├── research-mission.service.ts       [新建] - Mission 管理
│   ├── topic-team-orchestrator.service.ts [重构] - 移除硬编码
│   ├── dimension-research.service.ts     [修改] - 动态指令
│   └── research-reviewer.service.ts      [修改] - 触发 Leader
│
└── dto/
    ├── leader-plan.dto.ts               [新建]
    ├── leader-message.dto.ts            [新建]
    └── update-report.dto.ts             [新建]

backend/prisma/
└── schema.prisma                [扩展] - 3 个新模型
```

---

## 6. 验证方案

### 功能验证

```bash
# 1. 创建专题 → Leader 规划
curl -X POST /api/v1/topic-research \
  -d '{"name": "AI 大模型趋势", "type": "TECH_INSIGHT"}'
# 期望: Leader 自动规划维度，非硬编码

# 2. @Leader 消息
curl -X POST /api/v1/topic-research/:id/leader/message \
  -d '{"content": "@Leader 请增加对开源模型的分析"}'
# 期望: Leader 调整研究计划

# 3. 查看 Leader 决策
curl -X GET /api/v1/topic-research/:id/leader/decisions
# 期望: 返回规划、审核、调整等决策记录
```

### 测试命令

```bash
# 类型检查
npm run type-check

# 快速验证
npm run verify:quick

# 开发环境
npm run dev
# 访问 http://localhost:3000/ai-studio/topic-research
```

---

## 7. 附录

### A. 与老设计的对比

| 方面     | v6.0 及之前  | v7.0（本文档）   |
| -------- | ------------ | ---------------- |
| 文档结构 | 历史版本混杂 | 清晰分离前后端   |
| 后端重构 | 分散在各节   | 集中在 Section 3 |
| 实施计划 | 按组件分     | 按功能优先级分   |
| 文件清单 | 散落各处     | 集中在 Section 5 |

### B. 老文档作废

本文档（`topic-research-redesign-v7.md`）为最终版本，作废以下文档：

- `topic-research-ui-redesign.md`（v1.0 ~ v6.0）

---

**版本**: v7.0 (最终版)
**日期**: 2026-01-12
**作者**: Claude (产品经理 + 架构师)
