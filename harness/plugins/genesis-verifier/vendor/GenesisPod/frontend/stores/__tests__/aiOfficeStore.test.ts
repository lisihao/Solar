import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useResourceStore,
  useDocumentStore,
  useChatStore,
  useUIStore,
  useTaskStore,
  type Task,
  type GenerationStep,
} from '../aiOfficeStore';
import type { Resource, Document, ChatMessage } from '@/lib/types/ai-office';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/features/ai-office/ppt-utils', () => ({
  calculateSlideCount: vi.fn((markdown: string) => {
    // Simple mock: count '---' separators + 1
    return (markdown.match(/^---$/gm) || []).length + 1;
  }),
}));

// Suppress localStorage warnings in tests
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

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    _id: 'res-1',
    title: 'Test Resource',
    type: 'file',
    url: 'https://example.com/file.pdf',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  } as unknown as Resource;
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    _id: 'doc-1',
    userId: 'user-1',
    title: 'Test Document',
    type: 'article' as Document['type'],
    content: { text: 'Hello world' },
    metadata: { wordCount: 2, slideCount: 0 },
    status: 'completed',
    resources: [],
    aiConfig: {
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 4000,
      language: 'zh-CN',
      detailLevel: 3,
      professionalLevel: 3,
    },
    generationHistory: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    versions: [],
    ...overrides,
  } as unknown as Document;
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user' as ChatMessage['role'],
    content: 'Hello',
    timestamp: new Date('2024-01-01'),
    ...overrides,
  } as ChatMessage;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    _id: 'task-1',
    title: 'Test Task',
    type: 'article',
    createdAt: new Date('2024-01-01'),
    refreshedAt: new Date('2024-01-01'),
    context: {
      resourceIds: [],
      chatMessages: [],
    },
    metadata: {},
    ...overrides,
  } as Task;
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetResourceStore() {
  useResourceStore.setState({
    resources: [],
    selectedResourceIds: [],
    isLoading: false,
    error: null,
  });
}

function resetDocumentStore() {
  useDocumentStore.setState({
    documents: [],
    currentDocumentId: null,
    selectedSlideIndex: null,
    isGenerating: false,
    generationProgress: 0,
    generationSteps: [],
    currentStep: '',
    resourcesFound: 0,
    estimatedTime: null,
    error: null,
  });
}

function resetChatStore() {
  useChatStore.setState({
    sessions: {},
    isStreaming: false,
    streamingMessage: '',
    shouldStopGeneration: false,
    error: null,
    agentMode: 'basic',
    agentStatus: null,
  });
}

function resetUIStore() {
  useUIStore.setState({
    middlePanelWidth: 650,
    resourceListCollapsed: false,
    isLoading: false,
  });
}

