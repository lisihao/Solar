/**
 * Frontend Logger Utility
 *
 * 统一的前端日志工具，替代 console.log
 * 生产环境自动禁用 debug 日志
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context?: string;
  message: string;
  data?: unknown;
}

class Logger {
  private isDevelopment: boolean;
  private enabledLevels: Set<LogLevel>;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.enabledLevels = new Set(
      this.isDevelopment
        ? ['debug', 'info', 'warn', 'error']
        : ['warn', 'error']
    );
  }

  private log(
    level: LogLevel,
    context: string | undefined,
    message: string,
    data?: unknown
  ) {
    if (!this.enabledLevels.has(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      data,
    };

    const prefix = context ? `[${context}]` : '';
    const logMessage = `${prefix} ${message}`;

    switch (level) {
      case 'debug':
        console.debug(logMessage, data ?? '');
        break;
      case 'info':
        console.info(logMessage, data ?? '');
        break;
      case 'warn':
        console.warn(logMessage, data ?? '');
        break;
      case 'error':
        console.error(logMessage, data ?? '');
        break;
    }
  }

  debug(message: string, data?: unknown): void;
  debug(context: string, message: string, data?: unknown): void;
  debug(
    contextOrMessage: string,
    messageOrData?: string | unknown,
    data?: unknown
  ) {
    if (typeof messageOrData === 'string') {
      this.log('debug', contextOrMessage, messageOrData, data);
    } else {
      this.log('debug', undefined, contextOrMessage, messageOrData);
    }
  }

  info(message: string, data?: unknown): void;
  info(context: string, message: string, data?: unknown): void;
  info(
    contextOrMessage: string,
    messageOrData?: string | unknown,
    data?: unknown
  ) {
    if (typeof messageOrData === 'string') {
      this.log('info', contextOrMessage, messageOrData, data);
    } else {
      this.log('info', undefined, contextOrMessage, messageOrData);
    }
  }

  warn(message: string, data?: unknown): void;
  warn(context: string, message: string, data?: unknown): void;
  warn(
    contextOrMessage: string,
    messageOrData?: string | unknown,
    data?: unknown
  ) {
    if (typeof messageOrData === 'string') {
      this.log('warn', contextOrMessage, messageOrData, data);
    } else {
      this.log('warn', undefined, contextOrMessage, messageOrData);
    }
  }

  error(message: string, error?: unknown): void;
  error(context: string, message: string, error?: unknown): void;
  error(
    contextOrMessage: string,
    messageOrError?: string | unknown,
    error?: unknown
  ) {
    if (typeof messageOrError === 'string') {
      this.log('error', contextOrMessage, messageOrError, error);
    } else {
      this.log('error', undefined, contextOrMessage, messageOrError);
    }
  }
}

export const logger = new Logger();

/**
 * 创建带上下文的 logger 实例
 * @param context 上下文名称
 */
export function createLogger(context: string) {
  return {
    debug: (message: string, data?: unknown) =>
      logger.debug(context, message, data),
    info: (message: string, data?: unknown) =>
      logger.info(context, message, data),
    warn: (message: string, data?: unknown) =>
      logger.warn(context, message, data),
    error: (message: string, error?: unknown) =>
      logger.error(context, message, error),
  };
}
