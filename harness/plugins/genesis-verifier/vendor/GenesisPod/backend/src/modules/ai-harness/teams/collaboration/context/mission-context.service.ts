import { Injectable, Logger } from "@nestjs/common";
import {
  MissionContextPackage,
  validateContextPackage,
  createEmptyContextPackage,
} from "@/modules/ai-harness/teams/abstractions";
import { EstablishedFact } from "@/modules/ai-harness/runner/executor/executor.types";

/**
 * Mission Context Service
 *
 * 负责：
 * 1. 从 Leader 输出中提取结构化的 Mission Context Package (JSON)
 * 2. 构建包含上下文的 Agent System Prompt
 * 3. 校验任务输出是否符合上下文约束
 */
@Injectable()
export class MissionContextService {
  private readonly logger = new Logger(MissionContextService.name);

  // ==================== Leader 输出解析 ====================

  /**
   * 从 Leader 输出中提取 Mission Context Package
   */
  extractContextFromLeaderOutput(
    leaderOutput: string,
    leaderId: string,
  ): MissionContextPackage | null {
    // 尝试提取 JSON 代码块
    const jsonMatch = leaderOutput.match(/```json\s*([\s\S]*?)\s*```/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const validated = validateContextPackage(parsed);

        if (validated) {
          validated.generatedBy = leaderId;
          validated.generatedAt = new Date().toISOString();
          this.logger.log(
            `Successfully extracted Mission Context Package with ${validated.entities.length} entities, ${validated.hardConstraints.length} constraints`,
          );
          return validated;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse JSON from Leader output: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    // 降级：尝试从自然语言中提取
    this.logger.warn(
      "No JSON block found in Leader output, attempting natural language extraction",
    );
    return this.extractContextFromNaturalLanguage(leaderOutput, leaderId);
  }

  /**
   * 从自然语言中提取上下文（降级方案）
   */
  private extractContextFromNaturalLanguage(
    content: string,
    leaderId: string,
  ): MissionContextPackage | null {
    const context = createEmptyContextPackage(leaderId);

    // 提取任务理解
    const understandingMatch = content.match(
      /(?:任务理解|任务背景|总体理解)[：:]\s*([^\n]+)/,
    );
    if (understandingMatch) {
      context.understanding.summary = understandingMatch[1].trim();
    }

    // 提取硬性约束
    const constraintPatterns = [
      /(?:硬性约束|必须遵循|强制要求)[：:]?\s*\n((?:[-•*\d]\s*[^\n]+\n?)+)/gi,
      /(?:约束条件|规则要求)[：:]?\s*\n((?:[-•*\d]\s*[^\n]+\n?)+)/gi,
    ];

    for (const pattern of constraintPatterns) {
      const match = content.match(pattern);
      if (match) {
        const lines = match[1].split("\n").filter((line) => line.trim());
        for (const line of lines) {
          const rule = line.replace(/^[-•*\d.、]+\s*/, "").trim();
          if (rule.length > 3) {
            context.hardConstraints.push({
              id: `HC-${context.hardConstraints.length + 1}`,
              rule,
              severity: "MUST",
            });
          }
        }
        break;
      }
    }

    // 提取禁止事项
    const prohibitionPatterns = [
      /(?:禁止事项|不能|禁止)[：:]?\s*\n((?:[-•*\d]\s*[^\n]+\n?)+)/gi,
      /(禁止|不能|不要|切勿|严禁)[^，。！？\n]{5,50}/g,
    ];

    for (const pattern of prohibitionPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const desc = match[1] || match[0];
        if (
          desc.length > 5 &&
          !context.prohibitions.some((p) => p.description.includes(desc))
        ) {
          context.prohibitions.push({
            description: desc.replace(/^[-•*\d.、]+\s*/, "").trim(),
          });
        }
      }
    }

    // 提取实体（人物/概念等）
    // 查找表格形式的实体定义
    const tablePattern = /\|([^|]+)\|([^|]+)\|([^|]+)\|/g;
    const tableMatches = content.matchAll(tablePattern);
    for (const match of tableMatches) {
      const name = match[1].trim();
      const type = match[2].trim();
      const definition = match[3].trim();

      // 跳过表头
      if (
        name.includes("名") ||
        name.includes("---") ||
        type.includes("类型") ||
        type.includes("---")
      ) {
        continue;
      }

      if (name.length > 0 && definition.length > 0) {
        context.entities.push({
          name,
          type: type || "未知",
          definition,
        });
      }
    }

    // 如果提取到了有意义的内容，返回
    if (
      context.hardConstraints.length > 0 ||
      context.entities.length > 0 ||
      context.prohibitions.length > 0
    ) {
      this.logger.log(
        `Extracted context from natural language: ${context.entities.length} entities, ${context.hardConstraints.length} constraints`,
      );
      return context;
    }

    return null;
  }

  // ==================== Agent Prompt 构建 ====================

  /**
   * 构建包含上下文的 Agent System Prompt
   */
  buildAgentSystemPromptWithContext(
    agent: {
      displayName: string;
      agentName?: string;
      agentIdentity?: string;
      roleDescription?: string;
      expertiseAreas?: string[];
    },
    task: {
      title: string;
      description?: string;
    },
    context: MissionContextPackage | null,
    missionDescription?: string,
  ): string {
    const agentName = agent.agentName || agent.displayName;
    const identity =
      agent.agentIdentity || agent.roleDescription || "专业团队成员";
    const expertise = agent.expertiseAreas?.join("、") || "多个领域";

    // 提取任务背景摘要（如果有 mission description）
    const backgroundSection = this.extractMissionBackground(missionDescription);

    // 如果没有上下文也没有背景，返回简单的 prompt
    if (!context && !backgroundSection) {
      return `你是「${agentName}」，团队成员。
身份：${identity}
擅长：${expertise}
当前任务：${task.title}`;
    }

    // 构建各个区块
    const blocks: string[] = [];

    // 以下区块仅在有 context 时构建
    if (context) {
      // 硬性约束区块
      if (context.hardConstraints.length > 0) {
        const mustConstraints = context.hardConstraints.filter(
          (c) => c.severity === "MUST",
        );
        const shouldConstraints = context.hardConstraints.filter(
          (c) => c.severity === "SHOULD",
        );

        let constraintBlock = "【🚫 硬性约束 - 违反将导致任务失败】\n";
        if (mustConstraints.length > 0) {
          constraintBlock += mustConstraints
            .map((c) => `• [${c.id}] ${c.rule}`)
            .join("\n");
        }
        if (shouldConstraints.length > 0) {
          constraintBlock += "\n\n【建议遵循】\n";
          constraintBlock += shouldConstraints
            .map((c) => `• [${c.id}] ${c.rule}`)
            .join("\n");
        }
        blocks.push(constraintBlock);
      }

      // 实体定义区块
      if (context.entities.length > 0) {
        let entityBlock = "【📋 核心定义 - 必须严格遵循】\n";
        for (const entity of context.entities) {
          entityBlock += `• ${entity.name}（${entity.type}）：${entity.definition}`;
          if (entity.attributes && Object.keys(entity.attributes).length > 0) {
            const attrs = Object.entries(entity.attributes)
              .map(([k, v]) => `${k}=${v}`)
              .join("，");
            entityBlock += `\n  属性：${attrs}`;
          }
          if (entity.relations && entity.relations.length > 0) {
            const rels = entity.relations
              .map((r) => `${r.relation} ${r.target}`)
              .join("，");
            entityBlock += `\n  关系：${rels}`;
          }
          entityBlock += "\n";
        }
        blocks.push(entityBlock.trim());
      }

      // 禁止事项区块
      if (context.prohibitions.length > 0) {
        let prohibitionBlock = "【⛔ 禁止事项】\n";
        prohibitionBlock += context.prohibitions
          .map((p) => {
            let line = `• ${p.description}`;
            if (p.reason) {
              line += `（原因：${p.reason}）`;
            }
            return line;
          })
          .join("\n");
        blocks.push(prohibitionBlock);
      }

      // 术语表区块
      if (context.glossary && Object.keys(context.glossary).length > 0) {
        let glossaryBlock = "【📖 术语表】\n";
        glossaryBlock += Object.entries(context.glossary)
          .map(([term, def]) => `• ${term}：${def}`)
          .join("\n");
        blocks.push(glossaryBlock);
      }

      // 质量标准区块
      if (context.qualityStandards.length > 0) {
        let qualityBlock = "【✅ 质量标准】\n";
        qualityBlock += context.qualityStandards
          .map((q) => {
            let line = `• ${q.dimension}：${q.requirement}`;
            if (q.metric) {
              line += `（指标：${q.metric}）`;
            }
            return line;
          })
          .join("\n");
        blocks.push(qualityBlock);
      }
    }

    // 组装完整的 System Prompt
    const contextSection =
      blocks.length > 0
        ? `
═══════════════════════════════════════════
              任务上下文（必读）
═══════════════════════════════════════════

${blocks.join("\n\n")}

═══════════════════════════════════════════
`
        : "";

    // 如果有背景但没有结构化上下文，使用背景作为上下文
    const finalContextSection =
      contextSection || backgroundSection
        ? `
═══════════════════════════════════════════
              任务上下文（必读）
═══════════════════════════════════════════
${backgroundSection ? `\n【📖 任务背景】\n${backgroundSection}\n` : ""}
${blocks.length > 0 ? blocks.join("\n\n") : ""}
═══════════════════════════════════════════
`
        : "";

    return `你是「${agentName}」，团队成员。
身份：${identity}
擅长：${expertise}
${finalContextSection}
【你的任务】
${task.title}
${task.description ? `\n任务描述：${task.description}` : ""}

【执行要求】
1. 严格遵守上述所有约束和定义
2. 如果任务内容与约束冲突，以约束为准
3. 不确定的内容标注 [待确认]，不要自行编造
4. 确保输出内容与已完成的任务保持一致`;
  }

  // ==================== 构建 Leader 规划 Prompt ====================

  /**
   * 构建要求 Leader 输出 JSON Context Package 的 Prompt 片段
   */
  buildContextPackagePromptSection(memberNames: string[]): string {
    return `
【⚠️ 重要：你必须输出 Mission Context Package（JSON格式）】

在任务分解之前，你需要先输出一个 JSON 代码块，包含你对任务的理解和关键约束。
这些信息会自动同步给所有执行成员，确保团队理解一致。

请输出以下格式的 JSON（放在 \`\`\`json 代码块中）：

\`\`\`json
{
  "understanding": {
    "summary": "一句话总结任务目标",
    "scope": "任务范围和边界",
    "expectedOutput": "预期的交付物形式"
  },
  "hardConstraints": [
    {
      "id": "HC-001",
      "rule": "必须遵循的规则，违反将导致任务失败",
      "severity": "MUST"
    }
  ],
  "entities": [
    {
      "name": "实体名称（如人物名、概念名、术语等）",
      "type": "类型（人物/概念/指标/组织/地点等）",
      "definition": "详细定义，确保所有成员理解一致",
      "attributes": {
        "属性名": "属性值"
      },
      "relations": [
        {
          "target": "关联实体",
          "relation": "关系类型"
        }
      ]
    }
  ],
  "prohibitions": [
    {
      "description": "禁止做的事情",
      "reason": "为什么禁止"
    }
  ],
  "qualityStandards": [
    {
      "dimension": "质量维度（如准确性、一致性等）",
      "requirement": "具体要求"
    }
  ],
  "glossary": {
    "术语": "定义"
  }
}
\`\`\`

【JSON 输出要求】
1. entities 中必须包含任务涉及的所有核心实体（人物、概念、术语等）
2. hardConstraints 中列出所有必须遵循的规则
3. prohibitions 中列出所有禁止事项
4. 确保 JSON 格式正确，可被解析

【可分配的成员】
分配任务时，必须使用以下精确的成员名称：
${memberNames.map((name, i) => `${i + 1}. ${name}`).join("\n")}

⚠️ 分配任务时请使用上述精确名称，不要添加前缀（如 @AI-）或后缀（如 #1, #2）。
`;
  }

  // ==================== 输出校验 ====================

  /**
   * 校验任务输出是否符合上下文约束
   */
  validateOutputAgainstContext(
    output: string,
    context: MissionContextPackage,
  ): {
    valid: boolean;
    violations: Array<{
      constraintId: string;
      description: string;
      severity: "MUST" | "SHOULD";
    }>;
    warnings: string[];
  } {
    const violations: Array<{
      constraintId: string;
      description: string;
      severity: "MUST" | "SHOULD";
    }> = [];
    const warnings: string[] = [];

    // 检查禁止事项
    for (const prohibition of context.prohibitions) {
      // 简单的关键词检查（可以扩展为更复杂的语义检查）
      const keywords = prohibition.description
        .split(/[，,、]/g)
        .filter((k) => k.length > 2);

      for (const keyword of keywords) {
        if (output.includes(keyword)) {
          warnings.push(`可能违反禁止事项：${prohibition.description}`);
          break;
        }
      }
    }

    // 检查实体一致性
    for (const entity of context.entities) {
      if (output.includes(entity.name)) {
        // 实体被提及，检查是否有明显的定义冲突
        // 这里是简化的检查，实际可以用 AI 做更深入的语义校验
        if (entity.attributes) {
          for (const [attrName, attrValue] of Object.entries(
            entity.attributes,
          )) {
            // 检查是否有与定义冲突的描述
            // 例如：如果定义是 "门派=青崖观"，但输出中写了 "寒江剑社的弟子"
            if (
              attrName === "门派" &&
              output.includes(entity.name) &&
              !output.includes(attrValue)
            ) {
              // 检查是否提到了其他门派
              const otherSects = ["寒江剑社", "冥渊教", "月轮教", "长安剑社"];
              for (const sect of otherSects) {
                if (
                  output.includes(sect) &&
                  output.includes(entity.name) &&
                  sect !== attrValue
                ) {
                  warnings.push(
                    `${entity.name} 的门派应为「${attrValue}」，但文中可能将其与「${sect}」关联`,
                  );
                }
              }
            }
          }
        }
      }
    }

    return {
      valid: violations.filter((v) => v.severity === "MUST").length === 0,
      violations,
      warnings,
    };
  }

  // ==================== 任务背景提取 ====================

  /**
   * 从 mission description 中提取关键背景信息
   * 用于在没有结构化上下文时，仍然传递重要设定给执行 Agent
   */
  private extractMissionBackground(missionDescription?: string): string | null {
    if (!missionDescription || missionDescription.length < 50) {
      return null;
    }

    const sections: string[] = [];

    // 1. 提取人物设定部分
    const characterPatterns = [
      /(?:人物设定|角色设定|主要人物|核心人物)[：:]\s*([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/gi,
      /(?:人物|角色)(?:简介|描述)?[：:]\s*([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/gi,
    ];

    for (const pattern of characterPatterns) {
      const match = missionDescription.match(pattern);
      if (match && match[0].length > 20) {
        sections.push(`【人物设定】\n${match[0].trim()}`);
        break;
      }
    }

    // 2. 提取约束/规则部分
    const constraintPatterns = [
      /(?:硬性约束|写作约束|必须遵守|强制规则)[：:]\s*([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/gi,
      /(?:约束条件|规则要求|注意事项)[：:]\s*([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/gi,
    ];

    for (const pattern of constraintPatterns) {
      const match = missionDescription.match(pattern);
      if (match && match[0].length > 20) {
        sections.push(`【约束条件】\n${match[0].trim()}`);
        break;
      }
    }

    // 3. 提取世界观/背景设定
    const worldPatterns = [
      /(?:世界观|背景设定|故事背景)[：:]\s*([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/gi,
    ];

    for (const pattern of worldPatterns) {
      const match = missionDescription.match(pattern);
      if (match && match[0].length > 20 && match[0].length < 2000) {
        sections.push(`【背景设定】\n${match[0].trim()}`);
        break;
      }
    }

    // 4. 提取文风/风格要求
    const stylePatterns = [
      /(?:文风|写作风格|语言风格|风格要求)[：:]\s*([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/gi,
    ];

    for (const pattern of stylePatterns) {
      const match = missionDescription.match(pattern);
      if (match && match[0].length > 10 && match[0].length < 500) {
        sections.push(`【文风要求】\n${match[0].trim()}`);
        break;
      }
    }

    // 5. 如果没有提取到结构化内容，但内容较短，直接使用摘要
    if (sections.length === 0 && missionDescription.length < 3000) {
      // 取前 2000 字符作为背景
      const summary = missionDescription.slice(0, 2000);
      if (summary.length > 100) {
        return summary + (missionDescription.length > 2000 ? "\n..." : "");
      }
    }

    // 6. 如果提取到了内容，组合返回
    if (sections.length > 0) {
      // 限制总长度
      let result = sections.join("\n\n");
      if (result.length > 4000) {
        result = result.slice(0, 4000) + "\n...（已截断）";
      }
      return result;
    }

    return null;
  }

  // ==================== 上下文演进 ====================

  /**
   * 从完成的任务输出中提取已确立的事实
   *
   * 这是通用的上下文演进机制：
   * - 不预设任何领域知识
   * - 让 AI 根据任务内容自动识别关键事实
   * - 支持任何类型的任务（小说、文档、研究等）
   *
   * ★ 参数映射说明：本方法接收 legacy 参数（maxTokens/temperature），
   *   调用方应使用带映射层的 aiCaller（如 TeamMissionService.callAIWithConfig），
   *   映射层会将 legacy 参数转换为 taskProfile
   *
   * @param taskId - 任务ID
   * @param taskTitle - 任务标题
   * @param taskOutput - 任务产出内容
   * @param existingContext - 现有上下文（用于避免重复提取）
   * @param aiCaller - AI 调用函数（应通过带映射层的服务创建）
   */
  async extractEstablishedFacts(
    taskId: string,
    taskTitle: string,
    taskOutput: string,
    existingContext: MissionContextPackage | null,
    aiCaller: (
      messages: { role: string; content: string }[],
      options?: {
        maxTokens?: number;
        temperature?: number;
        taskProfile?: { creativity: string; outputLength: string };
      },
    ) => Promise<{ content: string }>,
  ): Promise<EstablishedFact[]> {
    // 如果输出太短，跳过提取
    if (taskOutput.length < 200) {
      this.logger.debug(
        `[extractEstablishedFacts] Task output too short (${taskOutput.length} chars), skipping extraction`,
      );
      return [];
    }

    // 构建已知实体列表（避免重复提取）
    const existingEntities =
      existingContext?.entities?.map((e) => e.name) || [];
    const existingFacts =
      existingContext?.establishedFacts?.map((f) => f.statement) || [];

    // 截取任务输出（避免 token 过多）
    const MAX_OUTPUT_LENGTH = 6000;
    const truncatedOutput =
      taskOutput.length > MAX_OUTPUT_LENGTH
        ? taskOutput.substring(0, MAX_OUTPUT_LENGTH) + "\n...[内容已截断]"
        : taskOutput;

    const extractionPrompt = `请从以下任务产出中提取【新确立的关键事实】。

【任务标题】
${taskTitle}

【任务产出】
${truncatedOutput}

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

    try {
      const response = await aiCaller(
        [
          {
            role: "system",
            content:
              "你是一个专业的信息提取助手。请准确识别文本中的关键事实，输出结构化的 JSON 数据。",
          },
          { role: "user", content: extractionPrompt },
        ],
        { taskProfile: { creativity: "deterministic", outputLength: "short" } },
      );

      // 解析 JSON
      const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonContent = jsonMatch ? jsonMatch[1] : response.content;

      let parsed: unknown[];
      try {
        parsed = JSON.parse(jsonContent);
      } catch {
        this.logger.warn(
          `[extractEstablishedFacts] Failed to parse JSON response: ${response.content.substring(0, 200)}`,
        );
        return [];
      }

      if (!Array.isArray(parsed)) {
        return [];
      }

      // 转换为 EstablishedFact
      const validCategories = [
        "entity_state",
        "sequence_point",
        "decision",
        "definition",
        "relationship",
        "constraint_added",
      ];
      const validImportance = ["high", "medium", "low"];

      const facts: EstablishedFact[] = parsed
        .filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === "object",
        )
        .map((item, index) => ({
          id: `EF-${taskId.substring(0, 8)}-${index + 1}`,
          sourceTaskId: taskId,
          sourceTaskTitle: taskTitle,
          establishedAt: new Date().toISOString(),
          statement: typeof item.statement === "string" ? item.statement : "",
          category: (validCategories.includes(item.category as string)
            ? item.category
            : "definition") as EstablishedFact["category"],
          relatedEntities: Array.isArray(item.relatedEntities)
            ? item.relatedEntities.filter(
                (e): e is string => typeof e === "string",
              )
            : undefined,
          importance: (validImportance.includes(item.importance as string)
            ? item.importance
            : "medium") as EstablishedFact["importance"],
        }))
        .filter((f) => f.statement.length > 5);

      this.logger.log(
        `[extractEstablishedFacts] Extracted ${facts.length} facts from task "${taskTitle}"`,
      );

      return facts;
    } catch (error) {
      this.logger.warn(
        `[extractEstablishedFacts] Failed to extract facts: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /**
   * 构建包含已确立事实的审核提示词片段
   *
   * 用于 Leader 审核时进行跨任务一致性校验
   */
  buildEstablishedFactsSection(context: MissionContextPackage | null): string {
    const facts = context?.establishedFacts;
    if (!facts || facts.length === 0) {
      return "";
    }

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
      const displayFacts = mediumFacts.slice(-10);
      sections.push(
        `【🟡 应该遵守的已确立事实】\n` +
          displayFacts
            .map((f) => `• [${f.sourceTaskTitle}] ${f.statement}`)
            .join("\n") +
          (mediumFacts.length > 10
            ? `\n... 及其他 ${mediumFacts.length - 10} 条`
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

  /**
   * 合并新的已确立事实到现有上下文
   */
  mergeEstablishedFacts(
    existingContext: MissionContextPackage | null,
    newFacts: EstablishedFact[],
  ): MissionContextPackage {
    if (!existingContext) {
      return {
        ...createEmptyContextPackage("system"),
        establishedFacts: newFacts,
      };
    }

    // 去重：基于 statement 相似性
    const existingStatements = new Set(
      existingContext.establishedFacts?.map((f) =>
        f.statement.toLowerCase().trim(),
      ) || [],
    );

    const uniqueNewFacts = newFacts.filter(
      (f) => !existingStatements.has(f.statement.toLowerCase().trim()),
    );

    return {
      ...existingContext,
      establishedFacts: [
        ...(existingContext.establishedFacts || []),
        ...uniqueNewFacts,
      ],
    };
  }
}
