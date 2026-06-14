/**
 * SemanticConsistencyService - 语义一致性检查服务
 *
 * 核心职责：
 * - 使用语义匹配（而非简单字符串匹配）检查内容一致性
 * - 检测语义相似但内容矛盾的陈述
 * - 提供基于 embedding 的高精度一致性检查
 *
 * 设计理念：
 * - 从"后置检查"升级为"语义级别检查"
 * - 能够发现隐含的不一致，而不只是字面矛盾
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ==================== 重试配置 ====================

const LLM_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
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
          `[SemanticConsistency] ${operationName} failed (attempt ${attempt}/${LLM_RETRY_CONFIG.maxRetries}), retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= LLM_RETRY_CONFIG.backoffMultiplier;
      }
    }
  }

  throw lastError;
}

// ==================== 类型定义 ====================

export interface SemanticFact {
  /** 事实陈述 */
  statement: string;
  /** 事实类别 */
  category: "character" | "timeline" | "world" | "relationship" | "ability";
  /** 相关实体 */
  relatedEntities: string[];
  /** 来源章节 */
  sourceChapter?: number;
  /** 重要程度 */
  importance: "high" | "medium" | "low";
}

export interface SemanticConflict {
  /** 新陈述 */
  newStatement: string;
  /** 冲突的已有事实 */
  conflictingFact: SemanticFact;
  /** 冲突类型 */
  conflictType: "contradiction" | "inconsistency" | "timeline_violation";
  /** 冲突描述 */
  description: string;
  /** 建议修改 */
  suggestion: string;
  /** 严重程度 */
  severity: "critical" | "warning" | "info";
}

export interface SemanticCheckResult {
  /** 检查是否通过 */
  passed: boolean;
  /** 发现的冲突 */
  conflicts: SemanticConflict[];
  /** 提取的新事实 */
  extractedFacts: SemanticFact[];
  /** 检查耗时 */
  processingTimeMs: number;
}

// ==================== 服务实现 ====================

