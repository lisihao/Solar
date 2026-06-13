/**
 * 前端 systemStageId → 后端 PLAYGROUND_PIPELINE.stepId 映射（单源）
 *
 * 上游：backend mission-stage-bindings.service.ts STEP_ID_TO_FRONTEND_STAGE_ID 的逆映射。
 * 后端如果改了 stage 名，必须同步改这里——frontend-contract spec 兜底验证。
 *
 * 历史：曾在 TodoDetailDrawer / MissionTodoBoard 各自重复定义（PR-R5b-FULL 临时双源），
 * 抽出后两处统一 import。
 *
 * 收尾评审 P0-A1 (2026-05-07): s12-self-evolution 不在 backend pipeline.steps
 * （postlude 异步任务），从此映射删，前端不再渲染重跑按钮。
 */
export const FRONTEND_STAGE_TO_STEP_ID: Record<string, string> = {
  's1-budget': 's1-budget',
  's2-leader-plan': 's2-leader-plan',
  's3-researchers': 's3-researcher-collect',
  's4-leader-assess': 's4-leader-assess',
  's5-reconciler': 's5-reconciler',
  's6-analyst': 's6-analyst',
  's7-writer-outline': 's7-writer-outline',
  's8-writer-draft': 's8-writer',
  's8b-quality-enhancement': 's8b-quality-enhancement',
  's9-critic-l4': 's9-critic',
  's9b-objective-evaluation': 's9b-objective-eval',
  's10-leader-signoff': 's10-leader-foreword-signoff',
  's11-persist': 's11-persist',
};
