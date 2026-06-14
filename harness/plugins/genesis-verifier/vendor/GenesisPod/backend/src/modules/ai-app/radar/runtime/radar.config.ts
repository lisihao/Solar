/**
 * radar.config.ts —— AI Radar Mission Pipeline 配置
 *
 * 完全照抄 playground/playground.config.ts 范式：
 *   - 用 defineMissionPipeline 框架（ai-harness/facade）
 *   - 每个 role.skillSpec 走 buildSkillSpecFromMd 从 agents/<dir>/SKILL.md 加载
 *   - 由 MissionPipelineOrchestrator 执行；本文件是唯一配置来源
 *
 * Pipeline 全集：
 *   - RADAR_REFRESH_PIPELINE  : 主刷新链路（8 step：collect → dedupe → relevance →
 *                                 quality → entity → insight → persist + budget gate）
 *   - RADAR_DISCOVERY_PIPELINE: AI 推荐源（1 step：source-curator）
 *
 * 数据采集（s2-collect）走 ai-engine 标准 services：
 *   - RSS  → ai-app/explore/ingestion/crawlers/RssService.fetchRssFeed
 *   - YT   → ai-engine/content/fetch/YoutubeService（或 RSS feed channel_id）
 *   - X    → AgentInvoker 调 web-search tool（不再自写 Nitter collector）
 *   - CUSTOM → ai-engine/content/fetch/ContentFetchService
 */
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import {
  defineMissionPipeline,
  type MissionPipelineConfig,
  type ResolvedRole,
} from "@/modules/ai-harness/facade";
import { loadSkill } from "../mission/services/skill-md-loader";

function buildSkillSpecFromMd(agentDir: string): ResolvedRole["skillSpec"] {
  const skillPath = path.resolve(
    __dirname,
    "..",
    "mission",
    "agents",
    agentDir,
    "SKILL.md",
  );
  if (!fs.existsSync(skillPath)) {
    throw new Error(`[radar.config] missing SKILL.md: ${skillPath}`);
  }
  const skill = loadSkill(agentDir);
  const sections: string[] = [];
  if (skill.soul) sections.push(skill.soul);
  for (const dutyName of skill.frontmatter.duties) {
    sections.push(skill.duties[dutyName]);
  }
  // outputSchema 用 z.unknown()：radar stage 内部已经对 LLM 输出做了 tryParseJson +
  // clampScore + shape 守卫（见各 stage adapter），不依赖 framework outputSchema 校验；
  // 但用真 zod schema 而非伪造 always-success object，避免 lying assertion。
  return {
    id: skill.frontmatter.id,
    systemPrompt: sections.join("\n\n---\n\n"),
    allowedToolIds: [...skill.frontmatter.allowedTools],
    allowedModels: [...skill.frontmatter.allowedModels],
    outputSchema: z.unknown(),
    meta: {
      skillVersion: skill.frontmatter.version,
      skillDomain: skill.frontmatter.domain,
    },
  };
}

/**
 * 主刷新 mission pipeline：用户点"立即刷新"或 cron 触发时跑这个。
 *
 * 8 step 全部映射到通用 primitive（plan/research/assess/synthesize/persist），由
 * orchestrator 调度；business orchestrator 提供 hook 闭包注入业务逻辑。
 *
 * step timeoutMs 仅作 stage:stalled 警告阈值（与 playground 一致），不杀 step；
 * 实际 mission 终结靠 wall-time + abort signal + liveness guard 三层。
 */
