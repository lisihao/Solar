/**
 * Output Reviewer Service
 * 输出审核服务 - AI Engine 核心能力
 *
 * 从 AI Teams 的 MissionReviewService 下沉到 AI Engine
 * 提供通用的输出审核和返工能力
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IOutputReviewerService,
  ReviewRequest,
  ReviewResult,
  RevisionRequest,
  ExecutionResult,
  ReviewCriteria,
  AiCallerFn,
} from "../../../ai-harness/runner/executor/executor.types";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import type { TaskProfile } from "../../../ai-engine/llm/types/task-profile.types";

/**
 * 默认审核标准
 */
const DEFAULT_CRITERIA: ReviewCriteria = {
  completenessWeight: 0.3,
  accuracyWeight: 0.3,
  logicWeight: 0.2,
  professionalismWeight: 0.2,
  passThreshold: 7,
  maxRevisions: 3,
};

@Injectable()
export class OutputReviewerService implements IOutputReviewerService {
  private readonly logger = new Logger(OutputReviewerService.name);

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * 审核任务输出
   * @param request 审核请求
   * @param aiCaller 可选的 AI 调用函数，注入后使用上层的执行上下文（心跳、token 追踪等）
   */
  async reviewOutput(
    request: ReviewRequest,
    aiCaller?: AiCallerFn,
  ): Promise<ReviewResult> {
    const criteria = { ...DEFAULT_CRITERIA, ...request.criteria };

    try {
      // 对长内容先生成摘要
      let reviewContent = request.content;
      if (request.content.length > 3000) {
        this.logger.log(
          `[reviewOutput] 任务产出较长(${request.content.length}字符)，生成摘要...`,
        );
        const { summary, keyExcerpts } = await this.summarizeForReview(
          request.content,
          request.task.title,
          request.leader.aiModel,
          request.missionId,
          aiCaller, // 传递 aiCaller
        );
        reviewContent = keyExcerpts
          ? `【AI 生成的内容摘要】\n${summary}\n\n【原文关键片段】\n${keyExcerpts}`
          : summary;
      }

      // 构建审核提示词
      const reviewPrompt = this.buildReviewPrompt(
        request,
        reviewContent,
        criteria,
      );

      // 构建消息
      const systemPrompt = this.buildLeaderSystemPrompt(request.leader);
      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [
        { role: "system", content: systemPrompt },
        { role: "user", content: reviewPrompt },
      ];

      // 调用 AI 审核（优先使用注入的 aiCaller）
      let result: { content: string; tokensUsed: number };
      if (aiCaller) {
        result = await aiCaller(request.leader.aiModel, messages, {
          taskProfile: {
            creativity: "low",
            outputLength: "medium",
          },
        });
      } else {
        // 回退到内部实现
        const modelConfig = await this.getModelConfig(request.leader.aiModel);
        result = await this.callAIWithConfig(
          request.leader.aiModel,
          [{ role: "user", content: reviewPrompt }],
          systemPrompt,
          { taskProfile: { creativity: "low", outputLength: "medium" } },
          modelConfig,
        );
      }

      // 解析审核结果
      const reviewResult = this.parseReviewResult(result.content, criteria);

      this.logger.log(
        `[reviewOutput] Review completed: score=${reviewResult.score}, passed=${reviewResult.passed}`,
      );

      return {
        ...reviewResult,
        tokensUsed: result.tokensUsed,
      };
    } catch (error) {
      this.logger.error(
        `[reviewOutput] Review failed: ${(error as Error).message}`,
      );

      // 审核失败时返回默认通过（避免阻塞流程）
      return {
        passed: true,
        score: 7,
        feedback: "审核过程出错，默认通过",
        issues: [],
        suggestions: [],
        tokensUsed: 0,
      };
    }
  }

