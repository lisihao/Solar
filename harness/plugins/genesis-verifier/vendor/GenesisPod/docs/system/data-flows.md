# System Data Flows

> 数据流文档回答“关键请求如何穿过前端、控制器、服务、存储和实时通道”。

## 代码信息源

- `backend/src/modules/ai-app/teams/controllers/ai-teams.controller.ts`
- `backend/src/modules/ai-app/teams/ai-teams.gateway.ts`
- `backend/src/modules/ai-app/playground/agent-playground.controller.ts`
- `frontend/services/ai-teams/api.ts`
- `frontend/stores/ai-teams/index.ts`
- `backend/prisma/schema/models.prisma`

## AI Teams

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
    API->>AI: 触发 AI 回复 / Debate / Mission
    AI->>SVC: 生成消息或任务结果
    SVC->>DB: 持久化
    WS-->>FE: message:new / ai:typing / mission:* / debate:*
```

## Agent Playground

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
    PIPE->>H: 组装 runtime / checkpoint / abort
    H->>ENG: 执行 agent、skills、tools、LLM
    ENG-->>H: 返回阶段结果
    H-->>PIPE: 运行时结果
    PIPE->>DB: persist mission / artifact / checkpoint
    PIPE->>EV: emit agent-playground.*
    EV-->>FE: WebSocket 推送
    FE->>API: GET /replay/:missionId 补拉
```

## 说明

- AI Teams 重点是 Topic 上下文内的协作和实时消息。
- Agent Playground 重点是结构化流水线、事件流和回放体系。
- 两条主链路都依赖下层 `ai-harness`、`ai-engine` 和基础存储。

## 下钻

- 系统边界见 [context.md](context.md) 和 [container.md](container.md)
- 合并总览见 [../architecture/system-overview.md](../architecture/system-overview.md)
