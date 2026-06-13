# AI Writing 架构文档

## 概述

AI Writing 是企业级长篇内容创作平台，提供 5-Agent 协作写作系统、Story Bible（世界观一致性）、并行章节写作、质量门禁、风格管理等核心能力。

**核心特性**:

- 5-Agent 写作系统（StoryArchitect Leader + 4 专家 Agents）
- Story Bible 世界观一致性引擎
- 表达冷却机制（Expression Cooldown）防止重复
- 质量门禁（Quality Gate）确保内容质量
- 并行章节写作（Parallel Writing）支持多章同时创作
- 三层风格配置（System/User/Chapter）

**代码路径**: `backend/src/modules/ai-app/writing/`

---

## 核心组件

### 1. 写作 Agent 系统（5-Agent）

基于 `BaseAgent` 实现，使用 AI Teams Mission 机制协作。

#### StoryArchitectAgent（Leader）

- **职责**: 故事架构设计、任务分配、质量把控、一致性监督
- **任务类型**:
  - `plan_story`: 规划整体故事大纲
  - `plan_volume`: 规划单卷结构
  - `decompose_chapters`: 分解章节任务
  - `review_chapter`: 审核章节质量
  - `resolve_conflict`: 解决一致性冲突
- **实现**: `agents/story-architect.agent.ts`

#### BibleKeeperAgent

- **职责**: Story Bible 一致性验证、事实提取、冲突检测
- **实现**: `agents/bible-keeper.agent.ts`

#### WriterAgent

- **职责**: 内容生成，遵循质量约束和风格规范
- **实现**: `agents/writer.agent.ts`

#### ConsistencyCheckerAgent

- **职责**: 写作后一致性验证、事实提取、问题报告
- **实现**: `agents/consistency-checker.agent.ts`

#### EditorAgent

- **职责**: 内容润色、语言优化、风格统一
- **实现**: `agents/editor.agent.ts`

**Agent 注册**: 在 `WritingMissionService` 内部管理，不注册到全局 `AgentRegistry`（与 `IPlanBasedAgent` 接口不同）

---

### 2. 核心服务层

#### 2.1 Mission 编排服务（10+）

| 服务                               | 职责                              | 文件                                                       |
| ---------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `WritingMissionService`            | Mission 编排主服务，集成 AI Teams | `services/mission/writing-mission.service.ts`              |
| `WritingAgentCoordinator`          | Agent 协调和任务分配              | `services/mission/writing-agent-coordinator.service.ts`    |
| `WritingContextService`            | 写作上下文构建                    | `services/mission/writing-context.service.ts`              |
| `WritingStyleService`              | 风格配置管理                      | `services/mission/writing-style.service.ts`                |
| `WritingQualityService`            | 质量检查编排                      | `services/mission/writing-quality.service.ts`              |
| `CheckpointService`                | 写作断点和恢复                    | `services/mission/checkpoint.service.ts`                   |
| `WritingModelManager`              | LLM 模型选择                      | `services/mission/writing-model-manager.service.ts`        |
| `WritingPersistence`               | 数据持久化                        | `services/mission/writing-persistence.service.ts`          |
| `WritingExecutionService`          | 执行流程控制                      | `services/mission/writing-execution.service.ts`            |
| `WritingContentGeneratorService`   | 内容生成                          | `services/mission/writing-content-generator.service.ts`    |
| `WritingMissionHealthCheckService` | Mission 健康检查                  | `services/mission/writing-mission-health-check.service.ts` |

#### 2.2 写作核心服务（6）

| 服务                       | 职责               | 文件                                             |
| -------------------------- | ------------------ | ------------------------------------------------ |
| `ProjectService`           | 项目生命周期管理   | `services/writing/project.service.ts`            |
| `ChapterWritingService`    | 章节写作           | `services/writing/chapter-writing.service.ts`    |
| `ChapterRevisionService`   | 章节修订和版本管理 | `services/writing/chapter-revision.service.ts`   |
| `ChapterAnnotationService` | 章节批注           | `services/writing/chapter-annotation.service.ts` |
| `ChapterImportService`     | 章节导入           | `services/writing/chapter-import.service.ts`     |
| `OutlineService`           | 故事大纲生成       | `services/writing/outline.service.ts`            |
| `ContextBuilderService`    | 写作上下文构建     | `services/writing/context-builder.service.ts`    |

#### 2.3 DOME/SCORE 增强服务 (v4 新增)

