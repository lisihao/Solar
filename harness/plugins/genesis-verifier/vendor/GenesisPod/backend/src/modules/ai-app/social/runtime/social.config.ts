/**
 * social.config.ts — SocialPublishMission Pipeline 配置
 *
 * 把 12 个 stage（s1-s11，含 s8b）声明为 generic primitive，由 harness
 * MissionPipelineOrchestrator 顺序执行；s12 self-evolution 不入 pipeline.steps，
 * 由 dispatcher 在 mission terminal 后 fire-and-forget 触发。
 *
 * 两套 pipeline（2026-05-17 单轨化）：
 *   - SOCIAL_PIPELINE        13 step（standard / deep）AI 完整改写 + 封面 + polish
 *   - SOCIAL_FAST_PIPELINE   4 step（quick）s1 Steward 预算闸 + s8 真发 + s9 验证 + s11 持久化
 *
 * 设计要点（参照 playground/playground.config.ts）：
 *   - 所有 step 用 primitive="persist"：social 各 stage 都是 side-effect 操作
 *     （读 / 写 ctx + 写浏览器 + 写远端 API），与 persist primitive 的 hook 形态
 *     （hooks.persist({ ctx, previousOutputs, crossStageState })）天然契合。
 *   - 真实业务 LLM 调用在 stage adapter 内通过 SocialAgentInvoker → AgentRunner
 *     完成；本 config 只声明 step 顺序 + 元数据（timeoutMs / DAG）。
 *   - role 列表为空：persist primitive 不需要 ResolvedRole；agent 调用走
 *     SocialAgentInvoker 直接拿 AgentSpec（DefineAgent 装饰器注册）。
 *   - dispatcher 按 input.depth=="quick" 选 SOCIAL_FAST_PIPELINE，其余走 SOCIAL_PIPELINE
 */

import {
  defineMissionPipeline,
  type MissionPipelineConfig,
} from "@/modules/ai-harness/facade";

export const SOCIAL_PIPELINE: MissionPipelineConfig = defineMissionPipeline({
  id: "social-publish-mission",
  roles: [],
  steps: [
    {
      primitive: "persist",
      id: "s1-mission-budget-eval",
      timeoutMs: 60_000,
    },
    {
      primitive: "persist",
      id: "s2-platform-probe",
      timeoutMs: 120_000,
    },
    {
      primitive: "persist",
      id: "s3-content-transform",
      timeoutMs: 600_000,
    },
    {
      primitive: "persist",
      id: "s4-leader-assess-transform",
      timeoutMs: 300_000,
    },
    {
      primitive: "persist",
      id: "s5-cover-craft",
      timeoutMs: 600_000,
    },
    {
      primitive: "persist",
      id: "s6-body-compose",
      timeoutMs: 600_000,
    },
    {
      primitive: "persist",
      id: "s7-polish-review",
      timeoutMs: 300_000,
    },
    {
      primitive: "persist",
      id: "s8-publish-execute",
      timeoutMs: 600_000,
    },
    {
      primitive: "persist",
      id: "s8b-publish-retry",
      timeoutMs: 600_000,
    },
    {
      primitive: "persist",
      id: "s9-publish-verify",
      timeoutMs: 300_000,
    },
    {
      primitive: "persist",
      id: "s10-leader-signoff",
      timeoutMs: 180_000,
    },
    {
      primitive: "persist",
      id: "s11-mission-persist",
      timeoutMs: 60_000,
    },
    // s12-self-evolution: fire-and-forget postlude，不入 pipeline.steps
    // 由 dispatcher 在 mission terminal 后通过 runSelfEvolutionStage 触发。
  ],
  defaultStepTimeoutMs: 10 * 60_000,
  meta: {
    description: "AI Social Publish Mission (W4 Agent Team)",
    eventPrefix: "social",
    runtimeVersion: "social-pipeline-v1",
  },
});

/**
 * Fast-track pipeline（quick depth / scheduler / batch publish 复用）
 *
 * 仅 4 step，跳过 AI 改写：
 *   - s1 Steward 4 闸（保留预算 / session / cooldown 守护，~3K token 单次 LLM）
 *   - s8 真发动作
 *   - s9 publish-verify（验证发布成功）
 *   - s11 持久化（写 SocialContent / SocialMission status）
 *
 * 成本对比单平台：~$0.01 vs SOCIAL_PIPELINE ~$0.08；时延 1-3min vs 5-15min。
 * 与旧 publish-executor.service 同步链式比：保留 Steward 预算闸 + s9 验证，仅
 * 多 ~$0.005 / 1min 时延，换来失败可见 + 验证保障。
 */
export const SOCIAL_FAST_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "social-publish-mission-fast",
    roles: [],
    steps: [
      {
        primitive: "persist",
        id: "s1-mission-budget-eval",
        timeoutMs: 60_000,
      },
      {
        primitive: "persist",
        id: "s8-publish-execute",
        timeoutMs: 600_000,
      },
      {
        primitive: "persist",
        id: "s9-publish-verify",
        timeoutMs: 300_000,
      },
      {
        primitive: "persist",
        id: "s11-mission-persist",
        timeoutMs: 60_000,
      },
    ],
    defaultStepTimeoutMs: 10 * 60_000,
    meta: {
      description: "AI Social Publish Mission (fast-track quick depth)",
      eventPrefix: "social",
      runtimeVersion: "social-pipeline-fast-v1",
    },
  });

/**
 * 按 input.depth 选择 pipeline
 */
export function selectSocialPipeline(
  depth: "quick" | "standard" | "deep",
): MissionPipelineConfig {
  return depth === "quick" ? SOCIAL_FAST_PIPELINE : SOCIAL_PIPELINE;
}
