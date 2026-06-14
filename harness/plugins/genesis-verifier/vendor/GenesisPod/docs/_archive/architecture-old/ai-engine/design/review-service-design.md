# 输出审核服务详细设计

> 版本: 1.0
> 日期: 2025-01-06
> 状态: 规划中

---

## 一、概述

### 1.1 能力定义

**输出审核 (Output Review)** 是 Leader Agent 检查 Member Agent 产出质量的机制，包括：

- 质量评估
- 一致性检查
- 约束符合性验证
- 反馈生成
- 修订管理

### 1.2 当前实现位置

```
backend/src/modules/ai-app/teams/services/collaboration/mission/mission-review.service.ts
```

### 1.3 下沉目标位置

```
backend/src/modules/ai-engine/review/
├── index.ts
├── output-reviewer.service.ts         # 核心审核服务
├── feedback-generator.ts              # 反馈生成器
├── revision-manager.ts                # 修订管理器
└── criteria/
    ├── quality-criteria.ts            # 质量标准
    ├── consistency-criteria.ts        # 一致性标准
    └── constraint-criteria.ts         # 约束标准
```

---

## 二、接口设计

### 2.1 核心接口

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/review.interface.ts
// ============================================================

/**
 * 审核请求
 */
export interface ReviewRequest {
  /** 任务 ID */
  taskId: string;

  /** 任务标题 */
  taskTitle: string;

  /** 任务描述 */
  taskDescription: string;

  /** 产出内容 */
  output: string;

  /** 产出者 Agent */
  authorAgent: {
    id: string;
    displayName: string;
  };

  /** 任务类型 */
  taskType: TaskType;

  /** 相关上下文 */
  context: ReviewContext;
}

/**
 * 审核上下文
 */
export interface ReviewContext {
  /** Mission 目标 */
  objectives: string[];

  /** 约束条件 */
  constraints: string[];

  /** 硬约束 */
  hardConstraints?: HardConstraint[];

  /** 依赖任务的输出（用于一致性检查） */
  relatedOutputs?: Map<string, string>;

  /** Mission 背景 */
  background?: string;
}

/**
 * 审核标准
 */
export interface ReviewCriteria {
  /** 最低通过分数 (0-100) */
  minPassScore: number;

  /** 是否检查约束符合性 */
  checkConstraints: boolean;

  /** 是否检查与其他输出的一致性 */
  checkConsistency: boolean;

  /** 是否检查格式规范 */
  checkFormat: boolean;

  /** 严格模式（任何问题都不通过） */
  strictMode: boolean;

  /** 自定义检查项 */
  customChecks?: CustomCheck[];
}

/**
 * 自定义检查项
 */
export interface CustomCheck {
  name: string;
  description: string;
  weight: number; // 权重 0-1
  checker: (output: string, context: ReviewContext) => Promise<CheckResult>;
}

/**
 * 检查结果
 */
export interface CheckResult {
  passed: boolean;
  score: number; // 0-100
  issues?: string[];
}

/**
 * 审核结果
 */
export interface ReviewResult {
  /** 是否通过 */
  passed: boolean;

  /** 总分 (0-100) */
  score: number;

  /** 审核决定 */
  decision: ReviewDecision;

  /** 各维度评分 */
  dimensions: {
    quality: DimensionScore;
    consistency: DimensionScore;
    constraints: DimensionScore;
    format: DimensionScore;
  };

  /** 发现的问题 */
  issues: ReviewIssue[];

  /** 反馈内容（给作者的） */
  feedback: string;

  /** 修改建议 */
  suggestions: string[];

  /** 约束违规 */
  constraintViolations?: ConstraintViolation[];

  /** 审核元数据 */
  metadata: {
    reviewedAt: Date;
    reviewerModel: string;
    tokensUsed: number;
  };
}

export type ReviewDecision =
  | "APPROVE" // 通过
  | "APPROVE_WITH_NOTES" // 通过但有备注
  | "REVISION_NEEDED" // 需要修改
  | "REJECT"; // 拒绝