| 服务                         | 职责                     | 文件                                                         |
| ---------------------------- | ------------------------ | ------------------------------------------------------------ |
| `HierarchicalSummaryService` | 分层摘要（DOME 核心）    | `services/writing/hierarchical-summary.service.ts`           |
| `DynamicOutlineService`      | 动态大纲调整（DOME）     | `services/writing/dynamic-outline.service.ts`                |
| `SharedScratchpadService`    | Agent 共享草稿板（DOME） | `services/mission/shared-scratchpad.service.ts`              |
| `TemporalConflictAnalyzer`   | 时序冲突分析（SCORE）    | `services/consistency/temporal-conflict-analyzer.service.ts` |

**DOME (Dynamic Outline Management Engine)**:

- 支持写作过程中动态调整大纲
- 分层摘要确保长篇一致性
- Agent 间共享上下文草稿板

**SCORE (Semantic Coherence Review Engine)**:

- 时序冲突自动检测
- 语义一致性评估
- 跨章节连贯性验证

#### 2.3 Story Bible 服务（5+）

| 服务                           | 职责                              | 文件                                                |
| ------------------------------ | --------------------------------- | --------------------------------------------------- |
| `StoryBibleService`            | Story Bible 主服务                | `services/bible/story-bible.service.ts`             |
| `CharacterService`             | 角色管理                          | `services/bible/character.service.ts`               |
| `WorldSettingService`          | 世界观设定                        | `services/bible/world-setting.service.ts`           |
| `TimelineService`              | 时间线管理                        | `services/bible/timeline.service.ts`                |
| `TerminologyService`           | 术语管理                          | `services/bible/terminology.service.ts`             |
| `WorldBuildingEnhancerService` | 世界观知识库增强（历史/文化知识） | `services/bible/world-building-enhancer.service.ts` |
| `StoryBibleAuditService`       | Story Bible 审计                  | `services/bible/story-bible-audit.service.ts`       |

---

### 3. 质量控制服务（15+）

AI Writing Quality Enhancement System，确保内容质量。

#### 3.1 核心质量服务

| 服务                             | 职责                   | 文件                                                    |
| -------------------------------- | ---------------------- | ------------------------------------------------------- |
| `QualityGateService`             | 质量门禁，决定是否重写 | `services/quality/quality-gate.service.ts`              |
| `ExpressionMemoryService`        | 表达记忆和冷却机制     | `services/quality/expression-memory.service.ts`         |
| `ExpressionAlternativesService`  | 表达替代建议           | `services/quality/expression-alternatives.service.ts`   |
| `ChapterQualityEvaluatorService` | 章节质量评估           | `services/quality/chapter-quality-evaluator.service.ts` |
| `WritingQualityCheckerService`   | 写作质量检查器         | `services/quality/writing-quality-checker.service.ts`   |
| `OutputValidatorService`         | 输出验证               | `services/quality/output-validator.service.ts`          |

#### 3.2 一致性服务

| 服务                          | 职责           | 文件                                                |
| ----------------------------- | -------------- | --------------------------------------------------- |
| `CharacterPersonalityService` | 角色性格一致性 | `services/quality/character-personality.service.ts` |
| `CharacterConsistencyService` | 角色行为一致性 | `services/quality/character-consistency.service.ts` |
| `SemanticConsistencyService`  | 语义一致性     | `services/quality/semantic-consistency.service.ts`  |
| `DialogueConstraintsService`  | 对话约束       | `services/quality/dialogue-constraints.service.ts`  |
| `HistoricalKnowledgeService`  | 历史知识验证   | `services/quality/historical-knowledge.service.ts`  |

#### 3.3 叙事质量服务

| 服务                       | 职责         | 文件                                             |
| -------------------------- | ------------ | ------------------------------------------------ |
| `NarrativePacingService`   | 叙事节奏控制 | `services/quality/narrative-pacing.service.ts`   |
| `NarrativeCraftService`    | 叙事技巧     | `services/quality/narrative-craft.service.ts`    |
| `ProfessionalVoiceService` | 专业语调     | `services/quality/professional-voice.service.ts` |
| `SensoryImmersionService`  | 感官沉浸     | `services/quality/sensory-immersion.service.ts`  |
| `OpeningHookService`       | 开篇吸引力   | `services/quality/opening-hook.service.ts`       |
| `ForeshadowingService`     | 伏笔铺垫     | `services/quality/foreshadowing.service.ts`      |
| `PacingControlService`     | 节奏控制     | `services/quality/pacing-control.service.ts`     |

---

### 4. 一致性引擎

