/**
 * MCP JSON-RPC 异常过滤器
 * 将所有异常（包括 Guard 抛出的 401）转换为 JSON-RPC 2.0 错误格式
 * 确保 MCP 客户端始终收到可解析的 JSON-RPC 响应
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { JSON_RPC_ERRORS } from "../abstractions/mcp-server.interface";

/** 自定义 JSON-RPC 错误码（协议保留范围 -32000 ~ -32099） */
const MCP_AUTH_ERROR = { code: -32001, message: "Authentication failed" };

@Catch()
export class MCPExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MCPExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let jsonRpcError: { code: number; message: string } = {
      code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
      message: "Internal error",
    };

    if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message =
        typeof exceptionResponse === "string"
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message ||
            exception.message;

      switch (httpStatus) {
        case HttpStatus.UNAUTHORIZED:
        case HttpStatus.FORBIDDEN:
          jsonRpcError = {
            code: MCP_AUTH_ERROR.code,
            message: String(message),
          };
          break;
        case HttpStatus.BAD_REQUEST:
          jsonRpcError = {
            code: JSON_RPC_ERRORS.INVALID_REQUEST.code,
            message: String(message),
          };
          break;
        default:
          jsonRpcError = {
            code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
            message: String(message),
          };
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `MCP unhandled error: ${exception.message}`,
        exception.stack,
      );
      jsonRpcError = {
        code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
        message: exception.message,
      };
    }

    response.status(httpStatus).json({
      jsonrpc: "2.0",
      id: null,
      error: jsonRpcError,
    });
  }
}