/**
 * 维度评分
 */
export interface DimensionScore {
  score: number; // 0-100
  weight: number; // 权重
  details: string;
}

/**
 * 审核问题
 */
export interface ReviewIssue {
  type: "ERROR" | "WARNING" | "SUGGESTION";
  category: "QUALITY" | "CONSISTENCY" | "CONSTRAINT" | "FORMAT";
  description: string;
  location?: string; // 问题位置描述
  suggestion?: string; // 修改建议
}

/**
 * 约束违规
 */
export interface ConstraintViolation {
  constraint: HardConstraint;
  violationType: "MISSING" | "INCORRECT" | "PARTIAL";
  details: string;
}

/**
 * 修订请求
 */
export interface RevisionRequest {
  /** 原始任务 ID */
  taskId: string;

  /** 原始输出 */
  originalOutput: string;

  /** 审核反馈 */
  reviewFeedback: string;

  /** 修改建议 */
  suggestions: string[];

  /** 约束违规（需要修复的） */
  constraintViolations?: ConstraintViolation[];

  /** 修订次数 */
  revisionCount: number;

  /** 最大修订次数 */
  maxRevisions: number;
}

/**
 * 修订结果
 */
export interface RevisionResult {
  /** 修订后的输出 */
  revisedOutput: string;

  /** 修订说明 */
  revisionNotes: string;

  /** 是否达到修订上限 */
  reachedMaxRevisions: boolean;

  /** Token 消耗 */
  tokensUsed: number;
}

/**
 * 输出审核器接口
 */
export interface IOutputReviewer {
  /**
   * 审核单个输出
   */
  review(
    request: ReviewRequest,
    criteria: ReviewCriteria,
    reviewerAgent: AgentDefinition,
  ): Promise<ReviewResult>;

  /**
   * 批量审核
   */
  reviewBatch(
    requests: ReviewRequest[],
    criteria: ReviewCriteria,
    reviewerAgent: AgentDefinition,
  ): Promise<Map<string, ReviewResult>>;

  /**
   * 请求修订
   */
  requestRevision(
    request: RevisionRequest,
    authorAgent: AgentDefinition,
  ): Promise<RevisionResult>;

  /**
   * 审核修订后的输出
   */
  reviewRevision(
    originalRequest: ReviewRequest,
    revisedOutput: string,
    previousReview: ReviewResult,
    criteria: ReviewCriteria,
    reviewerAgent: AgentDefinition,
  ): Promise<ReviewResult>;
}
```

---

## 三、服务实现

### 3.1 OutputReviewerService

```typescript
// ============================================================
// 文件: ai-engine/review/output-reviewer.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { AIOrchestrationService } from "../../common/ai-orchestration/ai-orchestration.service";
import { FeedbackGenerator } from "./feedback-generator";
import { RevisionManager } from "./revision-manager";
import { QualityCriteria } from "./criteria/quality-criteria";
import { ConsistencyCriteria } from "./criteria/consistency-criteria";
import { ConstraintCriteria } from "./criteria/constraint-criteria";
import {
  IOutputReviewer,
  ReviewRequest,
  ReviewResult,
  ReviewCriteria,
  RevisionRequest,
  RevisionResult,
  ReviewIssue,
  DimensionScore,
  ConstraintViolation,
  AgentDefinition,
} from "../core/interfaces/review.interface";

const DEFAULT_CRITERIA: ReviewCriteria = {
  minPassScore: 70,
  checkConstraints: true,
  checkConsistency: true,
  checkFormat: true,
  strictMode: false,
};

@Injectable()
export class OutputReviewerService implements IOutputReviewer {
  private readonly logger = new Logger(OutputReviewerService.name);

  constructor(
    private readonly aiService: AIOrchestrationService,
    private readonly feedbackGenerator: FeedbackGenerator,
    private readonly revisionManager: RevisionManager,
    private readonly qualityCriteria: QualityCriteria,
    private readonly consistencyCriteria: ConsistencyCriteria,
    private readonly constraintCriteria: ConstraintCriteria,
  ) {}

