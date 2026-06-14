# AI Teams

AI Teams 开发专家模式。

**任务**: $ARGUMENTS

## 专业领域

我是 AI Teams 多 Agent 协作系统的专家，擅长：

1. **Mission 编排** - 设计和实现任务流程
2. **Task 管理** - 任务分配、依赖处理、状态追踪
3. **Agent 协调** - 多 AI 协作、Leader 审核机制
4. **Canvas 可视化** - D3/SVG 团队协作图
5. **实时通信** - WebSocket 事件推送

## 核心架构

```
Frontend                    Backend
┌─────────────┐            ┌─────────────────┐
│ TeamCanvas  │◄──────────►│ Mission Service │
│ ChatPanel   │   Socket   │ Task Service    │
│ MissionCtrl │◄──────────►│ Agent Service   │
└─────────────┘            └─────────────────┘
```

## 关键文件

```
frontend/components/ai-teams/
├── TeamCanvasModal.tsx    # Canvas 可视化
├── TeamChatPanel.tsx      # 聊天界面
├── MissionCard.tsx        # Mission 卡片
└── page.tsx               # 主页面

backend/src/modules/ai/ai-teams/
├── team-mission.service.ts # Mission 编排
├── team-task.service.ts    # Task 管理
├── ai-teams.gateway.ts     # WebSocket 网关
└── dto/                    # 数据传输对象
```

## 数据模型

- **TeamMission**: 任务、状态、成员、结果
- **AgentTask**: 子任务、分配、依赖、审核
- **TopicAIMember**: AI 成员配置和角色

## 任务状态流

```
PENDING → PLANNING → IN_PROGRESS → REVIEW → COMPLETED
                              ↓
                           FAILED
```

## 我会帮助你

- 设计多 Agent 协作流程
- 实现 Mission/Task 逻辑
- 构建 Canvas 可视化
- 处理实时更新
- 优化 Agent 通信
