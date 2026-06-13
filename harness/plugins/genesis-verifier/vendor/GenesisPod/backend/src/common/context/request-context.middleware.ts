import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { ConfigService } from "@nestjs/config";
import {
  RequestContext,
  RequestContextData,
  RequestContextStore,
} from "./request-context";
import * as jwt from "jsonwebtoken";

// 标准 HTTP headers for distributed tracing
const REQUEST_ID_HEADER = "x-request-id";
const TRACE_ID_HEADER = "x-trace-id";
const SPAN_ID_HEADER = "x-span-id";

/**
 * RequestContext 中间件
 *
 * 功能:
 * 1. 从 Authorization header 验证 JWT 并提取 userId
 * 2. 生成/传递分布式追踪 ID (requestId, traceId)
 * 3. 将上下文信息附加到响应头
 *
 * 失败时 userId 为 undefined，不影响请求（Guards 负责认证拦截）。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);
  private jwtSecret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>("JWT_SECRET");
    if (!this.jwtSecret) {
      this.logger.warn(
        "JWT_SECRET not configured, RequestContext userId will always be undefined",
      );
    }
  }

  use(req: Request, res: Response, next: NextFunction): void {
    let userId: string | undefined;

    // 提取用户 ID
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ") && this.jwtSecret) {
        const token = authHeader.slice(7);
        const payload = jwt.verify(token, this.jwtSecret) as { sub?: string };
        userId = payload?.sub;
      }
    } catch {
      // Token invalid/expired - userId stays undefined, no error
    }

    // 生成/传递追踪 ID
    const requestId =
      (req.headers[REQUEST_ID_HEADER] as string) ||
      RequestContextStore.generateRequestId();
    const traceId =
      (req.headers[TRACE_ID_HEADER] as string) ||
      RequestContextStore.generateRequestId();
    const spanId = req.headers[SPAN_ID_HEADER] as string;

    // 设置响应头（便于客户端追踪）
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(TRACE_ID_HEADER, traceId);

    // 构建上下文数据
    const contextData: RequestContextData = {
      userId,
      requestId,
      traceId,
      spanId,
      startTime: Date.now(),
      path: req.path,
      method: req.method,
    };

    RequestContext.run(contextData, () => next());
  }
}
