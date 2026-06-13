# 任务分解服务详细设计

> 版本: 1.0
> 日期: 2025-01-06
> 状态: 规划中

---

## 一、概述

### 1.1 能力定义

**任务分解 (Task Decomposition)** 是将一个复杂的高层任务拆分为多个可执行的子任务的能力。

### 1.2 当前实现位置

```
backend/src/modules/ai-app/teams/services/collaboration/mission/task-breakdown.service.ts
```

### 1.3 下沉目标位置

```
backend/src/modules/ai-engine/decomposition/
├── index.ts
├── task-decomposer.service.ts
├── strategies/
│   ├── sequential-decomposer.ts
│   ├── parallel-decomposer.ts
│   └── dag-decomposer.ts
├── matchers/
│   └── member-matcher.service.ts
└── resolvers/
    └── dependency-resolver.ts
```

---

## 二、接口设计

### 2.1 核心接口

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/decomposition.interface.ts
// ============================================================

/**
 * 任务分解输入
 */
export interface DecompositionInput {
  /** 任务标题 */
  title: string;

  /** 任务描述 */
  description: string;

  /** 任务目标 */
  objectives: string[];

  /** 约束条件 */
  constraints?: string[];

  /** 交付物要求 */
  deliverables?: string[];

  /** 背景信息 */
  background?: string;

  /** 输入实体（长内容场景） */
  entities?: Record<string, unknown>;

  /** 示例（长内容场景） */
  examples?: string[];
}

/**
 * 团队成员定义
 */
export interface TeamMemberDefinition {
  /** 成员ID */
  id: string;

  /** 显示名称 */
  displayName: string;

  /** 角色描述 */
  roleDescription?: string;

  /** 擅长领域 */
  expertiseAreas: string[];

  /** 是否为Leader */
  isLeader: boolean;

  /** 工作风格 */
  workStyle?:
    | "AUTONOMOUS"
    | "COLLABORATIVE"
    | "SUPPORTIVE"
    | "ANALYTICAL"
    | "CREATIVE";

  /** 能力列表 */
  capabilities?: string[];
}

/**
 * 分解后的任务定义
 */
export interface TaskDefinition {
  /** 任务ID（临时ID，用于依赖引用） */
  tempId: string;

  /** 任务标题 */
  title: string;

  /** 任务描述 */
  description: string;

  /** 分配给的成员ID */
  assignedToId: string;

  /** 分配原因 */
  assignedReason?: string;

  /** 依赖的任务ID列表 */
  dependsOn: string[];

  /** 优先级 */
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

  /** 任务类型 */
  taskType: TaskType;

  /** 预估 Token 消耗 */
  estimatedTokens?: number;
}

export type TaskType =
  | "RESEARCH" // 研究调研
  | "ANALYSIS" // 分析
  | "DESIGN" // 设计
  | "IMPLEMENTATION" // 实现
  | "REVIEW" // 审核
  | "DOCUMENTATION" // 文档
  | "COORDINATION" // 协调
  | "CREATIVE" // 创意
  | "SYNTHESIS"; // 综合整理

/**
 * 任务分解结果
 */
export interface DecompositionResult {
  /** 分解后的任务列表 */
  tasks: TaskDefinition[];

  /** 任务执行顺序（拓扑排序后） */
  executionOrder: string[];

  /** 可并行执行的任务组 */
  parallelGroups: string[][];

  /** 提取的硬约束 */
  hardConstraints?: HardConstraint[];

  /** 预估总 Token 消耗 */
  estimatedTotalTokens: number;

  /** 分解元数据 */
  metadata: {
    totalTasks: number;
    leaderTasks: number;
    memberTasks: number;
    strategy: DecompositionStrategy;
  };
}

/**
 * 硬约束定义
 */
export interface HardConstraint {
  /** 约束类型 */
  type: "MUST" | "MUST_NOT" | "SHOULD" | "MAY";

  /** 约束内容 */
  content: string;

  /** 约束来源 */
  source: "user_input" | "system" | "inferred";
}

/**
 * 分解策略
 */
export type DecompositionStrategy =
  | "SEQUENTIAL"
  | "PARALLEL"
  | "DAG"
  | "ADAPTIVE";

