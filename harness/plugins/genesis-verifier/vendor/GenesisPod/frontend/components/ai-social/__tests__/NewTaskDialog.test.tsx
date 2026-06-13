/// <reference types="@testing-library/jest-dom" />

/**
 * NewTaskDialog unit tests
 *
 * Covers:
 *  - open=false → returns null, nothing rendered
 *  - data sources list rendered with source display names
 *  - launch button disabled when no sources/platform
 *  - platform multi-select: accountIds populated on submit
 *  - launch calls createTaskAndRefresh + onCreated callback
 *  - launch failure shows error message (never swallowed)
 *  - cancel button triggers onClose
 *  - external URL validation (invalid URL shows error)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { SocialDataSourceDescriptor } from '@/services/ai-social/task-types';
import type { SocialPlatformConnection } from '@/services/ai-social/api';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseSocialDataSources = vi.fn();
vi.mock('@/hooks/domain/useSocialDataSources', () => ({
  useSocialDataSources: () => mockUseSocialDataSources(),
}));

const mockCreateTaskAndRefresh = vi.fn();
vi.mock('@/hooks/domain/useSocialTasks', () => ({
  createTaskAndRefresh: (...args: unknown[]) =>
    mockCreateTaskAndRefresh(...args),
}));

const mockGetConnections = vi.fn();
vi.mock('@/services/ai-social/api', () => ({
  getConnections: () => mockGetConnections(),
}));

// Mock useSourceItems so SourceItemPicker (child) doesn't make real calls
vi.mock('@/hooks/domain/useSourceItems', () => ({
  useSourceItems: () => ({
    items: [],
    nextCursor: undefined,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { NewTaskDialog } from '../dialogs/NewTaskDialog';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeSource = (id: string, name: string): SocialDataSourceDescriptor => ({
  id,
  displayName: { 'zh-CN': name, 'en-US': name },
  icon: 'FileText',
  description: { 'zh-CN': name, 'en-US': name },
  contentKinds: ['article'],
  maxItemsPerTask: 10,
});

const makeConnection = (
  id: string,
  platformType: 'WECHAT_MP' | 'XIAOHONGSHU',
  accountName = `Account-${id}`
): SocialPlatformConnection => ({
  id,
  userId: 'user-1',
  platformType,
  accountName,
  accountId: null,
  avatarUrl: null,
  sessionData: null,
  isActive: true,
  lastCheckAt: null,
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const wechatConn = makeConnection('conn-wx', 'WECHAT_MP', 'MyWechat');
const xhsConn = makeConnection('conn-xhs', 'XIAOHONGSHU', 'MyXHS');

const sources = [
  makeSource('ai-writing', 'AI 写作'),
  makeSource('ai-research', 'AI Research'),
];

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDefaults() {
  mockUseSocialDataSources.mockReturnValue({
    sources,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  });
  mockGetConnections.mockResolvedValue([wechatConn, xhsConn]);
}

/** Add an external URL to enable the "has source" condition */
async function addExternalUrl(url = 'https://example.com/article') {
  fireEvent.click(screen.getByText(/\+ 外部 URL/));
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText('https://example.com/article')
    ).toBeInTheDocument()
  );
  fireEvent.change(screen.getByPlaceholderText('https://example.com/article'), {
    target: { value: url },
  });
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
}