function resetTaskStore() {
  useTaskStore.setState({
    tasks: [],
    currentTaskId: null,
    isTaskListOpen: false,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useResourceStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useResourceStore', () => {
  beforeEach(() => {
    resetResourceStore();
    localStorageMock.clear();
  });

  describe('initial state', () => {
    it('should have empty resources and selectedResourceIds', () => {
      const { result } = renderHook(() => useResourceStore());
      expect(result.current.resources).toEqual([]);
      expect(result.current.selectedResourceIds).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('addResource', () => {
    it('should add a resource to the list', () => {
      const { result } = renderHook(() => useResourceStore());
      const res = makeResource();

      act(() => {
        result.current.addResource(res);
      });

      expect(result.current.resources).toHaveLength(1);
      expect(result.current.resources[0]).toEqual(res);
    });

    it('should NOT add duplicate resource (same _id)', () => {
      const { result } = renderHook(() => useResourceStore());
      const res = makeResource({ _id: 'res-dup' });

      act(() => {
        result.current.addResource(res);
      });
      act(() => {
        result.current.addResource(res);
      });

      expect(result.current.resources).toHaveLength(1);
    });

    it('should add multiple resources with different _ids', () => {
      const { result } = renderHook(() => useResourceStore());

      act(() => {
        result.current.addResource(makeResource({ _id: 'res-1' }));
      });
      act(() => {
        result.current.addResource(makeResource({ _id: 'res-2' }));
      });

      expect(result.current.resources).toHaveLength(2);
    });
  });

  describe('removeResource', () => {
    it('should remove resource by id', () => {
      const { result } = renderHook(() => useResourceStore());
      act(() => {
        result.current.addResource(makeResource({ _id: 'res-1' }));
      });
      act(() => {
        result.current.addResource(makeResource({ _id: 'res-2' }));
      });

      act(() => {
        result.current.removeResource('res-1');
      });

      expect(result.current.resources).toHaveLength(1);
      expect(result.current.resources[0]._id).toBe('res-2');
    });

    it('should also remove from selectedResourceIds', () => {
      const { result } = renderHook(() => useResourceStore());
      act(() => {
        result.current.addResource(makeResource({ _id: 'res-1' }));
      });
      act(() => {
        result.current.selectResource('res-1');
      });

      expect(result.current.selectedResourceIds).toContain('res-1');

      act(() => {
        result.current.removeResource('res-1');
      });

      expect(result.current.selectedResourceIds).not.toContain('res-1');
    });
  });

  describe('updateResource', () => {
    it('should update resource fields by id', () => {
      const { result } = renderHook(() => useResourceStore());
      act(() => {
        result.current.addResource(
          makeResource({
            _id: 'res-1',
            title: 'Old',
          } as unknown as Partial<Resource>)
        );
      });

      act(() => {
        result.current.updateResource('res-1', {
          title: 'New',
        } as unknown as Partial<Resource>);
      });

      expect(
        (result.current.resources[0] as unknown as { title: string }).title
      ).toBe('New');
    });
  });

  describe('selectResource / deselectResource', () => {
    it('should add resource id to selectedResourceIds', () => {
      const { result } = renderHook(() => useResourceStore());

      act(() => {
        result.current.selectResource('res-1');
      });

      expect(result.current.selectedResourceIds).toContain('res-1');
    });

    it('should NOT duplicate already-selected id', () => {
      const { result } = renderHook(() => useResourceStore());

      act(() => {
        result.current.selectResource('res-1');
      });
      act(() => {
        result.current.selectResource('res-1');
      });

      expect(result.current.selectedResourceIds).toHaveLength(1);
    });

    it('should remove resource id from selectedResourceIds', () => {
      const { result } = renderHook(() => useResourceStore());
      act(() => {
        result.current.selectResource('res-1');
      });

      act(() => {
        result.current.deselectResource('res-1');
      });

      expect(result.current.selectedResourceIds).not.toContain('res-1');
    });
  });

  describe('clearSelection', () => {
    it('should clear all selected resource ids', () => {
      const { result } = renderHook(() => useResourceStore());
      act(() => {
        result.current.selectResource('res-1');
      });
      act(() => {
        result.current.selectResource('res-2');
      });

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedResourceIds).toEqual([]);
    });
  });

  describe('setLoading / setError', () => {
    it('should set isLoading', () => {
      const { result } = renderHook(() => useResourceStore());

      act(() => {
        result.current.setLoading(true);
      });
      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.setLoading(false);
      });
      expect(result.current.isLoading).toBe(false);
    });

    it('should set and clear error', () => {
      const { result } = renderHook(() => useResourceStore());

      act(() => {
        result.current.setError('Something went wrong');
      });
      expect(result.current.error).toBe('Something went wrong');

      act(() => {
        result.current.setError(null);
      });
      expect(result.current.error).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useDocumentStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useDocumentStore', () => {
  beforeEach(() => {
    resetDocumentStore();
    localStorageMock.clear();
  });

  describe('initial state', () => {
    it('should have empty documents and null currentDocumentId', () => {
      const { result } = renderHook(() => useDocumentStore());
      expect(result.current.documents).toEqual([]);
      expect(result.current.currentDocumentId).toBeNull();
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generationProgress).toBe(0);
    });
  });

  describe('addDocument', () => {
    it('should add document to list', () => {
      const { result } = renderHook(() => useDocumentStore());
      const doc = makeDocument();

      act(() => {
        result.current.addDocument(doc);
      });

      expect(result.current.documents).toHaveLength(1);
      expect(result.current.documents[0]._id).toBe('doc-1');
    });
  });

  describe('updateDocument', () => {
    it('should update document fields by id', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(
          makeDocument({ _id: 'doc-1', title: 'Old Title' })
        );
      });

      act(() => {
        result.current.updateDocument('doc-1', { title: 'New Title' });
      });

      expect(result.current.documents[0].title).toBe('New Title');
    });

    it('should not affect other documents', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
        result.current.addDocument(
          makeDocument({ _id: 'doc-2', title: 'Keep Me' })
        );
      });

      act(() => {
        result.current.updateDocument('doc-1', { title: 'Changed' });
      });

      expect(
        result.current.documents.find((d) => d._id === 'doc-2')?.title
      ).toBe('Keep Me');
    });
  });

  describe('deleteDocument', () => {
    it('should remove document from list', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
      });
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-2' }));
      });

      act(() => {
        result.current.deleteDocument('doc-1');
      });

      expect(result.current.documents).toHaveLength(1);
      expect(result.current.documents[0]._id).toBe('doc-2');
    });

    it('should clear currentDocumentId if that document is deleted', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
      });
      act(() => {
        result.current.setCurrentDocument('doc-1');
      });

      act(() => {
        result.current.deleteDocument('doc-1');
      });

      expect(result.current.currentDocumentId).toBeNull();
    });

    it('should NOT clear currentDocumentId if a different document is deleted', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
        result.current.addDocument(makeDocument({ _id: 'doc-2' }));
        result.current.setCurrentDocument('doc-2');
      });

      act(() => {
        result.current.deleteDocument('doc-1');
      });

      expect(result.current.currentDocumentId).toBe('doc-2');
    });
  });

  describe('setCurrentDocument', () => {
    it('should set currentDocumentId', () => {
      const { result } = renderHook(() => useDocumentStore());

      act(() => {
        result.current.setCurrentDocument('doc-1');
      });

      expect(result.current.currentDocumentId).toBe('doc-1');
    });

    it('should clear selectedSlideIndex when switching documents', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.setSelectedSlideIndex(3);
      });

      act(() => {
        result.current.setCurrentDocument('doc-2');
      });

      expect(result.current.selectedSlideIndex).toBeNull();
    });
  });

  describe('setGenerating', () => {
    it('should set isGenerating to true', () => {
      const { result } = renderHook(() => useDocumentStore());

      act(() => {
        result.current.setGenerating(true);
      });

      expect(result.current.isGenerating).toBe(true);
    });

    it('should reset generationSteps, currentStep when set to false', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.setGenerating(true);
        result.current.setGenerationSteps([
          { id: 's1', name: 'Step 1', status: 'completed' },
        ]);
        result.current.setCurrentStep('s1');
        result.current.setResourcesFound(5);
      });

      act(() => {
        result.current.setGenerating(false);
      });

      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generationSteps).toEqual([]);
      expect(result.current.currentStep).toBe('');
      expect(result.current.resourcesFound).toBe(0);
      expect(result.current.estimatedTime).toBeNull();
    });
  });

  describe('updateGenerationStep', () => {
    it('should update a specific step by id', () => {
      const { result } = renderHook(() => useDocumentStore());
      const steps: GenerationStep[] = [
        { id: 's1', name: 'Step 1', status: 'pending' },
        { id: 's2', name: 'Step 2', status: 'pending' },
      ];
      act(() => {
        result.current.setGenerationSteps(steps);
      });

      act(() => {
        result.current.updateGenerationStep('s1', {
          status: 'completed',
          message: 'Done',
        });
      });

      expect(result.current.generationSteps[0].status).toBe('completed');
      expect(result.current.generationSteps[0].message).toBe('Done');
      expect(result.current.generationSteps[1].status).toBe('pending');
    });
  });

  describe('saveVersion', () => {
    it('should create a version and return its id', () => {
      const { result } = renderHook(() => useDocumentStore());
      const doc = makeDocument({ _id: 'doc-1' });
      act(() => {
        result.current.addDocument(doc);
      });

      let versionId = '';
      act(() => {
        versionId = result.current.saveVersion(
          'doc-1',
          'manual',
          'user_edit',
          'First save'
        );
      });

      expect(versionId).toMatch(/^v_\d+_/);
      expect(result.current.documents[0].versions).toHaveLength(1);
      expect(result.current.documents[0].versions[0].type).toBe('manual');
    });

    it('should return empty string when document not found', () => {
      const { result } = renderHook(() => useDocumentStore());

      let versionId = '';
      act(() => {
        versionId = result.current.saveVersion(
          'nonexistent',
          'auto',
          'ai_generation'
        );
      });

      expect(versionId).toBe('');
    });

    it('should set currentVersionId to the new version id', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
      });

      let versionId = '';
      act(() => {
        versionId = result.current.saveVersion(
          'doc-1',
          'auto',
          'ai_generation'
        );
      });

      expect(result.current.documents[0].currentVersionId).toBe(versionId);
    });
  });

  describe('getVersions', () => {
    it('should return versions for a document', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
      });
      act(() => {
        result.current.saveVersion('doc-1', 'manual', 'user_edit');
      });

      const versions = result.current.getVersions('doc-1');

      expect(versions).toHaveLength(1);
    });

    it('should return empty array for nonexistent document', () => {
      const { result } = renderHook(() => useDocumentStore());

      const versions = result.current.getVersions('nonexistent');

      expect(versions).toEqual([]);
    });
  });

  describe('restoreVersion', () => {
    it('should restore document content from a saved version', () => {
      const { result } = renderHook(() => useDocumentStore());
      const doc = makeDocument({
        _id: 'doc-1',
        content: { text: 'Original' },
      } as unknown as Partial<Document>);
      act(() => {
        result.current.addDocument(doc);
      });

      let versionId = '';
      act(() => {
        versionId = result.current.saveVersion('doc-1', 'manual', 'user_edit');
      });

      // Modify content
      act(() => {
        result.current.updateDocument('doc-1', {
          content: { text: 'Modified' },
        } as unknown as Partial<Document>);
      });

      // Restore
      act(() => {
        result.current.restoreVersion('doc-1', versionId);
      });

      const restoredContent = result.current.documents[0]
        .content as unknown as { text: string };
      expect(restoredContent.text).toBe('Original');
    });
  });

  describe('deleteVersion', () => {
    it('should remove a version from document', () => {
      const { result } = renderHook(() => useDocumentStore());
      act(() => {
        result.current.addDocument(makeDocument({ _id: 'doc-1' }));
      });

      let versionId = '';
      act(() => {
        versionId = result.current.saveVersion(
          'doc-1',
          'auto',
          'ai_generation'
        );
      });

      act(() => {
        result.current.deleteVersion('doc-1', versionId);
      });

      expect(result.current.documents[0].versions).toHaveLength(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useChatStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useChatStore', () => {
  beforeEach(() => {
    resetChatStore();
  });

  describe('initial state', () => {
    it('should have empty sessions and correct defaults', () => {
      const { result } = renderHook(() => useChatStore());
      expect(result.current.sessions).toEqual({});
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.agentMode).toBe('basic');
      expect(result.current.agentStatus).toBeNull();
    });
  });

  describe('addMessage', () => {
    it('should add message to session', () => {
      const { result } = renderHook(() => useChatStore());
      const msg = makeMessage();

      act(() => {
        result.current.addMessage('doc-1', msg);
      });

      expect(result.current.sessions['doc-1']).toHaveLength(1);
      expect(result.current.sessions['doc-1'][0]).toEqual(msg);
    });

    it('should create new session if it does not exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.addMessage('new-doc', makeMessage());
      });

      expect(result.current.sessions['new-doc']).toBeDefined();
      expect(result.current.sessions['new-doc']).toHaveLength(1);
    });

    it('should append messages in order', () => {
      const { result } = renderHook(() => useChatStore());
      const m1 = makeMessage({ id: 'msg-1', content: 'First' });
      const m2 = makeMessage({ id: 'msg-2', content: 'Second' });

      act(() => {
        result.current.addMessage('doc-1', m1);
      });
      act(() => {
        result.current.addMessage('doc-1', m2);
      });

      expect(result.current.sessions['doc-1'][0].content).toBe('First');
      expect(result.current.sessions['doc-1'][1].content).toBe('Second');
    });
  });

  describe('updateMessage', () => {
    it('should update message fields by id', () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        result.current.addMessage(
          'doc-1',
          makeMessage({ id: 'msg-1', content: 'Old' })
        );
      });

      act(() => {
        result.current.updateMessage('doc-1', 'msg-1', { content: 'Updated' });
      });

      expect(result.current.sessions['doc-1'][0].content).toBe('Updated');
    });
  });

  describe('setStreaming', () => {
    it('should set isStreaming=true and reset shouldStopGeneration', () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        result.current.stopGeneration();
      }); // set shouldStop=true first

      act(() => {
        result.current.setStreaming(true);
      });

      expect(result.current.isStreaming).toBe(true);
      expect(result.current.shouldStopGeneration).toBe(false);
    });

    it('should set isStreaming=false', () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        result.current.setStreaming(true);
      });

      act(() => {
        result.current.setStreaming(false);
      });

      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe('stopGeneration', () => {
    it('should set shouldStopGeneration=true', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.stopGeneration();
      });

      expect(result.current.shouldStopGeneration).toBe(true);
    });
  });

  describe('clearSession', () => {
    it('should empty messages for a specific document session', () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        result.current.addMessage('doc-1', makeMessage());
      });

      act(() => {
        result.current.clearSession('doc-1');
      });

      expect(result.current.sessions['doc-1']).toEqual([]);
    });
  });

  describe('setAgentMode / setAgentStatus', () => {
    it('should toggle agent mode', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.setAgentMode('enhanced');
      });
      expect(result.current.agentMode).toBe('enhanced');

      act(() => {
        result.current.setAgentMode('basic');
      });
      expect(result.current.agentMode).toBe('basic');
    });

    it('should set and clear agentStatus', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.setAgentStatus('Analyzing resources...');
      });
      expect(result.current.agentStatus).toBe('Analyzing resources...');

      act(() => {
        result.current.setAgentStatus(null);
      });
      expect(result.current.agentStatus).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useUIStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useUIStore', () => {
  beforeEach(() => {
    resetUIStore();
    localStorageMock.clear();
  });

  describe('setMiddlePanelWidth', () => {
    it('should set panel width within valid range', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setMiddlePanelWidth(600);
      });

      expect(result.current.middlePanelWidth).toBe(600);
    });

    it('should clamp to minimum 400', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setMiddlePanelWidth(100);
      });

      expect(result.current.middlePanelWidth).toBe(400);
    });

    it('should clamp to maximum 800', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setMiddlePanelWidth(9999);
      });

      expect(result.current.middlePanelWidth).toBe(800);
    });
  });

  describe('toggleResourceList', () => {
    it('should toggle resourceListCollapsed', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleResourceList();
      });
      expect(result.current.resourceListCollapsed).toBe(true);

      act(() => {
        result.current.toggleResourceList();
      });
      expect(result.current.resourceListCollapsed).toBe(false);
    });
  });

  describe('setResourceListCollapsed', () => {
    it('should set resourceListCollapsed directly', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setResourceListCollapsed(true);
      });
      expect(result.current.resourceListCollapsed).toBe(true);

      act(() => {
        result.current.setResourceListCollapsed(false);
      });
      expect(result.current.resourceListCollapsed).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('should set isLoading and optional message', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setLoading(true, 'Processing...');
      });

      expect(result.current.isLoading).toBe(true);
      expect(
        (result.current as { loadingMessage?: string }).loadingMessage
      ).toBe('Processing...');
    });
  });

  describe('setError / clearError', () => {
    it('should set an error object', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setError('Something broke', 'ERR_500');
      });

      expect(result.current.error).toEqual({
        message: 'Something broke',
        code: 'ERR_500',
      });
    });

    it('should clear error', () => {
      const { result } = renderHook(() => useUIStore());
      act(() => {
        result.current.setError('error');
      });

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeUndefined();
    });

    it('should set null to clear error via setError', () => {
      const { result } = renderHook(() => useUIStore());
      act(() => {
        result.current.setError('error');
      });

      act(() => {
        result.current.setError(null);
      });

      expect(result.current.error).toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useTaskStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useTaskStore', () => {
  beforeEach(() => {
    resetTaskStore();
    localStorageMock.clear();
  });

  describe('initial state', () => {
    it('should have empty tasks and null currentTaskId', () => {
      const { result } = renderHook(() => useTaskStore());
      expect(result.current.tasks).toEqual([]);
      expect(result.current.currentTaskId).toBeNull();
      expect(result.current.isTaskListOpen).toBe(false);
    });
  });

  describe('addTask', () => {
    it('should prepend new task to list (newest first)', () => {
      const { result } = renderHook(() => useTaskStore());
      const t1 = makeTask({ _id: 'task-1' });
      const t2 = makeTask({ _id: 'task-2' });

      act(() => {
        result.current.addTask(t1);
      });
      act(() => {
        result.current.addTask(t2);
      });

      expect(result.current.tasks[0]._id).toBe('task-2');
      expect(result.current.tasks[1]._id).toBe('task-1');
    });
  });

  describe('updateTask', () => {
    it('should update task fields', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.addTask(makeTask({ _id: 'task-1', title: 'Old' }));
      });

      act(() => {
        result.current.updateTask('task-1', { title: 'New' });
      });

      expect(result.current.tasks[0].title).toBe('New');
    });

    it('should deep merge context instead of replacing it', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.addTask(
          makeTask({
            _id: 'task-1',
            context: {
              resourceIds: ['res-1'],
              chatMessages: [],
              prompt: 'Original',
            },
          })
        );
      });

      act(() => {
        result.current.updateTask('task-1', {
          context: { resourceIds: ['res-2'] } as Task['context'],
        });
      });

      // Original prompt preserved, resourceIds updated
      expect(result.current.tasks[0].context.resourceIds).toEqual(['res-2']);
      expect(result.current.tasks[0].context.prompt).toBe('Original');
    });

    it('should update refreshedAt on each update', async () => {
      const { result } = renderHook(() => useTaskStore());
      const original = makeTask({
        _id: 'task-1',
        refreshedAt: new Date('2020-01-01'),
      });
      act(() => {
        result.current.addTask(original);
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
        result.current.updateTask('task-1', { title: 'Updated' });
      });

      expect(result.current.tasks[0].refreshedAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01').getTime()
      );
    });
  });

  describe('deleteTask', () => {
    it('should remove task from list', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.addTask(makeTask({ _id: 'task-1' }));
      });
      act(() => {
        result.current.addTask(makeTask({ _id: 'task-2' }));
      });

      act(() => {
        result.current.deleteTask('task-1');
      });

      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0]._id).toBe('task-2');
    });

    it('should clear currentTaskId if deleted task was current', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.addTask(makeTask({ _id: 'task-1' }));
      });
      act(() => {
        result.current.setCurrentTask('task-1');
      });

      act(() => {
        result.current.deleteTask('task-1');
      });

      expect(result.current.currentTaskId).toBeNull();
    });

    it('should NOT clear currentTaskId if a different task is deleted', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.addTask(makeTask({ _id: 'task-1' }));
        result.current.addTask(makeTask({ _id: 'task-2' }));
        result.current.setCurrentTask('task-2');
      });

      act(() => {
        result.current.deleteTask('task-1');
      });

      expect(result.current.currentTaskId).toBe('task-2');
    });
  });

  describe('setCurrentTask', () => {
    it('should set currentTaskId', () => {
      const { result } = renderHook(() => useTaskStore());

      act(() => {
        result.current.setCurrentTask('task-abc');
      });

      expect(result.current.currentTaskId).toBe('task-abc');
    });

    it('should clear currentTaskId when null is passed', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.setCurrentTask('task-1');
      });

      act(() => {
        result.current.setCurrentTask(null);
      });

      expect(result.current.currentTaskId).toBeNull();
    });
  });

  describe('toggleTaskList / setTaskListOpen', () => {
    it('should toggle isTaskListOpen', () => {
      const { result } = renderHook(() => useTaskStore());

      act(() => {
        result.current.toggleTaskList();
      });
      expect(result.current.isTaskListOpen).toBe(true);

      act(() => {
        result.current.toggleTaskList();
      });
      expect(result.current.isTaskListOpen).toBe(false);
    });

    it('should set isTaskListOpen directly', () => {
      const { result } = renderHook(() => useTaskStore());

      act(() => {
        result.current.setTaskListOpen(true);
      });
      expect(result.current.isTaskListOpen).toBe(true);
    });
  });

  describe('saveTaskContext', () => {
    it('should merge context into existing task context', () => {
      const { result } = renderHook(() => useTaskStore());
      act(() => {
        result.current.addTask(
          makeTask({
            _id: 'task-1',
            context: {
              resourceIds: ['res-1'],
              chatMessages: [],
              prompt: 'Hello',
            },
          })
        );
      });

      act(() => {
        result.current.saveTaskContext('task-1', { prompt: 'Updated' });
      });

      expect(result.current.tasks[0].context.prompt).toBe('Updated');
      expect(result.current.tasks[0].context.resourceIds).toEqual(['res-1']);
    });
  });
});
