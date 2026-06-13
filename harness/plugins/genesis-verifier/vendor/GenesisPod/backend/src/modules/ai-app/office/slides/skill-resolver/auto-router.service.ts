import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade, ChatMessage } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { PresetLoader } from "./preset-loader.service";
import type {
  SkillConditions,
  SlidesAudience,
  SlidesIntent,
  SlidesSourceHint,
} from "./skill-policy.types";

export interface RoutingSuggestion {
  conditions: SkillConditions;
  presetId?: string;
  rationale?: string;
}

/**
 * Opt-in 5th precedence layer — an LLM classifier that reads the source
 * text and suggests `SkillConditions` + a preset to apply.
 *
 * Sits between policy rules and presets in the resolver ladder:
 *   override > preset > **auto-router** > policy > default
 *
 * Off by default. Only invoked when the caller passes `autoRoute: true`
 * and neither `preset` nor explicit hints are already set. The caller
 * (slides-engine) merges the suggestion into its orchestrator input
 * before the resolver runs.
 *
 * Failure modes (all graceful — never throws to the caller):
 *  - LLM error → returns null, slides-engine falls back to no auto-routing
 *  - JSON parse error → same
 *  - Suggestion references unknown preset → presetId dropped, conditions kept
 */
@Injectable()
export class SlidesAutoRouterService {
  private readonly logger = new Logger(SlidesAutoRouterService.name);

  private static readonly SAMPLE_CHARS = 3000;
  private static readonly SYSTEM_PROMPT = `你是一个幻灯片生成路由器。输入一段源文本，推断出最合适的幻灯片生成预设。

你必须严格输出 JSON，结构如下（不要额外解释）：
\`\`\`json
{
  "sourceType": "topic-insights" | "research-project" | "writing" | "teams" | "upload" | "prompt",
  "audience": "executive" | "engineer" | "investor" | "academic" | "general",
  "intent": "brief" | "pitch" | "tutorial" | "report" | "summary",
  "language": "zh" | "en",
  "presetId": "<id 或 null>",
  "rationale": "一句话说明"
}
\`\`\`

判断标准：
- executive/brief：决策语气、数字密集、短（<10 页）、面向 C-level
- investor/pitch：愿景、增长、市场规模、融资相关
- engineer/tutorial：步骤、代码、架构图、工具链
- academic/report：引用密集、方法论、结论导向
- 无法判断时保守选 general/summary`;

  constructor(
    private readonly chat: ChatFacade,
    private readonly presetLoader: PresetLoader,
  ) {}

  /**
   * Infer conditions + preset from source text. Returns null on any failure.
   */
  async infer(sourceText: string): Promise<RoutingSuggestion | null> {
    if (!sourceText || sourceText.trim().length === 0) {
      return null;
    }

    const sample = sourceText.slice(0, SlidesAutoRouterService.SAMPLE_CHARS);
    const presetList = this.presetLoader
      .list()
      .map((p) => `- ${p.id}${p.description ? `: ${p.description}` : ""}`)
      .join("\n");

    const userMessage = [
      "可选 preset 列表：",
      presetList || "(暂无 preset)",
      "",
      "源文本样本（已截断）：",
      sample,
    ].join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: SlidesAutoRouterService.SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    let content: string;
    try {
      const response = await this.chat.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "short",
        },
      });
      if (!response?.content) {
        this.logger.warn("[infer] Empty LLM response");
        return null;
      }
      content = response.content;
    } catch (err) {
      this.logger.warn(
        `[infer] LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    return this.parse(content);
  }

  private parse(raw: string): RoutingSuggestion | null {
    const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = match ? match[1] : raw;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      this.logger.warn(
        `[parse] Failed to parse router JSON: ${jsonStr.slice(0, 200)}`,
      );
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;

    const stringOrUndefined = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 && v !== "null" ? v : undefined;

    const conditions: SkillConditions = {
      sourceType: stringOrUndefined(obj.sourceType) as
        | SlidesSourceHint
        | undefined,
      audience: stringOrUndefined(obj.audience) as SlidesAudience | undefined,
      intent: stringOrUndefined(obj.intent) as SlidesIntent | undefined,
      language: stringOrUndefined(obj.language),
    };

    // Validate presetId against the actual registry — drop if not found
    const rawPreset = stringOrUndefined(obj.presetId);
    const presetId =
      rawPreset && this.presetLoader.get(rawPreset) ? rawPreset : undefined;
    if (rawPreset && !presetId) {
      this.logger.warn(
        `[parse] Router suggested unknown preset '${rawPreset}' — dropped`,
      );
    }

    return {
      conditions,
      presetId,
      rationale: stringOrUndefined(obj.rationale),
    };
  }
}
