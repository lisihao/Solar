/**
 * MCP Server - Research Tool Handler
 *
 * genesis_deep_research — 异步执行模式：
 *   1. 输入校验，生成唯一 taskId
 *   2. 立即返回 { taskId, status: "started" }（不阻塞 HTTP 连接）
 *   3. 后台执行研究，每个阶段通过 MCPStreamingBridge 发送 SSE progress 事件
 *   4. 完成后通过 SSE notifications/message 推送完整报告
 *
 * 解决的问题：
 *   - 根本：HTTP 同步模式无法承载 5-20 分钟的研究任务
 *   - Railway / Next.js 代理 300s 超时导致必然失败
 *   - 超时后后台 LLM 调用继续浪费资源（僵尸执行）
 *   - SSE Bridge 已就位但从未被调用
 *
 * 客户端使用方式：
 *   1. 先建立 SSE 连接: GET /api/v1/mcp (带 Mcp-Session-Id header)
 *   2. 调用工具: POST /api/v1/mcp { method: "tools/call", params: { name: "genesis_deep_research", ... } }
 *   3. 收到立即响应 { taskId }，在 SSE 通道监听:
 *      - event: message, method: notifications/progress  → 进度
 *      - event: message, method: notifications/message, params.type: "research_complete" → 完整报告
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import * as crypto from "crypto";
import {
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
  MCPStreamEvent,
} from "../abstractions/mcp-server.interface";
import { AIFacade } from "../../../../ai-harness/facade";
import { MCPStreamingBridge } from "../streaming/mcp-streaming-bridge";

/** 已完成结果在内存中保留时长（30 分钟），供 SSE 断连重连后查询 */
const RESULT_TTL_MS = 30 * 60 * 1000;

interface CachedResult {
  taskId: string;
  data: unknown;
  isError: boolean;
  storedAt: Date;
}

@Injectable()
export class ResearchToolHandler implements IMCPToolHandler {
  private readonly logger = new Logger(ResearchToolHandler.name);

  /** 已完成结果缓存（TTL: 30min），防止 SSE 断连丢失结果 */
  private readonly resultCache = new Map<string, CachedResult>();

  readonly toolName = "genesis_deep_research";
  readonly description =
    "Execute deep research on a topic. ASYNC: Returns a taskId immediately; " +
    "the full report is delivered via SSE (method: notifications/message, params.type: research_complete). " +
    "You MUST have an SSE connection open before calling this tool " +
    "(GET /mcp with Mcp-Session-Id header, same session as this call). " +
    "Creates a research plan, runs iterative search with self-reflection, " +
    "and returns a comprehensive report with citations.";