export const RADAR_REFRESH_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "ai-radar.refresh",
    roles: [
      {
        id: "relevance-judge",
        skillSpec: buildSkillSpecFromMd("relevance-judge"),
        stateful: false,
      },
      {
        id: "quality-rater",
        skillSpec: buildSkillSpecFromMd("quality-rater"),
        stateful: false,
      },
      {
        id: "entity-extractor",
        skillSpec: buildSkillSpecFromMd("entity-extractor"),
        stateful: false,
      },
      {
        id: "signal-analyst",
        skillSpec: buildSkillSpecFromMd("signal-analyst"),
        stateful: true,
      },
    ],
    steps: [
      // S1 — 预算闸 / 加载 topic + enabled sources
      {
        primitive: "persist",
        id: "s1-source-resolve",
        mode: "source-resolve",
        timeoutMs: 30_000,
        dag: {
          ctxReads: ["input"],
          ctxWrites: ["topic", "sources", "since"],
          dbWrites: [],
          successors: [],
          rerunable: false,
          rerunableReason: "源解析阶段不可重跑（重跑 = 改 topic 配置）",
        },
      },
      // S2 — 多源并发采集（RSS/YT/X/Custom）
      {
        primitive: "persist",
        id: "s2-collect",
        mode: "multi-source-fanout",
        timeoutMs: 600_000,
        dag: {
          ctxReads: ["topic", "sources", "since"],
          ctxWrites: ["rawItems", "sourceErrors"],
          dbWrites: [],
          successors: [
            "s3-dedupe",
            "s4-relevance",
            "s5-quality",
            "s6-entity",
            "s7-insight",
            "s8-persist",
          ],
          rerunable: true,
          // resetFields: MissionColumnKey 也是 playground 专属 enum；radar 不接入 cascade，留空
        },
      },
      // S3 — externalId + contentHash 去重
      {
        primitive: "persist",
        id: "s3-dedupe",
        mode: "dedupe",
        timeoutMs: 60_000,
        dag: {
          ctxReads: ["rawItems"],
          ctxWrites: ["uniqueItems", "newItemIds"],
          dbWrites: [],
          successors: [
            "s4-relevance",
            "s5-quality",
            "s6-entity",
            "s7-insight",
            "s8-persist",
          ],
          rerunable: true,
        },
      },
      // S4 — 相关性评分（LLM batch）
      {
        primitive: "persist",
        id: "s4-relevance",
        roleId: "relevance-judge",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["topic", "uniqueItems"],
          ctxWrites: ["scoredItems"],
          // dbWrites: MissionColumnKey 是 playground 专属 enum；radar 暂不接入 cascade rerun，留空
          dbWrites: [],
          successors: ["s5-quality", "s6-entity", "s7-insight", "s8-persist"],
          rerunable: true,
        },
      },
      // S5 — 质量评分 + 中文摘要（2-in-1）
      {
        primitive: "persist",
        id: "s5-quality",
        roleId: "quality-rater",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["scoredItems"],
          ctxWrites: ["ratedItems"],
          dbWrites: [],
          successors: ["s6-entity", "s7-insight", "s8-persist"],
          rerunable: true,
        },
      },
      // S6 — 实体抽取
      {
        primitive: "persist",
        id: "s6-entity",
        roleId: "entity-extractor",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["ratedItems"],
          ctxWrites: ["enrichedItems"],
          dbWrites: [],
          successors: ["s7-insight", "s8-persist"],
          rerunable: true,
        },
      },
      // S7 — 信号洞察（stateful，跨周期对比上期 insight）
      {
        primitive: "persist",
        id: "s7-insight",
        roleId: "signal-analyst",
        mode: "signal-analysis",
        timeoutMs: 300_000,
        dag: {
          ctxReads: ["topic", "enrichedItems"],
          ctxWrites: ["insightPayload"],
          dbWrites: [],
          successors: ["s8-persist"],
          rerunable: true,
        },
      },
      // S8 — accepted=true 持久化 + topic.lastRunAt/nextDueAt + notification
      {
        primitive: "persist",
        id: "s8-persist",
        mode: "finalize",
        timeoutMs: 60_000,
        dag: {
          ctxReads: ["enrichedItems", "insightPayload"],
          ctxWrites: [],
          dbWrites: [],
          successors: [],
          rerunable: false,
          rerunableReason: "持久化是 mission 终点，重跑等于重新整轮",
        },
      },
    ],
  });

/**
 * AI 推荐源 mission pipeline：用户点"AI 推荐数据源"按钮时跑这个。
 *
 * 单 stage：source-curator agent 生成候选列表（用户后续勾选确认入库）。
 */
export const RADAR_DISCOVERY_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "ai-radar.discovery",
    roles: [
      {
        id: "source-curator",
        skillSpec: buildSkillSpecFromMd("source-curator"),
        stateful: false,
      },
    ],
    steps: [
      {
        primitive: "persist",
        id: "s1-discover",
        roleId: "source-curator",
        timeoutMs: 120_000,
        dag: {
          ctxReads: ["input"],
          ctxWrites: ["candidates"],
          dbWrites: [],
          successors: [],
          rerunable: true,
        },
      },
    ],
  });

export const RADAR_PIPELINES = [
  RADAR_REFRESH_PIPELINE,
  RADAR_DISCOVERY_PIPELINE,
] as const;
