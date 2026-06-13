/**
 * Tracing Decorator - 方法级别追踪装饰器
 *
 * 提供简单的方法执行追踪能力：
 * - 自动记录方法入口/出口
 * - 记录执行时间
 * - 记录异常信息
 * - 支持嵌套调用追踪
 *
 * 设计原则：
 * - 轻量级实现，无需外部依赖（如 OpenTelemetry）
 * - 通过 Logger 输出追踪信息
 * - 支持 trace ID 传递
 */

import { Logger } from "@nestjs/common";
import { randomUUID } from "crypto";

// ============================================================================
// Trace Context
// ============================================================================

/**
 * 追踪上下文
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  attributes: Record<string, unknown>;
}

/**
 * 追踪上下文存储（使用 AsyncLocalStorage 更理想，但这里简化处理）
 */
const traceContextStack: TraceContext[] = [];

/**
 * 生成短 ID
 */
function generateShortId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * 获取当前追踪上下文
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  return traceContextStack[traceContextStack.length - 1];
}

/**
 * 获取当前 Trace ID
 */
export function getCurrentTraceId(): string | undefined {
  return getCurrentTraceContext()?.traceId;
}

// ============================================================================
// Trace Decorator
// ============================================================================

/**
 * Trace 装饰器选项
 */
export interface TraceOptions {
  /** 操作名称，默认使用方法名 */
  operationName?: string;
  /** 是否记录参数 */
  logArgs?: boolean;
  /** 是否记录返回值 */
  logResult?: boolean;
  /** 额外属性 */
  attributes?: Record<string, unknown>;
}

/**
 * @Trace 装饰器
 *
 * 用于追踪方法执行，自动记录：
 * - 开始时间
 * - 结束时间
 * - 执行耗时
 * - 异常信息
 *
 * @example
 * ```typescript
 * class MyService {
 *   @Trace()
 *   async processData(input: string) {
 *     // ...
 *   }
 *
 *   @Trace({ operationName: 'CustomOperation', logArgs: true })
 *   async customMethod(data: any) {
 *     // ...
 *   }
 * }
 * ```
 */
export function Trace(options: TraceOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const logger = new Logger(`Trace:${className}`);

    descriptor.value = async function (...args: unknown[]) {
      const operationName =
        options.operationName || `${className}.${propertyKey}`;
      const parentContext = getCurrentTraceContext();

      // 创建新的追踪上下文
      const context: TraceContext = {
        traceId: parentContext?.traceId || generateShortId(),
        spanId: generateShortId(),
        parentSpanId: parentContext?.spanId,
        operationName,
        startTime: Date.now(),
        attributes: { ...options.attributes },
      };

      traceContextStack.push(context);

      // 构建日志前缀
      const logPrefix = `[${context.traceId}:${context.spanId}]`;
      const parentInfo = context.parentSpanId
        ? ` (parent: ${context.parentSpanId})`
        : "";

      // 记录开始
      if (options.logArgs && args.length > 0) {
        logger.debug(`${logPrefix} START ${operationName}${parentInfo}`, {
          args: sanitizeArgs(args),
        });
      } else {
        logger.debug(`${logPrefix} START ${operationName}${parentInfo}`);
      }

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - context.startTime;

        // 记录成功完成
        if (options.logResult && result !== undefined) {
          logger.debug(`${logPrefix} END ${operationName} (${duration}ms)`, {
            result: sanitizeResult(result),
          });
        } else {
          logger.debug(`${logPrefix} END ${operationName} (${duration}ms)`);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - context.startTime;

        // 记录异常
        logger.error(
          `${logPrefix} ERROR ${operationName} (${duration}ms): ${error instanceof Error ? error.message : "Unknown error"}`,
        );

        throw error;
      } finally {
        traceContextStack.pop();
      }
    };

    return descriptor;
  };
}

// ============================================================================
// TraceSync Decorator (for synchronous methods)
// ============================================================================

/**
 * @TraceSync 装饰器 - 用于同步方法
 */
