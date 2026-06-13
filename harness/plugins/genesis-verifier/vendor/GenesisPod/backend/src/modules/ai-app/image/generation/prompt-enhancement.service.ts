/**
 * Prompt Enhancement Service
 *
 * This service handles AI-powered prompt enhancement and parsing
 * ★ P3 迁移：使用 AIFacade 统一入口
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  PromptEngineeringInsights,
  PromptDesignJournalEntry,
  PromptSection,
  TemplateLayoutType,
  createDefaultInsights,
} from "../core/image.types";
import { PROMPT_ENHANCEMENT_SYSTEM } from "./prompt-templates";
import {
  normalizeString,
  toArray,
  addStyleToPrompt,
} from "../core/image.utils";
import {
  QUANTITY_PATTERNS,
  SHORT_VISUAL_PROMPT_THRESHOLDS,
  COMIC_ILLUSTRATION_PATTERN,
  STRUCTURED_CONTENT_PATTERN,
  LIST_CONTENT_PATTERN,
  AI_IMAGE_MODE_NEGATIVES,
  DEFAULT_INFOGRAPHIC_PREFIX,
  INFOGRAPHIC_STYLE_KEYWORDS,
  DEFAULT_PURE_IMAGE_PROMPT,
} from "../core/image.constants";

@Injectable()
export class PromptEnhancementService {
  private readonly logger = new Logger(PromptEnhancementService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 调用 LLM 进行 Prompt 增强
   * ★ P3 迁移：使用 AIFacade 统一入口
   */
  async enhancePromptWithLLM(
    content: string,
    _modelId?: string,
  ): Promise<string> {
    this.logger.log(`[enhancePromptWithLLM] Calling LLM via ChatFacade`);

    const result = await this.chatFacade.chat({
      messages: [{ role: "user", content }],
      systemPrompt: PROMPT_ENHANCEMENT_SYSTEM,
      modelType: AIModelType.CHAT_FAST, // Prompt 增强使用快速模型
      taskProfile: {
        creativity: "low",
        outputLength: "standard",
      } as TaskProfile,
    });

    if (!result.content) {
      throw new Error("No response from LLM");
    }

    return result.content;
  }

  /**
   * @deprecated Use enhancePromptWithLLM instead
   * 保留向后兼容，内部调用 enhancePromptWithLLM
   */
  async callGeminiTextAPI(
    _apiKey: string,
    modelId: string,
    content: string,
  ): Promise<string> {
    return this.enhancePromptWithLLM(content, modelId);
  }

  /**
   * @deprecated Use enhancePromptWithLLM instead
   * 保留向后兼容，内部调用 enhancePromptWithLLM
   */
  async callOpenAITextAPI(
    _apiKey: string,
    _apiEndpoint: string | null,
    modelId: string,
    content: string,
  ): Promise<string> {
    return this.enhancePromptWithLLM(content, modelId);
  }

  /**
   * Parse prompt enhancement response from AI
   */
  parsePromptEnhancementResponse(
    raw: string,
    fallbackPrompt: string,
  ): PromptEngineeringInsights {
    if (!raw?.trim()) {
      return createDefaultInsights(fallbackPrompt);
    }

    let payload = raw.trim();
    const fencedMatch = payload.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      payload = fencedMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(payload);
      this.logger.debug(
        `[PromptEnhancement] Successfully parsed JSON. Keys: ${Object.keys(parsed).join(", ")}`,
      );
      const insights = createDefaultInsights(fallbackPrompt);

      insights.imagePrompt =
        normalizeString(
          parsed.final_prompt ?? parsed.image_prompt ?? parsed.imagePrompt,
        ) || fallbackPrompt;
      insights.fallbackPrompt = normalizeString(
        parsed.fallback_prompt ??
          parsed.backup_prompt ??
          parsed.alternate_prompt,
      );
      insights.backgroundPrompt = normalizeString(
        parsed.background_prompt ?? parsed.backgroundPrompt,
      );

      // Parse rendering mode
      const renderingModeRaw = normalizeString(
        parsed.rendering_mode ?? parsed.renderingMode,
      );
      if (
        renderingModeRaw === "html_render" ||
        renderingModeRaw === "hybrid" ||
        renderingModeRaw === "ai_image"
      ) {
        insights.renderingMode = renderingModeRaw;
      } else {
        insights.renderingMode = "hybrid";
      }

      // Detect short visual prompts and force ai_image mode
      const promptLength = fallbackPrompt.length;
      const wordCount = fallbackPrompt
        .split(/[\s，。、！？；：""''【】《》（）]+/)
        .filter((w) => w.length > 0).length;

      const isComicOrIllustration =
        COMIC_ILLUSTRATION_PATTERN.test(fallbackPrompt);
      const hasStructuredContent =
        STRUCTURED_CONTENT_PATTERN.test(fallbackPrompt);
      const hasListContent = LIST_CONTENT_PATTERN.test(fallbackPrompt);

      // Comic/illustration content has highest priority
      if (isComicOrIllustration) {
        this.logger.log(
          `[parsePromptEnhancementResponse] Comic/Illustration content detected, forcing ai_image mode`,
        );
        insights.renderingMode = "ai_image";
        if (
          !insights.imagePrompt ||
          insights.imagePrompt.length < fallbackPrompt.length * 0.5
        ) {
          insights.imagePrompt = fallbackPrompt;
          this.logger.log(
            `[parsePromptEnhancementResponse] Preserving original comic prompt as imagePrompt`,
          );
        }
      } else {
        const isShortVisualPrompt =
          (promptLength < SHORT_VISUAL_PROMPT_THRESHOLDS.maxCharacters ||
            wordCount < SHORT_VISUAL_PROMPT_THRESHOLDS.maxWords) &&
          !hasStructuredContent &&
          !hasListContent;

        if (isShortVisualPrompt && insights.renderingMode !== "ai_image") {
          this.logger.log(
            `[parsePromptEnhancementResponse] Short visual prompt detected (${promptLength} chars, ${wordCount} words), forcing ai_image mode`,
          );
          insights.renderingMode = "ai_image";
        }

        if (hasListContent && insights.renderingMode === "ai_image") {
          this.logger.log(
            `[parsePromptEnhancementResponse] List/ranking content detected, switching from ai_image to hybrid mode`,
          );
          insights.renderingMode = "hybrid";
        }
      }

      // Parse template layout
      const templateLayoutRaw = normalizeString(
        parsed.template_layout ?? parsed.templateLayout,
      );
      const validTemplateLayouts: TemplateLayoutType[] = [
        "cards",
        "center_visual",
        "timeline",
        "comparison",
        "pyramid",
        "radial",
        "statistics",
        "checklist",
        "funnel",
        "matrix",
        "ranking",
      ];
      if (
        templateLayoutRaw &&
        validTemplateLayouts.includes(templateLayoutRaw as TemplateLayoutType)
      ) {
        insights.templateLayout = templateLayoutRaw as TemplateLayoutType;
        this.logger.log(
          `[parsePromptEngineeringResponse] AI selected template: ${templateLayoutRaw}`,
        );
      } else {
        insights.templateLayout = "cards";
        this.logger.warn(
          `[parsePromptEngineeringResponse] Invalid or missing template_layout: "${templateLayoutRaw}", using default "cards"`,
        );
      }

      // Parse content analysis
      const contentAnalysisRaw =
        parsed.content_analysis ?? parsed.contentAnalysis;
      if (contentAnalysisRaw && typeof contentAnalysisRaw === "object") {
        insights.contentAnalysis = {
          type: contentAnalysisRaw.type || "balanced",
          language: contentAnalysisRaw.language || "zh",
          complexity: contentAnalysisRaw.complexity || "medium",
          reasoning:
            normalizeString(contentAnalysisRaw.reasoning) ||
            "Auto-detected content type",
        };
      }

      // Parse design journal
      const designJournalRaw = parsed.design_journal ?? parsed.designJournal;
      if (Array.isArray(designJournalRaw)) {
        insights.designJournal = designJournalRaw
          .map(
            (
              entry: unknown,
              index: number,
            ): PromptDesignJournalEntry | null => {
              if (entry && typeof entry === "object") {
                const e = entry as Record<string, unknown>;
                const title =
                  normalizeString(e["title"] as string | undefined) ||
                  `Step ${index + 1}`;
                const narrative =
                  normalizeString(e["narrative"] as string | undefined) ??
                  normalizeString(e["description"] as string | undefined) ??
                  normalizeString(e["text"] as string | undefined);
                if (narrative) {
                  return { title, narrative };
                }
                return null;
              }
              if (typeof entry === "string") {
                return { title: `Step ${index + 1}`, narrative: entry.trim() };
              }
              return null;
            },
          )
          .filter((entry): entry is PromptDesignJournalEntry => entry !== null);
      }

      // Parse information architecture
      const infoRaw =
        parsed.information_architecture ?? parsed.informationArchitecture ?? {};
      const sectionsRaw = Array.isArray(infoRaw.sections)
        ? infoRaw.sections
        : [];
      const sections: PromptSection[] = sectionsRaw.map(
        (section: Record<string, unknown>) => ({
          title: normalizeString(section["title"] as string | undefined),
          summary: normalizeString(
            (section["summary"] ?? section["description"]) as
              | string
              | undefined,
          ),
          bullets: toArray(section["bullets"] ?? section["points"]),
          metrics: Array.isArray(section["metrics"])
            ? (section["metrics"] as Record<string, unknown>[])
                .map((metric: Record<string, unknown>) => ({
                  label:
                    normalizeString(metric["label"] as string | undefined) ||
                    undefined,
                  value:
                    normalizeString(metric["value"] as string | undefined) ||
                    undefined,
                  comparison:
                    normalizeString(
                      (metric["comparison"] ?? metric["delta"]) as
                        | string
                        | undefined,
                    ) || undefined,
                }))
                .filter((metric: { label?: string; value?: string }) =>
                  Boolean(metric.label || metric.value),
                )
            : [],
          visual:
            section["visual"] || section["chart"]
              ? {
                  type: normalizeString(
                    ((
                      section["visual"] as Record<string, unknown> | undefined
                    )?.["type"] ??
                      (
                        section["chart"] as Record<string, unknown> | undefined
                      )?.["type"]) as string | undefined,
                  ),
                  description: normalizeString(
                    ((
                      section["visual"] as Record<string, unknown> | undefined
                    )?.["description"] ??
                      (
                        section["chart"] as Record<string, unknown> | undefined
                      )?.["description"]) as string | undefined,
                  ),
                }
              : undefined,
          iconType: normalizeString(
            (section["icon_type"] ?? section["iconType"] ?? section["icon"]) as
              | string
              | undefined,
          ),
          sectionType:
            section["section_type"] === "summary" ||
            section["sectionType"] === "summary"
              ? "summary"
              : "main",
        }),
      );

      // Validate section count against quantity patterns
      for (const { pattern, expected } of QUANTITY_PATTERNS) {
        if (pattern.test(fallbackPrompt) && sections.length < expected) {
          this.logger.warn(
            `[parsePromptEnhancementResponse] SECTION COUNT MISMATCH: User requested ${expected} items but AI only generated ${sections.length} sections.`,
          );
          break;
        }
      }

      insights.informationArchitecture = {
        title: normalizeString(infoRaw.title),
        subtitle: normalizeString(infoRaw.subtitle),
        heroStatement: normalizeString(
          infoRaw.hero_statement ?? infoRaw.heroStatement ?? infoRaw.tagline,
        ),
        centerVisualTitle: normalizeString(
          infoRaw.center_visual_title ?? infoRaw.centerVisualTitle,
        ),
        centerVisualItems: toArray(
          infoRaw.center_visual_items ?? infoRaw.centerVisualItems,
        ),
        sections,
        callToAction: normalizeString(
          infoRaw.call_to_action ?? infoRaw.callToAction,
        ),
      };

      // Parse visual language
      const visualRaw = parsed.visual_language ?? parsed.visualLanguage ?? {};
      insights.visualLanguage = {
        colorPalette: toArray(
          visualRaw.color_palette ?? visualRaw.colorPalette,
        ),
        primaryColor:
          normalizeString(visualRaw.primary_color ?? visualRaw.primaryColor) ||
          "#1e3a5f",
        accentColor:
          normalizeString(visualRaw.accent_color ?? visualRaw.accentColor) ||
          "#0891b2",
        backgroundColor:
          normalizeString(
            visualRaw.background_color ?? visualRaw.backgroundColor,
          ) || "#f7f9fc",
        textColor:
          normalizeString(visualRaw.text_color ?? visualRaw.textColor) ||
          "#1a202c",
        typography: normalizeString(visualRaw.typography),
        iconography: normalizeString(visualRaw.iconography),
        chartStyle: normalizeString(
          visualRaw.chart_style ?? visualRaw.chartStyle,
        ),
        background: normalizeString(visualRaw.background),
        gridSystem: normalizeString(
          visualRaw.grid_system ?? visualRaw.gridSystem,
        ),
        designStyle: normalizeString(
          visualRaw.design_style ?? visualRaw.designStyle,
        ),
        fontStyle: normalizeString(visualRaw.font_style ?? visualRaw.fontStyle),
        borderRadius: normalizeString(
          visualRaw.border_radius ?? visualRaw.borderRadius,
        ),
        shadowStyle: normalizeString(
          visualRaw.shadow_style ?? visualRaw.shadowStyle,
        ),
      };

      insights.layoutPlan = toArray(parsed.layout_plan ?? parsed.layoutPlan);
      insights.qualityChecks = toArray(
        parsed.quality_checks ?? parsed.qualityChecks,
      );
      insights.negativeKeywords = toArray(
        parsed.negative_keywords ??
          parsed.negativeKeywords ??
          parsed.negative_prompt ??
          parsed.negativeTerms,
      );
      insights.inspiration = toArray(parsed.inspiration ?? parsed.references);

      const legacyStyle = toArray(
        parsed.style_shift_reasoning ?? parsed.styleShiftReasoning,
      );
      if (legacyStyle.length > 0) {
        insights.styleShiftReasoning = legacyStyle;
      } else if (insights.designJournal.length > 0) {
        insights.styleShiftReasoning = insights.designJournal.map(
          (entry) => entry.narrative,
        );
      }

      if (!insights.imagePrompt || insights.imagePrompt.length < 5) {
        insights.imagePrompt = fallbackPrompt;
      }

      return insights;
    } catch (error) {
      this.logger.warn(
        `[PromptEnhancement] Failed to parse structured response, falling back to raw prompt: ${error}`,
      );
      return createDefaultInsights(fallbackPrompt);
    }
  }

  /**
   * Compose final image prompt from insights
   */
  composeFinalImagePrompt(
    insights: PromptEngineeringInsights,
    style?: string,
  ): { prompt: string; negativeCandidates: string[] } {
    // AI_IMAGE mode: pure image generation without infographic keywords
    if (insights.renderingMode === "ai_image") {
      this.logger.log(
        `[composeFinalImagePrompt] ai_image mode - using pure image prompt without infographic keywords`,
      );

      let pureImagePrompt = insights.imagePrompt.trim();

      if (!pureImagePrompt || pureImagePrompt.length < 10) {
        const title = insights.informationArchitecture?.title || "";
        pureImagePrompt = title || DEFAULT_PURE_IMAGE_PROMPT;
      }

      const finalPrompt = addStyleToPrompt(pureImagePrompt, style);

      return {
        prompt: finalPrompt.trim(),
        negativeCandidates: AI_IMAGE_MODE_NEGATIVES,
      };
    }

    // HYBRID/HTML_RENDER mode: infographic with structured content
    const promptParts: string[] = [];

    // Use background prompt if available (hybrid mode specific)
    if (
      insights.renderingMode === "hybrid" &&
      insights.backgroundPrompt &&
      insights.backgroundPrompt.length > 10
    ) {
      promptParts.push(insights.backgroundPrompt);
    } else {
      // Default infographic prefix
      promptParts.push(DEFAULT_INFOGRAPHIC_PREFIX);
      promptParts.push(...INFOGRAPHIC_STYLE_KEYWORDS);
    }

    // Add style enhancement
    if (style) {
      promptParts.push(`Style: ${style}`);
    }

    const finalPrompt = addStyleToPrompt(promptParts.join(", "), style);
    const enhancedNegatives = [
      ...insights.negativeKeywords,
      "text",
      "letters",
      "words",
      "numbers",
    ];

    return {
      prompt: finalPrompt.trim(),
      negativeCandidates: enhancedNegatives,
    };
  }
}
