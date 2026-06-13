/**
 * Writing Context Service
 *
 * 负责构建写作上下文，包括 Story Bible、角色信息、前文摘要等。
 * 从 WritingMissionService 拆分出来，专注于上下文构建逻辑。
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ToolFacade } from "@/modules/ai-harness/facade";
import type { AICapabilityContext } from "@/modules/ai-harness/facade";
import { StyleTemplateService } from "../style/style-template.service";
import { WriterAgent } from "../../agents";

// Quality services
import { ProfessionalVoiceService } from "../quality/professional-voice.service";
import { SensoryImmersionService } from "../quality/sensory-immersion.service";
import { OpeningHookService } from "../quality/opening-hook.service";
import { NarrativeCraftService } from "../quality/narrative-craft.service";
import { PacingControlService } from "../quality/pacing-control.service";

@Injectable()
export class WritingContextService {
  private readonly logger = new Logger(WritingContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolFacade: ToolFacade,
    private readonly styleTemplateService: StyleTemplateService,
    private readonly professionalVoice: ProfessionalVoiceService,
    private readonly sensoryImmersion: SensoryImmersionService,
    private readonly openingHook: OpeningHookService,
    private readonly narrativeCraft: NarrativeCraftService,
    private readonly pacingControl: PacingControlService,
  ) {}

  /**
   * ★ NEW: 获取写作相关的技能提示
   * 根据任务类型从 AICapabilityResolver 获取适用的 Skills
   */
  async getWritingSkillPrompts(params: {
    roleId?: string;
    projectId?: string;
  }): Promise<string> {
    try {
      // 定义能力上下文
      const context: AICapabilityContext = {
        domain: "writing",
        roleId: params.roleId,
        agentId: params.projectId, // 使用 projectId 作为 agentId 来追踪
      };

      // 从 AIFacade 获取技能提示
      const skillPrompts =
        await this.toolFacade.capabilityGetSkillPrompts(context);

      if (
        skillPrompts &&
        skillPrompts.content &&
        skillPrompts.usedSkills.length > 0
      ) {
        this.logger.debug(
          `[SkillIntegration] Loaded ${skillPrompts.usedSkills.length} writing skills: ${skillPrompts.usedSkills.join(", ")}`,
        );

        return skillPrompts.content;
      }

      this.logger.debug(
        "[SkillIntegration] No skills available for writing domain",
      );
      return "";
    } catch (error) {
      this.logger.warn(
        `[SkillIntegration] Failed to load writing skills: ${(error as Error).message}`,
      );
      return "";
    }
  }

  /**
   * 生成章节质量约束提示词（v3 新增）
   * 整合专业声音、五感沉浸、开篇钩子、节奏控制等服务
   * ★ 增强：现在也会集成 Skills from AICapabilityResolver
   */
  async generateQualityConstraints(
    chapterNumber: number,
    chapterOutline?: string,
    characters?: Array<{ name: string; role?: string; background?: string }>,
    projectId?: string,
  ): Promise<string> {
    const constraints: string[] = [];

    // ★★★ -1. 写作技能提示（从 AICapabilityResolver 获取）★★★
    try {
      const skillPrompts = await this.getWritingSkillPrompts({
        roleId: "writer",
        projectId,
      });
      if (skillPrompts) {
        constraints.push(skillPrompts);
        this.logger.debug(
          `[QualityConstraints] Added skill prompts (${skillPrompts.length} chars)`,
        );
      }
    } catch (e) {
      this.logger.warn(`[QualityConstraints] Skill prompts failed: ${e}`);
    }

    this.logger.debug(
      `[QualityConstraints] Generating for chapter ${chapterNumber}, outline: ${chapterOutline?.slice(0, 50) || "none"}, characters: ${characters?.length || 0}`,
    );

    // ★★★ 0. 叙事工艺约束（最高优先级，必须首先注入）★★★
    // 这是修复"AI味"问题的核心：禁止说教式写法、总结式结尾等
    try {
      const narrativeConstraints =
        this.narrativeCraft.generateNarrativeCraftConstraints();
      if (narrativeConstraints) {
        constraints.push(narrativeConstraints);
        this.logger.debug(
          `[QualityConstraints] Added narrative craft constraints (${narrativeConstraints.length} chars)`,
        );
      }
    } catch (e) {
      this.logger.warn(`[QualityConstraints] Narrative craft failed: ${e}`);
    }

    try {
      // 1. 开篇钩子约束（第一章特别强调）
      const openingConstraints = this.openingHook.generateOpeningConstraints(
        chapterNumber,
        chapterOutline,
      );
      if (openingConstraints) {
        constraints.push(openingConstraints);
      }
    } catch (e) {
      this.logger.warn(`[QualityConstraints] Opening hook failed: ${e}`);
    }

    try {
      // 2. 五感沉浸约束
      const immersionConstraints =
        this.sensoryImmersion.generateImmersionConstraints(
          chapterNumber,
          chapterOutline,
        );
      if (immersionConstraints) {
        constraints.push(immersionConstraints);
      }
    } catch (e) {
      this.logger.warn(`[QualityConstraints] Sensory immersion failed: ${e}`);
    }

    try {
      // 3. 专业声音约束（如果有角色职业信息）
      if (characters && characters.length > 0) {
        // ★ 智能提取职业：优先从 background 文本中提取，否则使用 role
        const charactersWithProfession = characters.map((c) => {
          // 尝试从背景描述中智能提取职业
          const extractedProfession = c.background
            ? this.professionalVoice.extractProfessionFromBackground(
                c.background,
              )
            : null;
          return {
            name: c.name,
            profession: extractedProfession || c.role || c.background,
            background: c.background,
          };
        });

        const voiceConstraints =
          this.professionalVoice.generateChapterVoiceConstraints(
            charactersWithProfession,
          );
        if (voiceConstraints) {
          constraints.push(voiceConstraints);
        }
      }
    } catch (e) {
      this.logger.warn(`[QualityConstraints] Professional voice failed: ${e}`);
    }

    try {
      // 4. 节奏控制约束（需要 projectId 追踪历史节奏）
      if (projectId) {
        const pacingConstraints = this.pacingControl.generatePacingConstraints(
          projectId,
          chapterNumber,
          undefined, // chapterType - 让服务从大纲自动推断
          chapterOutline,
        );
        if (pacingConstraints) {
          constraints.push(pacingConstraints);
          this.logger.debug(
            `[QualityConstraints] Added pacing control constraints for chapter ${chapterNumber}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(`[QualityConstraints] Pacing control failed: ${e}`);
    }

    if (constraints.length > 0) {
      this.logger.log(
        `[QualityConstraints] Generated ${constraints.length} constraint sections for chapter ${chapterNumber}`,
      );
    }

    // ★★★ 尾部强化检查清单（LLM注意力机制：尾部权重高）★★★
    const FINAL_CHECK_FOOTER = `
## ⚠️ 【写作完成前必须检查】最终核验清单

在输出章节内容前，必须逐项确认：

1. □ 章节最后一段是【具体场景/动作/对话】，而非抽象感慨
2. □ 结尾没有出现"这只是开始"、"风暴即将来临"等预告式语句
3. □ 结尾没有出现"她决定"、"他下定决心"、"心中燃起"等决心式语句
4. □ 结尾没有出现"她明白了"、"他终于懂得"等感悟式语句
5. □ 全文没有"她知道，XXX是XXX的象征"等说教式句子
6. □ 情绪通过动作/生理反应展示，而非直接描述

【如果任何一项未通过，必须修改后再输出】
`;

    constraints.push(FINAL_CHECK_FOOTER);

    return constraints.join("\n\n");
  }

  /**
   * 获取模板风格提示（三层风格配置系统）
   */
  async getTemplateStylePrompt(projectId: string): Promise<string | undefined> {
    try {
      // 使用 StyleTemplateService 的三层风格配置系统
      const mergedConfig =
        await this.styleTemplateService.getMergedStyleConfig(projectId);

      if (!mergedConfig) {
        this.logger.warn(
          `Project ${projectId} not found, cannot get style prompt`,
        );
        return undefined;
      }

      return mergedConfig.fullPrompt;
    } catch (error) {
      this.logger.error(
        `Failed to get template style prompt for project ${projectId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * 构建章节写作提示词
   * 整合 Story Bible、风格约束、质量约束等
   */
  async buildChapterWriterPrompt(params: {
    projectId: string;
    chapterNumber: number;
    chapterOutline?: string;
    targetWordCount?: number;
    previousSummary?: string;
    characters?: Array<{ name: string; role?: string; background?: string }>;
    worldSettings?: Record<string, unknown>;
  }): Promise<string> {
    const {
      projectId,
      chapterNumber,
      chapterOutline,
      targetWordCount,
      previousSummary,
      characters,
      worldSettings,
    } = params;

    const sections: string[] = [];

    // 1. 基础写作原则
    sections.push(`# 章节写作任务

你是一位专业的小说作家，负责创作第 ${chapterNumber} 章的内容。

${WriterAgent.CORE_WRITING_PRINCIPLES}
`);

    // 2. 风格约束
    const stylePrompt = await this.getTemplateStylePrompt(projectId);
    if (stylePrompt) {
      sections.push(`## 风格要求\n\n${stylePrompt}`);
    }

    // 3. 质量约束
    const qualityConstraints = await this.generateQualityConstraints(
      chapterNumber,
      chapterOutline,
      characters,
      projectId,
    );
    if (qualityConstraints) {
      sections.push(qualityConstraints);
    }

    // 4. 前文摘要
    if (previousSummary) {
      sections.push(`## 前文摘要\n\n${previousSummary}`);
    }

    // 5. 角色信息
    if (characters && characters.length > 0) {
      const charList = characters
        .map((c) => {
          const parts = [`- **${c.name}**`];
          if (c.role) parts.push(`（${c.role}）`);
          if (c.background) parts.push(`: ${c.background}`);
          return parts.join("");
        })
        .join("\n");
      sections.push(`## 角色信息\n\n${charList}`);
    }

    // 6. 世界观设定
    if (worldSettings && Object.keys(worldSettings).length > 0) {
      const settingsText = JSON.stringify(worldSettings, null, 2);
      sections.push(`## 世界观设定\n\n\`\`\`json\n${settingsText}\n\`\`\``);
    }

    // 7. 章节大纲
    if (chapterOutline) {
      sections.push(`## 章节大纲\n\n${chapterOutline}`);
    }

    // 8. 字数要求
    if (targetWordCount) {
      sections.push(
        `## 字数要求\n\n目标字数：约 ${targetWordCount} 字（可适当调整，以完整表达情节为准）`,
      );
    }

    // 9. 输出要求
    sections.push(`## 输出要求

请直接输出章节内容，不要包含任何元信息（如"第X章"、字数统计等）。
内容应该是纯粹的正文，可以包含自然的分段。`);

    return sections.join("\n\n");
  }

  /**
   * 提取章节上下文（前文摘要）
   */
  async extractChapterContext(
    projectId: string,
    currentChapterNumber: number,
    contextWindow: number = 3,
  ): Promise<{
    previousChapters: Array<{ number: number; title: string; summary: string }>;
    recentSummary: string;
  }> {
    try {
      // 获取前 N 章的内容
      const previousChapters = await this.prisma.writingChapter.findMany({
        where: {
          volume: {
            projectId,
          },
          chapterNumber: {
            gte: Math.max(1, currentChapterNumber - contextWindow),
            lt: currentChapterNumber,
          },
        },
        orderBy: { chapterNumber: "asc" },
        select: {
          chapterNumber: true,
          title: true,
          content: true,
        },
      });

      const contextData = previousChapters.map((ch) => ({
        number: ch.chapterNumber,
        title: ch.title,
        summary: this.extractSummaryFromContent(ch.content || ""),
      }));

      // 生成近期摘要
      const recentSummary = contextData
        .map(
          (ch) =>
            `第${ch.number}章《${ch.title}》: ${ch.summary.slice(0, 200)}...`,
        )
        .join("\n\n");

      return {
        previousChapters: contextData,
        recentSummary,
      };
    } catch (error) {
      this.logger.error(
        `Failed to extract chapter context: ${(error as Error).message}`,
      );
      return {
        previousChapters: [],
        recentSummary: "",
      };
    }
  }

  /**
   * 从内容中提取摘要（简单版）
   */
  private extractSummaryFromContent(content: string): string {
    // 去除空行和过短的段落
    const paragraphs = content
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 50);

    // 取前3段或前500字
    const summary = paragraphs.slice(0, 3).join(" ");
    return summary.slice(0, 500);
  }
}
