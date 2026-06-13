/**
 * Unit tests for ConsistencyCheckerAgent
 *
 * Covers:
 * - Agent metadata (id, name, capabilities, supportedModes)
 * - doExecute (via execute): happy path with no issues, with issues
 * - checkSemanticConsistency: semantic conflicts mapped to ConsistencyIssue
 * - checkTerminologyConsistency (local, no LLM): multiple variants, variant-only
 * - checkCharacterConsistency: delegates to LLM callLLM
 * - checkTimelineConsistency: skips when no facts/timeline events
 * - checkWorldConsistency: skips when no world settings
 * - checkPlotConsistency: skips when no established facts
 * - extractFacts: calls LLM and returns parsed facts
 * - buildSummary: byType/bySeverity totals
 * - mapFactCategory / mapSemanticConflictType / mapSemanticSeverity
 * - semantic consistency failure does not block other checks
 * - all checkTypes filter properly
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConsistencyCheckerAgent } from "../consistency-checker.agent";
import { SemanticConsistencyService } from "../../services/quality/semantic-consistency.service";
import type { AgentContext } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";
import type { ConsistencyCheckerInput } from "../consistency-checker.agent";

// ==================== Helpers ====================

function makeAgentContext(): AgentContext {
  return {
    agentId: "consistency-checker",
    executionId: "exec-1",
    mode: "reactive",
    metadata: {},
  } as AgentContext;
}

function makeContextPackage(
  overrides: Partial<{
    characters: unknown[];
    terminologies: unknown[];
    worldSettings: unknown[];
    timelineEvents: unknown[];
    establishedFacts: unknown[];
  }> = {},
): WritingContextPackage {
  return {
    projectId: "project-1",
    hardConstraints: [],
    glossary: {},
    establishedFacts: overrides.establishedFacts || [],
    extensions: {
      storyBible: {
        projectId: "project-1",
        worldType: "Fantasy",
        stylePresetId: undefined,
        writingStyle: {
          pov: "third-person",
          tense: "past",
          vocabulary: "intermediate",
          dialogueStyle: "natural",
          descriptionStyle: "vivid",
        },
        characters:
          (overrides.characters as WritingContextPackage["extensions"]["storyBible"]["characters"]) ||
          [],
        terminologies:
          (overrides.terminologies as WritingContextPackage["extensions"]["storyBible"]["terminologies"]) ||
          [],
        worldSettings:
          (overrides.worldSettings as WritingContextPackage["extensions"]["storyBible"]["worldSettings"]) ||
          [],
        timelineEvents:
          (overrides.timelineEvents as WritingContextPackage["extensions"]["storyBible"]["timelineEvents"]) ||
          [],
        factions: [],
        plotPoints: [],
      },
    },
  } as unknown as WritingContextPackage;
}

// ==================== Mock factories ====================

function buildMockSemanticConsistency() {
  return {
    checkSemanticConsistency: jest.fn().mockResolvedValue({
      passed: true,
      conflicts: [],
      extractedFacts: [],
    }),
  };
}

// ==================== Tests ====================

describe("ConsistencyCheckerAgent", () => {
  let agent: ConsistencyCheckerAgent;
  let mockSemanticConsistency: ReturnType<typeof buildMockSemanticConsistency>;

  beforeEach(async () => {
    mockSemanticConsistency = buildMockSemanticConsistency();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsistencyCheckerAgent,
        {
          provide: SemanticConsistencyService,
          useValue: mockSemanticConsistency,
        },
      ],
    }).compile();

    agent = module.get<ConsistencyCheckerAgent>(ConsistencyCheckerAgent);

    // Mock the inherited callLLM method from BaseAgent
    jest
      .spyOn(
        agent as unknown as {
          callLLM: (...args: unknown[]) => Promise<{ content: string }>;
        },
        "callLLM",
      )
      .mockResolvedValue({ content: "[]" });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Metadata ====================

  describe("agent metadata", () => {
    it("should have correct id", () => {
      expect(agent.id).toBe("consistency-checker");
    });

    it("should have correct name", () => {
      expect(agent.name).toBe("Consistency Checker");
    });

    it("should have description", () => {
      expect(agent.description).toBeDefined();
      expect(agent.description.length).toBeGreaterThan(0);
    });

    it("should support reactive and hybrid modes", () => {
      expect(agent.supportedModes).toContain("reactive");
      expect(agent.supportedModes).toContain("hybrid");
    });

    it("should have 4 capabilities", () => {
      expect(agent.capabilities).toHaveLength(4);
    });

    it("should include character-consistency capability", () => {
      const capIds = agent.capabilities.map((c) => c.id);
      expect(capIds).toContain("character-consistency");
    });

    it("should include timeline-consistency capability", () => {
      const capIds = agent.capabilities.map((c) => c.id);
      expect(capIds).toContain("timeline-consistency");
    });

    it("should include world-consistency capability", () => {
      const capIds = agent.capabilities.map((c) => c.id);
      expect(capIds).toContain("world-consistency");
    });

    it("should include fact-extraction capability", () => {
      const capIds = agent.capabilities.map((c) => c.id);
      expect(capIds).toContain("fact-extraction");
    });

    it("should have required tools", () => {
      expect(agent.requiredTools).toBeDefined();
      expect((agent.requiredTools ?? []).length).toBeGreaterThan(0);
    });
  });

  // ==================== execute (happy path) ====================

  describe("execute - happy path", () => {
    it("should return PASSED status when no issues found", async () => {
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "The hero walked into the forest.",
        contextPackage: makeContextPackage(),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data.chapterId).toBe("ch-1");
      expect(result.data.status).toBe("PASSED");
      expect(result.data.issues).toHaveLength(0);
    });

    it("should return ISSUES_FOUND when LLM returns issues", async () => {
      const mockIssues = [
        {
          type: "CHARACTER",
          severity: "WARNING",
          location: "paragraph 2",
          description: "Character hair color mismatch",
          expected: "black",
          found: "blonde",
          suggestion: "Change to black",
          relatedEntities: ["Alice"],
        },
      ];

      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: JSON.stringify(mockIssues) });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Alice's blonde hair shimmered in the sunlight.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "char-1",
              name: "Alice",
              role: "protagonist",
              definition: "Main character",
              appearance: { hair: "black", eyes: "blue" },
              personality: { traits: [], speechPattern: "" },
              currentState: { state: {} },
              abilities: [],
              aliases: [],
            },
          ],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data.status).toBe("ISSUES_FOUND");
      expect(result.data.issues.length).toBeGreaterThan(0);
    });

    it("should include summary with byType and bySeverity", async () => {
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-2",
        content: "Some chapter content.",
        contextPackage: makeContextPackage(),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data.summary).toBeDefined();
      expect(result.data.summary.total).toBe(0);
      expect(result.data.summary.byType).toHaveProperty("CHARACTER");
      expect(result.data.summary.byType).toHaveProperty("TIMELINE");
      expect(result.data.summary.byType).toHaveProperty("WORLD");
      expect(result.data.summary.byType).toHaveProperty("TERMINOLOGY");
      expect(result.data.summary.byType).toHaveProperty("PLOT");
      expect(result.data.summary.bySeverity).toHaveProperty("CRITICAL");
      expect(result.data.summary.bySeverity).toHaveProperty("WARNING");
      expect(result.data.summary.bySeverity).toHaveProperty("INFO");
    });

    it("should include suggestions from issue suggestions", async () => {
      const mockIssues = [
        {
          type: "CHARACTER",
          severity: "INFO",
          location: "para 1",
          description: "Minor issue",
          suggestion: "Consider fixing this",
          relatedEntities: [],
        },
      ];

      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: JSON.stringify(mockIssues) });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Alice",
              role: "hero",
              definition: "",
              appearance: {},
              abilities: [],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data.suggestions).toContain("Consider fixing this");
    });

    it("should return extractedFacts from LLM", async () => {
      const mockFacts = [
        {
          statement: "Alice gained healing ability",
          category: "entity_state",
          relatedEntities: ["Alice"],
          importance: "high",
        },
      ];

      // First calls return [] for character/timeline/world/plot checks
      // Last callLLM call is for extractFacts
      const callLLM = jest.spyOn(
        agent as unknown as {
          callLLM: (...args: unknown[]) => Promise<{ content: string }>;
        },
        "callLLM",
      );
      callLLM
        .mockResolvedValueOnce({ content: "[]" }) // CHARACTER
        .mockResolvedValueOnce({ content: "[]" }) // TIMELINE
        .mockResolvedValueOnce({ content: "[]" }) // WORLD
        .mockResolvedValueOnce({ content: "[]" }) // PLOT
        .mockResolvedValueOnce({ content: JSON.stringify(mockFacts) }); // extractFacts

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Chapter content.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Alice",
              role: "hero",
              definition: "",
              appearance: {},
              abilities: [],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
          establishedFacts: [
            {
              statement: "Alice is human",
              category: "entity_state",
              importance: "high",
              relatedEntities: ["Alice"],
            },
          ],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data.extractedFacts).toBeDefined();
    });
  });

  // ==================== checkTypes filter ====================

  describe("execute with checkTypes filter", () => {
    it("should only run specified check types", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Some content.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Hero",
              role: "protagonist",
              definition: "",
              appearance: { hair: "black" },
              abilities: [],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
        }),
        checkTypes: ["CHARACTER"],
      };

      await agent.execute(input, makeAgentContext());

      // Only CHARACTER check + extractFacts = 2 LLM calls
      expect(callLLMSpy).toHaveBeenCalledTimes(2);
    });

    it("should check TERMINOLOGY without LLM when terminology data exists", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      // Use TWO variants but NOT the standard term to trigger WARNING (multiple variants used)
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "She visited the 御医室 and then the 太医署 on the same day.",
        contextPackage: makeContextPackage({
          terminologies: [
            {
              term: "太医院",
              definition: "Imperial medical office",
              variants: ["御医室", "太医署"],
            },
          ],
        }),
        checkTypes: ["TERMINOLOGY"],
      };

      const result = await agent.execute(input, makeAgentContext());

      // TERMINOLOGY is pure local check - no LLM needed for that check itself
      // but extractFacts still uses LLM once
      expect(callLLMSpy).toHaveBeenCalledTimes(1); // only extractFacts
      // Should detect multiple variants used (WARNING level)
      expect(result.data.issues.some((i) => i.type === "TERMINOLOGY")).toBe(
        true,
      );
    });
  });

  // ==================== checkTerminologyConsistency ====================

  describe("terminology consistency (local check)", () => {
    beforeEach(() => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });
    });

    it("should detect multiple variants being used", async () => {
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "He visited the 御医室 and the 太医署.",
        contextPackage: makeContextPackage({
          terminologies: [
            {
              term: "太医院",
              definition: "Imperial medical office",
              variants: ["御医室", "太医署"],
            },
          ],
        }),
        checkTypes: ["TERMINOLOGY"],
      };

      const result = await agent.execute(input, makeAgentContext());

      const termIssues = result.data.issues.filter(
        (i) => i.type === "TERMINOLOGY",
      );
      expect(termIssues.length).toBeGreaterThan(0);
      expect(termIssues[0].severity).toBe("WARNING");
    });

    it("should detect single variant used instead of standard term", async () => {
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "He visited the 御医室.",
        contextPackage: makeContextPackage({
          terminologies: [
            {
              term: "太医院",
              definition: "Imperial medical office",
              variants: ["御医室"],
            },
          ],
        }),
        checkTypes: ["TERMINOLOGY"],
      };

      const result = await agent.execute(input, makeAgentContext());

      const infoIssues = result.data.issues.filter(
        (i) => i.type === "TERMINOLOGY" && i.severity === "INFO",
      );
      expect(infoIssues.length).toBeGreaterThan(0);
    });

    it("should not report issues when standard term is used", async () => {
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "He visited the 太医院.",
        contextPackage: makeContextPackage({
          terminologies: [
            {
              term: "太医院",
              definition: "Imperial medical office",
              variants: ["御医室"],
            },
          ],
        }),
        checkTypes: ["TERMINOLOGY"],
      };

      const result = await agent.execute(input, makeAgentContext());

      const termIssues = result.data.issues.filter(
        (i) => i.type === "TERMINOLOGY",
      );
      expect(termIssues).toHaveLength(0);
    });

    it("should skip when terminology has no variants", async () => {
      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content without any terms.",
        contextPackage: makeContextPackage({
          terminologies: [
            {
              term: "太医院",
              definition: "Medical office",
              // no variants field
            },
          ],
        }),
        checkTypes: ["TERMINOLOGY"],
      };

      const result = await agent.execute(input, makeAgentContext());

      const termIssues = result.data.issues.filter(
        (i) => i.type === "TERMINOLOGY",
      );
      expect(termIssues).toHaveLength(0);
    });
  });

  // ==================== checkTimelineConsistency (skip branches) ====================

  describe("checkTimelineConsistency", () => {
    beforeEach(() => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });
    });

    it("should skip timeline check when no timeline events and no facts", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          timelineEvents: [],
          establishedFacts: [],
        }),
        checkTypes: ["TIMELINE"],
      };

      await agent.execute(input, makeAgentContext());

      // TIMELINE is skipped + extractFacts uses 1 call
      expect(callLLMSpy).toHaveBeenCalledTimes(1);
    });

    it("should run timeline check when timeline events exist", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          timelineEvents: [
            {
              storyTime: "Year 1",
              eventName: "First battle",
              description: "The hero fought for the first time",
              importance: 5,
            },
          ],
        }),
        checkTypes: ["TIMELINE"],
      };

      await agent.execute(input, makeAgentContext());

      // TIMELINE is run + extractFacts
      expect(callLLMSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== checkWorldConsistency (skip branches) ====================

  describe("checkWorldConsistency", () => {
    beforeEach(() => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });
    });

    it("should skip world check when no worldSettings", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({ worldSettings: [] }),
        checkTypes: ["WORLD"],
      };

      await agent.execute(input, makeAgentContext());

      // WORLD skipped, only extractFacts
      expect(callLLMSpy).toHaveBeenCalledTimes(1);
    });

    it("should run world check when worldSettings exist with rules", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Magic was used.",
        contextPackage: makeContextPackage({
          worldSettings: [
            {
              id: "ws-1",
              name: "Magic System",
              category: "system",
              description: "No magic allowed",
              rules: ["Magic is forbidden"],
            },
          ],
        }),
        checkTypes: ["WORLD"],
      };

      await agent.execute(input, makeAgentContext());

      // WORLD runs + extractFacts
      expect(callLLMSpy).toHaveBeenCalledTimes(2);
    });

    it("should skip world rules for settings without rules array", async () => {
      // worldSettings exist but none have rules - still calls LLM but content is empty
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          worldSettings: [
            {
              id: "ws-1",
              name: "Kingdom",
              category: "location",
              description: "A kingdom",
            },
          ],
        }),
        checkTypes: ["WORLD"],
      };

      const result = await agent.execute(input, makeAgentContext());
      expect(result.success).toBe(true);
    });
  });

  // ==================== checkPlotConsistency (skip branches) ====================

  describe("checkPlotConsistency", () => {
    it("should skip plot check when no established facts", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({ establishedFacts: [] }),
        checkTypes: ["PLOT"],
      };

      await agent.execute(input, makeAgentContext());

      // PLOT skipped, only extractFacts
      expect(callLLMSpy).toHaveBeenCalledTimes(1);
    });

    it("should run plot check when established facts exist", async () => {
      const callLLMSpy = jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          establishedFacts: [
            {
              statement: "Alice is alive",
              category: "entity_state",
              importance: "high",
              relatedEntities: ["Alice"],
            },
          ],
        }),
        checkTypes: ["PLOT"],
      };

      await agent.execute(input, makeAgentContext());

      // PLOT runs + extractFacts
      expect(callLLMSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== checkSemanticConsistency ====================

  describe("checkSemanticConsistency", () => {
    it("should map semantic conflicts to ConsistencyIssue format", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      mockSemanticConsistency.checkSemanticConsistency.mockResolvedValue({
        passed: false,
        conflicts: [
          {
            conflictType: "contradiction",
            severity: "critical",
            description: "Alice cannot be dead and alive simultaneously",
            conflictingFact: {
              statement: "Alice is alive",
              category: "character",
              relatedEntities: ["Alice"],
              importance: "high",
            },
            newStatement: "Alice is described as dead",
            suggestion: "Resolve the contradiction",
          },
        ],
        extractedFacts: [],
      });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Alice was found dead.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Alice",
              role: "protagonist",
              definition: "",
              appearance: { hair: "black" },
              abilities: [],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should include the semantic conflict issue
      const semanticIssues = result.data.issues.filter(
        (i) => i.location === "语义检测",
      );
      expect(semanticIssues).toHaveLength(1);
      expect(semanticIssues[0].type).toBe("CHARACTER"); // contradiction -> CHARACTER
      expect(semanticIssues[0].severity).toBe("CRITICAL");
    });

    it("should map inconsistency conflict type to PLOT", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      mockSemanticConsistency.checkSemanticConsistency.mockResolvedValue({
        passed: false,
        conflicts: [
          {
            conflictType: "inconsistency",
            severity: "warning",
            description: "Logic gap detected",
            conflictingFact: {
              statement: "Door was locked",
              category: "world",
              relatedEntities: [],
              importance: "medium",
            },
            newStatement: "Character walks through the door",
            suggestion: "Add door-opening action",
          },
        ],
        extractedFacts: [],
      });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Character walks through the locked door.",
        contextPackage: makeContextPackage(),
      };

      const result = await agent.execute(input, makeAgentContext());

      const plotIssues = result.data.issues.filter(
        (i) => i.type === "PLOT" && i.location === "语义检测",
      );
      expect(plotIssues).toHaveLength(1);
      expect(plotIssues[0].severity).toBe("WARNING");
    });

    it("should map timeline_violation conflict type to TIMELINE", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      mockSemanticConsistency.checkSemanticConsistency.mockResolvedValue({
        passed: false,
        conflicts: [
          {
            conflictType: "timeline_violation",
            severity: "info",
            description: "Event order mismatch",
            conflictingFact: {
              statement: "Battle happened in Year 2",
              category: "timeline",
              relatedEntities: [],
              importance: "medium",
            },
            newStatement: "Battle mentioned in Year 1",
            suggestion: "Check timeline order",
          },
        ],
        extractedFacts: [],
      });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "The battle of Year 1 was referenced.",
        contextPackage: makeContextPackage(),
      };

      const result = await agent.execute(input, makeAgentContext());

      const timelineIssues = result.data.issues.filter(
        (i) => i.type === "TIMELINE" && i.location === "语义检测",
      );
      expect(timelineIssues).toHaveLength(1);
      expect(timelineIssues[0].severity).toBe("INFO");
    });

    it("should not block other checks when semantic consistency throws", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      mockSemanticConsistency.checkSemanticConsistency.mockRejectedValue(
        new Error("Semantic service unavailable"),
      );

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage(),
      };

      // Should not throw, just skip semantic issues
      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // No semantic issues, but check still completes
      const semanticIssues = result.data.issues.filter(
        (i) => i.location === "语义检测",
      );
      expect(semanticIssues).toHaveLength(0);
    });

    it("should build character facts from appearance (hair and eyes)", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Alice",
              role: "protagonist",
              definition: "",
              appearance: { hair: "black", eyes: "blue" },
              abilities: ["swordsmanship", "healing"],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
        }),
      };

      await agent.execute(input, makeAgentContext());

      // SemanticConsistencyService should have been called with character facts
      expect(
        mockSemanticConsistency.checkSemanticConsistency,
      ).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.arrayContaining([
          expect.objectContaining({
            statement: expect.stringContaining("Alice"),
          }),
        ]),
      );
    });

    it("should handle characters without appearance gracefully", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Unknown",
              role: "minor",
              definition: "",
              appearance: undefined,
              abilities: [],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
        }),
      };

      // Should not throw
      const result = await agent.execute(input, makeAgentContext());
      expect(result.success).toBe(true);
    });
  });

  // ==================== buildSummary ====================

  describe("buildSummary (via execute)", () => {
    it("should correctly tally issues by type and severity", async () => {
      // Use only CHARACTER type issues so byType.CHARACTER == total
      const mockIssues = [
        {
          type: "CHARACTER",
          severity: "CRITICAL",
          location: "p1",
          description: "Critical char issue",
          relatedEntities: [],
        },
        {
          type: "CHARACTER",
          severity: "WARNING",
          location: "p2",
          description: "Warning char issue",
          relatedEntities: [],
        },
        {
          type: "CHARACTER",
          severity: "INFO",
          location: "p3",
          description: "Info char issue",
          relatedEntities: [],
        },
      ];

      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValueOnce({ content: JSON.stringify(mockIssues) }) // CHARACTER
        .mockResolvedValue({ content: "[]" }); // extractFacts

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          characters: [
            {
              id: "c1",
              name: "Alice",
              role: "hero",
              definition: "",
              appearance: {},
              abilities: [],
              aliases: [],
              personality: {},
              currentState: { state: {} },
            },
          ],
        }),
        checkTypes: ["CHARACTER"],
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data.summary.byType.CHARACTER).toBe(3);
      expect(result.data.summary.bySeverity.CRITICAL).toBe(1);
      expect(result.data.summary.bySeverity.WARNING).toBe(1);
      expect(result.data.summary.bySeverity.INFO).toBe(1);
      expect(result.data.summary.total).toBe(3);
    });
  });

  // ==================== mapFactCategory ====================

  describe("mapFactCategory (private, tested via semantic consistency)", () => {
    it("should use established facts with correct category mapping", async () => {
      jest
        .spyOn(
          agent as unknown as {
            callLLM: (...args: unknown[]) => Promise<{ content: string }>;
          },
          "callLLM",
        )
        .mockResolvedValue({ content: "[]" });

      const input: ConsistencyCheckerInput = {
        chapterId: "ch-1",
        content: "Content.",
        contextPackage: makeContextPackage({
          establishedFacts: [
            {
              statement: "Fact about character",
              category: "entity_state",
              importance: "high",
              relatedEntities: [],
            },
            {
              statement: "Sequence event",
              category: "sequence_point",
              importance: "medium",
              relatedEntities: [],
            },
            {
              statement: "A decision made",
              category: "decision",
              importance: "low",
              relatedEntities: [],
            },
            {
              statement: "A relationship",
              category: "relationship",
              importance: "high",
              relatedEntities: [],
            },
            {
              statement: "World fact",
              category: "unknown_type",
              importance: "medium",
              relatedEntities: [],
            },
          ],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should pass with semantic consistency mocked to pass
      expect(result.success).toBe(true);
      expect(
        mockSemanticConsistency.checkSemanticConsistency,
      ).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ category: "character" }), // entity_state -> character
          expect.objectContaining({ category: "timeline" }), // sequence_point -> timeline
          expect.objectContaining({ category: "relationship" }), // relationship -> relationship
          expect.objectContaining({ category: "world" }), // unknown_type -> world (default)
        ]),
        expect.any(Array),
      );
    });
  });
});
