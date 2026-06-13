/**
 * Signal Editor service（B2 + B3）—— S9 Stage B LLM 编辑
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §7B.3 SKILL.md Stage B prompt + §K1 防注入 + §B3 跨日延续 boost
 *
 * 工作流：
 * 1. Stage A 已产 candidate pool（top 20 score>0.55）
 * 2. 本 service 拼 prompt：XML escape user-controlled 字段，注入 yesterdayTopEntities
 * 3. AiChatService.chat with TaskProfile (creativity=low, outputLength=long)
 *    + systemPrompt 来自 signal-editor SKILL.md
 * 4. zod 严格 parse 输出
 * 5. evidenceItemIds 白名单：每个值必须在 candidate pool itemId 集合内
 * 6. 越界 / 解析失败 → 重试 1 次；第 2 次失败 → 返回空数组（status='no_signals'）
 *
 * 反模式守护：
 * - **不** 硬编码 model/temperature（CLAUDE.md 红线，走 TaskProfile）
 * - **不** 接受 LLM 输出超 schema 的字段（zod strict）
 * - **不** 接受 evidenceItemIds 来源 LLM 自由编（白名单硬卡）
 */
import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { randomUUID } from "crypto";
import { z } from "zod";
import { AiChatService } from "@/modules/ai-engine/facade";
import type { DailySignal } from "./radar-daily-briefing.repo";

/** 用户配置的信号类型白名单 */
export const SIGNAL_TAG_VALUES = [
  "turning_point",
  "trend_acceleration",
  "new_entity",
  "anomaly",
  "key_event",
] as const;

const SignalTagSchema = z.enum(SIGNAL_TAG_VALUES);

const LlmSignalSchema = z
  .object({
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    // PR-DR2 P1-F (X8 PM 评审整改) — 收紧到设计 §4.2 契约（30/150/60，title 80）
    title: z.string().trim().min(1).max(80),
    oneLineTakeaway: z.string().trim().min(1).max(30),
    whyItMatters: z.string().trim().min(1).max(150),
    whatsNext: z.string().trim().min(1).max(60),
    signalTags: z.array(SignalTagSchema).min(1).max(3),
    entities: z.array(z.string().trim().min(1)).max(8),
    evidenceItemIds: z.array(z.string().trim().min(1)).min(1).max(5),
    narrativeId: z.string().nullable().optional(),
  })
  .strict();

const LlmOutputSchema = z
  .object({
    signals: z.array(LlmSignalSchema).max(10),
  })
  .strict();

export interface SignalEditorInput {
  /** topic 元信息（user-controlled，必须 XML escape） */
  topic: {
    id: string;
    name: string;
    description: string | null;
    keywords: string[];
    /** 用户启用的 signalTypes（其他类型 LLM 必须不输出） */
    signalTypes: ReadonlyArray<(typeof SIGNAL_TAG_VALUES)[number]>;
    outputLanguage: "zh-CN" | "en-US";
  };
  /** Stage A 输出的 candidate pool（已 filter+sort+top20） */
  candidates: ReadonlyArray<{
    itemId: string;
    title: string;
    content: string;
    source: string;
    publishedAt: Date;
    score: number;
    relevance: number;
    quality: number;
  }>;
  /** 昨日 briefing 的 entity 列表（B3 跨日延续 boost 提示） */
  yesterdayTopEntities: string[];
  /** 用户配置的 TOP N（3 或 5） */
  targetN: 3 | 5;
}

@Injectable()
export class SignalEditorService {
  private readonly log = new Logger(SignalEditorService.name);
  private static readonly MAX_RETRIES = 1;

  constructor(private readonly chat: AiChatService) {}

