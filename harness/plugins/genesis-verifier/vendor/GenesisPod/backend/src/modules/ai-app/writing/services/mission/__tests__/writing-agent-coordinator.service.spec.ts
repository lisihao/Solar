/**
 * Unit tests for WritingAgentCoordinator
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingAgentCoordinator } from "../writing-agent-coordinator.service";
import { ChatFacade, TeamFacade, TeamRegistry, RoleRegistry } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  StoryArchitectAgent,
  BibleKeeperAgent,
  WriterAgent,
  ConsistencyCheckerAgent,
  EditorAgent,
} from "../../../agents";

function buildMocks() {
  const teamRegistry = {
    registerConfig: jest.fn(),
  };

  const roleRegistry = {
    registerFromConfig: jest.fn(),
  };

  const facade = {
    getAvailableModelsExtended: jest.fn().mockResolvedValue([]),
    teamFactory: {
      createFromId: jest.fn().mockReturnValue({ id: "ai-writing-team" }),
    },
  };

  const storyArchitect = {
    description: "Story Architect description",
    id: "story-architect",
    name: "Story Architect",
  };

  const bibleKeeper = {
    description: "Bible Keeper description",
    id: "bible-keeper",
    name: "Bible Keeper",
  };

  const writer = {
    description: "Writer description",
    id: "writer",
    name: "Writer",
    CORE_WRITING_PRINCIPLES: "Write well",
  };

  const consistencyChecker = {
    description: "Consistency Checker description",
    id: "consistency-checker",
    name: "Consistency Checker",
  };

  const editor = {
    description: "Editor description",
    id: "editor",
    name: "Editor",
  };

  return {
    teamRegistry,
    roleRegistry,
    facade,
    storyArchitect,
    bibleKeeper,
    writer,
    consistencyChecker,
    editor,
  };
}

describe("WritingAgentCoordinator", () => {
  let service: WritingAgentCoordinator;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingAgentCoordinator,
        { provide: TeamRegistry, useValue: mocks.teamRegistry },
        { provide: RoleRegistry, useValue: mocks.roleRegistry },
        { provide: ChatFacade, useValue: mocks.facade },
        { provide: TeamFacade, useValue: mocks.facade },
        {
          provide: StoryArchitectAgent,
          useValue: mocks.storyArchitect,
        },
        {
          provide: BibleKeeperAgent,
          useValue: mocks.bibleKeeper,
        },
        { provide: WriterAgent, useValue: mocks.writer },
        {
          provide: ConsistencyCheckerAgent,
          useValue: mocks.consistencyChecker,
        },
        { provide: EditorAgent, useValue: mocks.editor },
      ],
    }).compile();

    service = module.get<WritingAgentCoordinator>(WritingAgentCoordinator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should register 5 writing roles on initialization", () => {
      expect(mocks.roleRegistry.registerFromConfig).toHaveBeenCalledTimes(5);
    });

    it("should register writing team config on initialization", () => {
      expect(mocks.teamRegistry.registerConfig).toHaveBeenCalledTimes(1);
      const config = mocks.teamRegistry.registerConfig.mock.calls[0][0];
      expect(config.id).toBe("ai-writing-team");
    });
  });

  describe("getAvailableModels", () => {
    it("should call facade with CHAT model type", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([]);

      await service.getAvailableModels();

      expect(mocks.facade.getAvailableModelsExtended).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should exclude xAI models", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt4", name: "GPT-4", provider: "openai", isReasoning: false },
        { id: "grok", name: "Grok", provider: "xAI", isReasoning: false },
      ]);

      const result = await service.getAvailableModels();

      expect(result.some((m) => m.provider === "xAI")).toBe(false);
      expect(result).toHaveLength(1);
    });

    it("should return empty array on facade error", async () => {
      mocks.facade.getAvailableModelsExtended.mockRejectedValue(
        new Error("Network error"),
      );

      const result = await service.getAvailableModels();

      expect(result).toEqual([]);
    });

    it("should cache results for subsequent calls", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt4", name: "GPT-4", provider: "openai", isReasoning: false },
      ]);

      await service.getAvailableModels();
      await service.getAvailableModels();

      expect(mocks.facade.getAvailableModelsExtended).toHaveBeenCalledTimes(1);
    });
  });

  describe("assignModelsToRoles", () => {
    it("should return all inactive roles when no models", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.assignModelsToRoles();

      expect(result).toHaveLength(5);
      result.forEach((r) => expect(r.isActive).toBe(false));
    });

    it("should prefer reasoning model for story-architect", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt4", name: "GPT-4", provider: "openai", isReasoning: false },
        { id: "o1", name: "o1", provider: "openai", isReasoning: true },
      ]);

      const result = await service.assignModelsToRoles();

      const architect = result.find((r) => r.roleId === "story-architect");
      expect(architect?.modelId).toBe("o1");
    });

    it("should return active roles when models available", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt4", name: "GPT-4", provider: "openai", isReasoning: false },
      ]);

      const result = await service.assignModelsToRoles();

      result.forEach((r) => expect(r.isActive).toBe(true));
    });
  });

  describe("getActiveRoles", () => {
    it("should return role IDs for active models", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt4", name: "GPT-4", provider: "openai", isReasoning: false },
      ]);

      const result = await service.getActiveRoles();

      expect(result.length).toBe(5);
      expect(result).toContain("story-architect");
      expect(result).toContain("writer");
    });

    it("should return empty array when no models", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.getActiveRoles();

      expect(result).toHaveLength(0);
    });
  });

  describe("getModelForRole", () => {
    it("should return model ID for valid role", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt4", name: "GPT-4", provider: "openai", isReasoning: false },
      ]);

      const result = await service.getModelForRole("writer");

      expect(result).toBe("gpt4");
    });

    it("should return null when no models available", async () => {
      mocks.facade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.getModelForRole("writer");

      expect(result).toBeNull();
    });
  });

  describe("getWritingTeam", () => {
    it("should create writing team on first call", () => {
      const team = service.getWritingTeam();

      expect(mocks.facade.teamFactory.createFromId).toHaveBeenCalledWith(
        "ai-writing-team",
      );
      expect(team).toBeDefined();
    });

    it("should return same team instance on subsequent calls", () => {
      const team1 = service.getWritingTeam();
      const team2 = service.getWritingTeam();

      expect(mocks.facade.teamFactory.createFromId).toHaveBeenCalledTimes(1);
      expect(team1).toBe(team2);
    });
  });
});