确保 Story Bible 和内容一致性。

| 服务                         | 职责             | 文件                                                    |
| ---------------------------- | ---------------- | ------------------------------------------------------- |
| `ConsistencyEngineService`   | 一致性引擎主服务 | `services/consistency/consistency-engine.service.ts`    |
| `PreWriteInjectionService`   | 写作前约束注入   | `services/consistency/pre-write-injection.service.ts`   |
| `PostWriteValidationService` | 写作后验证       | `services/consistency/post-write-validation.service.ts` |
| `ConflictResolutionService`  | 冲突解决         | `services/consistency/conflict-resolution.service.ts`   |
| `FactExtractorService`       | 事实提取         | `services/consistency/fact-extractor.service.ts`        |
| `ChapterCoherenceService`    | 章节连贯性       | `services/consistency/chapter-coherence.service.ts`     |

---

### 5. 并行写作服务

支持多章节同时创作。

| 服务                              | 职责              | 文件                                                      |
| --------------------------------- | ----------------- | --------------------------------------------------------- |
| `ParallelOrchestratorService`     | 并行写作编排      | `services/parallel/parallel-orchestrator.service.ts`      |
| `ChapterDependencyService`        | 章节依赖分析      | `services/parallel/chapter-dependency.service.ts`         |
| `EnhancedDependencyService`       | 增强依赖分析      | `services/parallel/enhanced-dependency.service.ts`        |
| `WriterPoolService`               | Writer 实例池管理 | `services/parallel/writer-pool.service.ts`                |
| `ParallelConflictDetectorService` | 并行冲突检测      | `services/parallel/parallel-conflict-detector.service.ts` |

---

### 6. 风格管理服务

三层风格配置：System（预设）→ User（用户偏好）→ Chapter（章节覆盖）。

| 服务                   | 职责         | 文件                                       |
| ---------------------- | ------------ | ------------------------------------------ |
| `StyleTemplateService` | 风格模板管理 | `services/style/style-template.service.ts` |

**预设风格**: `constants/writing-style-presets.ts`

---

### 7. 辅助服务

| 服务                         | 职责               | 文件                                               |
| ---------------------------- | ------------------ | -------------------------------------------------- |
| `WritingEventEmitterService` | WebSocket 实时事件 | `services/events/writing-event-emitter.service.ts` |
| `WritingRepository`          | 数据访问层         | `writing.repository.ts`                            |

---

## 关键流程

### 1. 章节写作流程

```
用户创建章节
  ↓
ChapterWritingService.startWriting()
  ↓
WritingMissionService.executeChapterWriting()
  ↓
【Mission 编排】
  1. StoryArchitect 规划章节结构
  2. BibleKeeper 加载 Story Bible 上下文
  3. PreWriteInjectionService 注入质量约束
     - ExpressionMemoryService 提供禁用表达列表
     - CharacterPersonalityService 注入角色性格约束
     - HistoricalKnowledgeService 注入历史知识约束
  ↓
【内容生成】
  4. WriterAgent 生成内容（遵循约束）
  ↓
【后验证】
  5. ConsistencyCheckerAgent 验证一致性
     - PostWriteValidationService 语义验证
     - CharacterConsistencyService 角色一致性验证
     - NarrativePacingService 节奏检查
  6. FactExtractorService 提取新事实
  ↓
【质量门禁】
  7. QualityGateService 执行质量门禁
     - diversityScore < 0.45? → 重写
     - characterConsistency < 0.7? → 重写
     - 最多重写 3 次
  ↓
【润色】
  8. EditorAgent 润色内容
  ↓
【持久化】
  9. 保存章节内容
  10. StoryBibleService 更新 Story Bible
  11. ExpressionMemoryService 记录已用表达
```

---

### 2. 质量控制流程

#### 写作前（Pre-Write Injection）

```
PreWriteInjectionService 注入约束
  ↓
1. ExpressionMemoryService 计算冷却期
   - 高频表达（使用 > 3 次）: 30 章冷却
   - 中频表达（使用 1-3 次）: 15 章冷却
   - 低频表达（使用 1 次）: 5 章冷却
   - 章节开场模式: 25 章冷却
   - 场景结构模式: 20 章冷却
  ↓
2. CharacterPersonalityService 注入角色性格
   - 语言风格（speechStyle）
   - 常用词汇（commonPhrases）
   - 禁用词汇（forbiddenPhrases）
   - 行为模式（thinkingStyle, emotionPattern）
  ↓
3. HistoricalKnowledgeService 注入历史知识
   - 朝代时间线
   - 官职制度
   - 货币单位
   - 文化习俗
  ↓
生成约束 Prompt → 传递给 WriterAgent
```

