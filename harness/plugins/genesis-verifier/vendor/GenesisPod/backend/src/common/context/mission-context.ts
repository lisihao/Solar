/**
 * Kernel Context — AsyncLocalStorage carrier for cross-cutting metadata.
 *
 * Similar to BillingContext, this lets AiChatService / AgentOrchestrator
 * pick up the surrounding agent-process / mission / latency-session
 * identifiers without each layer having to thread them as parameters.
 *
 * ★ 2026-05-11 hard-renamed `processId` → `agentProcessId` after the
 *   prod log flood incident: previously the field was named `processId`
 *   which read like a generic "current operation id", and 4+ callers
 *   stuffed missionId / sessionId in it. Downstream EventJournal then
 *   tried to insert into `process_events.process_id` (FK to
 *   `agent_processes.id`), and Postgres screamed 23503 at ERROR level
 *   on every LLM call. The field is now explicit about what it carries
 *   and is optional — leave it undefined when there's no real
 *   AgentProcess row.
 */
import { AsyncLocalStorage } from "async_hooks";

export interface MissionContextData {
  /**
   * Real `AgentProcess.id` (FK to `agent_processes` table). MUST come
   * from `MissionExecutor.execute(...)` or `ProcessManager.spawn(...)`.
   *
   * If your code path does NOT spawn a kernel-managed AgentProcess
   * (e.g. business-team / playground / topic-insights), leave
   * this undefined — EventJournal will then skip the journal write
   * instead of FK-failing.
   *
   * For mission/session-level identifiers that are not AgentProcess
   * rows, use `missionId` below.
   */
  agentProcessId?: string;
  userId?: string;
  agentId?: string;
  /** 活跃的时延跟踪会话 ID */
  latencySessionId?: string;
  /** 当前活跃的时延跟踪阶段 ID */
  latencyPhaseId?: string;
  /**
   * Mission / session identifier — any string. Not FK-bound. Used by
   * cross-cutting concerns (BaselineRecorder, MissionElectionTracker,
   * etc.) that need to scope by mission lifecycle regardless of
   * whether a kernel AgentProcess was spawned.
   */
  missionId?: string;
  /** 用于 fixture 分组的 topicId + depth 标签（topic-insights baseline 录制使用） */
  baselineTag?: string;
}

class MissionContextStore {
  private storage = new AsyncLocalStorage<MissionContextData>();

  run<T>(data: MissionContextData, fn: () => T): T {
    return this.storage.run(data, fn);
  }

  get(): MissionContextData | undefined {
    return this.storage.getStore();
  }

  getAgentProcessId(): string | undefined {
    return this.storage.getStore()?.agentProcessId;
  }

  getMissionId(): string | undefined {
    return this.storage.getStore()?.missionId;
  }

  getBaselineTag(): string | undefined {
    return this.storage.getStore()?.baselineTag;
  }
}

export const MissionContext = new MissionContextStore();
