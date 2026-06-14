# System Overview

> 当前仓库的系统级总览。只描述仍在运行的实现，不复述已淘汰的旧分层。

## 1. 代码信息源

本文基于以下活跃代码：

- `backend/src/app.module.ts`
- `backend/src/__tests__/architecture/layer-boundaries.spec.ts`
- `backend/src/modules/ai-app/teams/ai-teams.module.ts`
- `backend/src/modules/ai-app/teams/controllers/ai-teams.controller.ts`
- `backend/src/modules/ai-app/playground/agent-playground.module.ts`
- `backend/src/modules/ai-app/playground/agent-playground.controller.ts`
- `backend/prisma/schema/models.prisma`
- `frontend/services/ai-teams/api.ts`
- `frontend/stores/ai-teams/index.ts`

## 2. 仓库组件图

```mermaid
flowchart LR
    User[User]
    Frontend[frontend\nNext.js 14]
    Backend[backend\nNestJS 10]
    AIService[ai-service\nFastAPI helper]
    Postgres[(PostgreSQL)]
    Redis[(Redis)]
    Storage[(Object Storage)]
    Infra[infra\nRailway / EdgeOne / scripts]

    User --> Frontend
    Frontend -->|HTTP / SSE / WebSocket| Backend
    Backend --> Postgres
    Backend --> Redis
    Backend --> Storage
    Backend -->|optional helper call| AIService
    Infra -. deploy / ops .-> Frontend
    Infra -. deploy / ops .-> Backend
    Infra -. deploy / ops .-> AIService
```

## 3. 后端五层结构

```mermaid
flowchart TB
    L4[L4 open-api]
    L3[L3 ai-app]
    L25[L2.5 ai-harness]
    L2[L2 ai-engine]
    L1[L1 platform]

    L4 --> L3
    L3 --> L25
    L25 --> L2
    L2 --> L1

    %% 跨层向下依赖合法（非仅相邻层）
    L3 -.-> L2
    L3 -.-> L1
    L25 -.-> L1
```

依赖规则：方向严格自上而下（上层可 import 下层，下层禁止反向 import 上层）。**且不限于相邻层——每层可依赖其下方的任意层**：例如 `ai-app` 经 facade 可直接用 `ai-engine` 与 `platform`，`ai-harness` 可直接用 `platform`（图中虚线）。约束由 `backend/src/__tests__/architecture/layer-1-topology/layer-boundaries.spec.ts` 守护。

含义：

- `open-api` 负责对外入口
- `ai-app` 负责产品能力
- `ai-harness` 负责运行时与 mission 基础设施
- `ai-engine` 负责 LLM、tools、skills、planning 等原子能力
- `platform`（层概念名 ai-infra，真实目录 `modules/platform/`）负责 auth、credits、storage、settings、secrets 等底座

## 4. 当前活跃的多 Agent 系统

| 系统             | 代码目录                                 | 定位                                        | 主要持久化对象                                           |
| ---------------- | ---------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| AI Teams         | `backend/src/modules/ai-app/teams/`      | Topic 协作、AI 成员、辩论、Team Mission     | `Topic*`, `TeamMission`, `AgentTask`, `Vote*`, `Debate*` |
| Agent Playground | `backend/src/modules/ai-app/playground/` | 结构化 mission pipeline、事件流、重跑、导出 | Playground mission store、checkpoint、event buffer       |

两者共用下层：

- `ai-harness`：ownership、abort、checkpoint、event bus、runtime
- `ai-engine`：LLM、tools、skills、content、planning
- `platform`（`modules/platform/`）：auth、credits、storage、notifications

## 5. AI Teams 数据流

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend ai-teams
    participant API as AiTeamsController
    participant SVC as AiTeamsService
    participant WS as AiTeamsGateway
    participant DB as PostgreSQL
    participant AI as AI stack

    U->>FE: 发送消息
    FE->>API: POST /api/v1/topics/:topicId/messages
    API->>SVC: sendMessage()
    SVC->>DB: 写 TopicMessage
    API->>WS: emit message:new
    API->>API: 检测 mentions / debate / leader command
    API->>AI: 异步触发回复、辩论或 mission 分支
    AI->>SVC: 生成 AI Message / Mission / Debate round
    SVC->>DB: 持久化
    WS-->>FE: message:new / ai:typing / mission:* / debate:*
```

## 6. Agent Playground 数据流

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend playground
    participant API as AgentPlaygroundController
    participant PIPE as PlaygroundPipelineDispatcher
    participant H as ai-harness
    participant ENG as ai-engine
    participant DB as PostgreSQL
    participant EV as Event Buffer / WS

    U->>FE: 启动 mission
    FE->>API: POST /api/v1/agent-playground/team/run
    API->>PIPE: runMission()
    PIPE->>H: 组装 runtime / ownership / checkpoint / abort
    H->>ENG: 执行角色 agent、skills、tools、LLM
    ENG-->>H: 返回结构化结果
    H-->>PIPE: stage result / telemetry / guardrail
    PIPE->>DB: persist mission / artifact / checkpoint
    PIPE->>EV: emit agent-playground.*
    EV-->>FE: WebSocket 推送
    FE->>API: GET /replay/:missionId 兜底补拉
```

## 7. 核心存储

### 7.1 AI Teams

活跃模型：

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

### 7.2 Agent Playground

活跃运行时对象：

- `MissionStore`
- `MissionCheckpointService`
- `MissionEventBuffer`
- `MissionOwnershipRegistry`
- `MissionAbortRegistry`

## 8. 维护要求

1. 架构图、数据流图必须能指回 controller、gateway、service、Prisma 模型或前端 store。
2. 旧的 `ai-engine/teams` 叙述不应再作为当前实现写入活跃入口文档。
3. 顶层结构变化时，优先更新本文、`docs/README.md`、`STRUCTURE.md`。
