/**
 * Unit tests for StoryArchitectAgent
 *
 * Covers:
 * - Agent metadata (id, name, capabilities, supportedModes)
 * - plan_story: calls LLM, parses storyOutline, returns nextSteps
 * - plan_volume: requires volumeInfo, builds chapter breakdown
 * - decompose_chapters: analyzes chapter dependencies
 * - review_chapter: requires reviewData, calls qualityGate, returns review result
 * - review_chapter: handles quality gate failure gracefully
 * - resolve_conflict: empty conflicts list
 * - resolve_conflict: with conflicts, calls LLM
 * - Unknown taskType throws error
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  StoryArchitectAgent,
  StoryArchitectInput,
} from "../story-architect.agent";
import { WritingQualityGateService } from "../../services/quality/quality-gate.service";
import type { AgentContext } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";

// ==================== Helpers ====================

function makeAgentContext(): AgentContext {
  return {
    agentId: "story-architect",
    executionId: "exec-architect-1",
    mode: "plan-based",
    metadata: {},
  } as AgentContext;
}

function makeContextPackage(
  overrides: Partial<{
    premise: string;
    theme: string;
    tone: string;
    worldType: string;
    characters: WritingContextPackage["extensions"]["storyBible"]["characters"];
  }> = {},
): WritingContextPackage {
  return {
    projectId: "project-arch-1",
    hardConstraints: [
      {
        severity: "error",
        rule: "Protagonist cannot die before final chapter",
      },
    ],
    glossary: {},
    establishedFacts: [
      {
        statement: "The protagonist is a skilled detective",
        importance: "high",
      },
    ],
    extensions: {
      storyBible: {
        projectId: "project-arch-1",
        worldType: overrides.worldType ?? "唐朝",
        premise: overrides.premise ?? "宫廷阴谋与爱情故事",
        theme: overrides.theme ?? "忠诚与背叛",
        tone: overrides.tone ?? "宏大史诗",
        stylePresetId: undefined,
        writingStyle: {
          pov: "third-person",
          tense: "past",
          vocabulary: "formal",
          dialogueStyle: "classical",
          descriptionStyle: "vivid",
        },
        characters: overrides.characters ?? [
          {
            id: "char-1",
            name: "苏清婉",
            type: "character",
            role: "protagonist",
            aliases: ["婉儿"],
            definition: "宫廷女官，聪明谨慎",
          },
          {
            id: "char-2",
            name: "李元昊",
            type: "character",
            role: "antagonist",
            aliases: [],
            definition: "权贵，野心勃勃",
          },
        ],
        terminologies: [],
        worldSettings: [],
        timelineEvents: [],
        factions: [],
        plotPoints: [],
      },
      chapterContext: {
        chapter: {
          id: "chapter-5",
          chapterNumber: 5,
          title: "第五章",
          outline: "危机时刻",
        },
        previousContext: [],
        involvedCharacters: [],
        relevantWorldSettings: [],
        timelineContext: [],
        writingInstructions: {
          targetWordCount: 3000,
          focusPoints: [],
          avoidPoints: [],
          additionalInstructions: "",
        },
      },
    },
  } as unknown as WritingContextPackage;
}

// ==================== Mock factories ====================

function buildMockQualityGate() {
  return {
    checkQualityGate: jest.fn().mockResolvedValue({
      passed: true,
      scores: {
        overallScore: 82,
        diversityScore: 0.72,
        characterConsistency: 0.88,
      },
      issues: [],
    }),
  };
}

// ==================== Tests ====================

describe("StoryArchitectAgent", () => {
  let agent: StoryArchitectAgent;
  let mockQualityGate: ReturnType<typeof buildMockQualityGate>;

  const mockLLMStoryOutline = JSON.stringify({
    premise: "宫廷阴谋与爱情故事",
    theme: "忠诚与背叛",
    structure: [
      {
        volumeNumber: 1,
        title: "入宫风云",
        synopsis: "苏清婉入宫并发现阴谋",
        keyEvents: ["入宫", "初遇权贵", "发现阴谋"],
      },
    ],
  });

  const mockLLMChapterBreakdown = JSON.stringify([
    {
      chapterNumber: 1,
      title: "暴室惊魂",
      outline: "苏清婉被关押暴室",
      involvedCharacters: ["苏清婉"],
      keyEvents: ["入宫"],
      dependsOn: [],
      canParallel: false,
    },
    {
      chapterNumber: 2,
      title: "初入皇宫",
      outline: "适应宫廷生活",
      involvedCharacters: ["苏清婉", "李元昊"],
      keyEvents: ["初遇"],
      dependsOn: ["chapter-1"],
      canParallel: false,
    },
  ]);

  const mockLLMReviewResult = JSON.stringify({
    approved: true,
    feedback: "章节内容符合要求",
    requiredChanges: [],
    newEstablishedFacts: [
      {
        statement: "苏清婉在第五章发现了阴谋",
        category: "sequence_point",
        relatedEntities: ["苏清婉"],
      },
    ],
  });

  const mockLLMConflictResolution = JSON.stringify([
    {
      conflictId: "conflict-1",
      chosenOption: "修改角色行为",
      reasoning: "与 Story Bible 保持一致",
    },
  ]);

  beforeEach(async () => {
    mockQualityGate = buildMockQualityGate();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryArchitectAgent,
        { provide: WritingQualityGateService, useValue: mockQualityGate },
      ],
    }).compile();

    agent = module.get<StoryArchitectAgent>(StoryArchitectAgent);

    // Default LLM adapter - returns story outline JSON
    agent.setLLMAdapter({
      chat: jest.fn().mockResolvedValue({
        content: mockLLMStoryOutline,
        usage: { totalTokens: 300 },
      }),
    } as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Agent Metadata ====================

  describe("agent metadata", () => {
    it("should have correct agent id", () => {
      expect(agent.id).toBe("story-architect");
    });

    it("should have correct name", () => {
      expect(agent.name).toBe("Story Architect");
    });

    it("should include story-planning capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "story-planning");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("planning");
    });

    it("should include task-decomposition capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "task-decomposition");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("orchestration");
    });

    it("should include quality-review capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "quality-review");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("analysis");
    });

    it("should include consistency-supervision capability", () => {
      const cap = agent.capabilities.find(
        (c) => c.id === "consistency-supervision",
      );
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("validation");
    });

    it("should support plan-based and hybrid modes", () => {
      expect(agent.supportedModes).toContain("plan-based");
      expect(agent.supportedModes).toContain("hybrid");
    });
  });

  // ==================== plan_story ====================

  describe("plan_story task", () => {
    it("should return storyOutline from LLM response", async () => {
      const input: StoryArchitectInput = {
        taskType: "plan_story",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          userRequirements: "写一个关于宫廷阴谋的故事",
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.taskType).toBe("plan_story");
      expect(result.data?.result.storyOutline).toBeDefined();
      expect(result.data?.result.storyOutline?.premise).toBe(
        "宫廷阴谋与爱情故事",
      );
    });

    it("should return nextSteps with create volume planning", async () => {
      const input: StoryArchitectInput = {
        taskType: "plan_story",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: { userRequirements: "故事需求" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.nextSteps).toContain("创建各卷详细规划");
    });

    it("should use fallback when LLM returns invalid JSON", async () => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: "这不是JSON格式的回复",
          usage: { totalTokens: 50 },
        }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "plan_story",
        projectId: "project-1",
        contextPackage: makeContextPackage({ premise: "测试前提" }),
        payload: { userRequirements: "测试需求" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // Falls back to premise from storyBible
      expect(result.data?.result.storyOutline?.premise).toBe("测试前提");
    });

    it("should handle empty userRequirements gracefully", async () => {
      const input: StoryArchitectInput = {
        taskType: "plan_story",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
    });

    it("should include characters from storyBible in the LLM prompt", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: mockLLMStoryOutline,
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "plan_story",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: { userRequirements: "包含角色的故事" },
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const userMessage =
        messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMessage).toContain("苏清婉");
    });
  });

  // ==================== plan_volume ====================

  describe("plan_volume task", () => {
    beforeEach(() => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: mockLLMChapterBreakdown,
          usage: { totalTokens: 200 },
        }),
      } as never);
    });

    it("should throw when volumeInfo is missing", async () => {
      const input: StoryArchitectInput = {
        taskType: "plan_volume",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Volume info is required");
    });

    it("should return chapterBreakdown when volumeInfo provided", async () => {
      const input: StoryArchitectInput = {
        taskType: "plan_volume",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          volumeInfo: {
            volumeNumber: 1,
            synopsis: "第一卷：入宫风云",
            targetChapters: 20,
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.taskType).toBe("plan_volume");
      expect(result.data?.result.chapterBreakdown).toBeDefined();
    });

    it("should include target chapters in user prompt", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: mockLLMChapterBreakdown,
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "plan_volume",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          volumeInfo: {
            volumeNumber: 2,
            targetChapters: 25,
          },
        },
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const userMessage =
        messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMessage).toContain("25");
    });

    it("should return nextSteps with chapter writing instruction", async () => {
      const input: StoryArchitectInput = {
        taskType: "plan_volume",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          volumeInfo: { volumeNumber: 1 },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.nextSteps).toContain("开始章节写作");
    });

    it("should fall back to empty array when LLM returns invalid JSON", async () => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: "无效JSON",
          usage: { totalTokens: 50 },
        }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "plan_volume",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          volumeInfo: { volumeNumber: 1 },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.chapterBreakdown).toEqual([]);
    });
  });

  // ==================== decompose_chapters ====================

  describe("decompose_chapters task", () => {
    beforeEach(() => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: mockLLMChapterBreakdown,
          usage: { totalTokens: 200 },
        }),
      } as never);
    });

    it("should return chapterBreakdown with dependency analysis", async () => {
      const input: StoryArchitectInput = {
        taskType: "decompose_chapters",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.taskType).toBe("decompose_chapters");
      expect(result.data?.result.chapterBreakdown).toBeDefined();
    });

    it("should include character list in LLM prompt", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: mockLLMChapterBreakdown,
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "decompose_chapters",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const userMessage =
        messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMessage).toContain("苏清婉");
      expect(userMessage).toContain("李元昊");
    });
  });

  // ==================== review_chapter ====================

  describe("review_chapter task", () => {
    beforeEach(() => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: mockLLMReviewResult,
          usage: { totalTokens: 250 },
        }),
      } as never);
    });

    it("should throw when reviewData is missing", async () => {
      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Review data is required");
    });

    it("should call quality gate check", async () => {
      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          reviewData: {
            chapterId: "chapter-5",
            content: "苏清婉发现了阴谋的真相。".repeat(100),
          },
        },
      };

      await agent.execute(input, makeAgentContext());

      expect(mockQualityGate.checkQualityGate).toHaveBeenCalledWith(
        "project-1",
        "chapter-5",
        5, // chapterNumber from contextPackage
        expect.any(String),
        0,
      );
    });

    it("should return review result with approval status", async () => {
      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          reviewData: {
            chapterId: "chapter-5",
            content: "章节内容".repeat(100),
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.taskType).toBe("review_chapter");
      expect(result.data?.result.reviewResult).toBeDefined();
      expect(result.data?.result.reviewResult?.approved).toBe(true);
    });

    it("should return nextSteps when approved", async () => {
      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          reviewData: {
            chapterId: "chapter-5",
            content: "批准的章节内容".repeat(100),
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.nextSteps).toContain("章节已通过，继续下一章");
    });

    it("should return revision nextStep when not approved", async () => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            approved: false,
            feedback: "需要修改角色一致性问题",
            requiredChanges: ["修正苏清婉的行为描写"],
          }),
          usage: { totalTokens: 100 },
        }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          reviewData: {
            chapterId: "chapter-5",
            content: "有问题的章节内容".repeat(100),
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.nextSteps).toContain("需要修订后重新提交");
    });

    it("should handle quality gate failure gracefully", async () => {
      mockQualityGate.checkQualityGate.mockRejectedValue(
        new Error("Quality service down"),
      );

      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          reviewData: {
            chapterId: "chapter-5",
            content: "章节内容".repeat(100),
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should still succeed even when quality gate fails
      expect(result.success).toBe(true);
    });

    it("should include consistency report issues in review prompt", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: mockLLMReviewResult,
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "review_chapter",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          reviewData: {
            chapterId: "chapter-5",
            content: "章节内容".repeat(50),
            consistencyReport: {
              issues: [
                {
                  type: "CHARACTER",
                  description: "角色行为不一致",
                  severity: "WARNING",
                },
              ],
            },
          },
        },
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const userMessage =
        messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMessage).toContain("角色行为不一致");
    });
  });

  // ==================== resolve_conflict ====================

  describe("resolve_conflict task", () => {
    it("should return empty resolution when no conflicts provided", async () => {
      const input: StoryArchitectInput = {
        taskType: "resolve_conflict",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: { conflicts: [] },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.taskType).toBe("resolve_conflict");
      expect(result.data?.result.conflictResolution).toEqual([]);
    });

    it("should return empty resolution when conflicts is undefined", async () => {
      const input: StoryArchitectInput = {
        taskType: "resolve_conflict",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.conflictResolution).toEqual([]);
    });

    it("should call LLM and return conflict resolution when conflicts provided", async () => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: mockLLMConflictResolution,
          usage: { totalTokens: 150 },
        }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "resolve_conflict",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          conflicts: [
            {
              type: "CHARACTER",
              description: "苏清婉在第3章表现出勇敢，但在第5章又表现为懦弱",
              options: [
                "修改第3章行为",
                "修改第5章行为",
                "保持两章都不变，加入转变原因",
              ],
            },
          ],
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.conflictResolution).toBeDefined();
    });

    it("should include all conflict options in LLM prompt", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: mockLLMConflictResolution,
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "resolve_conflict",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          conflicts: [
            {
              type: "TIMELINE",
              description: "时间线冲突",
              options: ["选项A：调整时间", "选项B：删除事件"],
            },
          ],
        },
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const userMessage =
        messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMessage).toContain("选项A：调整时间");
      expect(userMessage).toContain("选项B：删除事件");
    });

    it("should fall back to empty array when LLM returns invalid JSON", async () => {
      agent.setLLMAdapter({
        chat: jest.fn().mockResolvedValue({
          content: "无法解析",
          usage: { totalTokens: 50 },
        }),
      } as never);

      const input: StoryArchitectInput = {
        taskType: "resolve_conflict",
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {
          conflicts: [
            { type: "CHARACTER", description: "冲突", options: ["选项1"] },
          ],
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.result.conflictResolution).toEqual([]);
    });
  });

  // ==================== Unknown taskType ====================

  describe("unknown taskType", () => {
    it("should return error for unknown taskType", async () => {
      const input = {
        taskType: "unknown_task" as StoryArchitectInput["taskType"],
        projectId: "project-1",
        contextPackage: makeContextPackage(),
        payload: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Unknown task type");
    });
  });
});
