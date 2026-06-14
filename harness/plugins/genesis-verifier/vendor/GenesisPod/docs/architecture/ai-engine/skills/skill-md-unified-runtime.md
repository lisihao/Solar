# 统一 SKILL.md Runtime 设计方案

> Version: 2.0
> Author: Architect Agent
> Date: 2026-02-08
> Status: Final Draft (Reviewed)
> Related: [ai-engine-skills-replace-code.md](./ai-engine-skills-replace-code.md), [ai-tools-skills-integration.md](../ai-tools-skills-integration.md)

---

## 1. Executive Summary

### 1.1 业界生态背景

Agent Skills Standard（agentskills.io）已成为事实标准：

| 指标              | 数据                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| SkillsMP 市场规模 | 160,000+ Skills                                                       |
| 采纳方            | Anthropic, OpenAI, Microsoft, Cursor, GitHub, Atlassian, Figma        |
| 治理              | Linux Foundation / Agentic AI Foundation (OpenAI + Anthropic + Block) |
| 格式              | SKILL.md (YAML frontmatter + Markdown body)                           |

**业界共识：双轨制**

```
Track 1: Skills (SKILL.md)  = 知识、流程、领域专长 → 教 AI "怎么想"
Track 2: Tools  (MCP/ISkill) = 执行能力、外部连接 → 给 AI "手和脚"
```

Skills 和 Tools 是互补关系，不是竞争关系。Skills 是食谱，Tools 是食材。

### 1.2 当前问题

系统存在两条独立的技能管线：

```
路径 A (SKILL.md → prompt 注入):
  SkillLoaderService → SkillPromptBuilder → chatWithSkills()
  消费者: Writing (5 个服务), Topic-Insights (1 个服务)

路径 B (ISkill → 直接执行):
  .skill.ts → SkillRegistry.register() → skill.execute()
  消费者: SlidesTeamMember, BaseAgent, BaseExecutor, MissionOrchestrator
```

**具体问题**：

1. **SkillsMP 安装的 SKILL.md 无法进入路径 B** — Slides/Agent/Executor 消费不到
2. **Slides 15 个 prompt 型 .skill.ts 本质是 Skills 却用 Tool 格式** — 300 行提示词硬编码在 TypeScript 中，无法通过 SkillsMP 共享/替换
3. **SlidesTeamMember.buildSkillInput() 有 87 行 switch/case** — 每个 skill 的输入映射硬编码

### 1.3 设计原则

**遵循业界双轨共识：Skills 是 Skills，Tools 是 Tools，不混为一谈。**

| 类别                  | 定义                                        | 格式                                    | 执行方式                      |
| --------------------- | ------------------------------------------- | --------------------------------------- | ----------------------------- |
| **Skill** (知识/流程) | 通过系统提示词增强 LLM 行为，输出结构化结果 | SKILL.md                                | PromptSkillAdapter → LLM 调用 |
| **Tool** (执行能力)   | 确定性代码逻辑，无 LLM 参与或仅辅助         | NestJS @Injectable + companion SKILL.md | NestJS DI → skill.execute()   |

**不做的事**：

- ~~ScriptSkillAdapter (require() 动态加载脚本)~~ — 后端服务不应绕过 DI 执行不受管理的代码
- ~~HybridSkillAdapter~~ — Tool 和 Skill 的混合体是 category error
- ~~迁移 code 型 .skill.ts 到 scripts/execute.ts~~ — 确定性计算工具保留 NestJS DI

### 1.4 设计目标

```
                      ┌─────────────────────────────────┐
                      │     Agent Skills 生态 (开放)     │
                      │   SkillsMP / 社区 / 自建        │
                      └───────────────┬─────────────────┘
                                      │ SKILL.md
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    SkillMdRuntime                             │
│  ┌────────────────────┐    ┌──────────────────────────────┐  │
│  │  PromptSkillAdapter │    │  NestJS ISkill Provider      │  │
│  │  (SKILL.md → ISkill)│    │  (代码能力，完整 DI)         │  │
│  │                     │    │  + companion SKILL.md (元数据)│  │
│  │  ● 15 prompt skills │    │  ● template-rendering       │  │
│  │  ● SkillsMP 安装的  │    │  ● chart-renderer           │  │
│  │  ● 社区贡献的        │    │  ● image-fetcher            │  │
│  │                     │    │  ● template-matcher          │  │
│  │                     │    │  ● page-pipeline             │  │
│  │                     │    │  ● page-type-selection       │  │
│  └─────────┬──────────┘    └──────────────┬───────────────┘  │
│            └───────────┬───────────────────┘                  │
│                        ▼                                      │
│              SkillRegistry（统一注册表）                        │
│     BaseAgent / BaseExecutor / MissionOrchestrator / Slides   │
└──────────────────────────────────────────────────────────────┘
```

### 1.5 AI Apps 覆盖范围

| 模块         | 当前状态        | 本次改造           | 说明                                                                 |
| ------------ | --------------- | ------------------ | -------------------------------------------------------------------- |
| AI Slides    | 21 个 .skill.ts | **Phase 2-4 核心** | 15 prompt skills → SKILL.md; 6 code skills 保留 + companion SKILL.md |
| AI Writing   | 9 个 .skill.md  | **Phase 5 接入**   | 已有 SKILL.md，注册到 SkillRegistry                                  |
| AI Insights  | 11 个 .skill.md | **Phase 5 接入**   | 已有 SKILL.md，注册到 SkillRegistry                                  |
| AI Research  | 无 skills       | 不在范围           | 纯服务架构                                                           |
| 其他 AI Apps | 无 skills       | 不在范围           | 未来按需增加                                                         |

---

## 2. 现状分析

### 2.1 SkillRegistry 消费者（审计实证）

SkillRegistry.tryGet() 是 AI Engine 的**核心执行路径**，不仅仅是 Slides 在用：

| 消费者               | 文件                                                           | 调用方式                         |
| -------------------- | -------------------------------------------------------------- | -------------------------------- |
| SlidesTeamMember     | `slides/orchestrator/slides-team-member.ts:57`                 | `skillRegistry.tryGet(skillId)`  |
| BaseAgent            | `ai-engine/agents/base/base-agent.ts:335`                      | `skillRegistry.tryGet(skillId)`  |
| BaseExecutor         | `ai-engine/orchestration/executors/base-executor.ts:223`       | `skillRegistry.tryGet(skillId)`  |
| MissionOrchestrator  | `ai-engine/teams/orchestrator/mission-orchestrator.ts:1167`    | `skillRegistry.tryGet(skillId)`  |
| AICapabilityResolver | `ai-engine/capabilities/ai-capability-resolver.service.ts:135` | `skillRegistry.tryGet(skillId)`  |
| AiAdminService       | `core/admin/ai-admin.service.ts:1572`                          | `skillRegistry.tryGet(skill.id)` |

### 2.2 chatWithSkills() 消费者（审计实证）

| 消费者                 | 文件                                                          |
| ---------------------- | ------------------------------------------------------------- |
| WriterAgent            | `writing/agents/writer.agent.ts`                              |
| OutlineService         | `writing/services/writing/outline.service.ts`                 |
| WritingQualityChecker  | `writing/services/quality/writing-quality-checker.service.ts` |
| FactExtractor          | `writing/services/consistency/fact-extractor.service.ts`      |
| ChapterRevisionService | `writing/services/writing/chapter-revision.service.ts`        |
| SectionWriterService   | `topic-insights/services/dimension/section-writer.service.ts` |

### 2.3 Slides Skills 分类（审计实证）

| 类别              | 数量 | 特征                                     | 本次处理                                 |
| ----------------- | ---- | ---------------------------------------- | ---------------------------------------- |
| **Prompt Skills** | 15   | 构建提示词 → aiFacade.chat() → 解析 JSON | 迁移到 SKILL.md + PromptSkillAdapter     |
| **Code Tools**    | 4    | 确定性逻辑，无 LLM。有 NestJS DI 依赖    | 保留 .skill.ts + 添加 companion SKILL.md |
| **Orchestrators** | 2    | 协调多个 skill 执行                      | 保留 .skill.ts + 添加 companion SKILL.md |

**Prompt Skills（迁移）**：task-decomposition, outline-planning, four-step-design, content-compression, data-supplement, content-analyzer, layout-optimizer, terminology-unifier, transition-checker, quality-audit, slide-thinking, voice-narration, content-polisher, fact-checker, layout-fixer

**Code Tools（保留）**：template-rendering (2217 LOC, 注入 ChartRendererSkill), chart-renderer (注入 ECharts SSR), image-fetcher (HTTP), template-matcher (加权算法)

**Orchestrators（保留）**：page-pipeline (编排多 skill), page-type-selection (路由逻辑)

### 2.4 SlidesTeamMember.buildSkillInput() 问题

`slides-team-member.ts:172-259` 包含 87 行 switch/case，为每个 skillId 硬编码输入映射：

```typescript
switch (task.skillId) {
  case "task-decomposition":
  case "slides-task-decomposition":
    return { sourceText: context.globalContext.sourceText, ... };
  case "outline-planning":
  case "slides-outline-planning":
    const taskDecomposition = getOutput("task-decomposition");
    return { taskDecomposition, sourceText: ..., ... };
  // ... 10+ 更多 case
}
```

**原方案未解决此问题。** 本方案通过声明式输入绑定解决。

---

## 3. 架构设计

### 3.1 核心组件

```
┌─────────────────────────────────────────────────────────────────┐
│  加载阶段 (onModuleInit)                                          │
│                                                                   │
│  SkillLoaderService                                               │
│     ├─ 扫描 */SKILL.md + *.skill.md                              │
│     ├─ SkillParser 解析 → SkillMdDefinition[]                    │
│     │                                                             │
│     ▼                                                             │
│  PromptSkillBridge (新增)                                         │
│     │                                                             │
│     ├─ 遍历所有 SkillMdDefinition                                 │
│     ├─ 检查 SkillRegistry: 同 ID 已有 code-based skill?          │
│     │   ├─ YES → 跳过 (code-based 优先)                          │
│     │   └─ NO  → 创建 PromptSkillAdapter → 注册                  │
│     │                                                             │
│     └─ SkillRegistry.register(adapter)                            │
│                                                                   │
│  SlidesSkillsModule.onModuleInit() (现有，简化)                    │
│     ├─ 注册 6 个 code-based ISkill (NestJS DI)                   │
│     └─ 调用 PromptSkillBridge 注册 prompt skills                  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  执行阶段 (运行时)                                                 │
│                                                                   │
│  SlidesTeamMember / BaseAgent / MissionOrchestrator               │
│     │                                                             │
│     ├─ SkillRegistry.tryGet(skillId) → ISkill                    │
│     │   可能返回:                                                  │
│     │   ├─ PromptSkillAdapter (从 SKILL.md 创建)                  │
│     │   └─ NestJS Provider (code-based .skill.ts)                 │
│     │                                                             │
│     ├─ buildSkillInput():                                         │
│     │   ├─ 有声明式 inputs 绑定 → 自动解析                        │
│     │   └─ 无绑定 → 回退到 default input                          │
│     │                                                             │
│     └─ skill.execute(input, context) → SkillResult                │
│                                                                   │
│  WriterAgent / SectionWriterService (不变)                         │
│     └─ AIEngineFacade.chatWithSkills() → prompt 注入              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 为什么只有 PromptSkillAdapter

| 方案                   | 评价                                       | 结论                                            |
| ---------------------- | ------------------------------------------ | ----------------------------------------------- |
| PromptSkillAdapter     | SKILL.md body → System Prompt → LLM → JSON | **采用** — Skill 的本质就是增强 LLM 行为        |
| ~~ScriptSkillAdapter~~ | require() 加载 scripts/execute.ts          | **弃用** — 绕过 NestJS DI，手动服务定位器反模式 |
| ~~HybridSkillAdapter~~ | pre-script → LLM → post-script             | **弃用** — Tool + Skill 混合是 category error   |

**ScriptSkillAdapter 被弃用的具体原因**：

1. **绕过 NestJS 依赖注入**：`require()` 动态加载的模块无法享受 NestJS 容器管理的服务注入。原方案用手动构建的 ScriptContext 替代，这是服务定位器反模式（Service Locator Anti-pattern），比 DI 更脆弱。

2. **安全风险**：后端服务执行 SkillsMP 安装的任意脚本是安全漏洞。Claude Code 可以这样做是因为用户运行自己的代码；我们是多租户后端。

3. **解决不存在的问题**：SkillsMP 安装的 SKILL.md 是 prompt 文件。不会有人从 SkillsMP 安装需要 templateRegistry 和 ChartRendererSkill 注入的确定性渲染脚本。

4. **Code Tools 本就应该是 NestJS Provider**：template-rendering 注入 ChartRendererSkill，chart-renderer 注入 ECharts SSR。这些是标准的 NestJS 服务间依赖，应该用标准的 DI 模式。

### 3.3 声明式输入绑定

在 SKILL.md frontmatter 中声明输入来源，替代 SlidesTeamMember 的 switch/case：

```yaml
# outline-planning/SKILL.md
inputs:
  taskDecomposition:
    from: "task-decomposition" # 从 SkillOutputManager 读取
    required: true
  sourceText:
    from: "context.sourceText" # 从全局上下文读取
  targetPages:
    from: "input.targetPages" # 从任务直接输入读取
    required: false
```

**SlidesTeamMember.buildSkillInput() 简化**：

```typescript
// 之前: 87 行 switch/case
// 之后: 声明式解析 (~20 行)
private buildSkillInput(task: SlidesTask, context: SkillExecutionContext): unknown {
  const inputBindings = this.getInputBindings(task.skillId);
  if (inputBindings) {
    return this.resolveBindings(inputBindings, {
      outputManager: context.outputManager,
      context: context.globalContext,
      input: task.input,
      previousOutputs: context.previousOutputs,
    });
  }
  // 回退: 没有声明式绑定的 skill 使用默认输入
  return this.buildDefaultInput(task, context);
}
```

**绑定解析规则**：

| `from` 前缀 | 解析方式                      | 示例                         |
| ----------- | ----------------------------- | ---------------------------- |
| 无前缀      | `SkillOutputManager.get(key)` | `from: "task-decomposition"` |
| `context.`  | `globalContext[path]`         | `from: "context.sourceText"` |
| `input.`    | `task.input[path]`            | `from: "input.targetPages"`  |

### 3.4 迁移后目录结构

```
backend/src/modules/ai-app/office/slides/skills/

  # ═══ Prompt Skills (SKILL.md only, 15 个) ═══
  # 由 PromptSkillAdapter 自动转为 ISkill
  task-decomposition/SKILL.md
  outline-planning/SKILL.md
  four-step-design/SKILL.md
  content-compression/SKILL.md
  data-supplement/SKILL.md
  content-analyzer/SKILL.md
  layout-optimizer/SKILL.md
  terminology-unifier/SKILL.md
  transition-checker/SKILL.md
  quality-audit/SKILL.md
  slide-thinking/SKILL.md
  voice-narration/SKILL.md
  content-polisher/SKILL.md
  fact-checker/SKILL.md
  layout-fixer/SKILL.md

  # ═══ Code Tools (NestJS Provider + companion SKILL.md, 6 个) ═══
  # 保留 .skill.ts，NestJS DI 注册到 SkillRegistry
  # companion SKILL.md 仅提供元数据（供 Admin/发现）
  template-rendering/
    SKILL.md                            ← 元数据 only
    template-rendering.skill.ts         ← 保留原样
  chart-renderer/
    SKILL.md
    chart-renderer.skill.ts
  image-fetcher/
    SKILL.md
    image-fetcher.skill.ts
  template-matcher/
    SKILL.md
    template-matcher.skill.ts
  page-pipeline/
    SKILL.md
    page-pipeline.skill.ts
  page-type-selection/
    SKILL.md
    page-type-selection.skill.ts
