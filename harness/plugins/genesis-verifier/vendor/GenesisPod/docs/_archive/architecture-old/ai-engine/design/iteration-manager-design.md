# 迭代管理服务详细设计

> 版本: 1.0
> 日期: 2025-01-06
> 状态: 规划中

---

## 一、概述

### 1.1 能力定义

**迭代管理 (Iteration Management)** 是支持用户对已有输出进行持续迭代的能力，包括：

- 选中部分内容进行更新
- 章节深化/扩展
- 章节重写
- 基于新信息刷新
- 版本管理和差异追踪

### 1.2 核心价值

```
┌─────────────────────────────────────────────────────────────────────┐
│  传统模式 (一次性)                                                   │
│  用户输入 → AI 处理 → 输出结果 → 结束                               │
│                                                                     │
│  问题:                                                              │
│  - 输出不满意需要重新生成                                           │
│  - 无法针对性修改某个部分                                           │
│  - 新信息无法增量更新                                               │
│  - 研究成果无法持续积累                                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  迭代模式 (持续)                                                    │
│  用户输入 → AI 处理 → 输出 v1 → 选中修改 → 输出 v2 → ...           │
│                                                                     │
│  优势:                                                              │
│  - 支持选中部分进行精准更新                                         │
│  - 研究上下文持续积累                                               │
│  - 版本可追溯，支持回滚                                             │
│  - 增量更新，节省 Token 消耗                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 目标位置

```
backend/src/modules/ai-engine/iteration/
├── index.ts
├── iteration-manager.service.ts       # 核心迭代管理服务
├── diff-tracker.service.ts            # 差异追踪服务
├── partial-update.service.ts          # 部分更新服务
├── version-manager.service.ts         # 版本管理服务
└── context/
    ├── iteration-context.ts           # 迭代上下文
    └── consistency-keeper.ts          # 一致性保持器
```

---

## 二、数据模型

### 2.1 结构化输出模型

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/structured-output.interface.ts
// ============================================================

/**
 * 结构化输出（支持选中迭代的核心）
 */
export interface StructuredOutput {
  /** 输出 ID */
  id: string;

  /** 输出类型 */
  type: OutputType;

  /** 章节列表 */
  sections: OutputSection[];

  /** 元信息 */
  metadata: OutputMetadata;

  /** 当前版本号 */
  version: number;

  /** 创建时间 */
  createdAt: Date;

  /** 最后更新时间 */
  updatedAt: Date;
}

export type OutputType =
  | "RESEARCH_REPORT"
  | "BUSINESS_DOC"
  | "TECHNICAL_DOC"
  | "CREATIVE";

/**
 * 输出章节（可选中的最小单位）
 */
export interface OutputSection {
  /** 章节 ID（唯一标识，用于选中） */
  id: string;

  /** 章节类型 */
  type: SectionType;

  /** 章节标题 */
  title: string;

  /** 章节内容 */
  content: string;

  /** 层级（支持嵌套章节） */
  level: number;

  /** 父章节 ID */
  parentId?: string;

  /** 子章节 ID 列表 */
  childIds: string[];

  /** 作者信息 */
  author: {
    agentId: string;
    agentName: string;
  };

  /** 引用 */
  citations: Citation[];

  /** 章节元信息 */
  metadata: SectionMetadata;
}

export type SectionType =
  | "EXECUTIVE_SUMMARY" // 执行摘要
  | "CHAPTER" // 章节
  | "SUB_CHAPTER" // 子章节
  | "CONCLUSION" // 结论
  | "APPENDIX" // 附录
  | "REFERENCE"; // 参考文献

/**
 * 章节元信息
 */
export interface SectionMetadata {
  /** 创建时间 */
  createdAt: Date;

  /** 最后更新时间 */
  updatedAt: Date;

  /** 更新次数 */
  updateCount: number;

  /** 字数 */
  wordCount: number;

  /** Token 数 */
  tokenCount: number;

  /** 上一次更新的版本 */
  lastUpdateVersion: number;
}

/**
 * 引用
 */
export interface Citation {
  /** 引用 ID */
  id: string;

  /** 引用文本 */
  text: string;

  /** 来源 URL */
  url?: string;

  /** 来源标题 */
  sourceTitle: string;

  /** 引用位置（在 content 中的位置） */
  position: {
    start: number;
    end: number;
  };
}

/**
 * 输出元信息
 */
export interface OutputMetadata {
  /** 总字数 */
  totalWords: number;

  /** 总 Token 数 */
  totalTokens: number;

  /** 来源数量 */
  sourceCount: number;

  /** 贡献者（Agent）列表 */
  contributors: ContributorInfo[];

  /** 标签 */
  tags: string[];
}

/**
 * 贡献者信息
 */
export interface ContributorInfo {
  agentId: string;
  agentName: string;
  contribution: number; // 贡献比例 0-1
  sections: string[]; // 贡献的章节 ID
}
```

