/**
 * AgentFacade — Domain Facade for Agent Execution, Tracing, and Intent Routing
 *
 * Responsibilities:
 * - Agent execution with retry and circuit breaker protection
 * - Observability: trace/span lifecycle management
 * - Memory coordinator: cross-layer store and recall
 * - Intent routing for Agent OS
 * - Realtime progress tracking and WebSocket event emission
 *
 * @Injectable — registered as a NestJS provider in facade.providers.ts
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { AgentSubFacade } from "../sub-facades/agent.sub-facade";
import type {
  OrchestrationFeature,
  ObservabilityFeature,
  RealtimeFeature,
  RegistryFeature,
} from "../facade.providers";
import {
  ORCHESTRATION_FEATURE,
  OBSERVABILITY_FEATURE,
  REALTIME_FEATURE,
  REGISTRY_FEATURE,
} from "../facade.providers";
import type { AgentExecutionRequest, AgentExecutionResult } from "../types";
import type {
  CreateTraceInput,
  CreateSpanInput,
  EndSpanInput,
  EndTraceInput,
} from "../../tracing/observability/trace.interface";
import type {
  MemoryEvent,
  MemoryQuery,
  MemoryContext,
} from "../../../ai-harness/memory/coordinator/memory-coordinator.service";
// IntentRouter 链路已删 (2026-04-30)
import type {
  RoomConfig,
  ProgressEvent,
} from "../../protocols/realtime/abstractions/event-emitter.interface";
import { EntityHealthRegistry } from "../../../ai-engine/reliability/entity-health/entity-health.registry";
import { AgentExecutorService } from "../../runner/executor/agent-executor.service";
// TaskDecomposerService 已删 (2026-04-30)
import { IntentDetectionService } from "../../../ai-engine/planning/intent/intent-detection.service";
import { ProcessSupervisorService as ExecutionStateManager } from "../../lifecycle/supervisor/process-supervisor.service";
import { OutputReviewerService } from "../../evaluation/critique/output-reviewer.service";
import { ContextEvolutionService } from "../../../ai-engine/knowledge/extraction/context-evolution.service";
import { PlanBasedAgentRegistry } from "../../agents/registry/plan-based-agent-registry";

@Injectable()
export class AgentFacade {
  private readonly logger = new Logger(AgentFacade.name);

  private readonly agentSub: AgentSubFacade;

  constructor(
    @Optional()
    @Inject(ORCHESTRATION_FEATURE)
    private readonly orchestration?: OrchestrationFeature,
    // INTELLIGENCE_FEATURE 不再注入（routeIntent 已删 2026-04-30）
    @Optional()
    @Inject(OBSERVABILITY_FEATURE)
    private readonly observability?: ObservabilityFeature,
    @Optional()
    @Inject(REALTIME_FEATURE)
    private readonly realtime?: RealtimeFeature,
    @Optional()
    @Inject(REGISTRY_FEATURE)
    private readonly registry?: RegistryFeature,
  ) {
    this.agentSub = new AgentSubFacade(orchestration);
  }

  // ==================== Agent Execution ====================

  async executeAgent(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult> {
    return this.agentSub.executeAgent(request);
  }

  isAgentAvailable(agentId: string): boolean {
    return this.agentSub.isAgentAvailable(agentId);
  }

  // ==================== Observability: Trace / Span ====================

  startTrace(input: CreateTraceInput): string | undefined {
    return this.observability?.traceCollector?.startTrace(input);
  }

  addSpan(traceId: string, input: CreateSpanInput): string | undefined {
    return this.observability?.traceCollector?.addSpan(traceId, input);
  }

  endSpan(spanId: string, input: EndSpanInput): void {
    this.observability?.traceCollector?.endSpan(spanId, input);
  }

  endTrace(traceId: string, input: EndTraceInput): void {
    this.observability?.traceCollector?.endTrace(traceId, input);
  }

  // ==================== Memory Coordinator ====================

  coordinatorStore(
    event: MemoryEvent,
    userId: string,
    sessionId?: string,
  ): Promise<void> | undefined {
    return this.observability?.memoryCoordinator?.store(
      event,
      userId,
      sessionId,
    );
  }

  coordinatorRecall(
    query: MemoryQuery,
    userId: string,
    sessionId?: string,
  ): Promise<MemoryContext> | undefined {
    return this.observability?.memoryCoordinator?.recall(
      query,
      userId,
      sessionId,
    );
  }

  // ==================== Realtime ====================

  getProgress(taskId: string): ProgressEvent | null {
    return this.realtime?.progressTracker?.getProgress(taskId) ?? null;
  }

  emitToRoom<T>(roomConfig: RoomConfig, eventType: string, payload: T): void {
    if (!this.realtime?.eventEmitter) {
      this.logger.warn("[emitToRoom] EventEmitter not available");
      return;
    }

    this.realtime.eventEmitter.emitToRoom(roomConfig, {
      type: eventType,
      payload,
      metadata: {
        timestamp: new Date(),
        source: "facade",
      },
    });
  }

  emitProgress(roomConfig: RoomConfig, progress: ProgressEvent): void {
    this.realtime?.eventEmitter?.emitProgress(roomConfig, progress);
  }

  setWebSocketServer(server: unknown): void {
    if (
      this.realtime?.eventEmitter &&
      typeof (
        this.realtime.eventEmitter as { setServer?: (s: unknown) => void }
      ).setServer === "function"
    ) {
      (
        this.realtime.eventEmitter as { setServer: (s: unknown) => void }
      ).setServer(server);
    }
  }

  get realtimeEmitter() {
    return this.realtime?.eventEmitter;
  }

  get realtimeProgress() {
    return this.realtime?.progressTracker;
  }

  // ==================== Orchestration Service Getters ====================

  /** EntityHealthRegistry for load control and health monitoring */
  get circuitBreaker(): EntityHealthRegistry | undefined {
    return this.orchestration?.circuitBreaker;
  }

  get agentExecutor(): AgentExecutorService | undefined {
    return this.orchestration?.agentExecutor;
  }

  // taskDecomposer getter 已删 (2026-04-30)

  get intentDetector(): IntentDetectionService | undefined {
    return this.orchestration?.intentDetector;
  }

  get execStateManager(): ExecutionStateManager | undefined {
    return this.orchestration?.execStateManager;
  }

  get outputReviewer(): OutputReviewerService | undefined {
    return this.orchestration?.outputReviewer;
  }

  get contextEvolution(): ContextEvolutionService | undefined {
    return this.orchestration?.contextEvolution;
  }

  // ==================== Registry Getters ====================

  get agentRegistry(): PlanBasedAgentRegistry | undefined {
    return this.registry?.agent;
  }
}