```

---

## 4. 用户旅程

> 以下旅程覆盖从终端用户 → AI App → AI Engine → Admin 管理的完整链路，展示统一 SKILL.md Runtime 在各场景下的行为。

### 4.1 旅程一：用户生成 PPT（Slides + PromptSkillAdapter）

**角色**：终端用户（前端页面操作）

**触发**：用户在 AI Office 页面上传素材，点击「生成演示文稿」

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Frontend │    │ Slides       │    │ SlidesTeam       │    │ SkillRegistry    │
│  UI       │    │ Controller   │    │ Orchestrator     │    │ + Adapter        │
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
     │                  │                     │                       │
     │ POST /slides/    │                     │                       │
     │ generate (SSE)   │                     │                       │
     │─────────────────>│                     │                       │
     │                  │ executeMission()    │                       │
     │                  │────────────────────>│                       │
     │                  │                     │                       │
     │                  │    ┌────────────────┤ Phase 1: Planning     │
     │                  │    │                │                       │
     │                  │    │  skillRegistry.tryGet("task-decomposition")
     │                  │    │                │──────────────────────>│
     │                  │    │                │   PromptSkillAdapter  │
     │                  │    │                │<──────────────────────│
     │                  │    │                │                       │
     │                  │    │  InputBindingResolver.resolve(inputs)  │
     │                  │    │  → { sourceText: context.sourceText }  │
     │                  │    │                │                       │
     │                  │    │  adapter.execute(resolvedInput)        │
     │                  │    │    → SKILL.md body → System Prompt     │
     │                  │    │    → LLM 调用 → JSON 解析              │
     │                  │    │                │                       │
     │  SSE: slide:     │    │                │                       │
     │  decomposed      │    │                │                       │
     │<─────────────────│    └────────────────┤                       │
     │                  │                     │                       │
     │                  │    ┌────────────────┤ Phase 2: Outline      │
     │                  │    │                │                       │
     │                  │    │  skillRegistry.tryGet("outline-planning")
     │                  │    │  InputBindingResolver.resolve(inputs)  │
     │                  │    │  → { taskDecomposition: from output,   │
     │                  │    │      sourceText: from context }        │
     │                  │    │  adapter.execute() → LLM → JSON       │
     │                  │    │                │                       │
     │  SSE: outline:   │    └────────────────┤                       │
     │  confirmed       │                     │                       │
     │<─────────────────│                     │                       │
     │                  │    ┌────────────────┤ Phase 3: Rendering    │
     │                  │    │                │                       │
     │                  │    │  skillRegistry.tryGet("page-pipeline") │
     │                  │    │  → NestJS Provider (code tool)         │
     │                  │    │  → 内部调用 template-rendering,        │
     │                  │    │    chart-renderer 等 code tools        │
     │                  │    │                │                       │
     │  SSE: slide:     │    └────────────────┤                       │
     │  generated ×N    │                     │                       │
     │<─────────────────│                     │                       │
     │                  │    ┌────────────────┤ Phase 4: Quality      │
     │                  │    │                │                       │
     │                  │    │  skillRegistry.tryGet("quality-audit") │
     │                  │    │  → PromptSkillAdapter → LLM           │
     │                  │    │                │                       │
     │  SSE: slides:    │    └────────────────┤                       │
     │  complete        │                     │                       │
     │<─────────────────│                     │                       │
```

**关键行为**：

| 阶段     | Skill               | 执行方式                      | 输入来源              |
| -------- | ------------------- | ----------------------------- | --------------------- |
| 任务分解 | task-decomposition  | PromptSkillAdapter (SKILL.md) | `context.sourceText`  |
| 大纲规划 | outline-planning    | PromptSkillAdapter (SKILL.md) | 前一步输出 + context  |
| 四步设计 | four-step-design    | PromptSkillAdapter (SKILL.md) | outline-planning 输出 |
| 内容压缩 | content-compression | PromptSkillAdapter (SKILL.md) | outline-planning 输出 |
| 页面渲染 | page-pipeline       | NestJS Provider (code tool)   | 压缩内容 + 模板       |
| 模板渲染 | template-rendering  | NestJS Provider (code tool)   | 页面数据 + 主题       |
| 质量审核 | quality-audit       | PromptSkillAdapter (SKILL.md) | 渲染结果              |

**迁移前后对比**：

| 对比项     | 迁移前                       | 迁移后                        |
| ---------- | ---------------------------- | ----------------------------- |
| Skill 加载 | 21 个 .skill.ts 硬编码注册   | 6 code + 15 SKILL.md 自动桥接 |
| 输入解析   | 87 行 switch/case            | InputBindingResolver 声明式   |
| 新增 skill | 改 .ts 代码 + 改 switch/case | 新增 SKILL.md 文件即可        |

---

### 4.2 旅程二：用户进行长文写作（Writing + chatWithSkills）

**角色**：终端用户（AI Writing 页面）

**触发**：用户创建写作项目，启动「生成章节」任务

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Frontend │    │ Writing      │    │ WriterAgent      │    │ AI Engine        │
│  UI       │    │ Controller   │    │ (chatWithSkills) │    │ Facade + Loader  │
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
     │                  │                     │                       │
     │ POST /writing/   │                     │                       │
     │ missions         │                     │                       │
     │─────────────────>│                     │                       │
     │                  │ coordinator.        │                       │
     │                  │ startMission()      │                       │
     │                  │────────────────────>│                       │
     │                  │                     │                       │
     │                  │                     │ facade.chatWithSkills({
     │                  │                     │   domain: "writing",
     │                  │                     │   taskType: "chapter-writing"
     │                  │                     │ })
     │                  │                     │──────────────────────>│
     │                  │                     │                       │
     │                  │                     │  SkillLoaderService   │
     │                  │                     │  .getSkillsForTask()  │
     │                  │                     │  → 匹配 domain +     │
     │                  │                     │    taskType 的 skills │
     │                  │                     │                       │
     │                  │                     │  PromptBuilder        │
     │                  │                     │  .buildPromptWith     │
     │                  │                     │   Skills()            │
     │                  │                     │  → 注入 SKILL.md body │
     │                  │                     │    到 System Prompt   │
     │                  │                     │                       │
     │                  │                     │  AiChatService.chat() │
     │                  │                     │  → 增强后的 LLM 调用   │
     │                  │                     │                       │
     │                  │                     │  返回 + 使用的 skills │
     │                  │                     │<──────────────────────│
     │                  │                     │                       │
     │  SSE: chapter    │                     │                       │
     │  content         │                     │                       │
     │<─────────────────│                     │                       │
```

**Writing 使用 Skills 的 6 个场景**：

| 消费者                   | 调用方式       | domain   | taskType         | 作用                                |
| ------------------------ | -------------- | -------- | ---------------- | ----------------------------------- |
| WriterAgent              | chatWithSkills | writing  | chapter-writing  | 章节内容生成，注入写作风格/结构技巧 |
| OutlineService           | chatWithSkills | writing  | outline-planning | 大纲规划，注入叙事结构指导          |
| QualityChecker           | chatWithSkills | writing  | quality-check    | 质量评估，注入评判标准              |
| FactExtractor            | chatWithSkills | writing  | fact-extraction  | 事实提取，注入一致性检查规则        |
| ChapterRevision          | chatWithSkills | writing  | chapter-revision | 章节修订，注入修改策略              |
| SectionWriter (Insights) | chatWithSkills | research | section-writing  | 洞察报告章节，注入研究写作规范      |

**统一 Runtime 后的变化**：

```
迁移前:
  chatWithSkills() → SkillLoaderService → 仅 prompt 注入
  SkillRegistry    → 仅 code-based .skill.ts

迁移后 (Phase 5):
  chatWithSkills() → SkillLoaderService → prompt 注入 (不变)
  SkillRegistry    → PromptSkillBridge 注册 → Writing 9 个 skills 也可被
                     BaseAgent / Executor / MissionOrchestrator 消费
```

**关键收益**：Writing 的 9 个 SKILL.md 进入 SkillRegistry 后，其他 AI App（如 Teams 辩论、Research Agent）可通过 `skillRegistry.tryGet()` 复用这些写作技能。

---

### 4.3 旅程三：Topic Insights 深度研究（Leader 规划 + 技能驱动写作）

**角色**：终端用户（AI Insights 研究页面）

**触发**：用户选择一个话题，发起深度研究任务

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Frontend │    │ Mission      │    │ ResearchLeader   │    │ SectionWriter    │
│  UI       │    │ Controller   │    │ Service          │    │ + SkillLoader    │
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
     │                  │                     │                       │
     │ POST /topic-     │                     │                       │
     │ insights/topics/ │                     │                       │
     │ :id/leader/plan  │                     │                       │
     │─────────────────>│                     │                       │
     │                  │ planResearch()      │                       │
     │                  │────────────────────>│                       │
     │                  │                     │                       │
     │                  │   ┌─────────────────┤ Phase 1: Leader 规划   │
     │                  │   │                 │                       │
     │                  │   │ Reasoning LLM:  │                       │
     │                  │   │ 分析话题 →      │                       │
     │                  │   │ 确定维度 →      │                       │
     │                  │   │ 分配 Agent →    │                       │
     │                  │   │ 为每个 Section  │                       │
     │                  │   │ 指定 Skills:    │                       │
     │                  │   │                 │                       │
     │                  │   │ SectionPlan {   │                       │
     │                  │   │   title: "竞争格局"                     │
     │                  │   │   agentConfig: {│                       │
     │                  │   │     skills: [   │                       │
     │                  │   │       "competitive_analysis",           │
     │                  │   │       "data_interpretation"             │
     │                  │   │     ],          │                       │
     │                  │   │     outputStyle:│                       │
     │                  │   │       "analytical"                      │
     │                  │   │   }             │                       │
     │                  │   │ }              │                       │
     │                  │   └─────────────────┤                       │
     │                  │                     │                       │
     │ 返回研究计划      │                     │                       │
     │ (含维度+技能分配) │                     │                       │
     │<─────────────────│                     │                       │
     │                  │                     │                       │
     │ POST /approve-   │                     │                       │
     │ plan (用户确认)   │                     │                       │
     │─────────────────>│                     │                       │
     │                  │                     │                       │
     │                  │   ┌─────────────────┤ Phase 2: 执行写作      │
     │                  │   │                 │                       │
     │                  │   │ For each section:                       │
     │                  │   │                 │ writeSection()        │
     │                  │   │                 │──────────────────────>│
     │                  │   │                 │                       │
     │                  │   │                 │ ① SkillLoaderService  │
     │                  │   │                 │   .getAllLoadedSkills()│
     │                  │   │                 │   → 查找 competitive- │
     │                  │   │                 │     analysis.skill.md │
     │                  │   │                 │                       │
     │                  │   │                 │ ② formatAgentGuidance:│
     │                  │   │                 │   → 将 SKILL.md 完整  │
     │                  │   │                 │     内容注入 prompt    │
     │                  │   │                 │   → 加入 Leader 指导  │
     │                  │   │                 │   → 加入输出风格偏好  │
     │                  │   │                 │                       │
     │                  │   │                 │ ③ aiFacade.chat()     │
     │                  │   │                 │   → LLM 按技能框架    │
     │                  │   │                 │     生成分析内容       │
     │                  │   │                 │                       │
     │  SSE: section    │   │                 │<──────────────────────│
     │  written         │   │                 │                       │
     │<─────────────────│   └─────────────────┤                       │
     │                  │                     │                       │
     │ 完整研究报告      │                     │                       │
     │<─────────────────│                     │                       │
```

**Insights 12 个分析技能与场景映射**：

| 技能 ID              | 名称       | 典型分配场景           | 分析框架                         |
| -------------------- | ---------- | ---------------------- | -------------------------------- |
| trend_analysis       | 趋势分析   | 市场趋势、技术演进维度 | 趋势识别 → 模式提取 → 方向预测   |
| swot_analysis        | SWOT 分析  | 战略评估、企业分析维度 | S/W/O/T 四象限 + 交叉策略        |
| competitive_analysis | 竞争分析   | 行业竞争、市场格局维度 | 竞争者识别 → 策略对比 → 定位分析 |
| deep_dive            | 深度调研   | 核心维度、技术原理维度 | 问题界定 → 根因挖掘 → 深入展开   |
| data_interpretation  | 数据解读   | 包含数据图表的维度     | 数据提取 → 统计分析 → 洞察推导   |
| synthesis            | 综合归纳   | 报告总结、跨维度整合   | 信息聚合 → 模式识别 → 结论提炼   |
| critical_thinking    | 批判思维   | 质量审核、论证验证维度 | 多角度质疑 → 证据检验 → 平衡判断 |
| future_projection    | 未来预测   | 技术预测、市场前瞻维度 | 现状分析 → 趋势推演 → 场景预测   |
| cause_effect         | 因果分析   | 问题诊断、影响评估维度 | 因素识别 → 因果链构建 → 影响量化 |
| comparison           | 对比分析   | 方案比较、技术选型维度 | 维度选取 → 逐项对比 → 优劣评判   |
| consistency-check    | 一致性检查 | 报告整合阶段           | 交叉验证 → 矛盾检测 → 统一修正   |

**Insights 技能使用方式与 Slides/Writing 的差异**：

| 对比项       | Slides                             | Writing                        | Topic Insights                   |
| ------------ | ---------------------------------- | ------------------------------ | -------------------------------- |
| 技能消费方式 | SkillRegistry.tryGet() → execute() | chatWithSkills() → prompt 注入 | 手动加载 → 直接拼入 user prompt  |
| 技能分配     | 固定 pipeline 顺序                 | domain + taskType 自动匹配     | **Leader 动态分配**，按维度/章节 |
| 一次使用几个 | 按 pipeline 步骤逐个               | 按匹配自动注入多个             | 每个 Section 2-3 个组合          |
| 技能来源     | office domain                      | writing domain                 | research domain                  |

**统一 Runtime 后的变化 (Phase 5)**：

```
迁移前:
  SectionWriterService 手动调用 SkillLoaderService.getAllLoadedSkills()
  → 手动查找 skill → 手动注入到 prompt
  → 技能只活在 SkillLoaderService 中，SkillRegistry 无法访问

迁移后:
  PromptSkillBridge.registerDomain("research")
  → 11 个 Insights skills 注册到 SkillRegistry
  → SectionWriterService 的消费路径不变 (向后兼容)
  → 但其他模块的 BaseAgent / MissionOrchestrator 也可消费
     (例: Teams 辩论中引用 competitive_analysis 分析框架)
```

---

### 4.4 旅程四：Admin 管理技能（启用/禁用/监控）

**角色**：系统管理员（Admin 后台）

