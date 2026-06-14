/**
 * ExpressionAlternativesService - 表达替代生成服务
 *
 * 核心职责：
 * - 为禁用表达动态生成替代方案
 * - 结合场景上下文生成更贴切的替代表达
 * - 缓存生成的替代方案，避免重复调用 LLM
 *
 * 设计理念：
 * - 从"被动禁止"转变为"主动引导"
 * - 不只是说"不能用什么"，而是说"可以用什么"
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ==================== 重试配置 ====================

const LLM_RETRY_CONFIG = {
  maxRetries: 2, // 替代生成不是关键路径，重试次数较少
  initialDelayMs: 500,
  backoffMultiplier: 2,
} as const;

/**
 * 带指数退避的重试包装器
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  operationName: string,
): Promise<T> {
  let lastError: Error | null = null;
  let delay = LLM_RETRY_CONFIG.initialDelayMs;

  for (let attempt = 1; attempt <= LLM_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < LLM_RETRY_CONFIG.maxRetries) {
        logger.warn(
          `[ExpressionAlternatives] ${operationName} failed (attempt ${attempt}/${LLM_RETRY_CONFIG.maxRetries}), retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= LLM_RETRY_CONFIG.backoffMultiplier;
      }
    }
  }

  throw lastError;
}

// ==================== 类型定义 ====================

export interface AlternativeRequest {
  /** 需要替代的表达 */
  expression: string;
  /** 表达类型 */
  type: "emotion" | "action" | "description" | "transition" | "dialogue";
  /** 场景上下文（可选，用于生成更贴切的替代） */
  sceneContext?: string;
  /** 目标风格（可选） */
  style?: string;
}

export interface AlternativeResult {
  /** 原表达 */
  original: string;
  /** 替代方案列表 */
  alternatives: string[];
  /** 是否来自缓存 */
  fromCache: boolean;
}

// ==================== 服务实现 ====================

@Injectable()
export class ExpressionAlternativesService {
  private readonly logger = new Logger(ExpressionAlternativesService.name);

  // 简单的内存缓存，key 为 "type:expression"
  private readonly cache = new Map<string, string[]>();

  // 缓存过期时间（毫秒）
  private readonly cacheExpiry = 24 * 60 * 60 * 1000; // 24 小时
  private readonly cacheTimestamps = new Map<string, number>();

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 获取表达的替代方案
   *
   * @param request 替代请求
   * @returns 替代方案列表
   */
  async getAlternatives(
    request: AlternativeRequest,
  ): Promise<AlternativeResult> {
    const cacheKey = this.buildCacheKey(request);

    // 检查缓存
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return {
        original: request.expression,
        alternatives: cached,
        fromCache: true,
      };
    }

    // 生成替代方案
    const alternatives = await this.generateAlternatives(request);

    // 缓存结果
    this.setCache(cacheKey, alternatives);

