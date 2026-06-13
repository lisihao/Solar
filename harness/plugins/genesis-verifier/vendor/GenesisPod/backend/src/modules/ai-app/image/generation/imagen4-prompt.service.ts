/**
 * Imagen 4 Prompt Service
 *
 * 利用 AI Engine 的 Visual Design Team 4-Agent 协作生成
 * 针对 Imagen 4 (imagen-4.0-generate-001) 优化的精准提示词
 *
 * 4-Agent 协作流程：
 * 1. Content Agent: 内容分析、信息架构、情感基调
 * 2. Layout Agent: 构图规划、视角决策、层次安排
 * 3. Visual Agent: 光线方案、色彩配置、材质纹理
 * 4. Style Agent: Imagen 4 专属 Prompt 生成
 */

import { Injectable, Logger } from "@nestjs/common";
import { TeamFacade } from "@/modules/ai-harness/facade";
import type { MissionEvent } from "@/modules/ai-harness/facade";
import {
  GenerateImageOptions,
  PromptEngineeringInsights,
  PromptDesignJournalEntry,
  PromptVisualLanguage,
  createDefaultInsights,
} from "../core/image.types";

// ============================================================================
// Types: 4-Agent 输出类型
// ============================================================================

/**
 * Content Agent 输出 - 内容分析
 */
export interface ContentAgentOutput {
  /** 主题分析 */
  subject: {
    type: "scene" | "portrait" | "object" | "abstract" | "infographic";
    mainSubject: string;
    secondarySubjects: string[];
    actions: string[];
  };
  /** 情感基调 */
  mood: {
    primary:
      | "warm"
      | "cold"
      | "dramatic"
      | "peaceful"
      | "energetic"
      | "mysterious"
      | "professional"
      | "playful";
    keywords: string[];
  };
  /** 叙事结构 */
  narrative: {
    type: "static" | "dynamic" | "story" | "comparison";
    focusPoint: string;
  };
  /** 语言检测 */
  language: "zh" | "en" | "mixed";
}

/**
 * Layout Agent 输出 - 构图规划
 */
export interface LayoutAgentOutput {
  /** 构图类型 */
  composition: {
    type:
      | "rule_of_thirds"
      | "golden_ratio"
      | "symmetry"
      | "leading_lines"
      | "frame_within_frame"
      | "centered";
    description: string;
  };
  /** 视角 */
  perspective: {
    cameraAngle:
      | "eye_level"
      | "birds_eye"
      | "worms_eye"
      | "dutch_angle"
      | "overhead";
    distance:
      | "extreme_close_up"
      | "close_up"
      | "medium"
      | "full_shot"
      | "wide"
      | "extreme_wide";
    focalLength: "wide_angle" | "standard" | "telephoto" | "macro";
  };
  /** 层次 */
  depth: {
    foreground: string | null;
    midground: string;
    background: string | null;
    depthOfField: "shallow" | "medium" | "deep";
  };
  /** 宽高比建议 */
  aspectRatioSuggestion: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
}

/**
 * Visual Agent 输出 - 视觉细节
 */
export interface VisualAgentOutput {
  /** 光线方案 */
  lighting: {
    type: "natural" | "studio" | "dramatic" | "soft" | "hard";
    direction: "front" | "side" | "back" | "rim" | "ambient";
    quality:
      | "golden_hour"
      | "blue_hour"
      | "overcast"
      | "harsh_midday"
      | "night";
    effects: string[];
  };
  /** 色彩方案 */
  color: {
    palette: string[];
    temperature: "warm" | "neutral" | "cool";
    saturation: "vibrant" | "muted" | "desaturated";
    contrast: "high" | "medium" | "low";
  };
  /** 材质与纹理 */
  materials: {
    primary: string;
    textures: string[];
  };
  /** 环境氛围 */
  atmosphere: {
    effects: string[];
    weather: string | null;
    time: string | null;
  };
}

/**
 * Style Agent 输出 - Imagen 4 专属 Prompt
 */
