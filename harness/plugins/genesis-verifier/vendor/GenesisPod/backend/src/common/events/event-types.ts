/**
 * Event Types
 *
 * Centralized type definitions for all cross-module events.
 * This ensures type safety when publishing and subscribing to events.
 */

import { EventPayload } from "./event-bus.service";

// ==================== Event Names ====================

export const EventNames = {
  // Mission Events
  MISSION_CREATED: "mission:created",
  MISSION_STARTED: "mission:started",
  MISSION_COMPLETED: "mission:completed",
  MISSION_FAILED: "mission:failed",
  MISSION_PROGRESS: "mission:progress",

  // Task Events
  TASK_CREATED: "task:created",
  TASK_STARTED: "task:started",
  TASK_COMPLETED: "task:completed",
  TASK_FAILED: "task:failed",
  TASK_RETRYING: "task:retrying",

  // Topic Events
  TOPIC_CREATED: "topic:created",
  TOPIC_UPDATED: "topic:updated",
  TOPIC_DELETED: "topic:deleted",

  // Agent Events
  AGENT_STARTED: "agent:started",
  AGENT_COMPLETED: "agent:completed",
  AGENT_SWITCHED: "agent:switched",

  // Research Events
  RESEARCH_STARTED: "research:started",
  RESEARCH_DIMENSION_COMPLETED: "research:dimension:completed",
  RESEARCH_COMPLETED: "research:completed",

  // Todo Events
  TODO_CREATED: "todo:created",
  TODO_UPDATED: "todo:updated",
  TODO_COMPLETED: "todo:completed",

  // WebSocket Broadcast Events
  WS_BROADCAST: "ws:broadcast",
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];

// ==================== Event Payloads ====================

/**
 * Mission Events
 */
export interface MissionCreatedEvent extends EventPayload {
  missionId: string;
  topicId: string;
  title: string;
  userId: string;
}

export interface MissionStartedEvent extends EventPayload {
  missionId: string;
  topicId: string;
}

export interface MissionCompletedEvent extends EventPayload {
  missionId: string;
  topicId: string;
  result?: unknown;
}

export interface MissionFailedEvent extends EventPayload {
  missionId: string;
  topicId: string;
  error: string;
}

export interface MissionProgressEvent extends EventPayload {
  missionId: string;
  topicId: string;
  progress: number;
  phase?: string;
  message?: string;
}

/**
 * Task Events
 */
export interface TaskCreatedEvent extends EventPayload {
  taskId: string;
  missionId: string;
  topicId: string;
  title: string;
  assigneeId?: string;
}

export interface TaskStartedEvent extends EventPayload {
  taskId: string;
  missionId: string;
  topicId: string;
  agentId?: string;
}

export interface TaskCompletedEvent extends EventPayload {
  taskId: string;
  missionId: string;
  topicId: string;
  result?: unknown;
}

export interface TaskFailedEvent extends EventPayload {
  taskId: string;
  missionId: string;
  topicId: string;
  error: string;
  retryCount?: number;
}

/**
 * Todo Events
 */
export interface TodoCreatedEvent extends EventPayload {
  todoId: string;
  topicId: string;
  title: string;
  type: string;
}

export interface TodoUpdatedEvent extends EventPayload {
  todoId: string;
  topicId: string;
  status?: string;
  progress?: number;
}

export interface TodoCompletedEvent extends EventPayload {
  todoId: string;
  topicId: string;
  result?: unknown;
}

/**
 * WebSocket Broadcast Event
 */
export interface WsBroadcastEvent extends EventPayload {
  topicId: string;
  event: string;
  data: unknown;
}

// ==================== Event Type Map ====================

/**
 * Maps event names to their payload types
 * Used for type-safe event publishing and subscribing
 */
export interface EventTypeMap {
  [EventNames.MISSION_CREATED]: MissionCreatedEvent;
  [EventNames.MISSION_STARTED]: MissionStartedEvent;
  [EventNames.MISSION_COMPLETED]: MissionCompletedEvent;
  [EventNames.MISSION_FAILED]: MissionFailedEvent;
  [EventNames.MISSION_PROGRESS]: MissionProgressEvent;
  [EventNames.TASK_CREATED]: TaskCreatedEvent;
  [EventNames.TASK_STARTED]: TaskStartedEvent;
  [EventNames.TASK_COMPLETED]: TaskCompletedEvent;
  [EventNames.TASK_FAILED]: TaskFailedEvent;
  [EventNames.TODO_CREATED]: TodoCreatedEvent;
  [EventNames.TODO_UPDATED]: TodoUpdatedEvent;
  [EventNames.TODO_COMPLETED]: TodoCompletedEvent;
  [EventNames.WS_BROADCAST]: WsBroadcastEvent;
}
