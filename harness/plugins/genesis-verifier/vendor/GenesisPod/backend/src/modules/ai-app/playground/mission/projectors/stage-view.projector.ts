/**
 * stage-view.projector.ts — Pure projector for canonical stages[]（B2-2）
 *
 * 落地依据：thinning plan §6.4.2 / §6.4.2.a
 *
 * 纯函数（无 DI），输入 events + lastCompletedStage，输出 14 个 canonical stage。
 * §6.4.2 rule 5: 没事件的 stage 默认 pending，不擅自标 skipped。
 */

import { mapStepIdToFrontendStageId } from "../../api/contracts/step-id-mapping.contract";
import type {
  MissionViewBaseStage,
  StageProcessView,
  StageStatus,
} from "../../api/contracts/view-state.contract";
import { ORDERED_STAGE_IDS } from "../rerun/resume-rerun-policy.service";

// ============================================================================
// canonical stage labels（与 §6.4.2.a 14 个 stage 对齐）
// ============================================================================

/** stage label 中文映射。任何修改需同步前端 i18n 与 fixture expected-view.json。 */
const STAGE_LABELS: Record<string, string> = {
  "s1-budget": "预算计算",
  "s2-leader-plan": "Leader 规划",
  "s3-researchers": "研究员收集",
  "s4-leader-assess": "Leader 评估",
  "s5-reconciler": "协调器",
  "s6-analyst": "分析师",
  "s7-writer-outline": "写作大纲",
  "s8-writer-draft": "草稿撰写",
  "s8b-quality-enhancement": "章节质量增强",
  "s9-critic-l4": "L4 评审",
  "s9b-objective-evaluation": "客观评估",
  "s10-leader-signoff": "Leader 签署",
  "s11-persist": "持久化",
  "s12-self-evolution": "自我进化",
};

// ============================================================================
// Event shape (subset; full type in MissionEventBuffer)
// ============================================================================

interface StageRelevantEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

interface StageEventDigest {
  startedAt?: string;
  endedAt?: string;
  attempts: number;
  observed: Set<StageStatus>;
  failedDetail?: string;
  /** 最后看到的 verb（用于解决 rerun-in-flight：done → started 后状态应为 running）。 */
  lastVerb?: "started" | "completed" | "failed" | "skipped";
}

// ============================================================================
// Projector
// ============================================================================