#### 写作中（During Writing）

```
WriterAgent 遵循约束生成内容
  - 避免使用冷却期内表达
  - 遵循角色性格设定
  - 符合历史背景知识
```

#### 写作后（Post-Write Validation）

```
PostWriteValidationService 验证
  ↓
1. SemanticConsistencyService 语义一致性
   - 提取语义事实（人物、地点、事件）
   - 与 Story Bible 对比
   - 检测矛盾
  ↓
2. CharacterConsistencyService 角色一致性
   - 对话风格是否符合性格
   - 行为模式是否一致
  ↓
3. NarrativePacingService 节奏检查
   - 叙事密度
   - 信息量平衡
  ↓
生成验证报告
  - issues: 问题列表
  - suggestions: 修改建议
  ↓
如果发现问题 → 返回 WriterAgent 重写
```

---

### 3. 表达冷却机制

防止表达重复使用，提升内容多样性。

#### 冷却规则

| 表达类型     | 使用频率 | 冷却章节数 |
| ------------ | -------- | ---------- |
| 成语         | -        | 15         |
| 情感表达     | -        | 8          |
| 过渡语       | -        | 5          |
| 高频表达     | > 3 次   | 30         |
| 中频表达     | 1-3 次   | 15         |
| 低频表达     | 1 次     | 5          |
| 章节开场模式 | -        | 25         |
| 场景结构模式 | -        | 20         |
| 叙事节奏模式 | -        | 15         |

#### 流程

```
【提取表达】
ExpressionMemoryService.extractExpressions(content)
  - 成语识别
  - 比喻提取
  - 情感表达提取
  - 结构模式识别
  ↓
【计算冷却】
ExpressionMemoryService.getCooldownExpressions(projectId, chapterNumber)
  - 查询历史使用记录
  - 计算冷却期（当前章节 - 上次使用章节 < 冷却期）
  - 返回禁用表达列表
  ↓
【注入约束】
PreWriteInjectionService 将禁用表达列表添加到 Prompt
  ↓
【后验证】
PostWriteValidationService 检测是否违反冷却期
  - 如违反 → 提供替代建议（来自 ExpressionAlternativesService）
  - 严重违反 → 触发重写
  ↓
【记录使用】
保存章节后，ExpressionMemoryService 记录新使用的表达
```

**替代建议示例** (`ExpressionAlternativesService`):

```typescript
// 违反: "心中一震"
// 替代: ["胸口一窒", "呼吸微滞", "手指不自觉攥紧", "瞳孔微缩"]
```

---

### 4. 并行写作流程

支持多个章节同时创作，避免串行等待。

```
用户发起并行写作
  ↓
ParallelOrchestratorService.orchestrateParallelWriting(volumeId)
  ↓
1. ChapterDependencyService 分析依赖
   - 章节 1: 无依赖 → 可立即写作
   - 章节 2: 依赖章节 1 → 等待
   - 章节 3: 无依赖 → 可立即写作
  ↓
2. 生成执行计划
   - 波次 1: [章节 1, 章节 3]
   - 波次 2: [章节 2]
  ↓
3. WriterPoolService 分配 Writer 实例
   - 最大并行数: maxParallelWriters（默认 3）
   - 实例 1 → 章节 1
   - 实例 2 → 章节 3
  ↓
4. 并行执行写作 Mission
   - 每个章节独立运行 WritingMissionService
   - StoryBible 快照隔离（避免冲突）
  ↓
5. ParallelConflictDetectorService 检测冲突
   - 章节 1 引入新角色 "张三"
   - 章节 3 也引入 "张三"（不同描述）
   - 检测到冲突 → 触发合并策略
  ↓
6. ConflictResolutionService 解决冲突
   - 策略 1: 合并角色描述
   - 策略 2: 重命名章节 3 的 "张三" 为 "李四"
   - 策略 3: 触发 StoryArchitect 裁决
  ↓
7. 更新 Story Bible
   - 合并所有章节的事实提取结果
   - 更新全局 Story Bible
```

---

## 数据模型

### WritingProject（项目）

