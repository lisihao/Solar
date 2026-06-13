# AI Apps 对 AI Engine 能力使用矩阵

> 本文档描述各 AI App 模块对 AI Engine 核心能力的使用情况，以及访问方式是否符合架构规范。

**最后更新**: 2026-02-21
**版本**: 1.0（整改后状态）

---

## 访问方式说明

| 符号            | 含义                               |
| --------------- | ---------------------------------- |
| ✅ Facade       | 通过 `AIEngineFacade` 访问（合规） |
| ✅ Registry     | 通过 Registry 访问（合规）         |
| ✅ onModuleInit | 通过 `onModuleInit` 注册（合规）   |
| —               | 未使用                             |

---

## 能力矩阵

| App 模块      | LLM Chat | LLM Stream | LLM Structured | Skills | Tools | Teams/Agents | RAG/Search | Memory | Image Gen | MCP | Long Content | Model Select |
| ------------- | :------: | :--------: | :------------: | :----: | :---: | :----------: | :--------: | :----: | :-------: | :-: | :----------: | :----------: |
| Research      |    ✅    |     ✅     |       ✅       |   ✅   |   —   |      ✅      |     ✅     |   ✅   |     —     |  —  |      —       |      ✅      |
| Teams         |    ✅    |     ✅     |       ✅       |   ✅   |  ✅   |      ✅      |     ✅     |   ✅   |     —     |  —  |      ✅      |      ✅      |
| Writing       |    ✅    |     ✅     |       ✅       |   ✅   |   —   |      ✅      |     ✅     |   ✅   |     —     |  —  |      ✅      |      ✅      |
| Office        |    ✅    |     ✅     |       ✅       |   ✅   |   —   |      ✅      |     —      |   —    |    ✅     |  —  |      —       |      ✅      |
| Ask           |    ✅    |     ✅     |       —        |   —    |  ✅   |      —       |     ✅     |   ✅   |     —     |  —  |      —       |      ✅      |
| Social        |    ✅    |     —      |       ✅       |   —    |   —   |      —       |     —      |   —    |     —     | ✅  |      —       |      ✅      |
| Image         |    ✅    |     —      |       —        |   —    |   —   |      ✅      |     —      |   —    |    ✅     |  —  |      —       |      ✅      |
| Coding        |    —     |     —      |       —        |   —    |   —   |      —       |     —      |   —    |     —     |  —  |      —       |      —       |
| Simulation    |    ✅    |     —      |       ✅       |   —    |   —   |      —       |     —      |   —    |     —     |  —  |      —       |      ✅      |
| Planning      |    ✅    |     —      |       ✅       |   —    |   —   |      ✅      |     —      |   —    |     —     |  —  |      —       |      ✅      |
| Insight       |    ✅    |     ✅     |       ✅       |   ✅   |  ✅   |      —       |     ✅     |   ✅   |     —     |  —  |      ✅      |      ✅      |
| RAG（业务层） |    —     |     —      |       —        |   —    |   —   |      —       |     ✅     |   —    |     —     |  —  |      —       |      —       |

---

## 访问方式详情

### Research (`ai-app/research/`)

| 能力           | 访问路径                                            |
| -------------- | --------------------------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`                             |
| LLM Stream     | `AIEngineFacade.chatStream()`                       |
| LLM Structured | `AIEngineFacade.chatStructured()`                   |
| Skills         | `SkillRegistry` (Registry 访问)                     |
| Teams/Agents   | `AIEngineFacade.startTeamMission()`                 |
| RAG/Search     | `AIEngineFacade.search()`                           |
| Memory         | `AIEngineFacade.storeMemory()` / `retrieveMemory()` |
| Model Select   | `AIEngineFacade.selectModel()`                      |

### Teams (`ai-app/teams/`)

| 能力           | 访问路径                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`                                                   |
| LLM Stream     | `AIEngineFacade.chatStream()`                                             |
| LLM Structured | `AIEngineFacade.chatStructured()`                                         |
| Skills         | `SkillRegistry` (Registry 访问)                                           |
| Tools          | `AIEngineFacade.executeTool()`                                            |
| Teams/Agents   | `AIEngineFacade.startTeamMission()` / `AgentRegistry` (onModuleInit 注册) |
| RAG/Search     | `AIEngineFacade.search()`                                                 |
| Memory         | `AIEngineFacade.storeMemory()` / `retrieveMemory()`                       |
| Long Content   | `AIEngineFacade.chat()` (长 context)                                      |
| Model Select   | `AIEngineFacade.selectModel()`                                            |

### Writing (`ai-app/writing/`)

