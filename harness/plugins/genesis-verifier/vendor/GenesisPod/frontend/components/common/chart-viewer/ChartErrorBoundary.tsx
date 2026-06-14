'use client';

/**
 * ChartErrorBoundary - 图表渲染错误边界
 *
 * 捕获图表渲染过程中的错误，防止单个图表崩溃导致整个页面崩溃
 *
 * @version 1.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ChartErrorBoundaryProps {
  /** 子组件 */
  children: ReactNode;
  /** 图表标题（用于错误信息） */
  chartTitle?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 自定义错误回退组件 */
  fallback?: ReactNode;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * 根据错误类型获取用户友好的错误信息
 */
function getErrorMessageAndSuggestion(error: Error | null): {
  message: string;
  suggestion: string;
} {
  const errorMsg = error?.message?.toLowerCase() || '';

  // 数据格式错误
  if (
    errorMsg.includes('nan') ||
    errorMsg.includes('infinity') ||
    errorMsg.includes('not a number')
  ) {
    return {
      message: '图表数据包含无效数值',
      suggestion: '请检查数据源或重新生成图表',
    };
  }

  // 类型错误
  if (
    errorMsg.includes('undefined') ||
    errorMsg.includes('null') ||
    errorMsg.includes('cannot read')
  ) {
    return {
      message: '图表数据不完整',
      suggestion: '部分数据缺失，请尝试重新加载',
    };
  }

  // 渲染错误
  if (
    errorMsg.includes('render') ||
    errorMsg.includes('svg') ||
    errorMsg.includes('dom')
  ) {
    return {
      message: '图表渲染时出现问题',
      suggestion: '请尝试刷新页面或使用其他浏览器',
    };
  }

  // 网络错误
  if (
    errorMsg.includes('network') ||
    errorMsg.includes('fetch') ||
    errorMsg.includes('load')
  ) {
    return {
      message: '图表资源加载失败',
      suggestion: '请检查网络连接后重试',
    };
  }

  // 默认错误
  return {
    message: error?.message || '图表渲染过程中发生错误',
    suggestion: '请尝试重新加载页面',
  };
}

/**
 * 默认的错误回退组件
 */
function DefaultErrorFallback({
  chartTitle,
  error,
  onRetry,
}: {
  chartTitle?: string;
  error: Error | null;
  onRetry?: () => void;
}) {
  const { message, suggestion } = getErrorMessageAndSuggestion(error);

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6">
      <AlertTriangle className="h-10 w-10 text-red-400" aria-hidden="true" />
      <h4 className="mt-3 text-sm font-medium text-red-800">图表渲染失败</h4>
      {chartTitle && (
        <p className="mt-1 text-xs text-red-600">图表: {chartTitle}</p>
      )}
      <p className="mt-2 max-w-xs text-center text-xs text-red-500">
        {message}
      </p>
      <p className="mt-1 max-w-xs text-center text-xs text-red-400">
        {suggestion}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
          aria-label="重试加载图表"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          重试
        </button>
      )}
    </div>
  );
}

/**
 * 图表错误边界组件
 *
 * 使用方法：
 * <ChartErrorBoundary chartTitle="市场趋势图" onRetry={() => refetch()}>
 *   <ReportChartRenderer chart={chart} />
 * </ChartErrorBoundary>
 */
export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(
    error: Error
  ): Partial<ChartErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // 记录错误日志（生产环境可以发送到错误追踪服务）
    console.error('[ChartErrorBoundary] Chart rendering failed:', {
      chartTitle: this.props.chartTitle,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <DefaultErrorFallback
          chartTitle={this.props.chartTitle}
          error={this.state.error}
          onRetry={this.props.onRetry ? this.handleRetry : undefined}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * 带错误边界的图表渲染包装器 HOC
 */
export function withChartErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  getChartTitle?: (props: P) => string | undefined
) {
  return function ChartWithErrorBoundary(props: P & { onRetry?: () => void }) {
    const chartTitle = getChartTitle?.(props);
    return (
      <ChartErrorBoundary chartTitle={chartTitle} onRetry={props.onRetry}>
        <WrappedComponent {...props} />
      </ChartErrorBoundary>
    );
  };
}

export default ChartErrorBoundary;
