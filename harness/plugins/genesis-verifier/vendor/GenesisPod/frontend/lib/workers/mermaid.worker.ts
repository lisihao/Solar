/**
 * Mermaid Web Worker
 *
 * 在 Web Worker 中渲染 Mermaid 图表，避免阻塞主线程
 * 使用方式：通过 useMermaidWorker hook 调用
 */

import { logger } from '@/lib/utils/logger';

// Worker message types
export interface MermaidWorkerRequest {
  id: string;
  chart: string;
}

export interface MermaidWorkerResponse {
  id: string;
  svg?: string;
  error?: string;
}

// Worker 代码（将被转换为 Blob URL）
export const mermaidWorkerCode = `
  let mermaid = null;
  let mermaidInitialized = false;
  let idCounter = 0;

  // 动态导入 mermaid
  async function initMermaid() {
    if (mermaidInitialized) return;

    try {
      // 使用 importScripts 加载 mermaid（CDN 版本）
      importScripts('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js');

      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
        },
        sequence: {
          diagramMarginX: 50,
          diagramMarginY: 10,
          actorMargin: 50,
          width: 150,
          height: 65,
        },
      });

      mermaidInitialized = true;
    } catch (err) {
      throw new Error('Failed to load mermaid: ' + err.message);
    }
  }

  // 处理渲染请求
  self.onmessage = async function(e) {
    const { id, chart } = e.data;

    try {
      await initMermaid();

      const uniqueId = 'mermaid-worker-' + (++idCounter) + '-' + Date.now();
      const cleanChart = chart.trim();

      const { svg } = await mermaid.render(uniqueId, cleanChart);

      self.postMessage({ id, svg });
    } catch (err) {
      self.postMessage({
        id,
        error: err.message || 'Mermaid rendering failed'
      });
    }
  };
`;

/**
 * 创建 Mermaid Worker 实例
 */
export function createMermaidWorker(): Worker | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const blob = new Blob([mermaidWorkerCode], {
      type: 'application/javascript',
    });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    // 清理 Blob URL（Worker 已加载后可以释放）
    worker.addEventListener('error', () => {
      URL.revokeObjectURL(workerUrl);
    });

    return worker;
  } catch (err) {
    logger.error('Failed to create Mermaid worker:', err);
    return null;
  }
}
