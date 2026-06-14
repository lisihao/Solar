/**
 * Shared test helpers for SelfDrivenMissionRunner integration specs.
 *
 * Contains mock builder functions extracted from the integration spec to keep
 * individual spec files below the 2500-line god-class guard.
 *
 * This file must NOT contain any describe/it/test blocks.
 */

import { AIModelType } from "@prisma/client";

import {
  SelfDrivenHitlGateService,
  HitlGateOutcome,
} from "../self-driven-hitl-gate";
import { DynamicTeamBuilder } from "../../../dynamic-team/dynamic-team-builder";
import { AgentFactory } from "../../../../agents/core/agent-factory";

import type { SelfDrivenMissionEvent } from "../abstractions/self-driven-mission.types";
import type {
  IAgent,
  IAgentTask,
} from "../../../../agents/abstractions/agent.interface";
import type { IAgentEvent } from "../../../../agents/abstractions/agent-event.interface";
import type { ITeam, ITeamMember } from "../../../abstractions/team.interface";
import type { IRole } from "../../../abstractions/role.interface";
import type { IWorkflow } from "../../../abstractions/workflow.interface";

// ---------------------------------------------------------------------------
// Event collection helpers
// ---------------------------------------------------------------------------

/** Drain an async generator into an array of events. */
export async function collectEvents(
  gen: AsyncGenerator<SelfDrivenMissionEvent, void, unknown>,
): Promise<SelfDrivenMissionEvent[]> {
  const events: SelfDrivenMissionEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Return all events of a given type from the collected list. */
export function eventsOfType<T extends SelfDrivenMissionEvent["type"]>(
  events: SelfDrivenMissionEvent[],
  type: T,
): Extract<SelfDrivenMissionEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<SelfDrivenMissionEvent, { type: T }> => e.type === type,
  );
}

// ---------------------------------------------------------------------------
// Mock AgentFactory helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal IAgent stub whose execute() yields:
 *   action_executed (tool_call, one per toolId) → output → terminated
 *
 * This ordering satisfies the test assertions that tool_call events precede
 * chunk events (output is emitted as a chunk by the runner after the loop).
 */
export function buildMockAgent(toolIds: string[], outputText: string): IAgent {
  const agentId = "mock-agent-id";
  const now = Date.now();

  async function* executeGenerator(
    _task: IAgentTask,
  ): AsyncIterable<IAgentEvent> {
    // Emit action_executed (tool_call) events for each tool in coreTools.
    for (const toolId of toolIds) {
      yield {
        type: "action_executed",
        agentId,
        timestamp: now,
        payload: {
          action: { kind: "tool_call", toolId, input: {} },
          output: `result from ${toolId}`,
          latencyMs: 10,
        },
      } as IAgentEvent;
    }
    // Emit the final output.
    yield {
      type: "output",
      agentId,
      timestamp: now,
      payload: { output: outputText },
    } as IAgentEvent;
    // Emit terminated.
    yield {
      type: "terminated",
      agentId,
      timestamp: now,
      payload: { reason: "completed" },
    } as IAgentEvent;
  }

  return {
    id: agentId as unknown as import("../../../../agents/abstractions/agent.types").AgentId,
    identity:
      {} as import("../../../../agents/abstractions/identity.interface").IAgentIdentity,
    state: "idle" as const,
    execute: (task: IAgentTask) => executeGenerator(task),
    spawnSubagent: jest.fn(),
    getEnvelope: jest.fn(),
    cancel: jest.fn(),
  };
}

/**
 * Build an AgentFactory mock whose create() returns a mock agent that
 * yields tool-call events followed by an output event.
 * toolIds are derived from the spec's identity.tools list.
 */
export function buildAgentFactoryMock(): AgentFactory {
  return {
    create: jest.fn((spec) => {
      const tools = (spec.identity as { tools?: string[] }).tools ?? [];
      const taskGoal = "step output via ReActLoop";
      return buildMockAgent(tools, taskGoal);
    }),
  } as unknown as AgentFactory;
}

/**
 * Build an AgentFactory mock whose create() returns an agent that immediately throws.
 * Used to exercise the ReActLoop → chatStream fallback path.
 */
