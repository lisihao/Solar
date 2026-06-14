/**
 * radar-discovery.stage.ts — source discovery stage adapter
 *
 * primitive=plan, roleId=source-curator
 *
 * 输入：ctx.input 为 RunRadarDiscoveryMissionInput（topicName / keywords /
 * description / entityType / existingSources）。
 *
 * 单次 LLM 调用，输出 source 候选列表：
 *   { candidates: [{type, identifier, label?, rationale?, confidence?}] }
 *
 * type 限定：X / YOUTUBE / RSS / CUSTOM
 * 结果通过 stage output 返回，不写库。
 * controller 负责后续让用户勾选入库（走 RadarSourceService）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AiChatService } from "@/modules/ai-engine/facade";
import { RadarSourceService } from "../../services/source/radar-source.service";
import { CreatableRadarSourceTypeDto } from "../../../api/dto";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";
import type { RunRadarDiscoveryMissionInput } from "../../../api/dto/run-radar-refresh-mission.dto";

/**
 * discovery stage 输出的单个候选源
 *
 * type 只允许 LLM 推荐的 3 类；X 已从推荐路径彻底剔除（旧数据 + admin
 * 手动添加仍走 RadarSourceType enum，但 LLM/discovery 链路单源 = 这 3 类）。
 */
export interface RadarSourceCandidate {
  type: "YOUTUBE" | "RSS" | "CUSTOM";
  identifier: string;
  label?: string;
  rationale?: string;
  confidence?: number;
  /**
   * R7 2026-05-19：collector 入库读的 config 字段。CUSTOM 必须有 listSelector，
   * YOUTUBE 可选 channelId 缓存等。LLM 在 CUSTOM 候选必须输出 config.listSelector，
   * 不能只在 rationale 描述（rationale 不入库）。
   */
  config?: Record<string, unknown>;
}

/** stage output 结构（也写入 ctx 供外层取） */
export interface RadarDiscoveryOutput {
  candidates: RadarSourceCandidate[];
  /**
   * R7 2026-05-19：preflight 过滤掉的候选 + 原因，前端展示
   * "AI 推荐 X，已过滤 Y 个不可达"。
   */
  skipped?: Array<{ type: string; identifier: string; reason: string }>;
}

// 2026-05-17 业务策略：source-curator 不再推荐 type=X（Nitter 全死，业界
// Feedly/Inoreader 已淡化 X 集成）。RECOMMENDABLE_TYPES = LLM/discovery
// 单一事实来源；prompt 限定 + normalize 兜底 + 入口前 normalize 全用它。
// Prisma RadarSourceType enum 仍含 X 是为兼容旧数据 + admin 手动加，但
// discovery 链路不再认 X — 不论 LLM 怎么写都会被 normalize 成 CUSTOM 后
// 走 URL 校验，进一步把异常输入挡在 bulkCreate 之前。
const RECOMMENDABLE_TYPES = new Set<RadarSourceCandidate["type"]>([
  "YOUTUBE",
  "RSS",
  "CUSTOM",
]);
const X_ALIASES = new Set(["X", "TWITTER", "TWEET"]);

@Injectable()
export class RadarDiscoveryStage implements RadarStageRunner {
  private readonly log = new Logger(RadarDiscoveryStage.name);

  constructor(
    private readonly chat: AiChatService,
    // R7 2026-05-19：注入 SourceService 用 preflightCandidates，在推荐生成阶段
    // 就过滤不可达源。复用现有 CollectorRouter.fanOut（不造轮子）。
    private readonly sourceService: RadarSourceService,
  ) {}

