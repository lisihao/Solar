import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  useSlidesStore,
  selectCurrentPage,
  selectCompletedPages,
  selectPendingPages,
  selectGeneratingPages,
  selectOverallProgress,
  selectLatestCheckpoint,
  getPhaseWeight,
  calculateOverallProgress,
} from '../slidesStore';
import type {
  SlidesSession,
  Checkpoint,
  PageState,
  StreamEvent,
  GenerationProgress,
  CheckpointState,
  GlobalStyles,
} from '@/lib/types/slides';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_GLOBAL_STYLES: GlobalStyles = {
  canvasWidth: 1280,
  canvasHeight: 720,
  backgroundColor: '#0F172A',
  cardBackground: '#1E293B',
  borderColor: '#334155',
  accentColor: '#D4AF37',
  accentColorSecondary: '#3B82F6',
  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  fontFamily: "'Noto Sans SC', sans-serif",
  bottomSafeZone: 80,
};

function makeSession(overrides: Partial<SlidesSession> = {}): SlidesSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    title: 'Test Session',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'ckpt-1',
    sessionId: 'session-1',
    name: 'Checkpoint 1',
    type: 'auto_save',
    version: '1.0',
    timestamp: new Date(),
    state: { pages: [], conversation: [] },
    metadata: { trigger: 'auto' },
    ...overrides,
  };
}

function makePage(
  pageNumber: number,
  overrides: Partial<PageState> = {}
): PageState {
  return {
    pageNumber,
    outline: {
      pageNumber,
      title: `Page ${pageNumber}`,
      templateType: 'pillars',
      purpose: '',
      keyPoints: [],
    },
    status: 'pending',
    ...overrides,
  };
}