  readonly inputSchema = {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The research topic or question to investigate",
      },
      dimensions: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional research dimensions/angles (e.g., 'market analysis', 'technical feasibility')",
      },
      depth: {
        type: "string",
        enum: ["quick", "standard", "deep"],
        description:
          "Research depth. quick≈2-4 min, standard≈5-10 min, deep≈10-20 min. Default: standard",
      },
      language: {
        type: "string",
        description: "Output language for the report. Default: en",
      },
    },
    required: ["topic"],
  };

  constructor(
    private readonly aiFacade: AIFacade,
    @Optional() private readonly streamingBridge?: MCPStreamingBridge,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    // ── Input validation ────────────────────────────────────────────────────
    if (typeof args.topic !== "string" || !args.topic.trim()) {
      return this.validationError("topic must be a non-empty string");
    }

    if (
      args.dimensions !== undefined &&
      (!Array.isArray(args.dimensions) ||
        !args.dimensions.every((d) => typeof d === "string"))
    ) {
      return this.validationError("dimensions must be an array of strings");
    }

    if (
      args.depth !== undefined &&
      !["quick", "standard", "deep"].includes(args.depth as string)
    ) {
      return this.validationError(
        'depth must be one of: "quick", "standard", "deep"',
      );
    }

    const topic = args.topic.trim();
    const depth = (args.depth as "quick" | "standard" | "deep") || "standard";
    const language =
      (typeof args.language === "string" && args.language) || "en";
    const dimensions = args.dimensions;

    // ── Generate task ID ────────────────────────────────────────────────────
    const taskId = `research_${crypto.randomBytes(6).toString("hex")}`;

    this.logger.log(
      `MCP async research: taskId=${taskId}, topic="${topic.slice(0, 60)}", ` +
        `depth=${depth}, session=${context.sessionId ?? "none"}`,
    );

    // ── Warn if SSE not available ───────────────────────────────────────────
    if (!context.sessionId || !this.streamingBridge) {
      this.logger.warn(
        `taskId=${taskId}: No SSE available ` +
          `(sessionId=${context.sessionId ?? "missing"}, ` +
          `bridge=${this.streamingBridge ? "ok" : "missing"}). ` +
          `Result will be cached but may not be delivered.`,
      );
    }

    // ── Fire-and-forget background execution ────────────────────────────────
    setImmediate(() => {
      this.runResearchInBackground(
        taskId,
        topic,
        depth,
        language,
        dimensions,
        context,
      ).catch((err: Error) => {
        this.logger.error(
          `Background research ${taskId} uncaught: ${err.message}`,
        );
      });
    });

    // ── Return immediately ──────────────────────────────────────────────────
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            taskId,
            status: "started",
            depth,
            topic: topic.slice(0, 120),
            estimatedDuration:
              depth === "quick"
                ? "2-4 minutes"
                : depth === "standard"
                  ? "5-10 minutes"
                  : "10-20 minutes",
            message:
              "Deep research has started asynchronously. " +
              "Monitor progress and receive the final report via your SSE connection " +
              "(GET /mcp with the same Mcp-Session-Id). " +
              "Look for: method=notifications/progress (updates) " +
              "and method=notifications/message with params.type=research_complete (result).",
          }),
        },
      ],
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Background execution
  // ──────────────────────────────────────────────────────────────────────────

  private async runResearchInBackground(
    taskId: string,
    topic: string,
    depth: "quick" | "standard" | "deep",
    language: string,
    dimensions: string[] | undefined,
    context: MCPRequestContext,
  ): Promise<void> {
    const sessionId = context.sessionId;

    this.pushProgress(
      sessionId,
      taskId,
      2,
      "starting",
      "Initializing research...",
    );

    try {
      const result = await this.aiFacade.executeDirectResearch({
        query: topic,
        depth,
        language,
        dimensions,
        onProgress: (stage, percent, message) => {
          this.pushProgress(sessionId, taskId, percent, stage, message);
        },
      });

      const totalSources = result.searchRounds.reduce(
        (sum, r) => sum + r.sources.length,
        0,
      );

      if (totalSources === 0) {
        this.cacheAndPushError(
          sessionId,
          taskId,
          "No search results found. Try refining the topic.",
        );
        return;
      }

      const payload = {
        executiveSummary: result.report.executiveSummary,
        sections: result.report.sections,
        conclusion: result.report.conclusion,
        references: result.report.references,
        metadata: {
          ...result.report.metadata,
          duration: result.duration,
          depth,
          language,
          totalSources,
        },
      };

      this.cacheAndPushResult(sessionId, taskId, payload);

      this.logger.log(
        `Research ${taskId} complete: ${totalSources} sources, ${result.duration}s`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Research ${taskId} failed: ${message}`);
      this.cacheAndPushError(sessionId, taskId, message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SSE helpers
  // ──────────────────────────────────────────────────────────────────────────

  private pushProgress(
    sessionId: string | undefined,
    taskId: string,
    percent: number,
    stage: string,
    message: string,
  ): void {
    if (!this.streamingBridge || !sessionId) return;
    const event: MCPStreamEvent = {
      type: "progress",
      taskId,
      data: { stage, percent: Math.min(100, Math.max(0, percent)), message },
      timestamp: new Date(),
    };
    this.streamingBridge.sendEvent(sessionId, event);
  }

  private cacheAndPushResult(
    sessionId: string | undefined,
    taskId: string,
    data: unknown,
  ): void {
    this.resultCache.set(taskId, {
      taskId,
      data,
      isError: false,
      storedAt: new Date(),
    });
    this.evictExpiredResults();

    if (!this.streamingBridge || !sessionId) {
      this.logger.warn(
        `taskId=${taskId}: result cached but no SSE to deliver (session=${sessionId ?? "missing"})`,
      );
      return;
    }
    this.streamingBridge.sendResearchResult(sessionId, taskId, data);
  }

  private cacheAndPushError(
    sessionId: string | undefined,
    taskId: string,
    message: string,
  ): void {
    this.resultCache.set(taskId, {
      taskId,
      data: { error: message },
      isError: true,
      storedAt: new Date(),
    });
    this.evictExpiredResults();

    if (!this.streamingBridge || !sessionId) return;
    const event: MCPStreamEvent = {
      type: "error",
      taskId,
      data: { message },
      timestamp: new Date(),
    };
    this.streamingBridge.sendEvent(sessionId, event);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Result cache management
  // ──────────────────────────────────────────────────────────────────────────

  /** 查询缓存结果（供管理接口或重试逻辑调用） */
  getCachedResult(taskId: string): CachedResult | undefined {
    return this.resultCache.get(taskId);
  }

  private evictExpiredResults(): void {
    const threshold = new Date(Date.now() - RESULT_TTL_MS);
    for (const [id, entry] of this.resultCache) {
      if (entry.storedAt < threshold) {
        this.resultCache.delete(id);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private validationError(details: string): MCPToolResponse {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "Invalid input", details }),
        },
      ],
      isError: true,
    };
  }
}
