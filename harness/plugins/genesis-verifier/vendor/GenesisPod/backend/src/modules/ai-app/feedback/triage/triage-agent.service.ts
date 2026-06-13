/**
 * Triage Agent Service
 *
 * 反馈分诊代理 - 分析用户反馈并决定处理路径
 *
 * 职责：
 * 1. 判断反馈的合理性和有效性
 * 2. 对问题进行分类和优先级评估
 * 3. 决定处理路由（自动修复/人工/拒绝）
 * 4. 查找相似问题和历史解决方案
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SimilarityMatcherService } from "./similarity-matcher.service";
import { ScreenshotAnalyzerService } from "../analyzer/screenshot-analyzer.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { APP_CONFIG } from "../../../../common/config/app.config";
import {
  TriageInput,
  TriageDecision,
  TriageConfig,
  ValidityAssessment,
  ClassificationResult,
  PriorityAssessment,
  RoutingDecision,
  DEFAULT_TRIAGE_CONFIG,
  calculatePriorityScore,
  scoreToPriorityLevel,
  canAutoFix,
} from "./triage-decision.types";

// ============================================
// Prompts
// ============================================

const TRIAGE_SYSTEM_PROMPT = `你是 ${APP_CONFIG.brand.fullName} 的反馈分诊专家（Triage Agent）。

你的职责是分析用户提交的反馈，判断其合理性，并决定最佳处理方式。

## ${APP_CONFIG.brand.fullName} 模块说明
- ai-office/ppt: PPT 生成和编辑
- ai-office/doc: 文档生成
- ai-ask: 智能问答
- ai-studio: 深度研究
- ai-teams: AI 团队协作
- library: 资源库
- data-collection: 数据采集
- admin: 管理后台
- auth: 认证授权

## 判断标准

### 1. 合理性判断 (validity)
- isValid: 是否是有效反馈
- confidence: 判断置信度 (0-100)
- reason: 判断理由
- invalidReason: 如果无效，原因是什么 (spam/duplicate/unclear/not_a_bug/wont_fix/cannot_reproduce)

### 2. 问题分类 (classification)
- type: bug/feature/improvement/question/other
- subType: ui_bug/logic_error/performance/crash/security/data_issue/feature_request/ux_improvement/documentation/other
- affectedModule: 受影响的模块
- keywords: 关键词

### 3. 优先级评估 (priority)
- userImpact: 影响用户数 (0-100)
- severity: 问题严重程度 (0-100)
- frequency: 发生频率 (0-100)
- businessImpact: 业务影响 (0-100)
- reasoning: 评估理由

### 4. 路由决策 (routing)
- action: auto_fix/manual_fix/request_info/reject/defer
- confidence: 决策置信度 (0-100)
- reasoning: 决策理由

如果 action 是 auto_fix:
- approach: 修复方法描述
- estimatedComplexity: trivial/simple/moderate/complex
- riskLevel: low/medium/high
- requiresReview: 是否需要代码审查

如果 action 是 manual_fix:
- suggestedTeam: 建议的团队 (frontend/backend/ai/infra)
- estimatedEffort: 预估工作量
- notes: 备注

如果 action 是 request_info:
- requestedInfo: 需要的额外信息列表

如果 action 是 reject:
- rejectReason: 拒绝原因

## 输出格式
返回 JSON 格式，包含以上所有字段。只返回 JSON，不要其他解释。`;

// ============================================
// Service
// ============================================

@Injectable()
export class TriageAgentService {
  private readonly logger = new Logger(TriageAgentService.name);
  private readonly config: TriageConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly similarityMatcher: SimilarityMatcherService,
    private readonly screenshotAnalyzer: ScreenshotAnalyzerService,
    private readonly chatFacade: ChatFacade,
  ) {
    // 加载配置（模型将在运行时从数据库获取）
    this.config = {
      ...DEFAULT_TRIAGE_CONFIG,
      aiModel: "", // 将在 performAiAnalysis 中动态获取
      autoFixEnabled:
        this.configService.get<string>("AUTO_FIX_ENABLED") !== "false",
    };
  }

  /**
   * 执行分诊
   */
  async triage(input: TriageInput): Promise<TriageDecision> {
    const startTime = Date.now();
    this.logger.log(
      `[triage] Starting triage for feedback: ${input.feedbackId}`,
    );

    try {
      // 1. 并行执行：截图分析 + 相似问题查找 + AI 分诊
      const [screenshotAnalysis, similarIssues, aiAnalysis] = await Promise.all(
        [
          this.screenshotAnalyzer.analyzeScreenshots(input.attachments),
          this.similarityMatcher.findSimilarIssues(
            input.title,
            input.description,
            this.config,
          ),
          this.performAiAnalysis(input),
        ],
      );

      // 2. 检查是否为重复反馈
      const duplicateCheck = await this.checkForDuplicate(similarIssues);

      // 3. 构建最终决策
      let decision: TriageDecision;

      if (duplicateCheck.isDuplicate) {
        // 如果是重复反馈，直接拒绝
        decision = this.buildDuplicateDecision(
          input,
          duplicateCheck.originalId!,
          startTime,
        );
      } else {
        // 合并 AI 分析结果
        decision = this.buildDecision(
          input,
          aiAnalysis,
          screenshotAnalysis,
          similarIssues,
          startTime,
        );
      }

      // 4. 判断是否可自动修复
      const autoFixable = canAutoFix(decision, this.config);
      if (decision.routing.action === "auto_fix" && !autoFixable) {
        // 如果 AI 建议自动修复但不满足条件，降级为人工
        decision.routing.action = "manual_fix";
        decision.routing.reasoning += " [自动修复条件不满足，转人工处理]";
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[triage] Completed in ${elapsed}ms: action=${decision.routing.action}, priority=${decision.priority.level}`,
      );

      return decision;
    } catch (error) {
      this.logger.error(`[triage] Failed for ${input.feedbackId}`, error);

      // 返回一个安全的默认决策
      return this.buildFallbackDecision(input, startTime, error as Error);
    }
  }

  /**
   * 执行 AI 分析
   */
  private async performAiAnalysis(
    input: TriageInput,
  ): Promise<Partial<TriageDecision>> {
    const userPrompt = this.buildUserPrompt(input);

    try {
      const response = await this.callAiApi(userPrompt);
      return this.parseAiResponse(response);
    } catch (error) {
      this.logger.error("AI analysis failed", error);
      return this.getDefaultAnalysis(input);
    }
  }

  /**
   * 构建用户提示词
   */
  private buildUserPrompt(input: TriageInput): string {
    let prompt = `请分析以下用户反馈：

## 反馈信息
- ID: ${input.feedbackId}
- 类型: ${input.type}
- 标题: ${input.title}
- 描述: ${input.description}

## 环境信息
- 页面URL: ${input.metadata.pageUrl || "未知"}
- 用户代理: ${input.metadata.userAgent || "未知"}
- 提交时间: ${input.metadata.timestamp}
`;

    if (input.metadata.errorStack) {
      prompt += `
## 错误堆栈
\`\`\`
${input.metadata.errorStack}
\`\`\`
`;
    }

    if (
      input.metadata.consoleErrors &&
      input.metadata.consoleErrors.length > 0
    ) {
      prompt += `
## 控制台错误
${input.metadata.consoleErrors.map((e) => `- ${e}`).join("\n")}
`;
    }

    if (input.attachments.length > 0) {
      prompt += `
## 附件
${input.attachments.map((a) => `- ${a.filename} (${a.mimeType})`).join("\n")}
`;
    }

    return prompt;
  }

  /**
   * 调用 AI API（使用项目标准的 AI 服务）
   */
  private async callAiApi(userPrompt: string): Promise<string> {
    // ★ 通过 AIFacade 获取默认聊天模型
    const defaultModel = await this.chatFacade.getDefaultTextModel();
    if (!defaultModel) {
      throw new Error("No default text model available for triage");
    }
    const modelName = defaultModel.modelId;

    this.logger.debug(`[callAiApi] Using model: ${modelName}`);

    const result = await this.chatFacade.chat({
      messages: [
        { role: "system", content: TRIAGE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: modelName,
      taskProfile: this.config.taskProfile,
    });

    this.logger.debug(
      `[callAiApi] Completed, tokens used: ${result.tokensUsed}`,
    );

    return result.content;
  }

  /**
   * 解析 AI 响应
   */
  private parseAiResponse(response: string): Partial<TriageDecision> {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 构建标准化的决策对象
      const validity: ValidityAssessment = {
        isValid: parsed.validity?.isValid ?? true,
        confidence: parsed.validity?.confidence ?? 70,
        reason: parsed.validity?.reason ?? "AI 分析结果",
        invalidReason: parsed.validity?.invalidReason,
      };

      const classification: ClassificationResult = {
        type: parsed.classification?.type ?? "bug",
        subType: parsed.classification?.subType ?? "other",
        affectedModule: parsed.classification?.affectedModule ?? "unknown",
        keywords: parsed.classification?.keywords ?? [],
      };

      const factors = {
        userImpact: parsed.priority?.userImpact ?? 50,
        severity: parsed.priority?.severity ?? 50,
        frequency: parsed.priority?.frequency ?? 50,
        businessImpact: parsed.priority?.businessImpact ?? 50,
      };

      const score = calculatePriorityScore(factors);

      const priority: PriorityAssessment = {
        level: scoreToPriorityLevel(score),
        score,
        factors,
        reasoning: parsed.priority?.reasoning ?? "",
      };

      const routing: RoutingDecision = {
        action: parsed.routing?.action ?? "manual_fix",
        confidence: parsed.routing?.confidence ?? 60,
        reasoning: parsed.routing?.reasoning ?? "",
        autoFixPlan: parsed.routing?.autoFixPlan,
        manualAssignment: parsed.routing?.manualAssignment,
        requestedInfo: parsed.routing?.requestedInfo,
        rejectReason: parsed.routing?.rejectReason,
      };

      return {
        validity,
        classification,
        priority,
        routing,
        rawAiResponse: response,
      };
    } catch (error) {
      this.logger.warn("Failed to parse AI response", error);
      return {};
    }
  }

  /**
   * 获取默认分析结果
   */
  private getDefaultAnalysis(input: TriageInput): Partial<TriageDecision> {
    // 根据反馈类型设置默认值
    const isBug = input.type === "BUG";

    return {
      validity: {
        isValid: true,
        confidence: 50,
        reason: "无法进行 AI 分析，使用默认判断",
      },
      classification: {
        type: isBug ? "bug" : "improvement",
        subType: "other",
        affectedModule: this.guessModule(input),
        keywords: this.extractKeywords(input.title + " " + input.description),
      },
      priority: {
        level: "medium",
        score: 50,
        factors: {
          userImpact: 50,
          severity: isBug ? 60 : 40,
          frequency: 50,
          businessImpact: 50,
        },
        reasoning: "使用默认优先级评估",
      },
      routing: {
        action: "manual_fix",
        confidence: 40,
        reasoning: "AI 分析失败，转人工处理",
        manualAssignment: {
          estimatedEffort: "unknown",
        },
      },
    };
  }

  /**
   * 猜测受影响模块
   */
  private guessModule(input: TriageInput): string {
    const text =
      `${input.title} ${input.description} ${input.metadata.pageUrl || ""}`.toLowerCase();

    const modulePatterns: Record<string, string[]> = {
      "ai-office/ppt": ["ppt", "幻灯片", "slide", "演示"],
      "ai-office/doc": ["文档", "doc", "document"],
      "ai-ask": ["问答", "ask", "对话", "chat"],
      "ai-studio": ["研究", "research", "studio", "报告"],
      "ai-teams": ["团队", "team", "协作", "辩论"],
      library: ["资源", "library", "收藏"],
      "data-collection": ["采集", "爬虫", "collection"],
      admin: ["管理", "admin", "后台"],
    };

    for (const [module, patterns] of Object.entries(modulePatterns)) {
      if (patterns.some((p) => text.includes(p))) {
        return module;
      }
    }

    return "unknown";
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    const stopWords = new Set([
      "的",
      "了",
      "和",
      "是",
      "在",
      "有",
      "我",
      "不",
      "这",
      "个",
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
    ]);

    return text
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stopWords.has(word.toLowerCase()))
      .slice(0, 10);
  }

  /**
   * 检查是否为重复反馈
   */
  private async checkForDuplicate(
    similarIssues: TriageDecision["similarIssues"],
  ): Promise<{ isDuplicate: boolean; originalId?: string }> {
    if (similarIssues.length === 0) {
      return { isDuplicate: false };
    }

    const topSimilar = similarIssues[0];
    if (topSimilar.similarity >= 90) {
      return {
        isDuplicate: true,
        originalId: topSimilar.feedbackId,
      };
    }

    return { isDuplicate: false };
  }

  /**
   * 构建重复反馈的决策
   */
  private buildDuplicateDecision(
    input: TriageInput,
    originalId: string,
    startTime: number,
  ): TriageDecision {
    return {
      feedbackId: input.feedbackId,
      triagedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
      validity: {
        isValid: false,
        confidence: 95,
        reason: `与已有反馈 ${originalId} 重复`,
        invalidReason: "duplicate",
      },
      classification: {
        type: "other",
        subType: "other",
        affectedModule: "unknown",
        keywords: [],
      },
      priority: {
        level: "low",
        score: 0,
        factors: {
          userImpact: 0,
          severity: 0,
          frequency: 0,
          businessImpact: 0,
        },
        reasoning: "重复反馈",
      },
      routing: {
        action: "reject",
        confidence: 95,
        reasoning: `此反馈与 ${originalId} 重复，已自动关闭`,
        rejectReason: `重复反馈，请参考 ${originalId}`,
      },
      similarIssues: [
        {
          feedbackId: originalId,
          title: "",
          similarity: 95,
          status: "OPEN",
        },
      ],
    };
  }

  /**
   * 构建完整决策
   */
  private buildDecision(
    input: TriageInput,
    aiAnalysis: Partial<TriageDecision>,
    screenshotAnalysis: TriageDecision["screenshotAnalysis"],
    similarIssues: TriageDecision["similarIssues"],
    startTime: number,
  ): TriageDecision {
    const defaults = this.getDefaultAnalysis(input);

    return {
      feedbackId: input.feedbackId,
      triagedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
      validity: aiAnalysis.validity || defaults.validity!,
      classification: aiAnalysis.classification || defaults.classification!,
      priority: aiAnalysis.priority || defaults.priority!,
      routing: aiAnalysis.routing || defaults.routing!,
      similarIssues,
      screenshotAnalysis,
      rawAiResponse: aiAnalysis.rawAiResponse,
    };
  }

  /**
   * 构建回退决策（出错时使用）
   */
  private buildFallbackDecision(
    input: TriageInput,
    startTime: number,
    error: Error,
  ): TriageDecision {
    return {
      feedbackId: input.feedbackId,
      triagedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
      validity: {
        isValid: true,
        confidence: 30,
        reason: `分诊过程出错: ${error.message}`,
      },
      classification: {
        type: "bug",
        subType: "other",
        affectedModule: "unknown",
        keywords: [],
      },
      priority: {
        level: "medium",
        score: 50,
        factors: {
          userImpact: 50,
          severity: 50,
          frequency: 50,
          businessImpact: 50,
        },
        reasoning: "分诊失败，使用默认优先级",
      },
      routing: {
        action: "manual_fix",
        confidence: 20,
        reasoning: `分诊过程出错，需要人工处理: ${error.message}`,
        manualAssignment: {
          estimatedEffort: "unknown",
          notes: `自动分诊失败: ${error.message}`,
        },
      },
      similarIssues: [],
    };
  }

  /**
   * 获取配置
   */
  getConfig(): TriageConfig {
    return { ...this.config };
  }
}