/**
 * 分解配置
 */
export interface DecompositionConfig {
  /** 分解策略 */
  strategy: DecompositionStrategy;

  /** 最大任务数 */
  maxTasks?: number;

  /** 是否提取硬约束 */
  extractConstraints?: boolean;

  /** 是否允许任务合并 */
  allowMerge?: boolean;

  /** Leader Agent ID（用于生成分解计划） */
  leaderAgentId?: string;
}

/**
 * 任务分解器接口
 */
export interface ITaskDecomposer {
  /**
   * 分解任务
   */
  decompose(
    input: DecompositionInput,
    team: TeamMemberDefinition[],
    config?: DecompositionConfig,
  ): Promise<DecompositionResult>;

  /**
   * 验证分解结果
   */
  validate(result: DecompositionResult): ValidationResult;

  /**
   * 重新分解（当成员不可用时）
   */
  redecompose(
    result: DecompositionResult,
    unavailableMembers: string[],
    team: TeamMemberDefinition[],
  ): Promise<DecompositionResult>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

### 2.2 成员匹配接口

```typescript
// ============================================================
// 文件: ai-engine/decomposition/matchers/member-matcher.interface.ts
// ============================================================

/**
 * 成员匹配请求
 */
export interface MemberMatchRequest {
  /** 任务描述 */
  taskDescription: string;

  /** 建议的成员名称（可能是模糊的） */
  suggestedMemberName?: string;

  /** 任务类型 */
  taskType: TaskType;

  /** 需要的专业领域 */
  requiredExpertise?: string[];
}

/**
 * 成员匹配结果
 */
export interface MemberMatchResult {
  /** 匹配到的成员ID */
  memberId: string;

  /** 匹配分数 (0-1) */
  matchScore: number;

  /** 匹配原因 */
  matchReason: string;

  /** 是否为精确匹配 */
  isExactMatch: boolean;
}

/**
 * 成员匹配器接口
 */
export interface IMemberMatcher {
  /**
   * 匹配最佳成员
   */
  matchBest(
    request: MemberMatchRequest,
    candidates: TeamMemberDefinition[],
  ): MemberMatchResult;

  /**
   * 匹配所有可能的成员（带分数）
   */
  matchAll(
    request: MemberMatchRequest,
    candidates: TeamMemberDefinition[],
  ): MemberMatchResult[];

  /**
   * 批量匹配
   */
  matchBatch(
    requests: MemberMatchRequest[],
    candidates: TeamMemberDefinition[],
  ): Map<number, MemberMatchResult>;
}
```

---

## 三、服务实现

### 3.1 TaskDecomposerService

```typescript
// ============================================================
// 文件: ai-engine/decomposition/task-decomposer.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { AIOrchestrationService } from "../../common/ai-orchestration/ai-orchestration.service";
import { MemberMatcherService } from "./matchers/member-matcher.service";
import { DependencyResolver } from "./resolvers/dependency-resolver";
import {
  ITaskDecomposer,
  DecompositionInput,
  DecompositionResult,
  DecompositionConfig,
  TeamMemberDefinition,
  TaskDefinition,
  ValidationResult,
  HardConstraint,
} from "../core/interfaces/decomposition.interface";

@Injectable()
export class TaskDecomposerService implements ITaskDecomposer {
  private readonly logger = new Logger(TaskDecomposerService.name);

  constructor(
    private readonly aiService: AIOrchestrationService,
    private readonly memberMatcher: MemberMatcherService,
    private readonly dependencyResolver: DependencyResolver,
  ) {}

  /**
   * 分解任务
   */
  async decompose(
    input: DecompositionInput,
    team: TeamMemberDefinition[],
    config: DecompositionConfig = { strategy: "ADAPTIVE" },
  ): Promise<DecompositionResult> {
    this.logger.log(`开始分解任务: ${input.title}`);

    // 1. 构建分解提示词
    const prompt = this.buildDecompositionPrompt(input, team, config);

    // 2. 调用 AI 生成分解方案
    const rawPlan = await this.generateDecompositionPlan(prompt, config);

    // 3. 解析分解结果
    const parsedTasks = this.parseDecompositionResult(rawPlan);

    // 4. 匹配成员
    const matchedTasks = await this.matchMembers(parsedTasks, team);

    // 5. 解析依赖关系
    const { tasks, executionOrder, parallelGroups } =
      this.dependencyResolver.resolve(matchedTasks);

    // 6. 提取硬约束（如果配置启用）
    let hardConstraints: HardConstraint[] | undefined;
    if (config.extractConstraints) {
      hardConstraints = this.extractHardConstraints(input);
    }

    // 7. 计算 Token 预估
    const estimatedTotalTokens = this.estimateTokens(tasks);

    const result: DecompositionResult = {
      tasks,
      executionOrder,
      parallelGroups,
      hardConstraints,
      estimatedTotalTokens,
      metadata: {
        totalTasks: tasks.length,
        leaderTasks: tasks.filter((t) => this.isLeaderTask(t, team)).length,
        memberTasks: tasks.filter((t) => !this.isLeaderTask(t, team)).length,
        strategy: config.strategy,
      },
    };

    // 8. 验证结果
    const validation = this.validate(result);
    if (!validation.valid) {
      this.logger.warn(`分解结果验证警告: ${validation.warnings.join(", ")}`);
    }

    this.logger.log(`任务分解完成: ${tasks.length} 个子任务`);
    return result;
  }

  /**
   * 验证分解结果
   */
  validate(result: DecompositionResult): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查是否有任务
    if (result.tasks.length === 0) {
      errors.push("分解结果为空");
    }

    // 检查是否所有任务都有分配
    const unassigned = result.tasks.filter((t) => !t.assignedToId);
    if (unassigned.length > 0) {
      errors.push(`${unassigned.length} 个任务未分配成员`);
    }

    // 检查循环依赖
    if (this.dependencyResolver.hasCircularDependency(result.tasks)) {
      errors.push("存在循环依赖");
    }

    // 检查依赖的任务是否存在
    const taskIds = new Set(result.tasks.map((t) => t.tempId));
    for (const task of result.tasks) {
      for (const dep of task.dependsOn) {
        if (!taskIds.has(dep)) {
          warnings.push(`任务 ${task.tempId} 依赖不存在的任务 ${dep}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 重新分解（当成员不可用时）
   */
  async redecompose(
    result: DecompositionResult,
    unavailableMembers: string[],
    team: TeamMemberDefinition[],
  ): Promise<DecompositionResult> {
    const availableTeam = team.filter(
      (m) => !unavailableMembers.includes(m.id),
    );

    // 重新匹配受影响的任务
    const affectedTasks = result.tasks.filter((t) =>
      unavailableMembers.includes(t.assignedToId),
    );

    for (const task of affectedTasks) {
      const match = this.memberMatcher.matchBest(
        {
          taskDescription: task.description,
          taskType: task.taskType,
        },
        availableTeam,
      );
      task.assignedToId = match.memberId;
      task.assignedReason = `重新分配: ${match.matchReason}`;
    }

    return result;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private buildDecompositionPrompt(
    input: DecompositionInput,
    team: TeamMemberDefinition[],
    config: DecompositionConfig,
  ): string {
    const teamDescription = team
      .map(
        (m) =>
          `- ${m.displayName} (${m.isLeader ? "Leader" : "Member"}): ${m.expertiseAreas.join(", ")}`,
      )
      .join("\n");

    return `
你是一个任务分解专家。请将以下任务分解为多个子任务，并分配给合适的团队成员。

## 任务信息
- 标题: ${input.title}
- 描述: ${input.description}
- 目标: ${input.objectives.join("; ")}
${input.constraints ? `- 约束: ${input.constraints.join("; ")}` : ""}
${input.deliverables ? `- 交付物: ${input.deliverables.join("; ")}` : ""}
${input.background ? `- 背景: ${input.background}` : ""}

## 团队成员
${teamDescription}

## 输出要求
请以表格形式输出任务分解结果:

| 序号 | 任务标题 | 任务描述 | 分配给 | 依赖任务 | 优先级 | 任务类型 |
|------|---------|---------|--------|---------|--------|---------|

注意:
1. Leader 负责规划、审核、整合类任务
2. Member 负责具体执行任务
3. 依赖任务用序号表示，多个依赖用逗号分隔
4. 优先级: CRITICAL > HIGH > MEDIUM > LOW
5. 任务类型: RESEARCH/ANALYSIS/DESIGN/IMPLEMENTATION/REVIEW/DOCUMENTATION/CREATIVE/SYNTHESIS
`;
  }

  private async generateDecompositionPlan(
    prompt: string,
    config: DecompositionConfig,
  ): Promise<string> {
    const response = await this.aiService.chat({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "你是一个专业的任务分解专家。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    return response.content;
  }

  private parseDecompositionResult(rawPlan: string): Partial<TaskDefinition>[] {
    // 解析表格格式的分解结果
    const lines = rawPlan.split("\n").filter((line) => line.includes("|"));
    const tasks: Partial<TaskDefinition>[] = [];

    // 跳过表头
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 7) {
        tasks.push({
          tempId: `task-${cells[0]}`,
          title: cells[1],
          description: cells[2],
          assignedToId: "", // 待匹配
          dependsOn: this.parseDependencies(cells[4]),
          priority: this.parsePriority(cells[5]),
          taskType: this.parseTaskType(cells[6]),
        });
      }
    }

    return tasks;
  }

  private async matchMembers(
    tasks: Partial<TaskDefinition>[],
    team: TeamMemberDefinition[],
  ): Promise<TaskDefinition[]> {
    return tasks.map((task) => {
      const match = this.memberMatcher.matchBest(
        {
          taskDescription: task.description || "",
          taskType: task.taskType || "RESEARCH",
        },
        team,
      );

      return {
        ...task,
        assignedToId: match.memberId,
        assignedReason: match.matchReason,
      } as TaskDefinition;
    });
  }

  private extractHardConstraints(input: DecompositionInput): HardConstraint[] {
    const constraints: HardConstraint[] = [];
    const text = `${input.description} ${input.constraints?.join(" ") || ""}`;

    // MUST 约束
    const mustPatterns = [
      /必须[：:]\s*(.+?)(?=[。；\n]|$)/g,
      /一定要[：:]\s*(.+?)(?=[。；\n]|$)/g,
      /MUST[：:]\s*(.+?)(?=[。；\n]|$)/gi,
    ];

    for (const pattern of mustPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        constraints.push({
          type: "MUST",
          content: match[1].trim(),
          source: "user_input",
        });
      }
    }

    // MUST_NOT 约束
    const mustNotPatterns = [
      /不能[：:]\s*(.+?)(?=[。；\n]|$)/g,
      /禁止[：:]\s*(.+?)(?=[。；\n]|$)/g,
      /MUST NOT[：:]\s*(.+?)(?=[。；\n]|$)/gi,
    ];

    for (const pattern of mustNotPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        constraints.push({
          type: "MUST_NOT",
          content: match[1].trim(),
          source: "user_input",
        });
      }
    }