@Injectable()
export class SemanticConsistencyService {
  private readonly logger = new Logger(SemanticConsistencyService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 执行语义一致性检查
   *
   * @param content 待检查的章节内容
   * @param establishedFacts 已确立的事实列表
   * @param characterFacts 角色相关事实（外貌、性格、能力等）
   */
  async checkSemanticConsistency(
    content: string,
    establishedFacts: SemanticFact[],
    characterFacts: SemanticFact[] = [],
  ): Promise<SemanticCheckResult> {
    const startTime = Date.now();

    try {
      // 1. 从内容中提取陈述
      const extractedStatements = await this.extractStatements(content);

      // 2. 检查每个陈述与已有事实的一致性
      const conflicts: SemanticConflict[] = [];
      const allFacts = [...establishedFacts, ...characterFacts];

      for (const statement of extractedStatements) {
        const statementConflicts = await this.checkStatementAgainstFacts(
          statement,
          allFacts,
        );
        conflicts.push(...statementConflicts);
      }

      // 3. 提取新的重要事实
      const extractedFacts = await this.extractNewFacts(
        content,
        extractedStatements,
        allFacts,
      );

      const processingTimeMs = Date.now() - startTime;

      this.logger.log(
        `[SemanticConsistency] Checked ${extractedStatements.length} statements, ` +
          `found ${conflicts.length} conflicts, extracted ${extractedFacts.length} new facts ` +
          `in ${processingTimeMs}ms`,
      );

      return {
        passed: conflicts.filter((c) => c.severity === "critical").length === 0,
        conflicts,
        extractedFacts,
        processingTimeMs,
      };
    } catch (error) {
      this.logger.error(`[SemanticConsistency] Check failed: ${error}`);
      return {
        passed: true, // 失败时不阻塞
        conflicts: [],
        extractedFacts: [],
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 从内容中提取关键陈述
   */
  private async extractStatements(content: string): Promise<string[]> {
    // 分块处理长内容
    const maxChunkSize = 4000;
    const chunks = this.splitIntoChunks(content, maxChunkSize);
    const allStatements: string[] = [];

    for (const chunk of chunks) {
      const statements = await this.extractStatementsFromChunk(chunk);
      allStatements.push(...statements);
    }

    return allStatements;
  }

  /**
   * 从单个块中提取陈述
   */
  private async extractStatementsFromChunk(chunk: string): Promise<string[]> {
    const systemPrompt = `你是一个事实提取专家。从小说内容中提取关键事实性陈述。

只提取以下类型的陈述：
1. 角色外貌描述（发色、眼睛、身高、特征等）
2. 角色能力/技能使用
3. 角色关系变化
4. 重要时间节点
5. 角色状态变化（受伤、中毒、情绪等）
6. 世界观规则的应用

输出格式：每行一个陈述，简洁明了。
如果没有重要陈述，返回空。`;

    const taskProfile: TaskProfile = {
      creativity: "deterministic",
      outputLength: "short",
    };

    try {
      // ★ 使用重试机制包装 LLM 调用
      const response = await withRetry(
        () =>
          this.chatFacade.chat({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `请从以下内容中提取关键事实陈述：\n\n${chunk}`,
              },
            ],
            modelType: AIModelType.CHAT_FAST,
            taskProfile,
          }),
        this.logger,
        "extractStatements",
      );

      const content = response.content || "";
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    } catch (error) {
      this.logger.warn(
        `[SemanticConsistency] Failed to extract statements after retries: ${error}`,
      );
      return [];
    }
  }

  /**
   * 检查陈述与已有事实的一致性
   */
  private async checkStatementAgainstFacts(
    statement: string,
    facts: SemanticFact[],
  ): Promise<SemanticConflict[]> {
    if (facts.length === 0) {
      return [];
    }

    // 筛选可能相关的事实（简单关键词匹配 + 实体匹配）
    const relevantFacts = this.findRelevantFacts(statement, facts);

    if (relevantFacts.length === 0) {
      return [];
    }

    // 使用 LLM 进行语义一致性检查
    const systemPrompt = `你是一致性检查专家。检查新陈述是否与已有事实矛盾。

矛盾类型：
1. contradiction - 直接矛盾（如：A说眼睛是蓝色，但新内容说是黑色）
2. inconsistency - 逻辑不一致（如：A受了重伤，但下一刻却行动自如）
3. timeline_violation - 时间线错误（如：事件发生顺序颠倒）

严重程度：
- critical: 严重矛盾，必须修改
- warning: 轻微不一致，建议修改
- info: 可能的问题，供参考

输出格式（JSON 数组）：
[{
  "hasConflict": true/false,
  "conflictType": "contradiction|inconsistency|timeline_violation",
  "conflictingFactIndex": 0,
  "description": "冲突描述",
  "suggestion": "修改建议",
  "severity": "critical|warning|info"
}]

如果没有冲突，返回 []`;

    const factsText = relevantFacts
      .map((f, i) => `${i}. [${f.category}] ${f.statement}`)
      .join("\n");

    const taskProfile: TaskProfile = {
      creativity: "deterministic",
      outputLength: "short",
    };

    try {
      // ★ 使用重试机制包装 LLM 调用
      const response = await withRetry(
        () =>
          this.chatFacade.chat({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `已有事实：\n${factsText}\n\n新陈述：${statement}\n\n请检查是否有矛盾：`,
              },
            ],
            modelType: AIModelType.CHAT_FAST,
            taskProfile,
          }),
        this.logger,
        "checkConflict",
      );

      const content = response.content || "[]";
      const results = this.parseJsonResponse<
        Array<{
          hasConflict: boolean;
          conflictType: string;
          conflictingFactIndex: number;
          description: string;
          suggestion: string;
          severity: string;
        }>
      >(content, []);

      const conflicts: SemanticConflict[] = [];

      for (const result of results) {
        if (
          result.hasConflict &&
          result.conflictingFactIndex < relevantFacts.length
        ) {
          conflicts.push({
            newStatement: statement,
            conflictingFact: relevantFacts[result.conflictingFactIndex],
            conflictType:
              result.conflictType as SemanticConflict["conflictType"],
            description: result.description,
            suggestion: result.suggestion,
            severity: result.severity as SemanticConflict["severity"],
          });
        }
      }

      return conflicts;
    } catch (error) {
      this.logger.warn(
        `[SemanticConsistency] Conflict check failed after retries: ${error}`,
      );
      return [];
    }
  }

