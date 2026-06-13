/**
 * 统一的 API 客户端
 *
 * 提供：
 * 1. 基础 HTTP 请求封装
 * 2. SSE 流式响应支持
 * 3. 错误处理
 * 4. 请求重试
 * 5. 类型安全
 */

import { config } from '../utils/config';
import { getAuthTokens, refreshAccessToken, logout } from '../utils/auth';
import { logger } from '@/lib/utils/logger';
// ==================== 类型定义 ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface SSEEvent<T = unknown> {
  type: string;
  data: T;
  timestamp: string;
  id?: string;
}

export interface SSEProgressEvent {
  type: 'progress';
  phase: string;
  progress: number;
  message: string;
  current?: number;
  total?: number;
}

export interface SSECompleteEvent<T = unknown> {
  type: 'complete';
  result: T;
  totalTime?: number;
}

export interface SSEErrorEvent {
  type: 'error';
  error: string;
  code?: string;
  recoverable?: boolean;
}

export type SSEHandler<T = unknown> = {
  onProgress?: (event: SSEProgressEvent) => void;
  onComplete?: (event: SSECompleteEvent<T>) => void;
  onError?: (event: SSEErrorEvent) => void;
  onEvent?: (event: SSEEvent) => void;
};

// ==================== API 客户端类 ====================

class ApiClient {
  /** Dynamic getter — config.apiUrl resolves differently per environment */
  private get baseUrl(): string {
    return config.apiUrl;
  }

