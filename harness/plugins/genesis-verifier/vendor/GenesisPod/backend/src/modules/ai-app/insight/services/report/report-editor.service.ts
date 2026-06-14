/**
 * Report Editor Service
 *
 * 跨维度编辑层：在报告合成前对各维度内容进行编辑处理
 *
 * 核心职责：
 * 1. 跨维度语义去重 — 检测不同维度间重复的核心论点和数据
 * 2. 过渡段落生成 — 在维度间添加衔接过渡
 * 3. 全局一致性校验 — 确保数据引用在各维度间一致
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import type { DimensionAnalysisInput } from "../../types/report.types";

/**
 * 编辑结果
 */
export interface EditedDimensionInputs {
  /** 编辑后的维度输入 */
  dimensions: DimensionAnalysisInput[];
  /** 去重统计 */
  deduplicationStats: {
    /** 检测到的重复论点数 */
    duplicateClaims: number;
    /** 删除的重复段落数 */
    removedParagraphs: number;
    /** 受影响的维度名称 */
    affectedDimensions: string[];
  };
  /** 添加的过渡说明 */
  transitions: Array<{
    fromDimension: string;
    toDimension: string;
    transitionText: string;
  }>;
  /** V5: 术语一致性问题 */
  terminologyIssues?: Array<{
    term: string;
    variants: string[];
    standardForm: string;
    affectedDimensions: string[];
  }>;
  /** V5: 数据一致性问题 */
  dataConsistencyIssues?: Array<{
    dataPoint: string;
    values: Array<{ dimension: string; value: string; source: string }>;
    resolution: string;
  }>;
}

/**
 * 跨维度去重检查结果
 */
interface DeduplicationCheckResult {
  duplicates: Array<{
    claim: string;
    dimensions: string[];
    keepIn: string;
    removeFrom: string[];
    paragraphHints: string[];
  }>;
  suggestions: string[];
  /** V5: 术语一致性问题 */
  terminologyIssues?: Array<{
    term: string;
    variants: string[];
    standardForm: string;
    affectedDimensions: string[];
  }>;
  /** V5: 数据一致性问题 */
  dataConsistencyIssues?: Array<{
    dataPoint: string;
    values: Array<{ dimension: string; value: string; source: string }>;
    resolution: string;
  }>;
}

const DEDUP_CHECK_PROMPT = `你是报告编辑专家，负责检查跨维度的内容重复。

## 任务
分析以下多个维度的研究内容，找出重复的核心论点、数据引用和段落。

## 各维度内容摘要
{dimensionSummaries}

## 输出要求
输出 JSON 格式：

\`\`\`json
{
  "duplicates": [
    {
      "claim": "重复的论点或数据描述",
      "dimensions": ["出现在哪些维度"],
      "keepIn": "应保留在哪个维度（最相关的）",
      "removeFrom": ["应从哪些维度删除"],
      "paragraphHints": ["包含该重复内容的段落开头几个字（便于定位）"]
    }
  ],
  "suggestions": ["编辑建议"]
}
\`\`\`

## 检查规则
1. 只标记实质性重复（相同数据点、相同结论），忽略通用术语
2. 保留论点在最相关的维度中，从其他维度删除
3. 如果同一数据被不同维度从不同角度引用，不算重复
4. paragraphHints 取段落前 30 个字符，便于程序定位
5. **数据点重复检测**：特别注意检查不同维度是否引用了完全相同的统计数据（如相同的百分比、金额、增长率），即使措辞不同也应标记为重复
6. 当检测到重复的统计数据时，在 paragraphHints 中同时包含两个维度的相关段落前 30 字符

## 非重复示例（以下场景不应标记为重复）
- 维度A: "全球市场规模达100亿美元" vs 维度B: "中国市场占比30%，约30亿美元" → 统计口径不同，保留两者
- 维度A: "技术X在医疗领域的应用" vs 维度B: "技术X的核心算法原理" → 角度不同，保留两者
- 维度A: "2025年用户增长50%" vs 维度B: "用户增长带来的运营挑战" → 前者是数据，后者是分析，保留两者

## 额外检查（V5 增强）

除了内容去重，还需检查：

### 术语一致性
- 同一概念在不同维度是否使用相同术语？
- 缩写是否在首次出现时展开？

### 数据一致性
- 同一数据点在不同维度的引用是否一致？
- 数据的时间范围和统计口径是否匹配？

在 JSON 输出中新增：

\`\`\`json
{
  "terminologyIssues": [
    {
      "term": "术语A",
      "variants": ["变体1", "变体2"],
      "standardForm": "统一形式",
      "affectedDimensions": ["维度1", "维度2"]
    }
  ],
  "dataConsistencyIssues": [
    {
      "dataPoint": "数据描述",
      "values": [
        {"dimension": "维度1", "value": "值1", "source": "来源1"},
        {"dimension": "维度2", "value": "值2", "source": "来源2"}
      ],
      "resolution": "建议统一为哪个值"
    }
  ]
}
\`\`\`
`;

