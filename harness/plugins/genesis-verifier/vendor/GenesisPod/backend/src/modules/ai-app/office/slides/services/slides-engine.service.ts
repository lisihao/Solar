/**
 * Slides Engine Service v5.0
 * 幻灯片生成引擎服务
 *
 * 核心职责：
 * - 通过 SlidesTeamOrchestrator 编排 PPT 生成任务
 * - 事件格式转换（SlidesMissionEvent → StreamEvent）
 * - 检查点管理
 * - 导出功能
 *
 * 架构：
 * SlidesEngineService → SlidesTeamOrchestrator → SlidesLeader/SlidesTeamMember
 *
 * 5阶段执行流程：
 * 1. Leader 规划 - 分析源文本，动态分解任务
 * 2. 任务执行 - 成员执行任务，调用 Skills
 * 3. Leader 审核 - 检查任务输出，支持修订
 * 4. 质量审计 - 全局质量检查
 * 5. Leader 综合 - 整合所有输出
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { OnEvent, EventEmitter2 } from "@nestjs/event-emitter";
import { SlidesTeamOrchestrator } from "../orchestrator/slides-team-orchestrator";
import { SlidesAutoRouterService } from "../skill-resolver";
import {
  SlidesTeamOrchestratorInput,
  SlidesMissionEvent,
} from "../orchestrator/types";
import { SlidesCheckpointService } from "../checkpoint/checkpoint.service";
import { SlidesExportService } from "../rendering/slides-export.service";
import {
  CheckpointState,
  StreamEventType,
  StreamEvent,
  PageOutline,
} from "../checkpoint/checkpoint.types";
import { PageGeneratedEvent } from "../skills/page-pipeline.skill";
import { ContentCompressionSkill } from "../skills/content-compression.skill";
import { TemplateRenderingSkill } from "../skills/template-rendering.skill";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  EventBusService,
} from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { LruMap } from "@/common/utils/lru-map";
/**
 * PPT 生成输入参数
 */
export interface SlidesGenerateInput {
  /** 用户 ID */
  userId: string;

  /** 源文本内容 */
  sourceText: string;

  /** 用户需求描述（可选） */
  userRequirement?: string;

  /** 目标页数（可选，自动推断） */
  targetPages?: number;

  /** 风格偏好 */
  stylePreference?: "dark" | "light";

  /** 主题 ID */
  themeId?: string;

  /** 会话 ID（可选，用于恢复） */
  sessionId?: string;

  /** 目标受众（可选） */
  targetAudience?: string;

  /** 跨模块来源（可选），用于追踪 PPT 从哪个模块内容生成 */
  crossModuleSource?: {
    type: "topic-insights" | "research-project";
    sourceId: string;
    sourceName?: string;
  };

  // ── Skills-driven extensibility (Phase A) ──
  /** 命名预设 id，参考 slides/presets/*.json */
  preset?: string;
  /** 按 slot 覆盖 skill；优先级最高 */
  skillOverrides?: Record<string, string>;
  /** 输出意图：brief / pitch / tutorial / report / summary */
  intent?: string;
  /** 语种 hint，用于 policy 匹配 */
  language?: string;
  /**
   * Opt-in：是否调用 LLM auto-router 分析 sourceText 自动推断 preset/conditions。
   * 仅当未显式传 preset 且未设置条件字段时才会生效。
   */
  autoRoute?: boolean;
}

// Re-export StreamEvent for convenience
export type { StreamEvent };

/**
 * 导出选项
 */
export interface ExportOptions {
  format: "pptx" | "pdf" | "png" | "html";
  quality?: "standard" | "high";
}

/**
 * PPT 生成引擎服务
 */
@Injectable()
export class SlidesEngineService {
  private readonly logger = new Logger(SlidesEngineService.name);

  /**
   * 实时页面事件缓冲区
   * 用于存储 PagePipelineSkill 通过 EventEmitter2 发出的页面生成事件
   * 这些事件会在 generateSlides 循环中被提取并发送到 SSE 流
   */
  private readonly pageEventBuffer = new Map<string, StreamEvent[]>();

  /**
   * 自动保存跟踪器
   * 记录每个 session 已保存的最新页码，用于触发中间检查点
   */
  private readonly autoSaveTracker = new Map<
    string,
    {
      lastSavedPage: number;
      pages: Map<number, { html: string; design?: unknown }>;
    }
  >();

