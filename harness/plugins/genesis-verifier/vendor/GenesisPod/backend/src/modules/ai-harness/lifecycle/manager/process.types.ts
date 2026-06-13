import { ProcessState, MemoryLayer } from "@prisma/client";

// ─── Core Types ───

export type ProcessId = string;

export interface SpawnOptions {
  userId: string;
  agentId: string;
  parentId?: string;
  teamSessionId?: string;
  priority?: number;
  tokenBudget?: number;
  costBudget?: number;
  input?: Record<string, unknown>;
  grantedTools?: string[];
  grantedSkills?: string[];
  dataScope?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProcessSnapshot {
  id: ProcessId;
  userId: string;
  parentId: string | null;
  agentId: string;
  teamSessionId: string | null;
  state: ProcessState;
  priority: number;
  tokenBudget: number;
  tokensUsed: number;
  costBudget: number;
  costUsed: number;
  checkpoint: Record<string, unknown> | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  grantedTools: string[];
  grantedSkills: string[];
  dataScope: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  version: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessTree {
  process: ProcessSnapshot;
  children: ProcessTree[];
}

export interface ResourceConsumption {
  tokensUsed?: number;
  costUsed?: number;
}

// ─── State Machine ───

/**
 * Valid process state transitions.
 * Based on the OS process lifecycle model.
 */
export const VALID_TRANSITIONS: Record<ProcessState, ProcessState[]> = {
  CREATED: ["READY", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "WAITING", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["READY", "CANCELLED"],
  WAITING: ["READY", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["READY"], // allow retry
  CANCELLED: [],
  ZOMBIE: [],
};

export const TERMINAL_STATES: ProcessState[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "ZOMBIE",
];

// ─── Event Journal ───

export interface JournalEntry {
  id: string;
  processId: ProcessId;
  sequence: number;
  type: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
}

export interface StepResult<T = unknown> {
  type: string;
  payload: Record<string, unknown>;
  execute: () => Promise<T>;
}

// ─── Memory ───

export { MemoryLayer };

export interface MemoryEntry {
  processId: ProcessId;
  layer: MemoryLayer;
  key: string;
  value: unknown;
  expiresAt?: Date;
}

export interface MemoryQuery {
  processId: ProcessId;
  layer?: MemoryLayer;
  keyPattern?: string;
  limit?: number;
}

// ─── IPC ───

export interface ProcessMessagePayload {
  fromProcessId: ProcessId;
  toProcessId: ProcessId;
  channel: string;
  payload: Record<string, unknown>;
}

// ─── Capabilities ───

export interface ProcessCapabilities {
  grantedTools: string[];
  grantedSkills: string[];
  dataScope: Record<string, unknown> | null;
}

// Re-export ProcessState for convenience
export { ProcessState };