### 2.2 研究上下文模型

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/research-context.interface.ts
// ============================================================

/**
 * 研究上下文（跨版本持久化，支持持续迭代）
 */
export interface ResearchContext {
  /** 上下文 ID */
  id: string;

  /** 原始查询/主题 */
  originalQuery: string;

  /** 累积的知识 */
  accumulatedKnowledge: AccumulatedKnowledge;

  /** 研究边界 */
  boundaries: ResearchBoundaries;

  /** 用户偏好（从交互中学习） */
  preferences: UserPreferences;

  /** 迭代历史摘要 */
  iterationSummary: IterationSummary;
}

/**
 * 累积的知识
 */
export interface AccumulatedKnowledge {
  /** 识别出的实体 */
  entities: Entity[];

  /** 确认的事实 */
  facts: Fact[];

  /** 已使用的来源 */
  sources: Source[];

  /** 已做的决策 */
  decisions: Decision[];

  /** 关键发现 */
  keyFindings: string[];
}

/**
 * 实体
 */
export interface Entity {
  name: string;
  type:
    | "PERSON"
    | "ORGANIZATION"
    | "PRODUCT"
    | "CONCEPT"
    | "LOCATION"
    | "OTHER";
  description?: string;
  mentions: number; // 提及次数
}

/**
 * 事实
 */
export interface Fact {
  statement: string;
  confidence: number; // 0-1
  source?: string;
  verifiedAt: Date;
}

/**
 * 来源
 */
export interface Source {
  url: string;
  title: string;
  type: "WEB" | "PAPER" | "BOOK" | "DATABASE" | "OTHER";
  reliability: number; // 0-1
  usedInSections: string[]; // 使用该来源的章节 ID
}

/**
 * 决策
 */
export interface Decision {
  description: string;
  reason: string;
  madeAt: Date;
  madeBy: string; // Agent ID 或 'user'
}

/**
 * 研究边界
 */
export interface ResearchBoundaries {
  /** 研究范围 */
  scope: string[];

  /** 排除范围 */
  exclusions: string[];

  /** 假设前提 */
  assumptions: string[];

  /** 时间范围 */
  timeRange?: {
    start?: Date;
    end?: Date;
  };

  /** 地域范围 */
  geographicScope?: string[];
}

/**
 * 用户偏好
 */
export interface UserPreferences {
  /** 偏好深度 */
  preferredDepth: "OVERVIEW" | "DETAILED" | "COMPREHENSIVE";

  /** 偏好风格 */
  preferredStyle: "ACADEMIC" | "BUSINESS" | "CASUAL" | "TECHNICAL";

  /** 关注领域 */
  focusAreas: string[];

  /** 偏好语言 */
  language: string;

  /** 其他偏好（从交互中学习） */
  learned: Record<string, unknown>;
}

/**
 * 迭代历史摘要
 */
export interface IterationSummary {
  /** 总迭代次数 */
  totalIterations: number;

  /** 最后迭代时间 */
  lastIteratedAt?: Date;

  /** 迭代类型统计 */
  iterationTypes: Record<IterationType, number>;