```typescript
{
  id: string
  name: string
  description?: string
  genre: string // 玄幻、都市、历史、科幻
  targetWords: number // 目标字数
  currentWords: number // 当前字数
  status: WritingProjectStatus // PLANNING, WRITING, REVISING, COMPLETED
  visibility: ContentVisibility // PRIVATE, PUBLIC

  // 写作配置
  writingStyle?: string
  targetAudience?: string
  pov?: string // 视角
  tense?: string // 时态

  // 并行写作
  maxParallelWriters: number // 默认 3

  // 关系
  storyBible: StoryBible
  volumes: WritingVolume[]
  missions: WritingMission[]
  expressionMemories: WritingExpressionMemory[]
}
```

**数据库**: `Prisma schema → WritingProject model`

---

### WritingChapter（章节）

```typescript
{
  id: string
  volumeId: string
  chapterNumber: number
  title: string
  outline?: string // 章节大纲
  content?: string // 正文内容
  wordCount: number
  status: ChapterStatus // PLANNED, WRITING, WRITTEN, REVISED, PUBLISHED

  // 并行写作
  dependsOn: string[] // 依赖的章节 ID 列表

  // 元数据
  metadata: Json // { extractedFacts, qualityScore }
  writtenAt?: DateTime
  revisedAt?: DateTime

  // 关系
  scenes: WritingScene[]
  consistencyChecks: ConsistencyCheck[]
  revisions: ChapterRevision[]
  annotations: ChapterAnnotation[]
}
```

---

### WritingCharacter（角色）

```typescript
{
  id: string
  bibleId: string
  name: string
  aliases: string[] // 别名
  role: CharacterRole // PROTAGONIST, MAIN, SUPPORTING, ANTAGONIST

  // 静态属性
  appearance: Json // 外貌（结构化）
  personality: Json // 性格（结构化）
  background?: string
  abilities: string[]

  // 动态状态
  currentState: Json // 当前状态快照
  stateTimeline: Json[] // 状态变化时间线

  // 关系
  relationships: CharacterRelationship[]
  personalityProfile: WritingCharacterPersonality
}
```

---

### WritingCharacterPersonality（角色性格）

```typescript
{
  id: string
  characterId: string

  // 语言风格
  speechStyle: string // "直爽豪迈"
  commonPhrases: string[] // ["老子", "痛快"]
  forbiddenPhrases: string[] // ["小生", "在下"]
  sentencePattern?: string // "短句为主"

  // 行为模式
  thinkingStyle?: string // "冲动型"
  emotionPattern?: string // "外向直接"
  decisionStyle?: string // "果断快速"
  conflictBehavior?: string // "直接对抗"

  // 社交特征
  interactionStyle?: string
  trustLevel: number // 1-10
  assertiveness: number // 1-10

  // 特殊标记
  uniqueMannerisms: string[] // ["摸鼻子", "挠头"]
  voiceTone?: string // "洪亮有力"
}
```

---

### StoryBible（故事圣经）

```typescript
{
  id: string
  projectId: string

  // 核心设定
  worldView: Json // 世界观
  powerSystem?: Json // 力量体系
  timeline: Json // 时间线

  // 关系
  characters: WritingCharacter[]
  worldSettings: WorldSetting[]
  timelines: TimelineEvent[]
  terminologies: Terminology[]
}
```

---

### WritingExpressionMemory（表达记忆）

```typescript
{
  id: string
  projectId: string
  chapterId: string
  chapterNumber: number

  expression: string // "心中一震"
  expressionType: ExpressionType // IDIOM, METAPHOR, EMOTION, ...
  context?: string // 使用上下文

  frequency: number // 使用频率
  lastUsedChapter: number // 上次使用章节号

  createdAt: DateTime
}
```

**ExpressionType**:

- `IDIOM`: 成语
- `METAPHOR`: 比喻
- `DESCRIPTION`: 描写手法
- `EMOTION`: 情感表达
- `ACTION`: 动作表达
- `DIALOGUE`: 对话模式
- `TRANSITION`: 过渡语
- `PLOT_PATTERN`: 情节模式
- `CHAPTER_OPENING`: 章节开场模式
- `SCENE_STRUCTURE`: 场景结构模式
- `NARRATIVE_PACING`: 叙事节奏模式

---

### StyleTemplate（风格模板）

```typescript
{
  id: string
  name: string
  description?: string
  type: StyleTemplateType // SYSTEM, USER, CHAPTER

  // 风格配置
  genre?: string
  tone?: string // 轻松、严肃、幽默
  pacing?: string // 快节奏、慢热
  detailLevel?: string // 简洁、详尽

  // Prompt 模板
  systemPrompt?: string
  writingGuidelines?: string

  // 继承
  parentId?: string // 继承自哪个模板
  overrides: Json // 覆盖的配置
}
```

