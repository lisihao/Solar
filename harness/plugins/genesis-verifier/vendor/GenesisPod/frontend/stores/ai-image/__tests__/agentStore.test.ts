import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  useAgentStore,
  useCurrentAgent,
  useCurrentAgentConfig,
  useProgress,
  useCurrentPlan,
  useThinkingSteps,
  useIsProcessing,
} from '../agentStore';
import type { ThinkingStep } from '../agentStore';
import {
  AgentType,
  AgentTaskStatus,
} from '@/lib/features/ai-office/agents/types';
import type {
  AgentTask,
  AgentPlan,
  AgentResult,
} from '@/lib/features/ai-office/agents/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/features/ai-office/agents/types', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/features/ai-office/agents/types')
    >();
  return {
    ...actual,
    AGENT_CONFIGS: {
      SLIDES: { name: 'Slides Agent', description: 'Creates slides' },
      DOCS: { name: 'Docs Agent', description: 'Creates docs' },
      DESIGNER: { name: 'Designer Agent', description: 'Designs' },
    },
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const initialProgress = {
  phase: 'idle' as const,
  percentage: 0,
  message: '',
  currentStep: undefined,
  completedSteps: [],
  toolCalls: [],
};

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    agentType: AgentType.SLIDES,
    status: AgentTaskStatus.PENDING,
    input: { prompt: 'Create a presentation' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as AgentTask;
}

function makePlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    taskId: 'task-1',
    agentType: AgentType.SLIDES,
    steps: [
      {
        id: 'step-1',
        name: 'Step 1',
        description: 'First step',
        dependencies: [],
        estimatedDuration: 1000,
      },
      {
        id: 'step-2',
        name: 'Step 2',
        description: 'Second step',
        dependencies: ['step-1'],
        estimatedDuration: 2000,
      },
    ],
    estimatedTime: 3000,
    toolsRequired: [],
    ...overrides,
  } as unknown as AgentPlan;
}

