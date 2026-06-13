'use client';

/**
 * Topic Collaboration Panel - 团队协作面板
 *
 * 展示Agent团队的协作动态和互动历史
 */

import { useTopicContent } from './TopicContentContext';
import type { ResearchEvent as TopicResearchEvent } from './TopicContentContext';
import type { TopicMessage } from '@/lib/types/ai-teams';
import type { MissionStatus } from '@/services/topic-insights/api';

interface AgentActivity {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  agentId?: string;
  agentName?: string;
}

interface ResearchEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

interface TopicCollaborationPanelProps {
  // TeamInteractionTabContent的props会传递进来
  TeamInteractionTabContent: React.ComponentType<{
    events: ResearchEvent[];
    wsEvents: unknown[];
    wsConnected: boolean;
    onClearEvents: () => void;
    persistedMessages: TopicMessage[];
    persistedActivities: AgentActivity[];
    missionStatus: MissionStatus | null;
  }>;
  onClearEvents: () => void;
  persistedMessages: TopicMessage[];
  persistedActivities: AgentActivity[];
}

export function TopicCollaborationPanel({
  TeamInteractionTabContent,
  onClearEvents,
  persistedMessages,
  persistedActivities,
}: TopicCollaborationPanelProps) {
  const { researchEvents, wsEvents, wsConnected, missionStatus } =
    useTopicContent();

  const safeEvents = Array.isArray(researchEvents) ? researchEvents : [];

  // Convert TopicResearchEvent to ResearchEvent format
  const convertedEvents: ResearchEvent[] = safeEvents.map((event) => ({
    type: event.eventType,
    data: {
      agentType: event.agentType,
      agentName: event.agentName,
      dimensionName: event.dimensionName,
      message: event.message,
      details: event.details,
    },
    timestamp: event.timestamp.toISOString(),
  }));

  return (
    <TeamInteractionTabContent
      events={convertedEvents}
      wsEvents={wsEvents}
      wsConnected={wsConnected}
      onClearEvents={onClearEvents}
      persistedMessages={persistedMessages}
      persistedActivities={persistedActivities}
      missionStatus={missionStatus ?? null}
    />
  );
}