**三层配置**:

1. **System**: 预设风格（玄幻、都市、历史等）
2. **User**: 用户偏好（从预设继承并修改）
3. **Chapter**: 章节覆盖（特殊章节调整）

---

## 文件结构

```
writing/
├── ai-writing.module.ts                  # 模块定义（40+ services）
├── ai-writing.service.ts                 # 主服务
├── ai-writing.controller.ts              # REST API
├── ai-writing.gateway.ts                 # WebSocket Gateway
├── writing.repository.ts                 # 数据访问层
│
├── agents/                               # 5 个 Agents
│   ├── index.ts
│   ├── story-architect.agent.ts          # Leader
│   ├── bible-keeper.agent.ts             # Story Bible 验证
│   ├── writer.agent.ts                   # 内容生成
│   ├── consistency-checker.agent.ts      # 一致性检查
│   └── editor.agent.ts                   # 润色
│
├── services/
│   ├── writing/                          # 核心写作服务（7）
│   │   ├── project.service.ts
│   │   ├── chapter-writing.service.ts
│   │   ├── chapter-revision.service.ts
│   │   ├── chapter-annotation.service.ts
│   │   ├── chapter-import.service.ts
│   │   ├── outline.service.ts
│   │   └── context-builder.service.ts
│   │
│   ├── bible/                            # Story Bible 服务（6+）
│   │   ├── story-bible.service.ts
│   │   ├── character.service.ts
│   │   ├── world-setting.service.ts
│   │   ├── timeline.service.ts
│   │   ├── terminology.service.ts
│   │   ├── world-building-enhancer.service.ts
│   │   ├── story-bible-audit.service.ts
│   │   └── knowledge-base/
│   │       ├── index.ts
│   │       └── chinese-history.knowledge.ts
│   │
│   ├── quality/                          # 质量控制服务（18）
│   │   ├── index.ts
│   │   ├── quality-gate.service.ts       # 质量门禁
│   │   ├── expression-memory.service.ts  # 表达冷却
│   │   ├── expression-alternatives.service.ts
│   │   ├── character-personality.service.ts
│   │   ├── character-consistency.service.ts
│   │   ├── semantic-consistency.service.ts
│   │   ├── dialogue-constraints.service.ts
│   │   ├── historical-knowledge.service.ts
│   │   ├── narrative-pacing.service.ts
│   │   ├── narrative-craft.service.ts
│   │   ├── professional-voice.service.ts
│   │   ├── sensory-immersion.service.ts
│   │   ├── opening-hook.service.ts
│   │   ├── foreshadowing.service.ts
│   │   ├── pacing-control.service.ts
│   │   ├── chapter-quality-evaluator.service.ts
│   │   ├── writing-quality-checker.service.ts
│   │   └── output-validator.service.ts
│   │
│   ├── consistency/                      # 一致性引擎（6）
│   │   ├── consistency-engine.service.ts
│   │   ├── pre-write-injection.service.ts
│   │   ├── post-write-validation.service.ts
│   │   ├── conflict-resolution.service.ts
│   │   ├── fact-extractor.service.ts
│   │   └── chapter-coherence.service.ts
│   │
│   ├── parallel/                         # 并行写作（5）
│   │   ├── index.ts
│   │   ├── parallel-orchestrator.service.ts
│   │   ├── chapter-dependency.service.ts
│   │   ├── enhanced-dependency.service.ts
│   │   ├── writer-pool.service.ts
│   │   └── parallel-conflict-detector.service.ts
│   │
│   ├── mission/                          # Mission 编排（11）
│   │   ├── index.ts
│   │   ├── writing-mission.service.ts
│   │   ├── writing-mission-health-check.service.ts
│   │   ├── writing-agent-coordinator.service.ts
│   │   ├── writing-context.service.ts
│   │   ├── writing-style.service.ts
│   │   ├── writing-quality.service.ts
│   │   ├── checkpoint.service.ts
│   │   ├── writing-model-manager.service.ts
│   │   ├── writing-persistence.service.ts
│   │   ├── writing-execution.service.ts
│   │   └── writing-content-generator.service.ts
│   │
│   ├── style/                            # 风格管理（1）
│   │   └── style-template.service.ts
│   │
│   └── events/                           # 事件系统（1）
│       └── writing-event-emitter.service.ts
│
├── dto/                                  # 数据传输对象
│   ├── index.ts
│   ├── project.dto.ts
│   ├── volume.dto.ts
│   ├── chapter.dto.ts
│   ├── chapter-annotation.dto.ts
│   ├── chapter-import.dto.ts
│   ├── chapter-revision.dto.ts
│   └── character.dto.ts
│
├── constants/                            # 常量配置
│   ├── index.ts
│   ├── agent-config.ts                   # Agent 配置
│   └── writing-style-presets.ts          # 风格预设
│
├── interfaces/                           # 接口定义
│   └── writing-context.interface.ts
│
├── registry/                             # Agent 注册表
│   ├── index.ts
│   └── writing-agent-registry.ts
│
└── assets/                               # 资源文件
    └── historical-knowledge/             # 历史知识库
        ├── index.ts
        └── types.ts
```

