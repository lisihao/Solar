'use client';

import { useState, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import ClientDate from '@/components/common/ClientDate';
import { logger } from '@/lib/utils/logger';
interface AIExplanation {
  text: string;
  explanation: string;
  timestamp: string;
}

interface AIAssistantProps {
  noteId: string;
  existingInsights?: {
    explanations?: AIExplanation[];
  };
  onExplanationAdded?: (explanation: AIExplanation) => void;
  pdfContext?: string; // PDF文本内容
}

/**
 * AI助手组件
 *
 * 功能：
 * - 选择文本并请求AI解释
 * - 显示AI生成的解释
 * - 保存解释历史
 * - 显示先前的解释
 */
export default function AIAssistant({
  noteId,
  existingInsights,
  onExplanationAdded,
  pdfContext,
}: AIAssistantProps) {
  const [selectedText, setSelectedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentExplanation, setCurrentExplanation] =
    useState<AIExplanation | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explanations = existingInsights?.explanations || [];

  // Request AI explanation
  const requestExplanation = useCallback(
    async (text?: string) => {
      const textToExplain = text || selectedText;
      if (!textToExplain.trim()) {
        setError('请输入或选择文本');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/notes/${noteId}/ai-explain`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
              text: textToExplain,
              pdfContext: pdfContext || undefined,
            }),
          }
        );

        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: {...} }
          const explanation = result?.data ?? result;
          setCurrentExplanation(explanation);
          onExplanationAdded?.(explanation);
          setSelectedText('');
        } else {
          const errorData = await response.json();
          setError(errorData.message || 'AI服务暂时不可用');
        }
      } catch (err) {
        logger.error('Failed to get AI explanation:', err);
        setError('请求失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [noteId, selectedText, onExplanationAdded]
  );

  // Get explanation from selection
  const handleGetSelectionExplanation = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text) {
      setSelectedText(text);
      requestExplanation(text);
    } else {
      setError('请先选择文本');
    }
  }, [requestExplanation]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-purple-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">AI助手</h3>
          </div>

          {explanations.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs font-medium text-purple-600 hover:text-purple-800"
            >
              {showHistory ? '隐藏' : '查看'} 历史 ({explanations.length})
            </button>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="p-4">
        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            输入文本或选择文本后点击"解释选中"
          </label>
          <textarea
            value={selectedText}
            onChange={(e) => setSelectedText(e.target.value)}
            placeholder="输入需要解释的文本..."
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => requestExplanation()}
            disabled={loading || !selectedText.trim()}
            className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:bg-gray-400"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                AI思考中...
              </span>
            ) : (
              '获取解释'
            )}
          </button>

          <button
            onClick={handleGetSelectionExplanation}
            disabled={loading}
            className="rounded-lg bg-purple-50 px-4 py-2 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-100 disabled:bg-gray-100 disabled:text-gray-400"
          >
            解释选中
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-400 bg-red-100 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Current Explanation */}
      {currentExplanation && (
        <div className="px-4 pb-4">
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
            <div className="mb-2">
              <span className="text-xs font-medium text-purple-900">
                原文：
              </span>
              <p className="mt-1 text-sm italic text-gray-700">
                "{currentExplanation.text}"
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-purple-900">
                AI解释：
              </span>
              <p className="mt-1 text-sm leading-relaxed text-gray-800">
                {currentExplanation.explanation}
              </p>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              <ClientDate
                date={currentExplanation.timestamp}
                format="datetime"
              />
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && explanations.length > 0 && (
        <div className="border-t border-gray-200 px-4 pb-4 pt-4">
          <h4 className="mb-3 text-sm font-semibold text-gray-900">解释历史</h4>
          <div className="max-h-96 space-y-3 overflow-auto">
            {explanations.map((exp, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-gray-200 bg-gray-50 p-3"
              >
                <div className="mb-2">
                  <span className="text-xs font-medium text-gray-700">
                    原文：
                  </span>
                  <p className="mt-1 text-xs italic text-gray-600">
                    "{exp.text}"
                  </p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-700">
                    解释：
                  </span>
                  <p className="mt-1 text-xs leading-relaxed text-gray-700">
                    {exp.explanation}
                  </p>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  <ClientDate date={exp.timestamp} format="datetime" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!currentExplanation && explanations.length === 0 && !error && (
        <div className="px-4 pb-4 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <p className="mt-2 text-sm text-gray-500">选择文本并获取AI解释</p>
        </div>
      )}
    </div>
  );
}