  /**
   * 为长内容生成摘要（用于审核）
   * @param aiCaller 可选的 AI 调用函数，注入后使用上层的执行上下文
   */
  async summarizeForReview(
    content: string,
    taskTitle: string,
    model: string,
    // missionId 预留用于日志记录
    _missionId: string,
    aiCaller?: AiCallerFn,
  ): Promise<{ summary: string; keyExcerpts?: string }> {
    try {
      const systemPrompt = "你是一个专业的内容摘要助手，善于提取关键信息。";
      const prompt = `请为以下任务产出生成一个简洁的摘要，用于质量审核。

任务标题: ${taskTitle}

原文内容:
${content.substring(0, 10000)}${content.length > 10000 ? "\n...(内容已截断)" : ""}

请输出:
1. 【摘要】(300字以内，概括主要内容和结论)
2. 【关键片段】(提取3-5个最重要的段落或要点)`;

      // 调用 AI（优先使用注入的 aiCaller）
      let result: { content: string; tokensUsed: number };
      if (aiCaller) {
        result = await aiCaller(
          model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          { taskProfile: { creativity: "low", outputLength: "short" } },
        );
      } else {
        // 回退到内部实现
        const modelConfig = await this.getModelConfig(model);
        result = await this.callAIWithConfig(
          model,
          [{ role: "user", content: prompt }],
          systemPrompt,
          { taskProfile: { creativity: "low", outputLength: "short" } },
          modelConfig,
        );
      }

      // 解析摘要结果
      const summaryMatch = result.content.match(
        /【摘要】\n?([\s\S]*?)(?=【关键片段】|$)/,
      );
      const excerptsMatch = result.content.match(/【关键片段】\n?([\s\S]*?)$/);

      return {
        summary: summaryMatch?.[1]?.trim() || result.content,
        keyExcerpts: excerptsMatch?.[1]?.trim(),
      };
    } catch (error) {
      this.logger.warn(
        `[summarizeForReview] Summarization failed: ${(error as Error).message}`,
      );
      // 降级：返回截断的原文
      return {
        summary:
          content.substring(0, 2000) + (content.length > 2000 ? "..." : ""),
      };
    }
  }