    return constraints;
  }

  private parseDependencies(depStr: string): string[] {
    if (!depStr || depStr === "-" || depStr === "无") {
      return [];
    }
    return depStr.split(/[,，]/).map((d) => `task-${d.trim()}`);
  }

  private parsePriority(priority: string): TaskDefinition["priority"] {
    const normalized = priority.toUpperCase();
    if (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(normalized)) {
      return normalized as TaskDefinition["priority"];
    }
    return "MEDIUM";
  }

  private parseTaskType(type: string): TaskDefinition["taskType"] {
    const normalized = type.toUpperCase();
    const validTypes = [
      "RESEARCH",
      "ANALYSIS",
      "DESIGN",
      "IMPLEMENTATION",
      "REVIEW",
      "DOCUMENTATION",
      "COORDINATION",
      "CREATIVE",
      "SYNTHESIS",
    ];
    if (validTypes.includes(normalized)) {
      return normalized as TaskDefinition["taskType"];
    }
    return "RESEARCH";
  }

  private isLeaderTask(
    task: TaskDefinition,
    team: TeamMemberDefinition[],
  ): boolean {
    const member = team.find((m) => m.id === task.assignedToId);
    return member?.isLeader || false;
  }

  private estimateTokens(tasks: TaskDefinition[]): number {
    // 基于任务类型估算 Token 消耗
    const tokenEstimates: Record<string, number> = {
      RESEARCH: 2000,
      ANALYSIS: 1500,
      DESIGN: 1800,
      IMPLEMENTATION: 2500,
      REVIEW: 1000,
      DOCUMENTATION: 2000,
      COORDINATION: 800,
      CREATIVE: 2000,
      SYNTHESIS: 2500,
    };

    return tasks.reduce((sum, task) => {
      return sum + (tokenEstimates[task.taskType] || 1500);
    }, 0);
  }
}
```

### 3.2 MemberMatcherService

```typescript
// ============================================================
// 文件: ai-engine/decomposition/matchers/member-matcher.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import {
  IMemberMatcher,
  MemberMatchRequest,
  MemberMatchResult,
  TeamMemberDefinition,
} from "../../core/interfaces/decomposition.interface";