export function buildFailingAgentFactoryMock(): AgentFactory {
  return {
    create: jest.fn(() => {
      return {
        id: "mock-agent-fail",
        identity: {},
        state: "idle",
        execute: jest.fn(async function* () {
          throw new Error("Simulated ReActLoop failure (tool-capable step)");
        }),
        spawnSubagent: jest.fn(),
        getEnvelope: jest.fn(),
        cancel: jest.fn(),
      } as unknown as IAgent;
    }),
  } as unknown as AgentFactory;
}

// ---------------------------------------------------------------------------
// Minimal ITeam stub
// ---------------------------------------------------------------------------

export function buildMinimalTeamStub(): ITeam {
  const minimalRole: IRole = {
    id: "analyst",
    name: "Analyst",
    description: "Analyst role",
    type: "member",
    icon: "",
    responsibilities: [],
    coreSkills: [],
    coreTools: [],
    systemPromptTemplate: "",
    metadata: {},
  };

  const minimalMember: ITeamMember = {
    id: "member-1",
    name: "Analyst-1",
    role: minimalRole,
    model: "mock-model",
    skills: [],
    tools: [],
    persona: "",
    workStyle: {
      communicationStyle: "direct",
      decisionMaking: "analytical",
      outputFormat: "structured",
    },
    status: "idle",
    metadata: {},
    isLeader: () => false,
    hasSkill: () => false,
    hasTool: () => false,
    getSystemPrompt: () => "You are an analyst.",
  };

  const leaderRole: IRole = {
    id: "leader",
    name: "Leader",
    description: "Leader role",
    type: "leader",
    icon: "",
    responsibilities: [],
    coreSkills: [],
    coreTools: [],
    systemPromptTemplate: "",
    metadata: {},
  };

  const leaderMember: ITeamMember = {
    id: "leader-1",
    name: "Leader-1",
    role: leaderRole,
    model: "mock-model",
    skills: [],
    tools: [],
    persona: "",
    workStyle: {
      communicationStyle: "direct",
      decisionMaking: "analytical",
      outputFormat: "structured",
    },
    status: "idle",
    metadata: {},
    isLeader: () => true,
    hasSkill: () => false,
    hasTool: () => false,
    getSystemPrompt: () => "You are the team leader.",
  };

  const minimalWorkflow: IWorkflow = {
    id: "workflow-stub",
    name: "Stub workflow",
    type: "sequential",
    steps: [],
    getCurrentStep: () => undefined,
    getNextStep: () => undefined,
    isCompleted: () => false,
    start: jest.fn(),
    completeStep: jest.fn(),
    failStep: jest.fn(),
    reset: jest.fn(),
    getState: jest.fn(),
  };

  const config = {
    id: "team-stub",
    name: "Stub Team",
    description: "Stub",
    type: "custom" as const,
    leaderRoleId: "leader",
    memberRoles: [],
    workflow: {
      id: "workflow-stub",
      name: "Stub",
      type: "sequential" as const,
      steps: [],
      entryStepId: "step-1",
    },
    availableSkills: [],
    availableTools: [],
    constraintProfile: {
      maxWallTimeMs: 60_000,
      maxTokens: 10_000,
      maxCostUsd: 1,
      maxIterations: 5,
      maxParallelSteps: 1,
    },
    deliverableTypes: ["report"],
  };

  return {
    id: "team-stub",
    name: "Stub Team",
    description: "Stub",
    type: "custom",
    config,
    leader: leaderMember,
    members: [minimalMember],
    workflow: minimalWorkflow,
    constraintProfile: config.constraintProfile,
    getAllMembers: () => [leaderMember, minimalMember],
    getMembersByRole: () => [],
    getMemberById: () => undefined,
    hasRole: () => false,
    getAvailableSkills: () => [],
    getAvailableTools: () => [],
  };
}

// ---------------------------------------------------------------------------
// Fake AiChatService chat() implementation — context-discriminated responses
// ---------------------------------------------------------------------------

/**
 * Discriminate which LLM call context we are in by inspecting systemPrompt.
 * Returns appropriately-shaped fake JSON / text for each call site.
 * Used for: plan decomposition, rubric generation, and chatStream fallback path.
 */
