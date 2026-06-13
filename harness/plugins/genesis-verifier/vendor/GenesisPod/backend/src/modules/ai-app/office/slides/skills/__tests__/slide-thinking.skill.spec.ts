/**
 * Unit tests for SlideThinkingSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  SlideThinkingSkill,
  ThinkingInput,
  createThinkingStep,
} from "../slide-thinking.skill";
import { EventEmitter2 } from "@nestjs/event-emitter";

// ============================================================================
// Helpers
// ============================================================================

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-thinking",
  domain: "slides",
  sessionId: "session-001",
  createdAt: new Date(),
});

const buildThinkingInput = (
  overrides: Partial<ThinkingInput> = {},
): ThinkingInput => ({
  missionId: "mission-test-1",
  type: "step",
  title: "Test Step",
  content: "Testing step content",
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe("SlideThinkingSkill", () => {
  let skill: SlideThinkingSkill;
  let eventEmitter: EventEmitter2;
  let emitSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlideThinkingSkill,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    skill = module.get<SlideThinkingSkill>(SlideThinkingSkill);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    emitSpy = eventEmitter.emit as jest.MockedFunction<
      typeof eventEmitter.emit
    >;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("metadata", () => {
    it("should have correct id and name", () => {
      expect(skill.id).toBe("slides-thinking");
      expect(skill.name).toBe("Slide Thinking");
      expect(skill.domain).toBe("slides");
      expect(skill.layer).toBe("quality");
    });
  });

  // --------------------------------------------------------------------------
  // execute()
  // --------------------------------------------------------------------------

  describe("execute()", () => {
    it("should record a thinking step and return success", async () => {
      const input = buildThinkingInput({ type: "step", title: "Step 1" });
      const result = await skill.execute(input, buildSkillContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.entry).toBeDefined();
      expect(result.data?.eventEmitted).toBe(true);
    });

    it("should create entry with correct fields", async () => {
      const input = buildThinkingInput({
        type: "decision",
        title: "Template Decision",
        content: "Chose pillars template",
        decision: "Use pillars",
        reasoning: "Content has 3 parallel elements",
        pageIndex: 5,
        skillId: "slides-template-matcher",
        metadata: { templateType: "pillars" },
      });

      const result = await skill.execute(input, buildSkillContext());

      expect(result.success).toBe(true);
      const entry = result.data?.entry;
      expect(entry?.type).toBe("decision");
      expect(entry?.title).toBe("Template Decision");
      expect(entry?.content).toBe("Chose pillars template");
      expect(entry?.decision).toBe("Use pillars");
      expect(entry?.reasoning).toBe("Content has 3 parallel elements");
      expect(entry?.pageIndex).toBe(5);
      expect(entry?.skillId).toBe("slides-template-matcher");
      expect(entry?.metadata?.templateType).toBe("pillars");
    });

    it("should use context.skillId when input has no skillId", async () => {
      const input = buildThinkingInput({ skillId: undefined });
      const ctx = { ...buildSkillContext(), skillId: "parent-skill" };

      const result = await skill.execute(input, ctx);

      expect(result.success).toBe(true);
      expect(result.data?.entry.skillId).toBe("parent-skill");
    });

    it("should emit slides.thinking event", async () => {
      const input = buildThinkingInput({ missionId: "mission-event-test" });
      const ctx = buildSkillContext();
      await skill.execute(input, ctx);

      expect(emitSpy).toHaveBeenCalledWith(
        "slides.thinking",
        expect.objectContaining({
          missionId: "mission-event-test",
          sessionId: ctx.sessionId,
          type: "thinking:step",
          data: expect.any(Object),
        }),
      );
    });

    it("should emit correct type prefix for each entry type", async () => {
      const types: ThinkingInput["type"][] = [
        "step",
        "decision",
        "insight",
        "warning",
        "output",
      ];

      for (const type of types) {
        jest.clearAllMocks();
        const input = buildThinkingInput({
          type,
          missionId: "mission-type-test",
        });
        await skill.execute(input, buildSkillContext());

        expect(emitSpy).toHaveBeenCalledWith(
          "slides.thinking",
          expect.objectContaining({ type: `thinking:${type}` }),
        );
      }
    });

    it("should include entry id in result", async () => {
      const input = buildThinkingInput();
      const result = await skill.execute(input, buildSkillContext());

      expect(result.data?.entry.id).toMatch(/^thinking-/);
    });

    it("should include timestamp in entry", async () => {
      const input = buildThinkingInput();
      const result = await skill.execute(input, buildSkillContext());

      expect(result.data?.entry.timestamp).toBeInstanceOf(Date);
    });

    it("should set entry duration", async () => {
      const input = buildThinkingInput();
      const result = await skill.execute(input, buildSkillContext());

      expect(result.data?.entry.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return eventEmitted=false when emit throws", async () => {
      (emitSpy as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Emit error");
      });

      const input = buildThinkingInput();
      const result = await skill.execute(input, buildSkillContext());

      expect(result.success).toBe(true);
      expect(result.data?.eventEmitted).toBe(false);
    });

    it("should include metadata in result", async () => {
      const input = buildThinkingInput();
      const ctx = buildSkillContext("meta-exec");
      const result = await skill.execute(input, ctx);

      expect(result.metadata.startTime).toBeInstanceOf(Date);
      expect(result.metadata.endTime).toBeInstanceOf(Date);
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("should store entry in internal map", async () => {
      const missionId = "mission-store-test";
      const input = buildThinkingInput({ missionId, title: "Stored Entry" });
      await skill.execute(input, buildSkillContext());

      const entries = skill.getEntries(missionId);
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe("Stored Entry");
    });

    it("should accumulate multiple entries for same mission", async () => {
      const missionId = "mission-accumulate";

      for (let i = 0; i < 3; i++) {
        await skill.execute(
          buildThinkingInput({ missionId, title: `Entry ${i}` }),
          buildSkillContext(),
        );
      }

      const entries = skill.getEntries(missionId);
      expect(entries).toHaveLength(3);
    });

    it("should keep entries separate for different missions", async () => {
      await skill.execute(
        buildThinkingInput({ missionId: "mission-A" }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId: "mission-B" }),
        buildSkillContext(),
      );

      expect(skill.getEntries("mission-A")).toHaveLength(1);
      expect(skill.getEntries("mission-B")).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Memory management
  // --------------------------------------------------------------------------

  describe("memory management", () => {
    it("should not exceed MAX_ENTRIES_PER_MISSION (500) per mission", async () => {
      const missionId = "mission-overflow";

      // Add 510 entries (10 more than limit)
      for (let i = 0; i < 510; i++) {
        await skill.execute(
          buildThinkingInput({ missionId, title: `Entry ${i}` }),
          buildSkillContext(),
        );
      }

      const entries = skill.getEntries(missionId);
      expect(entries.length).toBeLessThanOrEqual(500);
    });

    it("should keep most recent entries when limit exceeded", async () => {
      const missionId = "mission-recent";

      for (let i = 0; i < 505; i++) {
        await skill.execute(
          buildThinkingInput({ missionId, title: `Entry ${i}` }),
          buildSkillContext(),
        );
      }

      const entries = skill.getEntries(missionId);
      // Most recent should be the last ones added
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.title).toBe("Entry 504");
    });
  });

  // --------------------------------------------------------------------------
  // getEntries()
  // --------------------------------------------------------------------------

  describe("getEntries()", () => {
    it("should return empty array for unknown mission", () => {
      const entries = skill.getEntries("nonexistent-mission");
      expect(entries).toEqual([]);
    });

    it("should return stored entries for existing mission", async () => {
      const missionId = "get-entries-test";
      await skill.execute(
        buildThinkingInput({ missionId, title: "Test Entry", type: "insight" }),
        buildSkillContext(),
      );

      const entries = skill.getEntries(missionId);
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("insight");
    });
  });

  // --------------------------------------------------------------------------
  // getSummary()
  // --------------------------------------------------------------------------

  describe("getSummary()", () => {
    it("should return empty summary for mission with no entries", () => {
      const summary = skill.getSummary("empty-mission");

      expect(summary.totalEntries).toBe(0);
      expect(summary.byType.step).toBe(0);
      expect(summary.totalDuration).toBe(0);
      expect(summary.keyDecisions).toEqual([]);
      expect(summary.insights).toEqual([]);
    });

    it("should count entries by type correctly", async () => {
      const missionId = "summary-count-test";

      await skill.execute(
        buildThinkingInput({ missionId, type: "step" }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId, type: "step" }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({
          missionId,
          type: "decision",
          decision: "Decision1",
        }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId, type: "insight" }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId, type: "warning" }),
        buildSkillContext(),
      );

      const summary = skill.getSummary(missionId);
      expect(summary.totalEntries).toBe(5);
      expect(summary.byType.step).toBe(2);
      expect(summary.byType.decision).toBe(1);
      expect(summary.byType.insight).toBe(1);
      expect(summary.byType.warning).toBe(1);
    });

    it("should include key decisions in summary", async () => {
      const missionId = "decisions-test";

      await skill.execute(
        buildThinkingInput({
          missionId,
          type: "decision",
          decision: "Use pillars template",
        }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({
          missionId,
          type: "decision",
          decision: "Add data chart",
        }),
        buildSkillContext(),
      );

      const summary = skill.getSummary(missionId);
      expect(summary.keyDecisions).toContain("Use pillars template");
      expect(summary.keyDecisions).toContain("Add data chart");
    });

    it("should include insights in summary", async () => {
      const missionId = "insights-test";

      await skill.execute(
        buildThinkingInput({
          missionId,
          type: "insight",
          content: "Content is too dense",
        }),
        buildSkillContext(),
      );

      const summary = skill.getSummary(missionId);
      expect(summary.insights).toContain("Content is too dense");
    });

    it("should cap key decisions at 10", async () => {
      const missionId = "many-decisions";

      for (let i = 0; i < 15; i++) {
        await skill.execute(
          buildThinkingInput({
            missionId,
            type: "decision",
            decision: `Decision ${i}`,
          }),
          buildSkillContext(),
        );
      }

      const summary = skill.getSummary(missionId);
      expect(summary.keyDecisions.length).toBeLessThanOrEqual(10);
    });

    it("should calculate total duration", async () => {
      const missionId = "duration-test";

      await skill.execute(
        buildThinkingInput({ missionId }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId }),
        buildSkillContext(),
      );

      const summary = skill.getSummary(missionId);
      expect(summary.totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // clearEntries()
  // --------------------------------------------------------------------------

  describe("clearEntries()", () => {
    it("should clear all entries for a mission", async () => {
      const missionId = "clear-test";
      await skill.execute(
        buildThinkingInput({ missionId }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId }),
        buildSkillContext(),
      );

      skill.clearEntries(missionId);

      expect(skill.getEntries(missionId)).toHaveLength(0);
    });

    it("should not affect entries of other missions", async () => {
      await skill.execute(
        buildThinkingInput({ missionId: "keep" }),
        buildSkillContext(),
      );
      await skill.execute(
        buildThinkingInput({ missionId: "delete" }),
        buildSkillContext(),
      );

      skill.clearEntries("delete");

      expect(skill.getEntries("keep")).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // emitSummary()
  // --------------------------------------------------------------------------

  describe("emitSummary()", () => {
    it("should emit summary event", async () => {
      const missionId = "summary-emit";
      await skill.execute(
        buildThinkingInput({ missionId, type: "step" }),
        buildSkillContext(),
      );

      skill.emitSummary(missionId, "session-abc");

      expect(emitSpy).toHaveBeenCalledWith(
        "slides.thinking",
        expect.objectContaining({
          missionId,
          sessionId: "session-abc",
          type: "thinking:summary",
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // getMemoryStats()
  // --------------------------------------------------------------------------

  describe("getMemoryStats()", () => {
    it("should return zero stats when no entries", () => {
      const freshSkill = new SlideThinkingSkill(eventEmitter);
      const stats = freshSkill.getMemoryStats();
      expect(stats.missionCount).toBe(0);
      expect(stats.totalEntries).toBe(0);
    });

    it("should count missions and entries correctly", async () => {
      const freshModule = await Test.createTestingModule({
        providers: [
          SlideThinkingSkill,
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        ],
      }).compile();
      const freshSkill =
        freshModule.get<SlideThinkingSkill>(SlideThinkingSkill);

      await freshSkill.execute(
        buildThinkingInput({ missionId: "stats-m1" }),
        buildSkillContext(),
      );
      await freshSkill.execute(
        buildThinkingInput({ missionId: "stats-m1" }),
        buildSkillContext(),
      );
      await freshSkill.execute(
        buildThinkingInput({ missionId: "stats-m2" }),
        buildSkillContext(),
      );

      const stats = freshSkill.getMemoryStats();
      expect(stats.missionCount).toBe(2);
      expect(stats.totalEntries).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // createThinkingStep helper
  // --------------------------------------------------------------------------

  describe("createThinkingStep helper", () => {
    it("should create a function that calls skill.execute", async () => {
      const missionId = "helper-test";
      const ctx = buildSkillContext();
      const think = createThinkingStep(skill, missionId, ctx);

      const result = await think("step", "Helper Step", "Content from helper");

      expect(result.success).toBe(true);
      expect(skill.getEntries(missionId)).toHaveLength(1);
    });

    it("should pass reasoning, decision, pageIndex, metadata to execute", async () => {
      const missionId = "helper-full-test";
      const ctx = buildSkillContext();
      const think = createThinkingStep(skill, missionId, ctx);

      await think("decision", "Full Decision", "Detailed content", {
        reasoning: "Because of X",
        decision: "Choose Y",
        pageIndex: 3,
        metadata: { extra: "data" },
      });

      const entries = skill.getEntries(missionId);
      expect(entries[0].reasoning).toBe("Because of X");
      expect(entries[0].decision).toBe("Choose Y");
      expect(entries[0].pageIndex).toBe(3);
      expect(entries[0].metadata?.extra).toBe("data");
    });
  });
});