@Injectable()
export class MemberMatcherService implements IMemberMatcher {
  private readonly logger = new Logger(MemberMatcherService.name);

  /**
   * 匹配最佳成员
   */
  matchBest(
    request: MemberMatchRequest,
    candidates: TeamMemberDefinition[],
  ): MemberMatchResult {
    const results = this.matchAll(request, candidates);

    if (results.length === 0) {
      // 如果没有匹配，返回第一个非 Leader 成员
      const nonLeader = candidates.find((c) => !c.isLeader);
      return {
        memberId: nonLeader?.id || candidates[0].id,
        matchScore: 0,
        matchReason: "默认分配（无匹配）",
        isExactMatch: false,
      };
    }

    return results[0];
  }

  /**
   * 匹配所有可能的成员
   */
  matchAll(
    request: MemberMatchRequest,
    candidates: TeamMemberDefinition[],
  ): MemberMatchResult[] {
    const results: MemberMatchResult[] = [];

    for (const candidate of candidates) {
      const score = this.calculateMatchScore(request, candidate);
      if (score > 0) {
        results.push({
          memberId: candidate.id,
          matchScore: score,
          matchReason: this.generateMatchReason(request, candidate, score),
          isExactMatch: score >= 0.9,
        });
      }
    }

    // 按分数降序排序
    return results.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * 批量匹配
   */
  matchBatch(
    requests: MemberMatchRequest[],
    candidates: TeamMemberDefinition[],
  ): Map<number, MemberMatchResult> {
    const results = new Map<number, MemberMatchResult>();

    requests.forEach((request, index) => {
      results.set(index, this.matchBest(request, candidates));
    });

    return results;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private calculateMatchScore(
    request: MemberMatchRequest,
    candidate: TeamMemberDefinition,
  ): number {
    let score = 0;
    let maxScore = 0;

    // 1. 名称匹配 (权重: 0.3)
    if (request.suggestedMemberName) {
      maxScore += 0.3;
      const nameScore = this.fuzzyMatchName(
        request.suggestedMemberName,
        candidate.displayName,
      );
      score += nameScore * 0.3;
    }

    // 2. 专业领域匹配 (权重: 0.4)
    maxScore += 0.4;
    const expertiseScore = this.matchExpertise(
      request.taskDescription,
      request.requiredExpertise || [],
      candidate.expertiseAreas,
    );
    score += expertiseScore * 0.4;

    // 3. 任务类型匹配 (权重: 0.2)
    maxScore += 0.2;
    const typeScore = this.matchTaskType(request.taskType, candidate);
    score += typeScore * 0.2;

    // 4. 工作风格匹配 (权重: 0.1)
    maxScore += 0.1;
    const styleScore = this.matchWorkStyle(
      request.taskType,
      candidate.workStyle,
    );
    score += styleScore * 0.1;

    return maxScore > 0 ? score / maxScore : 0;
  }

  private fuzzyMatchName(suggested: string, actual: string): number {
    const normalizedSuggested = suggested.toLowerCase().replace(/\s+/g, "");
    const normalizedActual = actual.toLowerCase().replace(/\s+/g, "");

    // 精确匹配
    if (normalizedSuggested === normalizedActual) {
      return 1;
    }

    // 包含匹配
    if (
      normalizedActual.includes(normalizedSuggested) ||
      normalizedSuggested.includes(normalizedActual)
    ) {
      return 0.8;
    }

    // 关键词匹配
    const suggestedWords = normalizedSuggested.split(/[-_]/);
    const actualWords = normalizedActual.split(/[-_]/);
    const matchedWords = suggestedWords.filter((w) =>
      actualWords.some((a) => a.includes(w) || w.includes(a)),
    );

    if (matchedWords.length > 0) {
      return 0.5 * (matchedWords.length / suggestedWords.length);
    }

    return 0;
  }

  private matchExpertise(
    taskDescription: string,
    requiredExpertise: string[],
    candidateExpertise: string[],
  ): number {
    const allRequired = [
      ...requiredExpertise,
      ...this.extractKeywords(taskDescription),
    ];

    if (allRequired.length === 0) {
      return 0.5; // 中等分数
    }

    const matches = allRequired.filter((req) =>
      candidateExpertise.some(
        (exp) =>
          exp.toLowerCase().includes(req.toLowerCase()) ||
          req.toLowerCase().includes(exp.toLowerCase()),
      ),
    );

    return matches.length / allRequired.length;
  }

  private matchTaskType(
    taskType: string,
    candidate: TeamMemberDefinition,
  ): number {
    // Leader 适合审核、协调类任务
    if (candidate.isLeader) {
      if (["REVIEW", "COORDINATION", "SYNTHESIS"].includes(taskType)) {
        return 1;
      }
      return 0.3;
    }

    // 基于工作风格匹配
    const styleMatch: Record<string, string[]> = {
      ANALYTICAL: ["ANALYSIS", "RESEARCH"],
      CREATIVE: ["CREATIVE", "DESIGN"],
      AUTONOMOUS: ["IMPLEMENTATION", "DOCUMENTATION"],
      COLLABORATIVE: ["COORDINATION", "REVIEW"],
      SUPPORTIVE: ["DOCUMENTATION", "REVIEW"],
    };

    if (candidate.workStyle && styleMatch[candidate.workStyle]) {
      if (styleMatch[candidate.workStyle].includes(taskType)) {
        return 1;
      }
    }

    return 0.5;
  }

  private matchWorkStyle(taskType: string, workStyle?: string): number {
    if (!workStyle) return 0.5;

    const idealStyles: Record<string, string[]> = {
      RESEARCH: ["ANALYTICAL", "AUTONOMOUS"],
      ANALYSIS: ["ANALYTICAL"],
      DESIGN: ["CREATIVE"],
      IMPLEMENTATION: ["AUTONOMOUS"],
      REVIEW: ["ANALYTICAL", "COLLABORATIVE"],
      DOCUMENTATION: ["SUPPORTIVE", "AUTONOMOUS"],
      COORDINATION: ["COLLABORATIVE"],
      CREATIVE: ["CREATIVE"],
      SYNTHESIS: ["ANALYTICAL", "COLLABORATIVE"],
    };

    if (idealStyles[taskType]?.includes(workStyle)) {
      return 1;
    }

    return 0.3;
  }

  private extractKeywords(text: string): string[] {
    // 提取任务描述中的关键词
    const keywords: string[] = [];

    // 技术领域关键词
    const techPatterns = [
      /技术|技术方案|架构|系统|算法/g,
      /数据|分析|统计|挖掘/g,
      /设计|UI|UX|界面/g,
      /市场|行业|竞品|趋势/g,
      /文档|报告|总结|整理/g,
    ];

    for (const pattern of techPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        keywords.push(...matches);
      }
    }

    return [...new Set(keywords)];
  }

  private generateMatchReason(
    request: MemberMatchRequest,
    candidate: TeamMemberDefinition,
    score: number,
  ): string {
    const reasons: string[] = [];

    if (
      candidate.isLeader &&
      ["REVIEW", "COORDINATION", "SYNTHESIS"].includes(request.taskType)
    ) {
      reasons.push("Leader 适合审核/协调类任务");
    }

    if (candidate.expertiseAreas.length > 0) {
      const matchedAreas = candidate.expertiseAreas.filter((area) =>
        request.taskDescription.toLowerCase().includes(area.toLowerCase()),
      );
      if (matchedAreas.length > 0) {
        reasons.push(`擅长领域匹配: ${matchedAreas.join(", ")}`);
      }
    }

    if (score >= 0.9) {
      reasons.push("高度匹配");
    } else if (score >= 0.7) {
      reasons.push("良好匹配");
    }

    return reasons.length > 0 ? reasons.join("; ") : "默认分配";
  }
}
```

### 3.3 DependencyResolver

```typescript
// ============================================================
// 文件: ai-engine/decomposition/resolvers/dependency-resolver.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { TaskDefinition } from "../../core/interfaces/decomposition.interface";

interface ResolveResult {
  tasks: TaskDefinition[];
  executionOrder: string[];
  parallelGroups: string[][];
}

@Injectable()
export class DependencyResolver {
  private readonly logger = new Logger(DependencyResolver.name);

