/**
 * Leader stage agent (single class, multi-phase) — barrel export
 *
 * LeaderAgent 是 mission 唯一最终负责对象，全程在 4 个 milestone 在场:
 *   - phase=plan            (M0)  维度规划 + 声明 goals/qualityBar/successCriteria
 *   - phase=assess-research (M1)  researchers 完成后做过程管理决策
 *   - phase=foreword        (M6)  写 meta-level 综合摘要
 *   - phase=signoff         (M7)  签字 + 自评分 + accountabilityNote
 *
 * 每个 phase 的具体职责说明书见 SKILL.md `<!-- duty:<phase>:start -->` 段
 * （duty-loader 委托 skill-md-loader 加载）。
 *
 * 工程层封装见 services/leader.service.ts (SupervisedMission)，
 * 它持有 missionContext 跨 milestone 复用，让 LeaderAgent 在 M7 看到自己历史决策。
 */

export {
  LeaderAgent,
  type LeaderInput,
  type LeaderOutput,
  type LeaderPlanOutput,
  type LeaderAssessResearchOutput,
  type LeaderForewordOutput,
  type LeaderSignoffOutput,
} from "./leader.agent";