@Injectable()
export class ReportEditorService {
  private readonly logger = new Logger(ReportEditorService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 编辑维度内容：跨维度去重 + 过渡生成
   *
   * 在 ReportSynthesisService.synthesizeReport() 调用 buildFullReportFromDimensions() 之前调用
   */
  async editDimensionInputs(
    dimensionInputs: DimensionAnalysisInput[],
    topicName: string,
  ): Promise<EditedDimensionInputs> {
    if (dimensionInputs.length <= 1) {
      return {
        dimensions: dimensionInputs,
        deduplicationStats: {
          duplicateClaims: 0,
          removedParagraphs: 0,
          affectedDimensions: [],
        },
        transitions: [],
      };
    }

    this.logger.log(
      `[editDimensionInputs] Editing ${dimensionInputs.length} dimensions for topic: ${topicName}`,
    );

    // 1. 跨维度去重检查
    const dedupResult =
      await this.checkCrossDimensionDuplicates(dimensionInputs);

    // 2. 应用去重
    let removedParagraphs = 0;
    const affectedDimensions = new Set<string>();
    const editedDimensions = dimensionInputs.map((dim) => ({ ...dim }));

    if (dedupResult && dedupResult.duplicates.length > 0) {
      this.logger.log(
        `[editDimensionInputs] Found ${dedupResult.duplicates.length} duplicate claims`,
      );
      if (dedupResult.terminologyIssues?.length) {
        this.logger.log(
          `[editDimensionInputs] Found ${dedupResult.terminologyIssues.length} terminology inconsistencies`,
        );
      }
      if (dedupResult.dataConsistencyIssues?.length) {
        this.logger.log(
          `[editDimensionInputs] Found ${dedupResult.dataConsistencyIssues.length} data consistency issues`,
        );
      }

      for (const dup of dedupResult.duplicates) {
        for (const removeDim of dup.removeFrom) {
          const dimInput = editedDimensions.find(
            (d) => d.dimensionName === removeDim,
          );
          if (!dimInput?.detailedContent) continue;

          // 使用段落提示定位并删除重复段落
          // 先 split 一次，所有 hints 共用同一数组避免重复 split
          let paragraphs = dimInput.detailedContent.split("\n\n");
          for (const hint of dup.paragraphHints) {
            if (!hint || hint.length < 10) continue;
            // 归一化：去除首尾空白和多余空格
            const hintNorm = hint.trim().replace(/\s+/g, " ");
            paragraphs = paragraphs.filter((p) => {
              const trimmed = p.trim();
              // 跳过标题
              if (trimmed.startsWith("#")) return true;
              const pNorm = trimmed.replace(/\s+/g, " ");
              // 检查段落是否以提示开头（归一化后比较）
              if (pNorm.startsWith(hintNorm)) {
                removedParagraphs++;
                affectedDimensions.add(removeDim);
                this.logger.debug(
                  `[editDimensionInputs] Removed duplicate paragraph from "${removeDim}": "${hintNorm.substring(0, 40)}..."`,
                );
                return false;
              }
              return true;
            });
          }
          dimInput.detailedContent = paragraphs.join("\n\n");
        }

        // ★ 数据点重复日志告警
        if (
          dup.claim &&
          /\d{2,}[%％]|\d+\.\d+[%％]|\$[\d,]{2,}|[\d,]{2,}亿|[\d.]+\s*billion/i.test(
            dup.claim,
          )
        ) {
          this.logger.warn(
            `[editDimensionInputs] ⚠ Duplicate statistics detected: "${dup.claim}" in dimensions: [${dup.dimensions.join(", ")}], kept in: ${dup.keepIn}`,
          );
        }
      }
    }

    // 3. 生成维度间过渡
    const transitions = this.generateTransitionHints(editedDimensions);

    this.logger.log(
      `[editDimensionInputs] Editing complete: removed ${removedParagraphs} paragraphs, ` +
        `${affectedDimensions.size} dimensions affected, ${transitions.length} transitions suggested`,
    );

    return {
      dimensions: editedDimensions,
      deduplicationStats: {
        duplicateClaims: dedupResult?.duplicates.length || 0,
        removedParagraphs,
        affectedDimensions: Array.from(affectedDimensions),
      },
      transitions,
      terminologyIssues: dedupResult?.terminologyIssues,
      dataConsistencyIssues: dedupResult?.dataConsistencyIssues,
    };
  }

  /**
   * 使用 AI 检查跨维度重复
   */
  private async checkCrossDimensionDuplicates(
    dimensionInputs: DimensionAnalysisInput[],
  ): Promise<DeduplicationCheckResult | null> {
    // 构建维度摘要（限制长度避免 token 溢出）
    const dimensionSummaries = dimensionInputs
      .map((dim) => {
        const contentPreview = (
          dim.detailedContent ||
          dim.summary ||
          ""
        ).substring(0, 2000);
        const keyFindings = dim.keyFindings
          ?.slice(0, 3)
          .map((f) => f.finding)
          .join("; ");
        return `### ${dim.dimensionName}\n**关键发现**: ${keyFindings || "无"}\n**内容预览**: ${contentPreview}`;
      })
      .join("\n\n---\n\n");

    try {
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          {
            role: "system",
            content: "你是报告编辑专家，负责检查跨维度内容重复。",
          },
          {
            role: "user",
            content: DEDUP_CHECK_PROMPT.replace(
              "{dimensionSummaries}",
              dimensionSummaries,
            ),
          },
        ],
        operationName: "报告润色",
        additionalSkills: ["dedup-checker"],
        modelType: AIModelType.CHAT,
        skipGuardrails: true, // 内部系统调用，报告去重检查
        cachePolicy: "auto",
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
        responseFormat: "json",
      });

      const result = extractJsonFromAIResponse<DeduplicationCheckResult>(
        response.content,
      );

      if (result.success && result.data) {
        return result.data;
      }
    } catch (error) {
      this.logger.warn(
        `[checkCrossDimensionDuplicates] AI check failed (non-fatal): ${error}`,
      );
    }

    return null;
  }

  /**
   * 生成维度间过渡提示
   * 基于相邻维度的内容关联性，生成简单的过渡说明
   */
  private generateTransitionHints(
    dimensionInputs: DimensionAnalysisInput[],
  ): Array<{
    fromDimension: string;
    toDimension: string;
    transitionText: string;
  }> {
    const transitions: Array<{
      fromDimension: string;
      toDimension: string;
      transitionText: string;
    }> = [];

    for (let i = 0; i < dimensionInputs.length - 1; i++) {
      const current = dimensionInputs[i];
      const next = dimensionInputs[i + 1];

      // 简单的基于名称的过渡生成
      transitions.push({
        fromDimension: current.dimensionName,
        toDimension: next.dimensionName,
        transitionText: `在深入分析了${current.dimensionName}之后，接下来我们将视角转向${next.dimensionName}，进一步探讨其对整体研究主题的影响。`,
      });
    }

    return transitions;
  }
}