  /**
   * 解析任务依赖，返回执行顺序和并行组
   */
  resolve(tasks: TaskDefinition[]): ResolveResult {
    // 1. 构建邻接表
    const graph = this.buildGraph(tasks);

    // 2. 检测循环依赖
    if (this.hasCircularDependency(tasks)) {
      this.logger.warn("检测到循环依赖，尝试移除");
      this.removeCircularDependencies(tasks);
    }

    // 3. 拓扑排序
    const executionOrder = this.topologicalSort(tasks);

    // 4. 计算并行组
    const parallelGroups = this.computeParallelGroups(tasks, executionOrder);

    return {
      tasks,
      executionOrder,
      parallelGroups,
    };
  }

  /**
   * 检测循环依赖
   */
  hasCircularDependency(tasks: TaskDefinition[]): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const taskMap = new Map(tasks.map((t) => [t.tempId, t]));

    const dfs = (taskId: string): boolean => {
      visited.add(taskId);
      recursionStack.add(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        for (const dep of task.dependsOn) {
          if (!visited.has(dep)) {
            if (dfs(dep)) return true;
          } else if (recursionStack.has(dep)) {
            return true;
          }
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.tempId)) {
        if (dfs(task.tempId)) {
          return true;
        }
      }
    }

    return false;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private buildGraph(tasks: TaskDefinition[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const task of tasks) {
      graph.set(task.tempId, task.dependsOn);
    }

    return graph;
  }

