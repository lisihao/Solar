# AI Writing 模块架构文档

> 最后更新: 2025-01-07
>
> AI Writing 是 GenesisPod 的长篇内容创作模块，支持多 Agent 协作写作、Story Bible 一致性管理、并行写作编排等高级功能。

---

## 目录

- [1. 整体架构概览](#1-整体架构概览)
- [2. 后端服务架构](#2-后端服务架构)
- [3. 数据模型关系](#3-数据模型关系)
- [4. 写作任务执行流程](#4-写作任务执行流程)
- [5. 并行写作编排](#5-并行写作编排)
- [6. 一致性检查框架](#6-一致性检查框架)
- [7. 模块依赖关系](#7-模块依赖关系)
- [8. API 端点概览](#8-api-端点概览)
- [9. 核心设计特点](#9-核心设计特点)
- [10. 文件目录结构](#10-文件目录结构)

---

## 1. 整体架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend Layer                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  /ai-writing/           /ai-writing/[id]/         /ai-writing/new/          │
│  (项目列表)              (项目详情)                (创建项目)                 │
│       ↓                      ↓                         ↓                    │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  frontend/lib/api/ai-writing.ts                                  │       │
│  │  - getProjects/createProject/updateProject/deleteProject         │       │
│  │  - startMission/getMissionStatus/cancelMission                   │       │
│  │  - getStoryBible/updateStoryBible/getCharacters                  │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ HTTP /api/v1/ai-writing/*
┌────────────────────────────────────▼────────────────────────────────────────┐
│                              Backend Layer                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │                    AiWritingController                              │     │
│  │    /projects, /characters, /volumes, /chapters, /missions          │     │
│  └─────────────────────────────────┬──────────────────────────────────┘     │
│                                    │                                         │
│  ┌─────────────────────────────────▼──────────────────────────────────┐     │
│  │                      AiWritingService                               │     │
│  │              (核心服务 - 协调各子服务)                                │     │
│  └─────────────────────────────────┬──────────────────────────────────┘     │
│                                    │                                         │
│  ┌─────────────────────────────────▼──────────────────────────────────┐     │
│  │                   WritingMissionService                             │     │
│  │          (任务编排核心 - 集成 AI Teams + LongContentEngine)          │     │
│  └─────────────────────────────────┬──────────────────────────────────┘     │
│                                    │                                         │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                           AI Engine Layer                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  AiEngineModule    │    TeamsModule    │    LongContentModule               │
│  (LLM 调用)        │   (多Agent协作)    │    (长内容生成)                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 后端服务架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ai-writing/ (34个TypeScript文件)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────── AGENTS ───────────────────────────┐           │
│  │                                                               │           │
│  │  ┌─────────────────┐    指挥调度                              │           │
│  │  │ StoryArchitect  │◄──────────┐                             │           │
│  │  │    (Leader)     │           │                             │           │
│  │  └────────┬────────┘           │                             │           │
│  │           │ 分配任务            │                             │           │
│  │  ┌────────▼────────────────────┴─────────────────────┐       │           │
│  │  │                                                    │       │           │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │       │           │
│  │  │  │  Writer  │  │  Bible   │  │Consistency│        │       │           │
│  │  │  │ (支持并行) │  │  Keeper  │  │  Checker │        │       │           │
│  │  │  └────┬─────┘  └────┬─────┘  └────┬─────┘        │       │           │
│  │  │       │              │              │              │       │           │
│  │  │       └──────────────┴──────────────┘              │       │           │
│  │  │                      │                             │       │           │
│  │  │              ┌───────▼───────┐                     │       │           │
│  │  │              │    Editor     │                     │       │           │
│  │  │              │   (润色精修)   │                     │       │           │
│  │  │              └───────────────┘                     │       │           │
│  │  └────────────────────────────────────────────────────┘       │           │
│  └───────────────────────────────────────────────────────────────┘           │
│                                                                              │
│  ┌─────────────────────── SERVICES ─────────────────────────────┐           │
│  │                                                               │           │
│  │  ┌── bible/ ──────────┐   ┌── writing/ ───────────┐          │           │
│  │  │ StoryBibleService  │   │ ProjectService        │          │           │
│  │  │ CharacterService   │   │ ChapterWritingService │          │           │
│  │  │ WorldSettingService│   │ ContextBuilderService │          │           │
│  │  │ TimelineService    │   │ OutlineService        │          │           │
│  │  │ TerminologyService │   └───────────────────────┘          │           │
│  │  └────────────────────┘                                       │           │
│  │                                                               │           │
│  │  ┌── consistency/ ────────────┐   ┌── parallel/ ──────────┐  │           │
│  │  │ ConsistencyEngineService   │   │ ParallelOrchestrator  │  │           │
│  │  │ PreWriteInjectionService   │   │ ChapterDependency     │  │           │
│  │  │ PostWriteValidationService │   │ WriterPoolService     │  │           │
│  │  │ ConflictResolutionService  │   │ ParallelConflictDet.  │  │           │
│  │  └────────────────────────────┘   └───────────────────────┘  │           │
│  │                                                               │           │
│  │  ┌── mission/ ────────────────┐                               │           │
│  │  │ WritingMissionService      │ ← 核心编排服务                 │           │
│  │  └────────────────────────────┘                               │           │
│  └───────────────────────────────────────────────────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Agent 职责说明

| Agent                  | 角色   | 职责                               |
| ---------------------- | ------ | ---------------------------------- |
| **StoryArchitect**     | Leader | 任务分解、调度协调、整体质量把控   |
| **Writer**             | Worker | 内容创作，支持多实例并行写作       |
| **BibleKeeper**        | Worker | 维护 Story Bible，提取已确立的事实 |
| **ConsistencyChecker** | Worker | 验证内容与 Story Bible 的一致性    |
| **Editor**             | Worker | 润色精修，提升文字质量             |

### 2.2 Service 职责说明

| 服务目录         | 服务                            | 职责                 |
| ---------------- | ------------------------------- | -------------------- |
| **bible/**       | StoryBibleService               | Story Bible 核心管理 |
|                  | CharacterService                | 角色定义与状态追踪   |
|                  | WorldSettingService             | 世界观规则管理       |
|                  | TimelineService                 | 时间线事件管理       |
|                  | TerminologyService              | 术语表管理           |
| **writing/**     | ProjectService                  | 项目 CRUD            |
|                  | ChapterWritingService           | 章节写作操作         |
|                  | ContextBuilderService           | LLM 上下文构建       |
|                  | OutlineService                  | 大纲生成             |
| **consistency/** | ConsistencyEngineService        | 一致性检查主引擎     |
|                  | PreWriteInjectionService        | 写前上下文注入       |
|                  | PostWriteValidationService      | 写后内容验证         |
|                  | ConflictResolutionService       | 冲突解决             |
| **parallel/**    | ParallelOrchestratorService     | 并行写作编排         |
|                  | ChapterDependencyService        | 章节依赖分析         |
|                  | WriterPoolService               | Writer 实例池管理    |
|                  | ParallelConflictDetectorService | 并行冲突检测         |
| **mission/**     | WritingMissionService           | 任务编排核心         |

---

## 3. 数据模型关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA MODELS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐                                                        │
│  │  WritingProject  │                                                        │
│  │  ──────────────  │                                                        │
│  │  id, name        │                                                        │
│  │  genre           │                                                        │
│  │  targetWords     │                                                        │
│  │  writingStyle    │                                                        │
│  │  maxParallel     │                                                        │
│  │  ownerId         │                                                        │
│  └────────┬─────────┘                                                        │
│           │                                                                  │
│           ├────────────────────┬──────────────────────┐                     │
│           ▼                    ▼                      ▼                     │
│  ┌────────────────┐   ┌───────────────┐    ┌─────────────────┐             │
│  │   StoryBible   │   │ WritingVolume │    │ WritingMission  │             │
│  │   ──────────   │   │ ─────────────  │    │ ───────────────  │             │
│  │   premise      │   │ volumeNumber  │    │ missionType     │             │
│  │   theme, tone  │   │ title         │    │ status          │             │
│  │   worldType    │   │ synopsis      │    │ aiMissionId     │             │
│  └───────┬────────┘   └───────┬───────┘    │ parallelGroupId │             │
│          │                    │            │ writerInstance  │             │
│          │                    │            └─────────────────┘             │
│  ┌───────┴───────────────┐    │                                            │
│  │                       │    ▼                                            │
│  ▼                       ▼   ┌────────────────┐                            │
│ ┌────────────────┐  ┌────────────────┐       │                            │
│ │WritingCharacter│  │  WorldSetting  │ WritingChapter │                    │
│ │ ─────────────  │  │  ────────────  │ ──────────────  │                    │
│ │ name, role     │  │  category     │ │ chapterNumber │                    │
│ │ appearance     │  │  name         │ │ title, outline│                    │
│ │ personality    │  │  rules[]      │ │ content       │                    │
│ │ currentState   │  └───────────────┘ │ status        │                    │
│ │ stateTimeline[]│                    │ dependsOn[]   │                    │
│ └───────┬────────┘                    └───────┬───────┘                    │
│         │                                     │                            │
│         ▼                                     ▼                            │
│ ┌──────────────────────┐             ┌───────────────┐                    │
│ │CharacterRelationship │             │ WritingScene  │                    │
│ │ ──────────────────── │             │ ─────────────  │                    │
│ │ relationshipType     │             │ sceneNumber   │                    │
│ │ startChapterId       │             │ summary       │                    │
│ │ endChapterId         │             │ location      │                    │
│ └──────────────────────┘             └───────┬───────┘                    │
│                                              │                            │
│  ┌─────────────────┐  ┌──────────────┐      ▼                            │
│  │ TimelineEvent   │  │ Terminology  │  ┌─────────────────┐              │
│  │ ─────────────── │  │ ──────────── │  │SceneAppearance  │              │
│  │ eventName       │  │ term         │  │ ───────────────  │              │
│  │ storyTime       │  │ definition   │  │ stateSnapshot   │              │
│  │ importance      │  │ variants[]   │  └─────────────────┘              │
│  └─────────────────┘  └──────────────┘                                   │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────────┐                               │
│  │    Faction      │  │ConsistencyCheck  │                               │
│  │    ───────      │  │ ───────────────   │                               │
│  │    name, type   │  │ checkType        │                               │
│  │    hierarchy    │  │ status           │                               │
│  │    territory    │  │ issues[]         │                               │
│  └─────────────────┘  └──────────────────┘                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 核心实体说明

| 实体                      | 说明                   | 关键字段                                                                      |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| **WritingProject**        | 写作项目根实体         | genre, targetWords, maxParallelWriters                                        |
| **StoryBible**            | 设定集，一对一关联项目 | premise, theme, tone, worldType                                               |
| **WritingCharacter**      | 角色定义               | role (PROTAGONIST/ANTAGONIST/SUPPORTING/MINOR), currentState, stateTimeline[] |
| **CharacterRelationship** | 角色关系               | relationshipType, startChapterId, endChapterId                                |
| **WorldSetting**          | 世界观设定             | category (地理/历史/魔法体系等), rules[]                                      |
| **Faction**               | 势力/组织              | type (国家/门派/公司/家族), hierarchy                                         |
| **Terminology**           | 术语定义               | term, definition, variants[]                                                  |
| **TimelineEvent**         | 时间线事件             | storyTime, importance (1-5)                                                   |
| **WritingVolume**         | 卷                     | volumeNumber, synopsis                                                        |
| **WritingChapter**        | 章节                   | status, dependsOn[], content                                                  |
| **WritingScene**          | 场景                   | location, storyTime                                                           |
| **SceneAppearance**       | 角色出场记录           | stateSnapshot                                                                 |
| **ConsistencyCheck**      | 一致性检查记录         | checkType, status, issues[]                                                   |
| **WritingMission**        | 写作任务               | missionType, aiMissionId, parallelGroupId                                     |

### 3.2 枚举类型

```typescript
// 项目状态
WritingProjectStatus: PLANNING | OUTLINING | WRITING | REVISING | COMPLETED;

// 任务类型
WritingMissionType: OUTLINE | CHAPTER | REVISION | CONSISTENCY;

// 任务状态
WritingMissionStatus: PENDING | IN_PROGRESS | COMPLETED | FAILED | CANCELLED;

// 章节状态
ChapterStatus: PLANNED |
  OUTLINING |
  WRITING |
  DRAFT |
  CHECKING |
  REVISING |
  FINAL;

// 一致性检查类型
ConsistencyCheckType: CHARACTER | TIMELINE | WORLD | TERMINOLOGY | PLOT;

// 一致性检查状态
ConsistencyCheckStatus: PENDING | PASSED | ISSUES_FOUND | RESOLVED;

// 角色类型
CharacterRole: PROTAGONIST | ANTAGONIST | SUPPORTING | MINOR;
```

---

## 4. 写作任务执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Writing Mission Execution Flow                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  用户输入 (prompt + projectId + missionType)                                  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────────────────────────────────┐                             │
│  │       WritingMissionService.execute()       │                             │
│  └────────────────────────┬───────────────────┘                             │
│                           │                                                  │
│       ┌───────────────────┼───────────────────┐                             │
│       ▼                   ▼                   ▼                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                        │
│  │ 构建写作上下文 │   │ 创建AI团队   │   │ 初始化任务  │                        │
│  │ContextBuilder│   │ TeamFactory │   │WritingMission│                       │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘                        │
│         │                 │                 │                               │
│         └─────────────────┼─────────────────┘                               │
│                           ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                    StoryArchitect (Leader)                       │        │
│  │                      任务分解与调度                                │        │
│  └───────────────────────────┬─────────────────────────────────────┘        │
│                              │                                               │
│    ┌─────────────────────────┼─────────────────────────┐                    │
│    ▼                         ▼                         ▼                    │
│ ┌─────────────┐       ┌─────────────┐          ┌─────────────┐             │
│ │PreWriteInj. │       │   Writer    │          │   Writer    │             │
│ │ (上下文注入) │       │ Instance 1  │ ...      │ Instance N  │             │
│ └──────┬──────┘       └──────┬──────┘          └──────┬──────┘             │
│        │                     │                        │                     │
│        │                     ├────────────────────────┘                     │
│        ▼                     ▼                                              │
│ ┌─────────────┐       ┌─────────────┐                                      │
│ │ BibleKeeper │       │  生成内容    │                                      │
│ │ (提取事实)  │        │             │                                      │
│ └──────┬──────┘       └──────┬──────┘                                      │
│        │                     │                                              │
│        └──────────┬──────────┘                                              │
│                   ▼                                                         │
│        ┌─────────────────────┐                                              │
│        │ConsistencyChecker   │                                              │
│        │ (一致性检查)         │                                              │
│        └──────────┬──────────┘                                              │
│                   │                                                         │
│        ┌──────────┴──────────┐                                              │
│        ▼                     ▼                                              │
│   [通过]               [发现问题]                                            │
│     │                     │                                                 │
│     │              ┌──────▼──────┐                                          │
│     │              │ConflictRes. │                                          │
│     │              │ (冲突解决)   │                                          │
│     │              └──────┬──────┘                                          │
│     │                     │                                                 │
│     └──────────┬──────────┘                                                 │
│                ▼                                                            │
│        ┌─────────────┐                                                      │
│        │   Editor    │                                                      │
│        │ (润色精修)   │                                                      │
│        └──────┬──────┘                                                      │
│               │                                                             │
│               ▼                                                             │
│        ┌─────────────────────────────────────────┐                          │
│        │            WritingMissionResult          │                          │
│        │  - content (最终内容)                     │                          │
│        │  - wordCount                            │                          │
│        │  - qualityMetrics (质量评分)             │                          │
│        │  - consistencyReport (一致性报告)        │                          │
│        │  - bibleUpdates (设定更新)              │                          │
│        └─────────────────────────────────────────┘                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 WritingContextPackage 结构

```typescript
interface WritingContextPackage extends MissionContextPackage {
  extensions: {
    storyBible: {
      bibleId: string;
      bibleVersion: number;
      snapshotAt: Date;
      premise: string;
      theme: string;
      tone: string;
      worldType: string;
      characters: WritingCharacterEntity[];
      worldSettings: WorldSettingEntity[];
      terminologies: TerminologyEntry[];
      timelineEvents: TimelineEventEntry[];
      factions: FactionEntity[];
      writingStyle: {
        pov: string; // 人称视角
        tense: string; // 时态
        vocabulary: string; // 词汇风格
        sentenceLength: string;
        dialogueStyle: string;
      };
      targetAudience: string;
    };
    chapterContext?: {
      chapter: { id; chapterNumber; title; outline; volumeId };
      previousContext: { chapterNumber; title; summary }[];
      involvedCharacters: CharacterEntity[];
      relevantWorldSettings: WorldSettingEntity[];
      relevantTerminology: TerminologyEntry[];
      timelineContext: TimelineEventEntry[];
      writingInstructions: {
        targetWordCount: number;
        additionalInstructions: string;
        focusPoints: string[];
        avoidPoints: string[];
      };
    };
  };
}
```

### 4.2 WritingMissionResult 结构

```typescript
interface WritingMissionResult {
  content?: string;
  wordCount?: number;
  qualityMetrics: {
    overall: number; // 0-100
    wordCount: number;
    coherence: number;
    completeness: number;
    consistency: number;
  };
  consistencyReport: {
    status: "PASSED" | "ISSUES_FOUND";
    issues: ConsistencyIssue[];
  };
  bibleUpdates: {
    type: "character" | "world" | "timeline" | "terminology";
    data: any;
  }[];
}
```

---

## 5. 并行写作编排

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Parallel Writing Orchestration                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Volume (N 个章节)                                                           │
│       │                                                                      │
│       ▼                                                                      │
│  ┌────────────────────────────────┐                                         │
│  │  ChapterDependencyService      │                                         │
│  │  分析章节依赖关系                │                                         │
│  └───────────────┬────────────────┘                                         │
│                  │                                                           │
│                  ▼                                                           │
│  ┌───────────────────────────────────────────────────────────────┐          │
│  │              Chapter Dependency Graph                          │          │
│  │                                                                │          │
│  │    Ch1 ─────► Ch3 ─────► Ch5                                   │          │
│  │     │                     │                                    │          │
│  │     └──► Ch2 ─────► Ch4 ──┘                                    │          │
│  │                                                                │          │
│  └───────────────────────────────────────────────────────────────┘          │
│                  │                                                           │
│                  ▼                                                           │
│  ┌────────────────────────────────┐                                         │
│  │  ParallelOrchestratorService   │                                         │
│  │  生成执行计划 (maxParallel=3)   │                                         │
│  └───────────────┬────────────────┘                                         │
│                  │                                                           │
│                  ▼                                                           │
│  ┌───────────────────────────────────────────────────────────────┐          │
│  │                    Execution Plan                              │          │
│  │                                                                │          │
│  │  Wave 1: [Ch1, Ch2]         ← 可并行 (无依赖)                   │          │
│  │  Wave 2: [Ch3, Ch4]         ← 可并行 (依赖已完成)                │          │
│  │  Wave 3: [Ch5]              ← 串行 (等待 Ch3, Ch4)              │          │
│  │                                                                │          │
│  └───────────────────────────────────────────────────────────────┘          │
│                  │                                                           │
│                  ▼                                                           │
│  ┌────────────────────────────────┐                                         │
│  │     WriterPoolService          │                                         │
│  │  创建 Writer 实例池              │                                         │
│  └───────────────┬────────────────┘                                         │
│                  │                                                           │
│       ┌──────────┼──────────┐                                               │
│       ▼          ▼          ▼                                               │
│  ┌─────────┐┌─────────┐┌─────────┐                                         │
│  │Writer 1 ││Writer 2 ││Writer 3 │                                         │
│  │ (Ch1)   ││ (Ch2)   ││ (idle)  │                                         │
│  └────┬────┘└────┬────┘└─────────┘                                         │
│       │          │                                                          │
│       ▼          ▼                                                          │
│  ┌────────────────────────────────┐                                         │
│  │ ParallelConflictDetectorService│                                         │
│  │ 检测并行写作冲突                 │                                         │
│  └───────────────┬────────────────┘                                         │
│                  │                                                           │
│                  ▼                                                           │
│  ┌────────────────────────────────┐                                         │
│  │  ConsistencyEngineService      │                                         │
│  │  统一验证 + 合并结果             │                                         │
│  └────────────────────────────────┘                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 并行写作关键配置

| 配置项               | 说明                 | 默认值       |
| -------------------- | -------------------- | ------------ |
| `maxParallelWriters` | 最大并行 Writer 数量 | 1-5          |
| `parallelGroupId`    | 并行任务组标识       | UUID         |
| `writerInstance`     | Writer 实例编号      | 1-N          |
| `dependsOn[]`        | 章节依赖列表         | Chapter ID[] |

### 5.2 冲突检测类型

- **角色状态冲突**: 同一角色在并行章节中状态不一致
- **时间线冲突**: 事件时间顺序矛盾
- **世界观冲突**: 违反已建立的世界规则
- **情节冲突**: 并行章节情节相互矛盾

---

## 6. 一致性检查框架

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Consistency Check Framework                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────┐           │
│  │                    Writing Pipeline                           │           │
│  │                                                               │           │
│  │  ┌─────────────────┐                                          │           │
│  │  │PreWriteInjection│                                          │           │
│  │  │                 │                                          │           │
│  │  │ - 加载 Story Bible                                          │           │
│  │  │ - 注入角色当前状态                                           │           │
│  │  │ - 注入世界观约束                                             │           │
│  │  │ - 注入时间线上下文                                           │           │
│  │  │ - 注入术语表                                                 │           │
│  │  └────────┬────────┘                                          │           │
│  │           │                                                   │           │
│  │           ▼                                                   │           │
│  │  ┌─────────────────┐                                          │           │
│  │  │  Writer Agent   │  ← 生成内容                               │           │
│  │  └────────┬────────┘                                          │           │
│  │           │                                                   │           │
│  │           ▼                                                   │           │
│  │  ┌─────────────────────────────────────────────────────────┐  │           │
│  │  │              PostWriteValidationService                  │  │           │
│  │  │                                                          │  │           │
│  │  │  检查类型:                                                 │  │           │
│  │  │  ┌──────────┬──────────┬──────────┬──────────┬────────┐ │  │           │
│  │  │  │CHARACTER │ TIMELINE │  WORLD   │TERMINOLOGY│ PLOT   │ │  │           │
│  │  │  │ 角色一致  │ 时间线   │ 世界观   │ 术语使用  │ 情节   │ │  │           │
│  │  │  └──────────┴──────────┴──────────┴──────────┴────────┘ │  │           │
│  │  │                                                          │  │           │
│  │  │  状态流转:                                                 │  │           │
│  │  │  PENDING → PASSED                                        │  │           │
│  │  │          → ISSUES_FOUND → RESOLVED                       │  │           │
│  │  │                                                          │  │           │
│  │  └────────────────────────┬────────────────────────────────┘  │           │
│  │                           │                                   │           │
│  │          ┌────────────────┴────────────────┐                  │           │
│  │          ▼                                 ▼                  │           │
│  │     [PASSED]                        [ISSUES_FOUND]            │           │
│  │          │                                 │                  │           │
│  │          │                     ┌───────────▼───────────┐      │           │
│  │          │                     │ConflictResolutionServ.│      │           │
│  │          │                     │                       │      │           │
│  │          │                     │ - 自动修复简单冲突      │      │           │
│  │          │                     │ - 提出修改建议         │      │           │
│  │          │                     │ - 更新 Story Bible    │      │           │
│  │          │                     └───────────┬───────────┘      │           │
│  │          │                                 │                  │           │
│  │          └─────────────┬───────────────────┘                  │           │
│  │                        ▼                                      │           │
│  │               ┌────────────────┐                              │           │
│  │               │  Editor Agent  │ ← 最终润色                    │           │
│  │               └────────────────┘                              │           │
│  │                                                               │           │
│  └───────────────────────────────────────────────────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 一致性检查类型说明

| 检查类型        | 说明         | 检查内容                                    |
| --------------- | ------------ | ------------------------------------------- |
| **CHARACTER**   | 角色一致性   | 外貌、性格、能力、当前状态是否与 Bible 一致 |
| **TIMELINE**    | 时间线一致性 | 事件顺序、时间跨度、因果关系是否合理        |
| **WORLD**       | 世界观一致性 | 是否违反已建立的世界规则                    |
| **TERMINOLOGY** | 术语一致性   | 专有名词使用是否正确、一致                  |
| **PLOT**        | 情节一致性   | 情节逻辑、伏笔回收、剧情走向是否合理        |

---

## 7. 模块依赖关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Module Dependencies                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                     ┌─────────────────────┐                                  │
│                     │   AiWritingModule   │                                  │
│                     │    (ai-app/writing) │                                  │
│                     └──────────┬──────────┘                                  │
│                                │                                             │
│            ┌───────────────────┼───────────────────┐                        │
│            │                   │                   │                        │
│            ▼                   ▼                   ▼                        │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐               │
│  │  PrismaModule   │ │  AiEngineModule │ │   TeamsModule   │               │
│  │                 │ │                 │ │                 │               │
│  │ - Database ORM  │ │ - LLM 调用      │ │ - Agent 协作    │               │
│  │ - CRUD 操作     │ │ - 搜索能力      │ │ - Mission 编排  │               │
│  │ - 事务管理      │ │ - 上下文管理    │ │ - Role 注册     │               │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘               │
│                                │                                            │
│                                ▼                                            │
│                     ┌─────────────────────┐                                 │
│                     │  LongContentModule  │                                 │
│                     │                     │                                 │
│                     │ - 长内容分段生成     │                                 │
│                     │ - 质量评估          │                                 │
│                     │ - 增量生成          │                                 │
│                     └─────────────────────┘                                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Exports (对外暴露)                            │    │
│  │                                                                     │    │
│  │  Services:                                                          │    │
│  │  - AiWritingService         - WritingMissionService                │    │
│  │  - ProjectService           - StoryBibleService                    │    │
│  │  - CharacterService         - ConsistencyEngineService             │    │
│  │  - ParallelOrchestratorService                                     │    │
│  │                                                                     │    │
│  │  Agents:                                                            │    │
│  │  - StoryArchitectAgent      - BibleKeeperAgent                     │    │
│  │  - WriterAgent              - ConsistencyCheckerAgent              │    │
│  │  - EditorAgent                                                      │    │
│  │                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. API 端点概览

### 8.1 项目管理

| 端点                              | 方法   | 描述                      |
| --------------------------------- | ------ | ------------------------- |
| `/api/v1/ai-writing/projects`     | POST   | 创建写作项目              |
| `/api/v1/ai-writing/projects`     | GET    | 项目列表 (支持过滤、分页) |
| `/api/v1/ai-writing/projects/:id` | GET    | 获取项目详情              |
| `/api/v1/ai-writing/projects/:id` | PATCH  | 更新项目                  |
| `/api/v1/ai-writing/projects/:id` | DELETE | 删除项目                  |

### 8.2 Story Bible

| 端点                                    | 方法  | 描述             |
| --------------------------------------- | ----- | ---------------- |
| `/api/v1/ai-writing/projects/:id/bible` | GET   | 获取 Story Bible |
| `/api/v1/ai-writing/projects/:id/bible` | PATCH | 更新 Story Bible |

### 8.3 角色管理

| 端点                                                 | 方法   | 描述         |
| ---------------------------------------------------- | ------ | ------------ |
| `/api/v1/ai-writing/projects/:id/characters`         | POST   | 创建角色     |
| `/api/v1/ai-writing/projects/:id/characters`         | GET    | 角色列表     |
| `/api/v1/ai-writing/projects/:id/characters/:charId` | GET    | 获取角色详情 |
| `/api/v1/ai-writing/projects/:id/characters/:charId` | PATCH  | 更新角色     |
| `/api/v1/ai-writing/projects/:id/characters/:charId` | DELETE | 删除角色     |

### 8.4 卷/章节管理

| 端点                                            | 方法  | 描述         |
| ----------------------------------------------- | ----- | ------------ |
| `/api/v1/ai-writing/projects/:id/volumes`       | POST  | 创建卷       |
| `/api/v1/ai-writing/projects/:id/volumes`       | GET   | 卷列表       |
| `/api/v1/ai-writing/volumes/:volumeId/chapters` | POST  | 创建章节     |
| `/api/v1/ai-writing/volumes/:volumeId/chapters` | GET   | 章节列表     |
| `/api/v1/ai-writing/chapters/:id`               | GET   | 获取章节详情 |
| `/api/v1/ai-writing/chapters/:id`               | PATCH | 更新章节     |

### 8.5 写作操作

| 端点                                            | 方法 | 描述             |
| ----------------------------------------------- | ---- | ---------------- |
| `/api/v1/ai-writing/chapters/:id/write`         | POST | 开始写作单个章节 |
| `/api/v1/ai-writing/volumes/:id/write-parallel` | POST | 并行写作多个章节 |

### 8.6 一致性检查

| 端点                                                 | 方法 | 描述               |
| ---------------------------------------------------- | ---- | ------------------ |
| `/api/v1/ai-writing/chapters/:id/check-consistency`  | POST | 检查章节一致性     |
| `/api/v1/ai-writing/projects/:id/consistency-report` | GET  | 获取项目一致性报告 |

### 8.7 任务管理

| 端点                                            | 方法 | 描述                |
| ----------------------------------------------- | ---- | ------------------- |
| `/api/v1/ai-writing/projects/:id/missions`      | POST | 创建写作任务 (异步) |
| `/api/v1/ai-writing/projects/:id/missions`      | GET  | 获取项目任务列表    |
| `/api/v1/ai-writing/missions/:missionId`        | GET  | 获取任务状态        |
| `/api/v1/ai-writing/missions/:missionId/cancel` | POST | 取消任务            |

---

## 9. 核心设计特点

| 特性              | 实现方式                                          | 优势                 |
| ----------------- | ------------------------------------------------- | -------------------- |
| **一致性优先**    | Story Bible 作为单一事实来源，写前注入 + 写后验证 | 确保长篇内容前后一致 |
| **并行写作**      | 依赖图分析 + Writer Pool + 冲突检测               | 提高写作效率         |
| **长内容支持**    | LongContentEngine 分段生成 + 质量评估             | 支持超长篇内容       |
| **状态追踪**      | Character.currentState + stateTimeline[]          | 角色状态随剧情演进   |
| **多 Agent 协作** | 5 个专业 Agent + StoryArchitect 统一调度          | 专业分工，质量保障   |
| **异步执行**      | WritingMission + aiMissionId 关联 AI Teams        | 支持长时间任务       |
| **用户隔离**      | JWT 认证 + ownerId 行级安全                       | 数据安全             |

---

## 10. 文件目录结构

### 10.1 后端文件

```
backend/src/modules/ai-app/writing/
├── agents/                              # 5 个写作 Agent
│   ├── story-architect.agent.ts         # Leader - 任务调度
│   ├── bible-keeper.agent.ts            # 设定集守护者
│   ├── writer.agent.ts                  # 内容创作 (支持并行)
│   ├── consistency-checker.agent.ts     # 一致性检查
│   ├── editor.agent.ts                  # 润色精修
│   └── index.ts
├── services/
│   ├── bible/                           # Story Bible 管理
│   │   ├── story-bible.service.ts
│   │   ├── character.service.ts
│   │   ├── world-setting.service.ts
│   │   ├── timeline.service.ts
│   │   └── terminology.service.ts
│   ├── writing/                         # 写作核心服务
│   │   ├── project.service.ts
│   │   ├── chapter-writing.service.ts
│   │   ├── context-builder.service.ts
│   │   └── outline.service.ts
│   ├── mission/                         # 任务编排
│   │   ├── writing-mission.service.ts
│   │   └── index.ts
│   ├── consistency/                     # 一致性检查
│   │   ├── consistency-engine.service.ts
│   │   ├── pre-write-injection.service.ts
│   │   ├── post-write-validation.service.ts
│   │   └── conflict-resolution.service.ts
│   └── parallel/                        # 并行写作
│       ├── parallel-orchestrator.service.ts
│       ├── chapter-dependency.service.ts
│       ├── writer-pool.service.ts
│       └── parallel-conflict-detector.service.ts
├── dto/                                 # 数据传输对象
│   ├── project.dto.ts
│   ├── chapter.dto.ts
│   ├── character.dto.ts
│   ├── volume.dto.ts
│   └── index.ts
├── interfaces/
│   └── writing-context.interface.ts     # 写作上下文接口
├── ai-writing.module.ts                 # 模块定义
├── ai-writing.controller.ts             # API 控制器
└── ai-writing.service.ts                # 核心服务
```

### 10.2 前端文件

```
frontend/
├── app/ai-writing/
│   ├── page.tsx                         # 项目列表页
│   ├── new/page.tsx                     # 创建项目页
│   └── [id]/page.tsx                    # 项目详情页
├── components/ai-writing/
│   ├── WritingCanvasView.tsx            # 任务执行可视化
│   └── WritingMissionPanel.tsx          # 任务进度面板
└── lib/api/
    └── ai-writing.ts                    # API 调用封装
```

### 10.3 数据库模型

```
backend/prisma/schema.prisma
├── WritingProject          (Line ~5425)
├── StoryBible              (Line ~5450)
├── WritingCharacter        (Line ~5480)
├── CharacterRelationship   (Line ~5520)
├── WorldSetting            (Line ~5550)
├── Faction                 (Line ~5580)
├── Terminology             (Line ~5610)
├── TimelineEvent           (Line ~5640)
├── WritingVolume           (Line ~5680)
├── WritingChapter          (Line ~5710)
├── WritingScene            (Line ~5760)
├── SceneAppearance         (Line ~5790)
├── ConsistencyCheck        (Line ~5810)
└── WritingMission          (Line ~5840)
```

---

## 相关文档

- [AI Teams 系统设计](../ai-teams/system-design.md)
- [长内容引擎 v2](../../architecture/long-content-engine-v2.md)
- [AI Teams 长内容端到端设计](../../architecture/ai-teams-long-content-e2e-design.md)

---

**文档版本**: 1.0.0
**创建日期**: 2025-01-07
**维护者**: Claude Code