  /** 最常更新的章节 */
  frequentlyUpdatedSections: string[];
}
```

### 2.3 版本模型

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/version.interface.ts
// ============================================================

/**
 * 版本
 */
export interface OutputVersion {
  /** 版本号 */
  version: number;

  /** 创建时间 */
  createdAt: Date;

  /** 触发方式 */
  trigger: VersionTrigger;

  /** 变更列表 */
  changes: VersionChange[];

  /** 变更摘要 */
  summary: string;

  /** 快照（完整内容的引用或存储） */
  snapshotId?: string;
}

export type VersionTrigger =
  | "INITIAL" // 初始创建
  | "PARTIAL_UPDATE" // 部分更新
  | "SECTION_EXPAND" // 章节扩展
  | "SECTION_REWRITE" // 章节重写
  | "REFRESH" // 刷新
  | "FULL_UPDATE"; // 全量更新

/**
 * 版本变更
 */
export interface VersionChange {
  /** 变更类型 */
  type: ChangeType;

  /** 受影响的章节 ID */
  sectionId: string;

  /** 章节标题 */
  sectionTitle: string;

  /** 变更前内容（用于 diff） */
  before?: string;

  /** 变更后内容 */
  after: string;

  /** 变更原因 */
  reason: string;
}

export type ChangeType = "ADD" | "UPDATE" | "DELETE" | "MOVE";

/**
 * Diff 结果
 */
export interface DiffResult {
  /** 是否有变更 */
  hasChanges: boolean;

  /** 变更统计 */
  stats: {
    added: number;
    removed: number;
    modified: number;
  };

  /** 详细变更 */
  changes: DiffChange[];
}

/**
 * Diff 变更项
 */
export interface DiffChange {
  type: "ADD" | "REMOVE" | "MODIFY";
  path: string; // 章节路径，如 "1.2.3"
  content: {
    old?: string;
    new?: string;
  };
  range?: {
    start: number;
    end: number;
  };
}
```

---

## 三、迭代请求类型

### 3.1 迭代请求接口

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/iteration.interface.ts
// ============================================================

/**
 * 迭代请求基类
 */
export interface BaseIterationRequest {
  /** 输出 ID */
  outputId: string;

  /** 研究上下文 ID */
  contextId: string;

  /** 用户指令 */
  instruction?: string;
}

/**
 * 部分更新请求（选中内容更新）
 */
export interface PartialUpdateRequest extends BaseIterationRequest {
  type: "PARTIAL_UPDATE";

  /** 选中的章节 ID */
  sectionId: string;

  /** 选中范围（可选，更精确的选中） */
  selectionRange?: {
    start: number;
    end: number;
  };

  /** 更新指令 */
  instruction: string;
}

/**
 * 章节扩展请求
 */
export interface SectionExpandRequest extends BaseIterationRequest {
  type: "SECTION_EXPAND";

  /** 要扩展的章节 ID */
  sectionId: string;

  /** 扩展方向 */
  expandDirection: "DEEPER" | "BROADER" | "EXAMPLES" | "EVIDENCE";

  /** 目标字数（可选） */
  targetWordCount?: number;
}

/**
 * 章节重写请求
 */
export interface SectionRewriteRequest extends BaseIterationRequest {
  type: "SECTION_REWRITE";

  /** 要重写的章节 ID */
  sectionId: string;

  /** 新的要求 */
  newRequirements: string;

  /** 是否保留原有引用 */
  keepCitations: boolean;
}

/**
 * 新增章节请求
 */
export interface AddSectionRequest extends BaseIterationRequest {
  type: "ADD_SECTION";

  /** 插入位置（在哪个章节之后） */
  afterSectionId?: string;

  /** 新章节标题 */
  title: string;

  /** 新章节要求 */
  requirements: string;

  /** 章节类型 */
  sectionType: SectionType;
}

/**
 * 基于新信息刷新请求
 */
export interface RefreshRequest extends BaseIterationRequest {
  type: "REFRESH";

  /** 新的来源 */
  newSources?: Source[];

  /** 新的背景信息 */
  newContext?: string;

  /** 需要刷新的章节 ID 列表（空则刷新全部） */
  sectionsToRefresh?: string[];
}

/**
 * 全量更新请求
 */
export interface FullUpdateRequest extends BaseIterationRequest {
  type: "FULL_UPDATE";

  /** 新的指令/要求 */
  newRequirements: string;

  /** 保留的章节 ID（不重新生成） */
  preserveSections?: string[];
}

/**
 * 联合类型
 */
export type IterationRequest =
  | PartialUpdateRequest
  | SectionExpandRequest
  | SectionRewriteRequest
  | AddSectionRequest
  | RefreshRequest
  | FullUpdateRequest;

export type IterationType = IterationRequest["type"];

/**
 * 迭代结果
 */
export interface IterationResult {
  /** 是否成功 */
  success: boolean;

  /** 新版本号 */
  newVersion: number;

  /** 更新后的输出 */
  updatedOutput: StructuredOutput;

  /** 变更列表 */
  changes: VersionChange[];

  /** Diff 结果（与上一版本对比） */
  diff: DiffResult;

