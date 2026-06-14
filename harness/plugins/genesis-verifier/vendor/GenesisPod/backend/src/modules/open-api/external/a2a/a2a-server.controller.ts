/**
 * A2A Controller
 * Agent-to-Agent Protocol 端点实现
 *
 * Migrated from ai-harness/protocols/a2a/a2a.controller.ts (PR-X17).
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  HttpException,
  Optional,
  Inject,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "@/common/decorators/public.decorator";
import { A2AApiKeyGuard } from "../../../ai-harness/protocols/a2a/guards/a2a-api-key.guard";
import { AgentCardRegistry } from "../../../ai-harness/protocols/a2a/agent-card.registry";
import {
  A2AAgentCard,
  A2ATaskRequest,
  A2ATaskResponse,
  A2ATaskStatusResponse,
  A2ATaskStatus,
} from "../../../ai-harness/protocols/a2a/a2a.types";
import type { ConstraintProfile } from "../../../ai-harness/guardrails/constraints/constraint-profile";
import type { TeamId } from "../../../ai-harness/teams/abstractions/team.interface";
import {
  TEAMS_SERVICE_TOKEN,
  TRACE_COLLECTOR_TOKEN,
} from "../../../ai-harness/protocols/a2a/a2a.tokens";
import { LruMap } from "@/common/utils/lru-map";

/**
 * Minimal interface for the TeamsService operations used by A2AController.
 * Typed via DI token to avoid a direct import of the ai-engine class.
 */
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
}

/**
 * Minimal interface for the TraceCollector operations used by A2AController.
 * Typed via DI token to avoid a direct import of the ai-engine class.
 */
interface IKernelTraceCollector {
  startTrace(params: {
    type: string;
    name: string;
    metadata?: Record<string, unknown>;
  }): string;
  endTrace(traceId: string, result: { status: "success" | "error" }): void;
}

@ApiTags("A2A Protocol")
@Controller()
export class A2AController {
  private readonly logger = new Logger(A2AController.name);
  private readonly rateLimiter = new LruMap<
    string,
    { count: number; resetAt: number }
  >(1000);
  private readonly RATE_LIMIT = 30;
  private readonly RATE_WINDOW = 60_000; // 1 minute

  constructor(
    private readonly agentCardRegistry: AgentCardRegistry,
    @Inject(TEAMS_SERVICE_TOKEN)
    private readonly teamsService: IKernelTeamsService,
    @Optional()
    @Inject(TRACE_COLLECTOR_TOKEN)
    private readonly traceCollector?: IKernelTraceCollector,
  ) {}