**触发**：Admin 进入「AI 技能管理」页面

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Admin    │    │ AI Admin     │    │ AIAdminService   │    │ SkillRegistry +  │
│  Frontend │    │ Controller   │    │                  │    │ SkillLoader +    │
│           │    │              │    │                  │    │ Database         │
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
     │                  │                     │                       │
     │ GET /admin/ai/   │                     │                       │
     │ skills           │                     │                       │
     │─────────────────>│                     │                       │
     │                  │ getSkillConfigs()   │                       │
     │                  │────────────────────>│                       │
     │                  │                     │                       │
     │                  │                     │ 1. SkillRegistry      │
     │                  │                     │    .getAll()          │
     │                  │                     │    → code + prompt    │
     │                  │                     │      adapters         │
     │                  │                     │──────────────────────>│
     │                  │                     │<──────────────────────│
     │                  │                     │                       │
     │                  │                     │ 2. SkillLoaderService │
     │                  │                     │    .getAllLoaded()     │
     │                  │                     │    → SKILL.md 元数据   │
     │                  │                     │──────────────────────>│
     │                  │                     │<──────────────────────│
     │                  │                     │                       │
     │                  │                     │ 3. DB SkillConfig     │
     │                  │                     │    → 启用/禁用状态    │
     │                  │                     │──────────────────────>│
     │                  │                     │<──────────────────────│
     │                  │                     │                       │
     │  技能列表 (合并)  │                     │                       │
     │  ┌────────────────────────────────┐   │                       │
     │  │ ID                │ 类型  │ 状态 │  │                       │
     │  │ task-decomposition│ prompt│ ✅   │  │                       │
     │  │ outline-planning  │ prompt│ ✅   │  │                       │
     │  │ template-rendering│ code  │ ✅   │  │                       │
     │  │ chart-renderer    │ code  │ ✅   │  │                       │
     │  │ smp:seo-optimizer │ prompt│ ⬚   │  │                       │
     │  └────────────────────────────────┘   │                       │
     │<─────────────────│                     │                       │
     │                  │                     │                       │
     │ PATCH /admin/ai/ │                     │                       │
     │ skills/:id       │                     │                       │
     │ { enabled: false}│                     │                       │
     │─────────────────>│                     │                       │
     │                  │ updateSkillConfig() │                       │
     │                  │────────────────────>│                       │
     │                  │                     │ DB: enabled = false   │
     │                  │                     │──────────────────────>│
     │                  │                     │                       │
     │  ✅ 已禁用        │                     │                       │
     │<─────────────────│                     │                       │
```

**Admin 可执行的操作**：

| 操作              | API                            | 影响范围                             |
| ----------------- | ------------------------------ | ------------------------------------ |
| 查看所有技能      | `GET /admin/ai/skills`         | 聚合展示 Registry + Loader + DB 数据 |
| 启用/禁用单个技能 | `PATCH /admin/ai/skills/:id`   | DB 状态变更，实时生效                |
| 批量更新          | `POST /admin/ai/skills/batch`  | 多个技能同时更新                     |
| 上传自定义技能    | `POST /admin/ai/skills/upload` | JSON/YAML 格式，存入本地             |
| 查看技能详情      | `GET /admin/ai/skills/:id`     | 元数据 + 执行统计 + 来源             |

**统一 Runtime 后 Admin 视图变化**：

```
迁移前:
  Admin 看到两个割裂的技能列表:
  ├─ SkillRegistry 中的 code skills (21 个 .skill.ts)
  └─ SkillLoader 中的 SKILL.md (20 个，不在 Registry 中)

迁移后:
  Admin 看到统一列表:
  └─ SkillRegistry 中包含所有技能:
     ├─ 15 个 PromptSkillAdapter (从 SKILL.md 桥接)
     ├─ 6 个 NestJS Provider (code tools)
     ├─ 9 个 Writing PromptSkillAdapter
     ├─ 11 个 Insights PromptSkillAdapter
     └─ N 个 SkillsMP 安装的 PromptSkillAdapter
```

---

### 4.5 旅程五：从 SkillsMP 安装社区技能

**角色**：Admin（技能市场操作）

**触发**：Admin 在技能管理页面点击「浏览市场」，搜索并安装一个社区提供的 PPT 优化技能

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Admin    │    │ AI Admin     │    │ SkillsMP Client  │    │ PromptSkillBridge│
│  Frontend │    │ Controller   │    │ + Cache          │    │ + Registry       │
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
     │                  │                     │                       │
     │ 搜索 "presentation│                    │                       │
     │ optimization"    │                     │                       │
     │─────────────────>│                     │                       │
     │                  │ searchSkills()      │                       │
     │                  │────────────────────>│                       │
     │                  │                     │ SkillsMP API 调用     │
     │                  │                     │──────> (外部)          │
     │                  │                     │<────── 搜索结果        │
     │                  │                     │                       │
     │ 搜索结果列表:     │                     │                       │
     │ ┌─────────────────────────────────┐    │                       │
     │ │ ★ ppt-visual-enhancer v2.1     │    │                       │
     │ │   by: community-author         │    │                       │
     │ │   下载量: 12,400               │    │                       │
     │ │   [安装]                        │    │                       │
     │ └─────────────────────────────────┘    │                       │
     │<─────────────────│                     │                       │
     │                  │                     │                       │
     │ 点击 [安装]      │                     │                       │
     │─────────────────>│                     │                       │
     │                  │ installSkill()      │                       │
     │                  │────────────────────>│                       │
     │                  │                     │                       │
     │                  │                     │ ① 下载 SKILL.md       │
     │                  │                     │ ② 安全扫描:           │
     │                  │                     │   - 大小 < 100KB      │
     │                  │                     │   - 无 XSS 注入       │
     │                  │                     │   - 无可执行代码       │
     │                  │                     │ ③ 解析 frontmatter    │
     │                  │                     │ ④ 存入 SkillCache     │
     │                  │                     │                       │
     │                  │                     │ registerNewSkill()    │
     │                  │                     │──────────────────────>│
     │                  │                     │                       │
     │                  │                     │ PromptSkillBridge:    │
     │                  │                     │ ① 检查 Registry       │
     │                  │                     │   → 无同 ID code skill│
     │                  │                     │ ② 创建 PromptSkill-   │
     │                  │                     │   Adapter             │
     │                  │                     │ ③ SkillRegistry       │
     │                  │                     │   .register()         │
     │                  │                     │                       │
     │  ✅ 安装成功       │                     │                       │
     │  技能已就绪        │                     │                       │
     │<─────────────────│                     │                       │
```

**安装后的消费路径**：

```
安装的 "ppt-visual-enhancer" SKILL.md
    │
    ├─→ PromptSkillBridge → SkillRegistry → PromptSkillAdapter
    │     │
    │     ├─→ SlidesTeamMember 可通过 skillRegistry.tryGet() 消费  ✅ (本次打通)
    │     ├─→ BaseAgent 可消费                                      ✅ (本次打通)
    │     └─→ MissionOrchestrator 可消费                            ✅ (本次打通)
    │
    └─→ SkillLoaderService → chatWithSkills() prompt 注入
          │
          └─→ Writing/Insights 可消费                              ✅ (已有)
```

**自动更新机制**：

```
每 6 小时:
  SkillsMPClientService.checkUpdates()
    → 对比已安装版本 vs SkillsMP 最新版本
    → 自动下载更新 → 安全扫描 → 替换缓存
    → PromptSkillBridge 热更新 Adapter
```

---

### 4.6 旅程六：开发者创建新 Prompt Skill

**角色**：平台开发者（本地开发环境）

**触发**：需要为 Slides 新增一个「数据可视化建议」prompt skill

**操作步骤**：

```
步骤 1: 创建目录和 SKILL.md 文件
─────────────────────────────────

slides/skills/data-viz-suggestion/SKILL.md

---
name: data-viz-suggestion
description: Suggest optimal chart types and data visualization strategies for slide content
version: 1.0.0
domain: office
layer: design
tags: [slides, data-visualization, charts, design]
taskTypes: [slides-generation]
priority: 90
author: genesis-ai
source: local
tokenBudget: 1500

outputKey: data-viz-suggestion

taskProfile:
  creativity: medium
  outputLength: medium

inputs:
  pageContent:
    from: "content-compression"
    required: true
  outline:
    from: "outline-planning"
    required: false

requiredSkills:
  - content-compression

outputSchema:
  type: object
  properties:
    suggestions:
      type: array
      items:
        type: object
        properties:
          pageIndex: { type: integer }
          chartType: { type: string }
          dataMapping: { type: object }
          rationale: { type: string }
---

# Data Visualization Suggestion

## Role
You are a data visualization expert...

## Output Requirements
Return JSON with chart type suggestions per page...


步骤 2: 无需修改任何 TypeScript 代码！
──────────────────────────────────────

  系统启动时自动完成:
  ① SkillLoaderService 扫描到新 SKILL.md
  ② PromptSkillBridge 检查 → 无同 ID code skill
  ③ 创建 PromptSkillAdapter → 注册到 SkillRegistry
  ④ SlidesTeamMember 可通过 skillRegistry.tryGet("data-viz-suggestion") 使用
  ⑤ InputBindingResolver 根据 inputs 声明自动解析输入
  ⑥ Admin 页面自动显示新技能


步骤 3: 验证
────────────

  $ npm run dev:backend
  # 日志: [PromptSkillBridge] registered=16, skipped=6, errors=0
  #        新增 data-viz-suggestion

  # Admin 页面确认技能出现
  # 生成 PPT 验证技能被调用
```

**与迁移前的对比**：

| 操作       | 迁移前 (需改 5 处)                | 迁移后 (改 0 处)                     |
| ---------- | --------------------------------- | ------------------------------------ |
| 创建 Skill | 写 .skill.ts (~200 行 TypeScript) | 写 SKILL.md (~50 行 YAML + Markdown) |
| 注册 Skill | 修改 SlidesSkillsModule providers | 自动扫描注册                         |
| 输入绑定   | 修改 buildSkillInput switch/case  | SKILL.md frontmatter 声明            |
| Admin 展示 | 可能需要修改 sync 逻辑            | 自动出现                             |
| 生态共享   | 不可能（TypeScript 硬编码）       | 可发布到 SkillsMP                    |

---

### 4.7 旅程七：系统启动初始化流程

**角色**：系统（NestJS Application Bootstrap）

**触发**：`npm run dev:backend` 或生产部署启动

```
┌───────────────────────────────────────────────────────────────────────┐
│  NestJS Bootstrap → onModuleInit() 执行顺序                            │
│                                                                       │
│  ① AiEngineSkillsModule.onModuleInit()                               │
│     │                                                                 │
│     ├─ SkillLoaderService.loadAllLocalSkills()                       │
│     │  → 扫描所有 */SKILL.md + *.skill.md 文件                       │
│     │  → 解析 frontmatter + body → SkillMdDefinition[]              │
│     │                                                                 │
│     └─ PromptSkillBridge 初始化 (等待 domain 注册)                    │
│                                                                       │
│  ② SlidesSkillsModule.onModuleInit()                                 │
│     │                                                                 │
│     ├─ 注册 6 个 code-based skills (NestJS Provider)                 │
│     │  → skillRegistry.register(templateRendering)                   │
│     │  → skillRegistry.register(chartRenderer)                       │
│     │  → skillRegistry.register(imageFetcher)                        │
│     │  → skillRegistry.register(templateMatcher)                     │
│     │  → skillRegistry.register(pagePipeline)                        │
│     │  → skillRegistry.register(pageTypeSelection)                   │
│     │                                                                 │
│     └─ promptSkillBridge.registerDomain("office")                    │
│        → 遍历 office 域所有 SKILL.md                                  │
│        → 对每个 SKILL.md:                                             │
│           ├─ executionMode: provider? → 跳过 (已有 code skill)       │
│           ├─ SkillRegistry 已有同 ID? → 跳过 (code 优先)             │
│           └─ 创建 PromptSkillAdapter → skillRegistry.register()      │
│        → 结果: registered=15, skipped=6                              │
│                                                                       │
│  ③ WritingModule.onModuleInit()                                      │
│     │                                                                 │
│     ├─ agentRegistry.register(writerAgent) (现有)                    │
│     └─ promptSkillBridge.registerDomain("writing")  (新增)           │
│        → 结果: registered=9                                          │
│                                                                       │
│  ④ TopicInsightsModule.onModuleInit()                                │
│     │                                                                 │
│     └─ promptSkillBridge.registerDomain("research")  (新增)          │
│        → 结果: registered=11                                         │
│                                                                       │
│  ⑤ AIAdminService.syncSkillConfigs()                                 │
│     │                                                                 │
│     └─ 同步 SkillRegistry → DB SkillConfig 表                        │
│        → 为新增的 PromptSkillAdapter 创建默认 config (enabled=true)   │
│        → 为已删除的 skills 标记 inactive                              │
│                                                                       │
│  启动完成: SkillRegistry 包含:                                         │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │ 6  个 NestJS Provider (Slides code tools)                   │     │
│  │ 15 个 PromptSkillAdapter (Slides prompt skills)             │     │
│  │ 9  个 PromptSkillAdapter (Writing skills)                   │     │
│  │ 11 个 PromptSkillAdapter (Insights skills)                  │     │
│  │ N  个 PromptSkillAdapter (SkillsMP 安装的)                  │     │
│  │ ─────────────────────────────────────────                   │     │
│  │ 合计: 41+ 个统一注册的 ISkill 实例                           │     │
│  └──────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

---

### 4.8 旅程八：跨模块技能复用（Teams 辩论引用 Writing 技能）

**角色**：终端用户（AI Teams 辩论场景）

**触发**：用户在 AI Teams 中发起关于某话题的多 Agent 辩论，Agent 需要高质量写作能力

```
迁移前 (不可能):
  TeamsModule 的 BaseAgent → SkillRegistry → 找不到 writing skills
  Writing skills 只存在于 SkillLoaderService，只能通过 chatWithSkills() 消费

迁移后 (Phase 5):
  TeamsModule 的 BaseAgent
    → skillRegistry.tryGet("writing-style-guide")
    → PromptSkillAdapter (从 Writing 的 SKILL.md 创建)
    → adapter.execute({ topic, stance, audience })
    → LLM 按照写作风格指导生成辩论稿

  TeamsModule 的 MissionOrchestrator
    → skillRegistry.tryGet("fact-extraction")
    → PromptSkillAdapter (从 Writing 的 SKILL.md 创建)
    → 对辩论内容进行事实核查
```

**跨模块复用矩阵**：

| 消费者 ↓ \ 技能来源 →     | Slides Skills | Writing Skills | Insights Skills | SkillsMP Skills |
| ------------------------- | :-----------: | :------------: | :-------------: | :-------------: |
| SlidesTeamMember          |      ✅       |       ○        |        ○        |       ✅        |
| BaseAgent (任意 App)      |      ✅       |       ✅       |       ✅        |       ✅        |
| BaseExecutor              |      ✅       |       ✅       |       ✅        |       ✅        |
| MissionOrchestrator       |      ✅       |       ✅       |       ✅        |       ✅        |
| chatWithSkills (Writing)  |       ○       |       ✅       |        ○        |       ✅        |
| chatWithSkills (Insights) |       ○       |       ○        |       ✅        |       ✅        |

> ✅ = 可消费 &nbsp;&nbsp; ○ = 技术上可行但需按 domain 配置

---

### 4.9 旅程九：Feature Flag 灰度切换

**角色**：运维/技术负责人

**触发**：从旧管线渐进切换到统一 Runtime

```
阶段 1: SKILL_MD_RUNTIME_ENABLED=false (默认)
──────────────────────────────────────────────
  SkillRegistry: 仅 21 个 code-based .skill.ts (旧路径)
  chatWithSkills: 仅 SkillLoaderService prompt 注入 (旧路径)
  风险: 零 (完全不影响生产)

