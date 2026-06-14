/**
 * AI Agents Controller
 * 统一 Agent API 入口
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Sse,
  Logger,
  Req,
  MessageEvent,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { Observable, map, catchError, of, from, switchMap } from "rxjs";
// agents-api 直接消费 ai-harness agent.types primitive 层（AgentResult 含 tokensUsed
// 等字段），与 facade re-export 的 legacy plan-based AgentResult<AgentOutput> 命名冲突，
// 故 agents-api 整目录在 .eslintrc.js 中文档化豁免，直引 agent.types primitive。
import { AgentOrchestrator } from "../../../ai-harness/agents/registry/agent-orchestrator";
import { PlanBasedAgentRegistry } from "../../../ai-harness/agents/registry/plan-based-agent-registry";
import { AgentInput } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { isPlatformAgentId } from "@/modules/ai-app/contracts/agent-catalog";
import { AgentsService } from "./agents.service";
import { AgentsTaskQueueService } from "./agents-task-queue.service";
import {
  ExecuteRequestDto,
  ExecuteResponseDto,
  TaskResponseDto,
  AgentsResponseDto,
  TemplatesResponseDto,
  StatusReportResponseDto,
  ArtifactsResponseDto,
  CancelResponseDto,
} from "./dto";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@ApiTags("AI Agents")
@Controller("agents")
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly agentRegistry: PlanBasedAgentRegistry,
    private readonly agentsService: AgentsService,
    private readonly agentsTaskQueue: AgentsTaskQueueService,
  ) {}

  /**
   * 取已认证用户 id。全局 JwtAuthGuard 已保证存在，此处兜底防御：
   * 缺失时显式 401，绝不让 undefined userId 流入 Prisma where（会被丢弃→越权）。
   */
  private requireUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
    }
    return userId;
  }

  /**
   * 获取所有可用的 Agent
   */
  @Get()
  @ApiOperation({
    summary: "获取所有可用的 Agent",
    description: "返回系统中所有已注册的 AI Agent 配置信息",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取 Agent 列表",
    type: AgentsResponseDto,
  })
  async getAgents(): Promise<AgentsResponseDto> {
    const configs = this.agentRegistry.getAllConfigs();
    return { agents: configs };
  }

  /**
   * 获取 Agent 状态报告
   */
  @Get("status")
  @ApiOperation({
    summary: "获取 Agent 状态报告",
    description: "获取所有 Agent 的运行状态和统计信息",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取状态报告",
    type: StatusReportResponseDto,
  })
  async getStatus(): Promise<StatusReportResponseDto> {
    const report = this.orchestrator.getStatusReport();
    const agentStats = this.agentRegistry.getStats();
    const totalTasks = Object.values(agentStats.byId).reduce(
      (sum, s: { executions: number; errors: number }) => sum + s.executions,
      0,
    );
    return {
      agents: report,
      stats: {
        registeredAgents: agentStats.total,
        availableTools: 0, // ToolRegistry not injected here; use facade layer for full stats
        totalTasks,
      },
    };
  }

  /**
   * 获取指定 Agent 的模板
   */
  @Get(":type/templates")
  @ApiOperation({
    summary: "获取指定 Agent 的模板",
    description: "获取指定 Agent 类型的所有可用模板",
  })
  @ApiParam({
    name: "type",
    description: "Agent 类型（小写）",
    enum: ["slides", "docs", "designer"],
    example: "slides",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取模板列表",
    type: TemplatesResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "无效的 Agent 类型",
  })
  async getTemplates(
    @Param("type") type: string,
  ): Promise<TemplatesResponseDto> {
    const agentId = type.toLowerCase();
    if (!isPlatformAgentId(agentId)) {
      throw new HttpException("Invalid agent type", HttpStatus.BAD_REQUEST);
    }

    if (!this.agentRegistry.has(agentId)) {
      return { templates: [] };
    }

    const agent = this.agentRegistry.get(agentId);
    return { templates: agent.getTemplates() };
  }

  /**
   * 执行 Agent 任务
   */
  @Post("execute")
  @ApiOperation({
    summary: "执行 Agent 任务",
    description: "创建并执行一个 AI Agent 任务，支持文件、URL 和资源引用",
  })
  @ApiResponse({
    status: 201,
    description: "任务创建成功",
    type: ExecuteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "请求参数错误",
  })
  @ApiResponse({
    status: 401,
    description: "未授权",
  })
  async execute(
    @Body() body: ExecuteRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ExecuteResponseDto> {
    const userId = req.user?.id;

    // 构建 Agent 输入
    const input: AgentInput = {
      prompt: body.prompt,
      files: body.files,
      urls: body.urls,
      resourceIds: body.resourceIds,
      templateId: body.templateId,
      options: body.options,
    };

    // 创建任务记录
    const task = await this.agentsService.createTask({
      userId,
      agentId: body.agentId,
      input,
    });

    // 入队 durable 执行任务（BullMQ）——HTTP 立即返回，执行交给 worker，
    // 进程崩溃/重启不丢任务（boot recovery 重投在途任务）。
    await this.agentsTaskQueue.enqueue(task.id, input, body.agentId, userId);

    return {
      taskId: task.id,
      status: "pending",
    };
  }

  /**
   * 获取任务状态
   */
  @Get("tasks/:taskId")
  @ApiOperation({
    summary: "获取任务状态",
    description: "获取指定任务的详细信息和执行状态",
  })
  @ApiParam({
    name: "taskId",
    description: "任务 ID",
    example: "clxxxx12345",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取任务信息",
    type: TaskResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "任务不存在",
  })
  async getTask(
    @Param("taskId") taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TaskResponseDto> {
    const userId = this.requireUserId(req);
    const task = await this.agentsService.getTask(taskId, userId);
    if (!task) {
      throw new HttpException("Task not found", HttpStatus.NOT_FOUND);
    }
    return task as unknown as TaskResponseDto;
  }

  /**
   * 任务进度 SSE 流
   */
  @Sse("tasks/:taskId/stream")
  @ApiOperation({
    summary: "任务进度流",
    description: "通过 Server-Sent Events (SSE) 实时获取任务执行进度",
  })
  @ApiParam({
    name: "taskId",
    description: "任务 ID",
    example: "clxxxx12345",
  })
  @ApiResponse({
    status: 200,
    description: "SSE 流连接成功",
  })
  streamTask(
    @Param("taskId") taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Observable<MessageEvent> {
    const userId = this.requireUserId(req);
    // ★ IDOR 防护：订阅事件流前先校验 task 归属，非属主直接 404，
    //   避免跨用户监听他人任务的 SSE 事件。
    return from(this.agentsService.getTask(taskId, userId)).pipe(
      switchMap((task) => {
        if (!task) {
          throw new HttpException("Task not found", HttpStatus.NOT_FOUND);
        }
        return this.agentsService.getTaskStream(taskId);
      }),
      map((event) => ({
        data: JSON.stringify(event),
      })),
      catchError((error) => {
        this.logger.error(`Stream error: ${error.message}`);
        return of({
          data: JSON.stringify({ type: "error", error: error.message }),
        });
      }),
    );
  }

  /**
   * 取消任务
   */
  @Post("tasks/:taskId/cancel")
  @ApiOperation({
    summary: "取消任务",
    description: "取消正在执行或等待中的任务",
  })
  @ApiParam({
    name: "taskId",
    description: "任务 ID",
    example: "clxxxx12345",
  })
  @ApiResponse({
    status: 200,
    description: "取消操作完成",
    type: CancelResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "任务不存在",
  })
  async cancelTask(
    @Param("taskId") taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CancelResponseDto> {
    const userId = this.requireUserId(req);
    const success = await this.agentsService.cancelTask(taskId, userId);
    return { success };
  }

  /**
   * 获取任务产出物
   */
  @Get("tasks/:taskId/artifacts")
  @ApiOperation({
    summary: "获取任务产出物",
    description: "获取任务生成的所有产出物列表",
  })
  @ApiParam({
    name: "taskId",
    description: "任务 ID",
    example: "clxxxx12345",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取产出物列表",
    type: ArtifactsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "任务不存在",
  })
  async getArtifacts(
    @Param("taskId") taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ArtifactsResponseDto> {
    const userId = this.requireUserId(req);
    const artifacts = await this.agentsService.getArtifacts(taskId, userId);
    return {
      artifacts: artifacts as unknown as ArtifactsResponseDto["artifacts"],
    };
  }

  /**
   * 下载产出物
   */
  @Get("artifacts/:artifactId/download")
  @ApiOperation({
    summary: "下载产出物",
    description: "下载指定的产出物文件",
  })
  @ApiParam({
    name: "artifactId",
    description: "产出物 ID",
    example: "clxxxx67890",
  })
  @ApiResponse({
    status: 200,
    description: "成功返回文件",
  })
  @ApiResponse({
    status: 404,
    description: "产出物不存在",
  })
  async downloadArtifact(
    @Param("artifactId") artifactId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ url: string | null; name: string; mimeType: string }> {
    const userId = this.requireUserId(req);
    return this.agentsService.getArtifactDownload(artifactId, userId);
  }
}
