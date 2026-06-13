'use client';

import { useCallback, useState } from 'react';
import { createLogger } from '@/lib/utils/logger';
import { getAuthTokens } from '@/lib/utils/auth';

const log = createLogger('useFeedbackSubmit');

export type FeedbackType = 'bug' | 'feature' | 'improvement' | 'other';

/**
 * 提交反馈的入参。
 * - `url` 必须由调用方在「截屏前」捕获 window.location.href 传入，
 *   保证记录的是问题发生的页面，而不是提交动作发生的位置。
 * - `files` 含截图 blob + 用户追加的附件。
 */
export interface SubmitFeedbackInput {
  type: FeedbackType;
  title: string;
  description: string;
  /** 出问题的页面 URL（调用方负责传入，hook 不读取 window 以便复用与测试） */
  url: string;
  /** 可选用户邮箱 */
  userEmail?: string;
  /** 截图 + 用户追加附件 */
  files?: File[];
}

export interface SubmitFeedbackResult {
  feedbackId: string | null;
}

interface UseFeedbackSubmitReturn {
  submitting: boolean;
  submitted: boolean;
  error: string | null;
  feedbackId: string | null;
  /** 提交成功返回结果；失败抛出 Error（同时设置 error 状态） */
  submit: (input: SubmitFeedbackInput) => Promise<SubmitFeedbackResult>;
  /** 重置状态，供「再提交一条」场景使用 */
  reset: () => void;
}

/**
 * 反馈提交逻辑（FormData 构造 + POST /api/feedback + 状态机）。
 *
 * 抽自 app/feedback/page.tsx 的内联提交逻辑，供 FeedbackWidget 与
 * /feedback 页共用。/feedback 页可改用本 hook（由主控决定是否迁移，
 * 本任务只新建 hook，不改 page）。
 *
 * userAgent 在 submit 内部读取 navigator.userAgent；url 由调用方传入
 * （widget 需在截屏前捕获出问题页面的 href，故不在此处读 window）。
 */
export function useFeedbackSubmit(): UseFeedbackSubmitReturn {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
    setFeedbackId(null);
  }, []);

  const submit = useCallback(
    async (input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> => {
      setSubmitting(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('type', input.type);
        formData.append('title', input.title);
        formData.append('description', input.description);
        if (input.userEmail) formData.append('userEmail', input.userEmail);
        formData.append('userAgent', navigator.userAgent);
        formData.append('url', input.url);

        for (const file of input.files ?? []) {
          formData.append('files', file);
        }

        // 带上 Bearer token（token 存 localStorage，非 cookie）——登录用户的反馈
        // 会归属到 userId；匿名用户无 token 也能提（后端 @Public + OptionalJwtAuthGuard）。
        const accessToken = getAuthTokens()?.accessToken;
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : undefined,
          body: formData,
        });

        // 后端响应可能被包成 { success, data }，也可能是裸对象
        const result = await response.json();
        const data = result?.data ?? result;

        if (result?.success === false || !response.ok) {
          const message =
            (data && typeof data.error === 'string' && data.error) ||
            'Failed to submit feedback';
          throw new Error(message);
        }

        const id: string | null = data?.feedbackId ?? null;
        setFeedbackId(id);
        setSubmitted(true);
        return { feedbackId: id };
      } catch (err) {
        // 不静默吞错：设置 error 状态让 UI 展示，并向上抛出供调用方感知
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Network error. Please try again.';
        log.error('feedback submit failed', err);
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setSubmitting(false);
      }
    },
    []
  );

  return { submitting, submitted, error, feedbackId, submit, reset };
}