阶段 2: SKILL_MD_RUNTIME_ENABLED=true (开发/测试环境)
──────────────────────────────────────────────────────
  SkillRegistry:
    6 个 NestJS Provider (code tools，始终注册)
    + 15 个 PromptSkillAdapter (SKILL.md prompt skills)
  验证方式:
    ① 生成 PPT → 对比新旧输出质量 (A/B 对比)
    ② Admin 页面确认所有 skills 正确显示
    ③ 运行 npm run verify:full 确认无回归

阶段 3: SKILL_MD_RUNTIME_ENABLED=true (生产环境)
─────────────────────────────────────────────────
  切换后观察:
    ① 监控 Slides 生成成功率 (Prometheus/Grafana)
    ② 监控 LLM 调用延迟 (PromptSkillAdapter vs 旧 .skill.ts)
    ③ 监控 JSON 解析成功率 (extractJson 命中率)
  回滚方案:
    → 设置 SKILL_MD_RUNTIME_ENABLED=false
    → 15 个旧 .skill.ts 仍存在，立即回退
    → 不需要代码部署，环境变量即时生效

阶段 4: 删除旧 .skill.ts (确认稳定一周后)
──────────────────────────────────────────
  删除 15 个旧文件，Feature Flag 移除
  SkillRegistry 只有统一 Runtime 管线
```

---

### 4.10 用户旅程总览

```
                                ┌─────────────────┐
                                │   终端用户       │
                                └────────┬────────┘
                                         │
              ┌──────────────┬───────────┼───────────┬──────────────┐
              │              │           │           │              │
              ▼              ▼           ▼           ▼              ▼
      ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐
      │ AI Slides  │ │ AI Writing │ │ AI Insights│ │ AI Teams   │ │ 其他 App │
      │ 旅程 4.1   │ │ 旅程 4.2   │ │ 旅程 4.3   │ │ 旅程 4.8   │ │ (未来)   │
      └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └────┬─────┘
            │              │              │              │              │
            │   ┌──────────┴──────┐   ┌──┴──────────────┤              │
            │   │                 │   │                 │              │
            ▼   ▼                 ▼   ▼                 ▼              ▼
      ┌────────────────┐   ┌────────────────┐   ┌────────────────────────┐
      │ SkillRegistry  │   │ chatWithSkills  │   │ 手动 SkillLoader +    │
      │ .tryGet()      │   │ (prompt 注入)   │   │ prompt 拼接            │
      │ 旅程 4.1/4.8   │   │ 旅程 4.2        │   │ 旅程 4.3 (Insights)    │
      └───────┬────────┘   └───────┬────────┘   └───────────┬────────────┘
              │                    │                         │
              ├── PromptSkillAdapter ───────────────────────┤
              │   (SKILL.md → LLM)                         │
              │                                             │
              └── NestJS Provider ────────────×─────────────┘ (仅 Registry)
                  (code tool)
                     │
       ┌─────────────┼─────────────┐
       │             │             │
       ▼             ▼             ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  Admin     │ │  SkillsMP  │ │  Developer │
│  管理/监控  │ │  安装/更新  │ │  新增 Skill │
│  旅程 4.4  │ │  旅程 4.5  │ │  旅程 4.6  │
└────────────┘ └────────────┘ └────────────┘
```

---

## 5. 详细类型设计

### 5.1 扩展 SkillMdFrontmatter

```typescript
// ai-engine/skills/types/skill-md.types.ts — 新增字段

import type { SkillLayer } from "../abstractions/skill.interface";
import type { TaskProfile } from "../../llm/types";

/**
 * 输入绑定声明
 */
export interface SkillInputBinding {
  /** 数据来源 (SkillOutputManager key / context.path / input.path) */
  from: string;
  /** 是否必需 */
  required: boolean;
}

/**
 * 扩展 frontmatter — 新增 Runtime 字段
 * 追加到现有 SkillMdFrontmatter 接口
 */
export interface SkillMdRuntimeFields {
  /** ISkill.layer 映射 */
  layer?: SkillLayer;

  /** SkillOutputManager 存储键 (默认 = skill id) */
  outputKey?: string;

  /** LLM 调用参数 (prompt 模式使用) */
  taskProfile?: TaskProfile;

  /** 输出 JSON Schema (LLM 输出解析/验证) */
  outputSchema?: Record<string, unknown>;

  /** 输入 JSON Schema (可选验证) */
  inputSchema?: Record<string, unknown>;

  /** 声明式输入绑定 */
  inputs?: Record<string, SkillInputBinding>;

  /** 依赖的其他 Skills (执行前检查) */
  requiredSkills?: string[];

  /** 声明需要的 Tools */
  requiredTools?: string[];

  /**
   * 执行模式标记
   * 'provider' = 此 SKILL.md 有对应的 NestJS Provider 实现
   * 省略 = 使用 PromptSkillAdapter
   */
  executionMode?: "provider";
}

// 合并到 SkillMdFrontmatter (通过 intersection type)
```

### 5.2 PromptSkillAdapter

````typescript
// ai-engine/skills/runtime/prompt-skill-adapter.ts

import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
} from "../abstractions/skill.interface";
import { SkillMdDefinition, SkillInputBinding } from "../types/skill-md.types";
import { AIEngineFacade } from "../../facade/ai-engine.facade";
import { SkillPromptBuilder } from "../builder/skill-prompt-builder.service";
import { Logger } from "@nestjs/common";

/**
 * Prompt Skill Adapter
 *
 * 将 SKILL.md 定义转为 ISkill 实例。
 * 执行逻辑: SKILL.md body → System Prompt → LLM → 解析 JSON → SkillResult
 *
 * 适用于所有 prompt 型 skills (Slides 15 个, SkillsMP 安装的, 社区贡献的)
 */
export class PromptSkillAdapter implements ISkill<unknown, unknown> {
  private readonly logger = new Logger(
    `PromptSkill:${this.definition.metadata.id}`,
  );

  // ========== ISkill 元数据 ==========
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly layer: SkillLayer;
  readonly domain: string;
  readonly tags?: string[];
  readonly version?: string;
  readonly outputKey?: string;
  readonly requiredSkills?: string[];
  readonly requiredTools?: string[];
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;

  /** 标记: 这是一个 SKILL.md adapter, 不是 code-based skill */
  readonly isPromptSkillAdapter = true;

  constructor(
    private readonly definition: SkillMdDefinition,
    private readonly facade: AIEngineFacade,
    private readonly promptBuilder: SkillPromptBuilder,
  ) {
    const fm = definition.metadata;
    this.id = fm.id;
    this.name = fm.name;
    this.description = fm.description;
    this.layer = (fm as any).layer || "content";
    this.domain = fm.domain;
    this.tags = fm.tags;
    this.version = fm.version;
    this.outputKey = (fm as any).outputKey || fm.id;
    this.requiredSkills = (fm as any).requiredSkills;
    this.requiredTools = (fm as any).requiredTools;
    this.inputSchema = (fm as any).inputSchema;
    this.outputSchema = (fm as any).outputSchema;
  }

  async execute(
    input: unknown,
    context: SkillContext,
  ): Promise<SkillResult<unknown>> {
    const startTime = Date.now();
    const fm = this.definition.metadata;

    try {
      // 1. 组装系统提示词 (SKILL.md body + 变量替换)
      const buildResult = this.promptBuilder.buildSystemPrompt(
        [this.definition],
        {
          context: input as Record<string, unknown>,
          maxTokens: fm.tokenBudget || 4000,
        },
      );

      // 2. 序列化 input 为 user message
      const userMessage =
        typeof input === "string" ? input : JSON.stringify(input, null, 2);

      // 3. 调用 LLM
      const taskProfile = (fm as any).taskProfile || {
        creativity: "medium",
        outputLength: "medium",
      };
      const response = await this.facade.chat({
        messages: [
          { role: "system", content: buildResult.prompt },
          { role: "user", content: userMessage },
        ],
        taskProfile,
        modelType: "CHAT" as any,
      });

      // 4. 解析输出
      const data = (fm as any).outputSchema
        ? this.extractJson(response.content)
        : response.content;

      return {
        success: true,
        data,
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
          tokensUsed: response.tokensUsed,
        },
      };
    } catch (error) {
      this.logger.error(`Execution failed: ${error.message}`);
      return {
        success: false,
        error: {
          code: "PROMPT_SKILL_FAILED",
          message: error.message,
          retryable: true,
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 从 LLM 响应中提取 JSON
   * 支持: 纯 JSON / markdown code block / 混合文本
   */
  private extractJson(content: string): unknown {
    // 尝试 1: markdown code block
    const codeBlockMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        /* continue */
      }
    }

    // 尝试 2: 直接解析
    try {
      return JSON.parse(content.trim());
    } catch {
      /* continue */
    }

    // 尝试 3: 查找最外层 { } 或 [ ]
    const braceMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[1]);
      } catch {
        /* continue */
      }
    }

    // 尝试 4: 截断修复 (LLM 输出被截断导致 JSON 不完整)
    const truncated = this.repairTruncatedJson(content);
    if (truncated) return truncated;

    // fallback: 返回原始文本
    this.logger.warn(`JSON extraction failed, returning raw content`);
    return content;
  }

  /**
   * 修复被截断的 JSON (补全缺失的括号)
   */
  private repairTruncatedJson(content: string): unknown | null {
    const jsonStart = content.indexOf("{");
    if (jsonStart === -1) return null;

    let jsonStr = content.slice(jsonStart);
    const openBraces = (jsonStr.match(/{/g) || []).length;
    const closeBraces = (jsonStr.match(/}/g) || []).length;
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/]/g) || []).length;

    // 补全缺失的括号
    jsonStr += "]".repeat(Math.max(0, openBrackets - closeBrackets));
    jsonStr += "}".repeat(Math.max(0, openBraces - closeBraces));

    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }
}
````

### 5.3 PromptSkillBridge

```typescript
// ai-engine/skills/runtime/prompt-skill-bridge.service.ts

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SkillRegistry } from "../registry/skill.registry";
import { SkillLoaderService } from "../loader/skill-loader.service";
import { SkillPromptBuilder } from "../builder/skill-prompt-builder.service";
import { AIEngineFacade } from "../../facade/ai-engine.facade";
import { SkillMdDefinition } from "../types/skill-md.types";
import { PromptSkillAdapter } from "./prompt-skill-adapter";
import { ISkill } from "../abstractions/skill.interface";

export interface BridgeRegistrationResult {
  registered: string[];
  skipped: string[];
  errors: Array<{ id: string; error: string }>;
}

/**
 * Prompt Skill Bridge
 *
 * 将 SkillLoaderService 加载的 SKILL.md 定义桥接到 SkillRegistry。
 * - 只创建 PromptSkillAdapter (prompt 模式)
 * - code-based skills (已在 SkillRegistry 中) 自动优先
 * - SkillsMP 安装的 skills 通过此桥接自动进入执行管线
 */
@Injectable()
export class PromptSkillBridge {
  private readonly logger = new Logger(PromptSkillBridge.name);

  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly skillLoader: SkillLoaderService,
    private readonly promptBuilder: SkillPromptBuilder,
    private readonly facade: AIEngineFacade,
  ) {}

  /**
   * 注册指定域的所有 SKILL.md 为 PromptSkillAdapter
   * 已有 code-based skill 的 ID 自动跳过
   */
  async registerDomain(domain: string): Promise<BridgeRegistrationResult> {
    const skills = await this.skillLoader.loadLocalSkills(domain);
    return this.registerDefinitions(skills);
  }

  /**
   * 注册指定目录下的所有 SKILL.md
   */
  async registerFromDirectory(
    dirPath: string,
    options: { domain: string },
  ): Promise<BridgeRegistrationResult> {
    const skills = await this.skillLoader.loadAllLocalSkills();
    const domainSkills = skills.filter(
      (s) => s.metadata.domain === options.domain,
    );
    return this.registerDefinitions(domainSkills);
  }

  /**
   * 注册一批 SkillMdDefinition
   */
  registerDefinitions(
    definitions: SkillMdDefinition[],
  ): BridgeRegistrationResult {
    const result: BridgeRegistrationResult = {
      registered: [],
      skipped: [],
      errors: [],
    };

    for (const def of definitions) {
      const skillId = def.metadata.id;

      try {
        // 跳过标记为 provider 的 (有 NestJS 实现)
        if ((def.metadata as any).executionMode === "provider") {
          result.skipped.push(skillId);
          continue;
        }

        // 跳过已有 code-based skill (code-based 优先)
        const existing = this.skillRegistry.tryGet(skillId);
        if (existing && !this.isPromptAdapter(existing)) {
          this.logger.debug(`Skip "${skillId}": code-based skill exists`);
          result.skipped.push(skillId);
          continue;
        }

        // 创建 PromptSkillAdapter 并注册
        const adapter = new PromptSkillAdapter(
          def,
          this.facade,
          this.promptBuilder,
        );
        this.skillRegistry.register(adapter);
        result.registered.push(skillId);
      } catch (error) {
        this.logger.error(`Failed to register "${skillId}": ${error.message}`);
        result.errors.push({ id: skillId, error: error.message });
      }
    }

    this.logger.log(
      `[Bridge] registered=${result.registered.length}, ` +
        `skipped=${result.skipped.length}, errors=${result.errors.length}`,
    );
    return result;
  }

  private isPromptAdapter(skill: ISkill): boolean {
    return (skill as any).isPromptSkillAdapter === true;
  }
}
```

### 5.4 InputBindingResolver

```typescript
// ai-engine/skills/runtime/input-binding-resolver.ts

import { Logger } from "@nestjs/common";
import { SkillInputBinding } from "../types/skill-md.types";

export interface BindingContext {
  /** SkillOutputManager or previousOutputs map */
  outputManager?: { get<T>(key: string): T | undefined };
  /** 全局上下文 (globalContext) */
  context?: Record<string, unknown>;
  /** 任务直接输入 (task.input) */
  input?: Record<string, unknown>;
  /** 兼容: previousOutputs */
  previousOutputs?: Record<string, unknown>;
}

/**
 * 声明式输入绑定解析器
 *
 * 根据 SKILL.md frontmatter 中的 inputs 声明，
 * 从 SkillOutputManager / globalContext / task.input 中自动提取数据。
 * 替代 SlidesTeamMember.buildSkillInput() 的 87 行 switch/case。
 */
export class InputBindingResolver {
  private readonly logger = new Logger(InputBindingResolver.name);

  /**
   * 解析所有绑定声明, 返回合并后的输入对象
   */
  resolve(
    bindings: Record<string, SkillInputBinding>,
    ctx: BindingContext,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [name, binding] of Object.entries(bindings)) {
      const value = this.resolveOne(binding.from, ctx);

      if (binding.required && value === undefined) {
        throw new Error(
          `Required input binding "${name}" (from: "${binding.from}") not found`,
        );
      }

      if (value !== undefined) {
        resolved[name] = value;
      }
    }

