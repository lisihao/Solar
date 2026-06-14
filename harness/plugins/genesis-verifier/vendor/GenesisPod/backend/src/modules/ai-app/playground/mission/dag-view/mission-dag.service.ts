/**
 * MissionDagService —— 把 mission 当前态组装成可视化用的 DAG 图谱。
 *
 * 输入:missionId + userId(经 ownership 校验后传入)
 * 输出:MissionDagGraph(节点+边+rerunable+实时状态)
 *
 * 数据来源:
 *   1. 结构 —— PLAYGROUND_PIPELINE.steps(13 stage 静态拓扑 + dag.successors)
 *   2. 实时状态 —— MissionStore.getById(): mission.status + lastCompletedStage
 *   3. 维度展开 —— mission.dimensions → S3 research-dim 子节点
 *
 * 非线性边(Writer⇄Reviewer rewrite loop / 签收 patch self-loop)在这里写死,
 * 是 playground 业务约定,不在 stage-dag-meta 里(stage-dag-meta 只描述
 * "重跑级联"用的 DAG 边,不描述运行时实际通信回环)。
 *
 * 级联计算:walk dag.successors 取传递闭包(若起点是 research-dim,先映射回
 * parentStepId 再 walk + 同时把所有同维度 research-dim 节点和共享下游节点
 * 都纳入 willRerun)。
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { MissionStore } from "../lifecycle/mission-store.service";
import { MissionEventBuffer } from "../lifecycle/mission-event-buffer.service";
import { PLAYGROUND_PIPELINE } from "../../runtime/playground.config";
import type {
  MissionDagGraph,
  MissionDagNode,
  MissionDagEdge,
  MissionDagNodeStatus,
  MissionDagCascadePreview,
  MissionDagNodeKind,
  MissionDagLayoutHint,
  MissionDagReactSnapshot,
  MissionDagReactCurrentStep,
} from "./mission-dag.types";

interface DimRef {
  readonly id: string;
  readonly name: string;
}

const RESEARCH_STEP_ID = "s3-researcher-collect";
const WRITER_STEP_ID = "s8-writer";
const REVIEWER_STEP_IDS = [
  "s8b-quality-enhancement",
  "s9-critic",
  "s9b-objective-eval",
] as const;
const SIGNOFF_STEP_ID = "s10-leader-foreword-signoff";
const PERSIST_STEP_ID = "s11-persist";

/** macro stage 显示标签(短中文) */
const STEP_LABELS: Record<string, { label: string; sub?: string }> = {
  "s1-budget": { label: "S1 预算闸" },
  "s2-leader-plan": { label: "S2 Leader 规划" },
  "s3-researcher-collect": { label: "S3 研究采集" },
  "s4-leader-assess": { label: "S4 Leader 评估" },
  "s5-reconciler": { label: "S5 对账" },
  "s6-analyst": { label: "S6 Analyst", sub: "交叉验证 / 消解" },
  "s7-writer-outline": { label: "S7 Outline" },
  "s8-writer": { label: "S8 Writer", sub: "草稿 / 返修" },
  "s8b-quality-enhancement": { label: "S8b 质量增强" },
  "s9-critic": { label: "S9 Critic" },
  "s9b-objective-eval": { label: "S9b 客观评估" },
  "s10-leader-foreword-signoff": { label: "Leader 签收" },
  "s11-persist": { label: "S11 持久化" },
};

@Injectable()
export class MissionDagService {
  constructor(
    private readonly store: MissionStore,
    private readonly buffer: MissionEventBuffer,
  ) {}

