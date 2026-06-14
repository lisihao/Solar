/**
 * chapter-stream.helper —— S8 写作期逐章流式 + S8B 时间护栏（能力家提供）。
 *
 * 背景（2026-06-10 回归审计 #4/#35/#36 + #34）：
 *   #35/#36：基线 per-dim pipeline 在 S3 期间逐章实时 emit chapter:writing:started/
 *     completed（渐进推进感）；HEAD 单轨 deep-insight 的 s8 writer 是一次性产出全部
 *     section，在 for 循环背靠背合成补发——前端章节 todo s8 末尾整批瞬现，5-15min
 *     写作期零章节级反馈。本 helper 提供 emitChapterStream：逐章发事件且时间戳严格
 *     递增（非同毫秒 burst），并在缺章节明细时退化为 iteration:progress 心跳（每 ≤60s
 *     一条，react-loop 已有该事件、第一波 relay 已透传），给"写作中"推进感。
 *   #34：基线 s8b（s8b-section-quality-enhancement.stage.ts）有三重时间护栏——单 call
 *     withTimeout（self-eval 60s / remediate 90s）、20min S8B_WALL_TIME_MS 总守卫、
 *     auditLayers="minimal" 整段跳过；HEAD runSectionRemediation 串行逐 section 三次
 *     LLM 全丢护栏，最坏 section数×16min 停滞且静默无事件。runGuardedSectionRemediation
 *     恢复这三重护栏（对齐 s9 critic 的 minimal 门控写法）。
 *
 * 设计：纯函数 + 窄结构化接口（最小投影，与 agent-invoke.helper AgentRunProjection 同款），
 *   不依赖 bindings 类实例，独立可单测。bindings 调它即可（不重写 prompt、不碰 stage-bindings 内核逻辑）。
 */
import type { CapabilityRunEvent } from "../../../../capability/capability-runner.port";
import { emitDomain } from "./agent-invoke.helper";

// ─── 共享时间护栏原语 ───────────────────────────────────────────────────────────

/**
 * Promise.race 超时包裹 —— 单次 LLM call 超时兜底（防 model 失败重试导致分钟级阻塞）。
 * 与基线 s8b withTimeout（s8b-section-quality-enhancement.stage.ts）同语义。
 * 注：超时只 reject 本 Promise（让调用方 catch 跳过该 section），底层请求是否真取消
 *   交由调用链的 AbortSignal/AiChatService 16min 硬超时收尾，此处不强行 abort。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[s8b] ${label} timeout ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ─── #35/#36 S8 逐章流式 + 心跳 ──────────────────────────────────────────────────

/** writer 产出的 section 最小形状（只取流式事件用到的字段）。 */
export interface WriterSectionLite {
  readonly heading?: string;
  readonly body?: string;
}

export interface ChapterStreamArgs {
  /** writer 产出的 sections（一次性产出，本 helper 逐章补发事件）。 */
  readonly sections: ReadonlyArray<WriterSectionLite>;
  /** plan 维度名（按章节索引近似映射；越界回退 topic）。 */
  readonly dimensionNames: ReadonlyArray<string>;
  /** 维度缺失时的回退 dimension（通常是 topic）。 */
  readonly fallbackDimension: string;
  /** emitDomain 的 onEvent 引用（best-effort）。 */
  readonly onEvent:
    | ((e: CapabilityRunEvent) => void | Promise<void>)
    | undefined;
  /**
   * 章节间最小间隔（ms），保证 started/completed 时间戳严格递增、不在同一毫秒 burst
   * （前端 todo-ledger 依赖时间顺序推进）。缺省 2ms（对齐基线 per-dim 的 sleep 2ms）。
   */
  readonly minStepMs?: number;
  /** 注入 sleep（测试可传同步 stub 避免真等待）。缺省真 setTimeout。 */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 逐章补发 chapter:writing:started / chapter:writing:completed。
 *
 * 关键修复（对齐 schema）：payload 字段用 `chapterIndex`（ChapterWritingStarted/Completed
 *   Schema 的字段名），不用 `index`——否则前端按 chapterIndex 取不到、todo 建不出。
 * 时间戳保证：每章 started→completed→下一章之间 await 一个 ≥minStepMs 的 sleep，让
 *   emitDomain 内的 timestamp(Date.now()) 严格递增，杜绝"同毫秒整批 burst"观感。
 *
 * @returns 实际补发的章节数。
 */
export async function emitChapterStream(
  args: ChapterStreamArgs,
): Promise<number> {
  const {
    sections,
    dimensionNames,
    fallbackDimension,
    onEvent,
    minStepMs = 2,
    sleep = defaultSleep,
  } = args;
  if (!onEvent || sections.length === 0) return 0;

  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx];
    const heading = sec.heading ?? `Section ${idx + 1}`;
    const dimension =
      idx < dimensionNames.length ? dimensionNames[idx] : fallbackDimension;
    const wordCount =
      typeof sec.body === "string"
        ? Math.round(sec.body.length / 2)
        : undefined;