    return resolved;
  }

  private resolveOne(from: string, ctx: BindingContext): unknown {
    // context.xxx → 从全局上下文读取
    if (from.startsWith("context.")) {
      const path = from.slice("context.".length);
      return this.getByPath(ctx.context, path);
    }

    // input.xxx → 从任务直接输入读取
    if (from.startsWith("input.")) {
      const path = from.slice("input.".length);
      return this.getByPath(ctx.input, path);
    }

    // 无前缀 → 从 SkillOutputManager 读取 (回退到 previousOutputs)
    if (ctx.outputManager) {
      const value = ctx.outputManager.get(from);
      if (value !== undefined) return value;
    }

    // 兼容: 尝试从 previousOutputs 读取
    if (ctx.previousOutputs) {
      return ctx.previousOutputs[from] ?? ctx.previousOutputs[`slides-${from}`];
    }

    return undefined;
  }

  private getByPath(
    obj: Record<string, unknown> | undefined,
    path: string,
  ): unknown {
    if (!obj) return undefined;
    return path
      .split(".")
      .reduce<unknown>(
        (curr, key) =>
          curr && typeof curr === "object"
            ? (curr as Record<string, unknown>)[key]
            : undefined,
        obj,
      );
  }
}
```

---

## 6. SKILL.md 示例

### 6.1 Prompt Skill: outline-planning

```yaml
---
name: outline-planning
description: Generate structured PPT outline from task decomposition and source text
version: 4.0.0
domain: office
layer: planning
tags: [slides, outline, planning, structure]
taskTypes: [slides-generation, presentation-planning]
priority: 100
author: genesis-ai
source: local
tokenBudget: 2000

outputKey: outline-planning

taskProfile:
  creativity: medium
  outputLength: long

inputs:
  taskDecomposition:
    from: "task-decomposition"
    required: true
  sourceText:
    from: "context.sourceText"
    required: true
  targetPages:
    from: "input.targetPages"
    required: false

requiredSkills:
  - task-decomposition

outputSchema:
  type: object
  required: [pages]
  properties:
    title:
      type: string
    pages:
      type: array
      items:
        type: object
        properties:
          pageIndex: { type: integer }
          pageType: { type: string }
          title: { type: string }
          keyPoints: { type: array, items: { type: string } }
          visualSuggestion: { type: string }
          speakerNotes: { type: string }
---

# Presentation Outline Planning

## Role
You are a professional presentation structure designer who excels at transforming content into clear visual narratives.

## Three Core Elements Per Slide
Every slide MUST contain:
1. **Viewpoint**: The core message or conclusion for this slide
2. **Logic**: The reasoning structure supporting the viewpoint
3. **Data**: Supporting data, examples, or visual elements

## Planning Principles
1. Pyramid principle: conclusions before supporting evidence
2. Visual rhythm: alternate information-dense and breathing-space slides
3. Narrative arc: hook opening → progressive build → climactic close
4. Single focus: one core viewpoint per slide

## Input Context
You will receive:
- **Task Decomposition**: Overall presentation structure and themes
- **Source Text**: The raw content to be organized
- **Target Pages**: Desired number of slides (optional)

## Output Requirements
Generate a JSON outline structure containing title, page array with pageIndex, pageType, title, keyPoints, visualSuggestion, and speakerNotes for each page.
```

### 6.2 Companion SKILL.md for Code Tool: template-rendering

```yaml
---
name: template-rendering
description: Render slide HTML from page content using template variables and theme styles
version: 4.0.0
domain: office
layer: rendering
tags: [slides, template, rendering, html]
taskTypes: [slides-generation]
priority: 80
author: genesis-ai
source: local

executionMode: provider

outputKey: template-rendering

inputs:
  pageOutline:
    from: "outline-planning"
    required: true
  pageContent:
    from: "content-compression"
    required: false

requiredSkills:
  - outline-planning
---

# Template Rendering Engine

This skill is implemented by a NestJS provider (`template-rendering.skill.ts`).
The SKILL.md provides metadata for discovery and input binding declarations.

## Capabilities
- Map PageContent sections to HTML templates
- Substitute template variables with content data
- Apply theme styles and responsive layout
- Integrate chart rendering via ChartRendererSkill
```

---

## 7. 实施计划

### Phase 1: 构建 PromptSkillAdapter + Bridge + InputBindingResolver

**目标**：在 AI Engine 中新增核心组件

**新增文件**：

| 文件                                                      | 职责                             | 预估行数 |
| --------------------------------------------------------- | -------------------------------- | -------- |
| `ai-engine/skills/runtime/prompt-skill-adapter.ts`        | Prompt → ISkill 适配器           | ~200     |
| `ai-engine/skills/runtime/prompt-skill-bridge.service.ts` | SkillLoader → SkillRegistry 桥接 | ~120     |
| `ai-engine/skills/runtime/input-binding-resolver.ts`      | 声明式输入绑定解析               | ~80      |
| `ai-engine/skills/runtime/index.ts`                       | Barrel export                    | ~10      |

**修改文件**：

| 文件                                       | 改动                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| `ai-engine/skills/types/skill-md.types.ts` | 新增 SkillInputBinding, SkillMdRuntimeFields (~30 行)           |
| `ai-engine/skills/loader/skill-parser.ts`  | 解析 layer, outputKey, taskProfile, inputs, outputSchema 等字段 |
| `ai-engine/ai-engine-skills.module.ts`     | 注册 PromptSkillBridge, InputBindingResolver 为 providers       |
| `ai-engine/skills/index.ts`                | 导出 runtime 模块                                               |

**验收标准**：

- 能从 SKILL.md 创建 PromptSkillAdapter 实例，实现 ISkill 接口
- PromptSkillAdapter.execute() 能调 LLM 并解析 JSON
- PromptSkillBridge 能自动跳过已有 code-based skill 的 ID
- InputBindingResolver 能从 outputManager/context/input 解析绑定

**预估工期**：3 天

### Phase 2: 迁移 15 个 Prompt Skills 到 SKILL.md

**目标**：将 15 个 prompt 型 .skill.ts 迁移为 SKILL.md + PromptSkillAdapter

**方法**：

1. 从 `.skill.ts` 提取系统提示词常量 → SKILL.md body
2. 从 `.skill.ts` 提取 taskProfile、输入依赖 → SKILL.md frontmatter
3. 从 `.skill.ts` 的 execute() 分析输出格式 → outputSchema
4. 从 SlidesTeamMember.buildSkillInput() 的 switch/case 提取 → inputs 绑定
5. 双轨运行验证，Feature Flag 控制

**迁移清单**：

| #   | Skill ID            | Layer         | 主要输入依赖        | 提示词行数(估) |
| --- | ------------------- | ------------- | ------------------- | -------------- |
| 1   | task-decomposition  | understanding | 无                  | ~150           |
| 2   | outline-planning    | planning      | task-decomposition  | ~300           |
| 3   | four-step-design    | design        | outline-planning    | ~200           |
| 4   | content-compression | content       | outline-planning    | ~250           |
| 5   | data-supplement     | content       | content-compression | ~150           |
| 6   | content-analyzer    | understanding | 无                  | ~150           |
| 7   | layout-optimizer    | optimization  | template-rendering  | ~200           |
| 8   | terminology-unifier | optimization  | content-compression | ~150           |
| 9   | transition-checker  | quality       | outline-planning    | ~150           |
| 10  | quality-audit       | quality       | template-rendering  | ~200           |
| 11  | slide-thinking      | planning      | task-decomposition  | ~200           |
| 12  | voice-narration     | content       | outline-planning    | ~150           |
| 13  | content-polisher    | content       | content-compression | ~150           |
| 14  | fact-checker        | quality       | data-supplement     | ~150           |
| 15  | layout-fixer        | optimization  | layout-optimizer    | ~150           |

**验收标准**：

- 每个 SKILL.md 通过 PromptSkillAdapter 创建的 ISkill 注册成功
- execute() 输出结构与旧 .skill.ts 一致
- SkillOutputManager 存储的 key 不变
- SlidesTeamMember.buildSkillInput() 的对应 case 可以删除

**预估工期**：3 天

### Phase 3: Code Tools 添加 Companion SKILL.md + 简化模块

**目标**：6 个 code tools 添加 companion SKILL.md；简化 SlidesSkillsModule

**3a. 添加 companion SKILL.md (6 个)**

每个 code tool 创建 companion SKILL.md，仅包含元数据 + inputs 绑定：

- `executionMode: provider` 标记
- inputs 声明（从 buildSkillInput switch/case 提取）
- 无 prompt body（或仅有文档说明）

**3b. 简化 SlidesSkillsModule**

```typescript
// 简化后
@Module({
  imports: [forwardRef(() => AiEngineModule), HttpModule, PrismaModule],
  providers: [
    AIModelService,
    // 只保留 6 个 code-based skill providers
    TemplateRenderingSkill,
    ChartRendererSkill,
    ImageFetcherSkill,
    TemplateMatcherSkill,
    PagePipelineSkill,
    PageTypeSelectionSkill,
  ],
  exports: [AIModelService],
})
export class SlidesSkillsModule implements OnModuleInit {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly promptSkillBridge: PromptSkillBridge,
    // 注入 6 个 code skills
    private readonly templateRendering: TemplateRenderingSkill,
    private readonly chartRenderer: ChartRendererSkill,
    private readonly imageFetcher: ImageFetcherSkill,
    private readonly templateMatcher: TemplateMatcherSkill,
    private readonly pagePipeline: PagePipelineSkill,
    private readonly pageTypeSelection: PageTypeSelectionSkill,
  ) {}

  async onModuleInit() {
    // 1. 注册 code-based skills (优先)
    const codeSkills = [
      this.templateRendering,
      this.chartRenderer,
      this.imageFetcher,
      this.templateMatcher,
      this.pagePipeline,
      this.pageTypeSelection,
    ];
    for (const skill of codeSkills) {
      this.skillRegistry.register(skill);
    }

    // 2. 桥接 SKILL.md prompt skills (code-based 优先, 同 ID 自动跳过)
    await this.promptSkillBridge.registerDomain("office");
  }
}
```

**3c. 简化 SlidesTeamMember.buildSkillInput()**

用 InputBindingResolver 替代 switch/case：

```typescript
private buildSkillInput(task: SlidesTask, context: SkillExecutionContext): unknown {
  // 从 SKILL.md 或 companion SKILL.md 读取 inputs 绑定
  const bindings = this.getInputBindings(task.skillId);
  if (bindings) {
    return this.inputResolver.resolve(bindings, {
      outputManager: context.outputManager,
      context: context.globalContext,
      input: task.input as Record<string, unknown>,
      previousOutputs: context.previousOutputs,
    });
  }
  // 回退: 无绑定声明的 skill
  return {
    task: task.description,
    context: {
      input: task.input,
      sourceText: context.globalContext.sourceText,
      outline: context.globalContext.outline,
    },
    previousOutputs: context.previousOutputs,
  };
}
```

**验收标准**：

- 6 个 companion SKILL.md 元数据正确
- SlidesSkillsModule providers 从 21 个减少到 6 个
- buildSkillInput() 从 87 行 switch/case 简化为 ~20 行通用逻辑
- 所有 21 个 skills 在 SkillRegistry 中可查到

**预估工期**：2 天

### Phase 4: 删除旧文件 + 完整验证

**目标**：删除 15 个旧 .skill.ts 文件，完整验证

**删除清单**：

| 文件                           | 替代方案                                             |
| ------------------------------ | ---------------------------------------------------- |
| `task-decomposition.skill.ts`  | → `task-decomposition/SKILL.md` + PromptSkillAdapter |
| `outline-planning.skill.ts`    | → `outline-planning/SKILL.md` + PromptSkillAdapter   |
| `four-step-design.skill.ts`    | → ...                                                |
| `content-compression.skill.ts` | → ...                                                |
| `data-supplement.skill.ts`     | → ...                                                |
| `content-analyzer.skill.ts`    | → ...                                                |
| `layout-optimizer.skill.ts`    | → ...                                                |
| `terminology-unifier.skill.ts` | → ...                                                |
| `transition-checker.skill.ts`  | → ...                                                |
| `quality-audit.skill.ts`       | → ...                                                |
| `slide-thinking.skill.ts`      | → ...                                                |
| `voice-narration.skill.ts`     | → ...                                                |
| `content-polisher.skill.ts`    | → ...                                                |
| `fact-checker.skill.ts`        | → ...                                                |
| `layout-fixer.skill.ts`        | → ...                                                |

**不删除**（保留为 NestJS Provider）：

- `template-rendering.skill.ts`
- `chart-renderer.skill.ts`
- `image-fetcher.skill.ts`
- `template-matcher.skill.ts`
- `page-pipeline.skill.ts`
- `page-type-selection.skill.ts`

**验证命令**：

```bash
npm run type-check          # 类型检查
npm run test:quick          # 快速测试
npm run verify:full         # 完整验证
```

**手动验证**：

- [ ] 生成 5 页 PPT，对比迁移前后输出质量
- [ ] Admin 技能管理页面显示所有 skills
- [ ] SkillsMP 安装一个 prompt skill，确认被 Slides 管线消费

**预估工期**：1 天

### Phase 5: 扩展到 Writing / Topic-Insights

**目标**：让已有 .skill.md 通过 PromptSkillBridge 注册到 SkillRegistry

```typescript
// writing.module.ts 新增
async onModuleInit() {
  this.agentRegistry.register(this.writerAgent);
  // 新增: 桥接 writing skills 到 SkillRegistry
  await this.promptSkillBridge.registerDomain('writing');
}

// topic-insights.module.ts 新增
async onModuleInit() {
  await this.promptSkillBridge.registerDomain('research');
}
```

**验收标准**：

- Writing 9 个 + TopicInsights 11 个 skills 在 SkillRegistry 中可查
- chatWithSkills() 路径不受影响（向后兼容）

**预估工期**：1 天

---

## 8. 向后兼容策略

### 8.1 Feature Flag

```
环境变量: SKILL_MD_RUNTIME_ENABLED=true|false

false (默认): PromptSkillBridge 不激活，只有 code-based skills 注册
true:         PromptSkillBridge 激活，SKILL.md → PromptSkillAdapter → SkillRegistry
```

### 8.2 优先级规则

```
code-based skill (NestJS Provider)  > PromptSkillAdapter (SKILL.md)

同一个 ID:
  1. code-based 先注册 (onModuleInit 中 code skills 先注册)
  2. PromptSkillBridge 发现同 ID 已存在 → 自动跳过
```

### 8.3 渐进迁移流程

```
Phase 1-2: 两套并存，Feature Flag 控制
           code-based skills 仍是生产路径
           SKILL.md 在开发/测试环境验证

Phase 3:   切换 Flag → SKILL.md prompt skills 为主路径
           code tools 不受影响 (始终是 NestJS Provider)

Phase 4:   验证一周后删除 15 个旧 .skill.ts

Phase 5:   Writing/Insights 接入
```

---

## 9. 生态开放策略

### 9.1 技能层次模型

```
┌──────────────────────────────────────────────────────────────────────┐
│                          技能生态金字塔                                │
│                                                                      │
│                        ┌──────────────┐                              │
│                        │  SkillsMP    │  ← 社区共享 (agentskills.io) │
│                        │  31,000+     │                              │
│                        └──────┬───────┘                              │
│                    ┌──────────┴──────────┐                           │
│                    │  用户自定义 Skills    │  ← Admin 上传 / URL 导入 │
│                    │  (按租户隔离)         │                           │
│                    └──────────┬──────────┘                           │
│              ┌────────────────┴────────────────┐                     │
│              │     企业内部共享 Skills           │  ← 私有 Registry   │
│              │     (团队间复用)                   │                     │
│              └────────────────┬────────────────┘                     │
│        ┌──────────────────────┴──────────────────────┐               │
│        │              内置 Skills (41+)               │               │
│        │  Slides 15 + Writing 9 + Insights 11 + Code 6│              │
│        └─────────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 四条引入路径