export function TraceSync(options: TraceOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const logger = new Logger(`Trace:${className}`);

    descriptor.value = function (...args: unknown[]) {
      const operationName =
        options.operationName || `${className}.${propertyKey}`;
      const parentContext = getCurrentTraceContext();

      const context: TraceContext = {
        traceId: parentContext?.traceId || generateShortId(),
        spanId: generateShortId(),
        parentSpanId: parentContext?.spanId,
        operationName,
        startTime: Date.now(),
        attributes: { ...options.attributes },
      };

      traceContextStack.push(context);
      const logPrefix = `[${context.traceId}:${context.spanId}]`;

      logger.debug(`${logPrefix} START ${operationName}`);

      try {
        const result = originalMethod.apply(this, args);
        const duration = Date.now() - context.startTime;
        logger.debug(`${logPrefix} END ${operationName} (${duration}ms)`);
        return result;
      } catch (error) {
        const duration = Date.now() - context.startTime;
        logger.error(
          `${logPrefix} ERROR ${operationName} (${duration}ms): ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        throw error;
      } finally {
        traceContextStack.pop();
      }
    };

    return descriptor;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 清理参数以便安全记录（移除敏感信息、截断长字符串）
 */
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeValue(arg));
}

/**
 * 清理返回值以便安全记录
 */
function sanitizeResult(result: unknown): unknown {
  return sanitizeValue(result);
}

/**
 * 清理单个值
 */
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[Too Deep]";

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    // 截断长字符串
    if (value.length > 200) {
      return value.slice(0, 200) + "...[truncated]";
    }
    // 隐藏可能的敏感信息
    if (
      value.toLowerCase().includes("password") ||
      value.toLowerCase().includes("token") ||
      value.toLowerCase().includes("secret") ||
      value.toLowerCase().includes("key")
    ) {
      return "[REDACTED]";
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 10) {
      return [
        ...value.slice(0, 10).map((v) => sanitizeValue(v, depth + 1)),
        `...(${value.length - 10} more)`,
      ];
    }
    return value.map((v) => sanitizeValue(v, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    const keys = Object.keys(obj);

    if (keys.length > 20) {
      // 太多属性，只保留部分
      for (const key of keys.slice(0, 20)) {
        sanitized[key] = sanitizeValue(obj[key], depth + 1);
      }
      sanitized["..."] = `(${keys.length - 20} more properties)`;
    } else {
      for (const key of keys) {
        // 跳过敏感字段
        if (
          key.toLowerCase().includes("password") ||
          key.toLowerCase().includes("token") ||
          key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("apikey")
        ) {
          sanitized[key] = "[REDACTED]";
        } else {
          sanitized[key] = sanitizeValue(obj[key], depth + 1);
        }
      }
    }
    return sanitized;
  }

  return "[Unsupported Type]";
}

// ============================================================================
// Manual Span API (for non-decorator usage)
// ============================================================================

/**
 * 手动创建追踪 Span
 *
 * @example
 * ```typescript
 * const span = startSpan('CustomOperation');
 * try {
 *   // do work
 *   span.end();
 * } catch (error) {
 *   span.error(error);
 *   throw error;
 * }
 * ```
 */
export function startSpan(
  operationName: string,
  attributes?: Record<string, unknown>,
): {
  end: () => void;
  error: (error: unknown) => void;
  addAttribute: (key: string, value: unknown) => void;
  context: TraceContext;
} {
  const logger = new Logger("Trace:Manual");
  const parentContext = getCurrentTraceContext();

  const context: TraceContext = {
    traceId: parentContext?.traceId || generateShortId(),
    spanId: generateShortId(),
    parentSpanId: parentContext?.spanId,
    operationName,
    startTime: Date.now(),
    attributes: { ...attributes },
  };

  traceContextStack.push(context);

  const logPrefix = `[${context.traceId}:${context.spanId}]`;
  logger.debug(`${logPrefix} START ${operationName}`);

  return {
    context,

    addAttribute(key: string, value: unknown) {
      context.attributes[key] = value;
    },

    end() {
      const duration = Date.now() - context.startTime;
      logger.debug(`${logPrefix} END ${operationName} (${duration}ms)`);
      traceContextStack.pop();
    },

    error(error: unknown) {
      const duration = Date.now() - context.startTime;
      logger.error(
        `${logPrefix} ERROR ${operationName} (${duration}ms): ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      traceContextStack.pop();
    },
  };
}
