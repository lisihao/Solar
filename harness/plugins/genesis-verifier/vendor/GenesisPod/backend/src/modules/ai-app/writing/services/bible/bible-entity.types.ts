import { Prisma } from "@prisma/client";

// ─── WorldSetting DTOs ────────────────────────────────────────────────────────

export interface CreateWorldSettingData {
  category: string;
  name: string;
  description: string;
  rules?: string[];
  references?: Prisma.InputJsonValue;
}

export type UpdateWorldSettingData = Prisma.WorldSettingUpdateInput;

// ─── TimelineEvent DTOs ───────────────────────────────────────────────────────

export interface CreateTimelineEventData {
  eventName: string;
  description: string;
  storyTime: string;
  importance?: number;
  involvedCharacterIds?: string[];
  relatedChapterId?: string;
}

export type UpdateTimelineEventData = Prisma.TimelineEventUpdateInput;

// ─── Terminology DTOs ─────────────────────────────────────────────────────────

export interface CreateTerminologyData {
  term: string;
  definition: string;
  category: string;
  variants?: string[];
  usage?: string;
}

export type UpdateTerminologyData = Prisma.TerminologyUpdateInput;

// ─── StoryBible DTOs ──────────────────────────────────────────────────────────

export interface UpdateStoryBibleDto {
  premise?: string;
  theme?: string;
  tone?: string;
  worldType?: string;
}

// ─── BibleSnapshot type (for pre-write injection) ─────────────────────────────

export interface BibleSnapshotCharacter {
  id: string;
  name: string;
  aliases: string[];
  [key: string]: unknown;
}

export interface BibleSnapshotWorldSetting {
  id: string;
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface BibleSnapshot {
  characters: BibleSnapshotCharacter[];
  worldSettings: BibleSnapshotWorldSetting[];
  terminologies: unknown[];
  timelineEvents: unknown[];
  [key: string]: unknown;
}