export function projectStages(
  events: ReadonlyArray<StageRelevantEvent>,
): MissionViewBaseStage[] {
  const digestByStage = aggregateByStage(events);
  const processByStage = aggregateProcessByStage(events);

  return ORDERED_STAGE_IDS.map((id) => {
    const digest = digestByStage.get(id);
    const processTrace = processByStage.get(id);
    const label = STAGE_LABELS[id] ?? id;

    if (!digest) {
      return processTrace
        ? { id, label, status: "pending" as StageStatus, processTrace }
        : { id, label, status: "pending" as StageStatus };
    }

    const status = resolveStageStatus(digest);
    return {
      id,
      label,
      status,
      startedAt: digest.startedAt,
      endedAt: digest.endedAt,
      attempts: digest.attempts > 1 ? digest.attempts : undefined,
      detail: status === "failed" ? digest.failedDetail : undefined,
      processTrace,
    };
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function aggregateByStage(
  events: ReadonlyArray<StageRelevantEvent>,
): Map<string, StageEventDigest> {
  const result = new Map<string, StageEventDigest>();

  for (const ev of events) {
    const verb = extractVerb(ev.type, ev.payload);
    if (!verb) continue;
    const stageId = extractStageId(ev);
    if (!stageId) continue;
    const mapped = mapStepIdToFrontendStageId(stageId);

    const digest =
      result.get(mapped) ??
      ({
        attempts: 0,
        observed: new Set<StageStatus>(),
      } as StageEventDigest);

    const tsIso = isoTime(ev.timestamp);

    switch (verb) {
      case "started":
        digest.startedAt = tsIso; // 覆盖（rerun 时记录最新一轮 startedAt）
        digest.attempts += 1;
        digest.observed.add("running");
        digest.lastVerb = "started";
        // rerun-in-flight：clear 上一轮的 endedAt 让 view 显示当前轮 startedAt
        digest.endedAt = undefined;
        break;
      case "completed":
        digest.endedAt = tsIso;
        digest.observed.add("done");
        digest.lastVerb = "completed";
        break;
      case "failed":
        digest.endedAt = tsIso;
        digest.observed.add("failed");
        digest.failedDetail = extractFailDetail(ev) ?? digest.failedDetail;
        digest.lastVerb = "failed";
        break;
      case "skipped":
        digest.observed.add("skipped");
        digest.lastVerb = "skipped";
        break;
      default:
        // 其他 verb 不影响 stage status
        break;
    }

    result.set(mapped, digest);
  }

  return result;
}

/**
 * §6.4.2 status resolution。
 *
 * 优先级（rerun-in-flight 语义）：
 *   1. lastVerb = failed → failed（终态）
 *   2. lastVerb = started → running（即使之前 done，rerun 后仍是 running）
 *   3. lastVerb = completed → done
 *   4. lastVerb = skipped → skipped
 *   5. 无任何 verb → pending
 *
 * 用 lastVerb 而非 observed Set 解决 done→started 的 rerun-in-flight bug。
 */
function resolveStageStatus(digest: StageEventDigest): StageStatus {
  switch (digest.lastVerb) {
    case "failed":
      return "failed";
    case "started":
      return "running";
    case "completed":
      return "done";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function extractStageId(ev: StageRelevantEvent): string | null {
  // 兼容三种形态：
  //   1) type = "playground.stage.<verb>", payload.stepId = "s5-reconciler"（旧 fixture）
  //   2) type = "stage.started" 顶层（fixture 形态）
  //   3) type = "playground.stage:lifecycle"，payload.{stepId,stage,status}
  //      （★ 2026-05-27 修复：BusinessTeamMissionDispatcherFramework 实际 emit 的就是
  //       这一种 colon 单事件携 payload.status。projector 之前完全不识别 → stage 全 pending）
  const payload = ev.payload as Record<string, unknown> | null;
  if (payload && typeof payload.stepId === "string") {
    return payload.stepId;
  }
  if (payload && typeof payload.stage === "string") {
    return payload.stage;
  }
  return null;
}

function extractVerb(
  eventType: string,
  payload: unknown,
): "started" | "completed" | "failed" | "skipped" | null {
  // 形态 3 (prod)：stage:lifecycle 单事件，verb 在 payload.status
  if (
    eventType.endsWith("stage:lifecycle") ||
    eventType === "stage:lifecycle"
  ) {
    const p = payload as Record<string, unknown> | null;
    const status = p?.status;
    if (status === "started") return "started";
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "skipped") return "skipped";
    return null;
  }
  // 形态 1/2（fixture 兼容）：type 自带 verb
  if (eventType.endsWith("stage.started") || eventType === "stage.started") {
    return "started";
  }
  if (
    eventType.endsWith("stage.completed") ||
    eventType === "stage.completed"
  ) {
    return "completed";
  }
  if (eventType.endsWith("stage.failed") || eventType === "stage.failed") {
    return "failed";
  }
  if (eventType.endsWith("stage.skipped") || eventType === "stage.skipped") {
    return "skipped";
  }
  return null;
}

function extractFailDetail(ev: StageRelevantEvent): string | null {
  const payload = ev.payload as Record<string, unknown> | null;
  if (!payload) return null;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.message === "string") return payload.message;
  return null;
}

function isoTime(timestamp: number | string): string {
  if (typeof timestamp === "string") return timestamp;
  return new Date(timestamp).toISOString();
}

// ============================================================================
// T75: per-stage process trace aggregation
// ============================================================================

/**
 * Stage → agentId 模式映射。任何 agent 事件（agent:thought / action /
 * observation / reflection / error）的 payload.agentId 落到此表，归属到对应
 * stage 的 processTrace。
 *
 * 数据源（与 backend stage 文件 `agentId: "..."` literal 对齐）：
 *   s2-leader-plan / s4-leader-assess / s10-leader-signoff → "leader"（共享）
 *   s3-researchers → "researcher#0" / "researcher#1" / ...（每维度一个，
 *                    retry 变体 "researcher#N.retryK"）—— 故全部走 "researcher#" 前缀
 *   s5-reconciler → "reconciler"
 *   s6-analyst → "analyst" / "analyst.retry"
 *   s7-writer-outline → "outline-planner"
 *   s8-writer-draft → "writer#1" / "writer#2" / ... + "reviewer"
 *   s8b-quality-enhancement → "writer" / "writer#N"
 *   s9-critic-l4 / s9b-objective-evaluation → "critic"
 *
 * 因 leader agentId 在 s2/s4/s10 跨多 stage 复用，本表对 leader 类共享 agent
 * 走 "first stage wins" 策略：按 stage 升序优先归属（s2 先吃，s4/s10 漏出）。
 * 未来 backend agentId 改 `leader@s2-plan` 等可拆分后这条豁免可移除。
 */
const STAGE_AGENT_PATTERN: Record<
  string,
  { ids?: string[]; prefixes?: string[] }
> = {
  "s2-leader-plan": { ids: ["leader"] },
  // s3 数据采集：每维度派 researcher#${idx}（retry 走 researcher#${idx}.retry${n}）+
  // quality-judge#${idx}（章节质量判定），按各自前缀归入数据采集阶段。
  "s3-researchers": { prefixes: ["researcher#", "quality-judge#"] },
  "s4-leader-assess": { ids: ["leader"] },
  "s5-reconciler": { ids: ["reconciler"] },
  "s6-analyst": { ids: ["analyst"], prefixes: ["analyst."] },
  "s7-writer-outline": { ids: ["outline-planner"] },
  // M4 fix：s8 草稿阶段含 writer + reviewer（草稿/评审环），reviewer 之前漏映射。
  "s8-writer-draft": {
    prefixes: ["writer#", "writer."],
    ids: ["writer", "reviewer"],
  },
  "s8b-quality-enhancement": { ids: ["writer"], prefixes: ["writer#"] },
  // M4 fix：s9 含 critic + forecast-red-team（红队前瞻），后者之前漏映射。
  "s9-critic-l4": {
    ids: ["critic", "mission-critic", "forecast-red-team"],
    prefixes: ["critic."],
  },
  "s9b-objective-evaluation": {
    ids: ["critic", "evaluator"],
    prefixes: ["critic.", "evaluator."],
  },
  "s10-leader-signoff": { ids: ["leader"] },
};

/**
 * Stage 优先级 —— 用于解决 "leader" 共享 agentId 多 stage 归属：
 * 同一 leader 事件落到优先级最高的 stage。s2 < s4 < s10 时序优先 s2。
 */
const SHARED_LEADER_STAGE_ORDER = [
  "s2-leader-plan",
  "s4-leader-assess",
  "s10-leader-signoff",
] as const;

function matchStageForAgent(agentId: string): string | null {
  for (const [stageId, hint] of Object.entries(STAGE_AGENT_PATTERN)) {
    if (hint.ids?.includes(agentId)) {
      // leader 共享 agentId — 先返回首个匹配（外层调用方按时序去重）
      return stageId;
    }
    if (hint.prefixes?.some((p) => agentId.startsWith(p))) {
      return stageId;
    }
  }
  return null;
}

interface MutableStageProcess {
  reactTrace: StageProcessView["reactTrace"];
  llmCalls: StageProcessView["llmCalls"];
  inputs: StageProcessView["inputs"];
  outputPeek: Record<string, number | string>;
  totalTokens: number;
  totalDurationMs: number;
  stepCount: number;
}

function emptyMutable(): MutableStageProcess {
  return {
    reactTrace: [],
    llmCalls: [],
    inputs: [],
    outputPeek: {},
    totalTokens: 0,
    totalDurationMs: 0,
    stepCount: 0,
  };
}

function aggregateProcessByStage(
  events: ReadonlyArray<StageRelevantEvent>,
): Map<string, StageProcessView> {
  const builders = new Map<string, MutableStageProcess>();
  // 跟踪 leader agent 已被哪个 stage 吃掉：events 时间序遍历，先到先得
  let leaderClaimed: string | null = null;

  for (const ev of events) {
    const traceKind = readTraceKind(ev.type);
    if (!traceKind) {
      // 同时尝试解读业务事件 → outputPeek
      maybeFillOutputPeek(builders, ev);
      continue;
    }

    const payload = ev.payload as Record<string, unknown> | null;
    const agentId =
      (typeof payload?.agentId === "string" ? payload.agentId : undefined) ??
      undefined;
    if (!agentId) continue;

    let stageId = matchStageForAgent(agentId);
    if (!stageId) continue;

    // leader 共享 agentId — 按时间序"先到的 stage 独占"
    if (agentId === "leader") {
      if (leaderClaimed === null) {
        // 第一次遇到 leader 事件：用 SHARED_LEADER_STAGE_ORDER 的第一个 stage
        leaderClaimed = SHARED_LEADER_STAGE_ORDER[0];
      }
      stageId = leaderClaimed;
    }

    const b = builders.get(stageId) ?? emptyMutable();
    builders.set(stageId, b);

    const ts =
      typeof payload?.originalTs === "number"
        ? payload.originalTs
        : ev.timestamp;

    switch (traceKind) {
      case "thought": {
        const text =
          typeof payload?.text === "string" ? payload.text : undefined;
        const modelId =
          typeof payload?.modelId === "string" ? payload.modelId : undefined;
        const tokenCount =
          typeof payload?.tokenCount === "number"
            ? payload.tokenCount
            : undefined;
        b.reactTrace!.push({ kind: "thought", ts, text });
        if (modelId || tokenCount != null) {
          b.llmCalls!.push({
            modelId,
            tokensOut: tokenCount,
          });
        }
        if (tokenCount != null) b.totalTokens += tokenCount;
        b.stepCount += 1;
        break;
      }
      case "action": {
        const toolId =
          typeof payload?.toolId === "string" ? payload.toolId : undefined;
        b.reactTrace!.push({ kind: "action", ts, toolId });
        b.stepCount += 1;
        break;
      }
      case "observation": {
        const toolId =
          typeof payload?.toolId === "string" ? payload.toolId : undefined;
        const latencyMs =
          typeof payload?.latencyMs === "number"
            ? payload.latencyMs
            : undefined;
        const tokensUsed =
          typeof payload?.tokensUsed === "number"
            ? payload.tokensUsed
            : undefined;
        const error =
          typeof payload?.error === "string" ? payload.error : undefined;
        const output =
          typeof payload?.output === "string" ? payload.output : undefined;
        b.reactTrace!.push({
          kind: "observation",
          ts,
          toolId,
          output,
          latencyMs,
          tokensUsed,
          error,
        });
        if (latencyMs != null) b.totalDurationMs += latencyMs;
        if (tokensUsed != null) b.totalTokens += tokensUsed;
        break;
      }
      case "reflection": {
        const text =
          typeof payload?.text === "string"
            ? payload.text
            : typeof payload?.verdict === "string"
              ? payload.verdict
              : undefined;
        b.reactTrace!.push({ kind: "reflection", ts, text });
        break;
      }
      case "error": {
        const error =
          typeof payload?.error === "string"
            ? payload.error
            : typeof payload?.message === "string"
              ? payload.message
              : undefined;
        b.reactTrace!.push({ kind: "error", ts, error });
        break;
      }
    }
  }

  // Finalize: copy mutable shape into immutable view; drop empty stages.
  const out = new Map<string, StageProcessView>();
  for (const [stageId, b] of builders.entries()) {
    const view: StageProcessView = {};
    if (b.reactTrace && b.reactTrace.length > 0) view.reactTrace = b.reactTrace;
    if (b.llmCalls && b.llmCalls.length > 0) view.llmCalls = b.llmCalls;
    if (b.inputs && b.inputs.length > 0) view.inputs = b.inputs;
    if (Object.keys(b.outputPeek).length > 0) view.outputPeek = b.outputPeek;
    if (b.totalTokens > 0) view.totalTokens = b.totalTokens;
    if (b.totalDurationMs > 0) view.totalDurationMs = b.totalDurationMs;
    if (b.stepCount > 0) view.stepCount = b.stepCount;
    if (Object.keys(view).length > 0) out.set(stageId, view);
  }
  return out;
}

function readTraceKind(
  eventType: string,
): "thought" | "action" | "observation" | "reflection" | "error" | null {
  if (eventType.endsWith("agent:thought") || eventType === "agent:thought")
    return "thought";
  if (eventType.endsWith("agent:action") || eventType === "agent:action")
    return "action";
  if (
    eventType.endsWith("agent:observation") ||
    eventType === "agent:observation"
  )
    return "observation";
  if (
    eventType.endsWith("agent:reflection") ||
    eventType === "agent:reflection"
  )
    return "reflection";
  if (eventType.endsWith("agent:error") || eventType === "agent:error")
    return "error";
  return null;
}

/**
 * Business events with structured outputs → outputPeek summary numbers.
 *
 * Currently covers:
 *   - reconciliation:completed → factCount / conflictCount / overlapCount /
 *     gapCount / figureCandidateCount
 * (Future: dimension:graded summary / leader:signed verdict count, etc.)
 */
function maybeFillOutputPeek(
  builders: Map<string, MutableStageProcess>,
  ev: StageRelevantEvent,
): void {
  const suffix = trailingSuffix(ev.type);
  const payload = ev.payload as Record<string, unknown> | null;
  if (!payload) return;

  if (suffix === "reconciliation:completed") {
    const b = builders.get("s5-reconciler") ?? emptyMutable();
    builders.set("s5-reconciler", b);
    for (const key of [
      "factCount",
      "conflictCount",
      "overlapCount",
      "gapCount",
      "figureCandidateCount",
    ]) {
      const v = payload[key];
      if (typeof v === "number") b.outputPeek[key] = v;
    }
  }
}

function trailingSuffix(type: string): string {
  return type.includes(".") ? type.slice(type.indexOf(".") + 1) : type;
}
