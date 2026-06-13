import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAIWritingStore } from '../aiWritingStore';
import * as api from '@/services/ai-writing/api';
import type {
  WritingProject,
  Volume,
  Chapter,
  Character,
  StoryBible,
} from '@/services/ai-writing/api';

// Mock the API module
vi.mock('@/services/ai-writing/api', () => ({
  getProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getVolumes: vi.fn(),
  createVolume: vi.fn(),
  getChapter: vi.fn(),
  updateChapter: vi.fn(),
  createChapter: vi.fn(),
  getStoryBible: vi.fn(),
  updateStoryBible: vi.fn(),
  getCharacters: vi.fn(),
  createCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
  startMission: vi.fn(),
  getMissionStatus: vi.fn(),
  cancelMission: vi.fn(),
  getProjectMissions: vi.fn(),
  forceCleanupStuckMissions: vi.fn(),
  ApiError: Error,
}));

// Mock logger
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useAIWritingStore', () => {
  const mockProject: WritingProject = {
    id: 'project-1',
    name: 'Test Novel',
    description: 'A test novel',
    genre: 'fantasy',
    targetWords: 50000,
    currentWords: 0,
    status: 'PLANNING',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockVolume: Volume = {
    id: 'volume-1',
    projectId: 'project-1',
    title: 'Volume 1',
    volumeNumber: 1,
    chapters: [],
  };

  const mockChapter: Chapter = {
    id: 'chapter-1',
    volumeId: 'volume-1',
    title: 'Chapter 1',
    chapterNumber: 1,
    content: 'Chapter content',
    wordCount: 100,
    status: 'draft',
  };

  const mockCharacter: Character = {
    id: 'char-1',
    projectId: 'project-1',
    name: 'Hero',
    role: 'protagonist',
    description: 'The main character',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset store state before each test
    useAIWritingStore.setState({
      projects: [],
      currentProject: null,
      isLoadingProjects: false,
      volumes: [],
      currentChapter: null,
      isLoadingVolumes: false,
      storyBible: null,
      characters: [],
      isLoadingBible: false,
      isMissionRunning: false,
      currentMissionId: null,
      missionProgress: 0,
      missionMessage: '',
      missionCompleted: false,
      activeAgentIds: [],
      isStuckMission: false,
      stuckMissionId: null,
      conversationHistory: [],
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Projects', () => {
    describe('fetchProjects', () => {
      it('should fetch projects successfully', async () => {
        vi.mocked(api.getProjects).mockResolvedValue({ items: [mockProject] });

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchProjects();
        });

        expect(result.current.projects).toEqual([mockProject]);
        expect(result.current.isLoadingProjects).toBe(false);
        expect(result.current.error).toBeNull();
      });

      it('should handle empty projects list', async () => {
        vi.mocked(api.getProjects).mockResolvedValue({ items: [] });

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchProjects();
        });

        expect(result.current.projects).toEqual([]);
      });

      it('should handle fetch error', async () => {
        vi.mocked(api.getProjects).mockRejectedValue(
          new Error('Network error')
        );

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchProjects();
        });

        expect(result.current.error).toBe('Network error');
        expect(result.current.isLoadingProjects).toBe(false);
      });
    });

    describe('fetchProject', () => {
      it('should fetch single project', async () => {
        vi.mocked(api.getProject).mockResolvedValue(mockProject);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchProject('project-1');
        });

        expect(result.current.currentProject).toEqual(mockProject);
        expect(result.current.isLoadingProjects).toBe(false);
      });

      it('should handle silent mode without showing loading', async () => {
        vi.mocked(api.getProject).mockResolvedValue(mockProject);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchProject('project-1', true);
        });

        expect(result.current.currentProject).toEqual(mockProject);
      });

      it('should handle project fetch error', async () => {
        vi.mocked(api.getProject).mockRejectedValue(new Error('Not found'));

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchProject('project-1');
        });

        expect(result.current.error).toBe('Not found');
        expect(result.current.currentProject).toBeNull();
      });
    });

    describe('createProject', () => {
      it('should create project successfully', async () => {
        vi.mocked(api.createProject).mockResolvedValue(mockProject);

        const { result } = renderHook(() => useAIWritingStore());

        let createdProject: WritingProject | undefined;
        await act(async () => {
          createdProject = await result.current.createProject({
            name: 'Test Novel',
            description: 'A test novel',
            genre: 'fantasy',
          });
        });

        expect(createdProject).toEqual(mockProject);
        expect(result.current.projects).toContainEqual(mockProject);
      });

      it('should handle create error', async () => {
        vi.mocked(api.createProject).mockRejectedValue(
          new Error('Create failed')
        );

        const { result } = renderHook(() => useAIWritingStore());

        let error: Error | undefined;
        await act(async () => {
          try {
            await result.current.createProject({ name: 'Test' });
          } catch (err) {
            error = err as Error;
          }
        });

        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe('Create failed');
        expect(result.current.error).toBe('Create failed');
      });
    });

    describe('updateProject', () => {
      it('should update project in list and current', async () => {
        const updatedProject = { ...mockProject, name: 'Updated Title' };
        vi.mocked(api.updateProject).mockResolvedValue(updatedProject);

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial state
        act(() => {
          useAIWritingStore.setState({
            projects: [mockProject],
            currentProject: mockProject,
          });
        });

        await act(async () => {
          await result.current.updateProject('project-1', {
            name: 'Updated Title',
          });
        });

        expect(result.current.projects[0].name).toBe('Updated Title');
        expect(result.current.currentProject?.name).toBe('Updated Title');
      });
    });

    describe('deleteProject', () => {
      it('should delete project from list', async () => {
        vi.mocked(api.deleteProject).mockResolvedValue(undefined);

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial state
        act(() => {
          useAIWritingStore.setState({ projects: [mockProject] });
        });

        await act(async () => {
          await result.current.deleteProject('project-1');
        });

        expect(result.current.projects).toHaveLength(0);
      });

      it('should clear currentProject if deleted', async () => {
        vi.mocked(api.deleteProject).mockResolvedValue(undefined);

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial state
        act(() => {
          useAIWritingStore.setState({ currentProject: mockProject });
        });

        await act(async () => {
          await result.current.deleteProject('project-1');
        });

        expect(result.current.currentProject).toBeNull();
      });
    });

    describe('setCurrentProject', () => {
      it('should set current project', () => {
        const { result } = renderHook(() => useAIWritingStore());

        act(() => {
          result.current.setCurrentProject(mockProject);
        });

        expect(result.current.currentProject).toEqual(mockProject);
      });
    });
  });

  describe('Volumes & Chapters', () => {
    describe('fetchVolumes', () => {
      it('should fetch volumes successfully', async () => {
        vi.mocked(api.getVolumes).mockResolvedValue([mockVolume]);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchVolumes('project-1');
        });

        expect(result.current.volumes).toEqual([mockVolume]);
        expect(result.current.isLoadingVolumes).toBe(false);
      });

      it('should handle silent mode', async () => {
        vi.mocked(api.getVolumes).mockResolvedValue([mockVolume]);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchVolumes('project-1', true);
        });

        expect(result.current.volumes).toEqual([mockVolume]);
      });
    });

    describe('createVolume', () => {
      it('should create volume and add to list', async () => {
        vi.mocked(api.createVolume).mockResolvedValue(mockVolume);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.createVolume('project-1', {
            title: 'Volume 1',
            volumeNumber: 1,
          });
        });

        expect(result.current.volumes).toContainEqual(mockVolume);
      });
    });

    describe('fetchChapter', () => {
      it('should fetch chapter and set as current', async () => {
        vi.mocked(api.getChapter).mockResolvedValue(mockChapter);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchChapter('chapter-1');
        });

        expect(result.current.currentChapter).toEqual(mockChapter);
      });
    });

    describe('updateChapter', () => {
      it('should update chapter in volumes and current', async () => {
        const updatedChapter = { ...mockChapter, content: 'Updated content' };
        vi.mocked(api.updateChapter).mockResolvedValue(updatedChapter);

        const volumeWithChapter = {
          ...mockVolume,
          chapters: [mockChapter],
        };

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial state
        act(() => {
          useAIWritingStore.setState({
            volumes: [volumeWithChapter],
            currentChapter: mockChapter,
          });
        });

        await act(async () => {
          await result.current.updateChapter('chapter-1', 'Updated content');
        });

        expect(result.current.currentChapter?.content).toBe('Updated content');
      });
    });

    describe('createChapter', () => {
      it('should create chapter and add to volume', async () => {
        vi.mocked(api.createChapter).mockResolvedValue(mockChapter);

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial state
        act(() => {
          useAIWritingStore.setState({ volumes: [mockVolume] });
        });

        await act(async () => {
          await result.current.createChapter('volume-1', {
            title: 'Chapter 1',
            chapterNumber: 1,
          });
        });

        expect(result.current.volumes[0].chapters).toContainEqual(mockChapter);
      });
    });
  });

  describe('Story Bible & Characters', () => {
    describe('fetchStoryBible', () => {
      it('should fetch story bible', async () => {
        const mockBible: StoryBible = {
          id: 'bible-1',
          projectId: 'project-1',
          premise: 'A hero rises',
          theme: 'Good vs evil',
          tone: 'Epic',
          worldType: 'Fantasy',
          worldSettings: [],
          characters: [],
        };

        vi.mocked(api.getStoryBible).mockResolvedValue(mockBible);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchStoryBible('project-1');
        });

        expect(result.current.storyBible).toEqual(mockBible);
        expect(result.current.isLoadingBible).toBe(false);
      });

      it('should handle missing story bible gracefully', async () => {
        vi.mocked(api.getStoryBible).mockRejectedValue(new Error('Not found'));

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchStoryBible('project-1');
        });

        expect(result.current.storyBible).toBeNull();
        expect(result.current.isLoadingBible).toBe(false);
      });
    });

    describe('fetchCharacters', () => {
      it('should fetch characters list', async () => {
        vi.mocked(api.getCharacters).mockResolvedValue([mockCharacter]);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.fetchCharacters('project-1');
        });

        expect(result.current.characters).toEqual([mockCharacter]);
      });
    });

    describe('createCharacter', () => {
      it('should create character and add to list', async () => {
        vi.mocked(api.createCharacter).mockResolvedValue(mockCharacter);

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.createCharacter('project-1', {
            name: 'Hero',
            role: 'protagonist',
            description: 'The main character',
          });
        });

        expect(result.current.characters).toContainEqual(mockCharacter);
      });
    });

    describe('deleteCharacter', () => {
      it('should delete character from list', async () => {
        vi.mocked(api.deleteCharacter).mockResolvedValue(undefined);

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial state
        act(() => {
          useAIWritingStore.setState({ characters: [mockCharacter] });
        });

        await act(async () => {
          await result.current.deleteCharacter('project-1', 'char-1');
        });

        expect(result.current.characters).toHaveLength(0);
      });
    });
  });

  describe('AI Mission', () => {
    describe('startMission', () => {
      it('should initialize mission state', async () => {
        const missionId = 'mission-1';
        vi.mocked(api.startMission).mockResolvedValue({
          missionId,
          success: true,
          message: 'started',
          projectId: 'project-1',
          missionType: 'chapter',
        });

        const { result } = renderHook(() => useAIWritingStore());

        act(() => {
          result.current.startMission('project-1', {
            prompt: 'Continue writing',
            missionType: 'chapter',
          });
        });

        expect(result.current.isMissionRunning).toBe(true);
        expect(result.current.missionMessage).toBe('启动写作任务...');
        expect(result.current.missionProgress).toBe(0);
        expect(result.current.activeAgentIds).toEqual(['architect']);
      });

      it('should call startMission API', async () => {
        const missionId = 'mission-1';
        vi.mocked(api.startMission).mockResolvedValue({
          missionId,
          success: true,
          message: 'started',
          projectId: 'project-1',
          missionType: 'chapter',
        });

        const { result } = renderHook(() => useAIWritingStore());

        act(() => {
          result.current.startMission('project-1', {
            prompt: 'Continue writing',
            missionType: 'chapter',
          });
        });

        await act(async () => {
          await Promise.resolve();
        });

        expect(api.startMission).toHaveBeenCalledWith('project-1', {
          prompt: 'Continue writing',
          missionType: 'chapter',
        });
      });

      it('should handle startMission API error', async () => {
        vi.mocked(api.startMission).mockRejectedValue(
          new Error('Failed to start')
        );

        const { result } = renderHook(() => useAIWritingStore());

        let error: Error | undefined;
        await act(async () => {
          try {
            await result.current.startMission('project-1', {
              prompt: 'Continue writing',
              missionType: 'chapter',
            });
          } catch (err) {
            error = err as Error;
          }
        });

        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe('Failed to start');
        expect(result.current.error).toBe('Failed to start');
        expect(result.current.isMissionRunning).toBe(false);
      });
    });

    describe('cancelMission', () => {
      it('should cancel mission successfully', async () => {
        vi.mocked(api.cancelMission).mockResolvedValue({ success: true });

        const { result } = renderHook(() => useAIWritingStore());

        // Set initial mission state
        act(() => {
          useAIWritingStore.setState({
            isMissionRunning: true,
            currentMissionId: 'mission-1',
            missionProgress: 50,
          });
        });

        await act(async () => {
          await result.current.cancelMission('project-1');
        });

        expect(result.current.isMissionRunning).toBe(false);
        expect(result.current.currentMissionId).toBeNull();
        expect(result.current.missionProgress).toBe(0);
      });

      it('should use force cleanup when normal cancel fails', async () => {
        vi.mocked(api.cancelMission).mockRejectedValue(
          new Error('Cancel failed')
        );
        vi.mocked(api.forceCleanupStuckMissions).mockResolvedValue({
          success: true,
          cleanedCount: 1,
          message: 'cleaned',
        });

        const { result } = renderHook(() => useAIWritingStore());

        act(() => {
          useAIWritingStore.setState({ currentMissionId: 'mission-1' });
        });

        await act(async () => {
          await result.current.cancelMission('project-1');
        });

        expect(api.forceCleanupStuckMissions).toHaveBeenCalledWith('project-1');
      });
    });

    describe('checkRunningMission', () => {
      it('should detect running mission on page load', async () => {
        const runningMission = {
          id: 'mission-1',
          projectId: 'project-1',
          status: 'IN_PROGRESS' as const,
          progress: 30,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        vi.mocked(api.getProjectMissions).mockResolvedValue({
          items: [runningMission],
          total: 1,
        });

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.checkRunningMission('project-1');
        });

        expect(result.current.isMissionRunning).toBe(true);
        expect(result.current.currentMissionId).toBe('mission-1');
      });

      it('should detect stuck mission', async () => {
        const stuckTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const stuckMission = {
          id: 'mission-1',
          projectId: 'project-1',
          status: 'IN_PROGRESS' as const,
          progress: 30,
          createdAt: stuckTime,
          updatedAt: stuckTime,
        };

        vi.mocked(api.getProjectMissions).mockResolvedValue({
          items: [stuckMission],
          total: 1,
        });

        const { result } = renderHook(() => useAIWritingStore());

        await act(async () => {
          await result.current.checkRunningMission('project-1');
        });

        expect(result.current.isStuckMission).toBe(true);
        expect(result.current.stuckMissionId).toBe('mission-1');
      });
    });

    describe('clearStuckMission', () => {
      it('should clear stuck mission state', () => {
        const { result } = renderHook(() => useAIWritingStore());

        // Set stuck state
        act(() => {
          useAIWritingStore.setState({
            isStuckMission: true,
            stuckMissionId: 'mission-1',
            isMissionRunning: true,
          });
        });

        act(() => {
          result.current.clearStuckMission();
        });

        expect(result.current.isStuckMission).toBe(false);
        expect(result.current.stuckMissionId).toBeNull();
        expect(result.current.isMissionRunning).toBe(false);
      });
    });
  });

  describe('Conversation History', () => {
    it('should add message to history', () => {
      const { result } = renderHook(() => useAIWritingStore());

      const message = {
        role: 'user' as const,
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
      };

      act(() => {
        result.current.addToConversationHistory(message);
      });

      expect(result.current.conversationHistory).toHaveLength(1);
      expect(result.current.conversationHistory[0]).toEqual(message);
    });

    it('should clear conversation history', () => {
      const { result } = renderHook(() => useAIWritingStore());

      // Add some messages
      act(() => {
        result.current.addToConversationHistory({
          role: 'user',
          content: 'Hello',
        });
        result.current.addToConversationHistory({
          role: 'assistant',
          content: 'Hi',
        });
      });

      expect(result.current.conversationHistory).toHaveLength(2);

      act(() => {
        result.current.clearConversationHistory();
      });

      expect(result.current.conversationHistory).toHaveLength(0);
    });
  });

  describe('Utility', () => {
    it('should clear error', () => {
      const { result } = renderHook(() => useAIWritingStore());

      act(() => {
        useAIWritingStore.setState({ error: 'Some error' });
      });

      expect(result.current.error).toBe('Some error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('should reset entire store', () => {
      const { result } = renderHook(() => useAIWritingStore());

      // Set some state
      act(() => {
        useAIWritingStore.setState({
          projects: [mockProject],
          currentProject: mockProject,
          error: 'Some error',
        });
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.projects).toEqual([]);
      expect(result.current.currentProject).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should clear current project data', () => {
      const { result } = renderHook(() => useAIWritingStore());

      // Set project-specific state
      act(() => {
        useAIWritingStore.setState({
          currentProject: mockProject,
          volumes: [mockVolume],
          characters: [mockCharacter],
          isMissionRunning: true,
        });
      });

      act(() => {
        result.current.clearCurrentProjectData();
      });

      expect(result.current.currentProject).toBeNull();
      expect(result.current.volumes).toEqual([]);
      expect(result.current.characters).toEqual([]);
      expect(result.current.isMissionRunning).toBe(false);
    });
  });
});
