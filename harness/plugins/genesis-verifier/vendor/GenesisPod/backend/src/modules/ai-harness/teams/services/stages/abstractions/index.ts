/**
 * Stage primitive abstractions 桶（v5.1 R1-A）
 */
export { CrossStageState } from "./cross-stage-state";
export {
  type IStagePrimitive,
  type StagePrimitiveId,
  type MissionContext,
  type RoleState,
  type PastDecision,
  type ResolvedRole,
  type StageStepConfig,
  type StageHookFn,
  type StageHookShape,
  type ResolvedStageHooks,
  type StageRunArgs,
  StageAbortError,
  defineStageHooks,
} from "./stage-primitive.interface";
