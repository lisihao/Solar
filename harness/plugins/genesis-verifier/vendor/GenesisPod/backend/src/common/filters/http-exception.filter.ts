import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";

/**
 * 全局HTTP异常过滤器
 *
 * 功能：
 * 1. 统一错误响应格式
 * 2. 记录详细的错误日志
 * 3. 区分开发环境和生产环境的错误信息
 * 4. 提供请求上下文追踪
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse = this.buildErrorResponse(exception, request, status);

    // 记录错误日志
    this.logError(exception, request, status);

    response.status(status).json(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
    status: number,
  ) {
    const isProduction = process.env.NODE_ENV === "production";

    // 基础错误信息
    const baseResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      // 如果是NestJS标准错误响应
      if (typeof exceptionResponse === "object") {
        return {
          ...baseResponse,
          ...(exceptionResponse as Record<string, unknown>),
        };
      }

      // 如果是字符串消息
      return {
        ...baseResponse,
        message: exceptionResponse,
        error: HttpStatus[status],
      };
    }

    // 未知错误处理
    const errorMessage =
      exception instanceof Error ? exception.message : "Internal server error";

    return {
      ...baseResponse,
      message: isProduction ? "Internal server error" : errorMessage,
      error: HttpStatus[status],
      // 开发环境提供堆栈信息
      ...(!isProduction &&
        exception instanceof Error && {
          stack: exception.stack,
        }),
    };
  }

  private logError(exception: unknown, request: Request, status: number) {
    const errorMessage =
      exception instanceof Error ? exception.message : "Unknown error";

    const errorLog = {
      statusCode: status,
      path: request.url,
      method: request.method,
      message: errorMessage,
      ip: request.ip,
      userAgent: request.get("user-agent"),
      timestamp: new Date().toISOString(),
    };

    // 根据错误级别记录不同的日志
    if (status >= 500) {
      this.logger.error(
        `Server Error: ${JSON.stringify(errorLog)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status >= 400) {
      // ★ 2026-05-13: 404 on idempotent GET 通常是前端"探测/轮询尚未存在
      //   的资源"（如 /topics/:id/reports/latest 新建专题时还没报告），
      //   把整片产品页造成大量 "Client Error" warn 噪音。降到 debug，
      //   真正的 4xx 异常（POST/PUT 业务错 / 401 / 403）仍 warn。
      const isExpectedNotFound =
        status === 404 && request.method.toUpperCase() === "GET";
      if (isExpectedNotFound) {
        this.logger.debug(`Resource Not Found: ${JSON.stringify(errorLog)}`);
      } else {
        this.logger.warn(`Client Error: ${JSON.stringify(errorLog)}`);
      }
    } else {
      this.logger.log(`Request completed: ${JSON.stringify(errorLog)}`);
    }
  }
}
