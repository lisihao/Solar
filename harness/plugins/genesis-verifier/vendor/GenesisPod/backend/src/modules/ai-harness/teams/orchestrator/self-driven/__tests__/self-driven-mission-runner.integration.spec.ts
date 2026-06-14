/**
 * Integration test: SelfDrivenMissionRunner.run() full event pipeline.
 *
 * Verification strategy:
 *   - REAL implementations: StepDecompositionService, RubricGeneratorService,
 *     SelfDrivenMissionPlannerService, RoleInventory, SelfDrivenReportComposer,
 *     SelfDrivenMissionRunner.
 *   - MOCKED (bottom-layer side-effects only):
 *       1. AiChatService – single external LLM boundary; chat() returns
 *          context-appropriate fake data identified by systemPrompt content.
 *       2. SelfDrivenHitlGateService – DB-poll gate; mocked to return
 *          immediately so tests do not block.
 *       3. DynamicTeamBuilder – mocked to return a minimal ITeam stub
 *          (TeamFactory pulls in RoleRegistry + LLMFactory which have
 *          their own heavy DI graphs; the runner only needs the stub to
 *          call getAllMembers() and access leader/members properties).
 *
 * No DB is touched; no HTTP calls are made.
 *
 * Cases A–I (finalize, budget, formatter, rubric, concurrent, parallel,
 * tier failure) have been moved to:
 *   self-driven-mission-runner.unlocks.integration.spec.ts
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";

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

import {
  collectEvents,
  eventsOfType,
  buildAgentFactoryMock,
  buildFailingAgentFactoryMock,
  buildMockAgent,
  buildMinimalTeamStub,
  buildChatMock,
  buildChatStreamMock,
  buildGetAvailableModelsMock,
  makeApprovedGate,
  makeRejectedGate,
  gateMockFrom,
} from "./self-driven-runner.test-helpers";

import type { AIModelType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SelfDrivenMissionRunner integration", () => {
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
    // Production default is now ON; force the text path off so these baseline
    // tests are deterministic. Tool-path tests opt in with setToolLoop(true).
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
  // Case 1: Happy path — full event sequence
  // =========================================================================

  it("happy path: emits full ordered event sequence with real plan, rubric, and composed report", async () => {
    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    const types = events.map((e) => e.type);

    // ── 1. Mission started ────────────────────────────────────────────────
    expect(types[0]).toBe("mission_started");

    // ── 2. No clarify phase is emitted (P2+ feature; no-op today) ─────────
    const clarifyPhases = eventsOfType(events, "phase").filter(
      (e) => e.phase === "clarify",
    );
    expect(clarifyPhases).toHaveLength(0);

    // ── 3. Plan phase ─────────────────────────────────────────────────────
    const planPhases = eventsOfType(events, "phase").filter(
      (e) => e.phase === "plan",
    );
    expect(planPhases[0].status).toBe("started");
    expect(planPhases[1].status).toBe("completed");

    // ── 4. Plan event — real planner output ───────────────────────────────
    const planEvents = eventsOfType(events, "plan");
    expect(planEvents).toHaveLength(1);

    const plan = planEvents[0].plan;

    // Steps produced by real StepDecompositionService parsing our mock JSON
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);

    // Rubric produced by real RubricGeneratorService parsing our mock JSON
    expect(plan.rubric).toBeDefined();
    expect(plan.rubric!.length).toBeGreaterThanOrEqual(1);

    for (const dim of plan.rubric!) {
      expect(dim.passLine).toBeGreaterThanOrEqual(60);
      expect(dim.passLine).toBeLessThanOrEqual(90);
    }

    // Role assignments produced by real planner (uses real AiChatService mock)
    expect(plan.roleAssignments).toBeDefined();
    expect(plan.roleAssignments!.length).toBeGreaterThanOrEqual(1);

    // ── 5. HITL gate: plan_confirm ────────────────────────────────────────
    const awaitingPlanApproval = eventsOfType(events, "awaiting_approval").find(
      (e) => e.gate === "plan_confirm",
    );
    expect(awaitingPlanApproval).toBeDefined();

    const planApprovalResolved = eventsOfType(events, "approval_resolved").find(
      (e) => e.gate === "plan_confirm",
    );
    expect(planApprovalResolved).toBeDefined();
    expect(planApprovalResolved!.approved).toBe(true);

    // ── 6. Execute phase ──────────────────────────────────────────────────
    const executePhases = eventsOfType(events, "phase").filter(
      (e) => e.phase === "execute",
    );
    expect(executePhases.length).toBeGreaterThanOrEqual(1);

    // ── 7. Team built ─────────────────────────────────────────────────────
    const teamBuiltEvents = eventsOfType(events, "team_built");
    expect(teamBuiltEvents).toHaveLength(1);
    expect(teamBuiltEvents[0].roles.length).toBeGreaterThanOrEqual(1);
    // Every role in the team_built event must have a roleId string
    for (const r of teamBuiltEvents[0].roles) {
      expect(typeof r.roleId).toBe("string");
    }

    // ── 8. Per-step events ────────────────────────────────────────────────
    const stepStarted = eventsOfType(events, "step_started");
    const stepCompleted = eventsOfType(events, "step_completed");
    const chunks = eventsOfType(events, "chunk");

    expect(stepStarted.length).toBe(plan.steps.length);
    expect(stepCompleted.length).toBe(plan.steps.length);
    // Each successful step emits at least one chunk (chatStream yields per-token).
    // Our mock yields 2 chunks per step, so total >= okSteps.length.
    const okSteps = stepCompleted.filter((e) => e.ok);
    expect(chunks.length).toBeGreaterThanOrEqual(okSteps.length);

    // step_started indices are sequential
    stepStarted.forEach((ev, idx) => {
      expect(ev.stepIndex).toBe(idx);
      expect(ev.totalSteps).toBe(plan.steps.length);
    });

    // ── 9. HITL gate: deliver_confirm ─────────────────────────────────────
    const awaitingDeliver = eventsOfType(events, "awaiting_approval").find(
      (e) => e.gate === "deliver_confirm",
    );
    expect(awaitingDeliver).toBeDefined();

    const deliverResolved = eventsOfType(events, "approval_resolved").find(
      (e) => e.gate === "deliver_confirm",
    );
    expect(deliverResolved).toBeDefined();
    expect(deliverResolved!.approved).toBe(true);

    // ── 10. Deliver phase ─────────────────────────────────────────────────
    const deliverPhases = eventsOfType(events, "phase").filter(
      (e) => e.phase === "deliver",
    );
    expect(deliverPhases.length).toBeGreaterThanOrEqual(1);

    // ── 11. Deliverable — composer output ─────────────────────────────────
    const deliverableEvents = eventsOfType(events, "deliverable");
    expect(deliverableEvents).toHaveLength(1);
    expect(deliverableEvents[0].deliverableType).toBe("report");

    const reportContent = deliverableEvents[0].content;
    expect(reportContent).toContain("# Mission Report");
    expect(reportContent).toContain(MISSION_INPUT.prompt);

    // Report should contain content from at least one step
    const hasStepContent = okSteps.some((step) =>
      reportContent.includes(step.stepName),
    );
    expect(hasStepContent).toBe(true);

    // ── 12. Done ──────────────────────────────────────────────────────────
    const doneEvents = eventsOfType(events, "done");
    expect(doneEvents).toHaveLength(1);
    expect(types.at(-1)).toBe("done");

    // No error events on happy path
    const errorEvents = eventsOfType(events, "error");
    expect(errorEvents).toHaveLength(0);

    // Gate was awaited twice: once for plan_confirm, once for deliver_confirm.
    // awaitGate signature is (requestId, missionId, gate, signal) → gate is [2].
    expect(mockHitlOpen).toHaveBeenCalledTimes(2);
    expect(mockHitlOpen.mock.calls[0][2]).toBe("plan_confirm");
    expect(mockHitlOpen.mock.calls[1][2]).toBe("deliver_confirm");
  });

  // =========================================================================
  // Case 2: Plan gate rejected — mission terminates without entering execute
  // =========================================================================

  it("reject: plan gate rejected → emits error event, generator terminates before execute", async () => {
    // Plan gate returns approved=false; deliver gate should never be called
    mockHitlOpen = makeRejectedGate();

    // Rebuild module with the new mock
    await module.close();
    const mockAiChatService = {
      chat: mockChat,
      chatStream: buildChatStreamMock(),
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;
    const mockHitlGate = gateMockFrom(mockHitlOpen);
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

    const types = events.map((e) => e.type);

    // Must have an error event
    const errorEvents = eventsOfType(events, "error");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].message).toContain("plan rejected by human");

    // Must NOT have entered execute phase
    const executePhases = eventsOfType(events, "phase").filter(
      (e) => e.phase === "execute",
    );
    expect(executePhases).toHaveLength(0);

    // Must NOT have built the team
    expect(eventsOfType(events, "team_built")).toHaveLength(0);

    // Must NOT have reached deliverable
    expect(eventsOfType(events, "deliverable")).toHaveLength(0);

    // Must NOT have reached done
    expect(eventsOfType(events, "done")).toHaveLength(0);

    // Last event should be error (generator returns after first rejection)
    expect(types.at(-1)).toBe("error");

    // Gate was awaited exactly once (only plan_confirm); deliver never reached.
    expect(mockHitlOpen).toHaveBeenCalledTimes(1);
    expect(mockHitlOpen.mock.calls[0][2]).toBe("plan_confirm");
  });

  // =========================================================================
  // Case 3: Append instruction injected into execute step prompts
  // =========================================================================

  it("append injection: plan gate appendInstruction appears in subsequent executeStep chatStream calls", async () => {
    const appendInstruction = "Focus specifically on junior developer roles.";

    // Rebuild with appendInstruction in plan gate
    await module.close();

    const chatSpy = buildChatMock();
    const chatStreamSpy = buildChatStreamMock();

    const mockAiChatService = {
      chat: chatSpy,
      chatStream: chatStreamSpy,
      getAvailableModelsAsync: buildGetAvailableModelsMock(),
    } as unknown as AiChatService;

    const appendGateOpen: jest.Mock<
      Promise<import("../self-driven-hitl-gate").HitlGateOutcome>,
      Parameters<SelfDrivenHitlGateService["awaitGate"]>
    > = jest.fn().mockResolvedValue({
      approved: true,
      timedOut: false,
      appendInstruction,
    });

    const mockHitlGate = gateMockFrom(appendGateOpen);
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    // AgentFactory mock: capture the spec so we can verify systemPrompt injection
    const capturedSpecs: Array<{ systemPrompt?: string }> = [];
    const appendAgentFactory = {
      create: jest.fn((spec: { systemPrompt?: string; identity: unknown }) => {
        capturedSpecs.push(spec);
        const tools = (spec.identity as { tools?: string[] }).tools ?? [];
        return buildMockAgent(tools, "ReActLoop output with append");
      }),
    } as unknown as AgentFactory;

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
        { provide: AgentFactory, useValue: appendAgentFactory },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);
    setToolLoop(true);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // Confirm mission completed successfully (done event present, no errors)
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // Tool-capable steps (react loopKind) use AgentFactory; the append instruction
    // is injected into the systemPrompt passed to AgentFactory.create().
    // Non-tool-capable steps (plan-act) still use chatStream.
    // Verify all chatStream calls (non-tool-capable steps) contain the append instruction.
    const streamCalls = chatStreamSpy.mock.calls as Array<
      [{ systemPrompt?: string }]
    >;
    // At least the non-tool-capable steps (plan-act) go through chatStream
    expect(streamCalls.length).toBeGreaterThanOrEqual(1);

    for (const args of streamCalls) {
      const opts = args[0];
      const sys = opts.systemPrompt ?? "";
      expect(sys).toContain("[User refinement]: " + appendInstruction);
    }

    // Also verify that AgentFactory was called with systemPrompt containing the append instruction
    // (tool-capable steps route through AgentFactory.create with the merged systemPrompt)
    expect(capturedSpecs.length).toBeGreaterThanOrEqual(1);
    for (const spec of capturedSpecs) {
      expect(spec.systemPrompt ?? "").toContain(
        "[User refinement]: " + appendInstruction,
      );
    }
  });

  // =========================================================================
  // Case 5: Tool-capable step drives real ReActLoop via AgentFactory
  //   → tool_call events emitted per actual action_executed from IAgentEvent stream
  //   → chunk events present (output event translated to chunk)
  //   → step_completed.ok=true (final output captured)
  // =========================================================================

  it("tool-capable step: emits tool_call events per coreTools entry via AgentFactory.execute(), then chunk event from output, step completes ok=true", async () => {
    // The default happy-path setup (from beforeEach) has the standard 3-step plan:
    //   step 0: type=task, loopKind=react, executor=analyst (coreTools: [web-search, data-analysis])
    //           → tool-capable: uses AgentFactory.create().execute()
    //   step 1: type=task, loopKind=plan-act, executor=researcher → not tool-capable (chatStream)
    //   step 2: type=delivery, loopKind=plan-act, executor=writer → not tool-capable (chatStream)
    // The mock agent yields action_executed (tool_call per coreTools id) then output.
    setToolLoop(true);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // ── tool_call events ─────────────────────────────────────────────────────
    const toolCallEvents = eventsOfType(events, "tool_call");
    // analyst has coreTools: [calculator, web_search] → expect 2 tool_call events
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

    // Every tool_call must carry a non-empty missionId, stepId, and toolId.
    // NOTE: tool_call events use plan.missionId (the planner's UUID), not the
    // runner's input missionId, so we only assert it is a non-empty string.
    for (const tc of toolCallEvents) {
      expect(typeof tc.missionId).toBe("string");
      expect(tc.missionId.length).toBeGreaterThan(0);
      expect(typeof tc.stepId).toBe("string");
      expect(tc.stepId.length).toBeGreaterThan(0);
      expect(typeof tc.toolId).toBe("string");
      expect(tc.toolId.length).toBeGreaterThan(0);
    }

    // All tool_call events must reference the SAME stepId (they all belong to step 0)
    const toolCallStepIds = new Set(toolCallEvents.map((tc) => tc.stepId));
    expect(toolCallStepIds.size).toBe(1);

    // ── chunk events ─────────────────────────────────────────────────────────
    const chunkEvents = eventsOfType(events, "chunk");
    // Step 0 (tool-capable): mock agent yields 1 output chunk via AgentFactory.
    // Steps 1+2 (not tool-capable): chatStream yields 2 chunks each.
    // Total: at least 3 chunks.
    expect(chunkEvents.length).toBeGreaterThanOrEqual(3);

    // ── step_completed ok=true for the tool-capable step ────────────────────
    const stepCompleted = eventsOfType(events, "step_completed");
    // Find the step_completed event for the tool-capable step (same stepId as tool_call)
    const toolStepId = [...toolCallStepIds][0];
    const toolStepCompleted = stepCompleted.find(
      (e) => e.stepId === toolStepId,
    );
    expect(toolStepCompleted).toBeDefined();
    expect(toolStepCompleted!.ok).toBe(true);

    // ── tool_call events precede the step's chunk events in stream order ──────
    // The mock agent yields action_executed (→ tool_call) before output (→ chunk).
    // This mirrors real ReActLoop ordering: tool invocations happen before final output.
    const toolCallIdx = events.findIndex(
      (e) =>
        e.type === "tool_call" &&
        (e as { stepId: string }).stepId === toolStepId,
    );
    const firstChunkIdx = events.findIndex((e) => e.type === "chunk");
    // tool_call events from the tool-capable step must appear before ANY chunk event
    expect(toolCallIdx).toBeLessThan(firstChunkIdx);

    // ── mission reaches done (no crash) ─────────────────────────────────────
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);
  });

  // =========================================================================
  // Case 6: Delivery step streams multiple chunk events via chatStream
  //   → mock yields N chunks per step
  //   → self-driven chunk events arrive token-by-token (count > 1 per step)
  //   → concatenation of all chunks for a step equals the full step text
  // =========================================================================

  it("delivery step chatStream: yields multiple chunk events; concatenated content equals full step text", async () => {
    // Rebuild with a chatStream that yields 3 chunks per step (not 2), so we can
    // unambiguously verify that multiple events arrive per step.
    await module.close();

    const CHUNK_COUNT = 3;
    const threeChunkStreamMock = jest.fn(async function* (opts: {
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      modelType?: AIModelType;
      operationName?: string;
    }) {
      const userContent = opts.messages?.[0]?.content ?? "";
      const fullText = `Streamed output for: ${userContent.slice(0, 60)}`;
      // Split into CHUNK_COUNT equal pieces
      const chunkSize = Math.ceil(fullText.length / CHUNK_COUNT);
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const content = fullText.slice(i * chunkSize, (i + 1) * chunkSize);
        if (content.length > 0) {
          const isLast = i === CHUNK_COUNT - 1;
          yield {
            content,
            done: isLast,
            ...(isLast
              ? {
                  usage: {
                    promptTokens: 30,
                    completionTokens: 60,
                    totalTokens: 90,
                  },
                }
              : {}),
          };
        }
      }
    });

    const chatSpy = buildChatMock();
    const mockAiChatService = {
      chat: chatSpy,
      chatStream: threeChunkStreamMock,
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

    // ── multiple chunk events total ──────────────────────────────────────────
    const chunkEvents = eventsOfType(events, "chunk");
    // Step 0 (tool-capable, AgentFactory): 1 output chunk.
    // Steps 1+2 (not tool-capable, chatStream): CHUNK_COUNT chunks each.
    // Total: at least CHUNK_COUNT chunks overall.
    expect(chunkEvents.length).toBeGreaterThanOrEqual(CHUNK_COUNT);

    // ── per-step chunk count > 1 ─────────────────────────────────────────────
    // Verify at least one step produced multiple chunk events.
    // We interleave chunk events with step_started/step_completed, so group them
    // by which step_started preceded each chunk.
    const stepStartedEvents = eventsOfType(events, "step_started");
    const stepCompletedEvents = eventsOfType(events, "step_completed");
    expect(stepStartedEvents.length).toBeGreaterThanOrEqual(1);

    // For each step, count chunks between step_started and step_completed
    let foundMultiChunkStep = false;
    for (const started of stepStartedEvents) {
      const startIdx = events.findIndex(
        (e) =>
          e.type === "step_started" &&
          (e as typeof started).stepId === started.stepId,
      );
      const endIdx = events.findIndex(
        (e) =>
          e.type === "step_completed" &&
          (e as (typeof stepCompletedEvents)[0]).stepId === started.stepId,
      );
      if (startIdx === -1 || endIdx === -1) continue;
      const stepChunks = events
        .slice(startIdx, endIdx + 1)
        .filter((e) => e.type === "chunk");
      if (stepChunks.length > 1) {
        foundMultiChunkStep = true;

        // ── concatenation equals full text ────────────────────────────────────
        const concatenated = stepChunks
          .map(
            (e) =>
              (e as { type: "chunk"; missionId: string; content: string })
                .content,
          )
          .join("");
        // The step userMessage contains "Task: <step.name>\n\n<step.description>"
        // so fullText starts with "Streamed output for: Task: "
        expect(concatenated).toMatch(/^Streamed output for:/);
        expect(concatenated.length).toBeGreaterThan(0);
      }
    }
    expect(foundMultiChunkStep).toBe(true);

    // ── mission done, no errors ───────────────────────────────────────────────
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);
  });

  // =========================================================================
  // Case 7: ReActLoop path (tool-capable step) AgentFactory.execute() throws
  //         → degraded gracefully: falls back to chatStream
  //         → chatStream succeeds → step ok=true
  //         → mission continues to done
  // =========================================================================

  it("ReActLoop path degradation: tool-capable step AgentFactory.execute() throws → fallback chatStream produces output → step ok=true, mission reaches done", async () => {
    // Strategy:
    //   - AgentFactory.create() returns a mock agent whose execute() throws (step 0)
    //   - Fallback chatStream succeeds for step 0 (and all non-tool-capable steps)
    //   - Expected: step 0 ends ok=true (chatStream fallback rescued it), steps 1+2 ok=true,
    //               mission reaches done, no mission-level error event.

    await module.close();

    const chatStreamSucceeds = jest.fn(async function* (opts: {
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      modelType?: AIModelType;
      operationName?: string;
    }) {
      const userContent = opts.messages?.[0]?.content ?? "";
      const text = `Fallback chatStream output for: ${userContent.slice(0, 60)}`;
      yield {
        content: text,
        done: true,
        usage: { promptTokens: 20, completionTokens: 40, totalTokens: 60 },
      };
    });

    const chatWithPlanSteps = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys = opts.systemPrompt ?? "";
        const userContent = opts.messages?.[0]?.content ?? "";

        // Plan decomposition: 2-step plan (step 0 react = tool-capable)
        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          const steps = [
            {
              name: "Research phase",
              description: "Gather key information on the topic.",
              type: "task",
              loopKind: "react",
              dependencyIndices: [],
              estimatedDurationMs: 60000,
            },
            {
              name: "Write summary",
              description: "Produce the written deliverable.",
              type: "delivery",
              loopKind: "plan-act",
              dependencyIndices: [0],
              estimatedDurationMs: 30000,
            },
          ];
          return { content: JSON.stringify(steps), isError: false };
        }

        // Rubric generation
        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          const rubric = [
            { dimension: "accuracy", weight: 0.5, passLine: 70 },
            { dimension: "clarity", weight: 0.5, passLine: 65 },
          ];
          return { content: JSON.stringify(rubric), isError: false };
        }

        return {
          content: `chat fallback: ${userContent.slice(0, 60)}`,
          isError: false,
        };
      },
    );

    const mockAiChatService = {
      chat: chatWithPlanSteps,
      chatStream: chatStreamSucceeds,
      getAvailableModelsAsync: jest.fn().mockResolvedValue(["mock-model"]),
    } as unknown as AiChatService;

    const approvedGate = gateMockFrom(makeApprovedGate());
    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    // AgentFactory whose agent throws — triggers chatStream fallback in executeStep
    const failingFactory = buildFailingAgentFactoryMock();

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
        { provide: AgentFactory, useValue: failingFactory },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);
    setToolLoop(true);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    // ── step 0 completed ok=true (chatStream fallback rescued it) ─────────────
    const stepCompleted = eventsOfType(events, "step_completed");
    // With 2 steps in the plan, expect exactly 2 step_completed events
    expect(stepCompleted.length).toBe(2);
    // The first step (tool-capable, AgentFactory failed → chatStream fallback succeeded) must be ok=true
    expect(stepCompleted[0].ok).toBe(true);
    // The second step (not tool-capable, chatStream succeeded) must also be ok=true
    expect(stepCompleted[1].ok).toBe(true);

    // ── AgentFactory.create() was called once (for the tool-capable step only) ─
    expect((failingFactory.create as jest.Mock).mock.calls.length).toBe(1);

    // ── chatStream was called for the fallback (step 0) and for step 1 ────────
    // (step 0 fallback from AgentFactory failure + step 1 normal path)
    expect((chatStreamSucceeds as jest.Mock).mock.calls.length).toBe(2);

    // ── mission reaches done, no mission-level error event ────────────────────
    expect(eventsOfType(events, "done")).toHaveLength(1);
    expect(eventsOfType(events, "error")).toHaveLength(0);

    // ── deliverable is present ────────────────────────────────────────────────
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toContain("# Mission Report");
  });

  // =========================================================================
  // Case 4: Single step failure — degraded gracefully, mission reaches done
  // =========================================================================

  it("step failure: one step chatStream throws (and fallback chat also fails) → step_completed.ok=false, mission continues to done", async () => {
    let stepCallCount = 0;

    // chat() handles plan decomposition and rubric; also serves as fallback for
    // chatStream failures. Make fallback chat() also fail for the first step so
    // the step actually ends up as ok=false (otherwise fallback would succeed).
    const chatWithFallbackFailure = jest.fn(
      async (opts: {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        responseFormat?: string;
        modelType?: AIModelType;
      }) => {
        const sys = opts.systemPrompt ?? "";
        const userContent = opts.messages?.[0]?.content ?? "";

        // Decomposition response
        if (
          sys.includes("role-agnostic planning assistant") ||
          (userContent.includes("Goal:") && opts.responseFormat === "json")
        ) {
          // Return two steps so one can fail and another succeeds
          const steps = [
            {
              name: "Research the topic",
              description: "Gather information.",
              type: "task",
              loopKind: "react",
              dependencyIndices: [],
              estimatedDurationMs: 60000,
            },
            {
              name: "Write report",
              description: "Write the final report.",
              type: "delivery",
              loopKind: "plan-act",
              dependencyIndices: [0],
              estimatedDurationMs: 30000,
            },
          ];
          return { content: JSON.stringify(steps), isError: false };
        }

        // Rubric response
        if (
          sys.includes("expert evaluator") ||
          userContent.includes("Objective:")
        ) {
          const rubric = [
            { dimension: "accuracy", weight: 0.5, passLine: 70 },
            { dimension: "clarity", weight: 0.5, passLine: 65 },
          ];
          return { content: JSON.stringify(rubric), isError: false };
        }

        // Dynamic gate choices generation (added with dynamic HITL choices feature).
        // The runner sends choices prompts as a messages array (no systemPrompt field),
        // so `sys` is empty; discriminate via the first-message user content instead.
        // Return empty array so choices generation gracefully returns [].
        if (
          userContent.includes("mission planning assistant") ||
          userContent.includes("mission delivery assistant")
        ) {
          return { content: "[]", isError: false };
        }

        // Fallback chat() for step execution (called when chatStream fails):
        // fail the FIRST step fallback call, succeed on subsequent ones.
        stepCallCount++;
        if (stepCallCount === 1) {
          throw new Error("Simulated fallback LLM failure for step 1");
        }

        return {
          content: `Step ${stepCallCount} output content for task.`,
          isError: false,
        };
      },
    );

    let streamCallCount = 0;
    // chatStream: fail the first call (triggers fallback to chat()), succeed on rest
    const chatStreamWithOneFailure = jest.fn(async function* (opts: {
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      modelType?: AIModelType;
    }) {
      streamCallCount++;
      if (streamCallCount === 1) {
        throw new Error("Simulated chatStream failure for step 1");
      }
      const userContent = opts.messages?.[0]?.content ?? "";
      const text = `Step stream output for: ${userContent.slice(0, 60)}`;
      yield {
        content: text,
        done: true,
        usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 },
      };
    });

    await module.close();

    const mockAiChatService = {
      chat: chatWithFallbackFailure,
      chatStream: chatStreamWithOneFailure,
      getAvailableModelsAsync: jest.fn().mockResolvedValue(["mock-model"]),
    } as unknown as AiChatService;

    const approvedHitl = gateMockFrom(makeApprovedGate());

    const teamStub = buildMinimalTeamStub();
    const mockDynamicTeamBuilder = {
      build: jest.fn().mockReturnValue(teamStub),
    } as unknown as DynamicTeamBuilder;

    // Step 0 (react, tool-capable) uses AgentFactory — succeeds normally.
    // Step 1 (delivery, plan-act) uses chatStream — which fails on its first call,
    // then fallback chat() also fails → step 1 ends ok=false.
    const successfulAgentFactory = buildAgentFactoryMock();

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
        { provide: SelfDrivenHitlGateService, useValue: approvedHitl },
        { provide: DynamicTeamBuilder, useValue: mockDynamicTeamBuilder },
        { provide: AgentFactory, useValue: successfulAgentFactory },
      ],
    }).compile();

    runner = module.get(SelfDrivenMissionRunner);

    const events = await collectEvents(runner.run(MISSION_ID, MISSION_INPUT));

    const stepCompleted = eventsOfType(events, "step_completed");

    // At least one step must have failed
    const failedSteps = stepCompleted.filter((e) => !e.ok);
    expect(failedSteps.length).toBeGreaterThanOrEqual(1);

    // Mission must NOT have crashed — done event must be present
    expect(eventsOfType(events, "done")).toHaveLength(1);

    // No mission-level error event (single-step failure is degraded, not fatal)
    const missionErrors = eventsOfType(events, "error");
    expect(missionErrors).toHaveLength(0);

    // Deliverable must still be emitted (possibly with skipped-step note)
    const deliverables = eventsOfType(events, "deliverable");
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].content).toContain("# Mission Report");
  });
});