  /**
   * 执行任务修订
   * @param request 修订请求
   * @param aiCaller 可选的 AI 调用函数，注入后使用上层的执行上下文（心跳、token 追踪等）
   */
  async executeRevision(
    request: RevisionRequest,
    aiCaller?: AiCallerFn,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // 构建修订提示词
      const revisionPrompt = this.buildRevisionPrompt(request);
      const systemPrompt = request.originalContext.systemPrompt;
      const model = request.originalContext.executor.aiModel;

      // 调用 AI（优先使用注入的 aiCaller）
      let result: { content: string; tokensUsed: number };
      if (aiCaller) {
        result = await aiCaller(
          model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: revisionPrompt },
          ],
          { taskProfile: { creativity: "low", outputLength: "standard" } },
        );
      } else {
        // 回退到内部实现
        const modelConfig = await this.getModelConfig(model);
        result = await this.callAIWithConfig(
          model,
          [{ role: "user", content: revisionPrompt }],
          systemPrompt,
          { taskProfile: { creativity: "low", outputLength: "standard" } },
          modelConfig,
        );
      }

      return {
        success: true,
        content: result.content,
        tokensUsed: result.tokensUsed,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        tokensUsed: 0,
        duration: Date.now() - startTime,
        error: (error as Error).message,
        retryable: true,
      };
    }
  }

  // ==================== 核心能力方法（供上层服务调用） ====================

  /**
   * 执行 AI 调用（核心能力）
   * 这是对外暴露的底层 AI 调用方法，上层服务可通过注入 aiCaller 保留执行上下文
   *
   * @param model AI 模型
   * @param messages 消息列表（包含 system/user/assistant）
   * @param options 调用选项
   * @param aiCaller 可选的 AI 调用函数，注入后使用上层的执行上下文（心跳、token 追踪等）
   */
  async executeAICall(
    model: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
      maxTokens?: number;
      temperature?: number;
      taskProfile?: TaskProfile;
    },
    aiCaller?: AiCallerFn,
  ): Promise<{ content: string; tokensUsed: number }> {
    const startTime = Date.now();
    // ★ 优先使用 taskProfile；legacy temperature/maxTokens 仍被透传以保持向后兼容，
    //    但当两者均未提供时，使用 taskProfile 替代硬编码默认值
    const opts: {
      maxTokens?: number;
      temperature?: number;
      taskProfile?: TaskProfile;
    } = options?.taskProfile
      ? { taskProfile: options.taskProfile }
      : options?.temperature !== undefined || options?.maxTokens !== undefined
        ? {
            maxTokens: options.maxTokens,
            temperature: options.temperature,
          }
        : { taskProfile: { creativity: "low", outputLength: "medium" } };

    try {
      let result: { content: string; tokensUsed: number };

      if (aiCaller) {
        // 使用注入的 aiCaller（保留上层执行上下文）
        result = await aiCaller(model, messages, opts);
      } else {
        // 回退到内部实现
        const systemMsg = messages.find((m) => m.role === "system");
        const userMsgs = messages.filter((m) => m.role !== "system");
        const modelConfig = await this.getModelConfig(model);

        result = await this.callAIWithConfig(
          model,
          userMsgs,
          systemMsg?.content || "",
          opts,
          modelConfig,
        );
      }

      this.logger.debug(
        `[executeAICall] AI call completed in ${Date.now() - startTime}ms, tokens: ${result.tokensUsed}`,
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[executeAICall] AI call failed after ${Date.now() - startTime}ms: ${errorMsg}`,
      );
      throw error;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 构建审核提示词
   */
  private buildReviewPrompt(
    request: ReviewRequest,
    content: string,
    criteria: ReviewCriteria,
  ): string {
    const cw = (criteria.completenessWeight || 0.3) * 100;
    const aw = (criteria.accuracyWeight || 0.3) * 100;
    const lw = (criteria.logicWeight || 0.2) * 100;
    const pw = (criteria.professionalismWeight || 0.2) * 100;
    const threshold = criteria.passThreshold || 7;

    let prompt = `## 任务产出质量审核

### 任务信息
- 任务标题: ${request.task.title}
${request.task.description ? `- 任务描述: ${request.task.description}` : ""}
${request.missionDescription ? `- Mission 目标: ${request.missionDescription}` : ""}

### 待审核内容
${content}

### 评分维度（各维度 1-10 分）

| 维度 | 权重 | 评估要点 |
|------|------|----------|
| 完整性 (completeness) | ${cw}% | 是否覆盖任务要求的所有方面，无明显遗漏 |
| 准确性 (accuracy) | ${aw}% | 信息是否准确可靠，数据引用是否正确 |
| 逻辑性 (logic) | ${lw}% | 论述是否有逻辑，论证链条是否完整 |
| 专业性 (professionalism) | ${pw}% | 表达是否专业规范，术语使用是否准确 |

加权总分 = completeness×${cw / 100} + accuracy×${aw / 100} + logic×${lw / 100} + professionalism×${pw / 100}
通过阈值: ${threshold} 分`;

    if (request.constraints && request.constraints.length > 0) {
      prompt += `\n\n### 硬约束要求（必须满足，违反直接不通过）
${request.constraints.map((c) => `- ${c.type}: ${c.description}`).join("\n")}`;
    }

    prompt += `

### 输出要求
只输出 JSON，不要其他文字。格式：
\`\`\`json
{
  "scores": {
    "completeness": <1-10>,
    "accuracy": <1-10>,
    "logic": <1-10>,
    "professionalism": <1-10>
  },
  "totalScore": <加权总分，保留1位小数>,
  "passed": <true/false>,
  "feedback": "<2-3句总体评价>",
  "issues": ["<具体问题1>", "<具体问题2>"],
  "suggestions": ["<改进建议1>", "<改进建议2>"]
}
\`\`\``;

    return prompt;
  }

  /**
   * 构建 Leader 系统提示词
   */
  private buildLeaderSystemPrompt(leader: ReviewRequest["leader"]): string {
    const prompt = `你是团队的 Leader，负责审核团队成员的工作产出。
${leader.persona ? `\n${leader.persona}` : ""}
${leader.systemPrompt ? `\n${leader.systemPrompt}` : ""}

审核时请：
1. 客观公正地评估内容质量
2. 指出具体问题，而非笼统批评
3. 给出可操作的改进建议
4. 分数评定要有依据`;

    return prompt;
  }

  /**
   * 构建修订提示词
   */
  private buildRevisionPrompt(request: RevisionRequest): string {
    return `## 任务修订（第 ${request.revisionCount} 次）

### 原任务
${request.originalContext.userPrompt}

### 上次输出
${request.originalContent}

### 审核反馈
${request.reviewFeedback}

### 需要修正的问题
${request.issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}

### 要求
请根据审核反馈修正输出，重点解决上述问题。保持原有优点，改进不足之处。`;
  }

  /**
   * 解析审核结果
   */
  private parseReviewResult(
    content: string,
    criteria: ReviewCriteria,
  ): Omit<ReviewResult, "tokensUsed"> & {
    scores?: Record<string, number>;
  } {
    const threshold = criteria.passThreshold || 7;

    const tryParse = (json: string) => {
      const parsed = JSON.parse(json);
      const totalScore =
        typeof parsed.totalScore === "number" ? parsed.totalScore : 7;
      return {
        passed: parsed.passed ?? totalScore >= threshold,
        score: totalScore,
        feedback: parsed.feedback || "",
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions
          : [],
        scores: parsed.scores || undefined,
      };
    };

    try {
      // Try fenced JSON block first
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) return tryParse(jsonMatch[1]);

      // Try bare JSON object
      const directJsonMatch = content.match(/\{[\s\S]*\}/);
      if (directJsonMatch) return tryParse(directJsonMatch[0]);
    } catch {
      // JSON parse failed — fall through to keyword fallback
    }

    // Fallback: keyword-based judgment
    const lowerContent = content.toLowerCase();
    const hasNegative =
      lowerContent.includes("不通过") ||
      lowerContent.includes("需要修改") ||
      lowerContent.includes("问题较多");
    const hasPositive =
      lowerContent.includes("通过") ||
      lowerContent.includes("质量良好") ||
      lowerContent.includes("符合要求");

    return {
      passed: hasPositive && !hasNegative,
      score: hasPositive && !hasNegative ? 8 : 6,
      feedback: content.substring(0, 500),
      issues: [],
      suggestions: [],
    };
  }

  /**
   * Map temperature to creativity level
   */
  private mapTemperatureToCreativity(
    temp: number,
  ): "deterministic" | "low" | "medium" | "high" {
    if (temp <= 0.2) return "deterministic";
    if (temp <= 0.3) return "low";
    if (temp <= 0.7) return "medium";
    return "high";
  }

  /**
   * Map maxTokens to output length
   */
  private mapMaxTokensToOutputLength(
    tokens: number,
  ): "minimal" | "short" | "medium" | "standard" | "long" | "extended" {
    if (tokens <= 1000) return "minimal";
    if (tokens <= 2000) return "short";
    if (tokens <= 4000) return "medium";
    if (tokens <= 6000) return "standard";
    if (tokens <= 8000) return "long";
    return "extended";
  }

  /**
   * 获取模型配置
   */
  private async getModelConfig(aiModel: string) {
    try {
      const modelConfig = await this.prismaService.aIModel.findFirst({
        where: {
          OR: [
            { modelId: { equals: aiModel, mode: "insensitive" } },
            { name: { equals: aiModel, mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });
      return modelConfig;
    } catch {
      return null;
    }
  }

  /**
   * 调用 AI — 统一走 generateChatCompletion，由下游通过 Secret Manager 解析 API Key
   */
  private async callAIWithConfig(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      taskProfile?: TaskProfile;
    },
    _modelConfig: Awaited<ReturnType<typeof this.getModelConfig>>,
  ): Promise<{ content: string; tokensUsed: number }> {
    const taskProfile = options.taskProfile || {
      creativity: this.mapTemperatureToCreativity(options.temperature ?? 0.7),
      outputLength: this.mapMaxTokensToOutputLength(options.maxTokens || 4000),
    };

    const result = await this.aiChatService.generateChatCompletion({
      model: aiModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ] as Array<{ role: "system" | "user" | "assistant"; content: string }>,
      taskProfile,
    });

    return {
      content: result.content,
      tokensUsed: result.tokensUsed || 0,
    };
  }
}