export interface StyleAgentOutput {
  /** Imagen 4 专属 Prompt（核心） */
  imagen4Prompt: {
    /** 主体描述（具体、详细） */
    subject: string;
    /** 环境背景 */
    environment: string;
    /** 构图指令 */
    composition: string;
    /** 光线描述 */
    lighting: string;
    /** 风格关键词 */
    style: string;
    /** 质量修饰词 */
    quality: string;
    /** 完整的英文 prompt（Imagen 4 最佳） */
    finalPrompt: string;
    /** 负面提示词（简洁、无否定词） */
    negativePrompt: string;
  };
  /** Imagen 4 参数建议 */
  parameters: {
    aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    enhancePrompt: boolean;
    numberOfImages: number;
  };
  /** 设计决策记录 */
  designJournal: Array<{ title: string; reasoning: string }>;
  /** 质量检查清单 */
  qualityChecks: string[];
}

/**
 * 4-Agent 完整输出
 */
export interface FourAgentOutputs {
  content?: ContentAgentOutput;
  layout?: LayoutAgentOutput;
  visual?: VisualAgentOutput;
  style?: StyleAgentOutput;
}

/**
 * Imagen 4 Prompt 结果
 */
export interface Imagen4PromptResult {
  /** 最终 prompt */
  finalPrompt: string;
  /** 负面 prompt */
  negativePrompt: string;
  /** 建议的宽高比 */
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  /** 完整的 insights */
  insights: PromptEngineeringInsights;
  /** 4-Agent 原始输出 */
  agentOutputs: FourAgentOutputs;
  /** 执行统计 */
  statistics: {
    totalDuration: number;
    agentDurations: Record<string, number>;
    tokensUsed: number;
  };
}

/**
 * 团队协作进度回调
 */
export type TeamProgressCallback = (event: {
  phase: "content" | "layout" | "visual" | "style" | "complete";
  status: "started" | "processing" | "completed" | "failed";
  message: string;
  data?: Record<string, unknown>;
}) => void;

// ============================================================================
// Service Implementation
// ============================================================================

@Injectable()
export class Imagen4PromptService {
  private readonly logger = new Logger(Imagen4PromptService.name);

  constructor(private readonly teamFacade: TeamFacade) {}

