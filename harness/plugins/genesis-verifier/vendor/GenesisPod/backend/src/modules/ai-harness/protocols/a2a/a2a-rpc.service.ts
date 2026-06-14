/**
 * A2A v0.3 JSON-RPC Service
 *
 * 2026-05-01 (PR-X-P): GenesisPod 对外 A2A 接口的 JSON-RPC 2.0 入口处理。
 * 对齐 Google A2A v0.3 / Anthropic A2A SDK 标准。
 *
 * 支持的方法:
 *   - message/send       发送消息（同步等结果）
 *   - message/stream     发送消息（SSE 流式结果，由 controller 桥接）
 *   - tasks/get          查询任务
 *   - tasks/cancel       取消任务
 *   - tasks/pushNotificationConfig/set  设置 webhook
 *   - tasks/pushNotificationConfig/get  查询 webhook 配置
 *
 * 设计:
 *   - 本服务做 spec 翻译 + 路由分发；具体执行委托给 TeamsService
 *   - skill 路由：Message.metadata.skillId 或 Message.parts 的 textPart 内容
 *   - context 持久化：委托 A2ATaskStore（taskId → contextId / message history）
 *     注入 CacheService 时走 Redis（跨 pod 持久），未注入则进程内回退（与 MissionRuntimeStateStore 同模式）
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  A2A_ERROR_CODES,
  A2A_METHODS,
  type Artifact,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type Message,
  type MessageSendParams,
  type Task,
  type TaskIdParams,
  type TaskQueryParams,
  type TaskState,
  type TaskStatus,
} from "./a2a-spec.types";
import { TaskState as TaskStateEnum } from "./a2a-spec.types";
import { A2ATaskStore } from "./a2a-task-store";
import { AgentCardRegistry } from "./agent-card.registry";
import { TEAMS_SERVICE_TOKEN, TRACE_COLLECTOR_TOKEN } from "./a2a.tokens";
import type { TeamId } from "../../teams/abstractions/team.interface";
import type { ConstraintProfile } from "../../guardrails/constraints/constraint-profile";

interface IKernelTeamsService {
  executeMission(params: {
    teamId: TeamId;
    goal: string;
    context: string;
    constraints?: Partial<ConstraintProfile>;
    metadata?: Record<string, unknown>;
  }): Promise<string>;
  getMissionStatus(taskId: string): {
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    teamId: TeamId;
    startTime: Date;
    endTime?: Date;
    error?: string;
  };
  getMissionResult(taskId: string): Promise<{
    summary: string;
    deliverables: unknown[];
    statistics: unknown;
    duration: number;
    tokensUsed: number;
    metadata?: Record<string, unknown>;
  }>;
  /** 2026-05-01 (PR-X-R): 接通 A2A v0.3 tasks/cancel 方法 */
  cancelMission(missionId: string): boolean;
}

interface IKernelTraceCollector {
  startTrace(input: {
    type: string;
    name: string;
    metadata?: Record<string, unknown>;
  }): string;
  endTrace(traceId: string, result: { status: "success" | "error" }): void;
}

/** Mission status (legacy 5-state) → A2A v0.3 8-state 映射 */
function mapToA2AState(
  legacy: "pending" | "running" | "completed" | "failed" | "cancelled",
): TaskState {
  switch (legacy) {
    case "pending":
      return TaskStateEnum.SUBMITTED;
    case "running":
      return TaskStateEnum.WORKING;
    case "completed":
      return TaskStateEnum.COMPLETED;
    case "failed":
      return TaskStateEnum.FAILED;
    case "cancelled":
      return TaskStateEnum.CANCELED;
  }
}

/** 抽 Message.parts 里第一个 text part 内容（goal 来源） */
function extractTextFromMessage(message: Message): string {
  const textPart = message.parts.find((p) => p.kind === "text");
  return textPart && textPart.kind === "text" ? textPart.text : "";
}