function makeThinkingStep(overrides: Partial<ThinkingStep> = {}): ThinkingStep {
  return {
    id: `step-${Date.now()}`,
    tool: 'web_search',
    description: 'Searching the web',
    status: 'pending',
    ...overrides,
  };
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useAgentStore.setState({
    currentAgent: null,
    currentTask: null,
    currentPlan: null,
    taskHistory: [],
    progress: initialProgress,
    thinkingSteps: [],
    result: null,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useAgentStore - initial state
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - initial state', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('should have null currentAgent', () => {
    const { result } = renderHook(() => useAgentStore());
    expect(result.current.currentAgent).toBeNull();
  });

  it('should have empty taskHistory', () => {
    const { result } = renderHook(() => useAgentStore());
    expect(result.current.taskHistory).toEqual([]);
  });

  it('should have idle progress state', () => {
    const { result } = renderHook(() => useAgentStore());
    expect(result.current.progress.phase).toBe('idle');
    expect(result.current.progress.percentage).toBe(0);
    expect(result.current.progress.completedSteps).toEqual([]);
    expect(result.current.progress.toolCalls).toEqual([]);
  });

  it('should have empty thinkingSteps and null result', () => {
    const { result } = renderHook(() => useAgentStore());
    expect(result.current.thinkingSteps).toEqual([]);
    expect(result.current.result).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setCurrentAgent / setCurrentTask / setCurrentPlan
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - basic setters', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should set and clear currentAgent', () => {
    const { result } = renderHook(() => useAgentStore());

    act(() => {
      result.current.setCurrentAgent(AgentType.SLIDES);
    });
    expect(result.current.currentAgent).toBe(AgentType.SLIDES);

    act(() => {
      result.current.setCurrentAgent(null);
    });
    expect(result.current.currentAgent).toBeNull();
  });

  it('should set and clear currentTask', () => {
    const { result } = renderHook(() => useAgentStore());
    const task = makeTask();

    act(() => {
      result.current.setCurrentTask(task);
    });
    expect(result.current.currentTask).toEqual(task);

    act(() => {
      result.current.setCurrentTask(null);
    });
    expect(result.current.currentTask).toBeNull();
  });

  it('should set and clear currentPlan', () => {
    const { result } = renderHook(() => useAgentStore());
    const plan = makePlan();

    act(() => {
      result.current.setCurrentPlan(plan);
    });
    expect(result.current.currentPlan).toEqual(plan);

    act(() => {
      result.current.setCurrentPlan(null);
    });
    expect(result.current.currentPlan).toBeNull();
  });

  it('should set result', () => {
    const { result } = renderHook(() => useAgentStore());
    const mockResult = {
      taskId: 'task-1',
      artifacts: [],
    } as unknown as AgentResult;

    act(() => {
      result.current.setResult(mockResult);
    });
    expect(result.current.result).toEqual(mockResult);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task History
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - task history', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should prepend tasks to history', () => {
    const { result } = renderHook(() => useAgentStore());
    const t1 = makeTask({ id: 'task-1' } as unknown as Partial<AgentTask>);
    const t2 = makeTask({ id: 'task-2' } as unknown as Partial<AgentTask>);

    act(() => {
      result.current.addTaskToHistory(t1);
    });
    act(() => {
      result.current.addTaskToHistory(t2);
    });

    expect(result.current.taskHistory[0]).toEqual(t2);
    expect(result.current.taskHistory[1]).toEqual(t1);
  });

  it('should cap history at 50 items', () => {
    const { result } = renderHook(() => useAgentStore());

    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.addTaskToHistory(
          makeTask({ id: `task-${i}` } as unknown as Partial<AgentTask>)
        );
      }
    });

    expect(result.current.taskHistory).toHaveLength(50);
  });

  it('should clear task history', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addTaskToHistory(makeTask());
    });

    act(() => {
      result.current.clearTaskHistory();
    });

    expect(result.current.taskHistory).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Progress
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - progress', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should update partial progress state', () => {
    const { result } = renderHook(() => useAgentStore());

    act(() => {
      result.current.updateProgress({
        phase: 'executing',
        percentage: 50,
        message: 'Working...',
      });
    });

    expect(result.current.progress.phase).toBe('executing');
    expect(result.current.progress.percentage).toBe(50);
    expect(result.current.progress.message).toBe('Working...');
  });

  it('should preserve existing progress fields when partially updating', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.updateProgress({ percentage: 30, message: 'Step 1' });
    });

    act(() => {
      result.current.updateProgress({ percentage: 60 });
    });

    expect(result.current.progress.message).toBe('Step 1'); // preserved
    expect(result.current.progress.percentage).toBe(60);
  });

  it('should reset progress to idle and clear thinking steps', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.updateProgress({ phase: 'executing', percentage: 80 });
      result.current.addThinkingStep(makeThinkingStep());
    });

    act(() => {
      result.current.resetProgress();
    });

    expect(result.current.progress).toEqual(initialProgress);
    expect(result.current.thinkingSteps).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Thinking Steps
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - thinking steps', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should append a thinking step', () => {
    const { result } = renderHook(() => useAgentStore());
    const step = makeThinkingStep({ id: 'step-1', description: 'Searching' });

    act(() => {
      result.current.addThinkingStep(step);
    });

    expect(result.current.thinkingSteps).toHaveLength(1);
    expect(result.current.thinkingSteps[0]).toEqual(step);
  });

  it('should update a thinking step by id', () => {
    const { result } = renderHook(() => useAgentStore());
    const step = makeThinkingStep({ id: 'step-1', status: 'pending' });
    act(() => {
      result.current.addThinkingStep(step);
    });

    act(() => {
      result.current.updateThinkingStep('step-1', { status: 'completed' });
    });

    expect(result.current.thinkingSteps[0].status).toBe('completed');
  });

  it('should not affect other steps when updating one', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addThinkingStep(
        makeThinkingStep({ id: 'step-1', status: 'processing' })
      );
      result.current.addThinkingStep(
        makeThinkingStep({ id: 'step-2', status: 'pending' })
      );
    });

    act(() => {
      result.current.updateThinkingStep('step-1', { status: 'completed' });
    });

    expect(result.current.thinkingSteps[1].status).toBe('pending');
  });

  it('should clear all thinking steps', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addThinkingStep(makeThinkingStep({ id: 'step-1' }));
      result.current.addThinkingStep(makeThinkingStep({ id: 'step-2' }));
    });

    act(() => {
      result.current.clearThinkingSteps();
    });

    expect(result.current.thinkingSteps).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleEvent
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - handleEvent', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should handle plan_ready event: set plan and update progress', () => {
    const { result } = renderHook(() => useAgentStore());
    const plan = makePlan();

    act(() => {
      result.current.handleEvent({
        type: 'plan_ready',
        plan,
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    expect(result.current.currentPlan).toEqual(plan);
    expect(result.current.progress.phase).toBe('planning');
    expect(result.current.progress.percentage).toBe(10);
    expect(result.current.thinkingSteps).toHaveLength(1);
    expect(result.current.thinkingSteps[0].tool).toBe('outline');
  });

  it('should handle complete event: set progress to 100% and store result', () => {
    const { result } = renderHook(() => useAgentStore());
    const mockResult = { taskId: 'task-1' } as unknown as AgentResult;

    act(() => {
      result.current.handleEvent({
        type: 'complete',
        result: mockResult,
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    expect(result.current.progress.phase).toBe('completed');
    expect(result.current.progress.percentage).toBe(100);
    expect(result.current.result).toEqual(mockResult);
  });

  it('should handle error event: set error phase and mark processing steps as error', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addThinkingStep(
        makeThinkingStep({ id: 's1', status: 'processing' })
      );
    });

    act(() => {
      result.current.handleEvent({
        type: 'error',
        error: 'Something went wrong',
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    expect(result.current.progress.phase).toBe('error');
    expect(result.current.progress.message).toBe('Something went wrong');
    expect(result.current.thinkingSteps[0].status).toBe('error');
  });

  it('should handle tool_call event: add thinking step and append to toolCalls', () => {
    const { result } = renderHook(() => useAgentStore());

    act(() => {
      result.current.handleEvent({
        type: 'tool_call',
        tool: 'web_search',
        input: { query: 'AI research' },
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    const lastStep =
      result.current.thinkingSteps[result.current.thinkingSteps.length - 1];
    expect(lastStep.tool).toBe('web_search');
    expect(lastStep.status).toBe('processing');
    expect(result.current.progress.toolCalls).toHaveLength(1);
    expect(result.current.progress.toolCalls[0].tool).toBe('web_search');
  });

  it('should handle tool_result event: update matching processing step to completed', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addThinkingStep(
        makeThinkingStep({ id: 's1', tool: 'web_search', status: 'processing' })
      );
      result.current.updateProgress({
        toolCalls: [{ tool: 'web_search', input: {}, timestamp: new Date() }],
      });
    });

    act(() => {
      result.current.handleEvent({
        type: 'tool_result',
        tool: 'web_search',
        output: 'Search results here',
        duration: 500,
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    expect(result.current.thinkingSteps[0].status).toBe('completed');
    expect(result.current.thinkingSteps[0].output).toBe('Search results here');
  });

  it('should handle thinking event: add a completed thinking step', () => {
    const { result } = renderHook(() => useAgentStore());

    act(() => {
      result.current.handleEvent({
        type: 'thinking',
        content: 'I need to analyze this carefully.',
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    const step = result.current.thinkingSteps[0];
    expect(step.tool).toBe('thinking');
    expect(step.status).toBe('completed');
    expect(step.description).toBe('I need to analyze this carefully.');
  });

  it('should handle step_complete event: mark processing steps as completed', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addThinkingStep(
        makeThinkingStep({ id: 's1', status: 'processing' })
      );
    });

    act(() => {
      result.current.handleEvent({
        type: 'step_complete',
        stepId: 's1',
        message: 'Done',
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    expect(result.current.thinkingSteps[0].status).toBe('completed');
    expect(result.current.progress.completedSteps).toContain('s1');
  });

  it('should handle progress event with non-init phase: create thinking step if none processing', () => {
    const { result } = renderHook(() => useAgentStore());

    act(() => {
      result.current.handleEvent({
        type: 'progress',
        data: {
          phase: 'extract',
          percentage: 25,
          message: 'Extracting content',
        },
      } as unknown as Parameters<typeof result.current.handleEvent>[0]);
    });

    // Should create a new thinking step for the 'extract' phase (web_search tool)
    const steps = result.current.thinkingSteps;
    expect(steps.length).toBeGreaterThan(0);
    expect(result.current.progress.percentage).toBe(25);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// reset
// ═════════════════════════════════════════════════════════════════════════════

describe('useAgentStore - reset', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should clear task, plan, progress, thinking steps, and result', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.setCurrentTask(makeTask());
      result.current.setCurrentPlan(makePlan());
      result.current.updateProgress({ phase: 'executing', percentage: 75 });
      result.current.addThinkingStep(makeThinkingStep());
      result.current.setResult({ taskId: 'task-1' } as unknown as AgentResult);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.currentTask).toBeNull();
    expect(result.current.currentPlan).toBeNull();
    expect(result.current.progress).toEqual(initialProgress);
    expect(result.current.thinkingSteps).toEqual([]);
    expect(result.current.result).toBeNull();
  });

  it('should NOT clear currentAgent when resetting', () => {
    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.setCurrentAgent(AgentType.DOCS);
    });

    act(() => {
      result.current.reset();
    });

    // The reset action does not reset currentAgent per source implementation
    expect(result.current.currentAgent).toBe(AgentType.DOCS);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Selector hooks
// ═════════════════════════════════════════════════════════════════════════════

describe('selector hooks', () => {
  beforeEach(() => {
    resetStore();
  });

  it('useCurrentAgent should return currentAgent', () => {
    act(() => {
      useAgentStore.getState().setCurrentAgent(AgentType.SLIDES);
    });
    const { result } = renderHook(() => useCurrentAgent());
    expect(result.current).toBe(AgentType.SLIDES);
  });

  it('useCurrentAgentConfig should return config when agent is set', () => {
    act(() => {
      useAgentStore.getState().setCurrentAgent(AgentType.SLIDES);
    });
    const { result } = renderHook(() => useCurrentAgentConfig());
    expect(result.current).toBeDefined();
  });

  it('useCurrentAgentConfig should return null when no agent is set', () => {
    const { result } = renderHook(() => useCurrentAgentConfig());
    expect(result.current).toBeNull();
  });

  it('useProgress should return current progress', () => {
    act(() => {
      useAgentStore
        .getState()
        .updateProgress({ percentage: 50, message: 'Half done' });
    });
    const { result } = renderHook(() => useProgress());
    expect(result.current.percentage).toBe(50);
  });

  it('useCurrentPlan should return current plan', () => {
    const plan = makePlan();
    act(() => {
      useAgentStore.getState().setCurrentPlan(plan);
    });
    const { result } = renderHook(() => useCurrentPlan());
    expect(result.current).toEqual(plan);
  });

  it('useThinkingSteps should return thinking steps array', () => {
    const step = makeThinkingStep({ id: 'step-1' });
    act(() => {
      useAgentStore.getState().addThinkingStep(step);
    });
    const { result } = renderHook(() => useThinkingSteps());
    expect(result.current).toHaveLength(1);
  });

  it('useIsProcessing should return true when phase is planning or executing', () => {
    act(() => {
      useAgentStore.getState().updateProgress({ phase: 'planning' });
    });
    const { result: r1 } = renderHook(() => useIsProcessing());
    expect(r1.current).toBe(true);

    act(() => {
      useAgentStore.getState().updateProgress({ phase: 'executing' });
    });
    const { result: r2 } = renderHook(() => useIsProcessing());
    expect(r2.current).toBe(true);
  });

  it('useIsProcessing should return false when phase is idle, completed, or error', () => {
    act(() => {
      useAgentStore.getState().updateProgress({ phase: 'completed' });
    });
    const { result } = renderHook(() => useIsProcessing());
    expect(result.current).toBe(false);
  });
});