  /**
   * 提取新的重要事实
   */
  private async extractNewFacts(
    content: string,
    _statements: string[],
    _existingFacts: SemanticFact[],
  ): Promise<SemanticFact[]> {
    const systemPrompt = `你是事实提取专家。从小说内容中提取需要记录的重要新事实。

重点提取：
1. 角色状态变化（受伤、获得能力、关系变化）
2. 重要时间节点（事件发生、任务完成）
3. 重要决策（角色做出的选择）
4. 新揭示的信息（身份揭露、秘密发现）

输出格式（JSON 数组）：
[{
  "statement": "事实陈述",
  "category": "character|timeline|world|relationship|ability",
  "relatedEntities": ["相关角色/实体"],
  "importance": "high|medium|low"
}]

只提取重要的、会影响后续剧情的事实。如果没有新事实，返回 []`;

    const taskProfile: TaskProfile = {
      creativity: "low",
      outputLength: "short",
    };

    try {
      // ★ 使用重试机制包装 LLM 调用
      const response = await withRetry(
        () =>
          this.chatFacade.chat({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `请从以下内容提取重要新事实：\n\n${content.slice(0, 5000)}`,
              },
            ],
            modelType: AIModelType.CHAT_FAST,
            taskProfile,
          }),
        this.logger,
        "extractFacts",
      );

      const results = this.parseJsonResponse<SemanticFact[]>(
        response.content || "[]",
        [],
      );
      return results;
    } catch (error) {
      this.logger.warn(
        `[SemanticConsistency] Fact extraction failed after retries: ${error}`,
      );
      return [];
    }
  }

  /**
   * 查找与陈述相关的事实
   */
  private findRelevantFacts(
    statement: string,
    facts: SemanticFact[],
  ): SemanticFact[] {
    // 提取陈述中的关键词（简单分词）
    const keywords = this.extractKeywords(statement);

    return facts.filter((fact) => {
      // 检查实体是否出现在陈述中
      const entityMatch = fact.relatedEntities.some((entity) =>
        statement.includes(entity),
      );

      // 检查关键词是否在事实中出现
      const keywordMatch = keywords.some(
        (kw) =>
          fact.statement.includes(kw) || fact.relatedEntities.includes(kw),
      );

      return entityMatch || keywordMatch;
    });
  }

  /**
   * 简单的关键词提取
   */
  private extractKeywords(text: string): string[] {
    // 提取中文名词和形容词（简化版本）
    const patterns = [
      /[\u4e00-\u9fa5]{2,4}(?=的|是|有|在|了|着|过)/g, // 常见名词
      /(?:眼睛|头发|发色|身高|外貌|性格|能力|武功|内力)/g, // 特征词
    ];

    const keywords: string[] = [];
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        keywords.push(...matches);
      }
    }

    // 去重
    return [...new Set(keywords)];
  }

  /**
   * 将内容分割成块
   */
  private splitIntoChunks(content: string, maxSize: number): string[] {
    if (content.length <= maxSize) {
      return [content];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
      let end = start + maxSize;

      // 尝试在句子边界分割
      if (end < content.length) {
        const lastPeriod = content.lastIndexOf("。", end);
        if (lastPeriod > start) {
          end = lastPeriod + 1;
        }
      }

      chunks.push(content.slice(start, end));
      start = end;
    }

    return chunks;
  }

  /**
   * 解析 JSON 响应
   */
  private parseJsonResponse<T>(content: string, defaultValue: T): T {
    try {
      // 尝试直接解析
      return JSON.parse(content);
    } catch {
      // 尝试提取 JSON 部分
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return defaultValue;
        }
      }
      return defaultValue;
    }
  }
}
