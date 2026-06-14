/**
 * Harness API Service
 * Unified admin-oriented entry point for AI Harness capabilities.
 * Aggregates process management, memory, resources, and event journal.
 */
import { Injectable } from "@nestjs/common";
import { ProcessManagerService } from "../../lifecycle/manager/process-manager.service";
import { EventJournalService } from "../../protocols/journal/event-journal.service";
import { WorkingMemoryManagerService } from "../../memory/working/working-memory-manager.service";
import { ResourceManagerService } from "../../guardrails/resources/resource-manager.service";
import { MissionExecutorService } from "../../lifecycle/manager/mission-executor.service";
import { EntityHealthRegistry } from "../../../ai-engine/reliability/entity-health/entity-health.registry";
import { EventBusService } from "../../protocols/ipc/event-bus.service";
import { MessageBusService } from "../../protocols/ipc/message-bus.service";
import { ProgressTrackerService } from "../../protocols/ipc/progress-tracker.service";
import { AiObservabilityService } from "../../tracing/observability/ai-observability.service";
import { CostAttributionService } from "../../tracing/observability/cost-attribution.service";
import { CapabilityGuardService } from "../../guardrails/capability";
import { KernelSchedulerService } from "../../runner/scheduler/kernel-scheduler.service";
import type {
  ProcessId,
  SpawnOptions,
  ProcessSnapshot,
  ResourceConsumption,
} from "../../lifecycle/manager/process.types";
import type {
  MemoryEntry,
  MemoryQuery as KernelMemoryQuery,
} from "../../lifecycle/manager/process.types";
import type { JournalEntry } from "../../lifecycle/manager/process.types";
import type {
  MissionExecuteOptions,
  MissionExecuteResult,
} from "../../lifecycle/manager/mission-executor.interface";
import { MemoryLayer, ProcessState } from "@prisma/client";

@Injectable()
export class HarnessApiService {
  constructor(
    private readonly processManager: ProcessManagerService,
    private readonly eventJournal: EventJournalService,
    private readonly memoryManager: WorkingMemoryManagerService,
    private readonly resourceManager: ResourceManagerService,
    private readonly missionExecutor: MissionExecutorService,
    private readonly circuitBreaker: EntityHealthRegistry,
    private readonly eventBus: EventBusService,
    private readonly messageBus: MessageBusService,
    private readonly progressTracker: ProgressTrackerService,
    private readonly kernelMetrics: AiObservabilityService,
    private readonly costAttribution: CostAttributionService,
    private readonly capabilityGuard: CapabilityGuardService,
    private readonly kernelScheduler: KernelSchedulerService,
  ) {}

  // â”€â”€â”€ Process Management â”€â”€â”€

  async spawn(options: SpawnOptions): Promise<ProcessSnapshot> {
    return this.processManager.spawn(options);
  }

  async getProcess(processId: ProcessId): Promise<ProcessSnapshot | null> {
    return this.processManager.getState(processId);
  }

  async listProcesses(
    userId: string,
    states?: ProcessState[],
  ): Promise<ProcessSnapshot[]> {
    return this.processManager.listByUser(userId, states);
  }

  async listAllProcesses(
    states?: ProcessState[],
    limit?: number,
  ): Promise<ProcessSnapshot[]> {
    return this.processManager.listAll(states, limit);
  }

  async pauseProcess(processId: ProcessId): Promise<ProcessSnapshot> {
    return this.processManager.pause(processId);
  }

  async resumeProcess(processId: ProcessId): Promise<ProcessSnapshot> {
    return this.processManager.resume(processId);
  }

  async cancelProcess(processId: ProcessId): Promise<ProcessSnapshot> {
    return this.processManager.cancel(processId);
  }

  // â”€â”€â”€ Mission â”€â”€â”€

  async executeMission(
    options: MissionExecuteOptions,
  ): Promise<MissionExecuteResult> {
    return this.missionExecutor.execute(options);
  }

  async completeMission(
    processId: ProcessId,
    output?: Record<string, unknown>,
  ): Promise<void> {
    return this.missionExecutor.complete(processId, output);
  }

  async failMission(processId: ProcessId, error: string): Promise<void> {
    return this.missionExecutor.fail(processId, error);
  }

  // â”€â”€â”€ Memory â”€â”€â”€

  async readMemory(
    processId: ProcessId,
    layer: MemoryLayer,
    key: string,
  ): Promise<unknown | null> {
    return this.memoryManager.read(processId, layer, key);
  }

  async writeMemory(entry: MemoryEntry): Promise<void> {
    return this.memoryManager.write(entry);
  }

  async queryMemory(query: KernelMemoryQuery): Promise<MemoryEntry[]> {
    return this.memoryManager.query(query);
  }

  // â”€â”€â”€ Resources â”€â”€â”€

  async checkBudget(
    processId: ProcessId,
  ): Promise<{ canProceed: boolean; reason?: string }> {
    return this.resourceManager.checkBudget(processId);
  }

  async consumeResources(
    processId: ProcessId,
    consumption: ResourceConsumption,
  ): Promise<void> {
    return this.resourceManager.consume(processId, consumption);
  }

  // â”€â”€â”€ Journal â”€â”€â”€

  async recordEvent(
    processId: ProcessId,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<JournalEntry> {
    return this.eventJournal.record(processId, type, payload);
  }

  async getEventHistory(
    processId: ProcessId,
    options?: { limit?: number; offset?: number },
  ): Promise<{ entries: JournalEntry[]; total: number }> {
    return this.eventJournal.getHistory(processId, options);
  }

  // â”€â”€â”€ Circuit Breaker â”€â”€â”€

  getCircuitBreakerMetrics() {
    return this.circuitBreaker.getAllHealthMetrics();
  }

  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  resetCircuitBreaker(entityId: string) {
    this.circuitBreaker.reset(entityId);
  }

  // â”€â”€â”€ IPC â”€â”€â”€

  getEventBusStats() {
    return { activeSubscriptions: this.eventBus.getActiveSubscriptionCount() };
  }

  getMessageBusHistory(sessionId: string) {
    return this.messageBus.getHistory(sessionId);
  }

  getActiveTasks() {
    return this.progressTracker.getActiveTasks();
  }

  getTaskProgress(taskId: string) {
    return this.progressTracker.getProgress(taskId);
  }

  // â”€â”€â”€ Observability â”€â”€â”€

  getDashboard(periodMinutes?: number) {
    return this.kernelMetrics.getDashboard(periodMinutes);
  }

  async getDashboardWithFallback(periodMinutes?: number) {
    return this.kernelMetrics.getDashboardWithFallback(periodMinutes);
  }

  getCostReport(options?: { periodHours?: number; userId?: string }) {
    return this.costAttribution.getCostReport(options);
  }

  getHourlyTrend(hours?: number) {
    return this.costAttribution.getHourlyTrend(hours);
  }

  checkBudgetAlerts() {
    return this.costAttribution.checkBudgetAlerts();
  }

  // â”€â”€â”€ Security â”€â”€â”€

  async getCapabilities(processId: ProcessId) {
    return this.capabilityGuard.getCapabilities(processId);
  }

  // â”€â”€â”€ Scheduler â”€â”€â”€

  async getSchedulerStats() {
    return this.kernelScheduler.getStats();
  }

  // â”€â”€â”€ Memory (admin) â”€â”€â”€

  async cleanupExpiredMemory(processId: ProcessId) {
    return this.memoryManager.cleanup(processId);
  }
}

/**
 * @deprecated Use HarnessApiService. Kept for one migration window so existing
 * open-api/admin consumers do not need a same-PR rename.
 */
export { HarnessApiService as KernelApiService };