  private topologicalSort(tasks: TaskDefinition[]): string[] {
    const inDegree = new Map<string, number>();
    const taskMap = new Map(tasks.map((t) => [t.tempId, t]));

    // 初始化入度
    for (const task of tasks) {
      inDegree.set(task.tempId, 0);
    }

    // 计算入度
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (inDegree.has(dep)) {
          const current = inDegree.get(task.tempId) || 0;
          inDegree.set(task.tempId, current + 1);
        }
      }
    }

    // BFS 拓扑排序
    const queue: string[] = [];
    const result: string[] = [];

    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // 找到依赖当前任务的任务
      for (const task of tasks) {
        if (task.dependsOn.includes(current)) {
          const newDegree = (inDegree.get(task.tempId) || 0) - 1;
          inDegree.set(task.tempId, newDegree);
          if (newDegree === 0) {
            queue.push(task.tempId);
          }
        }
      }
    }

    return result;
  }

  private computeParallelGroups(
    tasks: TaskDefinition[],
    executionOrder: string[],
  ): string[][] {
    const groups: string[][] = [];
    const taskMap = new Map(tasks.map((t) => [t.tempId, t]));
    const completed = new Set<string>();

    while (completed.size < tasks.length) {
      const currentGroup: string[] = [];

      for (const taskId of executionOrder) {
        if (completed.has(taskId)) continue;

        const task = taskMap.get(taskId);
        if (!task) continue;

        // 检查所有依赖是否已完成
        const allDepsCompleted = task.dependsOn.every((dep) =>
          completed.has(dep),
        );
        if (allDepsCompleted) {
          currentGroup.push(taskId);
        }
      }

      if (currentGroup.length === 0) {
        // 防止死循环
        break;
      }

      groups.push(currentGroup);
      currentGroup.forEach((id) => completed.add(id));
    }

    return groups;
  }

  private removeCircularDependencies(tasks: TaskDefinition[]): void {
    // 简单策略：移除形成环的最后一条边
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const taskMap = new Map(tasks.map((t) => [t.tempId, t]));

    const dfs = (taskId: string, path: string[]): void => {
      visited.add(taskId);
      recursionStack.add(taskId);
      path.push(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        for (let i = 0; i < task.dependsOn.length; i++) {
          const dep = task.dependsOn[i];
          if (recursionStack.has(dep)) {
            // 发现环，移除这条边
            this.logger.warn(`移除循环依赖: ${taskId} -> ${dep}`);
            task.dependsOn.splice(i, 1);
            i--;
          } else if (!visited.has(dep)) {
            dfs(dep, [...path]);
          }
        }
      }

      recursionStack.delete(taskId);
    };

    for (const task of tasks) {
      if (!visited.has(task.tempId)) {
        dfs(task.tempId, []);
      }
    }
  }
}
```

---

## 四、使用示例

### 4.1 基本使用

```typescript
// 在 AI Teams Mission Service 中使用
import { TaskDecomposerService } from "@/modules/ai-engine/decomposition";

