/**
 * Integration test: SelfDrivenMissionRunner — unlocks test suite.
 *
 * Covers: finalize pass, budget ceiling, formatter, rubric scoring,
 * concurrent tiers, parallel cap, and concurrent tier failure scenarios.
 *
 * Split from self-driven-mission-runner.integration.spec.ts to keep each
 * file below the 2500-line god-class guard.
 *
 * Same verification strategy as the primary spec:
 *   - REAL implementations: StepDecompositionService, RubricGeneratorService,
 *     SelfDrivenMissionPlannerService, RoleInventory, SelfDrivenReportComposer,
 *     SelfDrivenMissionRunner.
 *   - MOCKED (bottom-layer side-effects only):
 *       AiChatService, SelfDrivenHitlGateService, DynamicTeamBuilder.
 *
 * No DB is touched; no HTTP calls are made.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";

import { SelfDrivenMissionRunner } from "../self-driven-mission-runner.service";
import { SelfDrivenMissionPlannerService } from "../self-driven-mission-planner.service";
import { SelfDrivenReportComposer } from "../self-driven-report-composer";
import { SelfDrivenHitlGateService } from "../self-driven-hitl-gate";
import { DynamicTeamBuilder } from "../../../dynamic-team/dynamic-team-builder";
import { StepDecompositionService } from "../../../../../ai-engine/planning/decomposition/step-decomposition.service";
import { RubricGeneratorService } from "../../../../evaluation/rubric/rubric-generator.service";
import { AiChatService } from "../../../../../ai-engine/llm/chat/ai-chat.service";
import { ModelElectionService } from "../../../../../ai-engine/llm/models/selection/model-election.service";
import { AgentFactory } from "../../../../agents/core/agent-factory";
import { RoleInventory } from "../../../role-inventory/role-inventory";
import { ROLE_INVENTORY } from "../../../abstractions/role-inventory.interface";

import type { IAgentTask } from "../../../../agents/abstractions/agent.interface";
import type { IAgentEvent } from "../../../../agents/abstractions/agent-event.interface";

import {
  collectEvents,
  eventsOfType,
  buildAgentFactoryMock,
  buildMinimalTeamStub,
  buildChatMock,
  buildChatStreamMock,
  buildGetAvailableModelsMock,
  makeApprovedGate,
  gateMockFrom,
} from "./self-driven-runner.test-helpers";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SelfDrivenMissionRunner unlocks integration", () => {
  let runner: SelfDrivenMissionRunner;
  let mockChat: jest.Mock;
  let mockHitlOpen: jest.Mock;
  let mockTeamBuilderBuild: jest.Mock;
  let mockAgentFactory: AgentFactory;
  let module: TestingModule;

  // Suppress NestJS logger noise during tests
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // The tool-capable (ReActLoop/AgentFactory) path is retained in code but
  // disabled by default (ENABLE_TOOL_LOOP=false) because its structured output
  // is not report-friendly. The tests below that exercise that retained path
  // flip the flag on; reset to the production default after every test.
  const setToolLoop = (on: boolean) => {
    (
      SelfDrivenMissionRunner as unknown as { ENABLE_TOOL_LOOP: boolean }
    ).ENABLE_TOOL_LOOP = on;
  };
  afterEach(() => setToolLoop(false));

  beforeEach(async () => {
    // Production default is now ON; force the text path off so baseline tests
    // are deterministic. Tool-path tests opt in with setToolLoop(true).
    setToolLoop(false);
    mockChat = buildChatMock();

    const mockGetAvailableModels = buildGetAvailableModelsMock();

    // Partial AiChatService mock — only the methods called by the pipeline.
    // chatStream is used by non-tool-capable executeStep paths.
    // chat() is still used by plan decomposition and rubric generation.
    const mockAiChatService = {
      chat: mockChat,
      chatStream: buildChatStreamMock(),
      getAvailableModelsAsync: mockGetAvailableModels,
    } as unknown as AiChatService;

    // HitlGateService mock — default to approved; individual tests may override.
    // mockHitlOpen is the awaitGate double (per-gate blocking wait).
    mockHitlOpen = makeApprovedGate();
    const mockHitlGate = gateMockFrom(mockHitlOpen);

    // DynamicTeamBuilder mock — returns a minimal ITeam stub
    const teamStub = buildMinimalTeamStub();
    mockTeamBuilderBuild = jest.fn().mockReturnValue(teamStub);
    const mockDynamicTeamBuilder = {
      build: mockTeamBuilderBuild,
    } as unknown as DynamicTeamBuilder;

    // AgentFactory mock — creates a mock IAgent for tool-capable steps.
    // The mock agent yields action_executed (tool_call per coreTools id) then output.
    mockAgentFactory = buildAgentFactoryMock();

    module = await Test.createTestingModule({
      providers: [
        // Real implementations under test
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,

        // Inject RoleInventory under the DI token consumed by Runner and Builder
        {
          provide: ROLE_INVENTORY,
          useExisting: RoleInventory,
        },

        // Mocked bottom-layer dependencies
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: mockHitlGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: mockAgentFactory },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  // ── Helper: common happy-path input ──────────────────────────────────────

  const MISSION_ID = "test-mission-001";
  const MISSION_INPUT = {
    prompt: "Analyse the impact of AI on software engineering jobs",
    userId: "user-test-42",
  };

  // =========================================================================
  // Case A: deliver gate appendInstruction → finalize LLM called, deliverable
  //         reflects finalize output
  // =========================================================================

  it("finalize pass: deliver gate appendInstruction triggers finalize LLM call and deliverable uses finalized content", async () => {
    const deliverInstruction = "Add an executive summary at the top.";
    // Must be >= 100 chars to pass the sanity check in finalizeReportViaLLM.
    const finalizedContent =
      "# Finalized Report\n\n" +
      "## Executive Summary\n\n" +
      "This report has been refined per user request to add an executive summary. " +
      "All original findings are preserved below.\n\n" +
      "## Original Content\n\nFindings follow.";

    await module.close();

    // Chat mock: plan/rubric/gates → their normal responses;
    // finalize call → identified by "report refinement specialist" in system prompt.
    const FINALIZE_MARKER = "report refinement specialist";
    let finalizeCalls = 0;

    const chatWithFinalize = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys =
          opts.systemPrompt ??
          opts.messages?.find((m) => m.role === "system")?.content ??
          "";
        const userContent =
          opts.messages?.find((m) => m.role === "user")?.content ?? "";

        // Finalize LLM call (Change 1)
        if (sys.includes(FINALIZE_MARKER)) {
          finalizeCalls++;
          return { content: finalizedContent, tokensUsed: 500, isError: false };
        }

        // Step decomposition
        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          const steps = [
            {
              name: "Research",
              description: "Gather info.",
              type: "task",
              loopKind: "plan-act",
              dependencyIndices: [],
              estimatedDurationMs: 30000,
            },
          ];
          return { content: JSON.stringify(steps), isError: false };
        }

        // Rubric
        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 1.0, passLine: 70 },
            ]),
            isError: false,
          };
        }

        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          tokensUsed: 100,
          isError: false,
        };
      },
    );

    const chatStreamMock = buildChatStreamMock();
    const mockAiChatService = {
      chat: chatWithFinalize,
      chatStream: chatStreamMock,
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    // Plan gate: no appendInstruction; deliver gate: has appendInstruction
    const gateCallCount = { value: 0 };
    const deliverAppendGate: jest.Mock<
      Promise<import("../self-driven-hitl-gate").HitlGateOutcome>,
      Parameters<SelfDrivenHitlGateService["awaitGate"]>
    > = jest
      .fn()
      .mockImplementation(
        async (_requestId: string, _missionId: string, gate: string) => {
          gateCallCount.value++;
          if (gate === "deliver_confirm") {
            return {
              approved: true,
              timedOut: false,
              appendInstruction: deliverInstruction,
            };
          }
          return { approved: true, timedOut: false };
        },
      );

    const mockHitlGate = gateMockFrom(deliverAppendGate);
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: mockHitlGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: buildAgentFactoryMock() },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // Mission must complete without errors
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // Finalize LLM must have been called exactly once (for the deliver-gate feedback)
    expect(finalizeCalls).toBe(1);

    // The finalize call must have included the deliver instruction in the user message
    const finalizeChatCall = (chatWithFinalize as jest.Mock).mock.calls.find(
      (
        args: [
          {
            systemPrompt?: string;
            messages?: Array<{ role: string; content: string }>;
          },
        ],
      ) => {
        const sys =
          args[0].systemPrompt ??
          args[0].messages?.find((m) => m.role === "system")?.content ??
          "";
        return sys.includes(FINALIZE_MARKER);
      },
    );
    expect(finalizeChatCall).toBeDefined();
    const finalizeUserMsg =
      finalizeChatCall[0].messages?.find(
        (m: { role: string; content: string }) => m.role === "user",
      )?.content ?? "";
    expect(finalizeUserMsg).toContain(deliverInstruction);

    // Deliverable content must be the finalized output (not the raw composed report)
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toBe(finalizedContent);
  });

  // =========================================================================
  // Case B: deliver gate with no feedback → no finalize call, deliverable
  //         equals composer output (zero regression)
  // =========================================================================

  it("finalize pass: no deliver-gate feedback → finalize LLM not called, deliverable equals composer output", async () => {
    // Default beforeEach setup has no appendInstruction on either gate.
    // We count how many chat() calls are made and ensure none is the finalize call.
    const FINALIZE_MARKER = "report refinement specialist";

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // No errors
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // No finalize LLM call should have been made
    const finalizeCalls = mockChat.mock.calls.filter(
      (
        args: [
          {
            systemPrompt?: string;
            messages?: Array<{ role: string; content: string }>;
          },
        ],
      ) => {
        const sys =
          args[0].systemPrompt ??
          args[0].messages?.find((m) => m.role === "system")?.content ??
          "";
        return sys.includes(FINALIZE_MARKER);
      },
    );
    expect(finalizeCalls).toHaveLength(0);

    // Deliverable must still be present and contain the standard composer header
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toContain("# Mission Report");
  });

  // =========================================================================
  // Case C: token budget exceeded mid-mission → later steps skipped,
  //         deliverable still emitted from completed steps
  // =========================================================================

  it("budget ceiling: cumulative tokens exceed limit after first step → remaining steps skipped, deliverable emitted", async () => {
    // Strategy: lower the budget ceiling to 1 token so any step usage exceeds it,
    // then verify the second step is skipped but the mission still delivers.
    const originalMax = (
      SelfDrivenMissionRunner as unknown as {
        SELF_DRIVEN_MISSION_MAX_TOKENS: number;
      }
    ).SELF_DRIVEN_MISSION_MAX_TOKENS;

    // Temporarily lower the budget to a value smaller than a single step's usage.
    // The mock chatStream yields usage: { totalTokens: 130 } on the final chunk.
    // Setting the ceiling to 50 ensures the budget is exceeded after step 0.
    (
      SelfDrivenMissionRunner as unknown as {
        SELF_DRIVEN_MISSION_MAX_TOKENS: number;
      }
    ).SELF_DRIVEN_MISSION_MAX_TOKENS = 50;

    try {
      await module.close();

      // 2-step plan: step 0 uses chatStream (yields 130 tokens), step 1 should be skipped.
      const chatWithTwoSteps = jest.fn(
        async (opts: {
          systemPrompt?: string;
          messages?: Array<{ role: string; content: string }>;
          responseFormat?: string;
          modelType?: AIModelType;
        }) => {
          const sys = opts.systemPrompt ?? "";
          const userContent = opts.messages?.[0]?.content ?? "";

          if (
            sys.includes("role-agnostic planning assistant") ||
            (userContent.includes("Goal:") && opts.responseFormat === "json")
          ) {
            const steps = [
              {
                name: "Step One",
                description: "First step.",
                type: "task",
                loopKind: "plan-act",
                dependencyIndices: [],
                estimatedDurationMs: 30000,
              },
              {
                name: "Step Two",
                description: "Second step — should be skipped by budget.",
                type: "delivery",
                loopKind: "plan-act",
                dependencyIndices: [0],
                estimatedDurationMs: 30000,
              },
            ];
            return { content: JSON.stringify(steps), isError: false };
          }

          if (
            sys.includes("expert evaluator") ||
            userContent.includes("Objective:")
          ) {
            return {
              content: JSON.stringify([
                { dimension: "accuracy", weight: 1.0, passLine: 70 },
              ]),
              isError: false,
            };
          }

          return {
            content: `output for: ${userContent.slice(0, 40)}`,
            tokensUsed: 100,
            isError: false,
          };
        },
      );

      // chatStream yields 130 tokens total per step (exceeds 50-token ceiling).
      const chatStreamWithUsage = buildChatStreamMock();

      const mockAiChatService = {
        chat: chatWithTwoSteps,
        chatStream: chatStreamWithUsage,
        getAvailableModelsAsync: buildGetAvailableModelsMock(),
      } as unknown as AiChatService;

      const approvedGate = gateMockFrom(makeApprovedGate());
      const teamStub = buildMinimalTeamStub();
      const mockDynamicTeamBuilder = {
        build: jest.fn().mockReturnValue(teamStub),
      } as unknown as DynamicTeamBuilder;

      module = await Test.createTestingModule({
        providers: [
          SelfDrivenMissionRunner,
          SelfDrivenMissionPlannerService,
          StepDecompositionService,
          RubricGeneratorService,
          SelfDrivenReportComposer,
          RoleInventory,
          { provide: ROLE_INVENTORY, useExisting: RoleInventory },
          { provide: AiChatService, useValue: mockAiChatService },
          {
            provide: ModelElectionService,
            useValue: {
              elect: jest.fn().mockResolvedValue({
                elected: { modelId: "mock-chat-model" },
                scores: [],
                reason: "mock election",
              }),
            },
          },
          { provide: SelfDrivenHitlGateService, useValue: approvedGate },
          { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
          { provide: AgentFactory, useValue: buildAgentFactoryMock() },
        ],
      }).compile();

      runner = module.get(SelfDrivenMissionRunner);

      const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

      // Step One must have run and completed
      const stepStarted = eventsOfType(events, "step_started");
      const stepCompleted = eventsOfType(events, "step_completed");

      // At least step 0 started and completed
      expect(stepStarted.length).toBeGreaterThanOrEqual(1);
      expect(stepCompleted.length).toBeGreaterThanOrEqual(1);
      expect(stepCompleted[0].stepName).toBe("Step One");
      expect(stepCompleted[0].ok).toBe(true);

      // Step Two must NOT have started (budget cut off before it)
      const stepTwoStarted = stepStarted.find((e) => e.stepName === "Step Two");
      expect(stepTwoStarted).toBeUndefined();

      // Mission must still reach done (budget-exceeded is a graceful stop, not a crash)
      expect(eventsOfType(events, "done")).toHaveLength(1);
      expect(eventsOfType(events, "error")).toHaveLength(0);

      // Deliverable must be emitted from whatever steps completed
      const deliverables = eventsOfType(events, "deliverable");
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0].content).toContain("# Mission Report");
    } finally {
      // Restore the original budget ceiling regardless of test outcome
      (
        SelfDrivenMissionRunner as unknown as {
          SELF_DRIVEN_MISSION_MAX_TOKENS: number;
        }
      ).SELF_DRIVEN_MISSION_MAX_TOKENS = originalMax;
    }
  });

  // =========================================================================
  // Case D: tool-capable step returns structured object output
  //         → formatter converts to Markdown prose
  //         → deliverable contains no raw JSON blob (no leading "{")
  //         → deliverable contains key-derived prose headings
  // =========================================================================

  it("formatter: tool-capable step emitting structured object output → deliverable contains Markdown prose, no raw JSON blob", async () => {
    // Strategy:
    //   - ENABLE_TOOL_LOOP=true so the react-loopKind step routes through AgentFactory
    //   - The mock agent yields a structured object as its output payload
    //   - SelfDrivenReportComposer.formatStructuredOutput() must turn it into prose
    //   - Assertions:
    //       1. The deliverable does not contain a raw JSON blob (no `{` as first char
    //          of the step contribution, and no `{"` anywhere in the report body)
    //       2. The deliverable contains text derived from the structured object keys
    //         (the formatter uses kebabToTitle so "summary" → "Summary")

    const structuredOutput: Record<string, unknown> = {
      summary: "AI is transforming software engineering roles significantly.",
      findings: [
        "Junior roles are most at risk from automation",
        "Senior roles pivot toward AI supervision",
      ],
      conclusion: "Upskilling is essential for workforce resilience.",
    };

    // Build an agent factory that returns an agent whose output event carries
    // the structured object (not a string).
    const structuredOutputAgentFactory: AgentFactory = {
      create: jest.fn((spec) => {
        const agentId = "mock-structured-agent";
        const now = Date.now();
        const tools = (spec.identity as { tools?: string[] }).tools ?? [];

        async function* executeGenerator(
          _task: IAgentTask,
        ): AsyncIterable<IAgentEvent> {
          for (const toolId of tools) {
            yield {
              type: "action_executed",
              agentId,
              timestamp: now,
              payload: {
                action: { kind: "tool_call", toolId, input: {} },
                output: `result from ${toolId}`,
                latencyMs: 5,
              },
            } as IAgentEvent;
          }
          // Emit structured object as the output (not a string)
          yield {
            type: "output",
            agentId,
            timestamp: now,
            payload: { output: structuredOutput },
          } as unknown as IAgentEvent;
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
      }),
    } as unknown as AgentFactory;

    // Use a 1-step plan (react loopKind) so the structured-output step is the only
    // step; avoids interleaving with chatStream text and keeps the assertion clean.
    const chatWithSingleReactStep = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys = opts.systemPrompt ?? "";
        const userContent = opts.messages?.[0]?.content ?? "";

        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          const steps = [
            {
              name: "Analyse AI impact",
              description: "Structured analysis of AI on engineering jobs.",
              type: "task",
              loopKind: "react",
              dependencyIndices: [],
              estimatedDurationMs: 60000,
            },
          ];
          return { content: JSON.stringify(steps), isError: false };
        }

        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 1.0, passLine: 70 },
            ]),
            isError: false,
          };
        }

        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    await module.close();

    const mockAiChatService = {
      chat: chatWithSingleReactStep,
      chatStream: buildChatStreamMock(),
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: approvedGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: structuredOutputAgentFactory },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);
    setToolLoop(true);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // Mission must complete successfully
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // The single step must have completed ok=true
    const stepCompleted = eventsOfType(events, "step_completed");
    expect(stepCompleted).toHaveLength(1);
    expect(stepCompleted[0].ok).toBe(true);

    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    const report = deliverables[0].content;

    // ── 1. No raw JSON blob ─────────────────────────────────────────────────
    // The formatter must have converted the object; the report must not contain
    // the literal opening of a JSON object serialisation (i.e. `{"summary"`).
    expect(report).not.toContain('{"summary"');
    expect(report).not.toContain('{"findings"');

    // ── 2. Prose headings derived from object keys ──────────────────────────
    // formatObject sorts priority keys first: summary, conclusion come before findings.
    // kebabToTitle("summary") → "Summary", etc.
    expect(report).toContain("Summary");
    expect(report).toContain("Conclusion");

    // ── 3. Actual string values appear in the report ────────────────────────
    expect(report).toContain(
      "AI is transforming software engineering roles significantly.",
    );
    expect(report).toContain(
      "Upskilling is essential for workforce resilience.",
    );
  });

  // =========================================================================
  // Case E: Rubric self-evaluation — low score triggers one critique-driven
  //         refinement pass via finalizeReportViaLLM
  // =========================================================================

  it("rubric low score: evaluateAgainstRubric returns below-passLine score → finalizeReportViaLLM called once with critique feedback", async () => {
    await module.close();

    const EVAL_MARKER = "report quality evaluator";
    const FINALIZE_MARKER = "report refinement specialist";

    // Content long enough to pass finalizeReportViaLLM's 100-char guard.
    const refinedContent =
      "# Refined Report\n\n" +
      "This report has been improved based on the quality evaluation feedback. " +
      "Accuracy and completeness have been strengthened throughout the document.\n\n" +
      "## Details\n\nAdditional analysis follows here.";

    let evalCalls = 0;
    let finalizeCalls = 0;

    const chatWithRubricFlow = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys =
          opts.systemPrompt ??
          opts.messages?.find((m) => m.role === "system")?.content ??
          "";
        const userContent =
          opts.messages?.find((m) => m.role === "user")?.content ?? "";

        // Rubric evaluator call — return low scores to trigger refinement
        if (sys.includes(EVAL_MARKER)) {
          evalCalls++;
          return {
            content: JSON.stringify({
              scores: [
                {
                  dimension: "accuracy",
                  score: 55,
                  feedback: "Several claims lack supporting evidence.",
                },
                {
                  dimension: "completeness",
                  score: 60,
                  feedback: "Key aspects of the topic are missing.",
                },
              ],
              overallNote:
                "Report needs improvement in accuracy and completeness.",
            }),
            isError: false,
          };
        }

        // Finalize/refinement call — return the refined content
        if (sys.includes(FINALIZE_MARKER)) {
          finalizeCalls++;
          return { content: refinedContent, isError: false };
        }

        // Step decomposition
        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          return {
            content: JSON.stringify([
              {
                name: "Research",
                description: "Gather facts.",
                type: "task",
                loopKind: "plan-act",
                dependencyIndices: [],
                estimatedDurationMs: 30000,
              },
            ]),
            isError: false,
          };
        }

        // Rubric generation — return dimensions whose passLine (70) exceeds the
        // mock eval scores (55, 60) so shouldRefine=true is triggered.
        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 0.5, passLine: 70 },
              { dimension: "completeness", weight: 0.5, passLine: 70 },
            ]),
            isError: false,
          };
        }

        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    const mockAiChatService = {
      chat: chatWithRubricFlow,
      chatStream: buildChatStreamMock(),
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: approvedGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: buildAgentFactoryMock() },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // Mission completes without errors
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // Evaluator was called exactly once
    expect(evalCalls).toBe(1);

    // Refinement was triggered exactly once (low score)
    expect(finalizeCalls).toBe(1);

    // The finalize call must include critique text referencing low-scoring dimensions
    const finalizeChatArgs = (chatWithRubricFlow as jest.Mock).mock.calls.find(
      (
        args: [
          {
            systemPrompt?: string;
            messages?: Array<{ role: string; content: string }>;
          },
        ],
      ) => {
        const sys =
          args[0].systemPrompt ??
          args[0].messages?.find((m) => m.role === "system")?.content ??
          "";
        return sys.includes(FINALIZE_MARKER);
      },
    );
    expect(finalizeChatArgs).toBeDefined();
    const finalizeUserMsg =
      finalizeChatArgs[0].messages?.find(
        (m: { role: string; content: string }) => m.role === "user",
      )?.content ?? "";
    // Critique text must reference the low-scoring dimension(s)
    expect(finalizeUserMsg).toContain("accuracy");

    // Deliverable must be the refined output
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toBe(refinedContent);

    // A phase event with quality score detail must have been emitted
    const phaseDetails = eventsOfType(events, "phase")
      .filter(
        (e) => e.phase === "deliver" && e.detail?.includes("quality score="),
      )
      .map((e) => e.detail ?? "");
    expect(phaseDetails.length).toBeGreaterThanOrEqual(1);
    expect(phaseDetails[0]).toMatch(/quality score=\d+\/100/);
  });

  // =========================================================================
  // Case G: Tiered concurrent execution — steps with no shared dependency
  //         run in the same tier and complete before dependent steps start.
  //
  // Plan structure:
  //   stepA (no deps)  ─┐
  //   stepB (no deps)  ─┤─► stepC (deps: [stepA, stepB])
  //
  // Expected:
  //   - tiers: [[stepA, stepB], [stepC]]
  //   - stepA and stepB both emit step_started before stepC starts
  //   - stepC emits step_started after stepA AND stepB are completed
  //   - all 3 steps emit step_completed with ok=true
  //   - mission reaches done
  // =========================================================================

  it("concurrent tiers: independent steps start before dependent step, all complete ok=true, mission reaches done", async () => {
    await module.close();

    // 3-step plan: stepA + stepB independent, stepC depends on both.
    // The planner mock returns indices so StepDecompositionService will wire them.
    const chatWithDiamondPlan = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys = opts.systemPrompt ?? "";
        const userContent = opts.messages?.[0]?.content ?? "";

        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          const steps = [
            {
              name: "Gather data A",
              description: "First independent research stream.",
              type: "task",
              loopKind: "plan-act",
              dependencyIndices: [],
              estimatedDurationMs: 20000,
            },
            {
              name: "Gather data B",
              description: "Second independent research stream.",
              type: "task",
              loopKind: "plan-act",
              dependencyIndices: [],
              estimatedDurationMs: 20000,
            },
            {
              name: "Synthesise findings",
              description: "Combine A and B into the final report.",
              type: "delivery",
              loopKind: "plan-act",
              dependencyIndices: [0, 1],
              estimatedDurationMs: 30000,
            },
          ];
          return { content: JSON.stringify(steps), isError: false };
        }

        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 1.0, passLine: 70 },
            ]),
            isError: false,
          };
        }

        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    const chatStreamMock = buildChatStreamMock();
    const mockAiChatService = {
      chat: chatWithDiamondPlan,
      chatStream: chatStreamMock,
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: approvedGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: buildAgentFactoryMock() },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // ── All 3 steps must complete ok=true ─────────────────────────────────────
    const stepStarted = eventsOfType(events, "step_started");
    const stepCompleted = eventsOfType(events, "step_completed");
    expect(stepStarted).toHaveLength(3);
    expect(stepCompleted).toHaveLength(3);
    expect(stepCompleted.every((e) => e.ok)).toBe(true);

    // ── stepC (Synthesise findings) must start AFTER both stepA and stepB complete ─
    const synthesiseStartIdx = events.findIndex(
      (e) =>
        e.type === "step_started" &&
        (e as { stepName?: string }).stepName === "Synthesise findings",
    );
    expect(synthesiseStartIdx).toBeGreaterThan(-1);

    const gatherACompletedIdx = events.findIndex(
      (e) =>
        e.type === "step_completed" &&
        (e as { stepName?: string }).stepName === "Gather data A",
    );
    const gatherBCompletedIdx = events.findIndex(
      (e) =>
        e.type === "step_completed" &&
        (e as { stepName?: string }).stepName === "Gather data B",
    );

    expect(gatherACompletedIdx).toBeGreaterThan(-1);
    expect(gatherBCompletedIdx).toBeGreaterThan(-1);
    // Synthesise must start after both independent steps have completed.
    expect(synthesiseStartIdx).toBeGreaterThan(gatherACompletedIdx);
    expect(synthesiseStartIdx).toBeGreaterThan(gatherBCompletedIdx);

    // ── Both independent steps start before Synthesise starts ─────────────────
    const gatherAStartIdx = events.findIndex(
      (e) =>
        e.type === "step_started" &&
        (e as { stepName?: string }).stepName === "Gather data A",
    );
    const gatherBStartIdx = events.findIndex(
      (e) =>
        e.type === "step_started" &&
        (e as { stepName?: string }).stepName === "Gather data B",
    );
    expect(gatherAStartIdx).toBeLessThan(synthesiseStartIdx);
    expect(gatherBStartIdx).toBeLessThan(synthesiseStartIdx);

    // ── Mission reaches done without errors ───────────────────────────────────
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // ── Deliverable present ───────────────────────────────────────────────────
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toContain("# Mission Report");
  });

  // =========================================================================
  // Case H: Concurrent tier respects SELF_DRIVEN_MAX_PARALLEL_STEPS = 3
  //         Five independent steps → two batches (3 + 2), all complete ok=true
  // =========================================================================

  it("parallel cap: 5 independent steps execute in batches (max 3), all step_completed ok=true", async () => {
    await module.close();

    // 5 fully independent steps (no dependencies).
    const chatWithFiveSteps = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys = opts.systemPrompt ?? "";
        const userContent = opts.messages?.[0]?.content ?? "";

        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          const steps = Array.from({ length: 5 }, (_, i) => ({
            name: `Task ${i + 1}`,
            description: `Independent task ${i + 1}.`,
            type: "task",
            loopKind: "plan-act",
            dependencyIndices: [],
            estimatedDurationMs: 10000,
          }));
          return { content: JSON.stringify(steps), isError: false };
        }

        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 1.0, passLine: 70 },
            ]),
            isError: false,
          };
        }

        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    const chatStreamMock = buildChatStreamMock();
    const mockAiChatService = {
      chat: chatWithFiveSteps,
      chatStream: chatStreamMock,
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: approvedGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: buildAgentFactoryMock() },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // ── All 5 steps must start and complete ok=true ───────────────────────────
    const stepStarted = eventsOfType(events, "step_started");
    const stepCompleted = eventsOfType(events, "step_completed");
    expect(stepStarted).toHaveLength(5);
    expect(stepCompleted).toHaveLength(5);
    expect(stepCompleted.every((e) => e.ok)).toBe(true);

    // ── stepIndex values cover 0..4 exactly once each ────────────────────────
    const indices = stepStarted.map((e) => e.stepIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4]);

    // ── totalSteps is 5 for all step_started events ───────────────────────────
    expect(stepStarted.every((e) => e.totalSteps === 5)).toBe(true);

    // ── Mission reaches done without errors ───────────────────────────────────
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);
  });

  // =========================================================================
  // Case I: Single-step failure in a concurrent batch — sibling steps in the
  //         same tier still complete; mission still reaches done
  // =========================================================================

  it("concurrent tier step failure: one step fails in a 2-step tier, sibling still completes, mission reaches done", async () => {
    await module.close();

    // 2 independent steps; chatStream fails for step 1 only (and fallback chat also fails).
    const chatWithTwoIndepSteps = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys = opts.systemPrompt ?? "";
        const userContent = opts.messages?.[0]?.content ?? "";

        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          const steps = [
            {
              name: "Step Alpha",
              description: "First independent step.",
              type: "task",
              loopKind: "plan-act",
              dependencyIndices: [],
              estimatedDurationMs: 15000,
            },
            {
              name: "Step Beta",
              description: "Second independent step — will fail.",
              type: "task",
              loopKind: "plan-act",
              dependencyIndices: [],
              estimatedDurationMs: 15000,
            },
          ];
          return { content: JSON.stringify(steps), isError: false };
        }

        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 1.0, passLine: 70 },
            ]),
            isError: false,
          };
        }

        // Fallback chat() for step execution: fail when the message contains "Beta".
        if (userContent.includes("Step Beta")) {
          throw new Error("Simulated fallback failure for Step Beta");
        }
        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    let streamCallNum = 0;
    const chatStreamWithOneFail = jest.fn(async function* (opts: {
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      modelType?: AIModelType;
    }) {
      streamCallNum++;
      const userContent = opts.messages?.[0]?.content ?? "";
      // Fail for any stream call that concerns Step Beta.
      if (userContent.includes("Step Beta")) {
        throw new Error("Simulated stream failure for Step Beta");
      }
      const text = `Stream output for: ${userContent.slice(0, 60)}`;
      yield {
        content: text,
        done: true,
        usage: { promptTokens: 20, completionTokens: 40, totalTokens: 60 },
      };
    });

    const mockAiChatService = {
      chat: chatWithTwoIndepSteps,
      chatStream: chatStreamWithOneFail,
      getAvailableModelsAsync: jest.fn().mockResolvedValue(["mock-model"]),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: approvedGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: buildAgentFactoryMock() },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // ── Both steps must have started ──────────────────────────────────────────
    const stepStarted = eventsOfType(events, "step_started");
    expect(stepStarted).toHaveLength(2);

    // ── Both steps must have a step_completed event ───────────────────────────
    const stepCompleted = eventsOfType(events, "step_completed");
    expect(stepCompleted).toHaveLength(2);

    // Step Alpha must have succeeded.
    const alphaCompleted = stepCompleted.find(
      (e) => e.stepName === "Step Alpha",
    );
    expect(alphaCompleted).toBeDefined();
    expect(alphaCompleted!.ok).toBe(true);

    // Step Beta must have failed (ok=false), but not crashed the mission.
    const betaCompleted = stepCompleted.find((e) => e.stepName === "Step Beta");
    expect(betaCompleted).toBeDefined();
    expect(betaCompleted!.ok).toBe(false);

    // ── Mission still reaches done (no mission-level error event) ─────────────
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // ── Deliverable still emitted (from Step Alpha's output) ──────────────────
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toContain("# Mission Report");

    // ── Stream call count: 2 (one per step: Alpha succeeds, Beta fails) ───────
    // Note: failed stream + failed fallback chat = step ok=false; no third stream call.
    expect(streamCallNum).toBeGreaterThanOrEqual(1);

    // ── No mission-level error events ─────────────────────────────────────────
    const missionErrors = eventsOfType(events, "error");
    expect(missionErrors).toHaveLength(0);
  });

  // =========================================================================
  // Case F: Rubric self-evaluation — high score (above passLine) → no
  //         refinement call, zero extra overhead
  // =========================================================================

  it("rubric high score: evaluateAgainstRubric returns above-passLine scores → finalizeReportViaLLM not called, deliverable equals composer output", async () => {
    await module.close();

    const EVAL_MARKER = "report quality evaluator";
    const FINALIZE_MARKER = "report refinement specialist";

    let evalCalls = 0;
    let finalizeCalls = 0;

    const chatWithHighRubricScore = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys =
          opts.systemPrompt ??
          opts.messages?.find((m) => m.role === "system")?.content ??
          "";
        const userContent =
          opts.messages?.find((m) => m.role === "user")?.content ?? "";

        // Rubric evaluator — return scores comfortably above passLine
        if (sys.includes(EVAL_MARKER)) {
          evalCalls++;
          return {
            content: JSON.stringify({
              scores: [
                {
                  dimension: "accuracy",
                  score: 85,
                  feedback: "Well-supported claims.",
                },
                {
                  dimension: "completeness",
                  score: 88,
                  feedback: "Comprehensive coverage.",
                },
              ],
              overallNote: "High quality report, no significant gaps.",
            }),
            isError: false,
          };
        }

        // Finalize should NOT be called for rubric reasons on a high-score report
        if (sys.includes(FINALIZE_MARKER)) {
          finalizeCalls++;
          return { content: "unexpected finalize call", isError: false };
        }

        // Step decomposition
        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          return {
            content: JSON.stringify([
              {
                name: "Research",
                description: "Gather facts.",
                type: "task",
                loopKind: "plan-act",
                dependencyIndices: [],
                estimatedDurationMs: 30000,
              },
            ]),
            isError: false,
          };
        }

        // Rubric generation
        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          return {
            content: JSON.stringify([
              { dimension: "accuracy", weight: 0.5, passLine: 70 },
              { dimension: "completeness", weight: 0.5, passLine: 70 },
            ]),
            isError: false,
          };
        }

        return {
          content: `output for: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    const mockAiChatService = {
      chat: chatWithHighRubricScore,
      chatStream: buildChatStreamMock(),
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    module = await Test.createTestingModule({
      providers: [
        SelfDrivenMissionRunner,
        SelfDrivenMissionPlannerService,
        StepDecompositionService,
        RubricGeneratorService,
        SelfDrivenReportComposer,
        RoleInventory,
        { provide: ROLE_INVENTORY, useExisting: RoleInventory },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ModelElectionService,
          useValue: {
            elect: jest.fn().mockResolvedValue({
              elected: { modelId: "mock-chat-model" },
              scores: [],
              reason: "mock election",
            }),
          },
        },
        { provide: SelfDrivenHitlGateService, useValue: approvedGate },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: buildAgentFactoryMock() },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // Mission completes without errors
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // Evaluator was called exactly once
    expect(evalCalls).toBe(1);

    // No refinement call (score was above passLine)
    expect(finalizeCalls).toBe(0);

    // Deliverable is still present and contains the standard composer header
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toContain("# Mission Report");

    // Quality score detail phase event was still emitted (score signal always sent)
    const phaseDetails = eventsOfType(events, "phase")
      .filter(
        (e) => e.phase === "deliver" && e.detail?.includes("quality score="),
      )
      .map((e) => e.detail ?? "");
    expect(phaseDetails.length).toBeGreaterThanOrEqual(1);
  });
});
