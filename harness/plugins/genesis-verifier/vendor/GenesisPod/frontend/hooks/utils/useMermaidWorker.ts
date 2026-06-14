'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { logger } from '@/lib/utils/logger';
import {
  createMermaidWorker,
  MermaidWorkerRequest,
  MermaidWorkerResponse,
} from '@/lib/workers/mermaid.worker';

interface RenderResult {
  svg: string | null;
  error: string | null;
  isLoading: boolean;
}

interface PendingRequest {
  resolve: (svg: string) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

// 全局 Worker 实例（共享）
let sharedWorker: Worker | null = null;
const pendingRequests: Map<string, PendingRequest> = new Map();
let requestIdCounter = 0;

/**
 * 获取或创建共享的 Mermaid Worker
 */
function getSharedWorker(): Worker | null {
  if (typeof window === 'undefined') return null;

  if (!sharedWorker) {
    sharedWorker = createMermaidWorker();

    if (sharedWorker) {
      sharedWorker.onmessage = (e: MessageEvent<MermaidWorkerResponse>) => {
        const { id, svg, error } = e.data;
        const pending = pendingRequests.get(id);

        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingRequests.delete(id);

          if (error) {
            pending.reject(new Error(error));
          } else if (svg) {
            pending.resolve(svg);
          }
        }
      };

      sharedWorker.onerror = (err) => {
        logger.error('Mermaid Worker error:', err);
        // 拒绝所有挂起的请求，触发回退渲染
        pendingRequests.forEach((pending, id) => {
          clearTimeout(pending.timeoutId);
          pending.reject(
            new Error('Worker not available, falling back to main thread')
          );
        });
        pendingRequests.clear();
        // 重置 Worker
        sharedWorker?.terminate();
        sharedWorker = null;
      };
    }
  }

  return sharedWorker;
}

/**
 * 使用 Web Worker 渲染 Mermaid 图表
 *
 * @param chart - Mermaid 图表代码
 * @param timeout - 超时时间（毫秒），默认 10000
 * @returns { svg, error, isLoading }
 */
export function useMermaidWorker(
  chart: string,
  timeout: number = 10000
): RenderResult {
  const [result, setResult] = useState<RenderResult>({
    svg: null,
    error: null,
    isLoading: true,
  });

  const chartRef = useRef(chart);

  useEffect(() => {
    if (!chart) {
      setResult({ svg: null, error: null, isLoading: false });
      return;
    }

    chartRef.current = chart;
    setResult({ svg: null, error: null, isLoading: true });

    const worker = getSharedWorker();

    if (!worker) {
      // Worker 不可用，回退到主线程渲染
      setResult({
        svg: null,
        error: 'Worker not available, falling back to main thread',
        isLoading: false,
      });
      return;
    }

    const requestId = `req-${++requestIdCounter}-${Date.now()}`;

    // 设置超时
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      if (chartRef.current === chart) {
        setResult({
          svg: null,
          error: '图表渲染超时，请检查语法是否正确',
          isLoading: false,
        });
      }
    }, timeout);

    // 创建 Promise 并注册
    const promise = new Promise<string>((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject, timeoutId });
    });

    // 发送渲染请求
    const request: MermaidWorkerRequest = { id: requestId, chart };
    worker.postMessage(request);

    // 处理结果
    promise
      .then((svg) => {
        if (chartRef.current === chart) {
          setResult({ svg, error: null, isLoading: false });
        }
      })
      .catch((err) => {
        if (chartRef.current === chart) {
          setResult({ svg: null, error: err.message, isLoading: false });
        }
      });

    return () => {
      // 清理：取消挂起的请求
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingRequests.delete(requestId);
      }
    };
  }, [chart, timeout]);

  return result;
}

/**
 * 直接渲染 Mermaid 图表（Promise 版本）
 */
export async function renderMermaidAsync(
  chart: string,
  timeout: number = 10000
): Promise<string> {
  const worker = getSharedWorker();

  if (!worker) {
    throw new Error('Worker not available');
  }

  const requestId = `req-${++requestIdCounter}-${Date.now()}`;

  return new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Rendering timeout'));
    }, timeout);

    pendingRequests.set(requestId, { resolve, reject, timeoutId });

    const request: MermaidWorkerRequest = { id: requestId, chart };
    worker.postMessage(request);
  });
}

export default useMermaidWorker;