  /** 每隔多少页自动保存一次 */
  private readonly AUTO_SAVE_INTERVAL = 3;
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private readonly orchestrator: SlidesTeamOrchestrator,
    private readonly checkpointService: SlidesCheckpointService,
    private readonly exportService: SlidesExportService,
    @Optional() private readonly contentCompression: ContentCompressionSkill,
    @Optional() private readonly templateRendering: TemplateRenderingSkill,
    @Optional() private readonly aiFacade: ChatFacade,
    @Optional() private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly autoRouter?: SlidesAutoRouterService,
  ) {}

  /**
   * 监听 PagePipelineSkill 发出的实时页面生成事件
   * 将事件缓存到对应 session 的缓冲区
   */
  @OnEvent("slides.page.generated")
  handlePageGenerated(event: PageGeneratedEvent): void {
    // ★★★ 关键诊断日志 ★★★
    this.logger.warn(
      `[handlePageGenerated] ★★★ EVENT RECEIVED ★★★ page=${event.pageNumber}, sessionId=${event.sessionId}`,
    );

    const sessionId = event.sessionId;
    if (!sessionId) {
      this.logger.warn(
        "[handlePageGenerated] Received page event without sessionId",
      );
      return;
    }

    // 创建 slide:generated 事件（包含设计思考数据）
    const streamEvent = this.createEvent("slide:generated", sessionId, {
      pageNumber: event.pageNumber,
      totalPages: event.totalPages,
      title: event.title,
      html: event.html,
      templateId: event.templateId,
      contentLength: event.html?.length || 0,
      // ★ 新增：设计思考数据，同步到 Thinking TAB
      design: event.design,
      keyPoints: event.keyPoints,
    });

    // 添加到缓冲区
    if (!this.pageEventBuffer.has(sessionId)) {
      this.pageEventBuffer.set(sessionId, []);
    }
    this.pageEventBuffer.get(sessionId)!.push(streamEvent);

    // ★ 发送设计思考事件到 Thinking TAB（如果有 design 数据）
    if (event.design?.reasoning) {
      const thinkingEvent = this.createEvent("agent:thinking", sessionId, {
        agent: "writer",
        agentName: "Content Writer",
        thought: event.design.reasoning,
        phase: `page-${event.pageNumber}-design`,
      });
      this.pageEventBuffer.get(sessionId)!.push(thinkingEvent);
    }

    this.logger.log(
      `[handlePageGenerated] Buffered page ${event.pageNumber}/${event.totalPages} for session ${sessionId}, design=${!!event.design}`,
    );

    // ★ 自动保存机制：跟踪页面并在达到阈值时保存中间检查点
    this.trackPageForAutoSave(sessionId, event);
  }

  /**
   * 跟踪页面生成并在达到阈值时保存中间检查点
   */
  private trackPageForAutoSave(
    sessionId: string,
    event: PageGeneratedEvent,
  ): void {
    // 初始化跟踪器
    if (!this.autoSaveTracker.has(sessionId)) {
      this.autoSaveTracker.set(sessionId, {
        lastSavedPage: 0,
        pages: new Map(),
      });
    }

    const tracker = this.autoSaveTracker.get(sessionId)!;

    // 保存页面数据
    if (event.html) {
      tracker.pages.set(event.pageNumber, {
        html: event.html,
        design: event.design,
      });
    }

    // 检查是否需要保存中间检查点
    const completedPages = tracker.pages.size;
    const pagesSinceLastSave = completedPages - tracker.lastSavedPage;

    if (pagesSinceLastSave >= this.AUTO_SAVE_INTERVAL) {
      this.logger.log(
        `[trackPageForAutoSave] ★ Triggering auto-save at page ${event.pageNumber} (${completedPages} pages completed)`,
      );

      // 异步保存中间检查点
      this.saveIntermediateCheckpoint(sessionId, tracker).catch((error) => {
        this.logger.warn(
          `[trackPageForAutoSave] Failed to save intermediate checkpoint: ${error}`,
        );
      });

      // 更新已保存页码
      tracker.lastSavedPage = completedPages;
    }
  }

  /**
   * 保存中间检查点
   */
  private async saveIntermediateCheckpoint(
    sessionId: string,
    tracker: {
      lastSavedPage: number;
      pages: Map<number, { html: string; design?: unknown }>;
    },
  ): Promise<void> {
    try {
      // 将页面数据转换为数组格式
      const pagesArray = Array.from(tracker.pages.entries())
        .sort(([a], [b]) => a - b)
        .map(([pageNumber, data]) => ({
          pageNumber,
          html: data.html,
          design: data.design,
          status: "completed" as const,
        }));

      await this.checkpointService.create({
        sessionId,
        type: "page_rendered",
        name: `自动保存点 - 已完成 ${pagesArray.length} 页`,
        state: {
          pages: pagesArray,
          conversation: [],
        } as unknown as import("../checkpoint/checkpoint.types").CheckpointState,
        metadata: {
          trigger: "auto",
          description: `自动保存 - 已完成 ${pagesArray.length} 页`,
        },
      });

      this.logger.log(
        `[saveIntermediateCheckpoint] ★ Saved intermediate checkpoint with ${pagesArray.length} pages for session ${sessionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[saveIntermediateCheckpoint] Failed to save: ${error}`,
      );
    }
  }

  /**
   * 监听页面开始生成事件
   * 发送 slide:generating 事件到前端，显示当前正在生成哪一页
   */
  @OnEvent("slides.page.generating")
  handlePageGenerating(event: {
    pageNumber: number;
    totalPages: number;
    title: string;
    templateType: string;
    sessionId: string;
  }): void {
    const sessionId = event.sessionId;
    if (!sessionId) {
      return;
    }

    this.logger.log(
      `[handlePageGenerating] ★ Starting page ${event.pageNumber}/${event.totalPages}: ${event.title}`,
    );

    // 创建 slide:generating 事件
    const streamEvent = this.createEvent("slide:generating", sessionId, {
      pageNumber: event.pageNumber,
      totalPages: event.totalPages,
      title: event.title,
      templateType: event.templateType,
    });

    // 同时发送 agent:working 事件更新状态栏
    const agentWorkingEvent = this.createEvent("agent:working", sessionId, {
      agent: "writer",
      agentName: "Content Writer",
      task: `正在生成第 ${event.pageNumber}/${event.totalPages} 页：${event.title}`,
      progress: Math.round(((event.pageNumber - 1) / event.totalPages) * 100),
    });

    // 缓存到 buffer
    if (!this.pageEventBuffer.has(sessionId)) {
      this.pageEventBuffer.set(sessionId, []);
    }
    this.pageEventBuffer.get(sessionId)!.push(agentWorkingEvent, streamEvent);
  }

  /**
   * 提取并清空指定 session 的缓冲事件
   */
  private flushPageEventBuffer(sessionId: string): StreamEvent[] {
    const events = this.pageEventBuffer.get(sessionId) || [];
    this.pageEventBuffer.delete(sessionId);
    return events;
  }

  /**
   * 生成 PPT（流式）
   * 通过 AI Engine 的 TeamsService 编排
   */
  async *generateSlides(
    input: SlidesGenerateInput,
  ): AsyncGenerator<StreamEvent> {
    this.logger.log(
      `[generateSlides] Starting PPT generation for user ${input.userId}`,
    );

    // 1. 创建或恢复会话
    let sessionId = input.sessionId;
    if (!sessionId) {
      this.logger.log(`[generateSlides] Creating new session...`);
      const session = await this.checkpointService.createSession(
        input.userId,
        input.userRequirement || "PPT 生成",
      );
      sessionId = session.id;
      this.logger.log(`[generateSlides] Session created: ${sessionId}`);

      // ★ 立即保存初始检查点，确保至少有一个检查点
      await this.checkpointService.create({
        sessionId,
        type: "task_decomposition",
        state: {
          sourceText: input.sourceText,
          userRequirement: input.userRequirement,
          targetPages: input.targetPages,
          stylePreference: input.stylePreference,
          themeId: input.themeId,
          pages: [], // 初始为空
          conversation: [],
        } as unknown as CheckpointState,
        metadata: {
          trigger: "auto",
          description: "Initial checkpoint - session created",
        },
      });
      this.logger.log(
        `[generateSlides] ★ Saved initial checkpoint for session ${sessionId}`,
      );
    } else {
      this.logger.log(`[generateSlides] Using existing session: ${sessionId}`);
    }

    // ★ AI Kernel: 创建进程记录
    if (this.missionExecutor && input.userId) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId: input.userId,
          agentId: "office-agent",
          teamSessionId: sessionId,
          input: {
            targetPages: input.targetPages,
            stylePreference: input.stylePreference,
          },
        });
        this.kernelProcessIds.set(sessionId, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. 发送 execution:started 事件
    this.logger.log(
      `[generateSlides] Sending execution:started event for session ${sessionId}`,
    );
    yield this.createEvent("execution:started", sessionId, {
      sessionId,
      sourceLength: input.sourceText?.length || 0,
      targetPages: input.targetPages,
    });
    this.logger.log(`[generateSlides] execution:started event sent`);

    // 3. 构建 SlidesTeamOrchestrator 输入
    const now = new Date().toISOString();
    const orchestratorInput: SlidesTeamOrchestratorInput = {
      userId: input.userId,
      sessionId,
      sourceText: input.sourceText,
      userRequirement: input.userRequirement,
      targetPages: input.targetPages,
      stylePreference: input.stylePreference || "dark",
      themeId: input.themeId || "genspark-dark",
      targetAudience: input.targetAudience,
      sourceSubscription: input.crossModuleSource
        ? {
            type: input.crossModuleSource.type,
            sourceId: input.crossModuleSource.sourceId,
            sourceName: input.crossModuleSource.sourceName,
            subscribedAt: now,
            lastSourceUpdatedAt: now,
            isStale: false,
          }
        : undefined,
      // ── Skills-driven extensibility ──
      // sourceTypeHint defaults from crossModuleSource.type, but can be
      // overridden by caller.
      sourceTypeHint: input.crossModuleSource?.type,
      audience: input.targetAudience,
      intent: input.intent,
      language: input.language,
      preset: input.preset,
      skillOverrides: input.skillOverrides,
    };

    // Opt-in LLM auto-routing (Phase C3). Runs before the resolver and only
    // when the caller asked for it AND hasn't already set preset / hints.
    // Silently no-ops if the router is unavailable or returns nothing.
    if (input.autoRoute && this.autoRouter) {
      const alreadyRouted =
        !!input.preset ||
        !!input.intent ||
        !!input.language ||
        !!input.targetAudience ||
        !!input.skillOverrides;
      if (!alreadyRouted) {
        const suggestion = await this.autoRouter.infer(input.sourceText);
        if (suggestion) {
          orchestratorInput.preset =
            orchestratorInput.preset ?? suggestion.presetId;
          orchestratorInput.sourceTypeHint =
            orchestratorInput.sourceTypeHint ??
            suggestion.conditions.sourceType;
          orchestratorInput.audience =
            orchestratorInput.audience ?? suggestion.conditions.audience;
          orchestratorInput.intent =
            orchestratorInput.intent ?? suggestion.conditions.intent;
          orchestratorInput.language =
            orchestratorInput.language ?? suggestion.conditions.language;
          this.logger.log(
            `[generateSlides] auto-routed: preset=${suggestion.presetId ?? "(none)"} ` +
              `audience=${suggestion.conditions.audience ?? "-"} ` +
              `intent=${suggestion.conditions.intent ?? "-"}` +
              (suggestion.rationale ? ` — ${suggestion.rationale}` : ""),
          );
        }
      }
    }

    // 4. 心跳/缓冲区刷新间隔（不再只是空心跳）
    const BUFFER_FLUSH_INTERVAL_MS = 2000; // 每 2 秒检查一次缓冲区

    try {
      // 5. 执行 Mission（流式）- 使用 SlidesTeamOrchestrator
      this.logger.log(
        `[generateSlides] Starting mission via SlidesTeamOrchestrator`,
      );
      const generator = this.orchestrator.executeMission(orchestratorInput);
      this.logger.log(`[generateSlides] Orchestrator generator created`);

      let currentPhase = "";
      let eventCount = 0;
      let done = false;
      let missionCompleteData: Record<string, unknown> | undefined;

      // ★ 使用 Promise.race 实现实时事件推送
      // 每次等待时，要么收到 SlidesMissionEvent，要么超时后刷新缓冲区
      const iterator = generator[Symbol.asyncIterator]();

      while (!done) {
        // 创建超时 Promise，用于定期刷新缓冲区
        const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
          setTimeout(
            () => resolve({ timeout: true }),
            BUFFER_FLUSH_INTERVAL_MS,
          ),
        );

        // 获取下一个 SlidesMissionEvent 的 Promise
        const nextEventPromise = iterator.next().then((result) => ({
          timeout: false as const,
          result,
        }));

        // Race: 要么收到事件，要么超时
        const raceResult = await Promise.race([
          nextEventPromise,
          timeoutPromise,
        ]);

        // ★ 无论哪种情况，先刷新缓冲区（实时推送页面事件）
        const bufferedPageEvents = this.flushPageEventBuffer(sessionId);
        for (const pageEvent of bufferedPageEvents) {
          yield pageEvent;
          this.logger.log(
            `[generateSlides] Yielded buffered page event: page ${(pageEvent.data as { pageNumber?: number })?.pageNumber}`,
          );
        }

        if (raceResult.timeout) {
          // 超时：刷新缓冲区，并发送心跳保持连接
          this.logger.debug(
            `[generateSlides] Buffer flush tick, buffered ${bufferedPageEvents.length} events`,
          );

          // ★★★ 关键修复：发送心跳事件保持 SSE 连接 ★★★
          // Vercel/Railway 代理有 30 秒空闲超时，必须定期发送数据
          if (bufferedPageEvents.length === 0) {
            yield this.createEvent("heartbeat", sessionId, {
              timestamp: new Date().toISOString(),
              phase: currentPhase || "processing",
            });
          }
          continue;
        }

        // 收到 SlidesMissionEvent
        const { result } = raceResult;
        if (result.done) {
          done = true;
          continue;
        }

        const event = result.value;
        eventCount++;
        this.logger.log(
          `[generateSlides] Received event #${eventCount}: ${event.type}`,
        );

        // 6. 转换 SlidesMissionEvent 为 StreamEvent（可能返回多个事件）
        const streamEvents = this.transformSlidesMissionEvent(event, sessionId);
        const slideGenCount = streamEvents.filter(
          (e) => e.type === "slide:generated",
        ).length;
        this.logger.log(
          `[generateSlides] Transformed ${event.type} to ${streamEvents.length} stream events (${slideGenCount} slide:generated)`,
        );
        for (const streamEvent of streamEvents) {
          if (streamEvent.type === "slide:generated") {
            const pageData = streamEvent.data as {
              pageNumber?: number;
              title?: string;
            };
            this.logger.log(
              `[generateSlides] ★ YIELDING slide:generated for page ${pageData.pageNumber}: ${pageData.title}`,
            );
          }
          yield streamEvent;
        }

        // 7. 跟踪阶段并保存检查点
        if (event.type === "mission:phase_changed") {
          currentPhase = (event.data.phase as string) || "";
          this.logger.debug(`[generateSlides] Phase changed: ${currentPhase}`);
        }

        // 保存阶段检查点 - 每个关键阶段完成后都保存
        if (event.type.endsWith(":completed")) {
          const phase = event.type.replace(":completed", "");
          this.logger.log(
            `[generateSlides] ★ Received :completed event: ${event.type}, phase=${phase}`,
          );
          if (this.isCheckpointPhase(phase)) {
            this.logger.log(
              `[generateSlides] ★ Saving checkpoint for phase: ${phase}`,
            );
            await this.saveCheckpoint(sessionId, phase, event.data);
            this.logger.log(
              `[generateSlides] ★ Checkpoint saved for phase: ${phase}`,
            );
          } else {
            this.logger.log(
              `[generateSlides] ★ Skipping checkpoint for phase: ${phase} (not a checkpoint phase)`,
            );
          }
        }

        // 捕获 mission:completed 数据
        if (event.type === "mission:completed") {
          missionCompleteData = event.data;
          this.logger.log(
            `[generateSlides] ★ Captured mission:completed data, pages count: ${(event.data.pages as unknown[])?.length || 0}`,
          );
        }

        // ★ 诊断：检测失败事件
        if (event.type === "mission:failed" || event.type === "task:failed") {
          this.logger.error(
            `[generateSlides] ★★★ FAILURE EVENT: ${event.type}, error: ${JSON.stringify(event.data).slice(0, 500)}`,
          );
        }
      }

      // ★ 诊断：事件循环结束
      this.logger.log(
        `[generateSlides] ★ Event loop ended. Total events: ${eventCount}, missionCompleteData exists: ${!!missionCompleteData}`,
      );

      // 8. 保存最终检查点
      if (missionCompleteData) {
        this.logger.log(
          `[generateSlides] ★ Saving final checkpoint with missionCompleteData`,
        );
        await this.saveFinalCheckpointFromEvent(sessionId, missionCompleteData);
      } else {
        this.logger.warn(
          `[generateSlides] ★ WARNING: No missionCompleteData captured! Mission may have failed or disconnected.`,
        );
      }

      // 8.1 清理自动保存跟踪器
      this.autoSaveTracker.delete(sessionId);

      // 8.5 最后一次刷新缓冲区，确保所有页面事件都已发送
      const finalPageEvents = this.flushPageEventBuffer(sessionId);
      for (const pageEvent of finalPageEvents) {
        yield pageEvent;
        this.logger.log(
          `[generateSlides] Yielded final page event: page ${(pageEvent.data as { pageNumber?: number })?.pageNumber}`,
        );
      }

      // 9. 发送 execution:completed 事件
      const pages = (missionCompleteData?.pages as unknown[]) || [];
      this.completeKernelProcess(sessionId, { totalPages: pages.length });
      yield this.createEvent("execution:completed", sessionId, {
        totalPages: pages.length,
        totalTime: (missionCompleteData?.duration as number) || 0,
        checkpointId: sessionId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[generateSlides] Error during PPT generation: ${errorMessage}`,
      );
      if (errorStack) {
        this.logger.error(`[generateSlides] Stack trace:\n${errorStack}`);
      }

      this.failKernelProcess(sessionId, errorMessage);
      yield this.createEvent("execution:failed", sessionId, {
        error: errorMessage,
        phase: "unknown",
        recoverable: false,
      });
    } finally {
      // 清理缓冲区，防止内存泄漏
      this.pageEventBuffer.delete(sessionId);
    }
  }

  /**
   * 获取会话状态
   */
  async getSessionState(sessionId: string): Promise<CheckpointState | null> {
    const checkpoint =
      await this.checkpointService.getLatestCheckpoint(sessionId);
    return checkpoint?.state || null;
  }

  /**
   * 恢复到指定检查点
   */
  async restoreCheckpoint(
    checkpointId: string,
  ): Promise<{ state: CheckpointState; sessionId: string }> {
    return this.checkpointService.restore(checkpointId);
  }

  /**
   * 导出 PPTX
   */
  async exportPptx(sessionId: string): Promise<Buffer> {
    const state = await this.getSessionState(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const result = await this.exportService.exportToPPTX(
      state as unknown as Parameters<typeof this.exportService.exportToPPTX>[0],
    );
    return result.buffer;
  }

  /**
   * 导出 PDF
   */
  async exportPdf(sessionId: string): Promise<Buffer> {
    const state = await this.getSessionState(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const result = await this.exportService.exportToPDF(
      state as unknown as Parameters<typeof this.exportService.exportToPDF>[0],
    );
    return result.buffer;
  }

  /**
   * 重新生成指定页面
   * 根据用户反馈修改页面内容并重新渲染
   */
  async regeneratePage(
    sessionId: string,
    pageNumber: number,
    feedback?: string,
  ): Promise<StreamEvent[]> {
    this.logger.log(
      `[regeneratePage] Regenerating page ${pageNumber} for session ${sessionId}, feedback: "${feedback}"`,
    );

    const events: StreamEvent[] = [];

    // 1. 获取当前状态
    const state = await this.getSessionState(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 2. 找到目标页面
    const pageIndex = pageNumber - 1;
    const currentPage = state.pages[pageIndex];
    if (!currentPage) {
      throw new Error(`Page ${pageNumber} not found in session ${sessionId}`);
    }

    // 3. 检查必要的服务是否可用
    if (!this.contentCompression || !this.templateRendering) {
      this.logger.warn(
        "[regeneratePage] Content compression or template rendering skills not available",
      );
      throw new Error("页面重新生成服务不可用，请稍后重试");
    }

    try {
      // 4. 解析用户反馈，生成修改后的页面大纲
      const modifiedOutline = await this.interpretFeedbackAndModifyOutline(
        currentPage.outline,
        feedback || "",
        sessionId,
      );

      this.logger.log(
        `[regeneratePage] Modified outline: title="${modifiedOutline.title}"`,
      );

      // 5. 发送开始重新生成事件
      events.push(
        this.createEvent("agent:working", sessionId, {
          agent: "designer",
          agentName: "Slide Designer",
          task: `正在重新生成第 ${pageNumber} 页: ${feedback || "用户请求修改"}`,
          progress: 0,
        }),
      );

      // 6. 使用 ContentCompression 重新生成内容
      const compressionResult = await this.contentCompression.execute(
        {
          pageOutline: modifiedOutline,
          sourceText: currentPage.outline.keyElements?.join("\n") || "",
          maxCharacters: 500,
          sessionId,
          retryContext: {
            attempt: 1,
            feedback: feedback || "用户请求修改页面内容",
          },
        },
        {
          executionId: `regenerate-${sessionId}-${pageNumber}-${Date.now()}`,
          skillId: "content-compression",
          createdAt: new Date(),
        },
      );

      if (!compressionResult.success || !compressionResult.data?.pageContent) {
        throw new Error("内容生成失败");
      }

      const newContent = compressionResult.data.pageContent;
      this.logger.log(
        `[regeneratePage] New content generated: title="${newContent.title}"`,
      );

      // 7. 使用 TemplateRendering 重新渲染 HTML
      const themeId =
        (state.globalStyles as { themeId?: string })?.themeId || "tech-dark";
      const renderResult = await this.templateRendering.execute(
        {
          pageOutline: modifiedOutline,
          pageContent: newContent,
          themeId,
        },
        {
          executionId: `render-${sessionId}-${pageNumber}-${Date.now()}`,
          skillId: "template-rendering",
          createdAt: new Date(),
        },
      );

      if (!renderResult.success || !renderResult.data?.html) {
        throw new Error("HTML 渲染失败");
      }

      const newHtml = renderResult.data.html;
      this.logger.log(
        `[regeneratePage] New HTML rendered: ${newHtml.length} characters`,
      );

      // 8. 更新页面状态
      state.pages[pageIndex] = {
        ...currentPage,
        outline: modifiedOutline,
        content: newContent,
        html: newHtml,
        status: "completed",
      };

      // 9. 保存更新后的检查点
      await this.checkpointService.create({
        sessionId,
        name: `页面 ${pageNumber} 已根据反馈重新生成`,
        type: "user_modified",
        state,
      });

      // 10. 发送页面更新事件
      events.push(
        this.createEvent("slide:generated", sessionId, {
          pageNumber,
          totalPages: state.pages.length,
          title: modifiedOutline.title,
          html: newHtml,
          templateId: renderResult.data.templateId,
          contentLength: newHtml.length,
          isRegenerated: true,
        }),
      );

      // 11. 通过 EventEmitter 广播页面更新（供前端实时更新）
      if (this.eventEmitter) {
        this.eventEmitter.emit("slides.page.regenerated", {
          sessionId,
          pageNumber,
          title: modifiedOutline.title,
          html: newHtml,
          templateId: renderResult.data.templateId,
        });
      }

      events.push(
        this.createEvent("agent:completed", sessionId, {
          agent: "designer",
          agentName: "Slide Designer",
          task: `第 ${pageNumber} 页重新生成完成`,
          result: "success",
        }),
      );

      this.logger.log(
        `[regeneratePage] Page ${pageNumber} regenerated successfully`,
      );

      return events;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      this.logger.error(`[regeneratePage] Failed: ${errorMessage}`);

      events.push(
        this.createEvent("execution:failed", sessionId, {
          phase: "regeneration",
          message: `页面 ${pageNumber} 重新生成失败: ${errorMessage}`,
          recoverable: true,
        }),
      );

      return events;
    }
  }

  /**
   * 解析用户反馈并修改页面大纲
   * 使用 AI 理解用户意图并生成修改后的大纲
   */
  private async interpretFeedbackAndModifyOutline(
    originalOutline: PageOutline,
    feedback: string,
    sessionId: string,
  ): Promise<PageOutline> {
    // 如果没有 AI 服务或反馈为空，直接返回原大纲
    if (!this.aiFacade || !feedback.trim()) {
      this.logger.warn(
        "[interpretFeedbackAndModifyOutline] No AI service or empty feedback, returning original outline",
      );
      return originalOutline;
    }

    const processId = this.kernelProcessIds.get(sessionId);

    try {
      const prompt = `你是一个幻灯片内容专家。请根据用户的反馈修改以下幻灯片大纲。

## 当前页面大纲
- 标题: ${originalOutline.title}
- 副标题: ${originalOutline.subtitle || "无"}
- 模板类型: ${originalOutline.templateType}
- 关键内容: ${originalOutline.keyElements?.join(", ") || "无"}

## 用户反馈
${feedback}

## 任务
请理解用户的修改意图，输出修改后的页面大纲。必须以 JSON 格式返回：

\`\`\`json
{
  "title": "新标题",
  "subtitle": "新副标题（可选）",
  "templateType": "${originalOutline.templateType}",
  "keyElements": ["关键点1", "关键点2", "关键点3"]
}
\`\`\`

注意：
1. 如果用户要求修改标题，直接使用用户指定的内容
2. 保持模板类型不变，除非用户明确要求更改
3. 关键内容应该与新标题相关
4. 只输出 JSON，不要其他内容`;

      // ★ P3 迁移：使用 AIFacade 替代 AiChatService
      const response = await this.aiFacade.chat({
        messages: [{ role: "user", content: prompt }],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "low", // 反馈解析需要低创造性
          outputLength: "minimal", // 输出较短
        },
        processId,
      });

      // 解析 AI 响应
      const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          ...originalOutline,
          title: parsed.title || originalOutline.title,
          subtitle: parsed.subtitle || originalOutline.subtitle,
          templateType: parsed.templateType || originalOutline.templateType,
          keyElements: parsed.keyElements || originalOutline.keyElements,
        };
      }

      // 尝试直接解析（没有 code block 的情况）
      try {
        const parsed = JSON.parse(response.content.trim());
        return {
          ...originalOutline,
          title: parsed.title || originalOutline.title,
          subtitle: parsed.subtitle || originalOutline.subtitle,
          templateType: parsed.templateType || originalOutline.templateType,
          keyElements: parsed.keyElements || originalOutline.keyElements,
        };
      } catch {
        // 如果解析失败，尝试简单的标题替换
        if (feedback.includes("改为") || feedback.includes("修改为")) {
          const match = feedback.match(/(?:改为|修改为)[：:\s]*(.+)/);
          if (match) {
            return {
              ...originalOutline,
              title: match[1].trim(),
            };
          }
        }
      }

      this.logger.warn(
        "[interpretFeedbackAndModifyOutline] Failed to parse AI response, returning original outline",
      );
      return originalOutline;
    } catch (error) {
      this.logger.error(
        `[interpretFeedbackAndModifyOutline] AI interpretation failed: ${error}`,
      );
      // 降级处理：尝试简单的文本替换
      if (feedback.includes("改为") || feedback.includes("修改为")) {
        const match = feedback.match(/(?:改为|修改为)[：:\s]*(.+)/);
        if (match) {
          return {
            ...originalOutline,
            title: match[1].trim(),
          };
        }
      }
      return originalOutline;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 转换 SlidesMissionEvent 为 StreamEvent 数组
   * 使用前端期望的事件类型格式
   * 同时发送 phase 事件和对应的 agent 事件
   */
  private transformSlidesMissionEvent(
    event: SlidesMissionEvent,
    sessionId: string,
  ): StreamEvent[] {
    const data = event.data;
    const events: StreamEvent[] = [];

    // 根据 SlidesMissionEvent 类型返回对应的 StreamEvent
    switch (event.type) {
      case "mission:created": {
        // Mission 创建，发送初始化事件
        const sourceLength = (data.sourceLength as number) || 0;
        const targetPages = (data.targetPages as number) || 0;
        this.logger.debug(
          `[transformSlidesMissionEvent] mission:created received, sourceLength=${sourceLength}`,
        );
        // 发送 Leader 思考
        events.push(
          this.createEvent("agent:thinking", sessionId, {
            agent: "leader",
            agentName: "Slides Architect",
            thought: `正在分析输入内容（${sourceLength > 0 ? `${Math.round(sourceLength / 100) / 10}k 字符` : ""}）${targetPages > 0 ? `，目标 ${targetPages} 页` : ""}，准备分配任务给团队成员...`,
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "leader",
            agentName: "Slides Architect",
            task: "正在初始化 AI 团队，分析内容结构...",
            progress: 0,
          }),
        );
        break;
      }

      case "planning:started": {
        const sourceLength = (data.sourceLength as number) || 0;
        const sourceSummary =
          sourceLength > 0
            ? `${Math.round(sourceLength / 100) / 10}k 字符的`
            : "";
        // 发送 Analyst 思考
        events.push(
          this.createEvent("agent:thinking", sessionId, {
            agent: "analyst",
            agentName: "Content Analyst",
            thought: `开始分析${sourceSummary}源文本，识别关键概念和逻辑结构...`,
          }),
        );
        events.push(
          this.createEvent("phase:started", sessionId, {
            phase: "analyzing",
            agent: "analyst",
            description: "正在分析内容结构...",
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "analyst",
            agentName: "Content Analyst",
            task: "提取关键信息、识别主题层次、分析逻辑关系...",
            progress: 0,
          }),
        );
        break;
      }

      case "planning:completed": {
        const taskCount = (data.taskCount as number) || 0;
        const breakdown = data.breakdown as {
          tasks?: Array<{ title?: string; skillId?: string }>;
          themes?: string[];
          keywords?: string[];
        };
        const taskNames =
          breakdown?.tasks
            ?.slice(0, 3)
            .map((t) => t.title || t.skillId)
            .join("、") || "";

        // 提取主题和关键词（如果有的话）
        const themes = breakdown?.themes?.slice(0, 3).join("、") || "";
        const keywords = breakdown?.keywords?.slice(0, 5).join("、") || "";

        // 构建分析结果描述
        let analysisResult = `内容分析完成，识别了 ${taskCount} 个关键模块`;
        if (themes) {
          analysisResult += `\n主题：${themes}`;
        }
        if (keywords) {
          analysisResult += `\n关键词：${keywords}`;
        }

        // Analyst 完成
        events.push(
          this.createEvent("agent:completed", sessionId, {
            agent: "analyst",
            agentName: "Content Analyst",
            result: analysisResult,
            duration: (data.duration as number) || 0,
          }),
        );

        // 发送 Handoff 事件
        events.push(
          this.createEvent("agent:handoff", sessionId, {
            fromAgent: "analyst",
            toAgent: "strategist",
            message: `内容分析完成，识别 ${taskCount} 个模块${themes ? `（${themes}）` : ""}`,
          }),
        );

        // Strategist 思考
        events.push(
          this.createEvent("agent:thinking", sessionId, {
            agent: "strategist",
            agentName: "Visual Strategist",
            thought: `基于分析结果设计 PPT 结构，将围绕${taskNames || "核心内容"}展开...`,
          }),
        );

        events.push(
          this.createEvent("phase:started", sessionId, {
            phase: "planning",
            agent: "strategist",
            description: "正在设计 PPT 大纲...",
          }),
        );

        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "strategist",
            agentName: "Visual Strategist",
            task: `为 ${taskCount} 个模块设计页面结构和视觉策略`,
            progress: 0,
          }),
        );
        break;
      }

      case "task:created": {
        const task = data.task as { title?: string; skillId?: string };
        this.logger.debug(
          `[transformSlidesMissionEvent] task:created: ${task?.title || task?.skillId}`,
        );
        break;
      }

      case "task:started": {
        const task = data.task as { skillId?: string; title?: string };
        const phase = this.mapSkillToPhase(task?.skillId || "");
        const agent = this.mapPhaseToAgent(phase);
        const agentName = this.getAgentName(agent);

        events.push(
          this.createEvent("agent:working", sessionId, {
            agent,
            agentName,
            task: task?.title || this.getPhaseDescription(phase),
            progress: 0,
          }),
        );
        break;
      }

      case "task:awaiting_review":
      case "task:completed": {
        const task = data.task as {
          skillId?: string;
          title?: string;
          result?: unknown;
        };
        const phase = this.mapSkillToPhase(task?.skillId || "");
        const mappedPhase = this.mapOrchestratorPhase(phase);
        const agent = this.mapPhaseToAgent(mappedPhase);
        const agentName = this.getAgentName(agent);
        const duration = (data.duration as number) || 0;

        this.logger.log(
          `[transformSlidesMissionEvent] ${event.type} for skill: ${task?.skillId}, has data.result: ${!!data.result}, has task.result: ${!!task?.result}`,
        );

        // ★ outline-planning 完成时，发送页面大纲给前端初始化 pages 数组
        if (
          task?.skillId === "slides-outline-planning" ||
          task?.skillId === "outline-planning"
        ) {
          const taskResult = data.result || task?.result;
          if (taskResult && typeof taskResult === "object") {
            const outlineResult = taskResult as {
              pages?: unknown[];
              title?: string;
            };
            if (outlineResult.pages && Array.isArray(outlineResult.pages)) {
              const pageOutlines = outlineResult.pages.map(
                (page: unknown, idx: number) => {
                  const p = page as {
                    pageNumber?: number;
                    title?: string;
                    templateType?: string;
                  };
                  return {
                    pageNumber: p.pageNumber || idx + 1,
                    title: p.title || `第 ${idx + 1} 页`,
                    templateType: p.templateType || "content",
                  };
                },
              );
              // 构建详细的页面列表字符串
              const pageListStr = pageOutlines
                .map(
                  (p) =>
                    `${p.pageNumber}. ${p.title}${p.templateType !== "content" ? ` [${p.templateType}]` : ""}`,
                )
                .join("\n");
              const shortSummary = pageOutlines
                .slice(0, 3)
                .map((p) => p.title)
                .join("、");

              this.logger.log(
                `[transformSlidesMissionEvent] ★ OUTLINE-PLANNING DETECTED! Sending ${pageOutlines.length} pageOutlines to frontend`,
              );

              // Strategist 完成 - 包含完整页面列表
              events.push(
                this.createEvent("agent:completed", sessionId, {
                  agent: "strategist",
                  agentName: "Visual Strategist",
                  result: `大纲规划完成，共 ${pageOutlines.length} 页：\n${pageListStr}`,
                  duration,
                  // 附加结构化数据供前端使用
                  pageOutlines,
                }),
              );

              events.push(
                this.createEvent("phase:completed", sessionId, {
                  phase: "planning",
                  duration,
                  result: {
                    totalPages: pageOutlines.length,
                    pageOutlines,
                  },
                }),
              );

              // 发送 Handoff 到 Writer - 包含简要信息
              events.push(
                this.createEvent("agent:handoff", sessionId, {
                  fromAgent: "strategist",
                  toAgent: "writer",
                  message: `大纲已规划完成：${shortSummary}${pageOutlines.length > 3 ? "..." : ""}，共 ${pageOutlines.length} 页`,
                }),
              );

              // Writer 思考 - 显示将要生成的页面
              const firstPages = pageOutlines
                .slice(0, 2)
                .map((p) => p.title)
                .join("、");
              events.push(
                this.createEvent("agent:thinking", sessionId, {
                  agent: "writer",
                  agentName: "Content Writer",
                  thought: `收到大纲，将依次生成：${firstPages}${pageOutlines.length > 2 ? `... 等 ${pageOutlines.length} 页` : ""}`,
                }),
              );
            }
          }
        } else {
          // 其他任务的通用完成事件
          events.push(
            this.createEvent("agent:completed", sessionId, {
              agent,
              agentName,
              result: `${task?.title || this.getPhaseDescription(mappedPhase)} 完成`,
              duration,
            }),
          );
        }

        // ★ page-pipeline 任务完成时提取 HTML
        if (
          task?.skillId === "slides-page-pipeline" ||
          task?.skillId === "page-pipeline"
        ) {
          const taskResult = data.result || task?.result;
          this.logger.log(
            `[transformSlidesMissionEvent] ★ PAGE-PIPELINE DETECTED! Extracting pages...`,
          );
          this.logger.log(
            `[transformSlidesMissionEvent] taskResult type: ${typeof taskResult}, isNull: ${taskResult === null}, keys: ${taskResult && typeof taskResult === "object" ? Object.keys(taskResult).join(",") : "N/A"}`,
          );
          const beforeCount = events.length;
          this.extractPagesFromTaskResult(taskResult, sessionId, events);
          const afterCount = events.length;
          this.logger.log(
            `[transformSlidesMissionEvent] ★ Extracted ${afterCount - beforeCount} slide:generated events`,
          );
        } else {
          this.logger.debug(
            `[transformSlidesMissionEvent] Skipping non-page-pipeline task: ${task?.skillId}`,
          );
        }
        break;
      }

      case "task:failed": {
        const task = data.task as { skillId?: string; title?: string };
        const error = data.error as string;
        this.logger.warn(
          `[transformSlidesMissionEvent] task:failed: ${task?.title} - ${error}`,
        );
        break;
      }

      case "mission:phase_changed": {
        const phase = data.phase as string;
        const mappedPhase = this.mapOrchestratorPhase(phase);
        const agent = this.mapPhaseToAgent(mappedPhase);
        const agentName = this.getAgentName(agent);

        events.push(
          this.createEvent("phase:started", sessionId, {
            phase: mappedPhase,
            agent,
            description: this.getPhaseDescription(mappedPhase),
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent,
            agentName,
            task: this.getPhaseDescription(mappedPhase),
            progress: 0,
          }),
        );
        break;
      }

      case "review:started": {
        const task = data.task as { title?: string; skillId?: string };
        // Reviewer 思考
        events.push(
          this.createEvent("agent:thinking", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            thought: `开始审核「${task?.title || "任务输出"}」，检查内容质量、格式规范和一致性...`,
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            task: `审核中：${task?.title || "任务输出"}`,
            progress: 0,
          }),
        );
        break;
      }

      case "review:approved": {
        const task = data.task as { title?: string };
        const score = (data.score as number) || 0;
        events.push(
          this.createEvent("review:scoring", sessionId, {
            phase: "task_review",
            agent: "reviewer",
            score,
            threshold: 70,
            passed: true,
            dimensions: [],
            summary: `✓ 审核通过：${task?.title}`,
          }),
        );
        events.push(
          this.createEvent("agent:completed", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            result: `✓ 审核通过：${task?.title}（${score > 0 ? `${score}分` : "符合标准"}）`,
            duration: (data.duration as number) || 0,
          }),
        );
        break;
      }

      case "review:revision_requested": {
        const task = data.task as { title?: string };
        const feedback = (data.feedback as string) || "";
        const score = (data.score as number) || 0;
        events.push(
          this.createEvent("review:rejected", sessionId, {
            phase: "task_review",
            attempt: (data.attempt as number) || 1,
            score,
            threshold: 70,
            feedback,
            willRetry: true,
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            task: `需要修改：${task?.title}${feedback ? `（${feedback}）` : ""}`,
            progress: 0,
          }),
        );
        break;
      }

      case "audit:started": {
        // 发送 Handoff 从 Writer 到 Reviewer
        events.push(
          this.createEvent("agent:handoff", sessionId, {
            fromAgent: "writer",
            toAgent: "reviewer",
            message: "页面生成完成，交接给审核员进行质量检查",
          }),
        );

        // Reviewer 思考
        events.push(
          this.createEvent("agent:thinking", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            thought:
              "开始全面审核所有页面，检查内容准确性、视觉一致性、术语统一性...",
          }),
        );

        events.push(
          this.createEvent("phase:started", sessionId, {
            phase: "reviewing",
            agent: "reviewer",
            description: "正在进行质量审计...",
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            task: "全面审核：内容准确性、视觉一致性、术语统一性",
            progress: 0,
          }),
        );
        break;
      }

      case "audit:completed": {
        const qualityAudit = data.qualityAudit as {
          overallScore?: number;
          dimensions?: Array<{
            name: string;
            score: number;
            weight?: number;
          }>;
          issues?: Array<{ type: string; message: string }>;
          fixes?: Array<{ type: string; description: string }>;
        };
        const score = qualityAudit?.overallScore || 0;
        const issueCount = qualityAudit?.issues?.length || 0;
        const fixCount = qualityAudit?.fixes?.length || 0;

        // 发送评分事件
        events.push(
          this.createEvent("review:scoring", sessionId, {
            phase: "quality_audit",
            agent: "reviewer",
            score,
            threshold: 70,
            passed: score >= 70,
            dimensions:
              qualityAudit?.dimensions?.map((d) => ({
                name: d.name,
                score: d.score,
                weight: d.weight || 1,
              })) || [],
            summary: `质量审计完成：${score}分${issueCount > 0 ? `，发现 ${issueCount} 个问题` : ""}${fixCount > 0 ? `，自动修复 ${fixCount} 个` : ""}`,
          }),
        );

        // 发送问题事件
        if (qualityAudit?.issues) {
          for (const issue of qualityAudit.issues) {
            events.push(
              this.createEvent("review:issue_found", sessionId, {
                pageNumber: 0,
                severity: "warning" as const,
                type: issue.type,
                message: issue.message,
              }),
            );
          }
        }

        // 发送修复事件
        if (qualityAudit?.fixes) {
          for (const fix of qualityAudit.fixes) {
            events.push(
              this.createEvent("review:auto_fixed", sessionId, {
                pageNumber: 0,
                issueType: fix.type,
                fixDescription: fix.description,
              }),
            );
          }
        }

        events.push(
          this.createEvent("agent:completed", sessionId, {
            agent: "reviewer",
            agentName: "Quality Reviewer",
            result: `质量审计完成：${score}分${issueCount > 0 ? `，${issueCount} 个问题` : ""}${fixCount > 0 ? `，${fixCount} 个已修复` : ""}`,
            duration: (data.duration as number) || 0,
          }),
        );
        events.push(
          this.createEvent("phase:completed", sessionId, {
            phase: "reviewing",
            duration: (data.duration as number) || 0,
            result: qualityAudit,
          }),
        );
        break;
      }

      case "synthesis:started":
        events.push(
          this.createEvent("phase:started", sessionId, {
            phase: "generating", // ★ 修复：前端期望 generating 而非 rendering
            agent: "writer",
            description: "正在生成页面内容...",
          }),
        );
        events.push(
          this.createEvent("agent:working", sessionId, {
            agent: "writer",
            agentName: "Content Writer",
            task: "正在综合生成页面...",
            progress: 0,
          }),
        );
        break;

      case "synthesis:completed": {
        const pageCount = (data.pageCount as number) || 0;
        events.push(
          this.createEvent("agent:completed", sessionId, {
            agent: "writer",
            agentName: "Content Writer",
            result: `页面综合完成，共 ${pageCount} 页`,
            duration: 0,
          }),
        );
        events.push(
          this.createEvent("phase:completed", sessionId, {
            phase: "rendering",
            duration: 0,
            result: { pageCount },
          }),
        );
        break;
      }

      case "page:generated": {
        const pageIndex = (data.pageIndex as number) || 0;
        const page = data.page as {
          html?: string;
          renderedHtml?: string;
          spec?: { title?: string };
        };
        const html = page?.renderedHtml || page?.html;

        if (html) {
          events.push(
            this.createEvent("slide:generated", sessionId, {
              pageNumber: pageIndex + 1,
              title: page?.spec?.title || `第 ${pageIndex + 1} 页`,
              contentLength: html.length,
              html,
            }),
          );
          this.logger.log(
            `[transformSlidesMissionEvent] Emitted slide:generated for page ${pageIndex + 1}`,
          );
        }
        break;
      }

      case "mission:completed": {
        const duration = (data.duration as number) || 0;
        const pages = (data.pages as unknown[]) || [];

        // 发送 leader 完成事件
        events.push(
          this.createEvent("agent:completed", sessionId, {
            agent: "leader",
            agentName: "Slides Architect",
            result: `PPT 生成完成！共 ${pages.length} 页`,
            duration,
          }),
        );
        this.logger.debug(
          `[transformSlidesMissionEvent] mission:completed received`,
        );
        break;
      }

      case "mission:failed": {
        const error = (data.error as string) || "Unknown error";
        events.push(
          this.createEvent("execution:failed", sessionId, {
            error,
            phase: (data.phase as string) || "unknown",
            recoverable: false,
          }),
        );
        break;
      }

      default:
        // 其他事件类型，记录日志
        this.logger.debug(
          `[transformSlidesMissionEvent] Unhandled event type: ${event.type}`,
        );
        break;
    }

    return events;
  }

  /**
   * 从任务结果中提取 HTML 页面
   */
  private extractPagesFromTaskResult(
    result: unknown,
    sessionId: string,
    events: StreamEvent[],
  ): void {
    this.logger.log(
      `[extractPagesFromTaskResult] Called with result type: ${typeof result}, isNull: ${result === null}`,
    );

    if (!result || typeof result !== "object") {
      this.logger.warn(
        `[extractPagesFromTaskResult] Result is null/undefined or not object`,
      );
      return;
    }

    const resultObj = result as Record<string, unknown>;
    this.logger.log(
      `[extractPagesFromTaskResult] Result keys: ${Object.keys(resultObj).join(", ")}`,
    );

    // 情况 1: 直接包含 html
    if (resultObj.html && typeof resultObj.html === "string") {
      const pageNumber = (resultObj.pageNumber as number) || 1;
      events.push(
        this.createEvent("slide:generated", sessionId, {
          pageNumber,
          title: (resultObj.title as string) || `第 ${pageNumber} 页`,
          contentLength: resultObj.html.length,
          html: resultObj.html,
        }),
      );
      this.logger.log(
        `[extractPagesFromTaskResult] Emitted slide:generated for page ${pageNumber}`,
      );
    }

    // 情况 2: 包含 pages 数组
    const pages = resultObj.pages as unknown[];
    this.logger.log(
      `[extractPagesFromTaskResult] pages exists: ${!!pages}, isArray: ${Array.isArray(pages)}, length: ${pages?.length || 0}`,
    );

    if (pages && Array.isArray(pages)) {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const p = page as {
          html?: string;
          renderedHtml?: string;
          pageNumber?: number;
          title?: string;
          status?: string;
        };
        const html = p.renderedHtml || p.html;
        this.logger.log(
          `[extractPagesFromTaskResult] Page ${i}: status=${p.status}, htmlLength=${html?.length || 0}, title=${p.title}`,
        );

        if (html) {
          const pageNumber = p.pageNumber || i + 1;
          events.push(
            this.createEvent("slide:generated", sessionId, {
              pageNumber,
              title: p.title || `第 ${pageNumber} 页`,
              contentLength: html.length,
              html,
            }),
          );
          this.logger.log(
            `[extractPagesFromTaskResult] ✓ Emitted slide:generated for page ${pageNumber}`,
          );
        } else {
          this.logger.warn(
            `[extractPagesFromTaskResult] ✗ Page ${i} has no HTML content!`,
          );
        }
      }
    } else {
      this.logger.warn(
        `[extractPagesFromTaskResult] No valid pages array in result`,
      );
    }
  }

  /**
   * 将 Skill ID 映射到 phase
   */
  private mapSkillToPhase(skillId: string): string {
    const mapping: Record<string, string> = {
      "task-decomposition": "analyzing",
      "slides-task-decomposition": "analyzing",
      "outline-planning": "planning",
      "slides-outline-planning": "planning",
      "four-step-design": "rendering",
      "slides-four-step-design": "rendering",
      "template-rendering": "rendering",
      "slides-template-rendering": "rendering",
      "page-pipeline": "rendering",
      "slides-page-pipeline": "rendering",
      "quality-audit": "reviewing",
      "slides-quality-audit": "reviewing",
      "terminology-unifier": "reviewing",
      "slides-terminology-unifier": "reviewing",
      "transition-checker": "reviewing",
      "slides-transition-checker": "reviewing",
    };
    return mapping[skillId] || "rendering";
  }

  /**
   * 将 Orchestrator 阶段映射到前端阶段
   * ★ 注意：前端 PhaseTimeline 只支持 analyzing, planning, generating, reviewing
   */
  private mapOrchestratorPhase(phase: string): string {
    const mapping: Record<string, string> = {
      planning: "planning",
      executing: "generating", // ★ 修复：前端期望 generating 而非 rendering
      rendering: "generating", // ★ 修复：确保兼容性
      reviewing: "reviewing",
      auditing: "reviewing",
      synthesizing: "generating", // ★ 修复：前端期望 generating
      completed: "completed",
      failed: "failed",
    };
    return mapping[phase] || phase;
  }

  /**
   * 将 phase 映射到 agent role
   */
  private mapPhaseToAgent(
    phase: string,
  ): "leader" | "analyst" | "strategist" | "writer" | "reviewer" {
    const mapping: Record<
      string,
      "leader" | "analyst" | "strategist" | "writer" | "reviewer"
    > = {
      initializing: "leader",
      analyzing: "analyst",
      planning: "strategist",
      generating: "writer", // ★ 前端期望的阶段名
      content_filling: "writer", // 内容填充由 Writer 负责
      image_generation: "writer", // 图片生成由 Writer/Designer 负责
      rendering: "writer", // 渲染由 Writer 负责（兼容旧代码）
      reviewing: "reviewer",
      completed: "leader",
    };
    return mapping[phase] || "leader";
  }

  /**
   * 获取 phase 描述
   */
  private getPhaseDescription(phase: string): string {
    const descriptions: Record<string, string> = {
      initializing: "正在初始化 AI 团队...",
      analyzing: "正在分析内容结构...",
      planning: "正在规划 PPT 大纲...",
      generating: "正在生成页面内容...", // ★ 前端期望的阶段名
      content_filling: "正在填充页面内容...",
      image_generation: "正在生成配图...",
      rendering: "正在渲染页面 HTML...", // 兼容旧代码
      reviewing: "正在进行质量检查...",
      completed: "生成完成！",
    };
    return descriptions[phase] || `正在执行 ${phase}...`;
  }

  /**
   * 获取 agent 名称
   */
  private getAgentName(
    agent: "leader" | "analyst" | "strategist" | "writer" | "reviewer",
  ): string {
    const names: Record<string, string> = {
      leader: "Slides Architect",
      analyst: "Content Analyst",
      strategist: "Visual Strategist",
      writer: "Content Writer",
      reviewer: "Quality Reviewer",
    };
    return names[agent] || agent;
  }

  /**
   * 创建流式事件
   * 使用前端期望的 SlidesTeamEvent 格式
   */
  private createEvent(
    type: StreamEventType,
    executionId: string,
    data: unknown = {},
  ): StreamEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      executionId,
      data,
    };
  }

  /**
   * 判断是否为需要保存检查点的阶段
   */
  private isCheckpointPhase(phase: string): boolean {
    const checkpointPhases = [
      // 新格式阶段
      "analyzing",
      "planning",
      "generating",
      "synthesis",
      "reviewing",
      "auditing",
      // 兼容旧格式
      "task-decomposition",
      "outline-planning",
      "page-rendering",
      "batch-review",
      "finalize",
    ];
    return checkpointPhases.includes(phase);
  }

  /**
   * 保存检查点
   */
  private async saveCheckpoint(
    sessionId: string,
    stepId: string,
    data: unknown,
  ): Promise<void> {
    try {
      const checkpointType = this.stepIdToCheckpointType(stepId);
      await this.checkpointService.create({
        sessionId,
        type: checkpointType,
        state: {
          // 从 data 中提取状态
          ...(data as object),
        } as CheckpointState,
        metadata: {
          trigger: "auto",
          description: `Step: ${stepId}`,
        },
      });
      this.logger.debug(`[saveCheckpoint] Saved checkpoint for ${stepId}`);
    } catch (error) {
      this.logger.warn(`[saveCheckpoint] Failed to save checkpoint: ${error}`);
    }
  }

  /**
   * 从 mission:completed 事件数据保存最终检查点
   * ★ 关键修复：确保保存完整的页面数据（包括 HTML 和 design）
   */
  private async saveFinalCheckpointFromEvent(
    sessionId: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    try {
      const pages = (eventData.pages as unknown[]) || [];
      const duration = (eventData.duration as number) || 0;

      // ★ 诊断日志
      this.logger.log(
        `[saveFinalCheckpointFromEvent] ★ Event data keys: ${Object.keys(eventData).join(", ")}`,
      );
      this.logger.log(
        `[saveFinalCheckpointFromEvent] ★ Pages from event: ${pages.length}, pages type: ${typeof eventData.pages}`,
      );

      // ★ 关键修复：验证并规范化每个页面的数据
      const pagesWithHtml = pages.filter((p: unknown) => {
        const page = p as { html?: string; renderedHtml?: string };
        return page.html || page.renderedHtml;
      });
      this.logger.log(
        `[saveFinalCheckpointFromEvent] ★ Pages with HTML: ${pagesWithHtml.length}/${pages.length}`,
      );

      // ★ 规范化页面数据，确保 html 字段存在
      const normalizedPages = pages.map((page: unknown) => {
        const p = page as {
          html?: string;
          renderedHtml?: string;
          pageNumber?: number;
          title?: string;
          status?: string;
          design?: unknown;
          outline?: unknown;
        };
        const html = p.html || p.renderedHtml;
        return {
          ...p,
          html, // 确保 html 字段存在
          status: html ? "completed" : p.status || "pending",
        };
      });

      // ★ 诊断：打印每个页面的关键信息
      normalizedPages.forEach((p, i) => {
        this.logger.log(
          `[saveFinalCheckpointFromEvent]   Page ${i + 1}: htmlLength=${(p.html as string)?.length || 0}, hasDesign=${!!p.design}, status=${p.status}`,
        );
      });

      await this.checkpointService.create({
        sessionId,
        type: "batch_rendered",
        name: "自动保存点 - 生成完成", // ★ 添加明确名称
        state: {
          pages: normalizedPages, // ★ 使用规范化后的 pages
          outlinePlan: eventData.outline || eventData.outlinePlan,
          taskDecomposition: eventData.taskDecomposition,
          qualityAudit: eventData.qualityAudit,
          conversation: [],
        } as unknown as CheckpointState,
        metadata: {
          trigger: "auto",
          description: `任务完成 - 自动保存 (共 ${normalizedPages.length} 页，${pagesWithHtml.length} 页已渲染)`,
          durationMs: duration,
        },
      });

      // ★ 更新会话状态为已完成
      try {
        await this.checkpointService.updateSessionStatus(
          sessionId,
          "completed",
        );
        this.logger.log(
          `[saveFinalCheckpointFromEvent] ★ Updated session ${sessionId} status to completed`,
        );
      } catch (statusError) {
        this.logger.warn(
          `[saveFinalCheckpointFromEvent] Failed to update session status: ${statusError}`,
        );
      }

      this.logger.log(
        `[saveFinalCheckpointFromEvent] ★ Saved final checkpoint with ${normalizedPages.length} pages (${pagesWithHtml.length} with HTML) for session ${sessionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[saveFinalCheckpointFromEvent] Failed to save final checkpoint: ${error}`,
      );
    }
  }

  private emitKernelLifecycle(
    entityId: string,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(entityId);
    if (!processId || !this.eventBus) return;
    this.eventBus.emit({
      type: event,
      payload: { processId, module: "slides", ...data },
      metadata: { timestamp: new Date(), source: "slides" },
    });
  }

  private completeKernelProcess(
    sessionId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(sessionId);
    if (!processId || !this.missionExecutor) return;
    this.emitKernelLifecycle(sessionId, "kernel:mission.complete", output);
    void this.missionExecutor
      .complete(processId, output)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(sessionId);
  }

  private failKernelProcess(sessionId: string, error: string): void {
    const processId = this.kernelProcessIds.get(sessionId);
    if (!processId || !this.missionExecutor) return;
    this.emitKernelLifecycle(sessionId, "kernel:mission.failed", { error });
    void this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to mark process as failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(sessionId);
  }

  /**
   * 将步骤 ID 转换为检查点类型
   */
  private stepIdToCheckpointType(
    stepId: string,
  ):
    | "task_decomposition"
    | "outline_confirmed"
    | "page_rendered"
    | "batch_rendered" {
    switch (stepId) {
      // 新格式阶段
      case "analyzing":
        return "task_decomposition";
      case "planning":
        return "outline_confirmed";
      case "generating":
      case "synthesis":
        return "page_rendered";
      case "reviewing":
      case "auditing":
        return "batch_rendered";
      // 兼容旧格式
      case "task-decomposition":
        return "task_decomposition";
      case "outline-planning":
        return "outline_confirmed";
      case "page-rendering":
        return "page_rendered";
      case "batch-review":
      case "finalize":
        return "batch_rendered";
      default:
        return "page_rendered";
    }
  }
}
