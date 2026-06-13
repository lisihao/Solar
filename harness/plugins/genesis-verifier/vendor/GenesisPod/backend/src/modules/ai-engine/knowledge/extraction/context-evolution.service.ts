/**
 * Context Evolution Service
 * 上下文演进服务 - AI Engine 核心能力
 *
 * 从完成的任务中提取已确立的事实，支持跨任务一致性校验
 * 这是通用能力，适用于任何类型的多步骤任务
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IContextEvolutionService,
  FactExtractionRequest,
  FactExtractionResult,
  EstablishedFact,
  ContextEvolutionConfig,
  DEFAULT_CONTEXT_EVOLUTION_CONFIG,
  FACT_CATEGORIES,
  FACT_IMPORTANCE_LEVELS,
} from "./context-evolution.types";
import type { AiCallerFn } from "@/modules/ai-engine/llm/types/ai-caller.types";

@Injectable()
export class ContextEvolutionService implements IContextEvolutionService {
  private readonly logger = new Logger(ContextEvolutionService.name);

  /**
   * 从任务输出中提取已确立的事实
   *
   * 这是通用的上下文演进机制：
   * - 不预设任何领域知识
   * - 让 AI 根据任务内容自动识别关键事实
   * - 支持任何类型的任务（小说、文档、研究等）
   */
  async extractFacts(
    request: FactExtractionRequest,
    aiCaller: AiCallerFn,
    config?: Partial<ContextEvolutionConfig>,
  ): Promise<FactExtractionResult> {
    const cfg = { ...DEFAULT_CONTEXT_EVOLUTION_CONFIG, ...config };

    // 如果输出太短，跳过提取
    if (request.taskOutput.length < cfg.minOutputLength) {
      this.logger.debug(
        `[extractFacts] Task output too short (${request.taskOutput.length} chars), skipping extraction`,
      );
      return { facts: [], tokensUsed: 0 };
    }

    // 构建已知信息（避免重复提取）
    const existingEntities = request.existingEntities || [];
    const existingFactStatements =
      request.existingFacts?.map((f) => f.statement) || [];

    // 截取任务输出（避免 token 过多）
    const truncatedOutput =
      request.taskOutput.length > cfg.maxOutputForExtraction
        ? request.taskOutput.substring(0, cfg.maxOutputForExtraction) +
          "\n...[内容已截断]"
        : request.taskOutput;

    const extractionPrompt = this.buildExtractionPrompt(
      request.taskTitle,
      truncatedOutput,
      existingEntities,
      existingFactStatements,
    );

    try {
      const response = await aiCaller(
        cfg.extractionModel, // 使用配置的模型进行提取
        [
          {
            role: "system",
            content:
              "你是一个专业的信息提取助手。请准确识别文本中的关键事实，输出结构化的 JSON 数据。",
          },
          { role: "user", content: extractionPrompt },
        ],
        {
          taskProfile: {
            creativity: "deterministic",
            outputLength: "medium",
          },
        },
      );

      // 解析 JSON
      const facts = this.parseFactsFromResponse(
        response.content,
        request.taskId,
        request.taskTitle,
        cfg,
      );

      this.logger.log(
        `[extractFacts] Extracted ${facts.length} facts from task "${request.taskTitle}"`,
      );

      return { facts, tokensUsed: response.tokensUsed };
    } catch (error) {
      this.logger.warn(
        `[extractFacts] Failed to extract facts: ${error instanceof Error ? error.message : error}`,
      );
      return { facts: [], tokensUsed: 0 };
    }
  }

  /**
   * 合并新事实到现有上下文
   *
   * 包含去重和数量限制逻辑
   */
  mergeFacts(
    existingFacts: EstablishedFact[],
    newFacts: EstablishedFact[],
    config?: Partial<ContextEvolutionConfig>,
  ): EstablishedFact[] {
    const cfg = { ...DEFAULT_CONTEXT_EVOLUTION_CONFIG, ...config };

    // 去重：基于 statement 相似性（简化方案）
    const existingStatements = new Set(
      existingFacts.map((f) => f.statement.toLowerCase().trim()),
    );

    const uniqueNewFacts = newFacts.filter(
      (f) => !existingStatements.has(f.statement.toLowerCase().trim()),
    );

    // 合并
    const allFacts = [...existingFacts, ...uniqueNewFacts];

    // 如果超过上限，需要裁剪
    if (allFacts.length <= cfg.maxFactsCount) {
      return allFacts;
    }

    // 裁剪策略：
    // 1. 优先保留所有 high importance（除非单独超过上限）
    // 2. 其次按时间保留最新的 medium
    // 3. 最后填充 low
    const highFacts = allFacts.filter((f) => f.importance === "high");
    const mediumFacts = allFacts.filter((f) => f.importance === "medium");
    const lowFacts = allFacts.filter((f) => f.importance === "low");

    // 按时间排序（最新在前）
    const sortByTime = (a: EstablishedFact, b: EstablishedFact) =>
      new Date(b.establishedAt).getTime() - new Date(a.establishedAt).getTime();

    highFacts.sort(sortByTime);
    mediumFacts.sort(sortByTime);
    lowFacts.sort(sortByTime);

    const result: EstablishedFact[] = [];

    // 1. 优先保留所有 high（除非单独超过上限）
    // 如果 high 事实数量超过上限，只保留最新的
    const highToKeep = Math.min(highFacts.length, cfg.maxFactsCount);
    result.push(...highFacts.slice(0, highToKeep));

    // 如果已满，直接返回
    if (result.length >= cfg.maxFactsCount) {
      this.logger.log(
        `[mergeFacts] High facts alone exceed limit, kept ${result.length} high facts`,
      );
      return result.slice(0, cfg.maxFactsCount);
    }

    // 2. 加入 medium（占剩余空间的 70%）
    const remaining1 = cfg.maxFactsCount - result.length;
    const maxMedium = Math.floor(remaining1 * 0.7);
    result.push(...mediumFacts.slice(0, maxMedium));

    // 3. 最后加入 low（填满剩余）
    const remaining2 = cfg.maxFactsCount - result.length;
    result.push(...lowFacts.slice(0, remaining2));

    this.logger.log(
      `[mergeFacts] Trimmed facts from ${allFacts.length} to ${result.length} (max: ${cfg.maxFactsCount})`,
    );

    return result;
  }

  /**
   * 构建已确立事实的提示词片段（用于审核）
   */
  buildFactsPromptSection(
    facts: EstablishedFact[],
    config?: Partial<ContextEvolutionConfig>,
  ): string {
    if (!facts || facts.length === 0) {
      return "";
    }

    const cfg = { ...DEFAULT_CONTEXT_EVOLUTION_CONFIG, ...config };

    // 按重要程度分组
    const highFacts = facts.filter((f) => f.importance === "high");
    const mediumFacts = facts.filter((f) => f.importance === "medium");

    const sections: string[] = [];

    if (highFacts.length > 0) {
      sections.push(
        `【🔴 必须遵守的已确立事实】\n` +
          highFacts
            .map(
              (f) =>
                `• [${f.sourceTaskTitle}] ${f.statement}${f.relatedEntities?.length ? ` (相关：${f.relatedEntities.join("、")})` : ""}`,
            )
            .join("\n"),
      );
    }

    if (mediumFacts.length > 0) {
      // 限制中等重要性事实数量
      const displayFacts = mediumFacts.slice(-cfg.maxMediumFactsDisplay);
      sections.push(
        `【🟡 应该遵守的已确立事实】\n` +
          displayFacts
            .map((f) => `• [${f.sourceTaskTitle}] ${f.statement}`)
            .join("\n") +
          (mediumFacts.length > cfg.maxMediumFactsDisplay
            ? `\n... 及其他 ${mediumFacts.length - cfg.maxMediumFactsDisplay} 条`
            : ""),
      );
    }

    if (sections.length === 0) {
      return "";
    }

    return `
═══════════════════════════════════════════
        跨任务一致性检查（必读）
═══════════════════════════════════════════

${sections.join("\n\n")}

⚠️ 审核时请特别注意：新内容是否与上述已确立事实矛盾？
`;
  }

  // ==================== 私有方法 ====================

  /**
   * 构建事实提取提示词
   */
  private buildExtractionPrompt(
    taskTitle: string,
    taskOutput: string,
    existingEntities: string[],
    existingFacts: string[],
  ): string {
    return `请从以下任务产出中提取【新确立的关键事实】。

【任务标题】
${taskTitle}

【任务产出】
${taskOutput}

${existingEntities.length > 0 ? `【已知实体】（无需重复提取）\n${existingEntities.join("、")}\n` : ""}
${existingFacts.length > 0 ? `【已确立事实】（无需重复提取）\n${existingFacts.slice(-10).join("\n")}\n` : ""}

请识别并输出本次任务中【新确立】的关键事实，格式如下（JSON数组）：

\`\`\`json
[
  {
    "statement": "事实陈述（简洁、具体）",
    "category": "类别",
    "relatedEntities": ["相关实体名"],
    "importance": "重要程度"
  }
]
\`\`\`

【类别说明】
- entity_state: 实体状态变化（如：人物处于某状态、系统配置了某功能）
- sequence_point: 序列点（如：时间推进到某节点、版本号确定）
- decision: 决策确定（如：采用某方案、情节走向）
- definition: 定义确定（如：术语定义、接口规格）
- relationship: 关系建立（如：A与B的关系、组件依赖）
- constraint_added: 新增约束（如：必须遵守的新规则）

【重要程度】
- high: 后续任务必须遵守，违反会导致严重不一致
- medium: 后续任务应该遵守
- low: 参考信息

【提取原则】
1. 只提取【具体、可验证】的事实，不要提取模糊描述
2. 只提取【本次新确立】的事实，不要重复已知信息
3. 每个事实应该是【独立可理解】的
4. 优先提取 high 重要程度的事实（如：时间线、人物身份、关键决策）
5. 如果没有新事实，返回空数组 []

请直接输出 JSON 数组，不要其他说明。`;
  }

  /**
   * 从 AI 响应中解析事实
   */
  private parseFactsFromResponse(
    content: string,
    taskId: string,
    taskTitle: string,
    config: ContextEvolutionConfig,
  ): EstablishedFact[] {
    // 解析 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : content;

    let parsed: unknown[];
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      this.logger.warn(
        `[parseFactsFromResponse] Failed to parse JSON: ${content.substring(0, 200)}`,
      );
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    // 转换为 EstablishedFact
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
      .map((item, index) => ({
        id: `EF-${taskId.substring(0, 8)}-${Date.now()}-${index + 1}`,
        sourceTaskId: taskId,
        sourceTaskTitle: taskTitle,
        establishedAt: new Date().toISOString(),
        statement: typeof item.statement === "string" ? item.statement : "",
        category: (FACT_CATEGORIES.includes(
          item.category as (typeof FACT_CATEGORIES)[number],
        )
          ? item.category
          : "definition") as EstablishedFact["category"],
        relatedEntities: Array.isArray(item.relatedEntities)
          ? item.relatedEntities.filter(
              (e): e is string => typeof e === "string",
            )
          : undefined,
        importance: (FACT_IMPORTANCE_LEVELS.includes(
          item.importance as (typeof FACT_IMPORTANCE_LEVELS)[number],
        )
          ? item.importance
          : "medium") as EstablishedFact["importance"],
      }))
      .filter((f) => f.statement.length >= config.minFactStatementLength);
  }
}
