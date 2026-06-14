/// <reference types="@testing-library/jest-dom" />

/**
 * SourceItemPicker unit tests
 *
 * Covers:
 *  - renders items from useSourceItems
 *  - search debounce triggers new fetch key
 *  - single-source maxItemsPerTask cap disables checkbox when exceeded
 *  - global cap (maxRemainingGlobal) also limits selection
 *  - onConfirm receives PickedSourceItem[] with correct sourceType
 *  - onCancel triggered by cancel button
 *  - IntersectionObserver cleanup on unmount
 *  - IntersectionObserver callback triggers next page load
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import React from 'react';
import type {
  SourceItem,
  SocialDataSourceDescriptor,
} from '@/services/ai-social/task-types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseSourceItems = vi.fn();
vi.mock('@/hooks/domain/useSourceItems', () => ({
  useSourceItems: (...args: unknown[]) => mockUseSourceItems(...args),
}));

import { SourceItemPicker } from '../pickers/SourceItemPicker';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeItem = (id: string, title = `Item ${id}`): SourceItem => ({
  id,
  title,
  contentKind: 'article',
  createdAt: '2026-05-01T00:00:00Z',
  wordCount: 2500,
});

const baseSource: SocialDataSourceDescriptor = {
  id: 'ai-writing',
  displayName: { 'zh-CN': 'AI 写作', 'en-US': 'AI Writing' },
  icon: 'FileText',
  description: { 'zh-CN': '写作内容', 'en-US': 'Writing content' },
  contentKinds: ['article'],
  maxItemsPerTask: 5,
};

const baseProps = {
  source: baseSource,
  alreadyPicked: [],
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  maxRemainingGlobal: 20,
};

// ── IntersectionObserver mock ────────────────────────────────────────────────

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;
const observerInstances: Array<{
  callback: ObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];

beforeEach(() => {
  observerInstances.length = 0;
  // Must be a real class so `new IntersectionObserver(...)` works
  class FakeIntersectionObserver {
    callback: ObserverCallback;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(cb: ObserverCallback) {
      this.callback = cb;
      observerInstances.push(this);
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupHookDefault(items: SourceItem[] = [], nextCursor?: string) {
  mockUseSourceItems.mockReturnValue({
    items,
    nextCursor,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SourceItemPicker', () => {
  beforeEach(() => {
    mockUseSourceItems.mockReset();
    baseProps.onConfirm = vi.fn();
    baseProps.onCancel = vi.fn();
    setupHookDefault([makeItem('1'), makeItem('2'), makeItem('3')]);
  });

  it('renders item titles', () => {
    render(<SourceItemPicker {...baseProps} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('cancel button triggers onCancel', () => {
    render(<SourceItemPicker {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(baseProps.onCancel).toHaveBeenCalled();
  });

  it('search input is present', () => {
    render(<SourceItemPicker {...baseProps} />);
    const searchInput = screen.getByPlaceholderText(/搜索内容/);
    expect(searchInput).toBeInTheDocument();
  });

  it('search input change causes new hook invocation with debounced value', async () => {
    render(<SourceItemPicker {...baseProps} />);
    const searchInput = screen.getByPlaceholderText(/搜索内容/);
    fireEvent.change(searchInput, { target: { value: 'GPT' } });
    // After debounce, useSourceItems should be called with search='GPT'
    await waitFor(
      () => {
        const calls = mockUseSourceItems.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall?.[1]?.search).toBe('GPT');
      },
      { timeout: 500 }
    );
  });

  it('checking item increases pick count in footer', () => {
    render(<SourceItemPicker {...baseProps} />);
    const buttons = screen.getAllByRole('button');
    // Find a button containing item text
    const item1Button = buttons.find((btn) =>
      btn.textContent?.includes('Item 1')
    );
    expect(item1Button).toBeDefined();
    fireEvent.click(item1Button!);
    // After click, count should show 1 / 5
    expect(screen.getByText(/1 \/ 5/)).toBeInTheDocument();
  });

  it('onConfirm receives PickedSourceItem[] with correct sourceType', () => {
    render(<SourceItemPicker {...baseProps} />);
    // Click Item 1
    const buttons = screen.getAllByRole('button');
    const item1Button = buttons.find((btn) =>
      btn.textContent?.includes('Item 1')
    );
    fireEvent.click(item1Button!);
    // Click confirm
    const confirmBtn = screen.getByRole('button', { name: /确认/ });
    fireEvent.click(confirmBtn);
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
    const arg = baseProps.onConfirm.mock.calls[0]?.[0] as Array<{
      id: string;
      sourceType: string;
    }>;
    expect(arg).toHaveLength(1);
    expect(arg[0]?.id).toBe('1');
    expect(arg[0]?.sourceType).toBe('ai-writing');
  });

  it('onCancel called after confirm', () => {
    render(<SourceItemPicker {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    expect(baseProps.onCancel).toHaveBeenCalled();
  });

  it('single-source maxItemsPerTask=5 cap disables further selection at limit', () => {
    // Setup 6 items
    const items = [1, 2, 3, 4, 5, 6].map((i) => makeItem(String(i)));
    setupHookDefault(items);

    render(<SourceItemPicker {...baseProps} />);

    // Click first 5 items
    const allButtons = screen.getAllByRole('button');
    const itemButtons = allButtons.filter((btn) =>
      /Item [123456]/.test(btn.textContent ?? '')
    );

    for (let i = 0; i < 5; i++) {
      fireEvent.click(itemButtons[i]!);
    }

    // 6th item should now be disabled (at cap)
    expect(itemButtons[5]).toBeDisabled();
  });

  it('maxRemainingGlobal=2 limits selection even below source max', () => {
    const items = [1, 2, 3, 4].map((i) => makeItem(String(i)));
    setupHookDefault(items);

    render(<SourceItemPicker {...baseProps} maxRemainingGlobal={2} />);

    const allButtons = screen.getAllByRole('button');
    const itemButtons = allButtons.filter((btn) =>
      /Item [1234]/.test(btn.textContent ?? '')
    );

    // Pick 2
    fireEvent.click(itemButtons[0]!);
    fireEvent.click(itemButtons[1]!);
    // 3rd and 4th should be disabled
    expect(itemButtons[2]).toBeDisabled();
    expect(itemButtons[3]).toBeDisabled();
  });

  it('alreadyPicked items initialize pick count', () => {
    const alreadyPicked = [
      { ...makeItem('1'), sourceType: 'ai-writing' },
      { ...makeItem('2'), sourceType: 'ai-writing' },
    ];
    const items = [1, 2, 3].map((i) => makeItem(String(i)));
    setupHookDefault(items);

    render(<SourceItemPicker {...baseProps} alreadyPicked={alreadyPicked} />);
    // Count shows 2 already picked (out of 5)
    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument();
  });

  it('IntersectionObserver is created when nextCursor exists', () => {
    setupHookDefault([makeItem('1')], 'cursor-abc');
    render(<SourceItemPicker {...baseProps} />);
    // Observer should have been instantiated (observerInstances populated)
    expect(observerInstances.length).toBeGreaterThan(0);
  });

  it('IntersectionObserver disconnect called on unmount', () => {
    setupHookDefault([makeItem('1')], 'cursor-abc');
    const { unmount } = render(<SourceItemPicker {...baseProps} />);
    unmount();
    // All created observers should have been disconnected
    observerInstances.forEach((inst) => {
      expect(inst.disconnect).toHaveBeenCalled();
    });
  });

  it('IntersectionObserver callback triggers next page cursor', async () => {
    setupHookDefault([makeItem('1')], 'cursor-next');
    render(<SourceItemPicker {...baseProps} />);

    // Trigger the IntersectionObserver callback as if sentinel is visible
    await act(async () => {
      observerInstances.forEach((inst) => {
        inst.callback([{ isIntersecting: true }]);
      });
    });

    // The hook should have been called with cursor='cursor-next' in subsequent render
    await waitFor(() => {
      const calls = mockUseSourceItems.mock.calls;
      const hasCursorCall = calls.some(
        (call) => call[1]?.cursor === 'cursor-next'
      );
      expect(hasCursorCall).toBe(true);
    });
  });

  it('renders loading spinner while isLoading with no items', () => {
    mockUseSourceItems.mockReturnValue({
      items: [],
      nextCursor: undefined,
      isLoading: true,
      error: null,
      refresh: vi.fn(),
    });
    render(<SourceItemPicker {...baseProps} />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders empty state when no items and not loading', () => {
    setupHookDefault([]);
    render(<SourceItemPicker {...baseProps} />);
    expect(screen.getByText(/暂无内容/)).toBeInTheDocument();
  });
});