| 路径                 | 角色               | 入口                     | 存储                | 验证                       | 可用范围 |
| -------------------- | ------------------ | ------------------------ | ------------------- | -------------------------- | -------- |
| **A. 代码仓库内置**  | 平台开发者         | `skills/*/SKILL.md` 文件 | Git 仓库            | CI/CD + type-check         | 所有租户 |
| **B. SkillsMP 安装** | Admin              | 市场页面「安装」按钮     | `cached/skills/`    | 安全扫描 + parseSkillMd    | 所有租户 |
| **C. Admin 上传**    | Admin / 企业开发者 | 上传页面 / API           | `user-skills/` + DB | parseSkillMd + schema 验证 | 当前租户 |
| **D. URL 导入**      | Admin / 开发者     | URL 输入框 / API         | `user-skills/` + DB | 安全扫描 + parseSkillMd    | 当前租户 |

```
路径 A: 代码仓库 ─────────────────────────────────────────────────────────┐
  developer → git commit SKILL.md → deploy → SkillLoaderService 扫描     │
                                                                          │
路径 B: SkillsMP ─────────────────────────────────────────────────────────┤
  admin → 浏览市场 → 安装 → SkillsMPClient → 安全扫描 → cached/skills/    │
                                                                          │
路径 C: Admin 上传 ───────────────────────────────────────────────────────┤
  admin → 上传 .md/.yaml → SkillValidator → user-skills/{tenantId}/       ├─→ PromptSkillBridge
                                                                          │   → SkillRegistry
路径 D: URL 导入 ─────────────────────────────────────────────────────────┤     → 统一消费
  developer → 输入 GitHub Raw URL → fetch → 安全扫描 → user-skills/       │
                                                                          │
所有路径 ──→ SkillLoaderService 统一加载 ──→ PromptSkillBridge 桥接 ──────┘
```

### 9.3 消费生态 (SkillsMP / 外部 → 系统)

```
SkillsMP / Admin 上传 / URL 导入
       │
       ▼
SkillLoaderService (统一加载)
       │
       ├─→ chatWithSkills() ← Writing/Insights 消费 ✅
       │
       └─→ PromptSkillBridge → SkillRegistry
                                     │
                                     └─→ skill.execute()
                                          ← Slides/Agent/Executor 消费 ✅
```

### 9.4 贡献生态 (系统 → SkillsMP)

```
内置 SKILL.md (35 个 prompt skills)
       │
       ├─→ 符合 agentskills.io 标准格式
       ├─→ 英文 description (LLM 语义匹配)
       ├─→ 独立目录结构
       ├─→ JSON Schema 输入输出声明
       │
       ▼
  一键发布到 SkillsMP (Phase 8 实现)
       │
       ├─→ CLI: genesis skill publish <skillId>
       ├─→ Admin UI: 技能详情页「发布到市场」按钮
       └─→ 自动生成 README + 元数据 + 版本号
```

### 9.5 预置能力

| 层次               | 技能                                | 格式                           | 来源              |
| ------------------ | ----------------------------------- | ------------------------------ | ----------------- |
| 内置 Prompt Skills | 15 Slides + 9 Writing + 11 Insights | SKILL.md                       | 代码仓库          |
| 内置 Code Tools    | 6 Slides 确定性工具                 | .skill.ts + companion SKILL.md | 代码仓库          |
| SkillsMP 安装      | 任意数量                            | SKILL.md                       | SkillsMP 市场     |
| Admin 上传         | 任意数量                            | SKILL.md / YAML / JSON         | Admin 后台上传    |
| URL 导入           | 任意数量                            | SKILL.md                       | GitHub / 任意 URL |
| 用户自建           | 按租户隔离                          | SKILL.md                       | Admin 在线编辑器  |

---

## 10. 开发者技能引入方案

> 完整覆盖从技能开发 → 验证 → 引入 → 消费的全链路。

### 10.1 路径 A：代码仓库内置（平台开发者）

**已由旅程 4.6 覆盖，此处补充开发工具链。**

```
开发者工作流:
  ① 创建 skills/{domain}/{skill-id}/SKILL.md
  ② 本地验证: npm run skill:validate <path>
  ③ 本地测试: npm run skill:test <skill-id> --input '{...}'
  ④ git commit → CI 自动验证
  ⑤ deploy → SkillLoaderService 自动扫描注册
```

**Skill CLI 工具**（新增 `scripts/skill-cli.ts`）：

```typescript
// npm run skill:validate -- slides/skills/outline-planning/SKILL.md
// 验证内容:
//   ✅ YAML frontmatter 语法正确
//   ✅ 必填字段: name, description, domain
//   ✅ ID 格式: kebab-case
//   ✅ inputs 绑定的 from 引用存在 (检查同 domain 下的 skill IDs)
//   ✅ requiredSkills 引用存在
//   ✅ outputSchema 是合法 JSON Schema
//   ✅ body 非空 (prompt 模式必须有 body)
//   ✅ tokenBudget < 8000 (防止 context overflow)
//   ⚠️ 建议: description 使用英文 (SkillsMP 语义匹配)

// npm run skill:test -- outline-planning --input '{"sourceText":"..."}'
// 执行内容:
//   → 加载 SKILL.md → 创建 PromptSkillAdapter
//   → 使用提供的 input 调用 execute()
//   → 打印 LLM 输出 + token 消耗 + 耗时
//   → 验证输出是否符合 outputSchema
```

**CI 集成**（在 `verify:full` 中自动运行）：

```bash
# package.json scripts
"skill:validate": "ts-node scripts/skill-cli.ts validate",
"skill:validate:all": "ts-node scripts/skill-cli.ts validate-all",
"skill:test": "ts-node scripts/skill-cli.ts test",
```

---

### 10.2 路径 B：SkillsMP 安装（已有，增强）

**已由旅程 4.5 覆盖。现有实现已较完善，补充以下增强。**

**增强 1: 安装后热注册**

```typescript
// 当前: 安装后需要重启才能进入 SkillRegistry
// 增强: 安装后立即注册

// skillsmp-client.service.ts 增强
async installSkill(skillId: string): Promise<InstalledSkill> {
  // ... 现有: 下载 → 安全扫描 → 缓存到磁盘

  // 新增: 热注册到 SkillRegistry
  const definition = this.skillParser.parse(content);
  this.promptSkillBridge.registerDefinitions([definition]);

  // 新增: 同步到 DB
  await this.adminService.syncSkillConfig(skillId);

  return installed;
}
```

**增强 2: 依赖检查**

```typescript
// 安装前检查 requiredSkills 和 requiredTools 是否满足
async preInstallCheck(skillId: string): Promise<PreInstallReport> {
  const skill = await this.fetchSkillMetadata(skillId);
  return {
    missingSkills: skill.requiredSkills?.filter(
      id => !this.skillRegistry.tryGet(id)
    ),
    missingTools: skill.requiredTools?.filter(
      id => !this.toolRegistry.tryGet(id)
    ),
    conflictingSkills: this.skillRegistry.tryGet(skill.id)
      ? [{ id: skill.id, existingType: 'code-based' }]
      : [],
  };
}
```

---

### 10.3 路径 C：Admin 上传（重构）

**现有问题**：上传端点不调用 `parseSkillMd()`，不持久化到文件系统，SkillLoaderService 无法发现。

**重构方案**：

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Admin    │    │ AI Admin     │    │ SkillValidator   │    │ SkillLoader +    │
│  Frontend │    │ Controller   │    │ (新增)            │    │ PromptSkillBridge│
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
     │                  │                     │                       │
     │ 上传 SKILL.md    │                     │                       │
     │ (拖拽 / 选择文件) │                     │                       │
     │─────────────────>│                     │                       │
     │                  │                     │                       │
     │                  │ ① 解析文件内容       │                       │
     │                  │────────────────────>│                       │
     │                  │                     │                       │
     │                  │  parseSkillMd()     │                       │
     │                  │  → YAML frontmatter │                       │
     │                  │  → 必填字段验证      │                       │
     │                  │  → ID 格式检查       │                       │
     │                  │  → 安全内容扫描      │                       │
     │                  │  → outputSchema 验证 │                       │
     │                  │  → tokenBudget 检查  │                       │
     │                  │                     │                       │
     │  验证结果预览:    │                     │                       │
     │  ┌─────────────────────────────────┐   │                       │
     │  │ ✅ 名称: outline-planning       │   │                       │
     │  │ ✅ 域: office                   │   │                       │
     │  │ ✅ 输入: 2 个 (1 必需)          │   │                       │
     │  │ ✅ 输出 Schema: 合法            │   │                       │
     │  │ ⚠️ 同名技能已存在 (将覆盖)      │   │                       │
     │  │ [确认保存]  [取消]              │   │                       │
     │  └─────────────────────────────────┘   │                       │
     │<─────────────────│                     │                       │
     │                  │                     │                       │
     │ [确认保存]       │                     │                       │
     │─────────────────>│                     │                       │
     │                  │                     │                       │
     │                  │ ② 持久化            │                       │
     │                  │  → user-skills/     │                       │
     │                  │    {tenantId}/       │                       │
     │                  │    {skillId}/        │                       │
     │                  │    SKILL.md          │                       │
     │                  │  → DB SkillConfig    │                       │
     │                  │    upsert            │                       │
     │                  │                     │                       │
     │                  │ ③ 热注册             │                       │
     │                  │────────────────────────────────────────────>│
     │                  │                     │  PromptSkillBridge    │
     │                  │                     │  .registerDefinitions │
     │                  │                     │  → SkillRegistry      │
     │                  │                     │                       │
     │  ✅ 上传成功      │                     │                       │
     │  技能已可用       │                     │                       │
     │<─────────────────│                     │                       │
```

**SkillValidatorService（新增）**：

```typescript
// ai-engine/skills/validator/skill-validator.service.ts

@Injectable()
export class SkillValidatorService {
  constructor(
    private readonly skillParser: SkillParser,
    private readonly skillRegistry: SkillRegistry,
  ) {}

  /**
   * 完整验证一个 SKILL.md 内容
   * 返回结构化验证报告 (前端可直接展示)
   */
  validate(content: string): SkillValidationReport {
    const report: SkillValidationReport = {
      valid: true,
      errors: [],
      warnings: [],
      metadata: null,
    };

    // 1. 解析 frontmatter
    try {
      const definition = this.skillParser.parse(content);
      report.metadata = definition.metadata;
    } catch (e) {
      report.valid = false;
      report.errors.push({ field: "frontmatter", message: e.message });
      return report;
    }

    const fm = report.metadata;

    // 2. 必填字段
    if (!fm.name)
      report.errors.push({ field: "name", message: "缺少 name 字段" });
    if (!fm.description)
      report.errors.push({ field: "description", message: "缺少 description" });
    if (!fm.domain)
      report.errors.push({ field: "domain", message: "缺少 domain 字段" });

    // 3. ID 格式
    if (fm.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.id)) {
      report.errors.push({ field: "id", message: "ID 必须是 kebab-case 格式" });
    }

    // 4. 安全扫描
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /<iframe/i,
      /on\w+=/i,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        report.errors.push({
          field: "content",
          message: `检测到不安全内容: ${pattern}`,
        });
      }
    }

    // 5. Body 检查 (prompt 模式必须有 body)
    if ((fm as any).executionMode !== "provider") {
      const body = content.split("---").slice(2).join("---").trim();
      if (!body || body.length < 50) {
        report.errors.push({
          field: "body",
          message: "Prompt 技能必须有 Markdown 正文 (≥50 字符)",
        });
      }
    }

    // 6. Token 预算
    if (fm.tokenBudget && fm.tokenBudget > 8000) {
      report.warnings.push({
        field: "tokenBudget",
        message: "tokenBudget > 8000 可能导致 context overflow",
      });
    }

    // 7. 冲突检测
    const existing = this.skillRegistry.tryGet(fm.id);
    if (existing && !(existing as any).isPromptSkillAdapter) {
      report.warnings.push({
        field: "id",
        message: `同 ID 已有 code-based 技能，上传的 prompt 技能将被跳过`,
      });
    } else if (existing) {
      report.warnings.push({
        field: "id",
        message: "同 ID 技能已存在，将被覆盖",
      });
    }

    // 8. 依赖检查
    if ((fm as any).requiredSkills) {
      for (const dep of (fm as any).requiredSkills) {
        if (!this.skillRegistry.tryGet(dep)) {
          report.warnings.push({
            field: "requiredSkills",
            message: `依赖技能 "${dep}" 未找到`,
          });
        }
      }
    }

    report.valid = report.errors.length === 0;
    return report;
  }
}

interface SkillValidationReport {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  metadata: SkillMdFrontmatter | null;
}
```

**上传端点重构**：

```typescript
// ai-admin.controller.ts — 增强
@Post('ai/skills/upload')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
async uploadSkill(@UploadedFile() file: Express.Multer.File) {
  // 1. 验证文件类型
  const ext = extname(file.originalname).toLowerCase();
  if (!['.md', '.yaml', '.yml'].includes(ext)) {
    throw new BadRequestException('支持的格式: .md, .yaml, .yml');
  }

  const content = file.buffer.toString('utf-8');

  // 2. 调用 SkillValidator (新增!)
  const report = this.skillValidator.validate(content);
  if (!report.valid) {
    return { success: false, report };
  }

  // 3. 持久化到文件系统 (新增!)
  const skillId = report.metadata.id;
  const tenantDir = `user-skills/${tenantId}/${skillId}`;
  await fs.mkdir(tenantDir, { recursive: true });
  await fs.writeFile(`${tenantDir}/SKILL.md`, content);

  // 4. 持久化到 DB
  await this.adminService.upsertSkillConfig(report.metadata);

  // 5. 热注册到 SkillRegistry (新增!)
  const definition = this.skillParser.parse(content);
  this.promptSkillBridge.registerDefinitions([definition]);

  return { success: true, report, skillId };
}
```

**存储目录结构**：

```
backend/
  cached/
    skills/                         ← SkillsMP 安装的 (路径 B)
      ppt-visual-enhancer.skill.md
      seo-optimizer.skill.md

  user-skills/                      ← Admin 上传 / URL 导入的 (路径 C/D)
    {tenantId}/
      my-custom-skill/
        SKILL.md
      another-skill/
        SKILL.md

  src/modules/
    ai-app/office/slides/skills/    ← 代码仓库内置的 (路径 A)
      task-decomposition/SKILL.md
      ...
    ai-app/writing/skills/          ← 代码仓库内置的 (路径 A)
      ...
```

**SkillLoaderService 扫描路径增强**：

```typescript
// 现有: 只扫描 src/modules/ 下的 SKILL.md
// 增强: 扫描 3 个来源

