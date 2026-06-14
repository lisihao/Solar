/**
 * RateLimitMiddleware — ToolPipeline 接入 RateLimitService 的 middleware
 * （v5.1 R0.5-E 重新归位 ai-engine 核心 middleware）
 *
 * 行为：
 *   before: 三维度（global / tenant / agentType）检查 + 消耗 quota
 *           超限 → 抛 ToolError(code=RATE_LIMITED, retryable=true)
 *
 * 业务无关：
 *   - tenantId / agentType 从 ToolContext.metadata 解析
 *   - 不接受任何 ai-app 名作为分组键
 */
import { Logger } from "@nestjs/common";
import { ITool, ToolContext } from "../abstractions/tool.interface";
import { ToolError } from "../abstractions/tool.error";
import { IToolMiddleware } from "./middleware.interface";
import { RateLimitService } from "../../reliability/rate-limit/rate-limit.service";

export class RateLimitMiddleware implements IToolMiddleware {
  readonly name = "rate-limit";
  /** 在 permission(5) 之后、validation(10) 之前 */
  readonly priority = 8;

  private static readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(private readonly rateLimit: RateLimitService) {}

  async before(
    _input: unknown,
    context: ToolContext,
    tool: ITool,
  ): Promise<void> {
    const meta = context.metadata as
      | { tenantId?: string; agentType?: string }
      | undefined;
    const result = await this.rateLimit.checkAndConsume("tool", {
      tenantId: meta?.tenantId,
      agentType: meta?.agentType,
    });
    if (!result.allowed) {
      RateLimitMiddleware.logger.warn(
        `[rate-limit] tool '${tool.id}' rejected — scope=${result.scope}`,
      );
      throw ToolError.rateLimited(tool.id, result.retryAfterMs);
    }
  }
}