@Injectable()
export class TeamMissionService {
  constructor(private readonly taskDecomposer: TaskDecomposerService) {}

  async createMission(dto: CreateMissionDto): Promise<TeamMission> {
    // 获取团队成员
    const team = await this.getTeamMembers(dto.topicId);

    // 调用 AI Engine 进行任务分解
    const decompositionResult = await this.taskDecomposer.decompose(
      {
        title: dto.title,
        description: dto.description,
        objectives: dto.objectives,
        constraints: dto.constraints,
        deliverables: dto.deliverables,
      },
      team.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        roleDescription: m.roleDescription,
        expertiseAreas: m.expertiseAreas,
        isLeader: m.isLeader,
        workStyle: m.workStyle,
      })),
      {
        strategy: "ADAPTIVE",
        extractConstraints: true,
      },
    );

    // 基于分解结果创建任务
    // ...
  }
}
```

### 4.2 自定义分解策略

```typescript
// 使用顺序分解策略（适合简单任务）
const result = await taskDecomposer.decompose(input, team, {
  strategy: "SEQUENTIAL",
  maxTasks: 5,
});

// 使用并行分解策略（适合独立子任务）
const result = await taskDecomposer.decompose(input, team, {
  strategy: "PARALLEL",
});

// 使用 DAG 分解策略（适合复杂依赖）
const result = await taskDecomposer.decompose(input, team, {
  strategy: "DAG",
  extractConstraints: true,
});
```

---

## 五、迁移计划

### 5.1 迁移步骤

1. **创建新服务**
   - 在 `ai-engine/decomposition/` 下创建服务文件
   - 实现核心接口

2. **双写阶段**
   - AI Teams 同时调用新旧两个服务
   - 对比结果，确保一致性

3. **切换阶段**
   - 移除对旧服务的调用
   - 旧服务标记为 deprecated

4. **清理阶段**
   - 删除旧服务代码
   - 更新文档

### 5.2 兼容性保证

- 新接口的输出格式与现有 `AgentTask` 模型兼容
- 支持现有的成员匹配逻辑
- 保留现有的依赖解析能力

---

## 六、测试要求

### 6.1 单元测试

```typescript
describe("TaskDecomposerService", () => {
  it("should decompose a simple task", async () => {
    const result = await service.decompose(simpleInput, team);
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.executionOrder.length).toBe(result.tasks.length);
  });

  it("should handle circular dependencies", async () => {
    const result = await service.decompose(circularInput, team);
    expect(service.validate(result).valid).toBe(true);
  });

  it("should match members correctly", async () => {
    const result = await service.decompose(techInput, team);
    const techTask = result.tasks.find((t) => t.title.includes("技术"));
    expect(techTask?.assignedToId).toBe(techExpert.id);
  });
});
```

### 6.2 集成测试

- 与 AI Teams Mission 功能的集成测试
- 性能基准测试（分解时间 < 5s）
