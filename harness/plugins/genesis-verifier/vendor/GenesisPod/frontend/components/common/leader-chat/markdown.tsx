/**
 * LeaderChat 内置 Markdown 渲染组件
 * 抽自 agent-playground/LeaderChatModal MD_COMPONENTS
 */

import type { ReactNode } from 'react';

export const LEADER_CHAT_MD_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-1.5 mt-2 text-[14px] font-semibold">{children}</h3>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h4 className="mb-1 mt-2 text-[13px] font-semibold">{children}</h4>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h5 className="mb-1 mt-2 text-[12px] font-semibold">{children}</h5>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
    return safe ? (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-700"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  code: ({ children }: { children?: ReactNode }) => (
    <code className="font-mono rounded bg-gray-100 px-1 py-0.5 text-[11px]">
      {children}
    </code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="font-mono my-2 overflow-x-auto rounded bg-gray-900 p-2 text-[11px] text-gray-100">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-violet-300 bg-violet-50/40 px-2 py-1 text-gray-700">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-[11px]">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-gray-200 px-2 py-1 align-top">{children}</td>
  ),
};
