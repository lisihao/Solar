/**
 * step-id-mapping.contract.ts — single source of truth for step-id → frontend stage-id mapping
 *
 * Background: orchestrator step IDs and frontend stage IDs differ in 5 places
 * (historical naming divergence). This map is the canonical bridge used by both
 * MissionStageBindingsService and PlaygroundPipelineDispatcher.
 *
 * Do NOT duplicate this map. Any consumer inside playground must import from here.
 */

export const STEP_ID_TO_FRONTEND_STAGE_ID: Record<string, string> = {
  "s1-budget": "s1-budget",
  "s2-leader-plan": "s2-leader-plan",
  "s3-researcher-collect": "s3-researchers",
  "s4-leader-assess": "s4-leader-assess",
  "s5-reconciler": "s5-reconciler",
  "s6-analyst": "s6-analyst",
  "s7-writer-outline": "s7-writer-outline",
  "s8-writer": "s8-writer-draft",
  "s8b-quality-enhancement": "s8b-quality-enhancement",
  "s9-critic": "s9-critic-l4",
  "s9b-objective-eval": "s9b-objective-evaluation",
  "s10-leader-foreword-signoff": "s10-leader-signoff",
  "s11-persist": "s11-persist",
  "s12-self-evolution": "s12-self-evolution",
};

export function mapStepIdToFrontendStageId(stepId: string): string {
  return STEP_ID_TO_FRONTEND_STAGE_ID[stepId] ?? stepId;
}
