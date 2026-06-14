import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Optional,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { StructuredLogger, logRequest } from "../utils/structured-logger";
import { MetricsService } from "@/modules/platform/monitoring/metrics/metrics.service";

/** Slow request threshold in ms — requests exceeding this are always logged with WARN */
const SLOW_REQUEST_THRESHOLD_MS = 500;

/**
 * 请求日志 & 性能追踪拦截器
 *
 * 功能:
 * - 每个请求注入 Server-Timing 响应头（浏览器 DevTools Network 面板直接可见）
 * - 始终记录 HTTP 指标到 MetricsService（histogram + counter）
 * - 生产环境：仅记录慢请求(>500ms) 和错误的日志，避免日志洪水
 * - 开发环境：记录所有请求日志
 *
 * 通过 APP_INTERCEPTOR 全局注册，DI 注入 MetricsService。
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new StructuredLogger("HTTP");
  private readonly isProduction = process.env.NODE_ENV === "production";

  constructor(
    @Optional()
    @Inject(MetricsService)
    private readonly metricsService?: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const startTime = Date.now();
    const { method, path, url } = request;
    const requestId = request.headers["x-request-id"] as string | undefined;
    const userId = (request as Request & { user?: { id?: string } }).user?.id;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          // Server-Timing header — visible in browser DevTools Network tab
          // Guard: redirects (e.g. OAuth callback) may have already flushed headers
          if (!response.headersSent) {
            response.setHeader("Server-Timing", `total;dur=${duration}`);
          }

          // 始终记录 HTTP 指标
          this.recordHttpMetrics(method, path, statusCode, duration);

          // 跳过健康检查等高频低价值日志
          if (this.shouldSkipLog(path)) {
            return;
          }

          // 生产环境：仅记录慢请求；开发环境：全部记录
          if (this.isProduction && duration < SLOW_REQUEST_THRESHOLD_MS) {
            return;
          }

          logRequest(this.logger, method, path || url, statusCode, duration, {
            requestId,
            userId,
            slow: duration >= SLOW_REQUEST_THRESHOLD_MS || undefined,
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          // Server-Timing header
          if (!response.headersSent) {
            response.setHeader("Server-Timing", `total;dur=${duration}`);
          }

          // 始终记录 HTTP 指标
          this.recordHttpMetrics(method, path, statusCode, duration);

          // 4xx = client error (WARN), 5xx = server error (ERROR)
          const logMethod = statusCode < 500 ? "warn" : "error";
          this.logger[logMethod](
            `${method} ${path || url} ${statusCode} ${duration}ms`,
            {
              requestId,
              userId,
              duration,
              method,
              path: path || url,
              statusCode,
            },
          );
        },
      }),
    );
  }

  /**
   * 记录 HTTP 请求指标
   */
  private recordHttpMetrics(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
  ): void {
    if (!this.metricsService) return;

    // 提取路由模式（移除动态参数）
    const routePattern = this.extractRoutePattern(path);

    // 记录请求延迟
    this.metricsService.recordHistogram("http_request_duration_ms", duration, {
      method,
      route: routePattern,
      status: String(statusCode),
    });

    // 记录请求计数
    this.metricsService.incrementCounter("http_requests_total", {
      method,
      route: routePattern,
      status: String(statusCode),
    });

    // 记录错误（4xx, 5xx）
    if (statusCode >= 400) {
      this.metricsService.incrementCounter("http_errors_total", {
        method,
        route: routePattern,
        status: String(statusCode),
        error_class: statusCode >= 500 ? "5xx" : "4xx",
      });
    }
  }

  /**
   * 提取路由模式（将动态参数替换为占位符）
   */
  private extractRoutePattern(path: string): string {
    // 移除查询参数
    const cleanPath = path.split("?")[0];

    // 替换 UUID 格式的 ID
    let pattern = cleanPath.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    );

    // 替换纯数字 ID
    pattern = pattern.replace(/\/\d+(?=\/|$)/g, "/:id");

    // 替换 cuid 格式 (c开头的25位字符)
    pattern = pattern.replace(/\/c[a-z0-9]{24,25}(?=\/|$)/gi, "/:id");

    return pattern || "/";
  }

  /**
   * 判断是否跳过日志记录
   */
  private shouldSkipLog(path: string): boolean {
    const skipPaths = ["/health", "/api/v1/health", "/favicon.ico"];
    return skipPaths.some((p) => path.startsWith(p));
  }
}
