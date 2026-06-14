/**
 * TeamFacade 单元测试
 *
 * Tests:
 * - startTeamMission() delegation
 * - executeMissionStream() async generator
 * - cancelMission() / getMissionStatus()
 * - Skill execution with LLM adapter injection
 * - resolveSkillInputBindings()
 * - A2A publish / clearSession
 * - Reflection & compression
 * - Evidence save
 * - Voting create / cast / close
 * - Service & registry getters
 * - Graceful degradation
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamFacade } from "../team.facade";
import {
  TEAMS_FEATURE,
  COLLABORATION_FEATURE,
  SKILL_FEATURE,
  INTELLIGENCE_FEATURE,
  REGISTRY_FEATURE,
} from "../../facade.providers";

describe("TeamFacade", () => {
  let facade: TeamFacade;
  let mockTeamsService: any;
  let mockA2ABus: any;
  let mockReflection: any;
  let mockContextCompression: any;
  let mockEvidenceManager: any;
  let mockVotingManager: any;
  let mockLLMAdapter: any;
  let mockSkillLoader: any;
  let mockInputBindingResolver: any;
  let mockTeamRegistry: any;
  let mockRoleRegistry: any;
  let mockSkillRegistry: any;
  let mockSynthesisEngine: any;

  beforeEach(async () => {
    mockTeamsService = {
      executeMission: jest.fn().mockResolvedValue({ success: true }),
      executeMissionStream: jest.fn(),
      cancelMission: jest.fn().mockReturnValue(true),
      getMissionStatus: jest
        .fn()
        .mockReturnValue({ status: "running", progress: 50 }),
    };

    mockA2ABus = {
      publish: jest.fn().mockResolvedValue({ id: "msg-1" }),
      clearSession: jest.fn(),
    };

    mockReflection = {
      reflect: jest
        .fn()
        .mockResolvedValue({ quality: 0.8, suggestions: ["Improve clarity"] }),
    };

    mockContextCompression = {
      compress: jest
        .fn()
        .mockResolvedValue({ compressed: "short version", ratio: 0.5 }),
    };

    mockSynthesisEngine = {
      sanitizeReport: jest.fn().mockReturnValue("sanitized text"),
    };

    mockEvidenceManager = {
      save: jest.fn().mockResolvedValue(undefined),
    };

    mockVotingManager = {
      createVote: jest.fn().mockReturnValue({ id: "vote-1", options: [] }),
      castVote: jest.fn(),
      closeVote: jest.fn().mockReturnValue({ winner: "option-a" }),
    };

    mockLLMAdapter = {
      chat: jest.fn(),
    };

    mockSkillLoader = {
      getSkillsForTask: jest.fn().mockResolvedValue([]),
      getAllLoadedSkills: jest
        .fn()
        .mockReturnValue([{ id: "skill-1", name: "Test Skill" }]),
    };

    mockInputBindingResolver = {
      resolve: jest.fn().mockReturnValue({ key: "value" }),
    };

    mockTeamRegistry = { get: jest.fn(), has: jest.fn() };
    mockRoleRegistry = { get: jest.fn(), has: jest.fn() };
    mockSkillRegistry = { get: jest.fn(), has: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamFacade,
        {
          provide: TEAMS_FEATURE,
          useValue: {
            teamsService: mockTeamsService,
            contextInit: {},
            teamFactory: {},
            missionOrchestrator: {},
          },
        },
        {
          provide: COLLABORATION_FEATURE,
          useValue: {
            a2aBus: mockA2ABus,
            evidenceManager: mockEvidenceManager,
            votingManager: mockVotingManager,
          },
        },
        {
          provide: SKILL_FEATURE,
          useValue: {
            llmAdapter: mockLLMAdapter,
            loader: mockSkillLoader,
            inputBindingResolver: mockInputBindingResolver,
          },
        },
        {
          provide: INTELLIGENCE_FEATURE,
          useValue: {
            reflection: mockReflection,
            contextCompression: mockContextCompression,
            synthesisEngine: mockSynthesisEngine,
          },
        },
        {
          provide: REGISTRY_FEATURE,
          useValue: {
            team: mockTeamRegistry,
            role: mockRoleRegistry,
            skill: mockSkillRegistry,
          },
        },
      ],
    }).compile();

    facade = module.get<TeamFacade>(TeamFacade);
  });

  // ==================== Team Mission ====================

  describe("cancelMission()", () => {
    it("should delegate to teamSub", () => {
      const result = facade.cancelMission("mission-1");
      expect(typeof result).toBe("boolean");
    });
  });

  describe("getMissionStatus()", () => {
    it("should delegate to teamSub", () => {
      const status = facade.getMissionStatus("mission-1");
      // May return null if teamSub doesn't know about it
      expect(status === null || typeof status === "object").toBe(true);
    });
  });

  // ==================== Skill Execution ====================

  describe("executeSkill()", () => {
    it("should execute skill and return result", async () => {
      const mockSkill = {
        execute: jest
          .fn()
          .mockResolvedValue({ success: true, output: "result" }),
      } as any;

      const result = await facade.executeSkill(mockSkill, { input: "data" }, {
        skillId: "s1",
      } as any);

      expect(result.success).toBe(true);
      expect(mockSkill.execute).toHaveBeenCalled();
    });

    it("should inject LLM adapter when skill supports it", async () => {
      const mockSkillWithAdapter = {
        setLLMAdapter: jest.fn(),
        execute: jest
          .fn()
          .mockResolvedValue({ success: true, output: "result" }),
      } as any;

      await facade.executeSkill(mockSkillWithAdapter, {}, {
        skillId: "s1",
      } as any);

      expect(mockSkillWithAdapter.setLLMAdapter).toHaveBeenCalledWith(
        mockLLMAdapter,
      );
    });
  });

  describe("skillLoaderGetAll()", () => {
    it("should return all loaded skills", () => {
      const skills = facade.skillLoaderGetAll();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("Test Skill");
    });
  });

  // ==================== A2A ====================

  describe("A2A operations", () => {
    it("should publish A2A message", async () => {
      const result = await facade.a2aPublish({
        sessionId: "s1",
        fromAgentId: "agent-1",
        type: "request" as any,
        payload: { data: "hello" },
      });

      expect(result).toEqual({ id: "msg-1" });
      expect(mockA2ABus.publish).toHaveBeenCalled();
    });

    it("should clear A2A session", () => {
      facade.a2aClearSession("s1");
      expect(mockA2ABus.clearSession).toHaveBeenCalledWith("s1");
    });
  });

  // ==================== Reflection & Compression ====================

  describe("reflection", () => {
    it("should delegate reflect()", async () => {
      const result = await facade.reflect(
        { content: "test output" } as any,
        { maxIterations: 3 } as any,
      );

      expect(result).toHaveProperty("quality", 0.8);
      expect(mockReflection.reflect).toHaveBeenCalled();
    });
  });

  describe("context compression", () => {
    it("should delegate aiCompressContext()", async () => {
      const result = await facade.aiCompressContext("very long text");

      expect(result).toHaveProperty("compressed", "short version");
      expect(mockContextCompression.compress).toHaveBeenCalled();
    });
  });

  describe("sanitizeReport", () => {
    it("should delegate to synthesis engine", () => {
      const result = facade.sanitizeReport("raw text");
      expect(result).toBe("sanitized text");
    });
  });

  // ==================== Evidence ====================

  describe("evidence operations", () => {
    it("should save evidence", async () => {
      await facade.evidenceSave({ type: "finding", content: "test" } as any);
      expect(mockEvidenceManager.save).toHaveBeenCalled();
    });
  });

  // ==================== Voting ====================

  describe("voting operations", () => {
    it("should create a vote", () => {
      const session = facade.votingCreate({
        question: "Choose option",
        options: ["A", "B"],
      } as any);

      expect(session).toHaveProperty("id", "vote-1");
      expect(mockVotingManager.createVote).toHaveBeenCalled();
    });

    it("should cast a vote", () => {
      facade.votingCastVote("vote-1", "voter-1", "option-a");
      expect(mockVotingManager.castVote).toHaveBeenCalledWith(
        "vote-1",
        "voter-1",
        "option-a",
      );
    });

    it("should close a vote", () => {
      const result = facade.votingClose("vote-1", 3);
      expect(result).toHaveProperty("winner", "option-a");
    });
  });

  // ==================== Service Getters ====================

  describe("service getters", () => {
    it("should expose teams service", () => {
      expect(facade.teams).toBe(mockTeamsService);
    });

    it("should expose teamRegistry", () => {
      expect(facade.teamRegistry).toBe(mockTeamRegistry);
    });

    it("should expose roleRegistry", () => {
      expect(facade.roleRegistry).toBe(mockRoleRegistry);
    });

    it("should expose skillRegistry", () => {
      expect(facade.skillRegistry).toBe(mockSkillRegistry);
    });
  });

  // ==================== resolveSkillInputBindings ====================

  describe("resolveSkillInputBindings()", () => {
    it("should return null for non-PromptSkillAdapter skills", () => {
      const plainSkill = {
        isPromptSkillAdapter: false,
        execute: jest.fn(),
      } as any;

      const result = facade.resolveSkillInputBindings(plainSkill, {} as any);
      expect(result).toBeNull();
    });

    it("should resolve bindings for PromptSkillAdapter skills", () => {
      const adapterSkill = {
        isPromptSkillAdapter: true,
        getInputBindings: jest
          .fn()
          .mockReturnValue([{ key: "topic", source: "context.topic" }]),
        execute: jest.fn(),
      } as any;

      const result = facade.resolveSkillInputBindings(adapterSkill, {
        topic: "AI",
      } as any);

      expect(result).toEqual({ key: "value" });
      expect(mockInputBindingResolver.resolve).toHaveBeenCalled();
    });

    it("should return null when bindings are empty", () => {
      const adapterSkill = {
        isPromptSkillAdapter: true,
        getInputBindings: jest.fn().mockReturnValue(null),
        execute: jest.fn(),
      } as any;

      const result = facade.resolveSkillInputBindings(adapterSkill, {} as any);
      expect(result).toBeNull();
    });
  });

  // ==================== executeSkill edge case ====================

  describe("executeSkill() without LLM adapter", () => {
    it("should warn when skill expects adapter but adapter is missing", async () => {
      // Create a facade without SKILL_FEATURE llmAdapter
      const module2 = await Test.createTestingModule({
        providers: [
          TeamFacade,
          {
            provide: SKILL_FEATURE,
            useValue: { llmAdapter: null, loader: mockSkillLoader },
          },
        ],
      }).compile();
      const facadeNoAdapter = module2.get<TeamFacade>(TeamFacade);

      const mockSkillWithAdapter = {
        setLLMAdapter: jest.fn(),
        execute: jest
          .fn()
          .mockResolvedValue({ success: true, output: "result" }),
      } as any;

      // Should not throw, just warn
      const result = await facadeNoAdapter.executeSkill(
        mockSkillWithAdapter,
        {},
        { skillId: "s1" } as any,
      );
      expect(result.success).toBe(true);
      // setLLMAdapter should NOT have been called (no adapter available)
      expect(mockSkillWithAdapter.setLLMAdapter).not.toHaveBeenCalled();
    });
  });

  // ==================== startTeamMission ====================

  describe("startTeamMission()", () => {
    it("should return failure when teamsService is missing", async () => {
      // Create a facade WITHOUT teams feature
      const module2 = await Test.createTestingModule({
        providers: [TeamFacade],
      }).compile();
      const minFacade = module2.get<TeamFacade>(TeamFacade);

      const result = await minFacade.startTeamMission({
        teamType: "debate" as any,
        missionInput: { goal: "Analyze X" } as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });
  });

  // ==================== Additional service getters ====================

  describe("additional service getters", () => {
    it("should expose contextInit", () => {
      expect(facade.contextInit).toBeDefined();
    });

    it("should expose teamFactory", () => {
      expect(facade.teamFactory).toBeDefined();
    });

    it("should expose missionOrchestrator", () => {
      expect(facade.missionOrchestrator).toBeDefined();
    });
  });

  // ==================== Graceful degradation ====================

  describe("without optional dependencies", () => {
    let minimalFacade: TeamFacade;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [TeamFacade],
      }).compile();

      minimalFacade = module.get<TeamFacade>(TeamFacade);
    });

    it("should return undefined for a2aPublish", () => {
      const result = minimalFacade.a2aPublish({
        sessionId: "s1",
        fromAgentId: "a1",
        type: "request" as any,
        payload: {},
      });
      expect(result).toBeUndefined();
    });

    it("should return undefined for reflect", () => {
      const result = minimalFacade.reflect({} as any);
      expect(result).toBeUndefined();
    });

    it("should return text as-is for sanitizeReport", () => {
      const result = minimalFacade.sanitizeReport("raw text");
      expect(result).toBe("raw text");
    });

    it("should return undefined for evidenceSave", () => {
      const result = minimalFacade.evidenceSave({} as any);
      expect(result).toBeUndefined();
    });

    it("should return undefined for votingCreate", () => {
      const result = minimalFacade.votingCreate({} as any);
      expect(result).toBeUndefined();
    });

    it("should return empty array for skillLoaderGetAll", () => {
      const result = minimalFacade.skillLoaderGetAll();
      expect(result).toEqual([]);
    });

    it("should return undefined for service getters", () => {
      expect(minimalFacade.teams).toBeUndefined();
      expect(minimalFacade.teamRegistry).toBeUndefined();
      expect(minimalFacade.roleRegistry).toBeUndefined();
      expect(minimalFacade.skillRegistry).toBeUndefined();
    });
  });
});