  /** 更新后的研究上下文 */
  updatedContext: ResearchContext;

  /** Token 消耗 */
  tokensUsed: number;

  /** 执行时长 */
  duration: number;
}

/**
 * 迭代事件
 */
export type IterationEvent =
  | { type: "ITERATION_STARTED"; requestType: IterationType }
  | { type: "CONTEXT_LOADED"; contextId: string }
  | { type: "SECTION_UPDATING"; sectionId: string; sectionTitle: string }
  | { type: "SECTION_UPDATED"; sectionId: string; diff: DiffChange }
  | { type: "CONSISTENCY_CHECK"; passed: boolean; issues?: string[] }
  | { type: "VERSION_CREATED"; version: number }
  | { type: "ITERATION_COMPLETED"; result: IterationResult }
  | { type: "ITERATION_FAILED"; error: string };

/**
 * 迭代管理器接口
 */
export interface IIterationManager {
  /**
   * 执行迭代
   */
  iterate(
    request: IterationRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): AsyncGenerator<IterationEvent>;

  /**
   * 获取版本历史
   */
  getVersionHistory(outputId: string): Promise<OutputVersion[]>;

  /**
   * 回滚到指定版本
   */
  rollback(outputId: string, targetVersion: number): Promise<StructuredOutput>;

  /**
   * 比较两个版本
   */
  compareVersions(
    outputId: string,
    version1: number,
    version2: number,
  ): Promise<DiffResult>;
}
```

---

## 四、服务实现

### 4.1 IterationManagerService

```typescript
// ============================================================
// 文件: ai-engine/iteration/iteration-manager.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { DiffTrackerService } from "./diff-tracker.service";
import { PartialUpdateService } from "./partial-update.service";
import { VersionManagerService } from "./version-manager.service";
import { ConsistencyKeeper } from "./context/consistency-keeper";
import { AgentExecutorService } from "../orchestration/agent-executor/agent-executor.service";
import {
  IIterationManager,
  IterationRequest,
  IterationResult,
  IterationEvent,
  StructuredOutput,
  ResearchContext,
  OutputVersion,
  DiffResult,
  VersionChange,
} from "../core/interfaces/iteration.interface";

@Injectable()
export class IterationManagerService implements IIterationManager {
  private readonly logger = new Logger(IterationManagerService.name);

  constructor(
    private readonly diffTracker: DiffTrackerService,
    private readonly partialUpdate: PartialUpdateService,
    private readonly versionManager: VersionManagerService,
    private readonly consistencyKeeper: ConsistencyKeeper,
    private readonly agentExecutor: AgentExecutorService,
  ) {}

  /**
   * 执行迭代
   */
  async *iterate(
    request: IterationRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): AsyncGenerator<IterationEvent> {
    this.logger.log(`开始迭代: ${request.type} for output ${request.outputId}`);
    const startTime = Date.now();

    yield { type: "ITERATION_STARTED", requestType: request.type };
    yield { type: "CONTEXT_LOADED", contextId: context.id };

    try {
      let updatedOutput: StructuredOutput;
      let changes: VersionChange[];

      // 根据请求类型执行不同的迭代策略
      switch (request.type) {
        case "PARTIAL_UPDATE":
          ({ updatedOutput, changes } = await this.executePartialUpdate(
            request,
            currentOutput,
            context,
            (event) => {
              /* yield event through callback */
            },
          ));
          break;

        case "SECTION_EXPAND":
          ({ updatedOutput, changes } = await this.executeSectionExpand(
            request,
            currentOutput,
            context,
          ));
          break;

        case "SECTION_REWRITE":
          ({ updatedOutput, changes } = await this.executeSectionRewrite(
            request,
            currentOutput,
            context,
          ));
          break;

        case "ADD_SECTION":
          ({ updatedOutput, changes } = await this.executeAddSection(
            request,
            currentOutput,
            context,
          ));
          break;

        case "REFRESH":
          ({ updatedOutput, changes } = await this.executeRefresh(
            request,
            currentOutput,
            context,
          ));
          break;

        case "FULL_UPDATE":
          ({ updatedOutput, changes } = await this.executeFullUpdate(
            request,
            currentOutput,
            context,
          ));
          break;

        default:
          throw new Error(`未知的迭代类型: ${(request as any).type}`);
      }

      // 一致性检查
      const consistencyResult = await this.consistencyKeeper.check(
        updatedOutput,
        context,
      );

      yield {
        type: "CONSISTENCY_CHECK",
        passed: consistencyResult.passed,
        issues: consistencyResult.issues,
      };

      // 如果一致性检查失败，尝试修复
      if (!consistencyResult.passed) {
        updatedOutput = await this.consistencyKeeper.fix(
          updatedOutput,
          consistencyResult.issues,
          context,
        );
      }

      // 计算 Diff
      const diff = this.diffTracker.compare(currentOutput, updatedOutput);

      // 创建新版本
      const newVersion = await this.versionManager.createVersion(
        request.outputId,
        {
          trigger: request.type,
          changes,
          summary: this.generateChangeSummary(changes),
        },
      );

      yield { type: "VERSION_CREATED", version: newVersion.version };

      // 更新研究上下文
      const updatedContext = this.updateResearchContext(
        context,
        request,
        changes,
      );

      const result: IterationResult = {
        success: true,
        newVersion: newVersion.version,
        updatedOutput,
        changes,
        diff,
        updatedContext,
        tokensUsed: 0, // TODO: 累计
        duration: Date.now() - startTime,
      };

      yield { type: "ITERATION_COMPLETED", result };
    } catch (error) {
      this.logger.error(`迭代失败: ${error.message}`);
      yield { type: "ITERATION_FAILED", error: error.message };
    }
  }

