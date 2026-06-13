# Teams Architecture

> 当前多 Agent 文档的主入口。这里只描述活跃代码，不再沿用旧 `ai-engine/teams` 设计。

## 1. 范围

本目录对应两套并行系统：

1. `ai-app/teams`
2. `ai-app/playground`（前端路由为 `agent-playground`）

## 2. 组件关系图

```mermaid
flowchart TB
    subgraph FE[Frontend]
        TeamsUI[ai-teams routes]
        PlayUI[agent-playground routes]
        TeamStore[stores/ai-teams]
        PlayStream[useAgentPlaygroundStream]
    end

    subgraph API[Backend API]
        TeamsCtrl[AiTeamsController]
        TeamsWS[AiTeamsGateway]
        PlayCtrl[AgentPlaygroundController]
        PlayWS[AgentPlaygroundGateway]
    end

    subgraph APP[ai-app]
        TeamsSvc[AiTeamsService]
        MissionSvc[TeamMissionService]
        DebateSvc[DebateService]
        Pipeline[PlaygroundPipelineDispatcher]
    end

    subgraph Lower[Lower Layers]
        Harness[ai-harness facade/runtime]
        Engine[ai-engine facade]
        Infra[platform L1]
    end

    DB[(PostgreSQL)]

    TeamsUI --> TeamsCtrl
    TeamsUI --> TeamsWS
    TeamStore --> TeamsWS
    PlayUI --> PlayCtrl
    PlayUI --> PlayWS
    PlayStream --> PlayWS
    PlayStream --> PlayCtrl

    TeamsCtrl --> TeamsSvc
    TeamsCtrl --> MissionSvc
    TeamsCtrl --> DebateSvc
    PlayCtrl --> Pipeline

    TeamsSvc --> Engine
    MissionSvc --> Engine
    DebateSvc --> Engine
    Pipeline --> Harness
    Harness --> Engine
    TeamsSvc --> Infra
    MissionSvc --> Infra
    DebateSvc --> Infra

    TeamsSvc --> DB
    MissionSvc --> DB
    DebateSvc --> DB
    Pipeline --> DB
```

## 3. `ai-app/teams`

### 3.1 后端结构

当前活跃入口：

- `ai-teams.module.ts`
- `controllers/ai-teams.controller.ts`
- `ai-teams.gateway.ts`
- `ai-teams.service.ts`
- `teams.repository.ts`

当前核心服务：

| 服务                           | 作用                                     |
| ------------------------------ | ---------------------------------------- |
| `AiTeamsService`               | Topic、Message、Resource、Summary 主入口 |
| `TeamMissionService`           | Team Mission 主入口                      |
| `MissionExecutionService`      | 子任务执行                               |
| `MissionReviewService`         | Leader 审核                              |
| `MissionLifecycleService`      | 生命周期管理                             |
| `MissionRetryService`          | 重试                                     |
| `MissionHealthCheckService`    | 健康检查                                 |
| `MissionAICallerService`       | AI 调用封装                              |
| `DebateService`                | Debate session                           |
| `AiResponseService`            | 普通 @AI 回复                            |
| `TopicContextRetrievalService` | Topic 上下文检索                         |
| `ContextRouterService`         | 回复路径路由                             |

### 3.2 前端结构

当前活跃入口：

- `frontend/app/ai-teams/page.tsx`
- `frontend/app/ai-teams/[topicId]/page.tsx`
- `frontend/services/ai-teams/api.ts`
- `frontend/stores/ai-teams/`

store 当前拆成：

- `topicsSlice`
- `messagesSlice`
- `missionsSlice`
- `websocketSlice`

### 3.3 持久化模型

当前活跃 Prisma 模型：

- `Topic`
- `TopicMember`
- `TopicAIMember`
- `TopicMessage`
- `TopicMessageMention`
- `TopicMessageAttachment`
- `TopicMessageReaction`
- `TopicResource`
- `TopicSummary`
- `TopicJoinRequest`
- `TeamMission`
- `AgentTask`
- `MissionLog`
- `VoteProposal`
- `VoteRecord`
- `DebateSession`
- `DebateAgent`
- `DebateMessage`

### 3.4 Topic 消息流

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as AiTeamsController
    participant SVC as AiTeamsService
    participant WS as AiTeamsGateway
    participant DB as PostgreSQL

    FE->>API: POST /topics/:topicId/messages
    API->>SVC: sendMessage()
    SVC->>DB: create TopicMessage
    API->>WS: emit message:new
    API->>API: 检测 mentions / URL / debate / leader command
    API-->>WS: emit ai:typing / ai:response / mission:* / debate:*
    WS-->>FE: WebSocket updates
