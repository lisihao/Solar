/**
 * Agent Controller
 *
 * 统一的 Agent 执行入口
 * 支持 SSE 流式输出任务进度
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBody, ApiParam } from "@nestjs/swagger";
import { Response } from "express";
import { randomUUID } from "crypto";
import { AgentType, AgentTask, taskStore } from "./agents.types";
import {
  SlidesEngineService,
  SlidesGenerateInput,
  StreamEvent,
} from "../slides";

interface ExecuteAgentDto {
  prompt: string;
  title?: string;
  urls?: string[];
  resourceIds?: string[];
  options?: Record<string, unknown>;
  agentType?: AgentType;
}

@ApiTags("Agents")
@Controller("ai-office/agents")
export class AiOfficeAgentsController {
  private readonly logger = new Logger(AiOfficeAgentsController.name);

  constructor(private readonly slidesEngine: SlidesEngineService) {}

  /**
   * 执行 Agent 任务
   */
  @Post("execute")
  @ApiOperation({ summary: "Execute an agent task" })
  @ApiBody({ description: "Agent input parameters" })
  async executeAgent(
    @Body() body: ExecuteAgentDto,
  ): Promise<{ taskId: string; status: string }> {
    const taskId = randomUUID();
    const agentType = body.agentType || AgentType.SLIDES;

    this.logger.log(
      `[executeAgent] Creating task ${taskId} for agent ${agentType}`,
    );

    // 创建任务记录
    const task: AgentTask = {
      id: taskId,
      agentType,
      status: "pending",
      input: {
        prompt: body.prompt,
        title: body.title,
        urls: body.urls,
        resourceIds: body.resourceIds,
        options: body.options,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    taskStore.tasks.set(taskId, task);
    taskStore.streams.set(taskId, []);

    // 异步启动生成
    this.runAgentTask(taskId, task).catch((error) => {
      this.logger.error(`[executeAgent] Task ${taskId} failed:`, error);
    });

    return { taskId, status: "pending" };
  }

  /**
   * 获取任务状态
   */
  @Get("tasks/:taskId")
  @ApiOperation({ summary: "Get task status" })
  @ApiParam({ name: "taskId", description: "Task ID" })
  async getTask(@Param("taskId") taskId: string): Promise<AgentTask> {
    const task = taskStore.tasks.get(taskId);
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  /**
   * SSE 流式获取任务进度
   */
  @Get("tasks/:taskId/stream")
  @ApiOperation({ summary: "Stream task progress via SSE" })
  @ApiParam({ name: "taskId", description: "Task ID" })
  async streamTask(
    @Param("taskId") taskId: string,
    @Res() res: Response,
  ): Promise<void> {
    const task = taskStore.tasks.get(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // 设置 SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    this.logger.log(`[streamTask] SSE connection opened for task ${taskId}`);

    // 发送已有的事件
    const existingEvents = taskStore.streams.get(taskId) || [];
    for (const event of existingEvents) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // 如果任务已完成，直接关闭
    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      res.end();
      return;
    }

    // 轮询新事件（简单实现，生产环境应使用 Redis Pub/Sub）
    const intervalId = setInterval(() => {
      const currentTask = taskStore.tasks.get(taskId);
      const events = taskStore.streams.get(taskId) || [];

      // 发送新事件
      for (let i = existingEvents.length; i < events.length; i++) {
        res.write(`data: ${JSON.stringify(events[i])}\n\n`);
      }
      existingEvents.length = events.length;

      // 检查是否完成
      if (
        currentTask?.status === "completed" ||
        currentTask?.status === "failed" ||
        currentTask?.status === "cancelled"
      ) {
        clearInterval(intervalId);
        res.end();
      }
    }, 100);

    // 处理客户端断开
    res.on("close", () => {
      this.logger.log(`[streamTask] SSE connection closed for task ${taskId}`);
      clearInterval(intervalId);
    });
  }

  /**
   * 取消任务
   */
  @Post("tasks/:taskId/cancel")
  @ApiOperation({ summary: "Cancel a running task" })
  @ApiParam({ name: "taskId", description: "Task ID" })
  async cancelTask(@Param("taskId") taskId: string): Promise<void> {
    const task = taskStore.tasks.get(taskId);
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    task.status = "cancelled";
    task.updatedAt = new Date();

    // 发送取消事件
    this.emitEvent(taskId, {
      type: "error",
      timestamp: new Date().toISOString(),
      taskId,
      data: { error: "Task cancelled by user" },
    });
  }

  /**
   * 获取任务产出物
   */
  @Get("tasks/:taskId/artifacts")
  @ApiOperation({ summary: "Get task artifacts" })
  @ApiParam({ name: "taskId", description: "Task ID" })
  async getArtifacts(@Param("taskId") taskId: string): Promise<unknown[]> {
    const task = taskStore.tasks.get(taskId);
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    return task.result?.artifacts || [];
  }

  // ============================================
  // 内部方法
  // ============================================

  /**
   * 运行 Agent 任务
   */
  private async runAgentTask(taskId: string, task: AgentTask): Promise<void> {
    task.status = "running";
    task.updatedAt = new Date();

    this.emitEvent(taskId, {
      type: "progress",
      timestamp: new Date().toISOString(),
      taskId,
      data: { phase: "starting", percentage: 0, message: "Starting..." },
    });

    try {
      switch (task.agentType) {
        case AgentType.SLIDES:
          await this.runSlidesAgent(taskId, task);
          break;
        default:
          throw new Error(`Unsupported agent type: ${task.agentType}`);
      }

      task.status = "completed";
      task.completedAt = new Date();
      task.updatedAt = new Date();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[runAgentTask] Error: ${errorMessage}`);
      task.status = "failed";
      task.error = errorMessage;
      task.updatedAt = new Date();

      this.emitEvent(taskId, {
        type: "error",
        timestamp: new Date().toISOString(),
        taskId,
        data: { error: errorMessage },
      });
    }
  }

  /**
   * 运行 Slides Agent
   */
  private async runSlidesAgent(taskId: string, task: AgentTask): Promise<void> {
    const input = task.input;
    const options = (input.options || {}) as Record<string, unknown>;

    // 使用 SlidesEngineService
    const generateInput: SlidesGenerateInput = {
      userId: (options.userId as string) || "anonymous",
      sourceText: input.prompt || "",
      targetPages: (options.slideCount as number) || 8,
      stylePreference: "dark",
      themeId: (options.themeId as string) || "genspark-dark",
    };

    try {
      // 使用 AsyncGenerator
      for await (const event of this.slidesEngine.generateSlides(
        generateInput,
      )) {
        const agentEvent = this.convertPPTEvent(taskId, event);
        this.emitEvent(taskId, agentEvent);

        if (event.type === "execution:completed" && event.data) {
          const eventData = event.data as Record<string, unknown>;
          const sessionId =
            (eventData.checkpointId as string) || event.executionId;
          task.result = {
            documentId: sessionId,
            artifacts: [
              {
                id: sessionId,
                type: "pptx",
                name: input.title || "演示文稿",
                url: `/api/ai-office/slides/sessions/${sessionId}`,
              },
            ],
            summary: `生成了 ${eventData.totalPages || 0} 页幻灯片`,
            duration: (eventData.totalTime as number) || 0,
          };
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 转换 PPT 事件 (StreamEvent)
   * 使用新的事件类型格式
   */
  private convertPPTEvent(
    taskId: string,
    event: StreamEvent,
  ): Record<string, unknown> {
    const base = {
      timestamp: event.timestamp || new Date().toISOString(),
      taskId,
    };
    const eventData = event.data as Record<string, unknown> | undefined;

    switch (event.type) {
      case "phase:progress":
        return {
          ...base,
          type: "progress",
          data: {
            phase: eventData?.phase,
            percentage: eventData?.progress || 0,
            message: eventData?.message,
          },
        };
      case "phase:completed":
        return {
          ...base,
          type: "plan_ready",
          data: { outline: eventData?.result },
        };
      case "slide:generated":
        return {
          ...base,
          type: "step_complete",
          data: {
            pageNumber: eventData?.pageNumber,
            html: eventData?.html,
          },
        };
      case "execution:completed":
        return {
          ...base,
          type: "complete",
          data: eventData,
        };
      case "execution:failed":
        return {
          ...base,
          type: "error",
          data: { message: eventData?.error || "Unknown error" },
        };
      default:
        return { ...base, type: event.type, data: eventData };
    }
  }

  /**
   * 发送事件到流
   */
  private emitEvent(taskId: string, event: Record<string, unknown>): void {
    const events = taskStore.streams.get(taskId);
    if (events) {
      events.push(event);
    }
  }
}