  /**
   * 发送 GET 请求
   */
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * 发送 POST 请求
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  /**
   * 发送 PUT 请求
   */
  async put<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  /**
   * 发送 DELETE 请求
   */
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * 发送 PATCH 请求
   */
  async patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  /**
   * 上传文件
   */
  async upload<T>(
    path: string,
    formData: FormData,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: formData,
      // 不设置 Content-Type，让浏览器自动处理 multipart/form-data
      // 认证头会在 request 方法中自动添加
    });
  }

  /**
   * 获取认证头
   */
  private getAuthHeaders(): Record<string, string> {
    const tokens = getAuthTokens();
    if (tokens?.accessToken) {
      return { Authorization: `Bearer ${tokens.accessToken}` };
    }
    return {};
  }

  /**
   * 基础请求方法
   */
  private async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      timeout = 30000,
      retries = 0,
      retryDelay = 1000,
      signal: externalSignal,
      ...init
    } = options;
    const url = this.buildUrl(path);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // 使用外部传入的 signal，或创建新的用于超时控制
        const controller = new AbortController();
        // 传具体 reason，否则浏览器抛 "signal is aborted without reason"，
        // UI 无法区分超时与组件卸载/用户取消。
        const timeoutId = setTimeout(
          () =>
            controller.abort(
              new DOMException(
                `Request timeout after ${timeout}ms`,
                'TimeoutError'
              )
            ),
          timeout
        );

        // 如果外部 signal 被 abort，也 abort 内部 controller（同样带 reason）
        if (externalSignal) {
          externalSignal.addEventListener('abort', () => {
            controller.abort(
              externalSignal.reason ??
                new DOMException('Request aborted by caller', 'AbortError')
            );
            clearTimeout(timeoutId);
          });
        }

        // 合并认证头
        const headers = {
          ...this.getAuthHeaders(),
          ...init.headers,
        };

        const response = await fetch(url, {
          ...init,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Handle 401 Unauthorized - try to refresh token
          if (response.status === 401) {
            // ★ 未登录用户不要进 refresh→logout→hard reload 循环：
            // 没有 token 时直接抛 401，让调用方处理（unauth 页面正常渲染登录引导）。
            // 否则 Sidebar/banner 等组件在未登录状态下打 401 会触发 window.location.href='/'，
            // 而 / 又重定向回 /ai-ask，造成持续刷新闪烁。
            const existingTokens = getAuthTokens();
            if (!existingTokens?.accessToken) {
              throw this.createApiError(
                'Authentication required',
                'UNAUTHENTICATED',
                401,
                {}
              );
            }
            const newTokens = await refreshAccessToken();
            if (newTokens) {
              // Retry the request with new token
              const retryHeaders = {
                ...init.headers,
                Authorization: `Bearer ${newTokens.accessToken}`,
              };
              const retryResponse = await fetch(url, {
                ...init,
                headers: retryHeaders,
                signal: controller.signal,
              });

              if (retryResponse.ok) {
                const text = await retryResponse.text();
                if (!text) return {} as T;
                const parsed = JSON.parse(text);
                if (
                  parsed &&
                  typeof parsed === 'object' &&
                  'success' in parsed &&
                  'data' in parsed
                ) {
                  const otherKeys = Object.keys(parsed).filter(
                    (k) =>
                      !['success', 'data', 'metadata', 'message'].includes(k)
                  );
                  if (otherKeys.length === 0) {
                    return parsed.data as T;
                  }
                }
                return parsed as T;
              }

              // If retry also fails with 401, log out user
              if (retryResponse.status === 401) {
                logger.warn(
                  '[API Client] Token refresh succeeded but request still unauthorized, logging out'
                );
                logout();
                throw this.createApiError(
                  'Session expired. Please sign in again.',
                  'SESSION_EXPIRED',
                  401,
                  {}
                );
              }
            } else {
              // Token refresh failed, log out user
              logger.warn('[API Client] Token refresh failed, logging out');
              logout();
              throw this.createApiError(
                'Session expired. Please sign in again.',
                'SESSION_EXPIRED',
                401,
                {}
              );
            }
          }

          const errorData = await response.json().catch(() => ({}));
          const apiErr = this.createApiError(
            errorData.message || response.statusText,
            errorData.code,
            response.status,
            errorData
          );
          // BYOK 错误统一发布到全局事件，由 GlobalByokErrorModal 呈现引导页面
          // 即便调用方自己 catch 吞了错误，UI 也能给出一致反馈
          const BYOK_CODES = [
            'NO_AVAILABLE_KEY',
            'NO_MODEL_CONFIGURED',
            'NO_SYSTEM_KEY',
            'QUOTA_EXCEEDED',
            'INVALID_API_KEY',
            'KEY_EXPIRED',
          ];
          if (
            response.status === 403 &&
            typeof errorData.code === 'string' &&
            BYOK_CODES.includes(errorData.code)
          ) {
            // 动态 import 避免在 SSR 阶段引入 window
            void import('@/lib/byok/event-bus').then((m) =>
              m.publishByokError(apiErr)
            );
            // INVALID_API_KEY: 额外 toast，让用户第一时间看到提示（§15 错误 UX）
            if (errorData.code === 'INVALID_API_KEY') {
              const provider: string = (errorData.meta as { provider?: string })?.provider ?? '';
              void import('@/stores').then((m) => {
                const providerLabel = provider ? `${provider} ` : '';
                m.toast.error(`${providerLabel}Key 鉴权失败，请检查`);
              });
            }
          }

          // 缺 Key / 未配置 Key 引导：message 匹配常见后端错误文案（§15 错误 UX）
          const msg: string = errorData.message ?? '';
          const NO_KEY_PATTERNS = [
            'NoToolKeyError',
            'No API Key available',
            '未配置',
            '需先配置',
          ];
          if (NO_KEY_PATTERNS.some((p) => msg.includes(p))) {
            void import('@/stores').then((m) =>
              m.toast.error('Key 未配置，请前往「我的 API Keys」或「我的工具」添加')
            );
          }

          throw apiErr;
        }

        // 如果响应为空，返回空对象
        const text = await response.text();
        if (!text) {
          return {} as T;
        }

        const parsed = JSON.parse(text);

        // 自动解包标准响应格式 { success: true, data: T }
        // 只有当 data 是唯一的数据字段时才解包（排除分页等额外字段）
        // 这样前端 hooks 可以直接使用 data，而不用处理 wrapper
        if (
          parsed &&
          typeof parsed === 'object' &&
          'success' in parsed &&
          'data' in parsed
        ) {
          // 检查除了 success, data, metadata 之外是否还有其他字段
          const otherKeys = Object.keys(parsed).filter(
            (k) => !['success', 'data', 'metadata', 'message'].includes(k)
          );

          // 只有在没有其他字段时才解包（如分页响应有 total, hasMore 等）
          if (otherKeys.length === 0) {
            return parsed.data as T;
          }
        }

        return parsed as T;
      } catch (error) {
        lastError = error as Error;

        // 如果是最后一次重试，抛出错误
        if (attempt === retries) {
          throw lastError;
        }

        // 等待后重试
        await this.sleep(retryDelay * Math.pow(2, attempt));
      }
    }

    throw lastError;
  }

  /**
   * 创建 SSE 连接
   */
  createSSEStream<T = unknown>(
    path: string,
    handlers: SSEHandler<T>
  ): {
    eventSource: EventSource;
    close: () => void;
  } {
    const url = this.buildUrl(path);
    const eventSource = new EventSource(url);

    // 定义需要监听的事件类型
    const eventTypes = [
      'progress',
      'complete',
      'error',
      'heartbeat',
      'chunk',
      'message',
    ];

    const handleEvent = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);

        // 调用通用事件处理器
        handlers.onEvent?.(parsed);

        // 根据类型调用特定处理器
        if (parsed.type === 'progress' && handlers.onProgress) {
          handlers.onProgress(parsed.data || parsed);
        } else if (parsed.type === 'complete' && handlers.onComplete) {
          handlers.onComplete(parsed.data || parsed);
        } else if (parsed.type === 'error' && handlers.onError) {
          handlers.onError(parsed.data || parsed);
        }
      } catch (e) {
        logger.error('[ApiClient] SSE parse error:', e);
      }
    };

    // 监听所有事件类型
    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, handleEvent);
    });

    // 也监听默认的 message 事件
    eventSource.onmessage = handleEvent;

    // 错误处理
    eventSource.onerror = () => {
      handlers.onError?.({
        type: 'error',
        error: 'SSE connection error',
        recoverable: false,
      });
    };

    return {
      eventSource,
      close: () => {
        eventTypes.forEach((type) => {
          eventSource.removeEventListener(type, handleEvent);
        });
        eventSource.close();
      },
    };
  }

  /**
   * POST 请求并返回 SSE 流 (使用 fetch)
   */
  async postSSEStream<T = unknown>(
    path: string,
    body: unknown,
    handlers: SSEHandler<T>
  ): Promise<{ close: () => void }> {
    const url = this.buildUrl(path);
    const controller = new AbortController();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.createApiError(
          errorData.message || response.statusText,
          errorData.code,
          response.status
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                try {
                  const parsed = JSON.parse(data);
                  handlers.onEvent?.(parsed);

                  if (parsed.type === 'progress') {
                    handlers.onProgress?.(parsed.data || parsed);
                  } else if (parsed.type === 'complete') {
                    handlers.onComplete?.(parsed.data || parsed);
                  } else if (parsed.type === 'error') {
                    handlers.onError?.(parsed.data || parsed);
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            handlers.onError?.({
              type: 'error',
              error: (error as Error).message,
              recoverable: false,
            });
          }
        }
      };

      processStream();

      return {
        close: () => controller.abort(),
      };
    } catch (error) {
      handlers.onError?.({
        type: 'error',
        error: (error as Error).message,
        recoverable: false,
      });
      return { close: () => {} };
    }
  }

  /**
   * 构建完整 URL
   */
  private buildUrl(path: string): string {
    // 如果已经是完整 URL，直接返回
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // 确保路径以 / 开头
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalizedPath}`;
  }

  /**
   * 创建 API 错误
   */
  private createApiError(
    message: string,
    code?: string,
    status?: number,
    details?: unknown
  ): ApiError {
    return {
      message,
      code,
      status,
      details,
    };
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 导出单例
export const apiClient = new ApiClient();

// 导出类型和方法
export default apiClient;