    emitDomain(onEvent, "chapter:writing:started", {
      dimension,
      heading,
      chapterIndex: idx,
    });
    // started→completed 之间也错开 1 tick，避免单章两事件同毫秒。
    if (minStepMs > 0) await sleep(minStepMs);
    emitDomain(onEvent, "chapter:writing:completed", {
      dimension,
      heading,
      chapterIndex: idx,
      ...(wordCount !== undefined ? { wordCount } : {}),
    });
    // 下一章前再错开，保证跨章时间戳严格递增。
    if (minStepMs > 0 && idx < sections.length - 1) await sleep(minStepMs);
  }
  return sections.length;
}

/**
 * 写作期心跳兜底（#4 退路）：当无法逐章流式（writer 不分章 / sections 为空）时，
 *   每 ≤intervalMs 发一条 iteration:progress，让前端"写作中"有推进感、不假死。
 *
 * 返回一个 stop 句柄；调用方在 writer 调用结束后必须调用以清除 timer。
 * intervalMs 缺省 60s（任务要求每 ≤60s 一条）。
 */
export function startWritingHeartbeat(args: {
  readonly onEvent:
    | ((e: CapabilityRunEvent) => void | Promise<void>)
    | undefined;
  readonly stage: string;
  readonly role: string;
  readonly text: string;
  readonly intervalMs?: number;
  /** 注入 timer（测试用）；缺省 setInterval。 */
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}): () => void {
  const {
    onEvent,
    stage,
    role,
    text,
    intervalMs = 60_000,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = args;
  if (!onEvent) return () => undefined;
  let beat = 0;
  const timer = setIntervalFn(() => {
    beat += 1;
    emitDomain(onEvent, "iteration:progress", {
      stage,
      role,
      iteration: beat,
      text,
    });
  }, intervalMs);
  return () => clearIntervalFn(timer);
}

// ─── #34 S8B 三重护栏 ────────────────────────────────────────────────────────────

/** SectionSelfEval 结果最小投影。 */
export interface SelfEvalLite {
  readonly overallOk: boolean;
  readonly weakAreas: ReadonlyArray<unknown>;
  readonly scores: Record<string, number>;
}

/** Remediate 结果最小投影。 */
export interface RemediateLite {
  readonly skipped: boolean;
  readonly content?: string;
}

/** runGuardedSectionRemediation 的 section 形状（content/body 任一）。 */
export interface RemediableSection {
  id?: string;
  title?: string;
  heading?: string;
  content?: string;
  body?: string;
}

export interface GuardedRemediationDeps<A> {
  /** 自评（before / after 复用）。 */
  readonly evaluateSection: (input: {
    content: string;
    sectionTitle: string;
    topicName: string;
    language: "zh-CN" | "en-US";
  }) => Promise<SelfEvalLite>;
  /** 由 evalResult 派生补救动作。 */
  readonly determineRemediationActions: (
    evalResult: SelfEvalLite,
    threshold: number,
    language: "zh-CN" | "en-US",
  ) => A[];
  /** 定向补救。 */
  readonly remediate: (input: {
    content: string;
    sectionTitle: string;
    actions: A[];
    originalModelId?: string;
    language: "zh-CN" | "en-US";
  }) => Promise<RemediateLite>;
  /** 补救闭环记录（QualityTrace；fail-open，可省略）。 */
  readonly recordLoop?: (info: {
    sectionKey: string;
    before: Record<string, number>;
    after: Record<string, number>;
    weakAreasResolved: boolean;
    remediationModel?: string;
  }) => void;
}

export interface GuardedRemediationArgs<A> {
  readonly sections: RemediableSection[];
  readonly topic: string;
  readonly language: "zh-CN" | "en-US";
  /** auditLayers（消费方包装的 string[]）；含 "minimal" 整段跳过。 */
  readonly auditLayers: ReadonlyArray<string>;
  readonly preferredModelId?: string;
  readonly deps: GuardedRemediationDeps<A>;
  /** warn 日志（缺省 no-op）。 */
  readonly warn?: (msg: string) => void;
  /** 测试可覆写护栏阈值；生产用默认。 */
  readonly selfEvalTimeoutMs?: number;
  readonly remediateTimeoutMs?: number;
  readonly wallTimeMs?: number;
  /** 注入 now（测试驱动 wall-time）；缺省 Date.now。 */
  readonly now?: () => number;
}

export interface GuardedRemediationResult {
  /** 是否有 section 被补救（调用方据此重建 fullMarkdown）。 */
  readonly mutated: boolean;
  /** 因 minimal 档位整段跳过。 */
  readonly skippedMinimal: boolean;
  /** 命中 wall-time 提前结束时已处理的 section 数。 */
  readonly processed: number;
  /** 命中 wall-time 守卫。 */
  readonly wallTimeHit: boolean;
}

const DEFAULT_SELF_EVAL_TIMEOUT_MS = 60_000;
const DEFAULT_REMEDIATE_TIMEOUT_MS = 90_000;
/** 基线 S8B_WALL_TIME_MS = 20min（belt-and-suspenders，防真 hang 拖死 mission）。 */
const DEFAULT_S8B_WALL_TIME_MS = 20 * 60 * 1000;
/** 弱维度阈值（< 7 触发补救），对齐 runSectionRemediation 原值。 */
const WEAK_DIM_THRESHOLD = 7;
/** 太短不值得补救。 */
const MIN_REMEDIABLE_LEN = 200;

/**
 * 逐 section 串行补救，恢复三重时间护栏：
 *   1. 单 call withTimeout（self-eval 60s / remediate 90s）—— 防单次 LLM 分钟级阻塞。
 *   2. 20min wall-time 守卫 —— section 间检查 deadline，超时 break 跳过余下（解锁 S9-S12）。
 *   3. auditLayers="minimal" 整段跳过 —— 尊重用户显式关闭深度审阅（不多花钱/不多等）。
 * 任何单 section 失败/超时 catch 跳过（fail-open，不阻断 mission）。
 *
 * 不在此处发事件（保持纯）——调用方按 mutated 回写 artifact + 重建 markdown。
 */
export async function runGuardedSectionRemediation<A>(
  args: GuardedRemediationArgs<A>,
): Promise<GuardedRemediationResult> {
  const {
    sections,
    topic,
    language,
    auditLayers,
    preferredModelId,
    deps,
    warn,
    selfEvalTimeoutMs = DEFAULT_SELF_EVAL_TIMEOUT_MS,
    remediateTimeoutMs = DEFAULT_REMEDIATE_TIMEOUT_MS,
    wallTimeMs = DEFAULT_S8B_WALL_TIME_MS,
    now = Date.now,
  } = args;

  // ★ 护栏 3：minimal 档位整段跳过（对齐 s9 critic C8 门控写法）。
  if (auditLayers.includes("minimal")) {
    return {
      mutated: false,
      skippedMinimal: true,
      processed: 0,
      wallTimeHit: false,
    };
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    return {
      mutated: false,
      skippedMinimal: false,
      processed: 0,
      wallTimeHit: false,
    };
  }

  // ★ 护栏 2：20min wall-time 守卫。
  const deadline = now() + wallTimeMs;
  let mutated = false;
  let processed = 0;
  let wallTimeHit = false;

  for (const sec of sections) {
    if (now() > deadline) {
      warn?.(
        `[s8b] wall-time exceeded (${wallTimeMs}ms), skipping remaining sections to unblock downstream stages`,
      );
      wallTimeHit = true;
      break;
    }
    const content = sec.content ?? sec.body ?? "";
    const title = sec.title ?? sec.heading ?? "";
    if (content.length < MIN_REMEDIABLE_LEN) continue;
    processed += 1;
    try {
      // ★ 护栏 1：单 call withTimeout。
      const evalResult = await withTimeout(
        deps.evaluateSection({
          content,
          sectionTitle: title,
          topicName: topic,
          language,
        }),
        selfEvalTimeoutMs,
        `selfEval-before "${title}"`,
      );
      if (evalResult.overallOk || evalResult.weakAreas.length === 0) continue;
      const actions = deps.determineRemediationActions(
        evalResult,
        WEAK_DIM_THRESHOLD,
        language,
      );
      if (actions.length === 0) continue;
      const remediated = await withTimeout(
        deps.remediate({
          content,
          sectionTitle: title,
          actions,
          ...(preferredModelId ? { originalModelId: preferredModelId } : {}),
          language,
        }),
        remediateTimeoutMs,
        `remediate "${title}"`,
      );
      if (remediated.skipped || !remediated.content) continue;
      // 回写补救后内容（content / body 任一存在的字段都更新）。
      if (sec.content !== undefined) sec.content = remediated.content;
      if (sec.body !== undefined) sec.body = remediated.content;
      if (sec.content === undefined && sec.body === undefined) {
        sec.content = remediated.content;
      }
      mutated = true;
      const after = await withTimeout(
        deps.evaluateSection({
          content: remediated.content,
          sectionTitle: title,
          topicName: topic,
          language,
        }),
        selfEvalTimeoutMs,
        `selfEval-after "${title}"`,
      );
      deps.recordLoop?.({
        sectionKey: sec.id ?? title,
        before: evalResult.scores,
        after: after.scores,
        weakAreasResolved: after.weakAreas.length === 0,
        ...(preferredModelId ? { remediationModel: preferredModelId } : {}),
      });
    } catch (err) {
      // 单 section 补救失败/超时降级跳过（不阻断后续 section / mission）。
      warn?.(
        `[s8b] section remediation failed (skipped): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { mutated, skippedMinimal: false, processed, wallTimeHit };
}