  /**
   * 获取版本历史
   */
  async getVersionHistory(outputId: string): Promise<OutputVersion[]> {
    return this.versionManager.getHistory(outputId);
  }

  /**
   * 回滚到指定版本
   */
  async rollback(
    outputId: string,
    targetVersion: number,
  ): Promise<StructuredOutput> {
    return this.versionManager.rollback(outputId, targetVersion);
  }

  /**
   * 比较两个版本
   */
  async compareVersions(
    outputId: string,
    version1: number,
    version2: number,
  ): Promise<DiffResult> {
    const output1 = await this.versionManager.getVersion(outputId, version1);
    const output2 = await this.versionManager.getVersion(outputId, version2);
    return this.diffTracker.compare(output1, output2);
  }

  // ============================================================
  // 私有方法 - 各类型迭代实现
  // ============================================================

  private async executePartialUpdate(
    request: PartialUpdateRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
    emitEvent: (event: IterationEvent) => void,
  ): Promise<{ updatedOutput: StructuredOutput; changes: VersionChange[] }> {
    const section = this.findSection(currentOutput, request.sectionId);
    if (!section) {
      throw new Error(`找不到章节: ${request.sectionId}`);
    }

    emitEvent({
      type: "SECTION_UPDATING",
      sectionId: section.id,
      sectionTitle: section.title,
    });

    // 使用 PartialUpdateService 执行更新
    const updatedContent = await this.partialUpdate.update(
      section.content,
      request.instruction,
      {
        sectionTitle: section.title,
        context: this.buildSectionContext(section, currentOutput, context),
        selectionRange: request.selectionRange,
      },
    );

    // 创建更新后的输出
    const updatedOutput = this.updateSectionInOutput(
      currentOutput,
      section.id,
      updatedContent,
    );

    const changes: VersionChange[] = [
      {
        type: "UPDATE",
        sectionId: section.id,
        sectionTitle: section.title,
        before: section.content,
        after: updatedContent,
        reason: request.instruction,
      },
    ];

    return { updatedOutput, changes };
  }

  private async executeSectionExpand(
    request: SectionExpandRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): Promise<{ updatedOutput: StructuredOutput; changes: VersionChange[] }> {
    const section = this.findSection(currentOutput, request.sectionId);
    if (!section) {
      throw new Error(`找不到章节: ${request.sectionId}`);
    }

    const expandedContent = await this.partialUpdate.expand(
      section.content,
      request.expandDirection,
      {
        sectionTitle: section.title,
        context: this.buildSectionContext(section, currentOutput, context),
        targetWordCount: request.targetWordCount,
      },
    );

    const updatedOutput = this.updateSectionInOutput(
      currentOutput,
      section.id,
      expandedContent,
    );

    const changes: VersionChange[] = [
      {
        type: "UPDATE",
        sectionId: section.id,
        sectionTitle: section.title,
        before: section.content,
        after: expandedContent,
        reason: `扩展: ${request.expandDirection}`,
      },
    ];

    return { updatedOutput, changes };
  }

