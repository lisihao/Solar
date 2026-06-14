import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useAiGroupStore } from '../ai-teams';
import * as api from '@/services/ai-teams/api';
import {
  TopicResourceType,
  TopicType,
  MessageContentType,
  MissionStatus,
} from '@/lib/types/ai-teams';

// Mock the API module
vi.mock('@/services/ai-teams/api');
vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: vi.fn(() => ({ accessToken: 'test-token' })),
}));

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    id: 'mock-socket-id',
    io: {
      on: vi.fn(),
      engine: { on: vi.fn() },
    },
  })),
}));

const mockApi = vi.mocked(api);

describe('aiTeamsStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    const { result } = renderHook(() => useAiGroupStore());
    act(() => {
      result.current.resetStore();
    });
    vi.clearAllMocks();
  });

  describe('Topics', () => {
    const mockTopics = [
      {
        id: 'topic-1',
        name: 'Test Topic 1',
        description: 'Description 1',
        type: TopicType.PUBLIC,
        avatar: null,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        settings: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        members: [],
        aiMembers: [],
        memberCount: 0,
        aiMemberCount: 0,
      },
      {
        id: 'topic-2',
        name: 'Test Topic 2',
        description: 'Description 2',
        type: TopicType.PUBLIC,
        avatar: null,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        settings: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        members: [],
        aiMembers: [],
        memberCount: 0,
        aiMemberCount: 0,
      },
    ];

    it('should fetch topics successfully', async () => {
      mockApi.getTopics.mockResolvedValue(mockTopics);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.fetchTopics();
      });

      expect(result.current.topics).toHaveLength(2);
      expect(result.current.topics[0].name).toBe('Test Topic 1');
      expect(result.current.isLoadingTopics).toBe(false);
    });

    it('should handle fetch topics error', async () => {
      mockApi.getTopics.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.fetchTopics();
      });

      expect(result.current.topics).toHaveLength(0);
      expect(result.current.isLoadingTopics).toBe(false);
    });

    it('should create a new topic', async () => {
      const newTopic = {
        id: 'topic-3',
        name: 'New Topic',
        description: 'New description',
        type: TopicType.PUBLIC,
        avatar: null,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        settings: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        members: [],
        aiMembers: [],
        memberCount: 0,
        aiMemberCount: 0,
      };
      mockApi.createTopic.mockResolvedValue(newTopic);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.createTopic({
          name: 'New Topic',
          description: 'New description',
        });
      });

      expect(result.current.topics).toHaveLength(1);
      expect(result.current.topics[0].name).toBe('New Topic');
    });

    it('should update a topic', async () => {
      const updatedTopic = {
        id: 'topic-1',
        name: 'Updated Topic',
        description: 'Updated description',
        type: TopicType.PUBLIC,
        avatar: null,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        settings: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        members: [],
        aiMembers: [],
        memberCount: 0,
        aiMemberCount: 0,
      };
      mockApi.updateTopic.mockResolvedValue(updatedTopic);

      const { result } = renderHook(() => useAiGroupStore());

      // First add a topic to the store
      act(() => {
        result.current.setCurrentTopic({
          id: 'topic-1',
          name: 'Original Topic',
          description: 'Original description',
          type: TopicType.PUBLIC,
          avatar: null,
          createdById: 'user-1',
          createdBy: {
            id: 'user-1',
            username: 'testuser',
            fullName: 'Test User',
            avatarUrl: null,
          },
          settings: null,
          metadata: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archivedAt: null,
          members: [],
          aiMembers: [],
          memberCount: 0,
          aiMemberCount: 0,
        });
      });

      await act(async () => {
        await result.current.updateTopic('topic-1', {
          name: 'Updated Topic',
        });
      });

      expect(result.current.currentTopic?.name).toBe('Updated Topic');
    });

    it('should delete a topic', async () => {
      mockApi.deleteTopic.mockResolvedValue(undefined);
      mockApi.getTopics.mockResolvedValue([
        {
          id: 'topic-1',
          name: 'Topic 1',
          description: null,
          type: TopicType.PUBLIC,
          avatar: null,
          createdById: 'user-1',
          createdBy: {
            id: 'user-1',
            username: 'testuser',
            fullName: 'Test User',
            avatarUrl: null,
          },
          settings: null,
          metadata: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archivedAt: null,
          members: [],
          aiMembers: [],
          memberCount: 0,
          aiMemberCount: 0,
        },
      ]);

      const { result } = renderHook(() => useAiGroupStore());

      // First fetch topics
      await act(async () => {
        await result.current.fetchTopics();
      });
      expect(result.current.topics).toHaveLength(1);

      // Delete the topic
      await act(async () => {
        await result.current.deleteTopic('topic-1');
      });

      expect(result.current.topics).toHaveLength(0);
    });

    it('should set current topic', () => {
      const topic = {
        id: 'topic-1',
        name: 'Test Topic',
        description: null,
        type: TopicType.PUBLIC,
        avatar: null,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        settings: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        members: [],
        aiMembers: [],
        memberCount: 0,
        aiMemberCount: 0,
      };

      const { result } = renderHook(() => useAiGroupStore());

      act(() => {
        result.current.setCurrentTopic(topic);
      });

      expect(result.current.currentTopic).toEqual(topic);
    });
  });

  describe('Messages', () => {
    const mockMessagesResponse = {
      messages: [
        {
          id: 'msg-1',
          content: 'Hello',
          topicId: 'topic-1',
          senderId: 'user-1',
          sender: {
            id: 'user-1',
            username: 'testuser',
            fullName: 'Test User',
            avatarUrl: null,
          },
          aiMemberId: null,
          aiMember: null,
          contentType: MessageContentType.TEXT,
          prompt: null,
          modelUsed: null,
          tokensUsed: null,
          replyToId: null,
          replyTo: null,
          mentions: [],
          attachments: [],
          reactions: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        },
        {
          id: 'msg-2',
          content: 'World',
          topicId: 'topic-1',
          senderId: 'user-2',
          sender: {
            id: 'user-2',
            username: 'testuser2',
            fullName: 'Test User 2',
            avatarUrl: null,
          },
          aiMemberId: null,
          aiMember: null,
          contentType: MessageContentType.TEXT,
          prompt: null,
          modelUsed: null,
          tokensUsed: null,
          replyToId: null,
          replyTo: null,
          mentions: [],
          attachments: [],
          reactions: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        },
      ],
      hasMore: false,
      nextCursor: null,
    };

    it('should fetch messages successfully', async () => {
      mockApi.getMessages.mockResolvedValue(mockMessagesResponse);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.fetchMessages('topic-1');
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].content).toBe('Hello');
      expect(result.current.isLoadingMessages).toBe(false);
    });

    it('should append messages when cursor is provided', async () => {
      const initialResponse = {
        messages: [
          {
            id: 'msg-1',
            content: 'First',
            topicId: 'topic-1',
            senderId: 'user-1',
            sender: {
              id: 'user-1',
              username: 'testuser',
              fullName: 'Test User',
              avatarUrl: null,
            },
            aiMemberId: null,
            aiMember: null,
            contentType: MessageContentType.TEXT,
            prompt: null,
            modelUsed: null,
            tokensUsed: null,
            replyToId: null,
            replyTo: null,
            mentions: [],
            attachments: [],
            reactions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
          },
        ],
        hasMore: true,
        nextCursor: 'cursor-1',
      };
      const appendResponse = {
        messages: [
          {
            id: 'msg-2',
            content: 'Second',
            topicId: 'topic-1',
            senderId: 'user-1',
            sender: {
              id: 'user-1',
              username: 'testuser',
              fullName: 'Test User',
              avatarUrl: null,
            },
            aiMemberId: null,
            aiMember: null,
            contentType: MessageContentType.TEXT,
            prompt: null,
            modelUsed: null,
            tokensUsed: null,
            replyToId: null,
            replyTo: null,
            mentions: [],
            attachments: [],
            reactions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
          },
        ],
        hasMore: false,
        nextCursor: null,
      };

      mockApi.getMessages
        .mockResolvedValueOnce(initialResponse)
        .mockResolvedValueOnce(appendResponse);

      const { result } = renderHook(() => useAiGroupStore());

      // First fetch
      await act(async () => {
        await result.current.fetchMessages('topic-1');
      });
      expect(result.current.messages).toHaveLength(1);

      // Fetch more with cursor
      await act(async () => {
        await result.current.fetchMessages('topic-1', 'cursor-1');
      });
      expect(result.current.messages).toHaveLength(2);
    });

    it('should send a message', async () => {
      const newMessage = {
        id: 'msg-new',
        content: 'New message',
        topicId: 'topic-1',
        senderId: 'user-1',
        sender: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        aiMemberId: null,
        aiMember: null,
        contentType: MessageContentType.TEXT,
        prompt: null,
        modelUsed: null,
        tokensUsed: null,
        replyToId: null,
        replyTo: null,
        mentions: [],
        attachments: [],
        reactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      mockApi.sendMessage.mockResolvedValue(newMessage);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.sendMessage('topic-1', { content: 'New message' });
      });

      expect(mockApi.sendMessage).toHaveBeenCalledWith('topic-1', {
        content: 'New message',
      });
    });

    it('should delete a message', async () => {
      mockApi.deleteMessage.mockResolvedValue(undefined);
      mockApi.getMessages.mockResolvedValue({
        messages: [
          {
            id: 'msg-1',
            content: 'Hello',
            topicId: 'topic-1',
            senderId: 'user-1',
            sender: {
              id: 'user-1',
              username: 'testuser',
              fullName: 'Test User',
              avatarUrl: null,
            },
            aiMemberId: null,
            aiMember: null,
            contentType: MessageContentType.TEXT,
            prompt: null,
            modelUsed: null,
            tokensUsed: null,
            replyToId: null,
            replyTo: null,
            mentions: [],
            attachments: [],
            reactions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
          },
        ],
        hasMore: false,
        nextCursor: null,
      });

      const { result } = renderHook(() => useAiGroupStore());

      // First fetch messages
      await act(async () => {
        await result.current.fetchMessages('topic-1');
      });
      expect(result.current.messages).toHaveLength(1);

      // Delete message
      await act(async () => {
        await result.current.deleteMessage('topic-1', 'msg-1');
      });

      expect(result.current.messages).toHaveLength(0);
    });

    it('should clear messages', () => {
      const { result } = renderHook(() => useAiGroupStore());

      // Set some state first
      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages).toHaveLength(0);
      expect(result.current.hasMoreMessages).toBe(false);
      expect(result.current.nextCursor).toBeNull();
    });
  });

  describe('Resources', () => {
    const mockResources = [
      {
        id: 'resource-1',
        topicId: 'topic-1',
        type: TopicResourceType.LINK,
        name: 'Test Resource',
        url: 'https://example.com/1',
        resourceId: 'res-1',
        fileUrl: null,
        fileSize: null,
        mimeType: null,
        sourceMessageId: null,
        addedById: 'user-1',
        addedBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
        },
        createdAt: new Date().toISOString(),
      },
    ];

    it('should fetch resources successfully', async () => {
      mockApi.getResources.mockResolvedValue(mockResources);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.fetchResources('topic-1');
      });

      expect(result.current.resources).toHaveLength(1);
      expect(result.current.resources[0].id).toBe('resource-1');
      expect(result.current.isLoadingResources).toBe(false);
    });

    it('should add a resource', async () => {
      const newResource = {
        id: 'resource-2',
        topicId: 'topic-1',
        type: TopicResourceType.LINK,
        name: 'Test Resource',
        url: 'https://example.com/new',
        resourceId: 'res-2',
        fileUrl: null,
        fileSize: null,
        mimeType: null,
        sourceMessageId: null,
        addedById: 'user-1',
        addedBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
        },
        createdAt: new Date().toISOString(),
      };
      mockApi.addResource.mockResolvedValue(newResource);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.addResource('topic-1', {
          type: TopicResourceType.LINK,
          name: 'Test Resource',
          url: 'https://example.com/new',
        });
      });

      expect(result.current.resources).toHaveLength(1);
      expect(result.current.resources[0].id).toBe('resource-2');
    });

    it('should remove a resource', async () => {
      mockApi.removeResource.mockResolvedValue(undefined);
      mockApi.getResources.mockResolvedValue([
        {
          id: 'resource-1',
          topicId: 'topic-1',
          type: TopicResourceType.LINK,
          name: 'Test Resource',
          url: 'https://example.com/1',
          resourceId: 'res-1',
          fileUrl: null,
          fileSize: null,
          mimeType: null,
          sourceMessageId: null,
          addedById: 'user-1',
          addedBy: {
            id: 'user-1',
            username: 'testuser',
            fullName: 'Test User',
          },
          createdAt: new Date().toISOString(),
        },
      ]);

      const { result } = renderHook(() => useAiGroupStore());

      // First fetch resources
      await act(async () => {
        await result.current.fetchResources('topic-1');
      });
      expect(result.current.resources).toHaveLength(1);

      // Remove resource
      await act(async () => {
        await result.current.removeResource('topic-1', 'resource-1');
      });

      expect(result.current.resources).toHaveLength(0);
    });
  });

  describe('Team Missions', () => {
    const mockMissions = {
      missions: [
        {
          id: 'mission-1',
          topicId: 'topic-1',
          title: 'Test Mission',
          description: 'Test description',
          objectives: [],
          constraints: [],
          deliverables: [],
          status: MissionStatus.PENDING,
          leaderId: 'ai-1',
          leader: {
            id: 'ai-1',
            displayName: 'AI Leader',
            agentName: 'Leader',
            avatar: null,
            aiModel: 'gpt-4',
          },
          totalTasks: 0,
          completedTasks: 0,
          progressPercent: 0,
          createdById: 'user-1',
          createdBy: {
            id: 'user-1',
            username: 'testuser',
            fullName: 'Test User',
          },
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          finalResult: null,
          summary: null,
        },
      ],
      total: 1,
    };

    it('should fetch missions successfully', async () => {
      mockApi.getMissions.mockResolvedValue(mockMissions);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.fetchMissions('topic-1');
      });

      expect(result.current.missions).toHaveLength(1);
      expect(result.current.missions[0].title).toBe('Test Mission');
      expect(result.current.isLoadingMissions).toBe(false);
    });

    it('should create a mission', async () => {
      const newMission = {
        id: 'mission-2',
        topicId: 'topic-1',
        title: 'New Mission',
        description: 'Test description',
        objectives: [],
        constraints: [],
        deliverables: [],
        status: MissionStatus.PENDING,
        leaderId: 'ai-1',
        leader: {
          id: 'ai-1',
          displayName: 'AI Leader',
          agentName: 'Leader',
          avatar: null,
          aiModel: 'gpt-4',
        },
        totalTasks: 0,
        completedTasks: 0,
        progressPercent: 0,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
        },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        finalResult: null,
        summary: null,
      };
      mockApi.createMission.mockResolvedValue(newMission);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.createMission('topic-1', {
          title: 'New Mission',
          description: 'Test description',
          leaderId: 'ai-1',
        });
      });

      expect(result.current.missions).toHaveLength(1);
      expect(result.current.currentMission?.id).toBe('mission-2');
    });

    it('should cancel a mission', async () => {
      const cancelledMission = {
        id: 'mission-1',
        topicId: 'topic-1',
        title: 'Test Mission',
        description: 'Test description',
        objectives: [],
        constraints: [],
        deliverables: [],
        status: MissionStatus.CANCELLED,
        leaderId: 'ai-1',
        leader: {
          id: 'ai-1',
          displayName: 'AI Leader',
          agentName: 'Leader',
          avatar: null,
          aiModel: 'gpt-4',
        },
        totalTasks: 0,
        completedTasks: 0,
        progressPercent: 0,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
        },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        finalResult: null,
        summary: null,
      };
      mockApi.cancelMission.mockResolvedValue(cancelledMission);
      mockApi.getMissions.mockResolvedValue({
        missions: [
          {
            id: 'mission-1',
            topicId: 'topic-1',
            title: 'Test Mission',
            description: 'Test description',
            objectives: [],
            constraints: [],
            deliverables: [],
            status: MissionStatus.PENDING,
            leaderId: 'ai-1',
            leader: {
              id: 'ai-1',
              displayName: 'AI Leader',
              agentName: 'Leader',
              avatar: null,
              aiModel: 'gpt-4',
            },
            totalTasks: 0,
            completedTasks: 0,
            progressPercent: 0,
            createdById: 'user-1',
            createdBy: {
              id: 'user-1',
              username: 'testuser',
              fullName: 'Test User',
            },
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            finalResult: null,
            summary: null,
          },
        ],
        total: 1,
      });

      const { result } = renderHook(() => useAiGroupStore());

      // First fetch missions
      await act(async () => {
        await result.current.fetchMissions('topic-1');
      });

      // Cancel mission
      await act(async () => {
        await result.current.cancelMission('topic-1', 'mission-1');
      });

      expect(result.current.missions[0].status).toBe('CANCELLED');
    });

    it('should set current mission', () => {
      const mission = {
        id: 'mission-1',
        topicId: 'topic-1',
        title: 'Test Mission',
        description: 'Test description',
        objectives: [],
        constraints: [],
        deliverables: [],
        status: MissionStatus.PENDING,
        leaderId: 'ai-1',
        leader: {
          id: 'ai-1',
          displayName: 'AI Leader',
          agentName: 'Leader',
          avatar: null,
          aiModel: 'gpt-4',
        },
        totalTasks: 0,
        completedTasks: 0,
        progressPercent: 0,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
        },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        finalResult: null,
        summary: null,
      };

      const { result } = renderHook(() => useAiGroupStore());

      act(() => {
        result.current.setCurrentMission(mission);
      });

      expect(result.current.currentMission).toEqual(mission);
    });
  });

  describe('Team Members', () => {
    const mockTeamMembers = {
      leader: {
        id: 'ai-1',
        topicId: 'topic-1',
        aiModel: 'gpt-4',
        displayName: 'AI Leader',
        avatar: null,
        roleDescription: null,
        systemPrompt: null,
        contextWindow: 4096,
        responseStyle: null,
        autoRespond: false,
        isLeader: true,
        addedById: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      members: [
        {
          id: 'ai-2',
          topicId: 'topic-1',
          aiModel: 'gpt-4',
          displayName: 'AI Member',
          avatar: null,
          roleDescription: null,
          systemPrompt: null,
          contextWindow: 4096,
          responseStyle: null,
          autoRespond: false,
          isLeader: false,
          addedById: 'user-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      all: [
        {
          id: 'ai-1',
          topicId: 'topic-1',
          aiModel: 'gpt-4',
          displayName: 'AI Leader',
          avatar: null,
          roleDescription: null,
          systemPrompt: null,
          contextWindow: 4096,
          responseStyle: null,
          autoRespond: false,
          isLeader: true,
          addedById: 'user-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'ai-2',
          topicId: 'topic-1',
          aiModel: 'gpt-4',
          displayName: 'AI Member',
          avatar: null,
          roleDescription: null,
          systemPrompt: null,
          contextWindow: 4096,
          responseStyle: null,
          autoRespond: false,
          isLeader: false,
          addedById: 'user-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    it('should fetch team members successfully', async () => {
      mockApi.getTeamMembers.mockResolvedValue(mockTeamMembers);

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.fetchTeamMembers('topic-1');
      });

      expect(result.current.teamMembers).toHaveLength(2);
      expect(result.current.isLoadingTeamMembers).toBe(false);
    });

    it('should set team leader', async () => {
      mockApi.setTeamLeader.mockResolvedValue({
        id: 'ai-2',
        topicId: 'topic-1',
        aiModel: 'gpt-4',
        displayName: 'AI Member',
        avatar: null,
        roleDescription: null,
        systemPrompt: null,
        contextWindow: 4096,
        responseStyle: null,
        autoRespond: false,
        isLeader: true,
        addedById: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      mockApi.getTeamMembers.mockResolvedValue(mockTeamMembers);
      mockApi.getTopicById.mockResolvedValue({
        id: 'topic-1',
        name: 'Test Topic',
        description: null,
        type: TopicType.PUBLIC,
        avatar: null,
        createdById: 'user-1',
        createdBy: {
          id: 'user-1',
          username: 'testuser',
          fullName: 'Test User',
          avatarUrl: null,
        },
        settings: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        members: [],
        aiMembers: [],
        memberCount: 0,
        aiMemberCount: 0,
      });

      const { result } = renderHook(() => useAiGroupStore());

      await act(async () => {
        await result.current.setTeamLeader('topic-1', 'ai-2');
      });

      expect(mockApi.setTeamLeader).toHaveBeenCalledWith('topic-1', 'ai-2');
    });
  });

  describe('Store Reset', () => {
    it('should reset all state', async () => {
      mockApi.getTopics.mockResolvedValue([
        {
          id: 'topic-1',
          name: 'Test Topic',
          description: null,
          type: TopicType.PUBLIC,
          avatar: null,
          createdById: 'user-1',
          createdBy: {
            id: 'user-1',
            username: 'testuser',
            fullName: 'Test User',
            avatarUrl: null,
          },
          settings: null,
          metadata: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archivedAt: null,
          members: [],
          aiMembers: [],
          memberCount: 0,
          aiMemberCount: 0,
        },
      ]);
      mockApi.getMessages.mockResolvedValue({
        messages: [
          {
            id: 'msg-1',
            content: 'Hello',
            topicId: 'topic-1',
            senderId: 'user-1',
            sender: {
              id: 'user-1',
              username: 'testuser',
              fullName: 'Test User',
              avatarUrl: null,
            },
            aiMemberId: null,
            aiMember: null,
            contentType: MessageContentType.TEXT,
            prompt: null,
            modelUsed: null,
            tokensUsed: null,
            replyToId: null,
            replyTo: null,
            mentions: [],
            attachments: [],
            reactions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
          },
        ],
        hasMore: false,
        nextCursor: null,
      });

      const { result } = renderHook(() => useAiGroupStore());

      // Populate some state
      await act(async () => {
        await result.current.fetchTopics();
        await result.current.fetchMessages('topic-1');
      });

      expect(result.current.topics).toHaveLength(1);
      expect(result.current.messages).toHaveLength(1);

      // Reset store
      act(() => {
        result.current.resetStore();
      });

      expect(result.current.topics).toHaveLength(0);
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.currentTopic).toBeNull();
      expect(result.current.missions).toHaveLength(0);
      expect(result.current.resources).toHaveLength(0);
    });
  });
});
