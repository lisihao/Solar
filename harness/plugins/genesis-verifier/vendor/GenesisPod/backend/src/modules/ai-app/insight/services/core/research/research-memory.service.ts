/**
 * Research Memory Service
 *
 * 负责研究记忆的提取、存储和检索：
 * - extractAndStoreFindings: 从完成的研究中提取关键发现
 * - getRelevantMemories: 检索相关的先前发现
 * - getMemorySummary: 获取专题的记忆摘要
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";

interface ExtractedFinding {
  entity: string;
  finding: string;
  category: "fact" | "trend" | "relationship" | "contradiction";
  confidence: number;
  sourceDimension?: string;
  sourceUrls: string[];
  tags: string[];
}

interface ExtractionResult {
  findings: ExtractedFinding[];
}

@Injectable()
export class ResearchMemoryService implements OnModuleDestroy {
  private readonly logger = new Logger(ResearchMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 清理资源
   */
  onModuleDestroy(): void {
    // ResearchMemoryService 不持有长期资源
    this.logger.debug("[onModuleDestroy] Research memory service destroyed");
  }

  /**
   * 从完成的研究任务中提取并存储关键发现
   */
  async extractAndStoreFindings(
    missionId: string,
    topicId: string,
  ): Promise<number> {
    this.logger.log(
      `[extractAndStoreFindings] Extracting findings from mission ${missionId}`,
    );

    try {
      // 1. 加载 Mission 及其已完成的任务
      const mission = await this.prisma.researchMission.findUnique({
        where: { id: missionId },
        include: {
          tasks: {
            where: {
              status: "COMPLETED",
              taskType: "dimension_research",
            },
            select: {
              id: true,
              dimensionName: true,
              result: true,
              // ★ 必须同时 select resultUri，否则 PrismaService hydrate
              //   middleware 拉不回 off-loaded 内容（result 会是空 JSON）
              //   并打 warning。
              resultUri: true,
              resultSummary: true,
            },
          },
        },
      });

      if (!mission || mission.tasks.length === 0) {
        this.logger.warn(
          `[extractAndStoreFindings] No completed tasks found for mission ${missionId}`,
        );
        return 0;
      }

      // 2. 构建任务结果摘要（限制长度以避免 token 溢出）
      const taskResults = mission.tasks.map((task) => {
        const result = task.result as Record<string, unknown> | null;
        return {
          dimensionName: task.dimensionName || "未知维度",
          summary:
            (result?.["summary"] as string | undefined) ||
            task.resultSummary ||
            "无摘要",
          keyFindings:
            (result?.["keyFindings"] as unknown[] | undefined)?.slice(0, 5) ||
            (
              (
                result?.["analysisResult"] as
                  | Record<string, unknown>
                  | undefined
              )?.["keyFindings"] as unknown[] | undefined
            )?.slice(0, 5) ||
            [],
          trends:
            (result?.["trends"] as unknown[] | undefined)?.slice(0, 3) || [],
          challenges:
            (result?.["challenges"] as unknown[] | undefined)?.slice(0, 3) ||
            [],
        };
      });

      // 3. 使用 AI 提取关键发现
      const extractionPrompt = this.buildExtractionPrompt(taskResults);

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content:
              "你是研究知识提取专家，负责从研究结果中提取可复用的关键发现。请输出 JSON 格式。",
          },
          { role: "user", content: extractionPrompt },
        ],
        operationName: "记忆提取",
        skipGuardrails: true, // 内部系统调用，研究结果提取
        taskProfile: {
          creativity: "deterministic",
          outputLength: "long",
          responseFormat: "json",
        },
      });

      if (!response?.content) {
        this.logger.error(
          "[extractAndStoreFindings] AI returned empty response",
        );
        return 0;
      }

      // 4. 解析响应
      const extractionResult = extractJsonFromAIResponse<ExtractionResult>(
        response.content,
        { requiredKey: "findings" },
      );

      if (!extractionResult.success || !extractionResult.data?.findings) {
        this.logger.error(
          `[extractAndStoreFindings] Failed to parse findings: ${extractionResult.error}`,
        );
        return 0;
      }

      const findings = extractionResult.data.findings;
      this.logger.log(
        `[extractAndStoreFindings] Extracted ${findings.length} findings`,
      );

      // 5. 存储发现到数据库（使用批量插入以保证原子性）
      // ★ 过滤无效数据（LLM 提取的 findings 可能有空字段）
      const findingsData = findings
        .filter((f) => f.entity && f.finding && f.category)
        .map((finding) => ({
          topicId,
          missionId,
          entity: finding.entity.slice(0, 500),
          finding: finding.finding,
          category: finding.category,
          confidence: Math.max(0, Math.min(1, finding.confidence || 0.5)),
          sourceDimension: finding.sourceDimension || null,
          sourceUrls: finding.sourceUrls || [],
          tags: finding.tags || [],
        }));

      if (findingsData.length < findings.length) {
        this.logger.warn(
          `[extractAndStoreFindings] Filtered out ${findings.length - findingsData.length} invalid findings (empty entity/finding/category)`,
        );
      }

      let storedCount = 0;
      try {
        const result = await this.prisma.researchMemory.createMany({
          data: findingsData,
          skipDuplicates: true,
        });
        storedCount = result.count;
      } catch (error) {
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === "P2021"
        ) {
          this.logger.warn(
            "[extractAndStoreFindings] research_memories table does not exist yet, skipping storage",
          );
        } else {
          this.logger.error(
            `[extractAndStoreFindings] Batch insert failed (${error instanceof PrismaClientKnownRequestError ? `code: ${error.code}` : "unknown"}): ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }

      this.logger.log(
        `[extractAndStoreFindings] Stored ${storedCount}/${findings.length} findings`,
      );
      return storedCount;
    } catch (error) {
      this.logger.error(
        `[extractAndStoreFindings] Error extracting findings: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return 0;
    }
  }

  /**
   * 检索相关的先前发现
   */
  async getRelevantMemories(
    query: string,
    topicId?: string,
    limit: number = 10,
  ): Promise<
    Array<{
      entity: string;
      finding: string;
      category: string;
      confidence: number;
      tags: string[];
      sourceDimension?: string | null;
    }>
  > {
    this.logger.log(
      `[getRelevantMemories] Searching for memories related to: "${query}"`,
    );

    try {
      // 简单的关键词匹配（生产环境应使用向量搜索）
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((k) => k.length > 1);

      const memories = await this.prisma.researchMemory.findMany({
        where: {
          ...(topicId && { topicId }),
          OR: [
            { entity: { contains: query, mode: "insensitive" } },
            { finding: { contains: query, mode: "insensitive" } },
            { tags: { hasSome: keywords } },
          ],
        },
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: limit,
        select: {
          entity: true,
          finding: true,
          category: true,
          confidence: true,
          tags: true,
          sourceDimension: true,
        },
      });

      this.logger.log(
        `[getRelevantMemories] Found ${memories.length} relevant memories`,
      );
      return memories;
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2021"
      ) {
        this.logger.warn(
          "[getRelevantMemories] research_memories table does not exist yet",
        );
        return [];
      }
      this.logger.error(
        `[getRelevantMemories] Error retrieving memories: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return [];
    }
  }

  /**
   * 获取专题的记忆摘要
   */
  async getMemorySummary(topicId: string): Promise<string> {
    this.logger.log(
      `[getMemorySummary] Getting memory summary for topic ${topicId}`,
    );

    try {
      const memories = await this.prisma.researchMemory.findMany({
        where: { topicId },
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          entity: true,
          finding: true,
          category: true,
          confidence: true,
        },
      });

      if (memories.length === 0) {
        return "暂无先前研究记忆。";
      }

      // 按类别分组
      const byCategory = memories.reduce(
        (acc, m) => {
          if (!acc[m.category]) {
            acc[m.category] = [];
          }
          acc[m.category].push(`- **${m.entity}**: ${m.finding}`);
          return acc;
        },
        {} as Record<string, string[]>,
      );

      // 构建摘要
      const sections = Object.entries(byCategory).map(([category, items]) => {
        const categoryLabel =
          category === "fact"
            ? "事实"
            : category === "trend"
              ? "趋势"
              : category === "relationship"
                ? "关系"
                : "矛盾";
        return `### ${categoryLabel}\n${items.slice(0, 5).join("\n")}`;
      });

      return `## 先前研究发现\n\n${sections.join("\n\n")}`;
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2021"
      ) {
        this.logger.warn(
          "[getMemorySummary] research_memories table does not exist yet",
        );
        return "暂无先前研究记忆。";
      }
      this.logger.error(
        `[getMemorySummary] Error generating summary: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return "获取先前研究记忆失败。";
    }
  }

  /**
   * 构建提取 prompt
   */
  private buildExtractionPrompt(
    taskResults: Array<{
      dimensionName: string;
      summary: string;
      keyFindings: unknown[];
      trends: unknown[];
      challenges: unknown[];
    }>,
  ): string {
    const resultsText = taskResults
      .map((task) => {
        return `## 维度: ${task.dimensionName}

**摘要**: ${task.summary}

**关键发现**:
${task.keyFindings
  .map((f, i) => {
    const fr = f as Record<string, unknown>;
    return `${i + 1}. ${typeof f === "string" ? f : fr["finding"] || fr["title"] || JSON.stringify(f)}`;
  })
  .join("\n")}

**趋势**:
${task.trends
  .map((t, i) => {
    const tr = t as Record<string, unknown>;
    return `${i + 1}. ${typeof t === "string" ? t : tr["description"] || JSON.stringify(t)}`;
  })
  .join("\n")}

**挑战**:
${task.challenges
  .map((c, i) => {
    const cr = c as Record<string, unknown>;
    return `${i + 1}. ${typeof c === "string" ? c : cr["description"] || JSON.stringify(c)}`;
  })
  .join("\n")}
`;
      })
      .join("\n\n---\n\n");

    return `你是研究知识提取专家。请从以下研究结果中提取可复用的关键发现。

# 研究结果

${resultsText}

# 提取要求

请提取以下类型的知识：
1. **事实 (fact)**: 确凿的数据、定义、历史事件
2. **趋势 (trend)**: 发展方向、变化模式
3. **关系 (relationship)**: 实体间的因果、关联、对比关系
4. **矛盾 (contradiction)**: 冲突的观点、不一致的数据

每个发现包含：
- **entity**: 核心实体/概念（如 "GPT-4", "AI监管", "自动驾驶"）
- **finding**: 发现内容（1-2句话）
- **category**: 类别（fact/trend/relationship/contradiction）
- **confidence**: 置信度（0.6-1.0）
- **sourceDimension**: 来源维度名称（可选）
- **sourceUrls**: 参考 URL 列表（提取自原始数据，如无则为空数组）
- **tags**: 相关标签（3-5个关键词）

# 输出格式

JSON 格式：
\`\`\`json
{
  "findings": [
    {
      "entity": "实体名称",
      "finding": "发现描述",
      "category": "fact",
      "confidence": 0.9,
      "sourceDimension": "维度名称",
      "sourceUrls": [],
      "tags": ["标签1", "标签2", "标签3"]
    }
  ]
}
\`\`\`

请提取 10-20 个最重要的发现。`;
  }
}