  /**
   * 使用 Visual Design Team 生成 Imagen 4 专属 prompt
   *
   * @param input 图像生成选项
   * @param onProgress 进度回调（可选）
   * @returns Imagen 4 prompt 结果
   */
  async generateImagen4Prompt(
    input: GenerateImageOptions,
    onProgress?: TeamProgressCallback,
  ): Promise<Imagen4PromptResult> {
    const startTime = Date.now();
    this.logger.log(`[generateImagen4Prompt] Starting 4-Agent collaboration`);

    try {
      // 1. 构建 mission 输入
      const missionContent = this.buildMissionContent(input);

      // 2. 执行 Visual Design Team 任务
      const agentOutputs = await this.executeVisualDesignMission(
        missionContent,
        input,
        onProgress,
      );

      // 3. 组合最终 Imagen 4 prompt
      const result = this.composeImagen4Prompt(agentOutputs, input, startTime);

      this.logger.log(
        `[generateImagen4Prompt] Completed in ${Date.now() - startTime}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[generateImagen4Prompt] Failed: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }

  /**
   * 执行 Visual Design Team 任务（流式）
   */
  async *generateImagen4PromptStream(
    input: GenerateImageOptions,
  ): AsyncGenerator<{
    type: "progress" | "agent_output" | "complete" | "error";
    data: unknown;
  }> {
    const startTime = Date.now();
    this.logger.log(
      `[generateImagen4PromptStream] Starting streaming 4-Agent collaboration`,
    );

    try {
      const missionContent = this.buildMissionContent(input);
      const agentOutputs: FourAgentOutputs = {};

      // 创建 mission DTO
      const missionDto = {
        teamId: "design",
        goal: missionContent,
        context: JSON.stringify({
          targetModel: "imagen-4.0-generate-001",
          aspectRatio: input.aspectRatio || "16:9",
          style: input.style,
          originalPrompt: input.prompt,
        }),
        metadata: {
          source: "imagen4-prompt-service",
          streamMode: true,
        },
      };

      // 流式执行
      const eventGenerator = this.teamFacade.executeMissionStream(missionDto);

      for await (const event of eventGenerator) {
        // 发送进度事件
        yield {
          type: "progress",
          data: {
            eventType: event.type,
            timestamp: event.timestamp,
            data: event.data,
          },
        };

        // 解析 agent 输出
        if (event.type === "step_completed" && event.data) {
          const agentOutput = this.parseAgentOutputFromEvent(event);
          if (agentOutput) {
            Object.assign(agentOutputs, agentOutput);
            yield {
              type: "agent_output",
              data: agentOutput,
            };
          }
        }

        // 任务完成
        if (event.type === "mission_completed") {
          const result = this.composeImagen4Prompt(
            agentOutputs,
            input,
            startTime,
          );
          yield {
            type: "complete",
            data: result,
          };
        }

        // 任务失败
        if (event.type === "mission_failed") {
          yield {
            type: "error",
            data: event.data,
          };
        }
      }
    } catch (error) {
      yield {
        type: "error",
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 构建 mission 内容
   */
  private buildMissionContent(input: GenerateImageOptions): string {
    const parts: string[] = [];

    parts.push("请分析以下内容并生成 Imagen 4 优化的图像设计方案：");
    parts.push("");

    if (input.prompt) {
      parts.push(`【用户描述】`);
      parts.push(input.prompt);
      parts.push("");
    }

    if (input.content) {
      parts.push(`【参考内容】`);
      parts.push(
        input.content.length > 2000
          ? input.content.slice(0, 2000) + "..."
          : input.content,
      );
      parts.push("");
    }

    if (input.style) {
      parts.push(`【指定风格】${input.style}`);
      parts.push("");
    }

    if (input.aspectRatio) {
      parts.push(`【目标宽高比】${input.aspectRatio}`);
      parts.push("");
    }

    parts.push("【目标】");
    parts.push("1. Content Agent: 分析主题、情感、叙事结构");
    parts.push("2. Layout Agent: 规划构图、视角、层次");
    parts.push("3. Visual Agent: 设计光线、色彩、材质");
    parts.push("4. Style Agent: 生成 Imagen 4 专属精准 Prompt");
    parts.push("");
    parts.push("【输出要求】");
    parts.push("- 最终 prompt 必须是英文");
    parts.push("- 使用专业摄影术语");
    parts.push("- 包含具体的视觉描述（非模糊词汇）");
    parts.push("- 负面提示词简洁，不使用否定词");

    return parts.join("\n");
  }

  /**
   * 执行 Visual Design Team 任务
   */
  private async executeVisualDesignMission(
    missionContent: string,
    input: GenerateImageOptions,
    onProgress?: TeamProgressCallback,
  ): Promise<FourAgentOutputs> {
    const agentOutputs: FourAgentOutputs = {};
    const agentPhases = ["content", "layout", "visual", "style"] as const;

    // 创建 mission DTO
    const missionDto = {
      teamId: "design",
      goal: missionContent,
      context: JSON.stringify({
        targetModel: "imagen-4.0-generate-001",
        aspectRatio: input.aspectRatio || "16:9",
        style: input.style,
        originalPrompt: input.prompt,
      }),
      metadata: {
        source: "imagen4-prompt-service",
      },
    };

    // 流式执行并收集结果
    const eventGenerator = this.teamFacade.executeMissionStream(missionDto);
    let currentPhaseIndex = 0;

    for await (const event of eventGenerator) {
      // 处理步骤开始
      if (event.type === "step_started") {
        const phase = agentPhases[currentPhaseIndex];
        if (phase && onProgress) {
          onProgress({
            phase,
            status: "started",
            message: this.getPhaseMessage(phase, "started"),
          });
        }
      }

      // 处理步骤完成
      if (event.type === "step_completed") {
        const phase = agentPhases[currentPhaseIndex];
        const agentOutput = this.parseAgentOutputFromEvent(event);

        if (agentOutput) {
          Object.assign(agentOutputs, agentOutput);
        }

        if (phase && onProgress) {
          onProgress({
            phase,
            status: "completed",
            message: this.getPhaseMessage(phase, "completed"),
            data: agentOutput as Record<string, unknown> | undefined,
          });
        }

        currentPhaseIndex++;
      }

      // 处理步骤失败
      if (event.type === "step_failed") {
        const phase = agentPhases[currentPhaseIndex];
        if (phase && onProgress) {
          onProgress({
            phase,
            status: "failed",
            message: `${phase} Agent 执行失败`,
          });
        }
      }

      // 处理任务完成
      if (event.type === "mission_completed") {
        // 从最终结果提取 agent 输出
        const result = event.data?.["result"] as
          | { deliverables?: Array<{ type: string; content: unknown }> }
          | undefined;
        if (result?.deliverables) {
          for (const deliverable of result.deliverables) {
            if (
              deliverable.type === "analysis" &&
              deliverable.content &&
              typeof deliverable.content === "object"
            ) {
              this.mergeAgentOutputs(
                agentOutputs,
                deliverable.content as Record<string, unknown>,
              );
            }
          }
        }

        if (onProgress) {
          onProgress({
            phase: "complete",
            status: "completed",
            message: "4-Agent 协作完成",
            data: agentOutputs as unknown as Record<string, unknown>,
          });
        }
      }

      // 处理任务失败
      if (event.type === "mission_failed") {
        const errorMessage = (event.data?.error as string) || "Mission failed";
        throw new Error(`Visual Design Team 执行失败: ${errorMessage}`);
      }
    }

    return agentOutputs;
  }

  /**
   * 从事件中解析 agent 输出
   */
  private parseAgentOutputFromEvent(
    event: MissionEvent,
  ): Partial<FourAgentOutputs> | null {
    const stepId = event.data?.["stepId"] as string | undefined;
    const stepResult = event.data?.["result"];

    if (!stepId || !stepResult) {
      return null;
    }

    // 根据 stepId 确定是哪个 agent
    if (stepId.includes("content")) {
      return { content: stepResult as unknown as ContentAgentOutput };
    }
    if (stepId.includes("layout")) {
      return { layout: stepResult as unknown as LayoutAgentOutput };
    }
    if (stepId.includes("visual")) {
      return { visual: stepResult as unknown as VisualAgentOutput };
    }
    if (stepId.includes("style")) {
      return { style: stepResult as unknown as StyleAgentOutput };
    }

    return null;
  }

  /**
   * 合并 agent 输出
   */
  private mergeAgentOutputs(
    target: FourAgentOutputs,
    source: Record<string, unknown>,
  ): void {
    if (source.content) target.content = source.content as ContentAgentOutput;
    if (source.layout) target.layout = source.layout as LayoutAgentOutput;
    if (source.visual) target.visual = source.visual as VisualAgentOutput;
    if (source.style) target.style = source.style as StyleAgentOutput;
  }

  /**
   * 组合最终 Imagen 4 prompt
   */
  private composeImagen4Prompt(
    agentOutputs: FourAgentOutputs,
    input: GenerateImageOptions,
    startTime: number,
  ): Imagen4PromptResult {
    // 如果有 Style Agent 输出，直接使用
    if (agentOutputs.style?.imagen4Prompt) {
      const styleOutput = agentOutputs.style;
      return {
        finalPrompt: styleOutput.imagen4Prompt.finalPrompt,
        negativePrompt: styleOutput.imagen4Prompt.negativePrompt,
        aspectRatio:
          styleOutput.parameters?.aspectRatio || input.aspectRatio || "16:9",
        insights: this.buildInsightsFromAgentOutputs(agentOutputs, input),
        agentOutputs,
        statistics: {
          totalDuration: Date.now() - startTime,
          agentDurations: {},
          tokensUsed: 0,
        },
      };
    }

    // 如果没有完整的 Style Agent 输出，手动组合
    const prompt = this.manualComposePrompt(agentOutputs, input);
    const negativePrompt = this.composeNegativePrompt(agentOutputs);

    return {
      finalPrompt: prompt,
      negativePrompt,
      aspectRatio:
        agentOutputs.layout?.aspectRatioSuggestion ||
        input.aspectRatio ||
        "16:9",
      insights: this.buildInsightsFromAgentOutputs(agentOutputs, input),
      agentOutputs,
      statistics: {
        totalDuration: Date.now() - startTime,
        agentDurations: {},
        tokensUsed: 0,
      },
    };
  }

  /**
   * 手动组合 prompt（当 Style Agent 输出不完整时）
   */
  private manualComposePrompt(
    outputs: FourAgentOutputs,
    input: GenerateImageOptions,
  ): string {
    const parts: string[] = [];

    // Subject
    if (outputs.content?.subject) {
      const subject = outputs.content.subject;
      parts.push(subject.mainSubject);
      if (subject.actions.length > 0) {
        parts.push(subject.actions.join(", "));
      }
      if (subject.secondarySubjects.length > 0) {
        parts.push(`with ${subject.secondarySubjects.join(", ")}`);
      }
    } else if (input.prompt) {
      parts.push(input.prompt);
    }

    // Composition
    if (outputs.layout?.composition) {
      parts.push(outputs.layout.composition.description);
    }

    // Perspective
    if (outputs.layout?.perspective) {
      const persp = outputs.layout.perspective;
      parts.push(
        `${persp.cameraAngle.replace("_", " ")} view, ${persp.distance.replace(/_/g, " ")}`,
      );
    }

    // Lighting
    if (outputs.visual?.lighting) {
      const light = outputs.visual.lighting;
      parts.push(
        `${light.quality.replace("_", " ")} ${light.type} lighting from ${light.direction}`,
      );
      if (light.effects.length > 0) {
        parts.push(light.effects.join(", "));
      }
    }

    // Color
    if (outputs.visual?.color) {
      const color = outputs.visual.color;
      parts.push(`${color.temperature} ${color.saturation} colors`);
    }

    // Atmosphere
    if (outputs.visual?.atmosphere) {
      const atmo = outputs.visual.atmosphere;
      if (atmo.effects.length > 0) {
        parts.push(atmo.effects.join(", "));
      }
      if (atmo.weather) {
        parts.push(atmo.weather);
      }
      if (atmo.time) {
        parts.push(atmo.time);
      }
    }

    // Style
    if (input.style) {
      parts.push(input.style);
    }

    // Quality modifiers (Imagen 4 best practices)
    parts.push("high quality, detailed, 4K resolution");

    return parts.filter(Boolean).join(", ");
  }

  /**
   * 组合负面 prompt
   */
  private composeNegativePrompt(outputs: FourAgentOutputs): string {
    const negatives: string[] = [
      "blurry",
      "low quality",
      "distorted",
      "watermark",
      "text overlay",
      "oversaturated",
    ];

    // 从 Style Agent 获取额外的负面关键词
    if (outputs.style?.imagen4Prompt?.negativePrompt) {
      return outputs.style.imagen4Prompt.negativePrompt;
    }

    return negatives.join(", ");
  }

  /**
   * 从 agent 输出构建 insights
   */
  private buildInsightsFromAgentOutputs(
    outputs: FourAgentOutputs,
    input: GenerateImageOptions,
  ): PromptEngineeringInsights {
    const insights = createDefaultInsights(input.prompt || "");

    // 重要：4-Agent 协作用于纯 AI 图像生成，必须设置为 ai_image 模式
    insights.renderingMode = "ai_image";

    // 更新 designJournal
    const journal: PromptDesignJournalEntry[] = [];

    if (outputs.content) {
      journal.push({
        title: "内容分析",
        narrative: `主题类型: ${outputs.content.subject.type}, 情感基调: ${outputs.content.mood.primary}`,
      });
    }

    if (outputs.layout) {
      journal.push({
        title: "构图规划",
        narrative: `构图: ${outputs.layout.composition.type}, 视角: ${outputs.layout.perspective.cameraAngle}`,
      });
    }

    if (outputs.visual) {
      journal.push({
        title: "视觉设计",
        narrative: `光线: ${outputs.visual.lighting.quality}, 色温: ${outputs.visual.color.temperature}`,
      });
    }

    if (outputs.style) {
      journal.push({
        title: "Imagen 4 优化",
        narrative: "已生成针对 Imagen 4 优化的精准提示词",
      });
    }

    insights.designJournal = journal;

    // 更新 visualLanguage
    if (outputs.visual?.color) {
      const visualLanguage: PromptVisualLanguage = {
        ...insights.visualLanguage,
        colorPalette: outputs.visual.color.palette,
      };
      insights.visualLanguage = visualLanguage;
    }

    // 更新 templateLayout
    if (input.templateLayout) {
      insights.templateLayout = input.templateLayout;
    }

    // 更新 qualityChecks
    if (outputs.style?.qualityChecks) {
      insights.qualityChecks = outputs.style.qualityChecks;
    }

    return insights;
  }

  /**
   * 获取阶段消息
   */
  private getPhaseMessage(
    phase: "content" | "layout" | "visual" | "style" | "complete",
    status: "started" | "completed",
  ): string {
    const phaseNames = {
      content: "Content Agent 内容分析",
      layout: "Layout Agent 构图规划",
      visual: "Visual Agent 视觉设计",
      style: "Style Agent Prompt 生成",
      complete: "团队协作",
    };

    const statusText = status === "started" ? "开始" : "完成";
    return `${phaseNames[phase]}${statusText}`;
  }
}