  private async executeSectionRewrite(
    request: SectionRewriteRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): Promise<{ updatedOutput: StructuredOutput; changes: VersionChange[] }> {
    const section = this.findSection(currentOutput, request.sectionId);
    if (!section) {
      throw new Error(`找不到章节: ${request.sectionId}`);
    }

    const rewrittenContent = await this.partialUpdate.rewrite(
      section.content,
      request.newRequirements,
      {
        sectionTitle: section.title,
        context: this.buildSectionContext(section, currentOutput, context),
        keepCitations: request.keepCitations,
        originalCitations: section.citations,
      },
    );

    const updatedOutput = this.updateSectionInOutput(
      currentOutput,
      section.id,
      rewrittenContent,
    );

    const changes: VersionChange[] = [
      {
        type: "UPDATE",
        sectionId: section.id,
        sectionTitle: section.title,
        before: section.content,
        after: rewrittenContent,
        reason: `重写: ${request.newRequirements}`,
      },
    ];

    return { updatedOutput, changes };
  }

  private async executeAddSection(
    request: AddSectionRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): Promise<{ updatedOutput: StructuredOutput; changes: VersionChange[] }> {
    // 生成新章节内容
    const newContent = await this.partialUpdate.generate(
      request.title,
      request.requirements,
      {
        outputType: currentOutput.type,
        context: this.buildGlobalContext(currentOutput, context),
        sectionType: request.sectionType,
      },
    );

    // 创建新章节
    const newSection: OutputSection = {
      id: this.generateSectionId(),
      type: request.sectionType,
      title: request.title,
      content: newContent,
      level: this.determineSectionLevel(request.afterSectionId, currentOutput),
      parentId: undefined,
      childIds: [],
      author: {
        agentId: "system",
        agentName: "AI Assistant",
      },
      citations: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        updateCount: 0,
        wordCount: this.countWords(newContent),
        tokenCount: 0,
        lastUpdateVersion: currentOutput.version + 1,
      },
    };

    // 插入章节
    const updatedOutput = this.insertSection(
      currentOutput,
      newSection,
      request.afterSectionId,
    );

    const changes: VersionChange[] = [
      {
        type: "ADD",
        sectionId: newSection.id,
        sectionTitle: newSection.title,
        after: newContent,
        reason: request.requirements,
      },
    ];