async loadAllSkills(): Promise<SkillMdDefinition[]> {
  const skills: SkillMdDefinition[] = [];

  // 来源 1: 内置技能 (代码仓库)
  skills.push(...await this.scanDirectory('src/modules/**/skills'));

  // 来源 2: SkillsMP 安装的
  skills.push(...await this.scanDirectory('cached/skills'));

  // 来源 3: 用户上传 / URL 导入的
  skills.push(...await this.scanDirectory('user-skills'));

  return skills;
}
```

---

### 10.4 路径 D：URL 导入（新增）

**适用场景**：开发者从 GitHub、Gist、任意 URL 导入 SKILL.md

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐
│  Admin    │    │ AI Admin     │    │ SkillValidator   │
│  Frontend │    │ Controller   │    │ + HTTP Client    │
└────┬─────┘    └──────┬───────┘    └────────┬─────────┘
     │                  │                     │
     │ 输入 URL:        │                     │
     │ github.com/user/ │                     │
     │ repo/.../SKILL.md│                     │
     │─────────────────>│                     │
     │                  │                     │
     │                  │ ① URL 白名单检查    │
     │                  │  → GitHub ✅         │
     │                  │  → Gist ✅           │
     │                  │  → GitLab ✅         │
     │                  │  → 其他: 需确认 ⚠️   │
     │                  │                     │
     │                  │ ② fetch 内容        │
     │                  │────────────────────>│
     │                  │                     │
     │                  │  → Content-Type 检查│
     │                  │  → 大小限制 100KB    │
     │                  │  → 安全扫描          │
     │                  │  → parseSkillMd()    │
     │                  │                     │
     │  预览 + 验证报告 │                     │
     │<─────────────────│                     │
     │                  │                     │
     │  [确认导入]      │                     │
     │─────────────────>│                     │
     │                  │                     │
     │                  │ ③ 持久化 + 热注册   │
     │                  │ (同路径 C 流程)      │
     │                  │                     │
     │  ✅ 导入成功     │                     │
     │<─────────────────│                     │
```

**API 端点**：

```typescript
// ai-admin.controller.ts — 新增
@Post('ai/skills/import-url')
async importSkillFromUrl(@Body() dto: ImportSkillUrlDto) {
  // 1. URL 白名单
  const url = new URL(dto.url);
  const trustedHosts = ['github.com', 'raw.githubusercontent.com',
                        'gist.github.com', 'gist.githubusercontent.com',
                        'gitlab.com'];
  const isTrusted = trustedHosts.some(h => url.hostname.endsWith(h));

  // 2. 转换为 raw URL (GitHub 支持)
  const rawUrl = this.toRawUrl(dto.url);

  // 3. Fetch 内容
  const response = await this.httpService.get(rawUrl, {
    maxContentLength: 100_000,  // 100KB
    timeout: 10_000,
  });

  // 4. 验证 (复用 SkillValidatorService)
  const report = this.skillValidator.validate(response.data);
  if (dto.dryRun) {
    return { success: report.valid, report, isTrusted };
  }

  if (!report.valid) {
    throw new BadRequestException({ message: '验证失败', report });
  }

  // 5. 持久化 + 热注册 (复用上传逻辑)
  return this.saveAndRegister(response.data, report.metadata, dto.tenantId);
}
```

---

### 10.5 前端技能管理增强

**Admin 技能管理页面增强**：

```
┌─────────────────────────────────────────────────────────────────┐
│  AI 技能管理                                          [刷新]    │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ 全部技能  │ │ 市场安装  │ │ 自定义    │ │ 在线编辑  │          │
│  │ (52)     │ │ (3)      │ │ (2)      │ │          │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
│  ┌─── 引入技能 ─────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  [📄 上传文件]   [🔗 URL 导入]   [✏️ 在线创建]            │  │
│  │                                                           │  │
│  │  支持 .md / .yaml / .yml                                  │  │
│  │  拖拽文件到此处或点击选择                                    │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── 技能列表 ─────────────────────────────────────────────┐  │
│  │ 名称                  │ 域     │ 类型   │ 来源    │ 状态 │  │
│  │ task-decomposition    │ office │ prompt │ 内置    │ ✅  │  │
│  │ template-rendering    │ office │ code   │ 内置    │ ✅  │  │
│  │ ppt-visual-enhancer   │ office │ prompt │ 市场    │ ✅  │  │
│  │ my-custom-analyzer    │ custom │ prompt │ 上传    │ ✅  │  │
│  │ ...                   │        │        │         │      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**在线 SKILL.md 编辑器（新增）**：

```
┌─────────────────────────────────────────────────────────────────┐
│  创建自定义技能                                    [保存] [取消] │
│                                                                 │
│  ┌─── 元数据 ───────────────────┐ ┌─── 实时预览 ─────────────┐ │
│  │ 名称: [                    ] │ │ ┌───────────────────────┐ │ │
│  │ ID:   [auto-generated      ] │ │ │ ID: my-skill          │ │ │
│  │ 域:   [office      ▾]       │ │ │ 域: office             │ │ │
│  │ 标签: [slides, analysis    ] │ │ │ 类型: prompt           │ │ │
│  │ 优先级: [100               ] │ │ │ 输入: 2 (1 必需)       │ │ │
│  └──────────────────────────────┘ │ │ 输出: JSON Schema ✅   │ │ │
│                                    │ │ Body: 1,234 字符       │ │ │
│  ┌─── 输入绑定 ─────────────────┐ │ │ Token 预估: ~2,100     │ │ │
│  │ + 添加输入                    │ │ └───────────────────────┘ │ │
│  │ ┌────────────────────────┐   │ │                           │ │
│  │ │ sourceText             │   │ │ ┌─── 验证状态 ──────────┐ │ │
│  │ │ from: context.sourceText│  │ │ │ ✅ frontmatter 合法   │ │ │
│  │ │ required: ✅            │   │ │ │ ✅ body 非空          │ │ │
│  │ └────────────────────────┘   │ │ │ ✅ 无安全风险          │ │ │
│  └──────────────────────────────┘ │ │ ⚠️ description 建议英文 │ │ │
│                                    │ └────────────────────────┘ │ │
│  ┌─── Prompt 正文 (Markdown) ───────────────────────────────┐  │ │
│  │ # My Custom Analysis Skill                                │  │ │
│  │                                                            │  │ │
│  │ ## Role                                                    │  │ │
│  │ You are an expert analyst who...                           │  │ │
│  │                                                            │  │ │
│  │ ## Analysis Framework                                      │  │ │
│  │ 1. Identify key patterns                                   │  │ │
│  │ 2. Extract supporting evidence                             │  │ │
│  │ ...                                                        │  │ │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

### 10.6 技能版本管理

```
技能版本策略:

  内置技能 (路径 A):
    → 版本随代码仓库 Git 管理
    → SKILL.md frontmatter 中的 version 字段
    → 部署即更新

  SkillsMP 安装 (路径 B):
    → SkillsMP 维护版本号
    → 自动更新检查 (每 6 小时)
    → 可锁定版本: { "pinnedVersion": "2.1.0" }

  用户上传 / URL 导入 (路径 C/D):
    → DB 记录版本号
    → 重复上传同 ID → 版本号递增 → 保留前一版本
    → Admin 可回滚到前一版本

版本冲突规则:
  同一 skill ID 多个来源:
    code-based (.skill.ts)  > 内置 SKILL.md  > 用户上传  > SkillsMP 安装
    ↑ 优先级最高                                          ↑ 优先级最低
```

---

## 11. 竞争力增强路线图

> 基于业界对标分析，系统性补齐与领先水平的差距。

### 11.1 Progressive Disclosure（按需分级加载）

**业界标准**（agentskills.io 核心创新）：

```
Level 0: 仅 name + description        (~50 tokens)  → 技能发现/列表
Level 1: 完整 SKILL.md body            (~2000 tokens) → 激活时加载
Level 2: scripts/ + references/        (按需)        → 执行时加载
```

**当前问题**：SkillLoaderService 启动时**全量加载**所有 SKILL.md 的完整内容。41+ 个 skills × ~2000 tokens = ~80K tokens 常驻内存。

**增强方案**：

```typescript
// ai-engine/skills/loader/skill-loader.service.ts — 增强

/**
 * Level 0: 启动时只解析 frontmatter (元数据)
 * 不加载 body，节省内存和启动时间
 */
async loadMetadataIndex(): Promise<SkillMetadataIndex[]> {
  const files = await this.scanAllSkillFiles();
  return files.map(file => ({
    id: this.parseIdFromFrontmatter(file),      // 只读 YAML header
    name: this.parseNameFromFrontmatter(file),
    description: this.parseDescFromFrontmatter(file),
    domain: this.parseDomainFromFrontmatter(file),
    filePath: file,                              // 记录路径，按需加载
    // body 不在此阶段加载
  }));
}

/**
 * Level 1: 按需加载完整 SKILL.md (激活时)
 * 首次访问后缓存 (LRU)
 */
async loadFullDefinition(skillId: string): Promise<SkillMdDefinition> {
  // LRU 缓存命中
  const cached = this.definitionCache.get(skillId);
  if (cached) return cached;

  // 从 metadata index 找到文件路径
  const meta = this.metadataIndex.get(skillId);
  if (!meta) throw new Error(`Skill "${skillId}" not found`);

  // 加载并解析完整文件
  const content = await fs.readFile(meta.filePath, 'utf-8');
  const definition = this.skillParser.parse(content);

  // 存入 LRU 缓存 (最大 50 个)
  this.definitionCache.set(skillId, definition);
  return definition;
}
```

**PromptSkillAdapter 延迟加载**：

```typescript
// 修改 PromptSkillAdapter 为延迟加载模式

export class PromptSkillAdapter implements ISkill<unknown, unknown> {
  private _definition: SkillMdDefinition | null = null;

  constructor(
    private readonly metadata: SkillMetadataIndex, // Level 0 元数据
    private readonly loader: SkillLoaderService, // 按需加载器
    private readonly facade: AIEngineFacade,
    private readonly promptBuilder: SkillPromptBuilder,
  ) {
    // 只从 metadata 填充 ISkill 接口字段
    this.id = metadata.id;
    this.name = metadata.name;
    this.description = metadata.description;
    // body 不在此时加载
  }

  async execute(
    input: unknown,
    context: SkillContext,
  ): Promise<SkillResult<unknown>> {
    // Level 1: 首次执行时才加载完整定义
    if (!this._definition) {
      this._definition = await this.loader.loadFullDefinition(this.id);
    }
    // ... 后续执行逻辑不变
  }
}
```

**预期效果**：

| 指标         | 当前               | 增强后                |
| ------------ | ------------------ | --------------------- |
| 启动加载量   | 41 × 完整 SKILL.md | 41 × frontmatter only |
| 启动内存     | ~80K tokens 常驻   | ~2K tokens 常驻       |
| 首次执行延迟 | 0 (已预加载)       | +50ms (加载一个文件)  |
| 可扩展性     | ~100 skills 上限   | ~10,000 skills        |

---

### 11.2 技能语义发现（Embedding 匹配）

**当前方式**：`domain` + `taskType` 硬过滤。

**问题**：

- 新增 domain 需要修改代码
- 跨 domain 的技能复用需要手动配置
- SkillsMP 安装的技能 domain 可能不匹配

**增强方案**：

```
当前:
  getSkillsForTask({ domain: "writing", taskType: "chapter-writing" })
  → SQL WHERE domain = "writing" AND taskType IN (...)
  → 精确匹配，无法发现相关但不完全匹配的技能

增强后:
  getSkillsForTask({ domain: "writing", taskType: "chapter-writing", query: "..." })
  → Step 1: domain/taskType 硬过滤 (快速缩小范围)
  → Step 2: description embedding 向量相似度排序 (语义匹配)
  → Step 3: 返回 Top-K 最相关技能

  例: 写作场景搜索 "数据分析"
  → 硬过滤: writing domain 无匹配
  → 语义发现: Insights 的 "data-interpretation" 技能
    description 语义相似度 0.87 → 推荐
```

**实现要点**：

```typescript
// ai-engine/skills/discovery/skill-discovery.service.ts (新增)

@Injectable()
export class SkillDiscoveryService {
  constructor(
    private readonly embeddingService: EmbeddingService, // 已有
    private readonly skillLoader: SkillLoaderService,
  ) {}

  /**
   * 混合发现: 硬过滤 + 语义匹配
   */
  async discoverSkills(query: SkillDiscoveryQuery): Promise<RankedSkill[]> {
    // Step 1: 硬过滤 (快速)
    let candidates = this.skillLoader.getMetadataIndex();
    if (query.domain) {
      candidates = candidates.filter((s) => s.domain === query.domain);
    }

    // Step 2: 语义匹配 (如果硬过滤结果不足或显式请求)
    if (candidates.length < query.minResults || query.enableSemanticSearch) {
      const allSkills = this.skillLoader.getMetadataIndex();
      const queryEmbedding = await this.embeddingService.embed(
        `${query.taskType} ${query.contextHint || ""}`,
      );
      const ranked = allSkills.map((skill) => ({
        skill,
        score: cosineSimilarity(queryEmbedding, skill.descriptionEmbedding),
      }));
      ranked.sort((a, b) => b.score - a.score);
      candidates = ranked.slice(0, query.maxResults).map((r) => r.skill);
    }

    return candidates;
  }

  /**
   * 启动时预计算所有技能 description 的 embedding
   * 只需 description (~50 tokens)，成本极低
   */
  async buildEmbeddingIndex(): Promise<void> {
    const skills = this.skillLoader.getMetadataIndex();
    for (const skill of skills) {
      skill.descriptionEmbedding = await this.embeddingService.embed(
        `${skill.name}: ${skill.description}`,
      );
    }
  }
}
```

---

### 11.3 统一消费路径

**当前问题**：chatWithSkills() 和 SkillRegistry.tryGet() 是两条独立路径。

```
当前:
  Writing → chatWithSkills() → prompt 注入 (路径 1)
  Slides  → SkillRegistry.tryGet() → execute() (路径 2)
  → 同一个 SKILL.md 可能被两条路径以不同方式消费
  → 消费者必须知道该用哪条路径
```

**增强方案**（Phase 8 中长期目标）：

```
增强后:
  所有消费者 → SkillRegistry.tryGet() → ISkill.execute()
    │
    ├─ PromptSkillAdapter:  SKILL.md body → LLM → JSON
    └─ NestJS Provider:     code → 确定性结果

  chatWithSkills() 内部也通过 SkillRegistry 获取 skill:
    → 保留 prompt 注入行为 (向后兼容)
    → 但 skill 发现从 SkillLoaderService 迁移到 SkillDiscoveryService
    → 统一发现 + 统一元数据
```

**分阶段统一**：

```
Phase 5 (当前):
  chatWithSkills() → SkillLoaderService       (不变)
  SkillRegistry    → PromptSkillBridge        (新增)
  → 两条路径共存，Writing/Insights 的 SKILL.md 同时出现在两处

Phase 7 (近期):
  chatWithSkills() 内部改用 SkillRegistry 发现
  → SkillDiscoveryService 替代 SkillLoaderService.getSkillsForTask()
  → 消费方式不变 (仍然 prompt 注入)
  → 但发现逻辑统一

Phase 8 (中期):
  逐步将 chatWithSkills() 消费者迁移到 SkillRegistry.execute()
  → Writing 的 chatWithSkills() 改为 skill.execute()
  → Insights 的手动 prompt 拼接改为 skill.execute()
  → 最终只有一条消费路径
```

---

### 11.4 作用域与层级覆盖

**业界参考**：AGENTS.md 的层级覆盖机制。

