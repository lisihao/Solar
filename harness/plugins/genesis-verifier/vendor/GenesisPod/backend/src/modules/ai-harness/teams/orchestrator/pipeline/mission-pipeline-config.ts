/**
 * MissionPipelineConfig — pipeline 声明式配置（v5.1 §3.2 / §4 R1-B）
 *
 * ai-app 通过 defineMissionPipeline(config) 创建一个 PipelineConfig，
 * 注册到 MissionPipelineRegistry，PipelineOrchestrator 按 config 顺序执行。
 *
 * 业务无关：config 不知道 ai-app 名；roles + hooks 都通过 stable id / function
 * 引用注入业务行为。
 */
import type {
  IStagePrimitive,
  StageStepConfig,
  ResolvedRole,
  ResolvedStageHooks,
  StagePrimitiveId,
} from "../../services/stages/abstractions";

/**
 * Pipeline 中的一个 step（stage primitive 实例化引用）
 */
export interface PipelineStepConfig extends StageStepConfig {
  /** 该 step 用哪个 primitive（与 IStagePrimitive.id 对应）*/
  readonly primitive: StagePrimitiveId;
  /** 该 step 用哪个 role（PipelineConfig.roles 中的 id）*/
  readonly roleId?: string;
  /** 业务级 hook（通过名字索引；具体名字按 primitive 决定）*/
  readonly hooks?: ResolvedStageHooks;
}

/**
 * Pipeline 中的 role 定义（PipelineOrchestrator 把它解析为 ResolvedRole）
 */
export interface PipelineRoleConfig {
  /** 在 pipeline 内的标识（被 step.roleId 引用）*/
  readonly id: string;
  /** SKILL.md 引用 + builder 注入 → ResolvedRole.skillSpec */
  readonly skillSpec: ResolvedRole["skillSpec"];
  /** stateful=true 时 stage primitive 自动 appendDecision */
  readonly stateful?: boolean;
}

/**
 * 完整 PipelineConfig
 */
export interface MissionPipelineConfig {
  /** pipeline id（全局唯一，用于 registry 查找；如 "{app}" / "writing-team" 等业务名）*/
  readonly id: string;

  /** 角色集合（按 id 索引；step.roleId 引用之）*/
  readonly roles: ReadonlyArray<PipelineRoleConfig>;

  /** stage 顺序（按数组顺序执行）*/
  readonly steps: ReadonlyArray<PipelineStepConfig>;

  /** 默认每 step 超时（step.timeoutMs 缺失时用此值；undefined=无默认）*/
  readonly defaultStepTimeoutMs?: number;

  /** 业务无关元数据（描述 / 版本等，不影响执行）*/
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * defineMissionPipeline helper（identity + freeze，作为 ai-app 的声明式入口）
 *
 * 用法（ai-app 在 const 文件）：
 *   export const MY_PIPELINE = defineMissionPipeline({
 *     id: "{app}",
 *     roles: [...],
 *     steps: [{ primitive: "plan", id: "step-plan", roleId: "leader", ... }, ...],
 *   });
 */
export function defineMissionPipeline(
  config: MissionPipelineConfig,
): MissionPipelineConfig {
  validatePipelineConfig(config);
  return Object.freeze({
    ...config,
    roles: Object.freeze([...config.roles]),
    steps: Object.freeze([...config.steps]),
  });
}

/**
 * 启动期校验 PipelineConfig 不变量
 */
export function validatePipelineConfig(config: MissionPipelineConfig): void {
  if (!config.id) {
    throw new Error("[MissionPipelineConfig] id is required");
  }
  if (config.steps.length === 0) {
    throw new Error(
      `[MissionPipelineConfig:${config.id}] steps cannot be empty`,
    );
  }

  // role id 唯一
  const roleIds = new Set<string>();
  for (const r of config.roles) {
    if (roleIds.has(r.id)) {
      throw new Error(
        `[MissionPipelineConfig:${config.id}] duplicate role id: "${r.id}"`,
      );
    }
    roleIds.add(r.id);
  }

  // step.id 唯一 + step.roleId 在 roles 中存在
  const stepIds = new Set<string>();
  for (const s of config.steps) {
    if (stepIds.has(s.id)) {
      throw new Error(
        `[MissionPipelineConfig:${config.id}] duplicate step id: "${s.id}"`,
      );
    }
    stepIds.add(s.id);
    if (s.roleId && !roleIds.has(s.roleId)) {
      throw new Error(
        `[MissionPipelineConfig:${config.id}] step "${s.id}" references unknown roleId "${s.roleId}"`,
      );
    }
  }
}

/**
 * 解析后的 step 定义（PipelineOrchestrator 在执行时构造）
 */
export interface ResolvedPipelineStep {
  readonly step: PipelineStepConfig;
  readonly primitive: IStagePrimitive;
  readonly role: ResolvedRole | undefined;
  readonly timeoutMs: number | undefined;
}