  /** 构图入口 —— ownership 校验已在 controller 完成 */
  async buildGraph(
    missionId: string,
    userId: string,
  ): Promise<MissionDagGraph> {
    const mission = await this.store.getById(missionId, userId);
    if (!mission) {
      throw new NotFoundException(`mission ${missionId} not found`);
    }

    const steps = PLAYGROUND_PIPELINE.steps;
    const stepIndexById = new Map(steps.map((s, i) => [s.id, i]));
    const lastCompleted = mission.lastCompletedStage ?? -1;
    const missionStatus = mission.status;
    const dims = this.normalizeDimensions(mission.dimensions);

    // Phase 3.1: 一次性读事件,后面 per-dim 状态 / score 派生用
    const events = this.buffer.read(missionId);
    // Phase 3.1: 按维度名分别提取 researcher agent:lifecycle 的最新 phase
    const perDimPhase = this.collectPerDimResearcherPhase(events);
    // Phase 3.2: reviewer / 签收 节点的 score(从 mission 派生)
    const scoreByNodeId = this.collectReviewerScores(mission);

    const nodes: MissionDagNode[] = [];
    const edges: MissionDagEdge[] = [];

    // 1) 13 macro 节点(每个 step 一个),状态由 lastCompletedStage 推导
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const status = this.deriveMacroStatus(
        i,
        lastCompleted,
        missionStatus,
        step.id,
      );
      const meta = STEP_LABELS[step.id] ?? { label: step.id };
      const kind: MissionDagNodeKind = this.classifyKind(step.id);
      const layout: MissionDagLayoutHint =
        step.id === WRITER_STEP_ID ? "split" : "spine";
      const dag = step.dag;
      const rerunable = dag?.rerunable ?? true;
      const rerunableReason = dag?.rerunableReason;
      const score = scoreByNodeId.get(step.id);

      nodes.push({
        id: step.id,
        kind,
        label: meta.label,
        sub:
          step.id === "s2-leader-plan" && dims.length > 0
            ? `${dims.length} 维度`
            : meta.sub,
        status,
        rerunable,
        rerunableReason,
        layout,
        score,
      });
    }

    // 2) S3 展开:为每个维度生成一个 research-dim 子节点。
    //    Phase 3.1: 每维度状态独立 —— 若该维度有 lifecycle 事件,按事件推
    //    (started→running, completed→done, failed→failed);否则继承父 S3 状态。
    const s3Idx = stepIndexById.get(RESEARCH_STEP_ID) ?? -1;
    const s3Status =
      s3Idx >= 0
        ? this.deriveMacroStatus(
            s3Idx,
            lastCompleted,
            missionStatus,
            RESEARCH_STEP_ID,
          )
        : "idle";
    const s3Step = steps[s3Idx];
    const s3Rerunable = s3Step?.dag?.rerunable ?? true;
    for (let di = 0; di < dims.length; di++) {
      const dim = dims[di];
      const dimId = `${RESEARCH_STEP_ID}::${dim.id}`;
      const dimStatus = this.deriveDimStatusFromPhase(
        perDimPhase.get(dim.name),
        s3Status,
      );
      // Phase 4 紧急修:dim 节点 label 用 R{n} 短编号,完整 dim 名走 sub;否则 14
      // 维度挤在一行时标签横向溢出节点框,前端 truncate 后仍会重叠。
      nodes.push({
        id: dimId,
        kind: "research-dim",
        label: `R${di + 1}`,
        sub: this.shortDim(dim.name),
        status: dimStatus,
        rerunable: s3Rerunable,
        rerunableReason: s3Step?.dag?.rerunableReason,
        layout: "fan",
        dimensionRef: dim.name,
        parentStepId: RESEARCH_STEP_ID,
      });
    }

    // 3) 边
    //    3a) macro stage 沿 pipeline 顺序的 flow 边(用每个 step 的 successors 的"直接后继",
    //        其它远距 successors 在 dag-meta 里只是 cascade 链,不用画)
    //    简化:用 pipeline 数组顺序 i → i+1 作为可视的 flow 边,跳过 S3(由 fan 替代)
    for (let i = 0; i < steps.length - 1; i++) {
      const from = steps[i].id;
      const to = steps[i + 1].id;
      // S2 -> S3 fan, S3 -> S4 fan: 由下面 fan-out / fan-in 替代,这里跳过
      if (from === "s2-leader-plan" && to === RESEARCH_STEP_ID) continue;
      if (from === RESEARCH_STEP_ID && to === "s4-leader-assess") continue;
      edges.push({ from, to, kind: "flow" });
    }
    // 3b) S2 → 每个 research-dim(fan-out)
    for (const dim of dims) {
      edges.push({
        from: "s2-leader-plan",
        to: `${RESEARCH_STEP_ID}::${dim.id}`,
        kind: "fan",
      });
    }
    // 3c) 每个 research-dim → S4(fan-in)
    for (const dim of dims) {
      edges.push({
        from: `${RESEARCH_STEP_ID}::${dim.id}`,
        to: "s4-leader-assess",
        kind: "fan",
      });
    }
    // 3d) 若没有维度(早期/失败),保留 S2 → S3 → S4 直边
    if (dims.length === 0) {
      edges.push({
        from: "s2-leader-plan",
        to: RESEARCH_STEP_ID,
        kind: "flow",
      });
      edges.push({
        from: RESEARCH_STEP_ID,
        to: "s4-leader-assess",
        kind: "flow",
      });
    }
    // 3e) Writer ⇄ Reviewer 重写回环(写到 reviewer 第一个: s8b)
    edges.push({
      from: REVIEWER_STEP_IDS[0],
      to: WRITER_STEP_ID,
      kind: "rewrite-loop",
    });
    // 3f) 签收 patch self-loop
    edges.push({
      from: SIGNOFF_STEP_ID,
      to: SIGNOFF_STEP_ID,
      kind: "self-loop",
    });