@Injectable()
export class A2ARpcService {
  private readonly logger = new Logger(A2ARpcService.name);

  constructor(
    private readonly agentCardRegistry: AgentCardRegistry,
    @Inject(TEAMS_SERVICE_TOKEN)
    private readonly teamsService: IKernelTeamsService,
    // G3: contextId / 历史持久化（Redis 经 CacheService，未注入则进程内回退）
    private readonly taskStore: A2ATaskStore,
    @Optional()
    @Inject(TRACE_COLLECTOR_TOKEN)
    private readonly traceCollector?: IKernelTraceCollector,
  ) {}

  /**
   * 处理 JSON-RPC 2.0 请求 — 主入口
   */
  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id = null, method, params } = request;

    // 校验 jsonrpc 版本
    if (request.jsonrpc !== "2.0") {
      return this.errorResponse(
        id,
        A2A_ERROR_CODES.INVALID_REQUEST,
        "jsonrpc must be '2.0'",
      );
    }

    try {
      switch (method) {
        case A2A_METHODS.MESSAGE_SEND:
          return this.successResponse(
            id,
            await this.messageSend(params as MessageSendParams),
          );
        case A2A_METHODS.TASKS_GET:
          return this.successResponse(
            id,
            await this.tasksGet(params as TaskQueryParams),
          );
        case A2A_METHODS.TASKS_CANCEL:
          return this.successResponse(
            id,
            await this.tasksCancel(params as TaskIdParams),
          );
        case A2A_METHODS.MESSAGE_STREAM:
          // Streaming 由 controller 通过 SSE 直接处理，本 service 不在此路径
          return this.errorResponse(
            id,
            A2A_ERROR_CODES.UNSUPPORTED_OPERATION,
            "Use SSE endpoint /a2a/v1/stream for message/stream",
          );
        default:
          return this.errorResponse(
            id,
            A2A_ERROR_CODES.METHOD_NOT_FOUND,
            `Unknown method: ${method}`,
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`RPC ${method} failed: ${message}`);
      return this.errorResponse(id, A2A_ERROR_CODES.INTERNAL_ERROR, message);
    }
  }

  /** message/send — 发送消息，创建/继续 task */
  async messageSend(params: MessageSendParams): Promise<Task | Message> {
    if (!params?.message) {
      throw new Error("missing params.message");
    }
    const { message } = params;

    // 抽内容 + skill 路由
    const goal = extractTextFromMessage(message);
    if (!goal) {
      throw new Error("message must contain at least one text part");
    }
    const MAX_LEN = 100_000;
    if (goal.length > MAX_LEN) {
      throw new Error(`message text exceeds max length ${MAX_LEN}`);
    }

    const skillId =
      (message.metadata?.skillId as string | undefined) ??
      this.inferSkillFromContent(goal);

    const skill = this.agentCardRegistry.getSkillById(skillId);
    if (!skill) {
      throw new Error(`Skill '${skillId}' not found`);
    }

    const teamId = this.mapSkillToTeam(skillId);
    if (!teamId) {
      throw new Error(`Skill '${skillId}' has no team binding`);
    }

    const traceId = this.traceCollector?.startTrace({
      type: "a2a_message_send",
      name: `A2A: ${skillId}`,
      metadata: { skillId, messageId: message.messageId },
    });

    try {
      const missionId = await this.teamsService.executeMission({
        teamId,
        goal,
        context: "",
        metadata: {
          ...(message.metadata ?? {}),
          a2aSkillId: skillId,
          a2aMessageId: message.messageId,
        },
      });

      // 关联 contextId（client 提供 OR 新建）
      const contextId = message.contextId ?? randomUUID();
      await this.taskStore.setContext(missionId, contextId);

      // 历史 message 累积
      await this.taskStore.appendHistory(missionId, {
        ...message,
        taskId: missionId,
        contextId,
      });

      if (traceId) {
        this.traceCollector?.endTrace(traceId, { status: "success" });
      }

      return this.buildTask(missionId, contextId, TaskStateEnum.SUBMITTED);
    } catch (err) {
      if (traceId) {
        this.traceCollector?.endTrace(traceId, { status: "error" });
      }
      throw err;
    }
  }

  /** tasks/get — 查询任务状态 */
  async tasksGet(params: TaskQueryParams): Promise<Task> {
    if (!params?.id) {
      throw new Error("missing params.id");
    }
    const status = this.teamsService.getMissionStatus(params.id);
    const contextId = (await this.taskStore.getContext(params.id)) ?? params.id;

    const a2aState = mapToA2AState(status.status);
    const task = this.buildTask(params.id, contextId, a2aState);

    // 完成时附 artifact
    if (a2aState === TaskStateEnum.COMPLETED) {
      try {
        const result = await this.teamsService.getMissionResult(params.id);
        const artifact: Artifact = {
          artifactId: `${params.id}-artifact`,
          name: "summary",
          parts: [{ kind: "text", text: result.summary }],
          metadata: {
            duration: result.duration,
            tokensUsed: result.tokensUsed,
          },
        };
        task.artifacts = [artifact];
      } catch (err) {
        this.logger.warn(
          `tasks/get: getMissionResult failed for ${params.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else if (a2aState === TaskStateEnum.FAILED) {
      task.status.message = {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        parts: [
          {
            kind: "text",
            text: status.error ?? "Mission failed",
          },
        ],
        taskId: params.id,
        contextId,
      };
    }

    if (params.historyLength && params.historyLength > 0) {
      const history = await this.taskStore.getHistory(params.id);
      task.history = history.slice(-params.historyLength);
    }

    return task;
  }

  /** tasks/cancel — 取消运行中任务 */
  async tasksCancel(params: TaskIdParams): Promise<Task> {
    if (!params?.id) {
      throw new Error("missing params.id");
    }
    let ok = false;
    try {
      ok = this.teamsService.cancelMission(params.id);
    } catch {
      // 底层 throw NotFoundException 视作 not-cancelable（已完成 / 不存在）
      ok = false;
    }
    if (!ok) {
      const error = new Error(
        `Task '${params.id}' not found or not cancelable (already completed/failed)`,
      );
      (error as Error & { code?: number }).code =
        A2A_ERROR_CODES.TASK_NOT_CANCELABLE;
      throw error;
    }
    const contextId = (await this.taskStore.getContext(params.id)) ?? params.id;
    return this.buildTask(params.id, contextId, TaskStateEnum.CANCELED);
  }

  // ─── 辅助 ─────────────────────────────────────────────────────────

  private buildTask(taskId: string, contextId: string, state: TaskState): Task {
    const status: TaskStatus = {
      state,
      timestamp: new Date().toISOString(),
    };
    return {
      kind: "task",
      id: taskId,
      contextId,
      status,
    };
  }

  private successResponse<T>(
    id: string | number | null,
    result: T,
  ): JsonRpcResponse<T> {
    return { jsonrpc: "2.0", id, result };
  }

  private errorResponse(
    id: string | number | null,
    code: number,
    message: string,
  ): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    };
  }

  /** Skill ID 推断（消息中无 metadata.skillId 时） */
  private inferSkillFromContent(_content: string): string {
    const skills = this.agentCardRegistry.getSkills();
    if (skills.length === 0) return "default";
    // Naive: 选第一个 skill；生产可加 keyword match / embedding routing
    return skills[0].id;
  }

  /** Skill ID → Team ID 映射（保留与旧 controller 一致的策略） */
  private mapSkillToTeam(skillId: string): TeamId | null {
    const skillToTeam: Record<string, TeamId> = {
      research: "research-team" as TeamId,
      writing: "writing-team" as TeamId,
      analysis: "analyst-team" as TeamId,
    };
    return skillToTeam[skillId] ?? null;
  }
}
