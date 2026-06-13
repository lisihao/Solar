'use client';

import { useState } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';

export interface Comment {
  id: string;
  content: string;
  userId: string;
  resourceId: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface CommentInputProps {
  resourceId: string;
  parentId?: string;
  placeholder?: string;
  onCommentAdded?: (comment: Comment) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * 评论输入组件
 *
 * 功能：
 * - 创建新评论
 * - 回复评论
 * - 自动展开/收起
 */
export default function CommentInput({
  resourceId,
  parentId,
  placeholder = '写下你的评论...',
  onCommentAdded,
  onCancel,
  autoFocus = false,
}: CommentInputProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) {
      setError('评论内容不能为空');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch(`${config.apiBaseUrl}/api/v1/comments`, {
        method: 'POST',
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resourceId,
          content: content.trim(),
          parentId,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const comment = result?.data ?? result;
        setContent('');
        onCommentAdded?.(comment);
      } else {
        setError('发送评论失败，请重试');
      }
    } catch (err) {
      logger.error('Failed to submit comment:', err);
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={parentId ? 2 : 3}
        autoFocus={autoFocus}
        className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
        >
          {submitting ? '发送中...' : parentId ? '回复' : '评论'}
        </button>
      </div>
    </form>
  );
}