    return { updatedOutput, changes };
  }

  private async executeRefresh(
    request: RefreshRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): Promise<{ updatedOutput: StructuredOutput; changes: VersionChange[] }> {
    const sectionsToUpdate = request.sectionsToRefresh
      ? currentOutput.sections.filter((s) =>
          request.sectionsToRefresh!.includes(s.id),
        )
      : currentOutput.sections;

    const changes: VersionChange[] = [];
    let updatedOutput = { ...currentOutput };

    // 更新研究上下文（添加新来源和背景）
    const enrichedContext = {
      ...context,
      accumulatedKnowledge: {
        ...context.accumulatedKnowledge,
        sources: [
          ...context.accumulatedKnowledge.sources,
          ...(request.newSources || []),
        ],
      },
    };

    if (request.newContext) {
      enrichedContext.boundaries = {
        ...enrichedContext.boundaries,
        assumptions: [
          ...enrichedContext.boundaries.assumptions,
          request.newContext,
        ],
      };
    }

    // 刷新每个章节
    for (const section of sectionsToUpdate) {
      const refreshedContent = await this.partialUpdate.refresh(
        section.content,
        {
          sectionTitle: section.title,
          context: this.buildSectionContext(
            section,
            currentOutput,
            enrichedContext,
          ),
          newSources: request.newSources,
          newContext: request.newContext,
        },
      );

      if (refreshedContent !== section.content) {
        updatedOutput = this.updateSectionInOutput(
          updatedOutput,
          section.id,
          refreshedContent,
        );

        changes.push({
          type: "UPDATE",
          sectionId: section.id,
          sectionTitle: section.title,
          before: section.content,
          after: refreshedContent,
          reason: "基于新信息刷新",
        });
      }
    }

    return { updatedOutput, changes };
  }

  private async executeFullUpdate(
    request: FullUpdateRequest,
    currentOutput: StructuredOutput,
    context: ResearchContext,
  ): Promise<{ updatedOutput: StructuredOutput; changes: VersionChange[] }> {
    // 保留指定章节
    const preservedSections = request.preserveSections
      ? currentOutput.sections.filter((s) =>
          request.preserveSections!.includes(s.id),
        )
      : [];

    // 重新生成其他章节
    // 这里需要调用完整的生成流程...
    // 简化实现：只更新非保留章节

    const changes: VersionChange[] = [];
    let updatedOutput = { ...currentOutput };

    for (const section of currentOutput.sections) {
      if (request.preserveSections?.includes(section.id)) {
        continue;
      }

      const newContent = await this.partialUpdate.regenerate(
        section.title,
        request.newRequirements,
        {
          sectionType: section.type,
          context: this.buildGlobalContext(currentOutput, context),
        },
      );

      updatedOutput = this.updateSectionInOutput(
        updatedOutput,
        section.id,
        newContent,
      );

      changes.push({
        type: "UPDATE",
        sectionId: section.id,
        sectionTitle: section.title,
        before: section.content,
        after: newContent,
        reason: request.newRequirements,
      });
    }

    return { updatedOutput, changes };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private findSection(
    output: StructuredOutput,
    sectionId: string,
  ): OutputSection | null {
    return output.sections.find((s) => s.id === sectionId) || null;
  }

  private updateSectionInOutput(
    output: StructuredOutput,
    sectionId: string,
    newContent: string,
  ): StructuredOutput {
    return {
      ...output,
      sections: output.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              content: newContent,
              metadata: {
                ...s.metadata,
                updatedAt: new Date(),
                updateCount: s.metadata.updateCount + 1,
                wordCount: this.countWords(newContent),
              },
            }
          : s,
      ),
      updatedAt: new Date(),
    };
  }

  private insertSection(
    output: StructuredOutput,
    newSection: OutputSection,
    afterSectionId?: string,
  ): StructuredOutput {
    const sections = [...output.sections];

    if (afterSectionId) {
      const index = sections.findIndex((s) => s.id === afterSectionId);
      if (index !== -1) {
        sections.splice(index + 1, 0, newSection);
      } else {
        sections.push(newSection);
      }
    } else {
      sections.push(newSection);
    }

    return {
      ...output,
      sections,
      updatedAt: new Date(),
    };
  }

  private buildSectionContext(
    section: OutputSection,
    output: StructuredOutput,
    context: ResearchContext,
  ): string {
    const parts: string[] = [];

    parts.push(`## 研究主题: ${context.originalQuery}`);

    // 相关章节摘要
    const relatedSections = output.sections
      .filter((s) => s.id !== section.id)
      .slice(0, 3);

    if (relatedSections.length > 0) {
      parts.push(`\n## 相关章节摘要`);
      for (const s of relatedSections) {
        const summary = s.content.substring(0, 200) + "...";
        parts.push(`\n### ${s.title}\n${summary}`);
      }
    }

    // 关键发现
    if (context.accumulatedKnowledge.keyFindings.length > 0) {
      parts.push(`\n## 关键发现`);
      context.accumulatedKnowledge.keyFindings.forEach((f) =>
        parts.push(`- ${f}`),
      );
    }

    return parts.join("\n");
  }

  private buildGlobalContext(
    output: StructuredOutput,
    context: ResearchContext,
  ): string {
    const parts: string[] = [];

    parts.push(`## 研究主题: ${context.originalQuery}`);
    parts.push(`\n## 研究范围: ${context.boundaries.scope.join(", ")}`);

    if (context.accumulatedKnowledge.keyFindings.length > 0) {
      parts.push(`\n## 关键发现`);
      context.accumulatedKnowledge.keyFindings.forEach((f) =>
        parts.push(`- ${f}`),
      );
    }

    return parts.join("\n");
  }

  private updateResearchContext(
    context: ResearchContext,
    request: IterationRequest,
    changes: VersionChange[],
  ): ResearchContext {
    return {
      ...context,
      iterationSummary: {
        ...context.iterationSummary,
        totalIterations: context.iterationSummary.totalIterations + 1,
        lastIteratedAt: new Date(),
        iterationTypes: {
          ...context.iterationSummary.iterationTypes,
          [request.type]:
            (context.iterationSummary.iterationTypes[request.type] || 0) + 1,
        },
        frequentlyUpdatedSections: this.updateFrequentSections(
          context.iterationSummary.frequentlyUpdatedSections,
          changes.map((c) => c.sectionId),
        ),
      },
    };
  }

  private updateFrequentSections(
    existing: string[],
    newIds: string[],
  ): string[] {
    const counts = new Map<string, number>();

    for (const id of existing) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    for (const id of newIds) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
  }

  private generateChangeSummary(changes: VersionChange[]): string {
    const added = changes.filter((c) => c.type === "ADD").length;
    const updated = changes.filter((c) => c.type === "UPDATE").length;
    const deleted = changes.filter((c) => c.type === "DELETE").length;

    const parts: string[] = [];
    if (added > 0) parts.push(`新增 ${added} 个章节`);
    if (updated > 0) parts.push(`更新 ${updated} 个章节`);
    if (deleted > 0) parts.push(`删除 ${deleted} 个章节`);

    return parts.join(", ") || "无变更";
  }

  private generateSectionId(): string {
    return `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private determineSectionLevel(
    afterSectionId: string | undefined,
    output: StructuredOutput,
  ): number {
    if (!afterSectionId) return 1;
    const afterSection = this.findSection(output, afterSectionId);
    return afterSection ? afterSection.level : 1;
  }

  private countWords(text: string): number {
    // 简单的字数统计（中文按字符，英文按单词）
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const english = (text.match(/[a-zA-Z]+/g) || []).length;
    return chinese + english;
  }
}
```

---

## 五、使用示例

### 5.1 部分更新

```typescript
// 前端发起选中更新
const request: PartialUpdateRequest = {
  type: "PARTIAL_UPDATE",
  outputId: "output-123",
  contextId: "context-456",
  sectionId: "section-2",
  instruction: "更新这部分的市场数据到2025年最新",
};

for await (const event of iterationManager.iterate(
  request,
  currentOutput,
  context,
)) {
  switch (event.type) {
    case "SECTION_UPDATING":
      console.log(`正在更新: ${event.sectionTitle}`);
      break;
    case "ITERATION_COMPLETED":
      console.log(`迭代完成，新版本: ${event.result.newVersion}`);
      // 更新 UI
      break;
  }
}
```

### 5.2 章节深化

```typescript
// 深化研究某个章节
const request: SectionExpandRequest = {
  type: "SECTION_EXPAND",
  outputId: "output-123",
  contextId: "context-456",
  sectionId: "section-3",
  expandDirection: "DEEPER",
  targetWordCount: 2000,
};
```

### 5.3 版本回滚

```typescript
// 回滚到之前的版本
const previousOutput = await iterationManager.rollback("output-123", 2);

// 比较版本差异
const diff = await iterationManager.compareVersions("output-123", 2, 3);
```

---

## 六、前端交互设计

### 6.1 选中交互

```tsx
// 章节组件，支持选中和操作
const SectionView: React.FC<{ section: OutputSection }> = ({ section }) => {
  const [selectedRange, setSelectedRange] = useState<SelectionRange | null>(
    null,
  );

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      setSelectedRange({
        start: range.startOffset,
        end: range.endOffset,
        text: selection.toString(),
      });
    }
  };

  return (
    <div className="section" onMouseUp={handleTextSelection}>
      <h2>{section.title}</h2>
      <div className="content">{section.content}</div>

      {selectedRange && (
        <SelectionToolbar
          selection={selectedRange}
          sectionId={section.id}
          onUpdate={() => handlePartialUpdate(section.id, selectedRange)}
          onExpand={() => handleExpand(section.id)}
          onRewrite={() => handleRewrite(section.id)}
        />
      )}
    </div>
  );
};
```

### 6.2 版本历史

```tsx
const VersionHistory: React.FC<{ outputId: string }> = ({ outputId }) => {
  const { versions } = useVersionHistory(outputId);

  return (
    <div className="version-history">
      {versions.map((v) => (
        <VersionItem
          key={v.version}
          version={v}
          onRollback={() => handleRollback(v.version)}
          onCompare={() => handleCompare(v.version)}
        />
      ))}
    </div>
  );
};
```

---

## 七、测试要求

### 7.1 单元测试

```typescript
describe("IterationManagerService", () => {
  it("should handle partial update", async () => {
    const events = [];
    for await (const event of service.iterate(
      partialUpdateRequest,
      output,
      context,
    )) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "ITERATION_COMPLETED")).toBeDefined();
  });

  it("should maintain consistency after update", async () => {
    // 更新一个章节后，检查与其他章节的一致性
  });

  it("should track version history", async () => {
    // 多次迭代后，检查版本历史
  });
});
```
