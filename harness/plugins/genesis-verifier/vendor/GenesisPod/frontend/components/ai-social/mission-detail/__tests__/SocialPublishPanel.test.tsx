/// <reference types="@testing-library/jest-dom" />

/**
 * SocialPublishPanel unit tests
 *
 * Covers:
 *  - task.status !== DRAFT_READY and not PARTIAL_PUBLISHED → shows pending hint, no publish button
 *  - DRAFT_READY → shows publish button for each platform
 *  - clicking publish button → calls fetch with auth header
 *  - PARTIAL_PUBLISHED with FAILED version → shows retry button for failed platform
 *  - PARTIAL_PUBLISHED with PUBLISHED version → shows external link instead of publish button
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { SocialPublishPanel } from '../SocialPublishPanel';
import type { SocialContentTask } from '@/services/ai-social/task-types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: () => ({ accessToken: 'test-token-abc' }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTask(
  overrides: Partial<SocialContentTask> = {}
): SocialContentTask {
  return {
    id: 'task-123',
    userId: 'user-1',
    status: 'DRAFT_READY',
    platforms: ['WECHAT_MP', 'XIAOHONGSHU'],
    externalUrls: [],
    accountIds: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    versions: [
      {
        id: 'v1',
        taskId: 'task-123',
        platform: 'WECHAT_MP',
        status: 'DRAFT_READY',
        title: '微信文章标题',
        content: '正文内容',
        bodyMime: 'text/markdown',
        tags: [],
      },
      {
        id: 'v2',
        taskId: 'task-123',
        platform: 'XIAOHONGSHU',
        status: 'DRAFT_READY',
        title: '小红书标题',
        content: '小红书正文',
        bodyMime: 'text/plain',
        tags: ['科技', 'AI'],
      },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SocialPublishPanel', () => {
  const onAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('non-actionable statuses', () => {
    it.each<SocialContentTask['status']>([
      'PENDING',
      'GENERATING',
      'PUBLISHING',
      'PUBLISHED',
      'FAILED',
      'CANCELLED',
    ])('shows pending hint and no publish button when status=%s', (status) => {
      render(
        <SocialPublishPanel task={makeTask({ status })} onAction={onAction} />
      );

      expect(
        screen.getByText(/任务尚未完成生成，发布按钮在 DRAFT_READY 后可用/)
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /发布到草稿箱/ })).toBeNull();
    });
  });

  describe('DRAFT_READY', () => {
    it('renders a publish button for each platform', () => {
      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      const buttons = screen.getAllByRole('button', { name: /发布到草稿箱/ });
      expect(buttons).toHaveLength(2);
    });

    it('shows platform labels', () => {
      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      expect(screen.getByText('微信公众号')).toBeInTheDocument();
      expect(screen.getByText('小红书')).toBeInTheDocument();
    });

    it('calls fetch with Bearer auth header when publish button clicked', async () => {
      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      const [firstButton] = screen.getAllByRole('button', {
        name: /发布到草稿箱/,
      });
      fireEvent.click(firstButton);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      const [url, init] = mockFetch.mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(url).toContain('/api/v1/ai-social/tasks/task-123/publish');
      expect(init.headers['Authorization']).toBe('Bearer test-token-abc');
    });

    it('shows toast message after publish attempt', async () => {
      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      const [firstButton] = screen.getAllByRole('button', {
        name: /发布到草稿箱/,
      });
      fireEvent.click(firstButton);

      await waitFor(() => {
        expect(
          screen.getByText('已发布到草稿箱，请到公众号后台确认')
        ).toBeInTheDocument();
      });
    });

    it('shows publish-failed toast when result.success=false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: false, errorMessage: '会话已失效' }),
      });

      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      const [firstButton] = screen.getAllByRole('button', {
        name: /发布到草稿箱/,
      });
      fireEvent.click(firstButton);

      await waitFor(() => {
        expect(screen.getByText('会话已失效')).toBeInTheDocument();
      });
    });

    it('shows "publish endpoint not ready" toast on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      const [firstButton] = screen.getAllByRole('button', {
        name: /发布到草稿箱/,
      });
      fireEvent.click(firstButton);

      await waitFor(() => {
        expect(screen.getByText('发布接口未就绪')).toBeInTheDocument();
      });
    });

    it('calls onAction after publish attempt', async () => {
      render(
        <SocialPublishPanel
          task={makeTask({ status: 'DRAFT_READY' })}
          onAction={onAction}
        />
      );

      const [firstButton] = screen.getAllByRole('button', {
        name: /发布到草稿箱/,
      });
      fireEvent.click(firstButton);

      await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    });
  });

  describe('PARTIAL_PUBLISHED', () => {
    function makePartialTask() {
      return makeTask({
        status: 'PARTIAL_PUBLISHED',
        versions: [
          {
            id: 'v1',
            taskId: 'task-123',
            platform: 'WECHAT_MP',
            status: 'PUBLISHED',
            title: '微信文章',
            content: '内容',
            bodyMime: 'text/markdown',
            tags: [],
            externalUrl: 'https://mp.weixin.qq.com/s/abc123',
          },
          {
            id: 'v2',
            taskId: 'task-123',
            platform: 'XIAOHONGSHU',
            status: 'FAILED',
            title: '小红书标题',
            content: '正文',
            bodyMime: 'text/plain',
            tags: [],
            errorMessage: '账号未绑定',
          },
        ],
      });
    }

    it('shows retry button for the failed platform', () => {
      render(
        <SocialPublishPanel task={makePartialTask()} onAction={onAction} />
      );

      expect(
        screen.getByRole('button', { name: /仅重试此平台/ })
      ).toBeInTheDocument();
    });

    it('shows external link for the published platform', () => {
      render(
        <SocialPublishPanel task={makePartialTask()} onAction={onAction} />
      );

      const link = screen.getByRole('link', { name: /查看/ });
      expect(link).toHaveAttribute('href', 'https://mp.weixin.qq.com/s/abc123');
    });

    it('shows error message for failed platform', () => {
      render(
        <SocialPublishPanel task={makePartialTask()} onAction={onAction} />
      );

      expect(screen.getByText('账号未绑定')).toBeInTheDocument();
    });

    it('clicking retry calls fetch with correct platform param', async () => {
      render(
        <SocialPublishPanel task={makePartialTask()} onAction={onAction} />
      );

      const retryButton = screen.getByRole('button', { name: /仅重试此平台/ });
      fireEvent.click(retryButton);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('platform=XIAOHONGSHU');
    });
  });
});
