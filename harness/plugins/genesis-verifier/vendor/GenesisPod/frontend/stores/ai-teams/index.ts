/**
 * AI Teams Store - Modular Architecture
 *
 * 使用 Zustand slice 模式拆分大型 store：
 * - topicsSlice: Topics 和 Members 管理
 * - messagesSlice: Messages 和 Resources 管理
 * - missionsSlice: Team Missions 管理
 * - websocketSlice: WebSocket 连接管理
 */

import { create, StateCreator } from 'zustand';
import {
  TopicMessage,
  MissionStatus,
  AgentTaskStatus,
  AgentTask,
  TeamMission,
  AddAIMemberDto,
  UpdateAIMemberDto,
} from '@/lib/types/ai-teams';

import { createTopicsSlice, TopicsSlice } from './topicsSlice';
import { createMessagesSlice, MessagesSlice } from './messagesSlice';
import { createMissionsSlice, MissionsSlice } from './missionsSlice';
import { createWebSocketSlice, WebSocketSlice } from './websocketSlice';

import { logger } from '@/lib/utils/logger';
// Combined store interface
interface AiGroupState
  extends TopicsSlice, MessagesSlice, MissionsSlice, WebSocketSlice {
  // UI Actions
  resetStore: () => void;
}

export const useAiGroupStore = create<AiGroupState>()((set, get, api) => {
  const topicsSlice = createTopicsSlice(
    set as unknown as Parameters<
      StateCreator<TopicsSlice, [], [], TopicsSlice>
    >[0],
    get as unknown as Parameters<
      StateCreator<TopicsSlice, [], [], TopicsSlice>
    >[1],
    api as unknown as Parameters<
      StateCreator<TopicsSlice, [], [], TopicsSlice>
    >[2]
  );
  const messagesSlice = createMessagesSlice(
    set as unknown as Parameters<
      StateCreator<MessagesSlice, [], [], MessagesSlice>
    >[0],
    get as unknown as Parameters<
      StateCreator<MessagesSlice, [], [], MessagesSlice>
    >[1],
    api as unknown as Parameters<
      StateCreator<MessagesSlice, [], [], MessagesSlice>
    >[2]
  );
  const missionsSlice = createMissionsSlice(
    set as unknown as Parameters<
      StateCreator<MissionsSlice, [], [], MissionsSlice>
    >[0],
    get as unknown as Parameters<
      StateCreator<MissionsSlice, [], [], MissionsSlice>
    >[1],
    api as unknown as Parameters<
      StateCreator<MissionsSlice, [], [], MissionsSlice>
    >[2]
  );
  const websocketSlice = createWebSocketSlice(
    set as unknown as Parameters<
      StateCreator<WebSocketSlice, [], [], WebSocketSlice>
    >[0],
    get as unknown as Parameters<
      StateCreator<WebSocketSlice, [], [], WebSocketSlice>
    >[1],
    api as unknown as Parameters<
      StateCreator<WebSocketSlice, [], [], WebSocketSlice>
    >[2]
  );

  // Setup WebSocket event listeners
  const setupWebSocketListeners = (
    socket: import('socket.io-client').Socket | null
  ) => {
    if (!socket) return;

    // Message events
    socket.on('message:new', (message: TopicMessage) => {
      messagesSlice.handleMessageNew(message);
    });

    socket.on('message:delete', ({ messageId }: { messageId: string }) => {
      messagesSlice.handleMessageDelete(messageId);
    });

    // Reaction events
    socket.on(
      'reaction:add',
      ({
        messageId,
        userId,
        emoji,
      }: {
        messageId: string;
        userId: string;
        emoji: string;
      }) => {
        messagesSlice.handleReactionAdd(messageId, userId, emoji);
      }
    );

    socket.on(
      'reaction:remove',
      ({
        messageId,
        userId,
        emoji,
      }: {
        messageId: string;
        userId: string;
        emoji: string;
      }) => {
        messagesSlice.handleReactionRemove(messageId, userId, emoji);
      }
    );

    // Typing events
    socket.on('member:typing', ({ userId }: { userId: string }) => {
      messagesSlice.handleMemberTyping(userId);
    });

    socket.on('ai:typing', ({ aiMemberId }: { aiMemberId: string }) => {
      messagesSlice.handleAITyping(aiMemberId);
    });

    socket.on(
      'ai:response',
      ({ aiMemberId }: { aiMemberId: string; messageId: string }) => {
        messagesSlice.handleAIResponse(aiMemberId);
      }
    );

    socket.on(
      'ai:error',
      ({ aiMemberId, error }: { aiMemberId: string; error: string }) => {
        logger.error(`AI ${aiMemberId} error:`, error);
        messagesSlice.handleAIError(aiMemberId);
      }
    );

    // Mission events
    socket.on(
      'mission:created',
      ({ mission }: { mission: TeamMission; messageId?: string }) => {
        missionsSlice.handleMissionCreated(mission);
      }
    );

    socket.on(
      'mission:status_changed',
      ({
        missionId,
        status,
        totalTasks,
        tasks,
      }: {
        missionId: string;
        status: MissionStatus;
        previousStatus: MissionStatus;
        totalTasks?: number;
        tasks?: AgentTask[];
      }) => {
        missionsSlice.handleMissionStatusChanged(
          missionId,
          status,
          totalTasks,
          tasks
        );
      }
    );

    socket.on(
      'mission:progress_updated',
      ({
        missionId,
        completedTasks,
        totalTasks,
        progressPercent,
      }: {
        missionId: string;
        completedTasks: number;
        totalTasks: number;
        progressPercent: number;
      }) => {
        missionsSlice.handleMissionProgressUpdated(
          missionId,
          completedTasks,
          totalTasks,
          progressPercent
        );
      }
    );

    // Legacy mission status event
    socket.on(
      'mission:status',
      ({
        missionId,
        status,
        progressPercent,
        completedTasks,
        totalTasks,
      }: {
        missionId: string;
        status: MissionStatus;
        progressPercent: number;
        completedTasks: number;
        totalTasks: number;
      }) => {
        logger.debug('[WS] Mission status update:', {
          missionId,
          status,
          progressPercent,
        });
        missionsSlice.handleMissionProgressUpdated(
          missionId,
          completedTasks,
          totalTasks,
          progressPercent
        );
        missionsSlice.handleMissionStatusChanged(missionId, status);
      }
    );

    socket.on(
      'task:completed',
      ({
        missionId,
        taskId,
        agentId,
      }: {
        missionId: string;
        taskId: string;
        agentId: string;
      }) => {
        missionsSlice.handleTaskCompleted(missionId, taskId, agentId);
        // Also clear typing state
        messagesSlice.handleAIResponse(agentId);
      }
    );

    socket.on(
      'task:status',
      ({
        missionId,
        taskId,
        status,
        result,
        leaderFeedback,
      }: {
        missionId: string;
        taskId: string;
        status: AgentTaskStatus;
        result?: string;
        leaderFeedback?: string;
      }) => {
        missionsSlice.handleTaskStatusUpdate(
          missionId,
          taskId,
          status,
          result,
          leaderFeedback
        );
      }
    );

    socket.on(
      'mission:agent_working',
      ({
        missionId,
        agentId,
      }: {
        missionId: string;
        agentId: string;
        taskId: string | null;
        agentName?: string;
        status?: string;
      }) => {
        missionsSlice.handleMissionAgentWorking(missionId, agentId);
        messagesSlice.handleAITyping(agentId);
      }
    );

    socket.on(
      'mission:agent_done',
      ({
        missionId,
        agentId,
      }: {
        missionId: string;
        agentId: string;
        taskId: string | null;
      }) => {
        missionsSlice.handleMissionAgentDone(missionId, agentId);
        messagesSlice.handleAIResponse(agentId);
      }
    );

    socket.on(
      'mission:completed',
      ({
        missionId,
        finalResult,
        summary,
        participantAIIds,
      }: {
        missionId: string;
        finalResult: string;
        summary: string;
        participantAIIds?: string[];
      }) => {
        missionsSlice.handleMissionCompleted(
          missionId,
          finalResult,
          summary,
          participantAIIds
        );
        // Clear typing states for all participants
        participantAIIds?.forEach((aiId) => {
          messagesSlice.handleAIResponse(aiId);
        });
      }
    );

    socket.on('mission:failed', ({ missionId }: { missionId: string }) => {
      missionsSlice.handleMissionFailed(missionId);
    });
  };

  // Override connectSocket to setup listeners synchronously after socket creation
  const originalConnectSocket = websocketSlice.connectSocket;
  const connectSocket = (userId: string) => {
    originalConnectSocket(userId);
    // Read the socket immediately after connectSocket returns — the slice stores
    // the socket via set({ socket: newSocket }) synchronously at the end of its
    // body, so get().socket is already populated at this point.
    const socket = get().socket;
    if (socket) {
      setupWebSocketListeners(socket);
    }
  };

  return {
    ...topicsSlice,
    ...messagesSlice,
    ...missionsSlice,
    ...websocketSlice,
    connectSocket,

    resetStore: () => {
      const socket = get().socket;
      if (socket) {
        socket.disconnect();
      }
      set({
        // Topics
        topics: [],
        currentTopic: null,
        isLoadingTopics: false,
        // Messages
        messages: [],
        isLoadingMessages: false,
        hasMoreMessages: false,
        nextCursor: null,
        resources: [],
        isLoadingResources: false,
        typingUsers: new Set(),
        typingAIs: new Set(),
        // Missions
        missions: [],
        currentMission: null,
        isLoadingMissions: false,
        teamMembers: [],
        isLoadingTeamMembers: false,
        // WebSocket
        socket: null,
        isConnected: false,
        currentUserId: null,
        onlineUsers: new Set(),
      });
    },
  };
});

// Re-export types for convenience
export type { TopicsSlice, MessagesSlice, MissionsSlice, WebSocketSlice };
