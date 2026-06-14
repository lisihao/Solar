/**
 * BusinessAgentTeam — Business Orchestrator Framework 接口
 *
 * 三家 ai-app business orchestrator 公共契约（stepId → hooks 调度骨架）：
 *
 *   - sessionLookup 注入机制（dispatcher.onModuleInit 调一次 bindSessionLookup）
 *   - stepId → StageRunner 解析（业务方填表）
 *   - StageRunner → ResolvedStageHooks 适配（业务方决定主 hook key:
 *     persist / runRole / synthesize / draft / review / ...）
 *
 * 业务侧扩展模板：
 * ```ts
 * @Injectable()
 * export class MyBusinessOrchestrator extends BusinessTeamOrchestratorFramework<MySessionEntry> {
 *   constructor(...) {
 *     super({ namespace: "my-app", stageNumber: { "s1-foo": 1, ... } });
 *   }
 *   protected resolveStageRunner(stepId: string): StageRunner<MySessionEntry> | null {
 *     switch (stepId) {
 *       case "s1-foo": return (entry, args) => runFooStage(entry.ctx, entry.deps);
 *       ...
 *     }
 *   }
 *   // 默认 adapt 成 hooks.persist。其它 primitive 用此 hook 覆盖。
 *   protected adaptRunnerToHooks(runner, stepId, primitive): ResolvedStageHooks {
 *     // 自定义映射规则；缺省继承 framework 默认（hooks.persist）
 *   }
 * }
 * ```
 *
 * 2026-05-24 (P7) 抽取自三家业务 orchestrator 公共部分:
 *   - ai-app/playground/services/mission/workflow/playground-business-orchestrator.service.ts  @migrated-from
 *   - ai-app/social/services/mission/workflow/social-business-orchestrator.service.ts  @migrated-from
 *   - ai-app/radar/services/mission/workflow/radar-business-orchestrator.service.ts  @migrated-from
 */

import type {
  ResolvedStageHooks,
  StageRunArgs,
} from "../../../services/stages/abstractions";

/**
 * Generic stage runner —— 业务方填表 stepId → runner，runner 拿到当前 session 视图
 * + stage args，写副作用到 session 状态或 return value。
 */
export type StageRunner<TSession> = (
  entry: TSession,
  args: StageRunnerArgs,
) => Promise<unknown>;

/** stage runner 被调用时拿到的 framework 透传 args（来自 ResolvedStageHooks 调用） */
export interface StageRunnerArgs {
  readonly ctx: StageRunArgs["ctx"];
  readonly previousOutputs?: StageRunArgs["previousOutputs"];
  readonly crossStageState?: StageRunArgs["crossStageState"];
  readonly role?: StageRunArgs["role"];
  /** stepId（透传，便于业务 runner 内做日志） */
  readonly stepId: string;
  /** primitive 类型（plan/research/synthesize/draft/review/persist/...） */
  readonly primitive: string;
}

/**
 * Framework 配置：业务方注入命名空间 + 可选 stage 编号表。
 */
export interface BusinessTeamOrchestratorConfig {
  /** logger 标签前缀 + 错误日志前缀（业务方填团队 namespace） */
  readonly namespace: string;
  /**
   * stepId → DB stageNumber 映射（可选；用于 markStageComplete 进度索引）
   * 业务方可通过 framework.getStageNumber(stepId) 查询。
   */
  readonly stageNumber?: Record<string, number>;
}

/** session lookup 函数（dispatcher 注入；framework 内通过它访问 SessionEntry） */
export type SessionLookupFn<TSession> = (missionId: string) => TSession;

/** Re-export 给业务方使用，避免重复 import 路径 */
export type { ResolvedStageHooks, StageRunArgs };
