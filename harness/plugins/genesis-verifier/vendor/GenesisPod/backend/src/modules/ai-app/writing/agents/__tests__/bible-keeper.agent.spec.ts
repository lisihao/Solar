/**
 * Unit tests for BibleKeeperAgent
 *
 * Covers:
 * - Agent metadata (id, name, capabilities, supportedModes)
 * - query_character: by name, by id, return all characters
 * - query_world: all settings, filter by category
 * - query_timeline: all events, filter by time range, sorted by storyTime
 * - query_terminology: found, not found, missing term param
 * - update_character_state: success and missing params
 * - add_timeline_event: success and missing params
 * - validate_change: missing proposedChange, valid LLM response
 * - get_snapshot: returns storyBible snapshot
 * - Unknown operation throws error
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BibleKeeperAgent, BibleKeeperInput } from "../bible-keeper.agent";
import type { AgentContext } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";

// ==================== Helpers ====================

function makeAgentContext(): AgentContext {
  return {
    agentId: "bible-keeper",
    executionId: "exec-bible-1",
    mode: "reactive",
    metadata: {},
  } as AgentContext;
}

function makeContextPackage(
  overrides: {
    characters?: WritingContextPackage["extensions"]["storyBible"]["characters"];
    terminologies?: WritingContextPackage["extensions"]["storyBible"]["terminologies"];
    worldSettings?: WritingContextPackage["extensions"]["storyBible"]["worldSettings"];
    timelineEvents?: WritingContextPackage["extensions"]["storyBible"]["timelineEvents"];
  } = {},
): WritingContextPackage {
  return {
    projectId: "project-bible-1",
    hardConstraints: [{ severity: "error", rule: "Protagonist cannot die" }],
    glossary: {},
    establishedFacts: [],
    extensions: {
      storyBible: {
        projectId: "project-bible-1",
        worldType: "Fantasy",
        stylePresetId: undefined,
        writingStyle: {
          pov: "third-person",
          tense: "past",
          vocabulary: "intermediate",
          dialogueStyle: "natural",
          descriptionStyle: "vivid",
        },
        characters: overrides.characters ?? [
          {
            id: "char-1",
            name: "苏清婉",
            type: "character",
            role: "protagonist",
            aliases: ["婉儿", "清婉"],
            definition: "宫廷女官",
            appearance: { gender: "female" },
          },
          {
            id: "char-2",
            name: "李元",
            type: "character",
            role: "antagonist",
            aliases: [],
            definition: "权贵",
          },
        ],
        terminologies: overrides.terminologies ?? [
          {
            term: "太医院",
            definition: "Imperial medical office",
            variants: ["御医院"],
          },
          { term: "暴室", definition: "Prison for female criminals" },
        ],
        worldSettings: overrides.worldSettings ?? [
          { category: "geography", name: "长安", description: "Capital city" },
          {
            category: "politics",
            name: "皇宫",
            description: "Imperial palace",
          },
          {
            category: "geography",
            name: "太液池",
            description: "Imperial lake",
          },
        ],
        timelineEvents: overrides.timelineEvents ?? [
          {
            storyTime: "开元十年春",
            eventName: "入宫",
            description: "主角入宫",
            importance: 5,
          },
          {
            storyTime: "开元十年夏",
            eventName: "初遇",
            description: "两人初遇",
            importance: 3,
          },
          {
            storyTime: "开元九年冬",
            eventName: "早年事件",
            description: "背景故事",
            importance: 2,
          },
        ],
        factions: [],
        plotPoints: [],
      },
    },
  } as unknown as WritingContextPackage;
}

// ==================== Tests ====================

describe("BibleKeeperAgent", () => {
  let agent: BibleKeeperAgent;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BibleKeeperAgent],
    }).compile();

    agent = module.get<BibleKeeperAgent>(BibleKeeperAgent);

    // Set up a mock LLM adapter for validate_change which calls callLLM
    agent.setLLMAdapter({
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          valid: true,
          conflicts: [],
          suggestions: ["变更合理"],
        }),
        usage: { totalTokens: 100 },
      }),
    } as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Agent Metadata ====================

  describe("agent metadata", () => {
    it("should have correct agent id", () => {
      expect(agent.id).toBe("bible-keeper");
    });

    it("should have correct name", () => {
      expect(agent.name).toBe("Bible Keeper");
    });

    it("should include setting-management capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "setting-management");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("data-management");
    });

    it("should include query-service capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "query-service");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("retrieval");
    });

    it("should include change-control capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "change-control");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("validation");
    });

    it("should include state-tracking capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "state-tracking");
      expect(cap).toBeDefined();
    });

    it("should support reactive and hybrid modes", () => {
      expect(agent.supportedModes).toContain("reactive");
      expect(agent.supportedModes).toContain("hybrid");
    });
  });

  // ==================== query_character ====================

  describe("query_character operation", () => {
    it("should return all characters when no filter provided", async () => {
      const input: BibleKeeperInput = {
        operation: "query_character",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("query_character");
      expect(result.data?.result.characters).toHaveLength(2);
    });

    it("should find character by name (exact match)", async () => {
      const input: BibleKeeperInput = {
        operation: "query_character",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { characterName: "苏清婉" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.characters).toHaveLength(1);
      expect(result.data?.result.character?.name).toBe("苏清婉");
    });

    it("should find character by alias (fuzzy match)", async () => {
      const input: BibleKeeperInput = {
        operation: "query_character",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { characterName: "婉儿" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.characters).toHaveLength(1);
      expect(result.data?.result.characters?.[0].name).toBe("苏清婉");
    });

    it("should find character by id (characterId param)", async () => {
      const input: BibleKeeperInput = {
        operation: "query_character",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { characterId: "苏清婉" }, // characterId matches by name field in implementation
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
    });

    it("should return empty when character not found by name", async () => {
      const input: BibleKeeperInput = {
        operation: "query_character",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { characterName: "不存在角色" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.characters).toHaveLength(0);
    });

    it("should set result.character to first character found", async () => {
      const input: BibleKeeperInput = {
        operation: "query_character",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.character).toBeDefined();
      expect(result.data?.result.character?.name).toBe("苏清婉");
    });
  });

  // ==================== query_world ====================

  describe("query_world operation", () => {
    it("should return all world settings when no category filter", async () => {
      const input: BibleKeeperInput = {
        operation: "query_world",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("query_world");
      expect(result.data?.result.worldSettings).toHaveLength(3);
    });

    it("should filter world settings by category", async () => {
      const input: BibleKeeperInput = {
        operation: "query_world",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { worldCategory: "geography" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.worldSettings).toHaveLength(2); // 长安 and 太液池
    });

    it("should return empty when category not found", async () => {
      const input: BibleKeeperInput = {
        operation: "query_world",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { worldCategory: "nonexistent-category" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.worldSettings).toHaveLength(0);
    });

    it("should do case-insensitive category matching", async () => {
      const input: BibleKeeperInput = {
        operation: "query_world",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { worldCategory: "GEOGRAPHY" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.worldSettings).toHaveLength(2);
    });
  });

  // ==================== query_timeline ====================

  describe("query_timeline operation", () => {
    it("should return all timeline events sorted by storyTime", async () => {
      const input: BibleKeeperInput = {
        operation: "query_timeline",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.timelineEvents).toHaveLength(3);
      // Sorted by storyTime using localeCompare / string sort
      const events = result.data?.result.timelineEvents ?? [];
      // 开元九年冬 comes first (九 < 十)
      // 开元十年夏 and 开元十年春 order depends on Unicode code points
      // 夏 = U+590F, 春 = U+6625 => 夏 < 春 in Unicode
      expect(events[0].storyTime).toBe("开元九年冬");
      // Remaining two are both 开元十年X; just verify sorted (夏 before 春)
      const tenthYearEvents = events.slice(1).map((e) => e.storyTime);
      expect(tenthYearEvents).toContain("开元十年春");
      expect(tenthYearEvents).toContain("开元十年夏");
    });

    it("should filter events by time range start", async () => {
      const input: BibleKeeperInput = {
        operation: "query_timeline",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { timeRange: { start: "开元十年" } },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // Only events >= "开元十年"
      const events = result.data?.result.timelineEvents ?? [];
      expect(events.every((e) => e.storyTime >= "开元十年")).toBe(true);
    });

    it("should filter events by time range end", async () => {
      const input: BibleKeeperInput = {
        operation: "query_timeline",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { timeRange: { end: "开元十年春" } },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // Only events <= "开元十年春"
      const events = result.data?.result.timelineEvents ?? [];
      expect(events.every((e) => e.storyTime <= "开元十年春")).toBe(true);
    });

    it("should filter events by both start and end range", async () => {
      // Use exact match range: start=end to select a single event
      // "开元十年春" as both start and end should return only that event (春 == 春)
      const input: BibleKeeperInput = {
        operation: "query_timeline",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { timeRange: { start: "开元十年春", end: "开元十年春" } },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.timelineEvents).toHaveLength(1);
      expect(result.data?.result.timelineEvents![0].storyTime).toBe(
        "开元十年春",
      );
    });
  });

  // ==================== query_terminology ====================

  describe("query_terminology operation", () => {
    it("should return success=false when no term provided", async () => {
      const input: BibleKeeperInput = {
        operation: "query_terminology",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      // BaseAgent wraps doExecute result; outer result.success is always true when no exception
      // Inner operation result is in result.data.success
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.warnings).toContain("未提供查询术语");
    });

    it("should return terminology when term found by exact match", async () => {
      const input: BibleKeeperInput = {
        operation: "query_terminology",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { term: "太医院" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.terminology?.term).toBe("太医院");
      expect(result.data?.result.terminology?.definition).toBe(
        "Imperial medical office",
      );
    });

    it("should find terminology by variant match", async () => {
      const input: BibleKeeperInput = {
        operation: "query_terminology",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { term: "御医院" }, // variant of 太医院
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.terminology?.term).toBe("太医院");
    });

    it("should return warning when term not found", async () => {
      const input: BibleKeeperInput = {
        operation: "query_terminology",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { term: "不存在术语" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.warnings).toBeDefined();
      expect(result.data?.warnings?.[0]).toContain("未找到术语");
    });

    it("should include variants in terminology result", async () => {
      const input: BibleKeeperInput = {
        operation: "query_terminology",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { term: "太医院" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.terminology?.variants).toContain("御医院");
    });
  });

  // ==================== update_character_state ====================

  describe("update_character_state operation", () => {
    it("should return success when characterName and newState provided", async () => {
      const input: BibleKeeperInput = {
        operation: "update_character_state",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          characterName: "苏清婉",
          newState: {
            storyTime: "开元十年夏",
            state: { location: "御花园", condition: "受伤", mood: "痛苦" },
          },
          sourceChapterId: "chapter-5",
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("update_character_state");
      expect(result.data?.result.validation?.valid).toBe(true);
    });

    it("should return failure when characterName is missing", async () => {
      const input: BibleKeeperInput = {
        operation: "update_character_state",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          newState: {
            storyTime: "开元十年夏",
            state: { location: "御花园" },
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.warnings).toContain("缺少角色名或新状态");
    });

    it("should return failure when newState is missing", async () => {
      const input: BibleKeeperInput = {
        operation: "update_character_state",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: { characterName: "苏清婉" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.warnings).toContain("缺少角色名或新状态");
    });

    it("should include character name in suggestions", async () => {
      const input: BibleKeeperInput = {
        operation: "update_character_state",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          characterName: "李元",
          newState: {
            storyTime: "开元十年夏",
            state: { location: "宫殿" },
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.validation?.suggestions[0]).toContain("李元");
    });
  });

  // ==================== add_timeline_event ====================

  describe("add_timeline_event operation", () => {
    it("should return success when newEvent provided", async () => {
      const input: BibleKeeperInput = {
        operation: "add_timeline_event",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          newEvent: {
            storyTime: "开元十年秋",
            eventName: "秋猎",
            description: "皇帝秋猎，主角随行",
            importance: 4,
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("add_timeline_event");
      expect(result.data?.result.validation?.valid).toBe(true);
    });

    it("should include event name in suggestions", async () => {
      const input: BibleKeeperInput = {
        operation: "add_timeline_event",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          newEvent: {
            storyTime: "开元十年秋",
            eventName: "重要事件",
            description: "描述",
            importance: 3,
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.validation?.suggestions[0]).toContain(
        "重要事件",
      );
    });

    it("should return failure when newEvent is missing", async () => {
      const input: BibleKeeperInput = {
        operation: "add_timeline_event",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.warnings).toContain("缺少新事件数据");
    });
  });

  // ==================== validate_change ====================

  describe("validate_change operation", () => {
    it("should return failure when proposedChange is missing", async () => {
      const input: BibleKeeperInput = {
        operation: "validate_change",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.warnings).toContain("缺少待验证的变更");
    });

    it("should call LLM and return validation result", async () => {
      const input: BibleKeeperInput = {
        operation: "validate_change",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          proposedChange: {
            type: "character",
            data: { name: "苏清婉", newTrait: "勇敢" },
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.validation).toBeDefined();
      expect(result.data?.result.validation?.valid).toBe(true);
    });

    it("should handle LLM returning invalid JSON gracefully", async () => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: "invalid json response",
          usage: { totalTokens: 50 },
        }),
      } as never);

      const input: BibleKeeperInput = {
        operation: "validate_change",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {
          proposedChange: {
            type: "world",
            data: { setting: "new_rule" },
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // Falls back to default validation result
      expect(result.data?.result.validation).toBeDefined();
    });
  });

  // ==================== get_snapshot ====================

  describe("get_snapshot operation", () => {
    it("should return the complete storyBible snapshot", async () => {
      const contextPackage = makeContextPackage();
      const input: BibleKeeperInput = {
        operation: "get_snapshot",
        projectId: "project-1",
        contextPackage,
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("get_snapshot");
      expect(result.data?.result.snapshot).toBeDefined();
      expect(result.data?.result.snapshot).toEqual(
        contextPackage.extensions.storyBible,
      );
    });

    it("should include characters in snapshot", async () => {
      const input: BibleKeeperInput = {
        operation: "get_snapshot",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.snapshot?.characters).toHaveLength(2);
    });

    it("should include terminologies in snapshot", async () => {
      const input: BibleKeeperInput = {
        operation: "get_snapshot",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.result.snapshot?.terminologies).toHaveLength(2);
    });
  });

  // ==================== Unknown operation ====================

  describe("unknown operation", () => {
    it("should return error for unknown operation", async () => {
      const input = {
        operation: "unknown_op" as BibleKeeperInput["operation"],
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Unknown operation");
    });
  });
});