| 能力           | 访问路径                                            |
| -------------- | --------------------------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`                             |
| LLM Stream     | `AIEngineFacade.chatStream()`                       |
| LLM Structured | `AIEngineFacade.chatStructured()`                   |
| Skills         | `SkillRegistry` (Registry 访问)                     |
| Teams/Agents   | `AIEngineFacade.startTeamMission()`                 |
| RAG/Search     | `AIEngineFacade.search()`                           |
| Memory         | `AIEngineFacade.storeMemory()` / `retrieveMemory()` |
| Long Content   | `AIEngineFacade.chatStream()` (长文本流式)          |
| Model Select   | `AIEngineFacade.selectModel()`                      |

### Office (`ai-app/office/`)

| 能力           | 访问路径                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| LLM Chat       | `AIEngineFacade.chat()`                                                  |
| LLM Stream     | `AIEngineFacade.chatStream()`                                            |
| LLM Structured | `AIEngineFacade.chatStructured()`                                        |
| Skills         | `SkillRegistry.tryGet()` + `AIEngineFacade.executeSkill()`               |
| Teams/Agents   | `AIEngineFacade.startTeamMission()` / `TeamRegistry` (onModuleInit 注册) |
| Image Gen      | `AIEngineFacade.executeMissionStream()` (Visual Design Team)             |
| Model Select   | `AIEngineFacade.getDefaultTextModel()`                                   |

> **整改记录**: `SlidesTeamMember` 原直接注入 `AiChatLLMAdapter` + `InputBindingResolver`，已迁移至通过 `AIEngineFacade.executeSkill()` 和 `AIEngineFacade.resolveSkillInputBindings()` 访问。

### Ask (`ai-app/ask/`)

| 能力         | 访问路径                                                   |
| ------------ | ---------------------------------------------------------- |
| LLM Chat     | `AIEngineFacade.chat()`                                    |
| LLM Stream   | `AIEngineFacade.chatStream()`                              |
| Tools        | `AIEngineFacade.chatWithTools()` / `chatWithToolsStream()` |
| RAG/Search   | `AIEngineFacade.search()`                                  |
| Memory       | `AIEngineFacade.storeMemory()` / `retrieveMemory()`        |
| Model Select | `AIEngineFacade.getAvailableModels()`                      |

### Social (`ai-app/social/`)

| 能力           | 访问路径                                  |
| -------------- | ----------------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`                   |
| LLM Structured | `AIEngineFacade.chatStructured()`         |
| MCP            | `AIEngineFacade.executeTool()` (MCP 工具) |
| Model Select   | `AIEngineFacade.selectModel()`            |

### Image (`ai-app/image/`)

| 能力         | 访问路径                                                           |
| ------------ | ------------------------------------------------------------------ |
| LLM Chat     | `AIEngineFacade.chat()`                                            |
| Teams/Agents | `AIEngineFacade.executeMissionStream()` (流式，Visual Design Team) |
| Image Gen    | `AIEngineFacade.getFullModelConfig()` (获取图像模型配置)           |
| Model Select | `AIEngineFacade.getDefaultImageModel()`                            |

> **整改记录**: `Imagen4PromptService` 原直接注入 `TeamsService` 调用 `executeMissionStream()`，已迁移至通过 `AIEngineFacade.executeMissionStream()` 访问。

### Coding (`ai-app/coding/`)

当前无 AI Engine 能力调用（待实现）。

### Simulation (`ai-app/simulation/`)

| 能力           | 访问路径                            |
| -------------- | ----------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`             |
| LLM Structured | `AIEngineFacade.chatStructured()`   |
| Teams/Agents   | `AIEngineFacade.startTeamMission()` |
| Model Select   | `AIEngineFacade.selectModel()`      |

### Planning (`ai-app/planning/`)

| 能力           | 访问路径                            |
| -------------- | ----------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`             |
| LLM Structured | `AIEngineFacade.chatStructured()`   |
| Teams/Agents   | `AIEngineFacade.startTeamMission()` |
| Model Select   | `AIEngineFacade.selectModel()`      |

### Insight (`ai-app/insight/`)

| 能力           | 访问路径                                            |
| -------------- | --------------------------------------------------- |
| LLM Chat       | `AIEngineFacade.chat()`                             |
| LLM Stream     | `AIEngineFacade.chatStream()`                       |
| LLM Structured | `AIEngineFacade.chatStructured()`                   |
| Skills         | `SkillRegistry` (Registry 访问)                     |
| Tools          | `AIEngineFacade.executeTool()`                      |
| RAG/Search     | `AIEngineFacade.search()`                           |
| Memory         | `AIEngineFacade.storeMemory()` / `retrieveMemory()` |
| Long Content   | `AIEngineFacade.chatStream()`                       |
| Model Select   | `AIEngineFacade.selectModel()`                      |

### RAG 业务层 (`ai-app/rag/`)

| 能力       | 访问路径                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| RAG/Search | `AIEngineFacade.search()` + EmbeddingService（通过 AiEngineModule 导出） |

---

## 整改历史

### 2026-02-21 架构边界修复

| 违规文件                                                   | 违规内容                                                                             | 修复方案                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `ai-app/image/generation/imagen4-prompt.service.ts`        | 直接注入 `TeamsService`，调用 `executeMissionStream()`                               | 在 `AIEngineFacade` 新增 `executeMissionStream()` 方法；App 改为注入 Facade                |
| `ai-app/office/slides/orchestrator/slides-team-member.ts`  | 直接注入 `AiChatLLMAdapter` + `InputBindingResolver`，使用 `PromptSkillAdapter` 类型 | 在 Facade 新增 `executeSkill()` 和 `resolveSkillInputBindings()` 方法；App 改为注入 Facade |
| `ai-app/office/slides/orchestrator/multi-model.service.ts` | 已标 `@deprecated`，仍注册为 Provider                                                | 删除文件及所有注册/导出                                                                    |

---

## Facade 公开方法速查

### 团队协作

```typescript
// 轮询式任务执行（适合批处理）
facade.startTeamMission({ teamType, missionInput, progressCallback })

// 流式任务执行（适合实时 UI）（2026-02-21 新增）
facade.executeMissionStream(dto: CreateMissionDto): AsyncGenerator<MissionEvent>

facade.cancelMission(missionId: string): boolean
facade.getMissionStatus(missionId: string): MissionStatus | null
```

### Skill 执行（2026-02-21 新增）

```typescript
// 执行 Skill（内部自动注入 LLM 适配器，供 code-based skills 使用）
facade.executeSkill(skill: ISkill, input: unknown, context: SkillContext): Promise<SkillResult>

// 解析 PromptSkillAdapter 的声明式 InputBinding
// 返回 null 表示非 PromptSkillAdapter 或无 bindings 声明
facade.resolveSkillInputBindings(skill: ISkill, bindingContext: BindingContext): Record<string, unknown> | null
```