function makeProgress(
  overrides: Partial<GenerationProgress> = {}
): GenerationProgress {
  return {
    phase: 'page_rendering',
    phaseProgress: 50,
    overallProgress: 55,
    message: 'Rendering pages...',
    ...overrides,
  };
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useSlidesStore.setState({
    session: null,
    sessionLoading: false,
    checkpoints: [],
    currentCheckpointId: null,
    checkpointsLoading: false,
    generating: false,
    progress: null,
    streamEvents: [],
    pages: [],
    selectedPageIndex: 0,
    taskDecomposition: null,
    outlinePlan: null,
    qualityReport: null,
    globalStyles: DEFAULT_GLOBAL_STYLES,
    error: null,
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
    previewMode: 'single',
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useSlidesStore - initial state
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - initial state', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should have null session and no pages', () => {
    const { result } = renderHook(() => useSlidesStore());
    expect(result.current.session).toBeNull();
    expect(result.current.pages).toEqual([]);
    expect(result.current.generating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should have default global styles', () => {
    const { result } = renderHook(() => useSlidesStore());
    expect(result.current.globalStyles).toEqual(DEFAULT_GLOBAL_STYLES);
  });

  it('should have single preview mode by default', () => {
    const { result } = renderHook(() => useSlidesStore());
    expect(result.current.previewMode).toBe('single');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Session operations
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - session operations', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set session and clear error', () => {
    const { result } = renderHook(() => useSlidesStore());
    useSlidesStore.setState({ error: 'old error' });
    const session = makeSession();

    act(() => {
      result.current.setSession(session);
    });

    expect(result.current.session).toEqual(session);
    expect(result.current.error).toBeNull();
  });

  it('should set session to null', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.setSession(makeSession());
    });

    act(() => {
      result.current.setSession(null);
    });

    expect(result.current.session).toBeNull();
  });

  it('should set sessionLoading', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setSessionLoading(true);
    });
    expect(result.current.sessionLoading).toBe(true);

    act(() => {
      result.current.setSessionLoading(false);
    });
    expect(result.current.sessionLoading).toBe(false);
  });

  it('should clear session and related data on clearSession', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.setSession(makeSession());
      result.current.setPages([makePage(1), makePage(2)]);
      result.current.addCheckpoint(makeCheckpoint());
      result.current.setProgress(makeProgress());
      result.current.setError('some error');
    });

    act(() => {
      result.current.clearSession();
    });

    expect(result.current.session).toBeNull();
    expect(result.current.checkpoints).toEqual([]);
    expect(result.current.currentCheckpointId).toBeNull();
    expect(result.current.pages).toEqual([]);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Checkpoint operations
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - checkpoint operations', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set checkpoints', () => {
    const { result } = renderHook(() => useSlidesStore());
    const checkpoints = [
      makeCheckpoint({ id: 'ckpt-1' }),
      makeCheckpoint({ id: 'ckpt-2' }),
    ];

    act(() => {
      result.current.setCheckpoints(checkpoints);
    });

    expect(result.current.checkpoints).toHaveLength(2);
  });

  it('should prepend checkpoint on addCheckpoint', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.addCheckpoint(makeCheckpoint({ id: 'ckpt-1' }));
    });

    act(() => {
      result.current.addCheckpoint(makeCheckpoint({ id: 'ckpt-2' }));
    });

    expect(result.current.checkpoints[0].id).toBe('ckpt-2');
    expect(result.current.checkpoints[1].id).toBe('ckpt-1');
  });

  it('should set currentCheckpointId', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setCurrentCheckpointId('ckpt-abc');
    });

    expect(result.current.currentCheckpointId).toBe('ckpt-abc');
  });

  it('should set checkpointsLoading', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setCheckpointsLoading(true);
    });
    expect(result.current.checkpointsLoading).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Generation operations
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - generation operations', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set generating flag', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setGenerating(true);
    });
    expect(result.current.generating).toBe(true);

    act(() => {
      result.current.setGenerating(false);
    });
    expect(result.current.generating).toBe(false);
  });

  it('should set and clear progress', () => {
    const { result } = renderHook(() => useSlidesStore());
    const progress = makeProgress();

    act(() => {
      result.current.setProgress(progress);
    });
    expect(result.current.progress).toEqual(progress);

    act(() => {
      result.current.setProgress(null);
    });
    expect(result.current.progress).toBeNull();
  });

  it('should append stream events', () => {
    const { result } = renderHook(() => useSlidesStore());
    const event: StreamEvent = {
      type: 'phase_started',
      timestamp: new Date(),
      data: {},
    };

    act(() => {
      result.current.addStreamEvent(event);
    });
    act(() => {
      result.current.addStreamEvent(event);
    });

    expect(result.current.streamEvents).toHaveLength(2);
  });

  it('should clear all stream events', () => {
    const { result } = renderHook(() => useSlidesStore());
    const event: StreamEvent = {
      type: 'phase_completed',
      timestamp: new Date(),
      data: {},
    };
    act(() => {
      result.current.addStreamEvent(event);
    });

    act(() => {
      result.current.clearStreamEvents();
    });

    expect(result.current.streamEvents).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Page operations
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - page operations', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set pages sorted by pageNumber', () => {
    const { result } = renderHook(() => useSlidesStore());
    const pages = [makePage(3), makePage(1), makePage(2)];

    act(() => {
      result.current.setPages(pages);
    });

    expect(result.current.pages[0].pageNumber).toBe(1);
    expect(result.current.pages[1].pageNumber).toBe(2);
    expect(result.current.pages[2].pageNumber).toBe(3);
  });

  it('should update an existing page by pageNumber', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.setPages([makePage(1), makePage(2)]);
    });

    act(() => {
      result.current.updatePage(1, {
        status: 'completed',
        html: '<div>Slide 1</div>',
      });
    });

    const page1 = result.current.pages.find((p) => p.pageNumber === 1);
    expect(page1?.status).toBe('completed');
    expect(page1?.html).toBe('<div>Slide 1</div>');
  });

  it('should create a new page if it does not exist in updatePage', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.updatePage(5, { status: 'generating' });
    });

    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0].pageNumber).toBe(5);
    expect(result.current.pages[0].status).toBe('generating');
  });

  it('should keep pages sorted after updatePage creates new page', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.setPages([makePage(1), makePage(3)]);
    });

    act(() => {
      result.current.updatePage(2, { status: 'pending' });
    });

    expect(result.current.pages[0].pageNumber).toBe(1);
    expect(result.current.pages[1].pageNumber).toBe(2);
    expect(result.current.pages[2].pageNumber).toBe(3);
  });

  it('should set selectedPageIndex', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setSelectedPageIndex(2);
    });

    expect(result.current.selectedPageIndex).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task / outline / quality report
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - task decomposition and outline', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set and clear taskDecomposition', () => {
    const { result } = renderHook(() => useSlidesStore());
    const task = {
      totalPages: 10,
      chapters: [],
      todos: [],
      designStrategy: {},
    } as unknown as Parameters<typeof result.current.setTaskDecomposition>[0];

    act(() => {
      result.current.setTaskDecomposition(task);
    });
    expect(result.current.taskDecomposition).toEqual(task);

    act(() => {
      result.current.setTaskDecomposition(null);
    });
    expect(result.current.taskDecomposition).toBeNull();
  });

  it('should set and clear outlinePlan', () => {
    const { result } = renderHook(() => useSlidesStore());
    const outline = { title: 'My Outline', pages: [] } as unknown as Parameters<
      typeof result.current.setOutlinePlan
    >[0];

    act(() => {
      result.current.setOutlinePlan(outline);
    });
    expect(result.current.outlinePlan).toEqual(outline);

    act(() => {
      result.current.setOutlinePlan(null);
    });
    expect(result.current.outlinePlan).toBeNull();
  });

  it('should set and clear qualityReport', () => {
    const { result } = renderHook(() => useSlidesStore());
    const report = { overallScore: 90 } as unknown as Parameters<
      typeof result.current.setQualityReport
    >[0];

    act(() => {
      result.current.setQualityReport(report);
    });
    expect(result.current.qualityReport).toEqual(report);

    act(() => {
      result.current.setQualityReport(null);
    });
    expect(result.current.qualityReport).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Global styles
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - global styles', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should merge partial global styles', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setGlobalStyles({ accentColor: '#FF0000' });
    });

    expect(result.current.globalStyles.accentColor).toBe('#FF0000');
    expect(result.current.globalStyles.backgroundColor).toBe(
      DEFAULT_GLOBAL_STYLES.backgroundColor
    );
  });

  it('should allow overriding multiple style properties', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setGlobalStyles({
        canvasWidth: 1920,
        canvasHeight: 1080,
        fontFamily: 'Arial',
      });
    });

    expect(result.current.globalStyles.canvasWidth).toBe(1920);
    expect(result.current.globalStyles.canvasHeight).toBe(1080);
    expect(result.current.globalStyles.fontFamily).toBe('Arial');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Error handling
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - error', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set error string', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setError('Something went wrong');
    });

    expect(result.current.error).toBe('Something went wrong');
  });

  it('should clear error by setting null', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.setError('Error!');
    });

    act(() => {
      result.current.setError(null);
    });

    expect(result.current.error).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UI state
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - UI state', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should toggle left panel', () => {
    const { result } = renderHook(() => useSlidesStore());
    expect(result.current.leftPanelCollapsed).toBe(false);

    act(() => {
      result.current.toggleLeftPanel();
    });
    expect(result.current.leftPanelCollapsed).toBe(true);

    act(() => {
      result.current.toggleLeftPanel();
    });
    expect(result.current.leftPanelCollapsed).toBe(false);
  });

  it('should toggle right panel', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.toggleRightPanel();
    });
    expect(result.current.rightPanelCollapsed).toBe(true);
  });

  it('should set preview mode', () => {
    const { result } = renderHook(() => useSlidesStore());

    act(() => {
      result.current.setPreviewMode('thumbnail');
    });
    expect(result.current.previewMode).toBe('thumbnail');

    act(() => {
      result.current.setPreviewMode('single');
    });
    expect(result.current.previewMode).toBe('single');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// restoreFromCheckpointState
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - restoreFromCheckpointState', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should restore pages with correct status based on html presence', () => {
    const { result } = renderHook(() => useSlidesStore());
    const checkpointState: CheckpointState = {
      pages: [
        { ...makePage(1), html: '<div>HTML</div>', status: 'pending' },
        { ...makePage(2), status: 'pending' },
      ],
      conversation: [],
    };

    act(() => {
      result.current.restoreFromCheckpointState(checkpointState);
    });

    const p1 = result.current.pages.find((p) => p.pageNumber === 1);
    const p2 = result.current.pages.find((p) => p.pageNumber === 2);
    expect(p1?.status).toBe('completed'); // has html -> completed
    expect(p2?.status).toBe('pending'); // no html -> stays pending
  });

  it('should sort restored pages by pageNumber', () => {
    const { result } = renderHook(() => useSlidesStore());
    const checkpointState: CheckpointState = {
      pages: [makePage(3), makePage(1), makePage(2)],
      conversation: [],
    };

    act(() => {
      result.current.restoreFromCheckpointState(checkpointState);
    });

    expect(result.current.pages[0].pageNumber).toBe(1);
    expect(result.current.pages[1].pageNumber).toBe(2);
    expect(result.current.pages[2].pageNumber).toBe(3);
  });

  it('should reset generating to false after restore', () => {
    const { result } = renderHook(() => useSlidesStore());
    useSlidesStore.setState({ generating: true });
    const checkpointState: CheckpointState = { pages: [], conversation: [] };

    act(() => {
      result.current.restoreFromCheckpointState(checkpointState);
    });

    expect(result.current.generating).toBe(false);
  });

  it('should set progress based on completed vs total pages', () => {
    const { result } = renderHook(() => useSlidesStore());
    const checkpointState: CheckpointState = {
      pages: [
        { ...makePage(1), html: '<div>HTML</div>' },
        { ...makePage(2), html: '<div>HTML</div>' },
        { ...makePage(3) },
      ],
      conversation: [],
    };

    act(() => {
      result.current.restoreFromCheckpointState(checkpointState);
    });

    expect(result.current.progress).not.toBeNull();
    expect(result.current.progress?.totalPages).toBe(3);
    expect(result.current.progress?.phase).toBe('page_rendering'); // not all complete
  });

  it('should set progress phase to quality_review when all pages are completed', () => {
    const { result } = renderHook(() => useSlidesStore());
    const checkpointState: CheckpointState = {
      pages: [
        { ...makePage(1), html: '<div>1</div>' },
        { ...makePage(2), html: '<div>2</div>' },
      ],
      conversation: [],
    };

    act(() => {
      result.current.restoreFromCheckpointState(checkpointState);
    });

    expect(result.current.progress?.phase).toBe('quality_review');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// reset
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesStore - reset', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should restore all state to initial values', () => {
    const { result } = renderHook(() => useSlidesStore());
    act(() => {
      result.current.setSession(makeSession());
      result.current.setPages([makePage(1), makePage(2)]);
      result.current.setGenerating(true);
      result.current.setError('error');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.session).toBeNull();
    expect(result.current.pages).toEqual([]);
    expect(result.current.generating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.streamEvents).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Selectors
// ═════════════════════════════════════════════════════════════════════════════

describe('selectors', () => {
  beforeEach(() => {
    resetStore();
  });

  it('selectCurrentPage should return the page at selectedPageIndex', () => {
    useSlidesStore.setState({
      pages: [makePage(1), makePage(2)],
      selectedPageIndex: 1,
    });
    const state = useSlidesStore.getState();
    expect(selectCurrentPage(state)?.pageNumber).toBe(2);
  });

  it('selectCurrentPage should return null when pages is empty', () => {
    const state = useSlidesStore.getState();
    expect(selectCurrentPage(state)).toBeNull();
  });

  it('selectCompletedPages should filter completed pages', () => {
    useSlidesStore.setState({
      pages: [
        makePage(1, { status: 'completed' }),
        makePage(2, { status: 'pending' }),
        makePage(3, { status: 'completed' }),
      ],
    });
    const state = useSlidesStore.getState();
    const completed = selectCompletedPages(state);
    expect(completed).toHaveLength(2);
    expect(completed.every((p) => p.status === 'completed')).toBe(true);
  });

  it('selectPendingPages should filter pending pages', () => {
    useSlidesStore.setState({
      pages: [
        makePage(1, { status: 'pending' }),
        makePage(2, { status: 'completed' }),
      ],
    });
    const state = useSlidesStore.getState();
    expect(selectPendingPages(state)).toHaveLength(1);
  });

  it('selectGeneratingPages should filter generating pages', () => {
    useSlidesStore.setState({
      pages: [
        makePage(1, { status: 'generating' }),
        makePage(2, { status: 'pending' }),
      ],
    });
    const state = useSlidesStore.getState();
    expect(selectGeneratingPages(state)).toHaveLength(1);
  });

  it('selectOverallProgress should compute percentage of completed pages', () => {
    useSlidesStore.setState({
      pages: [
        makePage(1, { status: 'completed' }),
        makePage(2, { status: 'completed' }),
        makePage(3, { status: 'pending' }),
      ],
    });
    const state = useSlidesStore.getState();
    expect(selectOverallProgress(state)).toBe(67); // Math.round(2/3 * 100)
  });

  it('selectOverallProgress should return 0 when no pages', () => {
    const state = useSlidesStore.getState();
    expect(selectOverallProgress(state)).toBe(0);
  });

  it('selectLatestCheckpoint should return the first checkpoint', () => {
    useSlidesStore.setState({
      checkpoints: [
        makeCheckpoint({ id: 'latest' }),
        makeCheckpoint({ id: 'older' }),
      ],
    });
    const state = useSlidesStore.getState();
    expect(selectLatestCheckpoint(state)?.id).toBe('latest');
  });

  it('selectLatestCheckpoint should return null when no checkpoints', () => {
    const state = useSlidesStore.getState();
    expect(selectLatestCheckpoint(state)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Utility functions
// ═════════════════════════════════════════════════════════════════════════════

describe('getPhaseWeight', () => {
  it('should return correct weight range for each phase', () => {
    expect(getPhaseWeight('task_decomposition')).toEqual({ start: 0, end: 10 });
    expect(getPhaseWeight('outline_planning')).toEqual({ start: 10, end: 20 });
    expect(getPhaseWeight('page_rendering')).toEqual({ start: 20, end: 90 });
    expect(getPhaseWeight('quality_review')).toEqual({ start: 90, end: 100 });
  });
});

describe('calculateOverallProgress', () => {
  it('should compute correctly for page_rendering at 50%', () => {
    // start=20, end=90, phaseProgress=50 => 20 + (50/100)*(90-20) = 20 + 35 = 55
    expect(calculateOverallProgress('page_rendering', 50)).toBe(55);
  });

  it('should return 0 at start of task_decomposition', () => {
    expect(calculateOverallProgress('task_decomposition', 0)).toBe(0);
  });

  it('should return 100 at end of quality_review', () => {
    expect(calculateOverallProgress('quality_review', 100)).toBe(100);
  });
});
