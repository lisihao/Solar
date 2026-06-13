import { StateCreator } from 'zustand';
import {
  Topic,
  TopicType,
  CreateTopicDto,
  UpdateTopicDto,
  AddAIMemberDto,
  UpdateAIMemberDto,
  TopicRole,
} from '@/lib/types/ai-teams';
import * as api from '@/services/ai-teams/api';

import { logger } from '@/lib/utils/logger';
export interface TopicsSlice {
  // State
  topics: Topic[];
  currentTopic: Topic | null;
  isLoadingTopics: boolean;

  // Actions
  fetchTopics: (options?: {
    type?: TopicType;
    search?: string;
  }) => Promise<void>;
  fetchTopic: (topicId: string) => Promise<void>;
  createTopic: (dto: CreateTopicDto) => Promise<Topic>;
  updateTopic: (topicId: string, dto: UpdateTopicDto) => Promise<void>;
  deleteTopic: (topicId: string) => Promise<void>;
  setCurrentTopic: (topic: Topic | null) => void;
  addMember: (
    topicId: string,
    userId: string,
    role?: TopicRole
  ) => Promise<void>;
  removeMember: (topicId: string, memberId: string) => Promise<void>;
  leaveTopicAsMember: (topicId: string) => Promise<void>;
  addAIMember: (topicId: string, dto: AddAIMemberDto) => Promise<void>;
  updateAIMember: (
    topicId: string,
    aiMemberId: string,
    dto: UpdateAIMemberDto
  ) => Promise<void>;
  removeAIMember: (topicId: string, aiMemberId: string) => Promise<void>;
}

export const createTopicsSlice: StateCreator<
  TopicsSlice,
  [],
  [],
  TopicsSlice
> = (set, get) => ({
  // Initial state
  topics: [],
  currentTopic: null,
  isLoadingTopics: false,

  // Actions
  fetchTopics: async (options) => {
    set({ isLoadingTopics: true });
    try {
      const topics = await api.getTopics(options);
      set({ topics, isLoadingTopics: false });
    } catch (error) {
      logger.error('Failed to fetch topics:', error);
      set({ isLoadingTopics: false });
    }
  },

  fetchTopic: async (topicId) => {
    try {
      const topic = await api.getTopicById(topicId);
      set({ currentTopic: topic });
      // 更新topics列表中的对应项
      set((state) => ({
        topics: state.topics.map((t) => (t.id === topicId ? topic : t)),
      }));
    } catch (error) {
      logger.error('Failed to fetch topic:', error);
    }
  },

  createTopic: async (dto) => {
    const topic = await api.createTopic(dto);
    set((state) => ({ topics: [topic, ...state.topics] }));
    return topic;
  },

  updateTopic: async (topicId, dto) => {
    const topic = await api.updateTopic(topicId, dto);
    set((state) => ({
      topics: state.topics.map((t) =>
        t.id === topicId ? { ...t, ...topic } : t
      ),
      currentTopic:
        state.currentTopic?.id === topicId
          ? { ...state.currentTopic, ...topic }
          : state.currentTopic,
    }));
  },

  deleteTopic: async (topicId) => {
    await api.deleteTopic(topicId);
    set((state) => ({
      topics: state.topics.filter((t) => t.id !== topicId),
      currentTopic:
        state.currentTopic?.id === topicId ? null : state.currentTopic,
    }));
  },

  setCurrentTopic: (topic) => {
    set({ currentTopic: topic });
  },

  // ==================== Members ====================

  addMember: async (topicId, userIdOrEmail, role) => {
    // Check if input looks like an email
    if (userIdOrEmail.includes('@')) {
      await api.addMemberByEmail(topicId, userIdOrEmail, role);
    } else {
      await api.addMember(topicId, {
        userId: userIdOrEmail,
        role,
      });
    }
    await get().fetchTopic(topicId);
  },

  removeMember: async (topicId, memberId) => {
    await api.removeMember(topicId, memberId);
    await get().fetchTopic(topicId);
  },

  leaveTopicAsMember: async (topicId) => {
    await api.leaveTopic(topicId);
    set((state) => ({
      topics: state.topics.filter((t) => t.id !== topicId),
      currentTopic:
        state.currentTopic?.id === topicId ? null : state.currentTopic,
    }));
  },

  // ==================== AI Members ====================

  addAIMember: async (topicId, dto) => {
    await api.addAIMember(topicId, dto);
    await get().fetchTopic(topicId);
  },

  updateAIMember: async (topicId, aiMemberId, dto) => {
    await api.updateAIMember(topicId, aiMemberId, dto);
    await get().fetchTopic(topicId);
  },

  removeAIMember: async (topicId, aiMemberId) => {
    await api.removeAIMember(topicId, aiMemberId);
    await get().fetchTopic(topicId);
  },
});
