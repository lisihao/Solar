import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  Optional,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { Request, Response } from "express";
import { RequestContext } from "../context/request-context";
import { ErrorTrackingService } from "../../modules/platform/monitoring";

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string;
  code: string;
  requestId?: string;
  traceId?: string;
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * 全局异常过滤器
 *
 * 统一处理所有异常，包括：
 * - HTTP异常
 * - Prisma数据库异常
 * - 未知异常
 *
 * 确保：
 * - 返回统一的错误格式
 * - 记录详细的错误日志
 * - 生产环境不暴露敏感信息
 * - 发送critical错误到监控系统
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    @Optional()
    @Inject(ErrorTrackingService)
    private readonly errorTrackingService?: ErrorTrackingService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse = this.buildErrorResponse(exception, request);

    // 记录错误
    this.logError(request, errorResponse, exception);

    // 发送到监控系统（如果是5xx错误）
    if (errorResponse.statusCode >= 500) {
      this.reportToMonitoring(errorResponse, exception);
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  /**
   * 构建统一的错误响应格式
   */
  private buildErrorResponse(
    exception: unknown,
    request: Request,
  ): ErrorResponse {
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code = "INTERNAL_ERROR";
    let details: Record<string, unknown> | undefined = undefined;

    // 处理Prisma数据库错误
    if (exception instanceof PrismaClientKnownRequestError) {
      const prismaError = this.handlePrismaError(exception);
      status = prismaError.status;
      message = prismaError.message;
      code = prismaError.code;
      details = prismaError.details;
    }
    // 处理HTTP异常
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();

      if (typeof errorResponse === "string") {
        message = errorResponse;
      } else if (typeof errorResponse === "object") {
        const errorObj = errorResponse as Record<string, unknown>;
        message =
          (typeof errorObj.message === "string"
            ? errorObj.message
            : Array.isArray(errorObj.message)
              ? (errorObj.message as string[]).join("; ")
              : undefined) || message;
        code =
          (typeof errorObj.error === "string" ? errorObj.error : undefined) ||
          code;
      }
    }
    // 处理未知错误
    else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error("Uncaught exception", exception.stack);
    }

    // 获取请求追踪 ID
    const requestId = RequestContext.getRequestId();
    const traceId = RequestContext.getTraceId();

    return {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      code,
      // 追踪 ID（便于日志关联）
      ...(requestId && { requestId }),
      ...(traceId && { traceId }),
      ...(details && { details }),
      // 仅在开发环境返回stack trace
      ...(process.env.NODE_ENV === "development" &&
        exception instanceof Error && {
          stack: exception.stack,
        }),
    };
  }

  /**
   * 处理Prisma数据库错误
   */
  private handlePrismaError(error: PrismaClientKnownRequestError) {
    const meta = error.meta;

    switch (error.code) {
      case "P2002":
        // Unique constraint violation
        return {
          status: HttpStatus.CONFLICT,
          message: `Duplicate entry: ${meta?.target || "unknown field"}`,
          code: "DUPLICATE_ERROR",
          details: {
            field: meta?.target,
          },
        };

      case "P2003":
        // Foreign key constraint violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: "Invalid reference: related record not found",
          code: "FOREIGN_KEY_VIOLATION",
          details: {
            field: meta?.field_name,
            constraint: error.message.includes("collections_user_id_fkey")
              ? "User does not exist"
              : "Related record not found",
          },
        };

      case "P2025":
        // Record not found
        return {
          status: HttpStatus.NOT_FOUND,
          message: "Record not found",
          code: "NOT_FOUND",
          details: {
            cause: meta?.cause,
          },
        };

      case "P2014":
        // Relation violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: "Invalid relation: required relation is missing",
          code: "RELATION_VIOLATION",
          details: {
            relation: meta?.relation_name,
          },
        };

      case "P2011":
        // Null constraint violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: "Required field cannot be null",
          code: "NULL_CONSTRAINT_VIOLATION",
          details: {
            field: meta?.target,
          },
        };

      case "P2023":
        // Inconsistent column data
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "数据格式不一致，请联系管理员修复",
          code: "DATA_INCONSISTENCY",
          details: {
            field: meta?.column_name,
            hint: "数据库中存在格式不正确的数据",
          },
        };

      default:
        this.logger.error(
          `Unhandled Prisma error: ${error.code}`,
          error.message,
        );
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Database error occurred",
          code: "DATABASE_ERROR",
          details: {
            prismaCode: error.code,
          },
        };
    }
  }

  /**
   * 记录错误日志
   */
  private logError(
    request: Request,
    errorResponse: ErrorResponse,
    exception: unknown,
  ) {
    const logContext = {
      method: request.method,
      url: request.url,
      statusCode: errorResponse.statusCode,
      code: errorResponse.code,
      message: errorResponse.message,
      ip: request.ip,
      userAgent: request.get("user-agent"),
      userId: (request as unknown as { user?: { id?: string } }).user?.id,
    };

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `Server Error: ${JSON.stringify(logContext)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (
      errorResponse.statusCode === HttpStatus.UNAUTHORIZED ||
      errorResponse.statusCode === HttpStatus.FORBIDDEN
    ) {
      // Unauthenticated/forbidden requests are usually scanners/bots probing
      // protected endpoints. The guard already rejected them; logging every
      // hit at WARN floods the dashboard. Keep them visible at DEBUG only.
      this.logger.debug(`Auth rejected: ${JSON.stringify(logContext)}`);
    } else if (errorResponse.statusCode >= 400) {
      this.logger.warn(`Client Error: ${JSON.stringify(logContext)}`);
    }
  }

  /**
   * 发送错误到监控系统
   * 通过 ErrorTrackingService 持久化错误记录
   */
  private reportToMonitoring(errorResponse: ErrorResponse, exception: unknown) {
    // 记录到本地日志
    this.logger.error(
      `[MONITORING] Critical error: ${errorResponse.code}`,
      JSON.stringify(errorResponse),
    );

    // 通过 ErrorTrackingService 持久化（如果可用）
    if (this.errorTrackingService) {
      const severity = errorResponse.statusCode >= 500 ? "error" : "warning";

      this.errorTrackingService
        .logError({
          errorCode: errorResponse.code,
          errorType: "http_exception",
          message: errorResponse.message,
          severity,
          component: "http",
          stackTrace: exception instanceof Error ? exception.stack : undefined,
          path: errorResponse.path,
          method: errorResponse.method,
          statusCode: errorResponse.statusCode,
          userId: RequestContext.getUserId() || undefined,
          requestId: errorResponse.requestId,
          metadata: {
            traceId: errorResponse.traceId,
            details: errorResponse.details,
          },
        })
        .catch((err: Error) => {
          this.logger.warn(
            `[MONITORING] Failed to track error: ${err.message}`,
          );
        });
    }
  }
}