  /**
   * 审核单个输出
   */
  async review(
    request: ReviewRequest,
    criteria: ReviewCriteria = DEFAULT_CRITERIA,
    reviewerAgent: AgentDefinition,
  ): Promise<ReviewResult> {
    this.logger.log(`开始审核任务: ${request.taskTitle}`);
    const startTime = Date.now();

    // 1. 质量评估
    const qualityScore = await this.evaluateQuality(request, reviewerAgent);

    // 2. 一致性检查
    let consistencyScore: DimensionScore = {
      score: 100,
      weight: 0.2,
      details: "未检查",
    };
    if (criteria.checkConsistency && request.context.relatedOutputs) {
      consistencyScore = await this.checkConsistency(request);
    }

    // 3. 约束符合性检查
    let constraintScore: DimensionScore = {
      score: 100,
      weight: 0.3,
      details: "未检查",
    };
    let constraintViolations: ConstraintViolation[] = [];
    if (criteria.checkConstraints && request.context.hardConstraints) {
      const constraintResult = await this.checkConstraints(request);
      constraintScore = constraintResult.score;
      constraintViolations = constraintResult.violations;
    }

    // 4. 格式检查
    let formatScore: DimensionScore = {
      score: 100,
      weight: 0.1,
      details: "未检查",
    };
    if (criteria.checkFormat) {
      formatScore = this.checkFormat(request);
    }

    // 5. 计算总分
    const totalScore = this.calculateTotalScore({
      quality: qualityScore,
      consistency: consistencyScore,
      constraints: constraintScore,
      format: formatScore,
    });

    // 6. 收集问题
    const issues = this.collectIssues(
      qualityScore,
      consistencyScore,
      constraintScore,
      formatScore,
      constraintViolations,
    );

    // 7. 生成审核决定
    const decision = this.makeDecision(totalScore, issues, criteria);

    // 8. 生成反馈
    const feedback = await this.feedbackGenerator.generate(
      request,
      decision,
      issues,
      reviewerAgent,
    );

    // 9. 生成建议
    const suggestions = this.generateSuggestions(issues, constraintViolations);

    const result: ReviewResult = {
      passed: decision === "APPROVE" || decision === "APPROVE_WITH_NOTES",
      score: totalScore,
      decision,
      dimensions: {
        quality: qualityScore,
        consistency: consistencyScore,
        constraints: constraintScore,
        format: formatScore,
      },
      issues,
      feedback,
      suggestions,
      constraintViolations:
        constraintViolations.length > 0 ? constraintViolations : undefined,
      metadata: {
        reviewedAt: new Date(),
        reviewerModel: reviewerAgent.model,
        tokensUsed: 0, // TODO: 累计各步骤的 token
      },
    };

    this.logger.log(
      `审核完成: ${request.taskTitle} - ${decision} (${totalScore}分)`,
    );

    return result;
  }

  /**
   * 批量审核
   */
  async reviewBatch(
    requests: ReviewRequest[],
    criteria: ReviewCriteria,
    reviewerAgent: AgentDefinition,
  ): Promise<Map<string, ReviewResult>> {
    const results = new Map<string, ReviewResult>();

    // 并行审核，但限制并发数
    const batchSize = 3;
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((req) => this.review(req, criteria, reviewerAgent)),
      );

