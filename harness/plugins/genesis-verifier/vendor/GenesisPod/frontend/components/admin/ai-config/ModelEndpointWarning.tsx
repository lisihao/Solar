'use client';

/**
 * ModelEndpointWarning —— 2026-05-11 P8 柔性提示组件
 *
 * 检查 modelType 与 endpoint 后缀是否匹配，不匹配时显示黄色警告。
 * 不拦截，admin 自检。填错时连接测试会返回远端 4xx 错误。
 *
 * 拆自 AIModelSettings.tsx (god-class 3047 行)，让 god-class guard 通过
 * + 让其它表单（如 P9 ProviderDiscoverModal）也能复用。
 */

interface Props {
  modelType: string;
  apiEndpoint: string;
}

function inferWarning(modelType: string, apiEndpoint: string): string | null {
  const ep = (apiEndpoint || '').toLowerCase();
  if (!ep) return null;
  if (modelType === 'RERANK' && !ep.includes('rerank')) {
    return '当前 modelType=RERANK，但 endpoint 不含 /rerank。Cohere/Voyage/Jina 的 rerank 通常用 /v1/rerank 路径。';
  }
  if (
    modelType === 'EMBEDDING' &&
    !ep.includes('embed') &&
    !ep.includes('embeddings')
  ) {
    return '当前 modelType=EMBEDDING，但 endpoint 不含 /embeddings 或 /embed。';
  }
  if (
    (modelType === 'CHAT' ||
      modelType === 'CHAT_FAST' ||
      modelType === 'CODE') &&
    !ep.includes('chat') &&
    !ep.includes('messages') &&
    !ep.includes('generatecontent')
  ) {
    return '当前 modelType=CHAT/CHAT_FAST/CODE，但 endpoint 看起来不像 chat 路径（应含 /chat/completions / /messages / :generateContent）。';
  }
  return null;
}

export function ModelEndpointWarning({ modelType, apiEndpoint }: Props) {
  const warning = inferWarning(modelType, apiEndpoint);
  if (!warning) return null;
  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-800">
      <strong>提示：</strong>
      {warning}填错时连接测试会返回远端 4xx 错误。
    </div>
  );
}
