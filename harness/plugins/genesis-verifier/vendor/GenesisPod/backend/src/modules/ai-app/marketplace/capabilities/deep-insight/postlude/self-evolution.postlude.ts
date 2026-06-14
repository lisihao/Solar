/**
 * deep-insight 能力 S12 自进化 postlude（fire-and-forget）
 *
 * mission completed / failed / aborted 后异步跑，不阻塞 run() 返回。
 * 行为：
 *   1. 经 onEvent（domain 事件桥）发 mission:postlude:started + s12 stage:lifecycle(started)
 *   2. PostmortemClassifierService 扫描事件流 → FailureMode 分类
 *   3. 拼 postmortem summary（含 quality / cost / 经验建议）
 *   4. 经 MissionPersistencePort.recordPostmortem?（optional hook）写
 *      harness_vector_memory（消费方实现，能力层零直连 app DB），
 *      写入成功后发 memory:indexed（chunks/namespace/tags）
 *   5. leader 拒签时经 MissionPersistencePort.recordFailurePattern? 记失败模式
 *   6. 经 onEvent 发 mission:postlude:completed / mission:postlude:failed
 *      + s12 stage:lifecycle(completed/failed)
 *
 * 铁律（R1）：本文件零 app import，只依赖 harness facade + capability 端口。
 * 异常只 log warn，沉淀失败不破坏 mission 终态。
 */
import type { Logger } from "@nestjs/common";
import type { PostmortemClassifierService } from "@/modules/ai-harness/facade";
import type {
  CapabilityRunEvent,
  MissionPersistencePort,
} from "../../../capability/capability-runner.port";
import { DEEP_INSIGHT_POSTMORTEM_PATTERNS } from "./deep-insight-postmortem-patterns";

/** postlude 所需的 harness 服务依赖（runner 构造器注入后透传）。 */
export interface SelfEvolutionPostludeDeps {
  readonly postmortemClassifier: PostmortemClassifierService;
  readonly log: Logger;
}

/**
 * 经 onEvent domain 桥发 postlude 生命周期事件（best-effort）。
 * playground dispatcher 的 domain 事件桥把 "mission:postlude:started" 等翻译成
 * "playground.mission:postlude:started"，对应 playground.events.ts 注册的 S() 事件。
 *
 * stage:lifecycle：postlude 不在 orchestrator steps（fire-and-forget），
 * 拓扑图 s12 节点没有任何 lifecycle 信号会恒 idle——这里自桥。
 * memory:indexed：postmortem 写入 harness_vector_memory 即"记忆索引完成"，
 * 前端 MemoryIndexPanel/CapabilityMeters 按 { chunks, namespace, tags } 消费。
 */
function emitPostludeEvent(
  onEvent: ((e: CapabilityRunEvent) => void | Promise<void>) | undefined,
  event:
    | "mission:postlude:started"
    | "mission:postlude:completed"
    | "mission:postlude:failed"
    | "stage:lifecycle"
    | "memory:indexed",
  data: Record<string, unknown>,
): void {
  if (!onEvent) return;
  try {
    void onEvent({
      type: "domain",
      timestamp: Date.now(),
      payload: { event, data },
    });
  } catch {
    // best-effort：emit 失败不影响 postlude 主逻辑
  }
}

/** postlude 输入（runner assembleCompleted 完成后传入）。 */
export interface SelfEvolutionPostludeInput {
  readonly missionId: string;
  readonly userId: string;
  readonly topic: string;
  /** 从 crossStageState 取出的终态产物。 */
  readonly leaderSignOff?: { signed?: boolean } | null;
  readonly reportArtifact?: {
    quality?: { overall?: number };
  } | null;
  readonly plan?: {
    dimensions?: unknown[];
    goals?: { qualityBar?: { minCoverage?: number } };
  } | null;
  readonly finalScore?: number;
  readonly tokensUsed: number;
  readonly costCents: number;
  /** run() 起始时间戳（用于 wallTimeMs 计算）。 */
  readonly startedAt: number;
  /** 持久化端口（来自 ctx.persistence；optional.recordPostmortem 由消费方实现）。 */
  readonly persistence: MissionPersistencePort;
  /**
   * ★ env3：runner 在 run() 期间缓冲的 mission/agent 事件（ring buffer 快照）。
   * 传给 postmortemClassifier.classify 让 DEEP_INSIGHT_POSTMORTEM_PATTERNS substring
   * patterns 真正命中（之前传 [] 导致 pattern 永不命中——死代码修复）。
   * 缺省传空数组 → 退化到原行为（仅 status 路径）。
   */
  readonly bufferedEvents?: ReadonlyArray<{
    type: string;
    ts: number;
  }>;
  /**
   * ★ Fix C10（2026-06-09）：ctx.onEvent 引用，用于 emit postlude 生命周期 domain 事件。
   * playground dispatcher 的 domain 桥把 mission:postlude:{started/completed/failed}
   * 翻译成 playground.mission:postlude:* 上抛前端。
   */
  readonly onEvent?: (e: CapabilityRunEvent) => void | Promise<void>;
}