```

前端当前消费的主要事件：

- `message:new`
- `message:delete`
- `reaction:add`
- `reaction:remove`
- `member:typing`
- `ai:typing`
- `ai:response`
- `ai:error`
- `mission:created`
- `mission:status_changed`
- `mission:progress_updated`
- `task:completed`
- `task:status`
- `mission:agent_working`
- `mission:agent_done`
- `mission:completed`
- `mission:failed`

### 3.5 Team Mission 流

```mermaid
flowchart TD
    A[POST /topics/:topicId/missions] --> B[TeamMissionService.createMission]
    B --> C[Persist TeamMission]
    C --> D[Leader planning]
    D --> E[Create AgentTask[]]
    E --> F[Mission execution]
    F --> G[Leader review / revision]
    G --> H[finalResult + summary]
    H --> I[emit mission:*]
```

### 3.6 Debate 流

```mermaid
flowchart TD
    A[消息满足 debate 条件] --> B[DebateService.createDebateSession]
    B --> C[Create DebateSession]
    C --> D[Create DebateAgent RED/BLUE]
    D --> E[Generate DebateMessage per round]
    E --> F[Optional sync to TopicMessage]
    F --> G[emit debate:* and message:new]
```

## 4. `agent-playground`

### 4.1 当前事实

Playground 不是 `TeamMission` 的别名，而是独立的 pipeline 系统：

- 入口：`PlaygroundPipelineDispatcher`
- 通道：HTTP + WebSocket + `/replay/:missionId`
- 运行时依赖：ownership、abort、checkpoint、event buffer
- 事件命名空间：`agent-playground.*`

### 4.2 活跃 API

- `GET /agent-playground/missions`
- `GET /agent-playground/missions/:id`
- `POST /agent-playground/team/run`
- `POST /agent-playground/missions/:id/rerun`
- `POST /agent-playground/missions/:id/todos/:todoId/rerun`
- `POST /agent-playground/missions/:id/todos/:todoId/local-rerun`
- `POST /agent-playground/missions/:id/cancel`
- `GET /agent-playground/replay/:missionId`
- `GET|POST /agent-playground/missions/:id/leader-chat`
- `GET /agent-playground/missions/:id/export`

### 4.3 Stage 主干

当前主干 stage：

1. `s1-mission-estimate-budget`
2. `s2-leader-plan-mission`
3. `s3-researcher-collect-findings`
4. `s4-leader-assess-research`
5. `s5-reconciler-cross-dim-fact-check`
6. `s6-analyst-synthesize-insights`
7. `s7-writer-plan-outline`
8. `s8-writer-draft-report`
9. `s9-reviewer-critic-l4`
10. `s10-leader-foreword-and-signoff`
11. `s11-mission-persist`

### 4.4 事件流

```mermaid
sequenceDiagram
    participant FE as mission page
    participant API as AgentPlaygroundController
    participant PIPE as PlaygroundPipelineDispatcher
    participant BUS as Event Buffer / DomainEventBus
    participant WS as AgentPlaygroundGateway
    participant DB as MissionStore / Prisma

    FE->>API: POST /agent-playground/team/run
    API->>PIPE: runMission()
    PIPE->>DB: persist running state
    PIPE->>BUS: emit agent-playground.*
    BUS->>WS: broadcast room events
    WS-->>FE: live events
    FE->>API: GET /replay/:missionId
    API-->>FE: buffered/persisted events
```

关键事件：

- `agent-playground.mission:started`
- `agent-playground.mission:completed`
- `agent-playground.mission:failed`
- `agent-playground.mission:cancelled`
- `agent-playground.mission:rerun-started`
- `agent-playground.mission:rerun-completed`
- `agent-playground.mission:rerun-failed`
- `agent-playground.draft:completed`
- `agent-playground.mission:budget-warning-soft`
- `agent-playground.mission:budget-warning-hard`
- `agent-playground.mission:persist-failed`
- `agent-playground.event:oversized`

## 5. 结论

当前代码的真实分工是：

- `ai-app/teams` 负责实时协作型多 Agent 产品
- `ai-app/playground` 负责结构化 pipeline 型多 Agent 产品（前端路由仍为 `agent-playground`）
- `ai-harness` 提供运行时
- `ai-engine` 提供原子 AI 能力

因此，任何继续把当前主实现写成 `ai-engine/teams/*` 的文档都应视为历史描述。
