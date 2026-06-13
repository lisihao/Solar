import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Reflector } from "@nestjs/core";

/**
 * 跳过响应转换的装饰器 key
 */
export const SKIP_TRANSFORM_KEY = "skipTransform";

/**
 * 标准化 API 响应格式
 */
export interface StandardResponse<T = unknown> {
  success: boolean;
  data: T;
  metadata: {
    requestId: string;
    timestamp: string;
    duration: number;
  };
}

/**
 * 响应转换拦截器
 * 将所有响应转换为统一格式
 */
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  StandardResponse<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    // 检查是否跳过转换
    const skipTransform = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipTransform) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const requestId =
      request.headers["x-request-id"] ||
      `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const startTime = Date.now();

    // 设置请求 ID 到响应头
    const response = context.switchToHttp().getResponse();
    response.setHeader("X-Request-Id", requestId);

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        },
      })),
    );
  }
}

/**
 * 分页响应格式
 */
export interface PaginatedResponse<T = unknown> {
  success: boolean;
  data: {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
    totalPages: number;
  };
  metadata: {
    requestId: string;
    timestamp: string;
    duration: number;
  };
}

/**
 * 创建分页响应的辅助函数
 */
export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Omit<PaginatedResponse<T>["data"], never> {
  const totalPages = Math.ceil(total / pageSize);
  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page < totalPages,
    totalPages,
  };
}
