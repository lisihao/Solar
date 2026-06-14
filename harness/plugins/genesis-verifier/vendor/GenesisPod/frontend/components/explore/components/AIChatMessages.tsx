'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AIMessage } from '../utils/types';
import { extractImagesFromMarkdown } from '../utils';
import { Base64Image } from '../resources/Base64Image';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import { useTranslation } from '@/lib/i18n/i18n-context';
import { ClientDate } from '@/components/common/ClientDate';
import type { AIModel } from '@/hooks';

interface AIChatMessagesProps {
  aiMessages: AIMessage[];
  isStreaming: boolean;
  aiModel: string;
  aiModels: AIModel[];
  resourceId?: string;
  onContextMenu?: (e: React.MouseEvent, text: string) => void;
  onAskAI?: (text: string) => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
}

export default function AIChatMessages({
  aiMessages,
  isStreaming,
  aiModel,
  aiModels,
  resourceId,
  onContextMenu,
  onAskAI,
  chatEndRef,
}: AIChatMessagesProps) {
  const { t } = useTranslation();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = (content: string, index: number) => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopiedIndex(index);
        copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 1500);
      })
      .catch(() => {});
  };

  return (
    <TextSelectionToolbar
      resourceId={resourceId}
      onAskAI={onAskAI}
      onAddToNotes={(text) => {
        onContextMenu?.({} as React.MouseEvent<Element, MouseEvent>, text);
      }}
    >
      <div className="space-y-3 border-t border-gray-200 pt-4">
        {aiMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`group relative rounded-lg px-3 py-2 ${
                msg.role === 'user'
                  ? 'max-w-[80%] bg-gradient-to-br from-red-500 to-red-600 text-white'
                  : 'w-full cursor-text select-text bg-gray-100 text-gray-800'
              }`}
            >
              {/* Copy button — AI messages only */}
              {msg.role === 'assistant' && (
                <button
                  onClick={() => handleCopy(msg.content, i)}
                  className="absolute right-2 top-2 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100"
                  title={copiedIndex === i ? '已复制' : '复制'}
                >
                  {copiedIndex === i ? (
                    <svg
                      className="h-3.5 w-3.5 text-green-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </button>
              )}
              <div className="prose prose-sm !max-w-none text-sm leading-relaxed [&>*]:my-1 [&>ol]:my-1 [&>ol]:list-decimal [&>ol]:pl-5 [&>p]:my-1 [&>ul]:my-1 [&>ul]:list-disc [&>ul]:pl-5 [&_li]:my-0.5">
                {(() => {
                  const { images, textContent } = extractImagesFromMarkdown(
                    msg.content
                  );
                  return (
                    <div>
                      {images.map((img, idx) => (
                        <Base64Image key={idx} src={img.src} alt={img.alt} />
                      ))}
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {textContent}
                      </ReactMarkdown>
                    </div>
                  );
                })()}
              </div>
              <div
                className={`mt-1 text-[10px] ${
                  msg.role === 'user' ? 'text-red-100' : 'text-gray-500'
                }`}
              >
                <ClientDate date={msg.timestamp} format="time" />
              </div>
            </div>
          </div>
        ))}

        {/* Inline Loading Message */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="w-full rounded-lg bg-gray-100 px-3 py-2 text-gray-900">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-red-600"></div>
                <p className="text-xs">
                  {(aiModels.find((m) => m.modelId === aiModel)
                    ?.name as string) || aiModel}{' '}
                  {t('explore.aiPanel.thinking') || 'is thinking...'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>
    </TextSelectionToolbar>
  );
}
