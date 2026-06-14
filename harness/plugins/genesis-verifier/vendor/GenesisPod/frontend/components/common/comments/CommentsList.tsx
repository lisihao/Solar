'use client';

import { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import CommentItem from './CommentItem';
import CommentInput, { type Comment } from './CommentInput';

import { logger } from '@/lib/utils/logger';

interface CommentWithReplies extends Comment {
  user: {
    id: string;
    username: string;
    fullName?: string;
    avatarUrl?: string;
  };
  upvoteCount: number;
  replyCount: number;
  isEdited: boolean;
  isDeleted: boolean;
  replies?: CommentWithReplies[];
}

interface CommentsListProps {
  resourceId: string;
  showInput?: boolean;
}

/**
 * 评论列表组件
 *
 * 功能：
 * - 加载资源的所有评论
 * - 显示评论统计
 * - 显示评论输入框
 * - 树形展示评论
 * - 实时更新
 */
export default function CommentsList({
  resourceId,
  showInput = true,
}: CommentsListProps) {
  const [comments, setComments] = useState<CommentWithReplies[]>([]);
  const [stats, setStats] = useState({ total: 0, topLevel: 0, replies: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadComments();
    loadStats();
  }, [resourceId]);

  const loadComments = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/comments/resource/${resourceId}`,
        { headers: getAuthHeader() }
      );

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: [...] }
        const data = result?.data ?? result;
        setComments(Array.isArray(data) ? data : []);
      } else {
        setError('Failed to load comments');
      }
    } catch (err) {
      logger.error('Failed to load comments:', err);
      setError('Error loading comments');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/comments/resource/${resourceId}/stats`,
        { headers: getAuthHeader() }
      );

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        setStats(data);
      }
    } catch (err) {
      logger.error('Failed to load stats:', err);
    }
  };

  const handleCommentAdded = (newComment: Comment) => {
    loadComments();
    loadStats();
  };

  const handleCommentUpdated = (commentId: string, content: string) => {
    // Update comment in local state
    const updateComment = (
      comments: CommentWithReplies[]
    ): CommentWithReplies[] => {
      return comments.map((comment) => {
        if (comment.id === commentId) {
          return { ...comment, content, isEdited: true };
        }
        if (comment.replies) {
          return { ...comment, replies: updateComment(comment.replies) };
        }
        return comment;
      });
    };

    setComments(updateComment(comments));
  };

  const handleCommentDeleted = (commentId: string) => {
    loadComments();
    loadStats();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <h3 className="text-lg font-semibold text-gray-900">
          评论 ({stats.total})
        </h3>
        {stats.replies > 0 && (
          <span className="text-sm text-gray-500">
            {stats.topLevel} 条评论，{stats.replies} 条回复
          </span>
        )}
      </div>

      {/* Comment Input */}
      {showInput && (
        <div className="border-b border-gray-200 pb-4">
          <CommentInput
            resourceId={resourceId}
            onCommentAdded={handleCommentAdded}
          />
        </div>
      )}

      {/* Comments List */}
      {comments.length === 0 ? (
        <div className="py-12 text-center">
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
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">暂无评论</h3>
          <p className="mt-1 text-sm text-gray-500">成为第一个评论的人</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              resourceId={resourceId}
              onCommentAdded={handleCommentAdded}
              onCommentUpdated={handleCommentUpdated}
              onCommentDeleted={handleCommentDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
