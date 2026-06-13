import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSaveDraft = vi.fn(() => true);
const mockLoadDraft = vi.fn((): DraftData | null => null);
const mockDeleteDraft = vi.fn(() => true);

vi.mock('@/lib/storage/draft-storage', () => ({
  saveDraft: (...args: unknown[]) =>
    (mockSaveDraft as (...a: unknown[]) => unknown)(...args),
  loadDraft: (...args: unknown[]) =>
    (mockLoadDraft as (...a: unknown[]) => unknown)(...args),
  deleteDraft: (...args: unknown[]) =>
    (mockDeleteDraft as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  useAutoSave,
  type AutoSaveData,
  type AutoSaveOptions,
} from '../useAutoSave';
import type { DraftData } from '@/lib/storage/draft-storage';

const makeData = (overrides: Partial<AutoSaveData> = {}): AutoSaveData => ({
  title: 'Test Title',
  content: 'Test content body',
  digest: 'Summary here',
  tags: ['ai', 'test'],
  coverImage: '',
  ...overrides,
});

const makeOptions = (
  overrides: Partial<AutoSaveOptions> = {}
): AutoSaveOptions => ({
  draftId: 'draft-001',
  platform: 'twitter',
  sourceType: 'research',
  debounceMs: 1000,
  enabled: true,
  ...overrides,
});

const makeDraftData = (overrides: Partial<DraftData> = {}): DraftData => ({
  id: 'draft-001',
  title: 'Saved Title',
  content: 'Saved content',
  digest: 'Saved digest',
  tags: [],
  coverImage: '',
  platform: 'twitter',
  sourceType: 'research',
  savedAt: Date.now() - 5000,
  expiresAt: Date.now() + 86400000,
  ...overrides,
});

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSaveDraft.mockReturnValue(true);
    mockLoadDraft.mockReturnValue(null);
    mockDeleteDraft.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==================== Initial State ====================

  it('should return initial state when no draft exists', () => {
    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSaved).toBeNull();
    expect(result.current.hasDraft).toBe(false);
    expect(typeof result.current.save).toBe('function');
    expect(typeof result.current.clear).toBe('function');
    expect(typeof result.current.loadExistingDraft).toBe('function');
  });

  it('should detect existing draft on mount', () => {
    const existingDraft = makeDraftData();
    mockLoadDraft.mockReturnValue(existingDraft);
    const onDraftDetected = vi.fn();

    const { result } = renderHook(() =>
      useAutoSave(makeData(), makeOptions({ onDraftDetected }))
    );

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.lastSaved).toBeInstanceOf(Date);
    expect(onDraftDetected).toHaveBeenCalledWith(existingDraft);
  });

  it('should not detect draft when enabled is false', () => {
    mockLoadDraft.mockReturnValue(makeDraftData());
    const onDraftDetected = vi.fn();

    renderHook(() =>
      useAutoSave(makeData(), makeOptions({ enabled: false, onDraftDetected }))
    );

    expect(onDraftDetected).not.toHaveBeenCalled();
  });

  // ==================== Auto-save debounce ====================

  it('should debounce auto-save when data changes', () => {
    const data = makeData();
    const { rerender } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: { d: data, o: makeOptions({ debounceMs: 1000 }) },
    });

    // Change data
    rerender({
      d: makeData({ title: 'Changed Title' }),
      o: makeOptions({ debounceMs: 1000 }),
    });

    // saveDraft should not have been called yet
    expect(mockSaveDraft).not.toHaveBeenCalled();

    // Advance timer to trigger debounced save
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('should reset debounce timer on rapid changes', () => {
    const { rerender } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: {
        d: makeData({ title: 'Initial' }),
        o: makeOptions({ debounceMs: 1000 }),
      },
    });

    // Multiple rapid changes
    rerender({
      d: makeData({ title: 'Change 1' }),
      o: makeOptions({ debounceMs: 1000 }),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    rerender({
      d: makeData({ title: 'Change 2' }),
      o: makeOptions({ debounceMs: 1000 }),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Still not called (timer was reset)
    expect(mockSaveDraft).not.toHaveBeenCalled();

    // Advance to complete the debounce
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('should not auto-save when all fields are empty', () => {
    const emptyData = makeData({
      title: '',
      content: '',
      digest: '',
      tags: [],
      coverImage: '',
    });

    const { rerender } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: { d: emptyData, o: makeOptions() },
    });

    rerender({ d: emptyData, o: makeOptions() });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it('should not auto-save when enabled is false', () => {
    const { rerender } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: {
        d: makeData({ title: 'Initial' }),
        o: makeOptions({ enabled: false }),
      },
    });

    rerender({
      d: makeData({ title: 'Changed' }),
      o: makeOptions({ enabled: false }),
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  // ==================== manual save ====================

  it('save: immediately saves without debounce', () => {
    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    act(() => {
      result.current.save();
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('save: cancels pending debounce timer', () => {
    const { rerender, result } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: {
        d: makeData({ title: 'Initial' }),
        o: makeOptions({ debounceMs: 2000 }),
      },
    });

    // Trigger debounce
    rerender({
      d: makeData({ title: 'Changed' }),
      o: makeOptions({ debounceMs: 2000 }),
    });

    // Manual save before debounce fires
    act(() => {
      result.current.save();
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    // Advance timers — should NOT call save again
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('save: sets hasDraft to true on success', () => {
    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    act(() => {
      result.current.save();
    });

    expect(result.current.hasDraft).toBe(true);
  });

  it('save: sets lastSaved to current date on success', () => {
    const before = new Date();
    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    act(() => {
      result.current.save();
    });

    expect(result.current.lastSaved).toBeInstanceOf(Date);
    expect(result.current.lastSaved!.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    );
  });

  it('save: does nothing when enabled is false', () => {
    const { result } = renderHook(() =>
      useAutoSave(makeData(), makeOptions({ enabled: false }))
    );

    act(() => {
      result.current.save();
    });

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  // ==================== clear ====================

  it('clear: deletes draft and resets state', () => {
    // Start with an existing draft
    mockLoadDraft.mockReturnValue(makeDraftData());

    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    expect(result.current.hasDraft).toBe(true);

    act(() => {
      result.current.clear();
    });

    expect(mockDeleteDraft).toHaveBeenCalledWith('draft-001');
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.lastSaved).toBeNull();
  });

  it('clear: cancels pending debounce timer', () => {
    const { rerender, result } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: {
        d: makeData({ title: 'Initial' }),
        o: makeOptions({ debounceMs: 2000 }),
      },
    });

    rerender({
      d: makeData({ title: 'Changed' }),
      o: makeOptions({ debounceMs: 2000 }),
    });

    act(() => {
      result.current.clear();
    });

    // Advance timers — debounce should have been cancelled
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  // ==================== loadExistingDraft ====================

  it('loadExistingDraft: returns null when no draft exists', () => {
    mockLoadDraft.mockReturnValue(null);

    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    let draft: unknown;
    act(() => {
      draft = result.current.loadExistingDraft();
    });

    expect(draft).toBeNull();
  });

  it('loadExistingDraft: returns draft data when exists', () => {
    const existingDraft = makeDraftData();
    mockLoadDraft.mockReturnValue(existingDraft);

    const { result } = renderHook(() => useAutoSave(makeData(), makeOptions()));

    let draft: unknown;
    act(() => {
      draft = result.current.loadExistingDraft();
    });

    expect(draft).toEqual(existingDraft);
    expect(result.current.hasDraft).toBe(true);
  });

  // ==================== saveDraft payload ====================

  it('passes correct payload to saveDraft', () => {
    const data = makeData({
      title: 'My Title',
      content: 'My Content',
      digest: 'My Digest',
      tags: ['tag1'],
      coverImage: 'http://example.com/image.jpg',
    });
    const options = makeOptions({
      draftId: 'my-draft',
      platform: 'linkedin',
      sourceType: 'writing',
      sourceId: 'src-42',
      externalUrl: 'https://example.com',
    });

    const { result } = renderHook(() => useAutoSave(data, options));

    act(() => {
      result.current.save();
    });

    expect(mockSaveDraft).toHaveBeenCalledWith({
      id: 'my-draft',
      title: 'My Title',
      content: 'My Content',
      digest: 'My Digest',
      tags: ['tag1'],
      coverImage: 'http://example.com/image.jpg',
      platform: 'linkedin',
      sourceType: 'writing',
      sourceId: 'src-42',
      externalUrl: 'https://example.com',
    });
  });

  // ==================== Cleanup on unmount ====================

  it('clears debounce timer on unmount', () => {
    const { rerender, unmount } = renderHook(({ d, o }) => useAutoSave(d, o), {
      initialProps: {
        d: makeData({ title: 'Initial' }),
        o: makeOptions({ debounceMs: 2000 }),
      },
    });

    rerender({
      d: makeData({ title: 'Changed' }),
      o: makeOptions({ debounceMs: 2000 }),
    });

    // Unmount before debounce fires
    unmount();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // saveDraft should NOT be called after unmount
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });
});
