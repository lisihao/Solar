import { StateCreator } from 'zustand';
import {
  TopicMessage,
  TopicResource,
  SendMessageDto,
  AddResourceDto,
} from '@/lib/types/ai-teams';
import * as api from '@/services/ai-teams/api';

import { logger } from '@/lib/utils/logger';
// Performance: Maximum messages to keep in memory to prevent browser memory overflow
const MAX_MESSAGES_IN_MEMORY = 200;

export interface MessagesSlice {
  // State - Messages
  messages: TopicMessage[];
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  nextCursor: string | null;

  // State - Resources
  resources: TopicResource[];
  isLoadingResources: boolean;

  // State - WebSocket Typing
  typingUsers: Set<string>;
  typingAIs: Set<string>;

  // Actions - Messages
  fetchMessages: (topicId: string, cursor?: string) => Promise<void>;
  sendMessage: (topicId: string, dto: SendMessageDto) => Promise<TopicMessage>;
  deleteMessage: (topicId: string, messageId: string) => Promise<void>;
  addReaction: (
    topicId: string,
    messageId: string,
    emoji: string
  ) => Promise<void>;
  removeReaction: (
    topicId: string,
    messageId: string,
    emoji: string
  ) => Promise<void>;
  generateAIResponse: (
    topicId: string,
    aiMemberId: string
  ) => Promise<TopicMessage>;

  // Actions - Resources
  fetchResources: (topicId: string) => Promise<void>;
  addResource: (topicId: string, dto: AddResourceDto) => Promise<void>;
  removeResource: (topicId: string, resourceId: string) => Promise<void>;

  // Actions - UI
  clearMessages: () => void;

  // Internal - WebSocket message handlers
  handleMessageNew: (message: TopicMessage) => void;
  handleMessageDelete: (messageId: string) => void;
  handleReactionAdd: (messageId: string, userId: string, emoji: string) => void;
  handleReactionRemove: (
    messageId: string,
    userId: string,
    emoji: string
  ) => void;
  handleMemberTyping: (userId: string) => void;
  handleAITyping: (aiMemberId: string) => void;
  handleAIResponse: (aiMemberId: string) => void;
  handleAIError: (aiMemberId: string) => void;
}

export const createMessagesSlice: StateCreator<
  MessagesSlice,
  [],
  [],
  MessagesSlice
