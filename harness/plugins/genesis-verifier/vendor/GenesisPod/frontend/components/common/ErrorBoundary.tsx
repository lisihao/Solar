'use client';

/**
 * 错误边界组件
 * 捕获React组件树中的错误并显示友好的错误页面
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

import { logger } from '@/lib/utils/logger';

/**
 * 判断是否为 ChunkLoadError（部署新版本后旧 chunk 被删 → 旧客户端 404 → MIME text/html）。
 * 这类错误在 next/dynamic 组件渲染期抛出，会被 ErrorBoundary 捕获（而非 window.onerror），
 * 所以这里也要识别并自动刷新拉取新构建，否则用户看到的是吓人的「出错了」。
 */
function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message || '';
  return (
    error.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /'text\/html'.*not executable/i.test(msg)
  );
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isChunkError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isChunkError: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // ChunkLoadError = 部署新版本后旧客户端引用了已删除的 chunk。自动刷新拉新构建，
    // 不当作崩溃上报、不显示「出错了」。10s 防抖（与 ChunkErrorHandler 共用同一 key）。
    if (isChunkLoadError(error)) {
      logger.warn('[ErrorBoundary] ChunkLoadError，自动刷新拉取新版本…');
      try {
        const key = 'chunk_error_last_reload';
        const last = sessionStorage.getItem(key);
        const now = Date.now();
        if (!last || now - parseInt(last, 10) > 10000) {
          sessionStorage.setItem(key, now.toString());
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
      return;
    }

    // 记录错误到控制台
    logger.error('ErrorBoundary caught an error:', { error, errorInfo });

    // 更新状态
    this.setState({
      error,
      errorInfo,
    });

    // 调用自定义错误处理器
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 发送错误到监控服务
    this.reportErrorToMonitoring(error, errorInfo);
  }

  /**
   * 上报错误到监控服务
   * 预留 Sentry 等错误监控工具的集成接口
   */
  private reportErrorToMonitoring(_error: Error, _errorInfo: ErrorInfo): void {
    // TODO: 集成 Sentry 或其他错误监控服务
    // 示例代码（需要安装 @sentry/react）:
    /*
    import * as Sentry from '@sentry/react';
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
    */

    // 当前仅记录日志，生产环境可在此上报到后端
    if (process.env.NODE_ENV === 'production') {
      // 可以在这里调用 API 将错误发送到后端
      // fetch('/api/errors/report', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     message: error.message,
      //     stack: error.stack,
      //     componentStack: errorInfo.componentStack,
      //     timestamp: new Date().toISOString(),
      //     userAgent: navigator.userAgent,
      //     url: window.location.href,
      //   }),
      // }).catch(err => logger.error('Failed to report error:', err));
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // ChunkLoadError：刷新已在 componentDidCatch 触发，这里只显示轻量加载态，
      // 不显示「出错了」（避免吓人 + 避免误导，因为这只是版本更新）。
      if (this.state.isChunkError) {
        return (
          <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm text-gray-600">正在加载新版本…</p>
          </div>
        );
      }

      // 如果提供了自定义fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认错误UI
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-8 shadow-lg">
            {/* 错误图标 */}
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-10 w-10 text-red-600" />
              </div>
            </div>

            {/* 错误标题 */}
            <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
              出错了
            </h1>
            <p className="mb-6 text-center text-gray-600">
              应用遇到了一个意外错误。我们已经记录了这个问题，会尽快修复。
            </p>

            {/* 2026-05-11: 错误详情 prod 也显示（可折叠），让 admin 能复制
                stack 给 debug，避免 prod ErrorBoundary 吞掉错误细节导致定位困难 */}
            {this.state.error && (
              <details className="mb-6 rounded-lg bg-red-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-red-900">
                  展开错误详情（复制后发给技术支持）
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-red-800">
                  {this.state.error.toString()}
                </pre>
                {this.state.error.stack && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] text-red-700">
                    {this.state.error.stack}
                  </pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-red-900">
                      组件堆栈
                    </summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] text-red-700">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </details>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={this.handleReset}
                className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
              >
                <RefreshCw className="h-5 w-5" />
                重试
              </button>

              <button
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 rounded-lg border-2 border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <RefreshCw className="h-5 w-5" />
                刷新页面
              </button>

              <button
                onClick={this.handleGoHome}
                className="flex items-center justify-center gap-2 rounded-lg border-2 border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Home className="h-5 w-5" />
                返回首页
              </button>
            </div>

            {/* 帮助信息 */}
            <div className="mt-6 border-t border-gray-200 pt-6">
              <p className="text-center text-sm text-gray-500">
                如果问题持续存在，请联系技术支持或{' '}
                <a
                  href="https://github.com/anthropics/claude-code/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  提交问题反馈
                </a>
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 用于函数组件的错误边界Hook
 */
export function useErrorHandler(): (error: Error) => void {
  const [, setError] = React.useState<Error | null>(null);

  return React.useCallback((error: Error) => {
    setError(() => {
      throw error;
    });
  }, []);
}

export default ErrorBoundary;