    return {
      original: request.expression,
      alternatives,
      fromCache: false,
    };
  }

  /**
   * 批量获取替代方案
   */
  async getBatchAlternatives(
    requests: AlternativeRequest[],
  ): Promise<Map<string, AlternativeResult>> {
    const results = new Map<string, AlternativeResult>();

    // 分离需要生成的和已缓存的
    const toGenerate: AlternativeRequest[] = [];
    const cached: AlternativeRequest[] = [];

    for (const req of requests) {
      const cacheKey = this.buildCacheKey(req);
      const cachedAlts = this.getFromCache(cacheKey);

      if (cachedAlts) {
        results.set(req.expression, {
          original: req.expression,
          alternatives: cachedAlts,
          fromCache: true,
        });
        cached.push(req);
      } else {
        toGenerate.push(req);
      }
    }

    // 批量生成未缓存的
    if (toGenerate.length > 0) {
      const generated = await this.generateBatchAlternatives(toGenerate);

      for (const req of toGenerate) {
        const alternatives = generated.get(req.expression) || [];
        const cacheKey = this.buildCacheKey(req);
        this.setCache(cacheKey, alternatives);

        results.set(req.expression, {
          original: req.expression,
          alternatives,
          fromCache: false,
        });
      }
    }

    this.logger.log(
      `[ExpressionAlternatives] Processed ${requests.length} requests: ` +
        `${cached.length} cached, ${toGenerate.length} generated`,
    );

    return results;
  }

  /**
   * 生成单个表达的替代方案
   */
  private async generateAlternatives(
    request: AlternativeRequest,
  ): Promise<string[]> {
    const systemPrompt = this.buildSystemPrompt(request);
    const userPrompt = this.buildUserPrompt(request);

    const taskProfile: TaskProfile = {
      creativity: "medium", // 替代表达需要一定创意
      outputLength: "minimal",
    };

    try {
      // ★ 使用重试机制包装 LLM 调用
      const response = await withRetry(
        () =>
          this.chatFacade.chat({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            modelType: AIModelType.CHAT_FAST,
            taskProfile,
          }),
        this.logger,
        "generateAlternatives",
      );

      const content = response.content || "";
      return this.parseAlternatives(content);
    } catch (error) {
      this.logger.warn(
        `[ExpressionAlternatives] Failed to generate for "${request.expression}" after retries: ${error}`,
      );
      return [];
    }
  }

  /**
   * 批量生成替代方案
   */
  private async generateBatchAlternatives(
    requests: AlternativeRequest[],
  ): Promise<Map<string, string[]>> {
    const results = new Map<string, string[]>();

    // 按类型分组，减少 LLM 调用次数
    const byType = new Map<string, AlternativeRequest[]>();
    for (const req of requests) {
      const existing = byType.get(req.type) || [];
      existing.push(req);
      byType.set(req.type, existing);
    }

    // 每种类型批量处理
    for (const [type, typeRequests] of byType.entries()) {
      const expressions = typeRequests.map((r) => r.expression);
      const style = typeRequests[0]?.style;

      const systemPrompt = `你是创意写作专家。请为以下 ${this.getTypeLabel(type)} 类表达各提供 3-4 个替代方案。

要求：
1. 替代方案要多样化，避免雷同
2. 保持原意，但用不同的方式表达
3. 适合小说写作使用
${style ? `4. 风格：${style}` : ""}

输出格式：每行一个原表达及其替代，用 → 分隔。例如：
心中一震 → 胸口一窒 / 呼吸微滞 / 瞳孔微缩`;

      const userPrompt = `请为以下表达提供替代方案：\n${expressions.join("\n")}`;

      const taskProfile: TaskProfile = {
        creativity: "medium",
        outputLength: "short",
      };

      try {
        // ★ 使用重试机制包装 LLM 调用
        const response = await withRetry(
          () =>
            this.chatFacade.chat({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              modelType: AIModelType.CHAT_FAST,
              taskProfile,
            }),
          this.logger,
          `batchGenerate-${type}`,
        );

        const parsed = this.parseBatchAlternatives(response.content || "");
        for (const [expr, alts] of parsed.entries()) {
          results.set(expr, alts);
        }
      } catch (error) {
        this.logger.warn(
          `[ExpressionAlternatives] Batch generation failed for type ${type} after retries: ${error}`,
        );
      }
    }

    return results;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(request: AlternativeRequest): string {
    const typeLabel = this.getTypeLabel(request.type);

    return `你是创意写作专家，擅长提供多样化的表达方式。

任务：为给定的 ${typeLabel} 类表达提供 3-4 个替代方案。

要求：
1. 保持原意，用不同的方式表达
2. 替代方案要具体、生动
3. 适合小说写作使用
4. 避免过于口语化的表达
${request.style ? `5. 目标风格：${request.style}` : ""}

输出格式：每个替代方案占一行，无需编号。`;
  }

  /**
   * 构建用户提示词
   */
  private buildUserPrompt(request: AlternativeRequest): string {
    let prompt = `请为以下表达提供替代方案：\n「${request.expression}」`;

    if (request.sceneContext) {
      prompt += `\n\n场景上下文：${request.sceneContext}`;
    }

    return prompt;
  }

  /**
   * 解析替代方案
   */
  private parseAlternatives(content: string): string[] {
    const lines = content.split("\n").filter((line) => line.trim());
    const alternatives: string[] = [];

    for (const line of lines) {
      // 清理行号、连字符等
      let cleaned = line.replace(/^[\d\.\-\*\s]+/, "").trim();
      // 移除引号
      cleaned = cleaned.replace(/[「」""'']/g, "");

      if (cleaned.length > 0 && cleaned.length < 50) {
        alternatives.push(cleaned);
      }
    }

    return alternatives.slice(0, 5); // 最多返回 5 个
  }

  /**
   * 解析批量替代方案
   */
  private parseBatchAlternatives(content: string): Map<string, string[]> {
    const results = new Map<string, string[]>();
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      // 匹配 "原表达 → 替代1 / 替代2 / 替代3" 格式
      const match = line.match(/^(.+?)\s*[→→:：]\s*(.+)$/);
      if (match) {
        const original = match[1].replace(/[「」""'']/g, "").trim();
        const alternatives = match[2]
          .split(/[\/\|,，、]/)
          .map((s) => s.replace(/[「」""'']/g, "").trim())
          .filter((s) => s.length > 0 && s.length < 50);

        if (original && alternatives.length > 0) {
          results.set(original, alternatives);
        }
      }
    }

    return results;
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      emotion: "情感表达",
      action: "动作描写",
      description: "环境描写",
      transition: "过渡语",
      dialogue: "对话",
    };
    return labels[type] || "表达";
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(request: AlternativeRequest): string {
    return `${request.type}:${request.expression}:${request.style || "default"}`;
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): string[] | null {
    const timestamp = this.cacheTimestamps.get(key);
    if (!timestamp || Date.now() - timestamp > this.cacheExpiry) {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
      return null;
    }
    return this.cache.get(key) || null;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, alternatives: string[]): void {
    this.cache.set(key, alternatives);
    this.cacheTimestamps.set(key, Date.now());
  }

  /**
   * 清除过期缓存
   */
  clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.cacheExpiry) {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
      }
    }
  }
}