  async run(args: RadarStageHookArgs, ctx: RadarMissionContext): Promise<void> {
    if (ctx.signal.aborted) throw new Error("aborted_during_discovery");

    const input = ctx.input as RunRadarDiscoveryMissionInput;
    if (!input.topicName) throw new Error("Discovery stage: topicName 缺失");

    const systemPrompt =
      args.systemPrompt ||
      "你是 AI 雷达的信源策展专家，根据主题信息推荐高质量数据源。";

    // 1) LLM 生成原始候选（多召回，让 preflight 过滤后仍 5+ 留存）
    const rawCandidates = await this.discoverSources(
      systemPrompt,
      input,
      ctx.userId,
    );

    // 2) R7 推荐阶段就 preflight ——
    //    用户截图反馈：AI 推荐 6 个，5 个不可达（404/403/YT @handle 无法解析）。
    //    旧链路要等用户勾选 accept 才发现，体验差。改在生成时就过滤。
    if (ctx.signal.aborted) throw new Error("aborted_during_preflight");
    const { live, skipped } = await this.sourceService.preflightCandidates(
      input.topicId,
      ctx.userId,
      rawCandidates.map((c) => ({
        // RadarSourceCandidate.type 字面量 → enum 值（值相同，仅类型层不同）
        type: c.type as unknown as CreatableRadarSourceTypeDto,
        identifier: c.identifier,
        label: c.label,
        config: c.config,
      })),
    );

    // 把 preflight 通过的合回 candidate 形式（保留 rationale/confidence 元信息）
    const liveSet = new Set(live.map((c) => `${c.type}:${c.identifier}`));
    const liveCandidates = rawCandidates.filter((c) =>
      liveSet.has(`${c.type}:${c.identifier}`),
    );

    this.log.log(
      `[${ctx.missionId}] Discovery: topic="${input.topicName}" ` +
        `raw=${rawCandidates.length} live=${liveCandidates.length} ` +
        `skipped=${skipped.length}`,
    );

    (
      ctx.state as {
        discoveryCandidates?: RadarSourceCandidate[];
        discoverySkipped?: typeof skipped;
      }
    ).discoveryCandidates = liveCandidates;
    (ctx.state as { discoverySkipped?: typeof skipped }).discoverySkipped =
      skipped;
    return;
  }

