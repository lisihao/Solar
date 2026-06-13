/**
 * AI Engine - Progress Middleware
 * 执行进度追踪中间件
 *
 * Emits structured log events at tool start and completion for observability.
 * Runs late in the middleware chain (priority 90) so it wraps the actual
 * execution window as closely as possible.
 *
 * The start timestamp is stored on the shared ToolContext metadata map so that
 * the after hook can report accurate wall-clock duration without relying on
 * external state.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ITool, ToolContext, ToolResult } from "../abstractions/tool.interface";
import { IToolMiddleware } from "./middleware.interface";

/** Metadata key used to stash the per-execution start timestamp */
const START_TIME_KEY = "__progress_startTime__";

/**
 * ProgressMiddleware
 *
 * Implements IToolMiddleware with priority 90 (runs after ValidationMiddleware
 * and TimeoutMiddleware setup, just before the tool executes).
 */
@Injectable()
export class ProgressMiddleware implements IToolMiddleware {
  readonly name = "progress";
  readonly priority = 90;

  private readonly logger = new Logger(ProgressMiddleware.name);

  /**
   * Record the start timestamp and emit a tool_started log entry.
   *
   * The timestamp is written to `context.metadata` so it survives across the
   * before→execute→after lifecycle without requiring instance-level state
   * (which would break concurrent executions).
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async before(
    _input: unknown,
    context: ToolContext,
    tool: ITool,
  ): Promise<void> {
    const startTime = Date.now();

    // Initialise metadata map if the context arrived without one
    if (!context.metadata) {
      context.metadata = {};
    }
    context.metadata[START_TIME_KEY] = startTime;

    this.logger.debug(
      `[tool_started] tool=${tool.id} executionId=${context.executionId} userId=${context.userId ?? "anonymous"}`,
    );
  }

  /**
   * Emit a tool_completed (or tool_failed) log entry with the wall-clock duration.
   *
   * The result is returned unchanged — this middleware is purely observational.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async after(
    result: ToolResult,
    context: ToolContext,
    tool: ITool,
  ): Promise<ToolResult> {
    const startTime =
      typeof context.metadata?.[START_TIME_KEY] === "number"
        ? context.metadata[START_TIME_KEY]
        : undefined;

    const duration = startTime !== undefined ? Date.now() - startTime : 0;
    const status = result.success ? "tool_completed" : "tool_failed";

    this.logger.debug(
      `[${status}] tool=${tool.id} executionId=${context.executionId} duration=${duration}ms`,
    );

    return result;
  }
}