/**
 * fireSelfEvolutionPostlude — fire-and-forget 入口。
 *
 * 调用方 void 调用（不 await），让终态返回不被阻塞；
 * postlude 内部任何异常仅 warn，不向上抛。
 */
export function fireSelfEvolutionPostlude(
  input: SelfEvolutionPostludeInput,
  deps: SelfEvolutionPostludeDeps,
): void {
  void runPostlude(input, deps);
}

async function runPostlude(
  input: SelfEvolutionPostludeInput,
  deps: SelfEvolutionPostludeDeps,
): Promise<void> {
  const { missionId, userId, topic, persistence, onEvent } = input;
  const postludeStartedAt = Date.now();

  // ★ Fix C10：发 postlude:started 生命周期事件（frontend todo-board.projector.ts 消费）。
  emitPostludeEvent(onEvent, "mission:postlude:started", {
    stage: "s12-self-evolution",
    startedAt: postludeStartedAt,
  });
  // ★ 矩阵表2末行：s12 不在 orchestrator steps，无人发 stage:lifecycle →
  //   拓扑节点恒 idle。postlude 自桥 started/completed/failed 三相。
  emitPostludeEvent(onEvent, "stage:lifecycle", {
    stepId: "s12-self-evolution",
    stage: "s12-self-evolution",
    status: "started",
  });

  try {
    const wallTimeMs = Date.now() - input.startedAt;
    const totalTokens = input.tokensUsed;
    const totalCostUsd = input.costCents / 100;
    const leaderSigned = input.leaderSignOff?.signed ?? null;
    const overallQuality =
      input.reportArtifact?.quality?.overall ?? input.finalScore ?? null;
    const declaredBar = input.plan?.goals?.qualityBar?.minCoverage ?? null;
    const qualityHitRate =
      overallQuality != null && declaredBar != null && declaredBar > 0
        ? Math.min(1, overallQuality / declaredBar)
        : null;

    // ── 经验建议 ──────────────────────────────────────────────────────────
    const recommendations: string[] = [];
    if (qualityHitRate != null && qualityHitRate < 0.85) {
      recommendations.push(
        `本次 quality 命中率 ${(qualityHitRate * 100).toFixed(0)}% < 85%；` +
          `下次同主题可考虑：(a) 升 depth=deep (b) 调宽 minCoverage`,
      );
    }
    if (wallTimeMs > 60 * 60 * 1000) {
      recommendations.push(
        `本次墙时 ${Math.round(wallTimeMs / 60000)} 分钟较长；下次可减少维度数或用 depth=quick`,
      );
    }
    if (totalCostUsd > 3) {
      recommendations.push(
        `本次成本 $${totalCostUsd.toFixed(2)} 较高；下次同主题可降 depth 或减少维度`,
      );
    }
    if (leaderSigned === false) {
      recommendations.push(
        `Leader 本次拒签；下次启动可考虑调宽 minCoverage 或升级 depth`,
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        `本次 mission 健康（${overallQuality}/100），可作为同主题的 baseline reference`,
      );
    }

    // ── PostmortemClassifier 分类 ─────────────────────────────────────────
    // ★ env3 修复：使用 runner 缓冲的真实事件流（非空时 pattern 才能命中）。
    // ★ Fix C6（2026-06-09）：bufferedEvents 已是 { type, ts } 形状（agent 事件存储已精简，
    //   mission 事件本来就只存 type+ts）。ClassifyInput.events 期望 mutable array，
    //   用 Array.from 转换（O(n) 浅拷贝，比 .map 无意义重组 payload 字段更清晰）。
    const classifyEvents = Array.from(input.bufferedEvents ?? []);
    const missionStatus = leaderSigned === true ? "completed" : "failed";
    const classification = deps.postmortemClassifier.classify(
      {
        status: missionStatus,
        events: classifyEvents,
        metrics: { totalTokens, wallTimeMs },
      },
      DEEP_INSIGHT_POSTMORTEM_PATTERNS,
    );

    deps.log.log(
      `[deep-insight ${missionId}] S12-postlude: quality=${overallQuality}/100 ` +
        `cost=$${totalCostUsd.toFixed(3)} tokens=${totalTokens} ` +
        `signed=${leaderSigned} mode=${classification.mode}`,
    );

    // ── postmortem summary 文本 ──────────────────────────────────────────
    const postmortemSummary = [
      `Mission "${topic}" — ${leaderSigned === true ? "签字交付" : leaderSigned === false ? "Leader 拒签" : "未签字"}`,
      `质量 ${overallQuality ?? "-"}/100，命中率 ${qualityHitRate != null ? (qualityHitRate * 100).toFixed(0) + "%" : "n/a"}`,
      `Token ${totalTokens}，cost $${totalCostUsd.toFixed(2)}，墙时 ${Math.round(wallTimeMs / 60000)}min`,
      `失败模式：${classification.mode}（confidence=${classification.confidence.toFixed(2)}）`,
      `经验：`,
      ...recommendations.map((r) => `- ${r}`),
    ].join("\n");

    // ── 写 harness_vector_memory（经 persistence 端口，消费方实现；optional）──
    if (persistence.recordPostmortem) {
      const memoryTags = [
        "deep-insight",
        "mission-postmortem",
        leaderSigned === true ? "signed" : "unsigned",
      ];
      let postmortemRecorded = false;
      try {
        await persistence.recordPostmortem({
          missionId,
          userId,
          topic,
          summary: postmortemSummary,
          recommendations,
          leaderSigned,
          qualityScore: overallQuality,
          tokensUsed: totalTokens,
          costUsd: totalCostUsd,
          source: "deep-insight:mission",
          tags: memoryTags,
          failureClassification: classification,
        });
        postmortemRecorded = true;
      } catch (err: unknown) {
        deps.log.warn(
          `[deep-insight ${missionId}] S12-postlude recordPostmortem failed (non-fatal): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (postmortemRecorded) {
        deps.log.log(
          `[deep-insight ${missionId}] S12-postlude sediment recorded → harness_vector_memory` +
            `${leaderSigned === false ? " + failure mode" : ""}`,
        );
        // ★ 审计 #21：记忆索引完成信号（MemoryIndexedSchema: chunks/namespace/tags，
        //   前端 dvDeriveMemoryFromEvents 要求 chunks 为 number）。
        //   postmortem summary 单条写入 → chunks=1。
        emitPostludeEvent(onEvent, "memory:indexed", {
          chunks: 1,
          namespace: "harness_vector_memory",
          tags: memoryTags,
        });
      }
    } else {
      deps.log.log(
        `[deep-insight ${missionId}] S12-postlude: recordPostmortem not provided by consumer, skip write`,
      );
    }

    // ★ Fix C4（2026-06-09）：leader 拒签时记失败模式，供 FailureLearnerService
    //   在下次同 topic 启动时给 leader plan 提供 prior knowledge。
    if (leaderSigned === false && persistence.recordFailurePattern) {
      await persistence
        .recordFailurePattern({
          missionId,
          topic,
          failureCode: "LEADER_REFUSED_SIGN",
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[deep-insight ${missionId}] S12-postlude recordFailurePattern (LEADER_REFUSED_SIGN) failed (non-fatal): ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // ★ Fix C10：发 postlude:completed 生命周期事件。
    emitPostludeEvent(onEvent, "mission:postlude:completed", {
      stage: "s12-self-evolution",
      wallTimeMs: Date.now() - postludeStartedAt,
    });
    emitPostludeEvent(onEvent, "stage:lifecycle", {
      stepId: "s12-self-evolution",
      stage: "s12-self-evolution",
      status: "completed",
    });
  } catch (err) {
    deps.log.warn(
      `[deep-insight ${missionId}] S12-postlude failed (best-effort, ignored): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    // ★ Fix C10：发 postlude:failed 生命周期事件（catch 路径）。
    emitPostludeEvent(onEvent, "mission:postlude:failed", {
      stage: "s12-self-evolution",
      error: err instanceof Error ? err.message : String(err),
    });
    emitPostludeEvent(onEvent, "stage:lifecycle", {
      stepId: "s12-self-evolution",
      stage: "s12-self-evolution",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