  /**
   * 主入口：candidates → TOP N signals
   *
   * @param systemPrompt SKILL.md 加载的 soul 段（caller 注入）
   * @returns DailySignal[]（空数组表示宁缺勿滥，caller 写 status='no_signals'）
   */
  async edit(
    input: SignalEditorInput,
    systemPrompt: string,
  ): Promise<DailySignal[]> {
    if (input.candidates.length === 0) return [];

    const userPrompt = this.buildUserPrompt(input);

    let lastErr: unknown;
    for (
      let attempt = 0;
      attempt <= SignalEditorService.MAX_RETRIES;
      attempt++
    ) {
      try {
        const response = await this.chat.chat({
          messages: [{ role: "user", content: userPrompt }],
          systemPrompt: this.injectLanguageHeader(
            systemPrompt,
            input.topic.outputLanguage,
          ),
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "low", outputLength: "long" },
          responseFormat: "json_object",
        });

        const parsed = this.parseAndValidate(response.content, input);
        if (parsed.length > 0) return parsed;
        // parsed 为空 = 宁缺勿滥；直接返回，不重试
        return [];
      } catch (err) {
        lastErr = err;
        this.log.warn(
          `signal-editor attempt ${attempt + 1}/${SignalEditorService.MAX_RETRIES + 1} failed: ${(err as Error).message}`,
        );
      }
    }
    this.log.warn(
      `signal-editor all retries exhausted, returning empty (no_signals): ${(lastErr as Error)?.message}`,
    );
    return [];
  }

  /**
   * 拼用户提示（XML 边界 + escape）
   *
   * 公开为 method 便于单测
   */
  buildUserPrompt(input: SignalEditorInput): string {
    const topicBlock = {
      name: xmlEscape(input.topic.name),
      description: xmlEscape(input.topic.description ?? ""),
      keywords: input.topic.keywords.map(xmlEscape),
      signalTypes: [...input.topic.signalTypes],
    };
    const candidatesBlock = input.candidates.map((c) => ({
      itemId: c.itemId,
      title: xmlEscape(c.title),
      content: xmlEscape(truncate(c.content, 600)),
      source: xmlEscape(c.source),
      publishedAt: c.publishedAt.toISOString(),
      score: round2(c.score),
      relevance: round2(c.relevance),
      quality: round2(c.quality),
    }));
    const yesterdayBlock = input.yesterdayTopEntities.map(xmlEscape);

    return [
      `<topic>${JSON.stringify(topicBlock)}</topic>`,
      `<candidates>${JSON.stringify(candidatesBlock)}</candidates>`,
      `<yesterdayTopEntities>${JSON.stringify(yesterdayBlock)}</yesterdayTopEntities>`,
      `<targetN>${input.targetN}</targetN>`,
    ].join("\n\n");
  }

  /**
   * 解析 LLM JSON 输出 + evidenceItemIds 白名单 + signalTags 用户偏好过滤
   */
  parseAndValidate(rawOutput: string, input: SignalEditorInput): DailySignal[] {
    let json: unknown;
    try {
      json = JSON.parse(rawOutput);
    } catch {
      // 兼容模型偶尔输出 ```json...``` 围栏
      const stripped = stripCodeFence(rawOutput);
      json = JSON.parse(stripped);
    }
    const parsed = LlmOutputSchema.parse(json);

    const whitelistIds = new Set(input.candidates.map((c) => c.itemId));
    const allowedTags = new Set(input.topic.signalTypes);

    const result: DailySignal[] = [];
    for (const s of parsed.signals) {
      // K1 evidenceItemIds 白名单硬卡 — 任何不在 candidate pool 的 itemId 拒绝
      const evidence = s.evidenceItemIds.filter((id) => whitelistIds.has(id));
      if (evidence.length === 0) {
        this.log.warn(
          `signal "${s.title}" rejected: 0 evidenceItemIds in whitelist`,
        );
        continue;
      }
      // signalTags 用户偏好严格过滤
      const tags = s.signalTags.filter((t) => allowedTags.has(t));
      if (tags.length === 0) {
        this.log.warn(
          `signal "${s.title}" rejected: 0 allowed signalTags (user prefs)`,
        );
        continue;
      }
      result.push({
        id: randomUUID(),
        tier: s.tier,
        title: s.title,
        oneLineTakeaway: s.oneLineTakeaway,
        whyItMatters: s.whyItMatters,
        whatsNext: s.whatsNext,
        signalTags: tags,
        entities: s.entities,
        evidenceItemIds: evidence,
        narrativeId: s.narrativeId ?? undefined,
      });
    }

    // tier desc + 截到 targetN（LLM 可能返回过多）
    return result.sort((a, b) => b.tier - a.tier).slice(0, input.targetN);
  }

  /** X2 i18n 头部注入（决策 I5） */
  injectLanguageHeader(systemPrompt: string, lang: "zh-CN" | "en-US"): string {
    const header =
      lang === "en-US"
        ? "[CRITICAL: Output all fields in English. Do not translate proper nouns (NVIDIA stays NVIDIA).]\n\n"
        : "[CRITICAL: 所有字段用中文输出。专有名词保留原文（如 NVIDIA / OpenAI）。]\n\n";
    return header + systemPrompt;
  }
}

function xmlEscape(s: string): string {
  // PR-DR2 P1-A (X8 安全评审整改) — 补 " 和 ' 转义（防御深度，
  // 即使外层 JSON.stringify 再次 escape，也确保 K1 prompt injection 边界完整）
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return trimmed;
}
