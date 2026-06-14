/**
 * Unit tests for WritingMissionExecutionService
 *
 * B6: legacy executorMap path removed. Tests now verify the new pipeline
 * delegation path (WritingPipelineDispatcher).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingMissionExecutionService } from "../writing-mission-execution.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade, AgentFacade } from "@/modules/ai-harness/facade";
import { WritingMissionLifecycleService } from "../writing-mission-lifecycle.service";
import { WritingPipelineDispatcher } from "../../../mission/pipeline/writing-pipeline-dispatcher.service";
import type { WritingMissionInput } from "../writing-mission.types";
import type { RoleModelAssignment } from "../writing-model-manager.service";

function buildMockPrisma() {
  return {
    writingMission: {
      update: jest.fn().mockResolvedValue({}),
    },
    writingProject: {
      findUnique: jest.fn().mockResolvedValue({
        id: "project-1",
        name: "Test Project",
        description: "A test project",
        targetWords: 50000,
      }),
    },
  };
}

function buildMockLifecycleService() {
  return {
    setExecutionService: jest.fn(),
    updateMissionProgress: jest.fn().mockResolvedValue(undefined),
    updateMissionRecord: jest.fn().mockResolvedValue(undefined),
    completeKernelProcess: jest.fn(),
    failKernelProcess: jest.fn(),
    getKernelProcessId: jest.fn().mockReturnValue("kernel-process-1"),
  };
}

function buildMockChatFacade() {
  return {
    getDefaultTextModel: jest
      .fn()
      .mockResolvedValue({ modelId: "default-model" }),
  };
}

function buildMockAgentFacade() {
  return {
    startTrace: jest.fn().mockReturnValue("trace-1"),
    addSpan: jest.fn().mockReturnValue("span-1"),
    endSpan: jest.fn(),
    endTrace: jest.fn(),
  };
}

function buildMockDispatcher() {
  return {
    runMission: jest.fn().mockResolvedValue(undefined),
  };
}

describe("WritingMissionExecutionService", () => {
  let service: WritingMissionExecutionService;
  let lifecycleService: ReturnType<typeof buildMockLifecycleService>;
  let dispatcher: ReturnType<typeof buildMockDispatcher>;

  const mockMissionInput: WritingMissionInput = {
    projectId: "project-1",
    missionType: "chapter",
    chapterId: "chapter-1",
    userPrompt: "Write a chapter about a hero's journey",
    targetWordCount: 3000,
  };

  const mockModelAssignments: RoleModelAssignment[] = [
    { roleId: "story-architect", modelId: "model-o1", isActive: true },
    { roleId: "writer", modelId: "model-gpt4", isActive: true },
  ];

  beforeEach(async () => {
    lifecycleService = buildMockLifecycleService();
    dispatcher = buildMockDispatcher();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingMissionExecutionService,
        { provide: PrismaService, useValue: buildMockPrisma() },
        { provide: ChatFacade, useValue: buildMockChatFacade() },
        { provide: AgentFacade, useValue: buildMockAgentFacade() },
        { provide: WritingMissionLifecycleService, useValue: lifecycleService },
        { provide: WritingPipelineDispatcher, useValue: dispatcher },
      ],
    }).compile();

    service = module.get<WritingMissionExecutionService>(
      WritingMissionExecutionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("runMissionInBackground", () => {
    it("should delegate to WritingPipelineDispatcher", async () => {
      await service.runMissionInBackground(
        "mission-1",
        mockMissionInput,
        "user-1",
        mockModelAssignments,
      );

      expect(dispatcher.runMission).toHaveBeenCalledWith(
        "mission-1",
        mockMissionInput,
        "user-1",
        "project-1",
      );
    });

    it("should mark mission failed when dispatcher is not injected", async () => {
      // Create a service instance without the dispatcher
      const moduleWithoutDispatcher: TestingModule =
        await Test.createTestingModule({
          providers: [
            WritingMissionExecutionService,
            { provide: PrismaService, useValue: buildMockPrisma() },
            { provide: ChatFacade, useValue: buildMockChatFacade() },
            { provide: AgentFacade, useValue: buildMockAgentFacade() },
            {
              provide: WritingMissionLifecycleService,
              useValue: lifecycleService,
            },
          ],
        }).compile();

      const serviceWithoutDispatcher =
        moduleWithoutDispatcher.get<WritingMissionExecutionService>(
          WritingMissionExecutionService,
        );

      await serviceWithoutDispatcher.runMissionInBackground(
        "mission-1",
        mockMissionInput,
        "user-1",
        mockModelAssignments,
      );

      expect(lifecycleService.failKernelProcess).toHaveBeenCalledWith(
        "mission-1",
        expect.stringContaining("WritingPipelineDispatcher not injected"),
      );
    });

    it("should not throw when dispatcher.runMission rejects", async () => {
      dispatcher.runMission.mockRejectedValueOnce(new Error("pipeline error"));

      await expect(
        service.runMissionInBackground(
          "mission-1",
          mockMissionInput,
          "user-1",
          mockModelAssignments,
        ),
      ).resolves.not.toThrow();
    });
  });
});