**服务统计**:

- **总服务数**: 60+
- **5 Agents**: Story Architect, Bible Keeper, Writer, Consistency Checker, Editor
- **写作服务**: 7 个
- **Story Bible 服务**: 6+ 个
- **质量控制服务**: 18 个
- **一致性服务**: 6 个
- **并行写作服务**: 5 个
- **Mission 编排服务**: 11 个
- **辅助服务**: 3 个（风格、事件、仓库）

---

## 技术依赖

### 核心依赖

| 依赖                   | 用途              | 路径                             |
| ---------------------- | ----------------- | -------------------------------- |
| `AiEngineModule`       | AI 引擎基础能力   | `modules/ai-engine`              |
| `LongContentModule`    | 长篇内容处理      | `modules/ai-engine/long-content` |
| `PrismaModule`         | 数据库访问        | `common/prisma`                  |
| `CreditsModule`        | Credits 计费      | `modules/credits`                |
| `AICapabilityResolver` | Skills/Tools 集成 | `modules/ai-engine/capabilities` |

### AI Engine 核心类

| 类                         | 用途           | 来源                           |
| -------------------------- | -------------- | ------------------------------ |
| `BaseAgent`                | Agent 基类     | `ai-engine/agents/base`        |
| `MissionOrchestrator`      | Mission 编排器 | `ai-engine/teams/orchestrator` |
| `TeamFactory`              | Team 工厂      | `ai-engine/teams/factory`      |
| `AIEngineFacade`           | AI 引擎门面    | `ai-engine/facade`             |
| `LongContentEngineService` | 长内容引擎     | `ai-engine/long-content`       |

### LLM 调用

**必须使用** `AiChatService.chat()` + `TaskProfile`:

```typescript
const response = await this.aiChatService.chat({
  messages: [{ role: "system", content: prompt }],
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "medium", // deterministic, low, medium, high
    outputLength: "long", // minimal, short, medium, long
  },
});
```

**禁止**: 硬编码 `model: "gpt-4o"` 或 `temperature: 0.7`

---

## 配置和常量

### Agent 配置

**文件**: `constants/agent-config.ts`

```typescript
export const WRITING_AGENT_CONFIG = {
  storyArchitect: {
    name: "StoryArchitect",
    role: "LEADER",
    capabilities: ["planning", "coordination", "review"],
    modelType: AIModelType.REASONING,
  },
  // ... 其他 Agents
};
```

### 风格预设

**文件**: `constants/writing-style-presets.ts`

```typescript
export const WRITING_STYLE_PRESETS = {
  玄幻: {
    tone: "恢弘大气",
    pacing: "快节奏",
    detailLevel: "详尽",
    guidelines: "注重境界突破、战斗描写...",
  },
  都市: {
    tone: "轻松现代",
    pacing: "中等",
    detailLevel: "适中",
    guidelines: "贴近现实、情感细腻...",
  },
  // ...
};
```

### 表达替代库

**文件**: `services/quality/expression-memory.service.ts`

```typescript
const EXPRESSION_ALTERNATIVES: Record<string, string[]> = {
  心中一震: ["胸口一窒", "呼吸微滞", "手指不自觉攥紧"],
  微微一笑: ["唇角微扬", "眼尾弯出细纹", "嘴角轻轻一勾"],
  // ... 100+ 表达替代
};
```

---

## WebSocket 实时通信

### Gateway

**文件**: `ai-writing.gateway.ts`

```typescript
@WebSocketGateway({ namespace: "/ai-writing" })
export class AiWritingGateway {
  @SubscribeMessage("writing:start")
  async handleStart(client: Socket, data: any) {
    // 开始写作
  }

  // 实时推送写作进度
  emitProgress(userId: string, data: WritingProgress) {
    this.server.to(userId).emit("writing:progress", data);
  }
}
```