```
AGENTS.md 层级:
  ~/.agents.md            (全局默认)
    → project/AGENTS.md   (项目级)
      → project/src/AGENTS.md (目录级)
        → AGENTS.override.md  (强制覆盖)
```

**GenesisPod 技能作用域设计**：

```
作用域层级 (从低到高):

  ① SkillsMP 安装的 (最低优先级)
     → 所有租户可见
     → Admin 可禁用

  ② 内置技能 (代码仓库)
     → 所有租户可见
     → 同 ID 覆盖 SkillsMP

  ③ 企业自定义 (用户上传)
     → 按租户隔离
     → 同 ID 覆盖内置

  ④ 项目级覆盖 (未来)
     → 按项目/任务绑定
     → 同 ID 覆盖企业自定义

解析规则: 同 ID 技能，高优先级覆盖低优先级
```

**实现方式**：

```typescript
// SkillRegistry 增强: 支持作用域
interface SkillRegistration {
  skill: ISkill;
  scope: 'marketplace' | 'builtin' | 'tenant' | 'project';
  tenantId?: string;
  projectId?: string;
}

// 查询时按作用域优先级排序
tryGet(skillId: string, context?: { tenantId?: string; projectId?: string }): ISkill | null {
  const candidates = this.registry.get(skillId) || [];
  // project > tenant > builtin > marketplace
  return candidates
    .filter(c => this.matchesScope(c, context))
    .sort((a, b) => SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope])
    [0]?.skill || null;
}
```

---

### 11.5 竞争力增强路线图总览

```
Phase 6: 开发者工具链 + 上传重构 + URL 导入                 ┐
  ├─ Skill CLI (validate/test)                               │
  ├─ SkillValidatorService                                   │  近期
  ├─ 上传端点重构 (parseSkillMd + 文件持久化 + 热注册)        │  (~3 天)
  ├─ URL 导入端点                                            │
  └─ 前端增强 (拖拽上传 + 预览 + 验证反馈)                    ┘

Phase 7: Progressive Disclosure + 语义发现                   ┐
  ├─ SkillLoaderService 分级加载 (Level 0/1)                  │
  ├─ PromptSkillAdapter 延迟加载                              │  近期
  ├─ SkillDiscoveryService (embedding 匹配)                   │  (~3 天)
  ├─ chatWithSkills() 改用 SkillDiscoveryService              │
  └─ description embedding 预计算                             ┘

Phase 8: 统一消费路径 + 在线编辑器 + 贡献管线               ┐
  ├─ chatWithSkills() 内部走 SkillRegistry                   │
  ├─ Admin 在线 SKILL.md 编辑器                              │  中期
  ├─ 一键发布到 SkillsMP                                     │  (~5 天)
  ├─ 技能作用域 (tenant/project 级)                          │
  └─ 版本管理 (回滚/锁定)                                    ┘

Phase 9: 安全沙箱 + 私有 Registry                           ┐
  ├─ WebAssembly sandbox (第三方代码 skills)                   │  远期
  └─ 企业私有 Skill Registry (内部共享)                        ┘
```

**增强后竞争力预期**：

| 维度         | 当前    | Phase 6-7 后 | Phase 8 后 |
| ------------ | ------- | ------------ | ---------- |
| 架构方向     | 9/10    | 9/10         | 9/10       |
| 声明式编排   | 8/10    | 8/10         | 9/10       |
| 跨模块复用   | 7/10    | 7/10         | 9/10       |
| 生态开放度   | 5/10    | **7/10**     | **9/10**   |
| 渐进加载     | 4/10    | **8/10**     | 8/10       |
| 安全执行     | 3/10    | 3/10         | 3/10       |
| 治理标准     | 4/10    | 5/10         | **7/10**   |
| **加权总分** | **6.6** | **7.5**      | **8.5**    |

---

## 12. 风险与缓解

| 风险                                  | 概率 | 影响 | 缓解措施                                             |
| ------------------------------------- | ---- | ---- | ---------------------------------------------------- |
| Prompt 模式输出不稳定 (JSON 解析失败) | 中   | 高   | outputSchema 约束 + 多级 JSON 提取 + 截断修复 + 重试 |
| 迁移后 Slides 输出质量下降            | 中   | 高   | A/B 对比测试，Feature Flag 可即时回滚                |
| InputBindingResolver 解析错误         | 低   | 中   | 回退到 default input + 详细错误日志                  |
| SkillsMP 安装的 skill 与内置冲突      | 低   | 中   | code-based 优先规则，同 ID 自动跳过                  |
| 性能退化 (适配器间接调用)             | 低   | 低   | 适配器是薄壳，主要开销在 LLM 调用                    |
| 用户上传恶意 SKILL.md (XSS/注入)      | 中   | 高   | SkillValidatorService 安全扫描 + 内容沙箱            |
| URL 导入 SSRF 攻击                    | 低   | 高   | URL 白名单 + 禁止内网地址 + 超时限制                 |
| Progressive Disclosure 首次执行延迟   | 中   | 低   | LRU 缓存 + 高频 skill 预热                           |
| 语义发现误匹配不相关 skill            | 中   | 中   | 硬过滤兜底 + 相似度阈值 + 人工审核                   |
| 多租户 skill 隔离泄露                 | 低   | 高   | 严格 tenantId 过滤 + 存储路径隔离                    |

---

## 13. 验证方案

### 13.1 单元测试

```typescript
describe("PromptSkillAdapter", () => {
  it("should create valid ISkill from SKILL.md definition");
  it("should assemble system prompt from SKILL.md body");
  it("should call facade.chat() with correct taskProfile");
  it("should extract JSON from markdown code block");
  it("should extract JSON from mixed text");
  it("should repair truncated JSON");
  it("should fallback to raw content on parse failure");
});

describe("PromptSkillBridge", () => {
  it("should register SKILL.md as PromptSkillAdapter");
  it("should skip skills with executionMode: provider");
  it("should skip when code-based skill already registered");
  it("should return registration result summary");
});

describe("InputBindingResolver", () => {
  it("should resolve from SkillOutputManager (no prefix)");
  it("should resolve from context (context. prefix)");
  it("should resolve from input (input. prefix)");
  it("should throw on missing required binding");
  it("should return undefined for optional missing binding");
  it("should fallback to previousOutputs with slides- prefix");
});
```

### 13.2 集成测试

```typescript
describe("Slides Skill Migration", () => {
  it("SKILL.md outline-planning output matches .skill.ts structure");
  it("Feature Flag OFF: only code-based skills available");
  it("Feature Flag ON: prompt + code skills both available");
  it("SkillsMP installed skill appears in SkillRegistry");
  it("End-to-end: generate 5-page PPT with migrated skills");
});
```

### 13.3 手动验证

- [ ] Admin 技能管理页面显示所有 SKILL.md skills
- [ ] SkillsMP 安装的 prompt skill 能被 Slides 管线消费
- [ ] 生成 5 页 PPT，对比迁移前后输出质量
- [ ] Writing chatWithSkills() 路径不受影响
- [ ] InputBindingResolver 正确替代 switch/case

---

## 14. 文件清单汇总

### 14.1 新增文件

| 文件                                                      | 类型                | 预估行数  |
| --------------------------------------------------------- | ------------------- | --------- |
| `ai-engine/skills/runtime/prompt-skill-adapter.ts`        | Prompt 适配器       | ~200      |
| `ai-engine/skills/runtime/prompt-skill-bridge.service.ts` | 桥接服务            | ~120      |
| `ai-engine/skills/runtime/input-binding-resolver.ts`      | 输入绑定解析        | ~80       |
| `ai-engine/skills/runtime/index.ts`                       | Barrel export       | ~10       |
| `slides/skills/*/SKILL.md` x 15                           | Prompt skill 定义   | ~200 each |
| `slides/skills/*/SKILL.md` x 6                            | Code tool companion | ~30 each  |

### 14.2 修改文件

| 文件                                        | 改动                                          |
| ------------------------------------------- | --------------------------------------------- |
| `ai-engine/skills/types/skill-md.types.ts`  | 新增 ~30 行类型                               |
| `ai-engine/skills/loader/skill-parser.ts`   | 解析新字段 ~20 行                             |
| `ai-engine/ai-engine-skills.module.ts`      | 注册 PromptSkillBridge + InputBindingResolver |
| `ai-engine/skills/index.ts`                 | 导出 runtime                                  |
| `slides/skills/slides-skills.module.ts`     | 简化: 21 providers → 6                        |
| `slides/orchestrator/slides-team-member.ts` | buildSkillInput: 87 行 → ~20 行               |

### 14.3 删除文件 (Phase 4)

| 数量              | 说明                                      |
| ----------------- | ----------------------------------------- |
| 15 个 `.skill.ts` | Prompt 型 slides skills (迁移到 SKILL.md) |

### 14.4 保留文件 (不删除)

| 文件                           | 原因                                          |
| ------------------------------ | --------------------------------------------- |
| `template-rendering.skill.ts`  | Code Tool, NestJS DI, 注入 ChartRendererSkill |
| `chart-renderer.skill.ts`      | Code Tool, ECharts SSR 渲染                   |
| `image-fetcher.skill.ts`       | Code Tool, HTTP 请求                          |
| `template-matcher.skill.ts`    | Code Tool, 加权匹配算法                       |
| `page-pipeline.skill.ts`       | Orchestrator, 多 skill 编排                   |
| `page-type-selection.skill.ts` | Orchestrator, 路由逻辑                        |

---

## 15. 与现有设计的关系

### 15.1 与 ai-engine-skills-replace-code.md (v3.0)

该文档描述更宏大的愿景。本方案是其子集的落地：

| 概念                  | 该文档                   | 本方案                                  |
| --------------------- | ------------------------ | --------------------------------------- |
| SkillRuntime          | ✅ 包含                  | PromptSkillAdapter + Bridge             |
| 三种执行模式          | prompt + script + hybrid | **仅 prompt** (code 用 NestJS Provider) |
| WorkflowExecutor      | ✅ 包含                  | 后续迭代                                |
| DynamicSkillGenerator | ✅ 包含                  | 后续迭代                                |

### 15.2 与 ai-tools-skills-integration.md (v1.0)

**互补关系**：

- 该设计: Tools 集成 (AICapabilityResolver + FunctionCallingExecutor)
- 本方案: Skills 统一 (SKILL.md → SkillRegistry)
- 共享: SkillRegistry 和 AIEngineFacade 作为集成点

---

## 16. 时间估算

### 16.1 核心迁移 (Phase 1-5)

| 阶段                                            | 工期       | 关键里程碑                     |
| ----------------------------------------------- | ---------- | ------------------------------ |
| Phase 1: PromptSkillAdapter + Bridge + Resolver | 3 天       | 核心组件可用                   |
| Phase 2: 迁移 15 个 prompt skills               | 3 天       | 所有 prompt skills 有 SKILL.md |
| Phase 3: Companion SKILL.md + 简化模块          | 2 天       | 模块简化, switch/case 消除     |
| Phase 4: 删除旧文件 + 完整验证                  | 1 天       | 15 个旧 .skill.ts 删除         |
| Phase 5: 扩展到 Writing/Insights                | 1 天       | 41+ skills 统一注册            |
| **小计**                                        | **~10 天** | 统一 Runtime 完成              |

### 16.2 生态增强 (Phase 6-9)

| 阶段                                          | 工期        | 关键里程碑                |
| --------------------------------------------- | ----------- | ------------------------- |
| Phase 6: 开发者工具链 + 上传重构 + URL 导入   | 3 天        | 4 条引入路径打通          |
| Phase 7: Progressive Disclosure + 语义发现    | 3 天        | 分级加载 + embedding 匹配 |
| Phase 8: 统一消费路径 + 在线编辑器 + 贡献管线 | 5 天        | 生态双向闭环              |
| Phase 9: 安全沙箱 + 私有 Registry             | 待定        | 企业级安全与治理          |
| **小计**                                      | **~11+ 天** | 竞争力跃升                |

### 16.3 总览

| 范围                   | 总工期  | 竞争力评分 |
| ---------------------- | ------- | ---------- |
| Phase 1-5 (核心迁移)   | ~10 天  | 6.6 / 10   |
| Phase 1-7 (+ 生态基础) | ~16 天  | 7.5 / 10   |
| Phase 1-8 (+ 生态闭环) | ~21 天  | 8.5 / 10   |
| Phase 1-9 (+ 安全治理) | ~21+ 天 | 9.0+ / 10  |

---

## 17. 架构决策记录 (ADR)

### ADR-1: 不建 ScriptSkillAdapter

**决策**：Code 型能力保留 NestJS Provider，不通过 require() 动态加载脚本。

**原因**：

1. require() 绕过 NestJS DI → 手动服务定位器反模式
2. 多租户后端不应执行 SkillsMP 安装的任意代码
3. 确定性计算工具在业界分类中属于 Tool 而非 Skill
4. NestJS Provider 已提供完整的 DI + 类型安全 + 可测试性

**替代方案**：companion SKILL.md 提供元数据和输入绑定声明。

### ADR-2: 声明式输入绑定替代 switch/case

**决策**：在 SKILL.md frontmatter 中声明 inputs 绑定，由 InputBindingResolver 通用解析。

**原因**：

1. SlidesTeamMember.buildSkillInput() 的 87 行 switch/case 是维护负担
2. 新增 skill 必须修改 TypeScript 代码
3. 声明式绑定使新增 skill 只需编写 SKILL.md，无需改代码

### ADR-3: Code-based skill 优先于 SKILL.md adapter

**决策**：当同一 ID 同时存在 NestJS Provider 和 SKILL.md 时，Provider 优先。

**原因**：

1. Provider 有完整的 DI、类型安全和经过测试的执行逻辑
2. SKILL.md adapter 是泛化实现，精度可能不如专用 Provider
3. 迁移期间允许双轨运行，不强制切换

### ADR-4: Progressive Disclosure 分级加载

**决策**：SkillLoaderService 启动时只解析 frontmatter (Level 0)，完整 body 在首次 execute() 时按需加载 (Level 1)。

**原因**：

1. agentskills.io 标准核心创新是 Progressive Disclosure
2. 全量加载 41+ skills 占 ~80K tokens 内存，不可扩展到 100+ skills
3. 大多数 skills 在单次请求中只被调用 1-3 个，全量预加载浪费资源

### ADR-5: 用户上传技能持久化到文件系统

**决策**：Admin 上传的 SKILL.md 同时存入文件系统 (`user-skills/{tenantId}/`) 和数据库 (`SkillConfig`)，不只存数据库。

**原因**：

1. SkillLoaderService 扫描文件系统，不查数据库
2. 文件系统存储保持 SKILL.md 原格式，方便 debug 和导出
3. 数据库存配置 (enabled/priority)，文件存内容，职责分离

### ADR-6: 技能作用域优先级

**决策**：同 ID 技能多来源时，优先级为 code-based > 内置 SKILL.md > 用户上传 > SkillsMP。

**原因**：

1. code-based 有完整 DI 和类型安全，精度最高
2. 内置技能经过 CI 验证，质量可控
3. 用户上传针对特定租户需求，应覆盖通用市场技能
4. SkillsMP 是通用技能，兜底优先级最低

---

_文档状态: Final Draft v3.0 (Reviewed + Competitive Analysis + Eco Enhancement)_
_最后更新: 2026-02-08_
_评审状态: 经过三轮系统性评审，综合业界生态调研，补充竞争力增强路线图_