  private async discoverSources(
    systemPrompt: string,
    input: RunRadarDiscoveryMissionInput,
    userId: string,
  ): Promise<RadarSourceCandidate[]> {
    // 构建已有源列表（让 LLM 避免重复推荐）
    const existingList =
      input.existingSources.length > 0
        ? input.existingSources
            .slice(0, 20)
            .map((s) => `${s.type}:${s.identifier}`)
            .join(", ")
        : "无";

    const userPrompt = `请为以下主题推荐 12-20 个高质量数据源候选。

主题信息：
${JSON.stringify({
  name: input.topicName,
  description: truncate(input.description ?? "", 400),
  keywords: input.keywords.slice(0, 20),
  entityType: input.entityType ?? null,
})}

已有数据源（请勿重复推荐）：${existingList}

【关键约束】 R7 2026-05-19：本系统会在你输出后**立即做 preflight 真发 HTTP 请求**
过滤不可达源，前端只展示通过的。所以：
- **召回优先**：宁可多推（12-20 个）让 preflight 过滤，也不要少推 5 个里 3 个死链
- **绝不编 URL**：不知道就别推 —— 输出 8 个真实可达比 15 个掺死链强
- **CUSTOM 必带 config.listSelector**：CSS selector 必须放在 \`config.listSelector\` 字段（不是 rationale）—— rationale 是给用户看的文本，不入库 collector
- **YOUTUBE @handle 解析失败率高**（YouTube 反爬）：能给 channelId 一定给 channelId，给不出 channelId 时 confidence 标 0.5 表示风险

推荐要求：
- type **只能 3 种**：YOUTUBE（频道）/ RSS（官博/媒体/Substack/Newsletter）/ CUSTOM（列表页 + selector）
- **绝对不输出 type=X / Twitter**（Nitter 全死 + 业界 Feedly/Inoreader 已淡化 X）
- KOL 主题（如 "Elon Musk" / "Sam Altman"）按优先级找等价一手源：
  1. 本人 Substack / 个人 blog RSS / 本人主讲 YouTube
  2. 含本人的长访谈播客 YouTube（Lex Fridman / Dwarkesh / All-In / Joe Rogan）
  3. 组织官方 YouTube / 官博 RSS（仅作工作内容补充）
  4. 同领域权威媒体深度报道 RSS（最远兜底，不要 paywall）
- 反模式（不要）：
  - "Elon" → 只给 Tesla 官博（个人 personality 内容全丢）
  - "SeekingAlpha" → 给公开 RSS（2022 起几乎空）
  - 凭命名规则编 \`newsroom.<公司>.com/feed\` / \`feeds.<公司>.com\` / \`<公司>.com/rss\`
- identifier 规范：
  - YOUTUBE: 首选 24 位 channelId (UC 开头)；次选 \`https://www.youtube.com/channel/UC...\` 完整 URL；可接 \`https://www.youtube.com/@handle\` 但 confidence 降 0.5；**禁裸 @handle**
  - RSS: 必须是你**已知存在**且 2024+ 仍在维护的完整 https URL；不确定就别推
  - CUSTOM: 列表页完整 https URL，**必须**附 config.listSelector
- 不推 paywall / 401 / 已停 feed（SeekingAlpha Premium / WSJ / Bloomberg / Reuters 公开 feed）
- confidence 0-1 浮点（推荐把握度）；CUSTOM 缺 selector / YT 仅 @handle 时 ≤0.6

请严格按以下 JSON schema 返回（无 markdown 围栏，**绝不**输出额外说明）：
{
  "candidates": [
    {
      "type": "YOUTUBE|RSS|CUSTOM",
      "identifier": "URL 或 channelId",
      "label": "来源名称",
      "rationale": "≤80 字推荐理由",
      "confidence": 0.85,
      "config": { "listSelector": "article.post h2 a" }
    }
  ]
}
- config 字段：CUSTOM 必填 listSelector；YOUTUBE/RSS 可省略整个 config 字段。`;

    try {
      const result = await this.chat.chat({
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
        userId,
        operationName: "radar.discovery",
        skipGuardrails: true,
      });

      const parsed = tryParseJson<{ candidates: unknown[] }>(result.content);
      if (!parsed || !Array.isArray(parsed.candidates)) {
        this.log.warn("Discovery LLM unparseable, returning empty candidates");
        return [];
      }

      return (
        parsed.candidates
          .filter(
            (c): c is Record<string, unknown> =>
              c !== null && typeof c === "object",
          )
          // 2026-05-17：业务策略 drop type=X 候选（prompt 失守防御）。
          // 大小写 / 别名（TWITTER/TWEET）都拦：LLM 实际可能吐 "x"/"X "/"twitter"。
          .filter((c) => !isXAlias(c["type"]))
          .map((c) => ({
            type: normalizeSourceType(c["type"]),
            // 2026-05-17 R3 spec 抓到：LLM 返回 "   " 全空白时不 trim 直接当合法
            // identifier 走 assertIdentifierShape，shape 校验侧才挡，浪费一次错误日志。
            identifier: truncate(String(c["identifier"] ?? "").trim(), 500),
            label:
              typeof c["label"] === "string"
                ? truncate(c["label"], 200)
                : undefined,
            rationale:
              typeof c["rationale"] === "string"
                ? truncate(c["rationale"], 80)
                : undefined,
            confidence:
              typeof c["confidence"] === "number" &&
              Number.isFinite(c["confidence"])
                ? Math.max(0, Math.min(1, c["confidence"]))
                : undefined,
            // R7：解析 LLM 输出的 config（CUSTOM 候选必带 listSelector）
            config:
              c["config"] && typeof c["config"] === "object"
                ? (c["config"] as Record<string, unknown>)
                : undefined,
          }))
          .filter((c) => c.identifier.length > 0)
      );
    } catch (err) {
      this.log.error(`Discovery LLM err: ${(err as Error).message}`);
      return [];
    }
  }
}

function normalizeType(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

function isXAlias(raw: unknown): boolean {
  return X_ALIASES.has(normalizeType(raw));
}

function normalizeSourceType(raw: unknown): RadarSourceCandidate["type"] {
  const normalized = normalizeType(raw);
  if (RECOMMENDABLE_TYPES.has(normalized as RadarSourceCandidate["type"])) {
    return normalized as RadarSourceCandidate["type"];
  }
  return "CUSTOM";
}

function tryParseJson<T>(raw: string): T | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const firstBrace = stripped.search(/[{[]/);
  const candidate = firstBrace >= 0 ? stripped.slice(firstBrace) : stripped;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}