  /**
   * Agent Discovery Endpoint
   * 公开端点，返回 Agent Card，用于外部 Agent 发现 GenesisPod 能力
   *
   * 标准路径: /.well-known/agent.json
   */
  @Get(".well-known/agent.json")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get Agent Card (A2A v0.3)",
    description:
      "Returns the A2A v0.3 spec-compliant Agent Card describing GenesisPod capabilities. This is a public discovery endpoint.",
  })
  @ApiResponse({
    status: 200,
    description: "Agent Card retrieved successfully",
    type: Object,
  })
  getAgentCard() {
    this.logger.log("Agent Card requested (v0.3)");
    // 2026-05-01 (PR-X-P): /.well-known/agent.json 默认返回 v0.3 spec card
    return this.agentCardRegistry.getAgentCardV03();
  }

  /**
   * Legacy v0.1 Agent Card endpoint
   * 早期 client 兼容入口；新 client 用 /.well-known/agent.json（已升级到 v0.3）
   */
  @Get(".well-known/agent-v01.json")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get Legacy Agent Card (v0.1, deprecated)",
    description:
      "Returns the legacy v0.1 Agent Card for backwards compatibility. Use /.well-known/agent.json for v0.3.",
  })
  getAgentCardLegacy(): A2AAgentCard {
    return this.agentCardRegistry.getAgentCard();
  }

  /**
   * Create Task Endpoint
   * 创建新的 A2A 任务
   *
   * 需要 API Key 认证
   * 限流: 30 请求/分钟
   */
  @Public()
  @Post("a2a/tasks")
  @UseGuards(A2AApiKeyGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiSecurity("X-API-Key")
  @ApiOperation({
    summary: "Create A2A Task",
    description:
      "Creates a new task for the specified skill. Requires API key authentication. Rate limit: 30 requests/minute.",
  })
  @ApiResponse({
    status: 202,
    description: "Task created and accepted for processing",
    type: Object,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request or unsupported skill",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or missing API key",
  })
  @ApiResponse({
    status: 429,
    description: "Too many requests",
  })
  async createTask(@Body() request: A2ATaskRequest): Promise<A2ATaskResponse> {
    this.logger.log(`Create task request for skill: ${request.skillId}`);

    // P1 #17: Rate limit per API key (from guard-injected metadata)
    const apiKeyId =
      (request as A2ATaskRequest & { a2aApiKeyId?: string }).a2aApiKeyId ||
      "unknown";
    this.checkRateLimit(apiKeyId);

    // P0 #7: Validate input content
    const MAX_CONTENT_LENGTH = 100_000; // 100KB
    if (!request.input?.content || typeof request.input.content !== "string") {
      throw new BadRequestException(
        "Invalid input: content must be a non-empty string",
      );
    }
    if (request.input.content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(
        `Input content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`,
      );
    }

    // P0 #7: Sanitize metadata - strip dangerous keys (recursive)
    const sanitizedMetadata = request.metadata
      ? this.sanitizeMetadata(request.metadata)
      : {};

    // P1 #12: Validate webhook URL if provided
    let webhookUrl: string | undefined;
    if (request.config?.webhookUrl) {
      try {
        const url = new URL(request.config.webhookUrl);
        // Only allow https
        if (url.protocol !== "https:") {
          throw new BadRequestException("Webhook URL must use HTTPS");
        }
        // Block private/internal IPs
        const hostname = url.hostname.toLowerCase();
        if (
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "0.0.0.0" ||
          hostname === "::1" ||
          hostname.endsWith(".local") ||
          hostname.startsWith("10.") ||
          hostname.startsWith("192.168.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || // 172.16-31.x
          hostname.startsWith("169.254.") || // Link-local, cloud metadata
          hostname.startsWith("fe80:") || // IPv6 link-local
          hostname.startsWith("fc") || // IPv6 unique local
          hostname.startsWith("fd") // IPv6 unique local
        ) {
          throw new BadRequestException(
            "Webhook URL must not point to private networks",
          );
        }
        // Block dangerous ports
        const BLOCKED_PORTS = [
          "22",
          "25",
          "3306",
          "5432",
          "6379",
          "9200",
          "27017",
        ];
        if (url.port && BLOCKED_PORTS.includes(url.port)) {
          throw new BadRequestException(
            "Webhook URL must not use internal service ports",
          );
        }
        webhookUrl = request.config.webhookUrl;
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException("Invalid webhook URL");
      }
    }

    // 验证技能是否存在
    const skill = this.agentCardRegistry.getSkillById(request.skillId);
    if (!skill) {
      this.logger.warn(`Invalid skill requested: ${request.skillId}`);
      return {
        taskId: this.generateTaskId(),
        status: A2ATaskStatus.FAILED,
        error: {
          code: "INVALID_SKILL",
          message: `Skill '${request.skillId}' not found`,
          details: {
            availableSkills: this.agentCardRegistry
              .getSkills()
              .map((s) => s.id),
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 映射 A2A skillId 到 teamId
    const teamId = this.mapSkillToTeam(request.skillId);
    if (!teamId) {
      this.logger.warn(`No team mapping for skill: ${request.skillId}`);
      return {
        taskId: this.generateTaskId(),
        status: A2ATaskStatus.FAILED,
        error: {
          code: "SKILL_NOT_IMPLEMENTED",
          message: `Skill '${request.skillId}' is not yet implemented`,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // P1 #21: Start trace for observability
    const traceId = this.traceCollector?.startTrace({
      type: "a2a_task",
      name: `A2A Task: ${request.skillId}`,
      metadata: { skillId: request.skillId, apiKeyId },
    });

    try {
      // 创建任务通过 TeamsService
      const missionId = await this.teamsService.executeMission({
        teamId,
        goal: request.input.content,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        context: (request.config?.context ?? "") as string,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        constraints: request.config?.constraints as
          | Partial<ConstraintProfile>
          | undefined,
        metadata: {
          ...sanitizedMetadata,
          a2aSkillId: request.skillId,
          webhookUrl,
        },
      });

      this.logger.log(
        `A2A task created: ${missionId} for skill: ${request.skillId}`,
      );

      // P1 #21: End trace on success
      if (traceId) {
        this.traceCollector?.endTrace(traceId, {
          status: "success",
        });
      }

      return {
        taskId: missionId,
        status: A2ATaskStatus.PENDING,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to create A2A task for skill ${request.skillId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      // P1 #21: End trace on failure
      if (traceId) {
        this.traceCollector?.endTrace(traceId, {
          status: "error",
        });
      }

      return {
        taskId: this.generateTaskId(),
        status: A2ATaskStatus.FAILED,
        error: {
          code: "TASK_CREATION_FAILED",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get Task Status Endpoint
   * 查询任务状态
   *
   * 需要 API Key 认证
   * 限流: 60 请求/分钟
   */
  @Public()
  @Get("a2a/tasks/:taskId")
  @UseGuards(A2AApiKeyGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiSecurity("X-API-Key")
  @ApiOperation({
    summary: "Get Task Status",
    description:
      "Retrieves the current status and result of a task. Requires API key authentication. Rate limit: 60 requests/minute.",
  })
  @ApiResponse({
    status: 200,
    description: "Task status retrieved successfully",
    type: Object,
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or missing API key",
  })
  @ApiResponse({
    status: 404,
    description: "Task not found",
  })
  @ApiResponse({
    status: 429,
    description: "Too many requests",
  })
  async getTaskStatus(
    @Param("taskId") taskId: string,
  ): Promise<A2ATaskStatusResponse> {
    this.logger.log(`Task status requested for: ${taskId}`);

    try {
      // 获取任务状态
      const missionStatus = this.teamsService.getMissionStatus(taskId);

      // 映射状态
      const a2aStatus = this.mapMissionStatusToA2A(missionStatus.status);

      // 尝试从团队ID推断skillId
      let skillId = "unknown-skill";
      try {
        // 如果任务已完成或失败，可以从result获取metadata
        if (
          a2aStatus === A2ATaskStatus.COMPLETED ||
          a2aStatus === A2ATaskStatus.FAILED
        ) {
          const missionResult =
            await this.teamsService.getMissionResult(taskId);
          skillId =
            (missionResult.metadata?.a2aSkillId as string) ??
            this.reverseMapTeamToSkill(missionStatus.teamId);
        } else {
          // 对于进行中的任务，根据teamId反向推断
          skillId = this.reverseMapTeamToSkill(missionStatus.teamId);
        }
      } catch {
        // Fallback to team-based mapping
        skillId = this.reverseMapTeamToSkill(missionStatus.teamId);
      }

      // 基础响应
      const response: A2ATaskStatusResponse = {
        taskId,
        skillId,
        status: a2aStatus,
        createdAt: missionStatus.startTime.toISOString(),
        updatedAt: (missionStatus.endTime ?? new Date()).toISOString(),
      };

      // 如果任务已完成，获取结果
      if (a2aStatus === A2ATaskStatus.COMPLETED) {
        try {
          const missionResult =
            await this.teamsService.getMissionResult(taskId);
          response.result = {
            content: missionResult.summary,
            mode: "text/markdown",
            data: {
              deliverables: missionResult.deliverables,
              statistics: missionResult.statistics,
            },
            metadata: {
              duration: missionResult.duration,
              tokenUsage: {
                input: 0, // MissionResult doesn't track input/output separately
                output: 0,
                total: missionResult.tokensUsed,
              },
            },
          };
        } catch (error) {
          this.logger.warn(
            `Failed to fetch result for completed task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // 如果任务失败，添加错误信息
      if (a2aStatus === A2ATaskStatus.FAILED && missionStatus.error) {
        response.error = {
          code: "MISSION_FAILED",
          message: missionStatus.error,
        };
      }

      return response;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        (error instanceof Error && error.message.includes("not found"))
      ) {
        throw new NotFoundException(`Task ${taskId} not found`);
      }

      this.logger.error(
        `Failed to get status for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new BadRequestException(
        `Failed to retrieve task status: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Recursively sanitize metadata to prevent prototype pollution
   */
  private sanitizeMetadata(obj: unknown, depth = 0): Record<string, unknown> {
    const MAX_DEPTH = 5;
    if (depth > MAX_DEPTH || typeof obj !== "object" || obj === null) return {};

    const BLOCKED_KEYS = ["__proto__", "constructor", "prototype"];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (BLOCKED_KEYS.includes(key)) continue;
      if (typeof key !== "string" || key.length > 100) continue;

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result[key] = this.sanitizeMetadata(value, depth + 1);
      } else if (typeof value === "string") {
        result[key] = value.length > 10_000 ? value.slice(0, 10_000) : value;
      } else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.slice(0, 100);
      }
    }
    return result;
  }

  /**
   * P1 #17: Per-API-key rate limiting
   */
  private checkRateLimit(apiKeyId: string): void {
    const now = Date.now();
    const entry = this.rateLimiter.get(apiKeyId);

    if (!entry || now > entry.resetAt) {
      this.rateLimiter.set(apiKeyId, {
        count: 1,
        resetAt: now + this.RATE_WINDOW,
      });
      return;
    }

    entry.count++;

    if (entry.count > this.RATE_LIMIT) {
      throw new HttpException("Rate limit exceeded", 429);
    }
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `a2a_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 映射 A2A Skill ID 到 Team ID
   */
  private mapSkillToTeam(skillId: string): TeamId | null {
    const skillToTeamMap: Record<string, TeamId> = {
      "deep-research": "research" as TeamId,
      "ai-ask": "research" as TeamId, // Use research team for Q&A
      "team-debate": "debate" as TeamId,
      "document-generation": "report" as TeamId,
      "ai-writing": "report" as TeamId, // Use report team for long-form writing
    };

    return skillToTeamMap[skillId] || null;
  }

  /**
   * 反向映射 Team ID 到 A2A Skill ID (best guess)
   */
  private reverseMapTeamToSkill(teamId: TeamId): string {
    const teamToSkillMap: Record<string, string> = {
      research: "deep-research",
      debate: "team-debate",
      report: "document-generation",
    };

    return teamToSkillMap[teamId] ?? "unknown-skill";
  }

  /**
   * 映射 Mission Status 到 A2A Task Status
   */
  private mapMissionStatusToA2A(
    status: "pending" | "running" | "completed" | "failed" | "cancelled",
  ): A2ATaskStatus {
    switch (status) {
      case "pending":
        return A2ATaskStatus.PENDING;
      case "running":
        return A2ATaskStatus.RUNNING;
      case "completed":
        return A2ATaskStatus.COMPLETED;
      case "failed":
        return A2ATaskStatus.FAILED;
      case "cancelled":
        return A2ATaskStatus.CANCELLED;
      default:
        return A2ATaskStatus.PENDING;
    }
  }
}