/** Check the first available (non-disabled) platform checkbox */
async function pickFirstPlatform() {
  await waitFor(() =>
    expect(screen.getByText(/WeChat 公众号/)).toBeInTheDocument()
  );
  const checkboxes = screen.getAllByRole('checkbox');
  const enabledCheckbox = checkboxes.find((cb) => !cb.hasAttribute('disabled'));
  if (enabledCheckbox) fireEvent.click(enabledCheckbox);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NewTaskDialog', () => {
  beforeEach(() => {
    mockUseSocialDataSources.mockReset();
    mockCreateTaskAndRefresh.mockReset();
    mockGetConnections.mockReset();
    baseProps.onClose = vi.fn();
    baseProps.onCreated = vi.fn();
    setupDefaults();
  });

  it('does not render when open=false', () => {
    render(<NewTaskDialog {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when open=true', () => {
    render(<NewTaskDialog {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders data source list with source display names', () => {
    render(<NewTaskDialog {...baseProps} />);
    expect(screen.getByText('AI 写作')).toBeInTheDocument();
    expect(screen.getByText('AI Research')).toBeInTheDocument();
  });

  it('launch button is disabled when no sources picked and no platform', () => {
    render(<NewTaskDialog {...baseProps} />);
    const launchBtn = screen.getByRole('button', { name: /启动/ });
    expect(launchBtn).toBeDisabled();
  });

  it('cancel button triggers onClose', () => {
    render(<NewTaskDialog {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('platform checkboxes appear after connections load', async () => {
    render(<NewTaskDialog {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByText(/WeChat 公众号/)).toBeInTheDocument();
      expect(screen.getByText(/小红书/)).toBeInTheDocument();
    });
  });

  it('launch button still disabled when source added but no platform', async () => {
    render(<NewTaskDialog {...baseProps} />);
    await addExternalUrl();
    // No platform selected → still disabled
    expect(screen.getByRole('button', { name: /启动/ })).toBeDisabled();
  });

  it('launch button enabled when source + platform both selected', async () => {
    render(<NewTaskDialog {...baseProps} />);
    await addExternalUrl();
    await pickFirstPlatform();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /启动/ })).not.toBeDisabled();
    });
  });

  it('launch calls createTaskAndRefresh and invokes onCreated with task id', async () => {
    mockCreateTaskAndRefresh.mockResolvedValue({ id: 'task-abc' });

    render(<NewTaskDialog {...baseProps} />);
    await addExternalUrl('https://example.com/article1');
    await pickFirstPlatform();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /启动/ })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /启动/ }));

    await waitFor(() => {
      expect(baseProps.onCreated).toHaveBeenCalledWith('task-abc');
    });
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('createTaskAndRefresh called with correct accountIds for checked platforms', async () => {
    mockCreateTaskAndRefresh.mockResolvedValue({ id: 'task-1' });

    render(<NewTaskDialog {...baseProps} />);
    await addExternalUrl('https://example.com/test');

    // Wait for connections to load and check both platforms
    await waitFor(() =>
      expect(screen.getByText(/WeChat 公众号/)).toBeInTheDocument()
    );
    const checkboxes = screen.getAllByRole('checkbox');
    const enabledBoxes = checkboxes.filter(
      (cb) => !cb.hasAttribute('disabled')
    );
    for (const cb of enabledBoxes) {
      fireEvent.click(cb);
    }

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /启动/ })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /启动/ }));

    await waitFor(() => {
      expect(mockCreateTaskAndRefresh).toHaveBeenCalledTimes(1);
    });

    const callArg = mockCreateTaskAndRefresh.mock.calls[0]?.[0] as {
      platforms: string[];
      accountIds: Record<string, string>;
    };
    expect(callArg.platforms.length).toBeGreaterThanOrEqual(1);
    // Each checked platform should have an accountId
    callArg.platforms.forEach((p) => {
      expect(callArg.accountIds[p]).toBeDefined();
    });
  });

  it('launch failure shows error message and does not call onCreated', async () => {
    mockCreateTaskAndRefresh.mockRejectedValue(new Error('server error'));

    render(<NewTaskDialog {...baseProps} />);
    await addExternalUrl('https://example.com/article2');
    await pickFirstPlatform();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /启动/ })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /启动/ }));

    await waitFor(() => {
      expect(screen.getByText('server error')).toBeInTheDocument();
    });
    expect(baseProps.onCreated).not.toHaveBeenCalled();
  });

  it('external URL validation rejects invalid URLs', async () => {
    render(<NewTaskDialog {...baseProps} />);
    fireEvent.click(screen.getByText(/\+ 外部 URL/));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('https://example.com/article')
      ).toBeInTheDocument()
    );
    fireEvent.change(
      screen.getByPlaceholderText('https://example.com/article'),
      { target: { value: 'not-a-valid-url' } }
    );
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => {
      expect(screen.getByText(/有效的 URL/)).toBeInTheDocument();
    });
  });

  it('duplicate external URLs are rejected', async () => {
    render(<NewTaskDialog {...baseProps} />);
    await addExternalUrl('https://example.com/dup');
    // Try to add same URL again
    fireEvent.change(
      screen.getByPlaceholderText('https://example.com/article'),
      { target: { value: 'https://example.com/dup' } }
    );
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => {
      expect(screen.getByText(/已添加/)).toBeInTheDocument();
    });
  });

  it('clicking source row opens SourceItemPicker sub-dialog', async () => {
    render(<NewTaskDialog {...baseProps} />);
    const buttons = screen.getAllByRole('button');
    const sourceButton = buttons.find((btn) =>
      btn.textContent?.includes('AI 写作')
    );
    expect(sourceButton).toBeDefined();
    fireEvent.click(sourceButton!);
    // SourceItemPicker dialog should now be rendered (two dialogs total)
    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('prompt textarea enforces 500-char limit', async () => {
    render(<NewTaskDialog {...baseProps} />);
    fireEvent.click(screen.getByText(/补充提示词/));
    await waitFor(() => {
      const textareas = document.querySelectorAll('textarea');
      expect(textareas.length).toBeGreaterThan(0);
      expect(textareas[0]).toHaveAttribute('maxlength', '500');
    });
  });
});
