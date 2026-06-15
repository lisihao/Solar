import {
  defineMissionPipeline,
  type MissionPipelineConfig,
} from "../../deep-insight/runner-deps";
import { DEEP_INSIGHT_PIPELINE } from "../../deep-insight/recipe/deep-insight.recipe";

const DEEP_INSIGHT_SOLAR_CATALOG = {
  id: "deep-insight-solar",
  name: "Solar 强模型深度洞察 Mission",
  tagline: "13-step + 1 background postlude",
  description:
    "复制 deep-insight mission kernel，并在 S2/S6/S8/S9 接入 Solar browser-agent 强模型算子；原 deep-insight 保持 A/B baseline。",
  category: "analysis",
  icon: "Solar",
  version: "0.1.0",
  missionType: "deep-insight-solar",
  pipelineId: "deep-insight-solar",
  roles: [
    "leader",
    "researcher",
    "reconciler",
    "analyst",
    "writer",
    "reviewer",
    "verifier",
    "steward",
  ],
  stages: [
    "预算闸",
    "Solar Leader 规划",
    "并行调研",
    "Leader 评估",
    "跨维对账",
    "Solar 综合分析",
    "大纲规划",
    "Solar 分段成稿",
    "质量增强与图文验证",
    "Solar 独立红队",
    "客观评估",
    "Leader 序言签发",
    "最终持久化",
  ],
  stepsLabel: "13 步工作流 + 1 后台复盘",
  modelCount: 1,
  skillCount: 12,
  toolCount: 20,
  tags: ["deep-insight", "solar", "browser-agent", "experimental"],
  abBaselineCapabilityId: "deep-insight",
} as const;

export const DEEP_INSIGHT_SOLAR_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    ...DEEP_INSIGHT_PIPELINE,
    id: "deep-insight-solar",
    meta: {
      ...(DEEP_INSIGHT_PIPELINE.meta ?? {}),
      missionType: "deep-insight-solar",
      catalog: DEEP_INSIGHT_SOLAR_CATALOG,
      experimental: true,
      abBaselinePipelineId: "deep-insight",
      solarStrongModelStages: [
        "s2-leader-plan",
        "s6-analyst",
        "s8-writer",
        "s9-critic",
      ],
    },
  });