    return {
      missionId,
      mission: {
        status: missionStatus,
        topic: mission.topic,
        finalScore: mission.finalScore,
      },
      nodes,
      edges,
    };
  }

  /** 重跑级联预览 */
  async computeCascade(
    missionId: string,
    userId: string,
    nodeId: string,
  ): Promise<MissionDagCascadePreview> {
    const graph = await this.buildGraph(missionId, userId);
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const steps = PLAYGROUND_PIPELINE.steps;
    const stepById = new Map(steps.map((s) => [s.id, s]));

    // 把 DAG nodeId 解析成 pipeline stepId。
    // research-dim 节点 id 形如 "s3-researcher-collect::<dimId>"，canonical stepId
    // 是其父 "s3-researcher-collect"；macro 节点 id 本身就是 stepId。
    // 若 nodeId 不在当前图（前端 graph 可能是旧快照，后端 freshly rebuilt），则
    // 尝试从 nodeId 的结构直接提取 stepId，避免因状态差异抛 NotFoundException。
    function resolveStepId(nid: string): string {
      if (nid.startsWith(`${RESEARCH_STEP_ID}::`)) {
        return RESEARCH_STEP_ID;
      }
      return nid;
    }

    const origin = nodeMap.get(nodeId);
    if (!origin) {
      // 前端持有过期快照时 dim 节点可能已不在最新图中；
      // 尝试按 nodeId 结构推导 stepId 给出降级级联预览。
      const stepId = resolveStepId(nodeId);
      const fromStep = stepById.get(stepId);
      if (!fromStep) {
        throw new NotFoundException(`node ${nodeId} not in mission dag`);
      }
      if (!fromStep.dag?.rerunable) {
        return {
          origin: nodeId,
          willRerun: [],
          kept: graph.nodes.map((n) => n.id),
          rerunable: false,
          reason: fromStep.dag?.rerunableReason ?? "该节点不允许重跑",
        };
      }
      const cascadeSet = new Set<string>(fromStep.dag?.successors ?? []);
      const willSet = new Set<string>(cascadeSet);
      const kept = graph.nodes
        .filter((n) => !willSet.has(n.id))
        .map((n) => n.id);
      return {
        origin: nodeId,
        willRerun: [...willSet],
        kept,
        rerunable: true,
      };
    }

    if (!origin.rerunable) {
      return {
        origin: nodeId,
        willRerun: [],
        kept: graph.nodes.filter((n) => n.id !== nodeId).map((n) => n.id),
        rerunable: false,
        reason: origin.rerunableReason ?? "该节点不允许重跑",
      };
    }

    // 起点对应的 stepId:
    //   research-dim → parentStepId（始终是 s3-researcher-collect）
    //   其它 → 用 resolveStepId 兜底（防 parentStepId 意外缺失）
    const originStepId =
      origin.kind === "research-dim"
        ? (origin.parentStepId ?? resolveStepId(nodeId))
        : resolveStepId(nodeId);
    const fromStep = stepById.get(originStepId);
    if (!fromStep) {
      throw new NotFoundException(`step ${originStepId} not in pipeline`);
    }
    // dag.successors 是 cascade 的传递闭包枚举(playground.config 里已展开),
    // 直接拿来用
    const cascadeSet = new Set<string>(fromStep.dag?.successors ?? []);

    // 把级联里的 stepId 翻译成节点 ids:
    //   - macro 节点直接保留 stepId
    //   - 若级联包含 RESEARCH_STEP_ID,扩展成所有 research-dim 子节点(同维度全跑)
    const willRerun: string[] = [];
    for (const sid of cascadeSet) {
      if (sid === RESEARCH_STEP_ID) {
        // 该维度自身的 research-dim 在 origin 是 research-dim 时不入列(它就是起点;
        //   但通常 research-dim 的 successors 不含自身)
        // 其它情况: macro cascade 链路里包含 S3 → 14 个子节点都重跑
        for (const n of graph.nodes) {
          if (n.kind === "research-dim" && n.id !== nodeId)
            willRerun.push(n.id);
        }
        if (origin.kind !== "research-dim") {
          // origin 是上游 macro(S1/S2) → research-dim 起点也要重跑
          // 但起点 nodeId 已是 origin,不重复加
        }
        willRerun.push(sid); // macro 标记本身
      } else {
        willRerun.push(sid);
      }
    }
    const willSet = new Set(willRerun);
    willSet.delete(nodeId); // 起点不算下游
    const kept = graph.nodes
      .filter((n) => n.id !== nodeId && !willSet.has(n.id))
      .map((n) => n.id);

    return {
      origin: nodeId,
      willRerun: [...willSet],
      kept,
      rerunable: true,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private classifyKind(stepId: string): MissionDagNodeKind {
    if (stepId === WRITER_STEP_ID) return "writer";
    if (
      REVIEWER_STEP_IDS.includes(stepId as (typeof REVIEWER_STEP_IDS)[number])
    )
      return "reviewer";
    if (stepId === PERSIST_STEP_ID) return "persist";
    return "macro";
  }

  /**
   * 推 macro 状态:
   *   stepIdx < lastCompleted   → done
   *   stepIdx === lastCompleted → 取 mission.status(running/failed/etc.)
   *   stepIdx > lastCompleted   → idle
   * 已完成 mission 中所有 step 视作 done(除非 mission failed,失败 step = failed)。
   */
  private deriveMacroStatus(
    stepIdx: number,
    lastCompleted: number,
    missionStatus: string,
    _stepId: string,
  ): MissionDagNodeStatus {
    if (missionStatus === "completed") return "done";
    if (missionStatus === "cancelled") {
      if (stepIdx <= lastCompleted) return "done";
      return "cancelled";
    }
    if (missionStatus === "failed") {
      if (stepIdx < lastCompleted) return "done";
      if (stepIdx === lastCompleted) return "failed";
      return "idle";
    }
    // running / starting / idle
    if (stepIdx < lastCompleted) return "done";
    if (stepIdx === lastCompleted) {
      return missionStatus === "running" || missionStatus === "starting"
        ? "running"
        : "idle";
    }
    return "idle";
  }

  private normalizeDimensions(raw: unknown): DimRef[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((d, i): DimRef | null => {
        if (!d || typeof d !== "object") return null;
        const obj = d as { id?: unknown; name?: unknown };
        const name = typeof obj.name === "string" ? obj.name : null;
        if (!name) return null;
        const id = typeof obj.id === "string" && obj.id ? obj.id : `dim-${i}`;
        return { id, name };
      })
      .filter((x): x is DimRef => x !== null);
  }

  private shortDim(name: string): string {
    return name.length > 8 ? name.slice(0, 7) + "…" : name;
  }

  /**
   * Phase 3.1: 把事件流里所有 researcher agent:lifecycle 事件按 dimension
   * 分桶,每个 dimension 取最新 phase。
   */
  private collectPerDimResearcherPhase(
    events: ReadonlyArray<{
      type: string;
      payload: unknown;
      timestamp: number;
    }>,
  ): Map<string, "started" | "completed" | "failed"> {
    const map = new Map<string, "started" | "completed" | "failed">();
    for (const e of events) {
      if (e.type !== "playground.agent:lifecycle") continue;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      if (p.role !== "researcher") continue;
      const dim = typeof p.dimension === "string" ? p.dimension : null;
      const ph = typeof p.phase === "string" ? p.phase : null;
      if (!dim || !ph) continue;
      if (ph === "started" || ph === "completed" || ph === "failed") {
        map.set(dim, ph);
      }
    }
    return map;
  }

  /**
   * Phase 3.1: 由事件 phase + 父 S3 状态推该维度的 DAG 节点状态。
   *   started → running
   *   completed → done
   *   failed → failed
   *   无事件 → 继承父 S3 状态(向前兼容)
   */
  private deriveDimStatusFromPhase(
    phase: "started" | "completed" | "failed" | undefined,
    fallback: MissionDagNodeStatus,
  ): MissionDagNodeStatus {
    if (phase === "started") return "running";
    if (phase === "completed") return "done";
    if (phase === "failed") return "failed";
    return fallback;
  }

  /**
   * Phase 3.2: reviewer / 签收节点的 score 填充。
   *   - s10-leader-foreword-signoff ← mission.leaderOverallScore
   *   - s9-critic / s9b-objective-eval / s8b-quality-enhancement ← mission.finalScore
   *     (这三个 review 类 stage 共同决定 finalScore,简化:都标 finalScore)
   */
  private collectReviewerScores(mission: {
    finalScore: number | null;
    leaderOverallScore: number | null;
  }): Map<string, number> {
    const map = new Map<string, number>();
    if (typeof mission.leaderOverallScore === "number") {
      map.set("s10-leader-foreword-signoff", mission.leaderOverallScore);
    }
    if (typeof mission.finalScore === "number") {
      const final = mission.finalScore;
      map.set("s9-critic", final);
      map.set("s9b-objective-eval", final);
      map.set("s8b-quality-enhancement", final);
    }
    return map;
  }

  // ─── Phase 2: ReAct 内部循环快照 ────────────────────────────────────

  /**
   * 给定 DAG 节点 id,从 MissionEventBuffer 聚合 agent-* 事件,推 ReAct 快照。
   *
   * 节点 id → role 映射:
   *   - s2/s4/s10            → leader
   *   - s3-research-collect   → researcher(代表运行中或最近一个)
   *   - s3-research-collect::dimId → researcher + dimension(由 mission.dimensions 取 name)
   *   - s5-reconciler        → reconciler
   *   - s6-analyst           → analyst
   *   - s7/s8                → writer
   *   - s8b/s9/s9b           → reviewer
   *   - s1-budget / s11      → 没 ReAct(persist primitive),返回 note 解释
   */
  async buildReactSnapshot(
    missionId: string,
    userId: string,
    nodeId: string,
  ): Promise<MissionDagReactSnapshot> {
    const mission = await this.store.getById(missionId, userId);
    if (!mission) {
      throw new NotFoundException(`mission ${missionId} not found`);
    }
    const roleHint = this.nodeIdToRoleHint(nodeId, mission.dimensions);
    if (!roleHint) {
      throw new NotFoundException(`node ${nodeId} unknown`);
    }
    if (roleHint.skip) {
      return {
        nodeId,
        role: roleHint.role,
        currentStep: "idle",
        finalizeAttempts: 0,
        phase: "pending",
        note: roleHint.skipReason,
      };
    }
    const events = this.buffer.read(missionId);
    return this.aggregateReactSnapshot(
      nodeId,
      roleHint.role,
      roleHint.dimension,
      events,
    );
  }

  /**
   * 把 nodeId → {role, dimension?} 解出来;persist 节点(s1/s11)直接 skip。
   */
  private nodeIdToRoleHint(
    nodeId: string,
    dimensionsRaw: unknown,
  ): {
    role: string;
    dimension?: string;
    skip?: boolean;
    skipReason?: string;
  } | null {
    if (nodeId.startsWith("s3-researcher-collect::")) {
      const dimId = nodeId.slice("s3-researcher-collect::".length);
      const dims = this.normalizeDimensions(dimensionsRaw);
      const dim = dims.find((d) => d.id === dimId);
      return { role: "researcher", dimension: dim?.name };
    }
    switch (nodeId) {
      case "s1-budget":
        return {
          role: "leader",
          skip: true,
          skipReason: "S1 是预算闸(persist primitive),没有 ReAct 内循环",
        };
      case "s2-leader-plan":
      case "s4-leader-assess":
      case "s10-leader-foreword-signoff":
        return { role: "leader" };
      case "s3-researcher-collect":
        return { role: "researcher" };
      case "s5-reconciler":
        return { role: "reconciler" };
      case "s6-analyst":
        return { role: "analyst" };
      case "s7-writer-outline":
      case "s8-writer":
        return { role: "writer" };
      case "s8b-quality-enhancement":
      case "s9-critic":
      case "s9b-objective-eval":
        return { role: "reviewer" };
      case "s11-persist":
        return {
          role: "leader",
          skip: true,
          skipReason: "S11 是持久化(persist primitive),没有 ReAct 内循环",
        };
    }
    return null;
  }

  /**
   * 把事件流聚合成一个快照 —— 找到最近活跃的 agentId,然后走该 agent 的事件
   * 拿 lastThought / lastAction / lastObservation / iter / finalizeAttempts。
   */
  private aggregateReactSnapshot(
    nodeId: string,
    role: string,
    dimension: string | undefined,
    events: ReadonlyArray<{
      type: string;
      payload: unknown;
      agentId?: string;
      timestamp: number;
    }>,
  ): MissionDagReactSnapshot {
    // 1) 过滤本 role/dim 相关的 agent-* / iteration:progress / stage:* 事件
    const relevant = events.filter((e) => {
      if (!e.type.startsWith("playground.")) return false;
      const t = e.type.slice("playground.".length);
      if (!t.startsWith("agent:") && t !== "iteration:progress") return false;
      const p = (e.payload ?? {}) as {
        role?: unknown;
        dimension?: unknown;
      };
      if (typeof p.role === "string" && p.role !== role) return false;
      if (
        dimension !== undefined &&
        typeof p.dimension === "string" &&
        p.dimension !== dimension
      )
        return false;
      return true;
    });
    if (relevant.length === 0) {
      return {
        nodeId,
        role,
        dimension,
        currentStep: "idle",
        finalizeAttempts: 0,
        phase: "pending",
      };
    }
    // 2) 找最近活跃的 agentId:优先选最后一条事件的 agentId
    const last = relevant[relevant.length - 1];
    const primaryAgentId =
      last.agentId ??
      ((last.payload as { agentId?: unknown }).agentId as string | undefined);

    const byAgent = primaryAgentId
      ? relevant.filter((e) => {
          const id = e.agentId ?? (e.payload as { agentId?: unknown }).agentId;
          return id === primaryAgentId;
        })
      : relevant;

    // 3) 走该 agent 的事件聚合
    let lastThought: string | undefined;
    let lastAction: { kind: string; toolName?: string } | undefined;
    let lastObservation: { kind: string } | undefined;
    let iter: number | undefined;
    let maxIter: number | undefined;
    let finalizeAttempts = 0;
    let lastError: string | undefined;
    let phase: "pending" | "running" | "completed" | "failed" = "running";
    let lastSuffix: string | undefined;

    for (const e of byAgent) {
      const t = e.type.slice("playground.".length);
      const p = (e.payload ?? {}) as Record<string, unknown>;
      switch (t) {
        case "agent:lifecycle": {
          const ph = typeof p.phase === "string" ? p.phase : undefined;
          if (ph === "started") phase = "running";
          else if (ph === "completed") phase = "completed";
          else if (ph === "failed") phase = "failed";
          break;
        }
        case "agent:thought":
          if (typeof p.text === "string") {
            lastThought =
              p.text.length > 240 ? p.text.slice(0, 240) + "…" : p.text;
          }
          break;
        case "agent:action": {
          const kind = typeof p.kind === "string" ? p.kind : "unknown";
          const toolName =
            typeof p.toolName === "string" ? p.toolName : undefined;
          lastAction = { kind, toolName };
          break;
        }
        case "agent:observation": {
          const kind = typeof p.kind === "string" ? p.kind : "result";
          lastObservation = { kind };
          break;
        }
        case "agent:reflection":
          finalizeAttempts++;
          break;
        case "agent:error":
          if (typeof p.message === "string") {
            lastError =
              p.message.length > 200
                ? p.message.slice(0, 200) + "…"
                : p.message;
          }
          break;
        case "iteration:progress": {
          if (typeof p.iteration === "number") iter = p.iteration;
          if (typeof p.maxIterations === "number") maxIter = p.maxIterations;
          break;
        }
      }
      lastSuffix = t;
    }

    // 4) currentStep 推断
    let currentStep: MissionDagReactCurrentStep = "idle";
    if (phase === "completed") currentStep = "completed";
    else if (phase === "failed") currentStep = "failed";
    else {
      switch (lastSuffix) {
        case "agent:thought":
          currentStep = "thinking";
          break;
        case "agent:action":
          currentStep = lastAction?.kind === "finalize" ? "finalizing" : "tool";
          break;
        case "agent:observation":
          currentStep = "observing";
          break;
        case "agent:reflection":
          currentStep = "finalizing";
          break;
        default:
          currentStep = phase === "running" ? "thinking" : "idle";
      }
    }

    return {
      nodeId,
      role,
      dimension,
      agentId: primaryAgentId,
      currentStep,
      iter,
      maxIter,
      lastThought,
      lastAction,
      lastObservation,
      finalizeAttempts,
      lastError,
      phase,
    };
  }
}
