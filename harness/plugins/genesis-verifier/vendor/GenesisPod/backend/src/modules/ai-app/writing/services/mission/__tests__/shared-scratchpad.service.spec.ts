/**
 * Unit tests for SharedScratchpadService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SharedScratchpadService } from "../shared-scratchpad.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

function buildMockPrisma() {
  return {
    writingMission: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

describe("SharedScratchpadService", () => {
  let service: SharedScratchpadService;
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedScratchpadService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SharedScratchpadService>(SharedScratchpadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getOrCreate", () => {
    it("should create a new scratchpad when none exists", async () => {
      prisma.writingMission.findUnique.mockResolvedValue(null);
      prisma.writingMission.update.mockResolvedValue({});

      const result = await service.getOrCreate("mission-1");

      expect(result.missionId).toBe("mission-1");
      expect(result.entries).toHaveLength(0);
      expect(result.version).toBe(1);
    });

    it("should return cached scratchpad on second call", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      await service.getOrCreate("mission-1");
      const findUniqueCalls =
        prisma.writingMission.findUnique.mock.calls.length;
      await service.getOrCreate("mission-1");

      // Should not have made additional DB calls
      expect(prisma.writingMission.findUnique.mock.calls.length).toBe(
        findUniqueCalls,
      );
    });

    it("should load from database when exists", async () => {
      const existingScratchpad = {
        missionId: "mission-2",
        entries: [
          {
            id: "entry-1",
            missionId: "mission-2",
            fromAgent: "writer",
            type: "NOTE",
            content: "Test note",
            priority: "MEDIUM",
            status: "OPEN",
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 2,
      };

      prisma.writingMission.findUnique.mockResolvedValue({
        result: { scratchpad: existingScratchpad },
      });

      const result = await service.getOrCreate("mission-2");

      expect(result.entries).toHaveLength(1);
      expect(result.version).toBe(2);
    });
  });

  describe("addEntry", () => {
    it("should add an entry to the scratchpad", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      const entry = await service.addEntry("mission-1", {
        fromAgent: "writer",
        type: "NOTE",
        content: "Important note about character",
        priority: "HIGH",
      });

      expect(entry.id).toBeDefined();
      expect(entry.fromAgent).toBe("writer");
      expect(entry.type).toBe("NOTE");
      expect(entry.content).toBe("Important note about character");
      expect(entry.status).toBe("OPEN");
    });

    it("should use MEDIUM priority as default", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      const entry = await service.addEntry("mission-1", {
        fromAgent: "editor",
        type: "TODO",
        content: "Review this section",
      });

      expect(entry.priority).toBe("MEDIUM");
    });
  });

  describe("askQuestion", () => {
    it("should add a QUESTION type entry", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      const entry = await service.askQuestion(
        "mission-1",
        "writer",
        "What is the character's motivation?",
        ["bible-keeper"],
        "HIGH",
      );

      expect(entry.type).toBe("QUESTION");
      expect(entry.fromAgent).toBe("writer");
      expect(entry.content).toBe("What is the character's motivation?");
      expect(entry.toAgents).toEqual(["bible-keeper"]);
    });
  });

  describe("answerQuestion", () => {
    it("should add ANSWER entry and resolve the question", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      // First ask a question
      const question = await service.askQuestion(
        "mission-1",
        "writer",
        "Who is the villain?",
      );

      // Then answer it
      const answer = await service.answerQuestion(
        "mission-1",
        question.id,
        "bible-keeper",
        "The villain is Lord Darkness",
      );

      expect(answer.type).toBe("ANSWER");
      expect(answer.replyTo).toBe(question.id);

      // Verify question is resolved
      const scratchpad = await service.getOrCreate("mission-1");
      const resolvedQuestion = scratchpad.entries.find(
        (e) => e.id === question.id,
      );
      expect(resolvedQuestion?.status).toBe("RESOLVED");
    });
  });

  describe("recordFact and getFactsByTopic", () => {
    it("should record and retrieve facts by topic", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      await service.recordFact(
        "mission-1",
        "bible-keeper",
        "Alice has blue eyes",
        "character-appearance",
      );

      await service.recordFact(
        "mission-1",
        "bible-keeper",
        "Alice is 25 years old",
        "character-appearance",
      );

      const facts = await service.getFactsByTopic(
        "mission-1",
        "character-appearance",
      );

      expect(facts).toHaveLength(2);
      expect(facts[0].type).toBe("FACT");
    });
  });

  describe("recordDecision", () => {
    it("should add a DECISION entry with HIGH priority", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      const entry = await service.recordDecision(
        "mission-1",
        "story-architect",
        "Alice will betray the team in chapter 5",
        "Plot twist context",
      );

      expect(entry.type).toBe("DECISION");
      expect(entry.priority).toBe("HIGH");
      expect(entry.metadata?.context).toBe("Plot twist context");
    });
  });

  describe("getUnresolvedQuestions", () => {
    it("should return only unresolved QUESTION entries", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      await service.askQuestion(
        "mission-1",
        "writer",
        "Question 1",
        undefined,
        "HIGH",
      );
      const q2 = await service.askQuestion("mission-1", "writer", "Question 2");

      // Resolve q2
      await service.resolveEntry("mission-1", q2.id, "editor", "Answer");

      const unresolved = await service.getUnresolvedQuestions("mission-1");

      expect(unresolved.every((q) => q.status === "OPEN")).toBe(true);
      expect(unresolved.every((q) => q.type === "QUESTION")).toBe(true);
    });
  });

  describe("buildSummaryForAgent", () => {
    it("should return empty string when scratchpad is empty", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      const result = await service.buildSummaryForAgent(
        "mission-empty",
        "writer",
      );

      expect(result).toBe("");
    });

    it("should include unresolved questions in summary", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      await service.askQuestion(
        "mission-1",
        "editor",
        "Should we change the ending?",
        ["story-architect"],
        "HIGH",
      );

      const summary = await service.buildSummaryForAgent(
        "mission-1",
        "story-architect",
      );

      expect(summary).toContain("待回答问题");
      expect(summary).toContain("Should we change the ending?");
    });

    it("should include decisions in summary", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      await service.recordDecision(
        "mission-1",
        "story-architect",
        "Hero dies in chapter 10",
      );

      const summary = await service.buildSummaryForAgent("mission-1", "writer");

      expect(summary).toContain("已做决策");
      expect(summary).toContain("Hero dies in chapter 10");
    });
  });

  describe("cleanupExpired", () => {
    it("should remove resolved low-priority old entries", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      // Add a note and immediately resolve it
      const entry = await service.addEntry("mission-1", {
        fromAgent: "writer",
        type: "NOTE",
        content: "Old note",
        priority: "LOW",
      });

      // Manually set old date
      const scratchpad = await service.getOrCreate("mission-1");
      const e = scratchpad.entries.find((x) => x.id === entry.id)!;
      e.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      e.status = "RESOLVED";

      const removed = await service.cleanupExpired("mission-1", 24);

      expect(removed).toBeGreaterThanOrEqual(1);
    });

    it("should not remove high priority resolved entries", async () => {
      prisma.writingMission.update.mockResolvedValue({});

      const entry = await service.addEntry("mission-1", {
        fromAgent: "story-architect",
        type: "DECISION",
        content: "Important decision",
        priority: "HIGH",
      });

      const scratchpad = await service.getOrCreate("mission-1");
      const e = scratchpad.entries.find((x) => x.id === entry.id)!;
      e.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      e.status = "RESOLVED";

      const removed = await service.cleanupExpired("mission-1", 24);

      expect(removed).toBe(0);
    });
  });

  describe("delete", () => {
    it("should remove scratchpad from memory", async () => {
      prisma.writingMission.update.mockResolvedValue({});
      prisma.writingMission.findUnique.mockResolvedValue({
        result: {},
      });

      await service.getOrCreate("mission-1");
      await service.delete("mission-1");

      // After delete, getOrCreate should try DB again
      await service.getOrCreate("mission-1");
      expect(prisma.writingMission.findUnique).toHaveBeenCalled();
    });
  });
});