export function buildChatMock() {
  return jest.fn(
    async (opts: {
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      responseFormat?: string;
      modelType?: AIModelType;
    }) => {
      const sys = opts.systemPrompt ?? "";
      const userContent = opts.messages?.[0]?.content ?? "";

      // StepDecompositionService: expects a JSON array of steps
      if (
        sys.includes("role-agnostic planning assistant") ||
        (userContent.includes("Goal:") && opts.responseFormat === "json")
      ) {
        const steps = [
          {
            name: "Research the topic",
            description: "Gather information about the topic.",
            type: "task",
            loopKind: "react",
            dependencyIndices: [],
            estimatedDurationMs: 60000,
          },
          {
            name: "Analyse findings",
            description: "Synthesise the gathered research.",
            type: "task",
            loopKind: "plan-act",
            dependencyIndices: [0],
            estimatedDurationMs: 45000,
          },
          {
            name: "Write report",
            description: "Produce the final written deliverable.",
            type: "delivery",
            loopKind: "plan-act",
            dependencyIndices: [1],
            estimatedDurationMs: 30000,
          },
        ];
        return { content: JSON.stringify(steps), isError: false };
      }

      // RubricGeneratorService: expects a JSON array of rubric dimensions
      if (
        sys.includes("expert evaluator") ||
        userContent.includes("Objective:")
      ) {
        const rubric = [
          { dimension: "accuracy", weight: 0.35, passLine: 75 },
          { dimension: "completeness", weight: 0.3, passLine: 70 },
          { dimension: "clarity", weight: 0.2, passLine: 65 },
          { dimension: "actionability", weight: 0.15, passLine: 65 },
        ];
        return { content: JSON.stringify(rubric), isError: false };
      }

      // fallback chat() for executeStep (used only when chatStream fails)
      return {
        content: `Step output for: ${userContent.slice(0, 80)}`,
        isError: false,
      };
    },
  );
}

/**
 * Build a chatStream mock that streams the step output in two chunks.
 * The systemPrompt is checked to route plan/rubric calls — those still go
 * through chat(), so chatStream is only called for executeStep paths.
 */
export function buildChatStreamMock() {
  return jest.fn(async function* (opts: {
    systemPrompt?: string;
    messages?: Array<{ role: string; content: string }>;
    modelType?: AIModelType;
    operationName?: string;
  }) {
    const userContent = opts.messages?.[0]?.content ?? "";
    const text = `Step output for: ${userContent.slice(0, 80)}`;

    // Yield the content in two chunks to simulate real streaming
    const mid = Math.ceil(text.length / 2);
    yield { content: text.slice(0, mid), done: false };
    yield {
      content: text.slice(mid),
      done: true,
      usage: { promptTokens: 50, completionTokens: 80, totalTokens: 130 },
    };
  });
}

// ---------------------------------------------------------------------------
// Fake getAvailableModelsAsync
// ---------------------------------------------------------------------------

export function buildGetAvailableModelsMock() {
  return jest.fn().mockResolvedValue(["mock-model"]);
}

// ---------------------------------------------------------------------------
// Shared approved gate mock factory
// ---------------------------------------------------------------------------

// The gate is now split into prepareGate() (persist + return requestId) and
// awaitGate() (block for the outcome). These factories produce the awaitGate
// mock; gateMockFrom() wraps it with a prepareGate stub into a full gate double.
export function makeApprovedGate(opts?: {
  appendInstruction?: string;
}): jest.Mock<
  Promise<HitlGateOutcome>,
  Parameters<SelfDrivenHitlGateService["awaitGate"]>
> {
  return jest.fn().mockResolvedValue({
    approved: true,
    timedOut: false,
    appendInstruction: opts?.appendInstruction,
  });
}

export function makeRejectedGate(): jest.Mock<
  Promise<HitlGateOutcome>,
  Parameters<SelfDrivenHitlGateService["awaitGate"]>
> {
  return jest.fn().mockResolvedValue({
    approved: false,
    timedOut: false,
  });
}

/** Wrap an awaitGate mock into a full gate double with a prepareGate stub. */
export function gateMockFrom(
  awaitGate: jest.Mock<
    Promise<HitlGateOutcome>,
    Parameters<SelfDrivenHitlGateService["awaitGate"]>
  >,
): SelfDrivenHitlGateService {
  return {
    prepareGate: jest
      .fn()
      .mockResolvedValue({ requestId: "test-request-id", autoApproved: false }),
    awaitGate,
  } as unknown as SelfDrivenHitlGateService;
}

// Re-export DynamicTeamBuilder type so consumers don't need an extra import
export type { DynamicTeamBuilder };