      batch.forEach((req, index) => {
        results.set(req.taskId, batchResults[index]);
      });
    }

    return results;
  }

  /**
   * 请求修订
   */
  async requestRevision(
    request: RevisionRequest,
    authorAgent: AgentDefinition,
  ): Promise<RevisionResult> {
    return this.revisionManager.executeRevision(request, authorAgent);
  }

  /**
   * 审核修订后的输出
   */
  async reviewRevision(
    originalRequest: ReviewRequest,
    revisedOutput: string,
    previousReview: ReviewResult,
    criteria: ReviewCriteria,
    reviewerAgent: AgentDefinition,
  ): Promise<ReviewResult> {
    // 创建新的审核请求
    const revisionRequest: ReviewRequest = {
      ...originalRequest,
      output: revisedOutput,
    };

    // 审核时考虑之前的问题是否已修复
    const result = await this.review(revisionRequest, criteria, reviewerAgent);

    // 检查之前的问题是否已解决
    const resolvedIssues = previousReview.issues.filter(
      (prevIssue) =>
        !result.issues.some(
          (newIssue) => newIssue.description === prevIssue.description,
        ),
    );

    if (resolvedIssues.length > 0) {
      result.feedback += `\n\n已解决的问题: ${resolvedIssues.length} 个`;
    }

    return result;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private async evaluateQuality(
    request: ReviewRequest,
    reviewerAgent: AgentDefinition,
  ): Promise<DimensionScore> {
    // 使用 AI 评估质量
    const prompt = this.buildQualityEvaluationPrompt(request);

    const response = await this.aiService.chat({
      model: reviewerAgent.model,
      messages: [
        {
          role: "system",
          content: "你是一个严格的质量审核专家。请评估以下内容的质量。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    return this.parseQualityScore(response.content, request);
  }

  private buildQualityEvaluationPrompt(request: ReviewRequest): string {
    return `
## 任务信息
- 标题: ${request.taskTitle}
- 描述: ${request.taskDescription}
- 任务类型: ${request.taskType}

## 目标
${request.context.objectives.join("\n")}

## 待审核内容
${request.output}

## 评估维度
请从以下维度评估内容质量（每个维度 0-100 分）：

1. **完整性**: 是否完整回答了任务要求
2. **准确性**: 信息是否准确可靠
3. **深度**: 分析是否深入
4. **逻辑性**: 结构是否清晰，逻辑是否连贯
5. **可操作性**: 建议/结论是否可执行

请以 JSON 格式输出：
{
  "completeness": { "score": 80, "reason": "..." },
  "accuracy": { "score": 85, "reason": "..." },
  "depth": { "score": 75, "reason": "..." },
  "logic": { "score": 90, "reason": "..." },
  "actionability": { "score": 70, "reason": "..." },
  "overallScore": 80,
  "overallComment": "总体评价..."
}
`;
  }

  private parseQualityScore(
    response: string,
    request: ReviewRequest,
  ): DimensionScore {
    try {
      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { score: 70, weight: 0.4, details: "无法解析评估结果" };
      }

      const evaluation = JSON.parse(jsonMatch[0]);
      return {
        score: evaluation.overallScore || 70,
        weight: 0.4,
        details: evaluation.overallComment || "评估完成",
      };
    } catch (error) {
      this.logger.warn(`质量评估解析失败: ${error.message}`);
      return { score: 70, weight: 0.4, details: "评估解析失败，使用默认分数" };
    }
  }

  private async checkConsistency(
    request: ReviewRequest,
  ): Promise<DimensionScore> {
    if (
      !request.context.relatedOutputs ||
      request.context.relatedOutputs.size === 0
    ) {
      return { score: 100, weight: 0.2, details: "无相关输出需要检查一致性" };
    }

    // 检查与相关输出的一致性
    const issues: string[] = [];

    for (const [taskId, relatedOutput] of request.context.relatedOutputs) {
      const consistency = await this.consistencyCriteria.check(
        request.output,
        relatedOutput,
      );

      if (!consistency.passed) {
        issues.push(...consistency.issues);
      }
    }

    const score =
      issues.length === 0 ? 100 : Math.max(50, 100 - issues.length * 10);

    return {
      score,
      weight: 0.2,
      details:
        issues.length === 0
          ? "与相关内容一致"
          : `发现 ${issues.length} 处不一致`,
    };
  }

  private async checkConstraints(
    request: ReviewRequest,
  ): Promise<{ score: DimensionScore; violations: ConstraintViolation[] }> {
    const violations: ConstraintViolation[] = [];
    const hardConstraints = request.context.hardConstraints || [];

    for (const constraint of hardConstraints) {
      const result = await this.constraintCriteria.check(
        request.output,
        constraint,
      );

      if (!result.passed) {
        violations.push({
          constraint,
          violationType: result.violationType,
          details: result.details,
        });
      }
    }

    const score =
      violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 25);

    return {
      score: {
        score,
        weight: 0.3,
        details:
          violations.length === 0
            ? "所有约束已满足"
            : `违反 ${violations.length} 条约束`,
      },
      violations,
    };
  }

  private checkFormat(request: ReviewRequest): DimensionScore {
    const issues: string[] = [];

    // 检查长度
    if (request.output.length < 100) {
      issues.push("内容过短");
    }

    // 检查结构（是否有标题/段落）
    if (!request.output.includes("\n") && request.output.length > 500) {
      issues.push("缺少段落划分");
    }

    // 检查是否有明显的截断
    if (request.output.endsWith("...") || request.output.endsWith("未完待续")) {
      issues.push("内容可能不完整");
    }

    const score =
      issues.length === 0 ? 100 : Math.max(60, 100 - issues.length * 15);

    return {
      score,
      weight: 0.1,
      details: issues.length === 0 ? "格式良好" : issues.join("; "),
    };
  }

  private calculateTotalScore(
    dimensions: Record<string, DimensionScore>,
  ): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const dim of Object.values(dimensions)) {
      totalWeight += dim.weight;
      weightedSum += dim.score * dim.weight;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  private collectIssues(
    quality: DimensionScore,
    consistency: DimensionScore,
    constraints: DimensionScore,
    format: DimensionScore,
    constraintViolations: ConstraintViolation[],
  ): ReviewIssue[] {
    const issues: ReviewIssue[] = [];

    // 质量问题
    if (quality.score < 70) {
      issues.push({
        type: "WARNING",
        category: "QUALITY",
        description: quality.details,
      });
    }

    // 一致性问题
    if (consistency.score < 80) {
      issues.push({
        type: "WARNING",
        category: "CONSISTENCY",
        description: consistency.details,
      });
    }

    // 约束违规
    for (const violation of constraintViolations) {
      issues.push({
        type: "ERROR",
        category: "CONSTRAINT",
        description: `违反约束 [${violation.constraint.type}]: ${violation.constraint.content}`,
        suggestion: violation.details,
      });
    }

    // 格式问题
    if (format.score < 80) {
      issues.push({
        type: "SUGGESTION",
        category: "FORMAT",
        description: format.details,
      });
    }

    return issues;
  }

  private makeDecision(
    score: number,
    issues: ReviewIssue[],
    criteria: ReviewCriteria,
  ): ReviewResult["decision"] {
    const hasErrors = issues.some((i) => i.type === "ERROR");
    const hasWarnings = issues.some((i) => i.type === "WARNING");

    // 严格模式：任何错误都不通过
    if (criteria.strictMode && hasErrors) {
      return "REJECT";
    }

    // 有约束违规：需要修改
    if (hasErrors) {
      return "REVISION_NEEDED";
    }

    // 分数低于阈值
    if (score < criteria.minPassScore) {
      return "REVISION_NEEDED";
    }

    // 有警告但分数通过
    if (hasWarnings) {
      return "APPROVE_WITH_NOTES";
    }

    return "APPROVE";
  }

  private generateSuggestions(
    issues: ReviewIssue[],
    violations: ConstraintViolation[],
  ): string[] {
    const suggestions: string[] = [];

    // 基于问题生成建议
    for (const issue of issues) {
      if (issue.suggestion) {
        suggestions.push(issue.suggestion);
      }
    }

    // 基于约束违规生成建议
    for (const violation of violations) {
      suggestions.push(`请确保满足: ${violation.constraint.content}`);
    }

    return suggestions;
  }
}
```

### 3.2 FeedbackGenerator

```typescript
// ============================================================
// 文件: ai-engine/review/feedback-generator.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { AIOrchestrationService } from "../../common/ai-orchestration/ai-orchestration.service";
import {
  ReviewRequest,
  ReviewIssue,
  AgentDefinition,
} from "../core/interfaces/review.interface";

@Injectable()
export class FeedbackGenerator {
  private readonly logger = new Logger(FeedbackGenerator.name);

  constructor(private readonly aiService: AIOrchestrationService) {}

  /**
   * 生成反馈内容
   */
  async generate(
    request: ReviewRequest,
    decision: string,
    issues: ReviewIssue[],
    reviewerAgent: AgentDefinition,
  ): Promise<string> {
    // 简单情况：通过且无问题
    if (decision === "APPROVE" && issues.length === 0) {
      return "内容质量良好，审核通过。";
    }

    // 复杂情况：使用 AI 生成详细反馈
    const prompt = this.buildFeedbackPrompt(request, decision, issues);

    try {
      const response = await this.aiService.chat({
        model: reviewerAgent.model,
        messages: [
          {
            role: "system",
            content: `你是 ${reviewerAgent.displayName}，一个专业的审核者。请以建设性的方式提供反馈。`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 500,
      });

      return response.content;
    } catch (error) {
      this.logger.warn(`反馈生成失败: ${error.message}`);
      return this.generateFallbackFeedback(decision, issues);
    }
  }

  private buildFeedbackPrompt(
    request: ReviewRequest,
    decision: string,
    issues: ReviewIssue[],
  ): string {
    const issueList = issues
      .map((i) => `- [${i.type}] ${i.category}: ${i.description}`)
      .join("\n");

    return `
请为以下审核结果生成反馈：

## 任务
${request.taskTitle}

## 审核决定
${decision}

## 发现的问题
${issueList || "无"}

## 输出内容摘要
${request.output.substring(0, 500)}...

请生成：
1. 简短的总体评价（1-2句话）
2. 如果需要修改，给出具体的修改方向
3. 语气要专业但友善
`;
  }

  private generateFallbackFeedback(
    decision: string,
    issues: ReviewIssue[],
  ): string {
    const parts: string[] = [];

    switch (decision) {
      case "APPROVE":
        parts.push("审核通过。");
        break;
      case "APPROVE_WITH_NOTES":
        parts.push("审核通过，但有一些建议：");
        break;
      case "REVISION_NEEDED":
        parts.push("需要修改后重新提交：");
        break;
      case "REJECT":
        parts.push("审核未通过：");
        break;
    }

    if (issues.length > 0) {
      const errorIssues = issues.filter((i) => i.type === "ERROR");
      const warningIssues = issues.filter((i) => i.type === "WARNING");

      if (errorIssues.length > 0) {
        parts.push(`\n需要解决的问题：`);
        errorIssues.forEach((i) => parts.push(`- ${i.description}`));
      }

      if (warningIssues.length > 0) {
        parts.push(`\n建议改进：`);
        warningIssues.forEach((i) => parts.push(`- ${i.description}`));
      }
    }

    return parts.join("\n");
  }
}
```

### 3.3 RevisionManager

```typescript
// ============================================================
// 文件: ai-engine/review/revision-manager.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { AIOrchestrationService } from "../../common/ai-orchestration/ai-orchestration.service";
import {
  RevisionRequest,
  RevisionResult,
  AgentDefinition,
} from "../core/interfaces/review.interface";

@Injectable()
export class RevisionManager {
  private readonly logger = new Logger(RevisionManager.name);

  constructor(private readonly aiService: AIOrchestrationService) {}

  /**
   * 执行修订
   */
  async executeRevision(
    request: RevisionRequest,
    authorAgent: AgentDefinition,
  ): Promise<RevisionResult> {
    this.logger.log(
      `执行修订: 任务 ${request.taskId} (第 ${request.revisionCount + 1} 次)`,
    );

    // 检查是否达到上限
    if (request.revisionCount >= request.maxRevisions) {
      return {
        revisedOutput: request.originalOutput,
        revisionNotes: "已达到最大修订次数限制",
        reachedMaxRevisions: true,
        tokensUsed: 0,
      };
    }

    // 构建修订提示词
    const prompt = this.buildRevisionPrompt(request);

    try {
      const response = await this.aiService.chat({
        model: authorAgent.model,
        messages: [
          {
            role: "system",
            content: this.buildSystemPrompt(authorAgent),
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: authorAgent.maxTokens || 4096,
      });

      return {
        revisedOutput: response.content,
        revisionNotes: `根据反馈进行了修订 (第 ${request.revisionCount + 1} 次)`,
        reachedMaxRevisions: request.revisionCount + 1 >= request.maxRevisions,
        tokensUsed: response.usage?.total_tokens || 0,
      };
    } catch (error) {
      this.logger.error(`修订失败: ${error.message}`);
      return {
        revisedOutput: request.originalOutput,
        revisionNotes: `修订失败: ${error.message}`,
        reachedMaxRevisions: false,
        tokensUsed: 0,
      };
    }
  }

  private buildSystemPrompt(agent: AgentDefinition): string {
    let prompt = agent.systemPrompt || "你是一个专业的内容创作者。";

    if (agent.identity) {
      prompt = `${agent.identity}\n\n${prompt}`;
    }

    prompt += "\n\n请根据审核反馈修改你的内容，确保解决所有指出的问题。";

    return prompt;
  }

  private buildRevisionPrompt(request: RevisionRequest): string {
    const parts: string[] = [];

    parts.push("## 原始内容");
    parts.push(request.originalOutput);

    parts.push("\n## 审核反馈");
    parts.push(request.reviewFeedback);

    if (request.suggestions.length > 0) {
      parts.push("\n## 修改建议");
      request.suggestions.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
    }

    if (
      request.constraintViolations &&
      request.constraintViolations.length > 0
    ) {
      parts.push("\n## 必须修复的约束违规");
      for (const v of request.constraintViolations) {
        parts.push(`- [${v.constraint.type}] ${v.constraint.content}`);
        parts.push(`  问题: ${v.details}`);
      }
    }

    parts.push("\n## 要求");
    parts.push(
      "请根据以上反馈修改内容，直接输出修改后的完整内容，不需要解释修改了什么。",
    );

    return parts.join("\n");
  }
}
```

---

## 四、使用示例

### 4.1 基本审核

```typescript
// 在 AI Teams 中使用
const reviewResult = await outputReviewer.review(
  {
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description,
    output: taskResult.output,
    authorAgent: { id: agent.id, displayName: agent.displayName },
    taskType: task.taskType,
    context: {
      objectives: mission.objectives,
      constraints: mission.constraints,
      hardConstraints: mission.mustConstraints,
    },
  },
  {
    minPassScore: 75,
    checkConstraints: true,
    checkConsistency: false,
    checkFormat: true,
    strictMode: false,
  },
  leaderAgent,
);

if (!reviewResult.passed) {
  // 请求修订
  const revisionResult = await outputReviewer.requestRevision(
    {
      taskId: task.id,
      originalOutput: taskResult.output,
      reviewFeedback: reviewResult.feedback,
      suggestions: reviewResult.suggestions,
      constraintViolations: reviewResult.constraintViolations,
      revisionCount: 0,
      maxRevisions: 3,
    },
    memberAgent,
  );
}
```

---

## 五、迁移计划

### 5.1 迁移步骤

1. 创建新的审核服务
2. 实现反馈生成器和修订管理器
3. 在 AI Teams 中创建适配层
4. 逐步切换到新服务
5. 移除旧代码

### 5.2 兼容性

- 保持审核结果格式兼容
- 保持修订流程兼容
- 保持约束检查逻辑一致