### 事件类型

| 事件                | 方向            | 数据                            |
| ------------------- | --------------- | ------------------------------- |
| `writing:start`     | Client → Server | `{ chapterId }`                 |
| `writing:progress`  | Server → Client | `{ step, percentage, message }` |
| `writing:completed` | Server → Client | `{ chapterId, content }`        |
| `writing:error`     | Server → Client | `{ error }`                     |

---

## 性能优化

### 1. 并行写作

- **最大并行数**: `maxParallelWriters`（默认 3，最大 5）
- **Story Bible 快照隔离**: 每个章节使用独立快照，避免竞态条件
- **依赖分析**: 自动识别章节依赖，生成执行波次

### 2. 质量门禁优化

- **硬性门禁**: 必须通过（diversity, character consistency）
- **软性门禁**: 警告但允许（plot novelty, narrative flow）
- **最大重写次数**: 3 次，避免无限循环

### 3. 缓存策略

- **Story Bible 缓存**: 频繁访问的 Story Bible 数据缓存
- **表达记忆缓存**: 冷却期表达列表缓存（按章节号）
- **风格模板缓存**: 系统预设模板一次加载

---

## 扩展点

### 1. 新增 Agent

```typescript
// 1. 创建 Agent 类
class MyAgent extends BaseAgent {
  async execute(input: MyInput): Promise<MyOutput> {
    // 实现逻辑
  }
}

// 2. 注册到 ai-writing.module.ts
providers: [
  // ...
  MyAgent,
]

// 3. 在 WritingMissionService 中使用
this.myAgent.execute({ ... });
```

### 2. 新增质量检查服务

```typescript
// 1. 创建服务
@Injectable()
export class MyQualityService {
  async check(content: string): Promise<QualityResult> {
    // 实现检查逻辑
  }
}

// 2. 注入到 QualityGateService
constructor(
  private readonly myQuality: MyQualityService,
) {}

// 3. 在质量门禁中调用
const result = await this.myQuality.check(content);
```

### 3. 新增 Story Bible 类型

```typescript
// 1. 更新 Prisma Schema
model MyBibleEntry {
  id      String     @id @default(uuid())
  bibleId String     @map("bible_id")
  bible   StoryBible @relation(fields: [bibleId], references: [id])

  // 自定义字段
  myField String
}

// 2. 创建服务
@Injectable()
export class MyBibleService {
  async create(bibleId: string, data: any) {
    return this.prisma.myBibleEntry.create({ ... });
  }
}

// 3. 注册到模块
providers: [
  // ...
  MyBibleService,
]
```

---

## 测试

### 单元测试

```bash
npm run test backend/src/modules/ai-app/writing
```

**关键测试文件**:

- `services/mission/checkpoint.service.spec.ts`
- `services/parallel/enhanced-dependency.service.spec.ts`

### 集成测试

**测试场景**:

1. 完整章节写作流程
2. 表达冷却机制验证
3. 并行写作冲突检测
4. 质量门禁触发重写

---

## 常见问题

### 1. 表达冷却不生效？

**检查**:

- `ExpressionMemoryService` 是否正确提取表达
- `PreWriteInjectionService` 是否注入约束
- WriterAgent Prompt 是否包含禁用表达列表

### 2. 质量门禁总是通过？

**检查**:

- `QualityGateConfig` 阈值是否过低
- `QualityGateService.evaluateQuality()` 是否正确计算分数

### 3. 并行写作冲突？

**检查**:

- `ChapterDependencyService` 依赖分析是否正确
- `ParallelConflictDetectorService` 是否启用
- Story Bible 快照是否隔离

### 4. Agent 协作失败？

**检查**:

- `WritingAgentCoordinator` 是否正确分配任务
- Agent 输入输出类型是否匹配
- Mission 日志（`WritingMission.logs`）查看详细错误

---

## 参考文档

### 项目文档

- **AI 架构分层**: `skills/ai/ai-architecture-layering/SKILL.md`
- **AI 调用规范**: `docs/guides/ai-calling-standards.md`
- **代码规范**: `standards/04-code-style.md`

### 外部资源

- **NestJS 文档**: https://docs.nestjs.com
- **Prisma 文档**: https://www.prisma.io/docs
- **LiteLLM 文档**: https://docs.litellm.ai

---

**最后更新**: 2026-02-05
**维护者**: AI Writing Team
**版本**: v2.1 (DOME/SCORE)