> = (set, get) => ({
  // Initial state
  messages: [],
  isLoadingMessages: false,
  hasMoreMessages: false,
  nextCursor: null,
  resources: [],
  isLoadingResources: false,
  typingUsers: new Set(),
  typingAIs: new Set(),

  // ==================== Messages ====================

  fetchMessages: async (topicId, cursor) => {
    set({ isLoadingMessages: true });
    try {
      const response = await api.getMessages(topicId, { cursor, limit: 50 });

      // Debug: Log image message content lengths
      response.messages.forEach((m) => {
        if (m.content?.includes('![')) {
          logger.debug('[fetchMessages] Image message found:', {
            messageId: m.id,
            contentLength: m.content.length,
            hasBase64: m.content.includes('data:image'),
            preview: m.content.substring(0, 100),
          });
        }
      });

      set((state) => {
        let newMessages = cursor
          ? [...response.messages, ...state.messages]
          : response.messages;

        // Performance: Limit messages in memory
        if (newMessages.length > MAX_MESSAGES_IN_MEMORY) {
          // Keep the most recent messages (at the end of the array)
          newMessages = newMessages.slice(-MAX_MESSAGES_IN_MEMORY);
          logger.debug(
            `[Messages] Trimmed to ${MAX_MESSAGES_IN_MEMORY} most recent messages`
          );
        }

        return {
          messages: newMessages,
          hasMoreMessages: response.hasMore,
          nextCursor: response.nextCursor,
          isLoadingMessages: false,
        };
      });
    } catch (error) {
      logger.error('Failed to fetch messages:', error);
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (topicId, dto) => {
    const message = await api.sendMessage(topicId, dto);
    // WebSocket已实现message:new事件，会自动添加消息到state，不需要手动更新
    return message;
  },

  deleteMessage: async (topicId, messageId) => {
    await api.deleteMessage(topicId, messageId);
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    }));
  },

  addReaction: async (topicId, messageId, emoji) => {
    await api.addReaction(topicId, messageId, emoji);
    // WebSocket已实现reaction:add事件，会自动更新state，不需要手动更新
  },

  removeReaction: async (topicId, messageId, emoji) => {
    await api.removeReaction(topicId, messageId, emoji);
    // WebSocket已实现reaction:remove事件，会自动更新state，不需要手动更新
  },

  generateAIResponse: async (topicId, aiMemberId) => {
    // Set AI as typing
    set((state) => {
      const newSet = new Set(state.typingAIs);
      newSet.add(aiMemberId);
      return { typingAIs: newSet };
    });

    try {
      const message = await api.generateAIResponse(topicId, aiMemberId);
      // WebSocket未实现，需要手动更新state
      set((state) => {
        let newMessages = [...state.messages, message];
        // Performance: Trim old messages if exceeding limit
        if (newMessages.length > MAX_MESSAGES_IN_MEMORY) {
          newMessages = newMessages.slice(-MAX_MESSAGES_IN_MEMORY);
          logger.debug(
            `[generateAIResponse] Trimmed to ${MAX_MESSAGES_IN_MEMORY} most recent messages`
          );
        }
        return { messages: newMessages };
      });
      return message;
    } catch (error) {
      logger.error('Failed to generate AI response:', error);
      throw error;
    } finally {
      // Remove AI from typing
      set((state) => {
        const newSet = new Set(state.typingAIs);
        newSet.delete(aiMemberId);
        return { typingAIs: newSet };
      });
    }
  },

  // ==================== Resources ====================

  fetchResources: async (topicId) => {
    set({ isLoadingResources: true });
    try {
      const resources = await api.getResources(topicId);
      set({ resources, isLoadingResources: false });
    } catch (error) {
      logger.error('Failed to fetch resources:', error);
      set({ isLoadingResources: false });
    }
  },

  addResource: async (topicId, dto) => {
    const resource = await api.addResource(topicId, dto);
    set((state) => ({ resources: [resource, ...state.resources] }));
  },

  removeResource: async (topicId, resourceId) => {
    await api.removeResource(topicId, resourceId);
    set((state) => ({
      resources: state.resources.filter((r) => r.id !== resourceId),
    }));
  },

  // ==================== UI ====================

  clearMessages: () => {
    set({ messages: [], hasMoreMessages: false, nextCursor: null });
  },

  // ==================== WebSocket Handlers ====================

  handleMessageNew: (message) => {
    logger.debug('[WS] Received message:new event:', {
      messageId: message.id,
      topicId: message.topicId,
      senderId: message.senderId,
      aiMemberId: message.aiMemberId,
      contentLength: message.content?.length || 0,
      contentPreview: message.content?.substring(0, 100),
      hasImageMarkdown: message.content?.includes('!['),
    });
    set((state) => {
      // 防止重复添加消息
      if (state.messages.some((m) => m.id === message.id)) {
        logger.debug('[WS] Message already exists, skipping:', message.id);
        return state;
      }
      logger.debug('[WS] Adding new message to state:', message.id);

      // Performance: Trim old messages if exceeding limit
      let newMessages = [...state.messages, message];
      if (newMessages.length > MAX_MESSAGES_IN_MEMORY) {
        const trimCount = newMessages.length - MAX_MESSAGES_IN_MEMORY;
        logger.debug(
          `[WS] Trimming ${trimCount} old messages to stay within ${MAX_MESSAGES_IN_MEMORY} limit`
        );
        newMessages = newMessages.slice(trimCount);
      }

      return { messages: newMessages };
    });
  },

  handleMessageDelete: (messageId) => {
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    }));
  },

  handleReactionAdd: (messageId, userId, emoji) => {
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id === messageId) {
          const reactions = m.reactions || [];
          const existingReaction = reactions.find(
            (r) => r.userId === userId && r.emoji === emoji
          );
          if (!existingReaction) {
            return {
              ...m,
              reactions: [
                ...reactions,
                {
                  id: '',
                  messageId,
                  userId,
                  emoji,
                  createdAt: new Date().toISOString(),
                },
              ],
            };
          }
        }
        return m;
      }),
    }));
  },

  handleReactionRemove: (messageId, userId, emoji) => {
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id === messageId) {
          return {
            ...m,
            reactions: (m.reactions || []).filter(
              (r) => !(r.userId === userId && r.emoji === emoji)
            ),
          };
        }
        return m;
      }),
    }));
  },

  handleMemberTyping: (userId) => {
    set((state) => {
      const newSet = new Set(state.typingUsers);
      newSet.add(userId);
      return { typingUsers: newSet };
    });
    // 3秒后自动移除
    setTimeout(() => {
      set((state) => {
        const newSet = new Set(state.typingUsers);
        newSet.delete(userId);
        return { typingUsers: newSet };
      });
    }, 3000);
  },

  handleAITyping: (aiMemberId) => {
    set((state) => {
      const newSet = new Set(state.typingAIs);
      newSet.add(aiMemberId);
      return { typingAIs: newSet };
    });
  },

  handleAIResponse: (aiMemberId) => {
    set((state) => {
      const newSet = new Set(state.typingAIs);
      newSet.delete(aiMemberId);
      return { typingAIs: newSet };
    });
  },

  handleAIError: (aiMemberId) => {
    set((state) => {
      const newSet = new Set(state.typingAIs);
      newSet.delete(aiMemberId);
      return { typingAIs: newSet };
    });
  },
});
