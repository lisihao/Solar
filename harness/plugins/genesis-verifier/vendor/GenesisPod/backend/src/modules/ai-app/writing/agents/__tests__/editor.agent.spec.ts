/**
 * Unit tests for EditorAgent
 *
 * Covers:
 * - Agent metadata (id, name, capabilities, supportedModes)
 * - doExecute via execute(): fix_issues, polish, unify_style, final_review
 * - fix_issues with empty issues list (no-op path)
 * - fix_issues with actual issues (sorted by severity)
 * - polish with different polish levels
 * - unify_style with and without targetStyle param
 * - final_review: quick evaluation + quality gate + LLM revision
 * - countWords: Chinese and English content
 * - Unknown operation throws error
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EditorAgent, EditorInput } from "../editor.agent";
import { WritingQualityGateService } from "../../services/quality/quality-gate.service";
import { ChapterQualityEvaluatorService } from "../../services/quality/chapter-quality-evaluator.service";
import type { AgentContext } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";

// ==================== Helpers ====================

function makeAgentContext(): AgentContext {
  return {
    agentId: "editor-agent",
    executionId: "exec-editor-1",
    mode: "reactive",
    metadata: {},
  } as AgentContext;
}

function makeContextPackage(): WritingContextPackage {
  return {
    projectId: "project-1",
    hardConstraints: [{ severity: "error", rule: "No anachronisms" }],
    glossary: {},
    establishedFacts: [
      { statement: "Protagonist is female", importance: "high" },
    ],
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
          sentenceLength: "medium",
        },
        characters: [
          {
            id: "char-1",
            name: "苏清婉",
            role: "protagonist",
            aliases: ["婉儿"],
            definition: "宫廷女官",
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
          id: "chapter-1",
          chapterNumber: 1,
          title: "暴室惊魂",
          outline: "苏清婉发现宫廷阴谋",
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
        overallScore: 80,
        diversityScore: 0.7,
        characterConsistency: 0.85,
      },
      issues: [],
    }),
  };
}

function buildMockChapterQualityEvaluator() {
  return {
    quickEvaluate: jest.fn().mockReturnValue({
      overallScore: 75,
      grade: "B",
      writingQuality: {
        sentenceFluency: { score: 80, issues: [] },
        descriptionVividness: { score: 70, issues: ["描写不够生动"] },
      },
      contentQuality: {
        openingHook: { score: 65, issues: ["开篇不够吸引"] },
        plotProgression: { score: 78, issues: [] },
      },
    }),
  };
}

// ==================== Tests ====================

describe("EditorAgent", () => {
  let agent: EditorAgent;
  let mockQualityGate: ReturnType<typeof buildMockQualityGate>;
  let mockChapterQualityEvaluator: ReturnType<
    typeof buildMockChapterQualityEvaluator
  >;

  const sampleContent =
    "苏清婉站在暴室门前，心中一震。她知道，这一切都是阴谋。".repeat(50);

  beforeEach(async () => {
    mockQualityGate = buildMockQualityGate();
    mockChapterQualityEvaluator = buildMockChapterQualityEvaluator();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditorAgent,
        { provide: WritingQualityGateService, useValue: mockQualityGate },
        {
          provide: ChapterQualityEvaluatorService,
          useValue: mockChapterQualityEvaluator,
        },
      ],
    }).compile();

    agent = module.get<EditorAgent>(EditorAgent);

    // Set up a mock LLM adapter so callLLM works
    agent.setLLMAdapter({
      chat: jest.fn().mockResolvedValue({
        content: "修订后的章节内容。".repeat(100),
        usage: { totalTokens: 200 },
      }),
    } as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Agent Metadata ====================

  describe("agent metadata", () => {
    it("should have correct agent id", () => {
      expect(agent.id).toBe("editor-agent");
    });

    it("should have correct name", () => {
      expect(agent.name).toBe("Editor Agent");
    });

    it("should include issue-fixing capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "issue-fixing");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("editing");
    });

    it("should include text-polishing capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "text-polishing");
      expect(cap).toBeDefined();
    });

    it("should include style-unification capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "style-unification");
      expect(cap).toBeDefined();
    });

    it("should include final-review capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "final-review");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("validation");
    });

    it("should support reactive and hybrid modes", () => {
      expect(agent.supportedModes).toContain("reactive");
      expect(agent.supportedModes).toContain("hybrid");
    });
  });

  // ==================== fix_issues operation ====================

  describe("fix_issues operation", () => {
    it("should return original content when no issues provided", async () => {
      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: { issues: [] },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.revisedContent).toBe(sampleContent);
      expect(result.data?.changes).toHaveLength(0);
      expect(result.data?.stats.fixedIssues).toBe(0);
      expect(result.data?.notes).toContain("无需修复的问题");
    });

    it("should call LLM when issues are provided", async () => {
      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {
          issues: [
            {
              type: "CHARACTER_INCONSISTENCY",
              severity: "CRITICAL",
              description: "角色性格不一致",
              location: "第3段",
              expected: "谨慎",
              found: "鲁莽",
              suggestion: "修改行为描写",
            },
          ],
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("fix_issues");
      expect(result.data?.stats.fixedIssues).toBe(1);
      expect(result.data?.changes).toHaveLength(1);
    });

    it("should sort issues by severity: CRITICAL before WARNING before INFO", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: "修复后内容。".repeat(50),
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {
          issues: [
            {
              type: "STYLE_INCONSISTENCY",
              severity: "INFO",
              description: "风格轻微不一致",
              location: "第1段",
            },
            {
              type: "CHARACTER_INCONSISTENCY",
              severity: "CRITICAL",
              description: "角色性格严重不一致",
              location: "第2段",
            },
            {
              type: "TIMELINE_INCONSISTENCY",
              severity: "WARNING",
              description: "时间线稍有问题",
              location: "第3段",
            },
          ],
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // CRITICAL should appear first in the prompt
      const userPrompt = (
        capturedMessages[0] as Array<{ role: string; content: string }>
      ).find((m) => m.role === "user")?.content;
      const criticalIdx = userPrompt?.indexOf("CRITICAL") ?? -1;
      const warningIdx = userPrompt?.indexOf("WARNING") ?? -1;
      const infoIdx = userPrompt?.indexOf("INFO") ?? -1;
      expect(criticalIdx).toBeLessThan(warningIdx);
      expect(warningIdx).toBeLessThan(infoIdx);
    });

    it("should include leader feedback in prompt when provided", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: "修复内容".repeat(50),
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {
          issues: [
            {
              type: "CHARACTER_INCONSISTENCY",
              severity: "WARNING",
              description: "minor",
              location: "p1",
            },
          ],
          leaderFeedback: "请重点修正角色对话风格",
        },
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const userPrompt = messages.find((m) => m.role === "user")?.content ?? "";
      expect(userPrompt).toContain("请重点修正角色对话风格");
    });

    it("should return correct word count stats", async () => {
      const chineseContent = "苏清婉".repeat(100); // 300 Chinese chars
      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: chineseContent,
        contextPackage: makeContextPackage(),
        params: { issues: [] },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.stats.wordCountBefore).toBe(300);
    });
  });

  // ==================== polish operation ====================

  describe("polish operation", () => {
    it("should return revised content with polish changes", async () => {
      const input: EditorInput = {
        operation: "polish",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: { polishLevel: "moderate" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("polish");
      expect(result.data?.changes).toHaveLength(1);
      expect(result.data?.changes[0].type).toBe("polish");
      expect(result.data?.changes[0].description).toContain("moderate");
    });

    it("should default to moderate polish level when not specified", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: "润色内容".repeat(50),
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: EditorInput = {
        operation: "polish",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      await agent.execute(input, makeAgentContext());

      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt =
        messages.find((m) => m.role === "system")?.content ?? "";
      expect(systemPrompt).toContain("moderate");
    });

    it("should handle light polish level", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: "轻度润色内容".repeat(50),
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: EditorInput = {
        operation: "polish",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: { polishLevel: "light" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt =
        messages.find((m) => m.role === "system")?.content ?? "";
      expect(systemPrompt).toContain("light");
    });

    it("should handle heavy polish level", async () => {
      const input: EditorInput = {
        operation: "polish",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: { polishLevel: "heavy" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.changes[0].description).toContain("heavy");
    });

    it("should return stats with fixedIssues=0 for polish", async () => {
      const input: EditorInput = {
        operation: "polish",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: { polishLevel: "moderate" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.stats.fixedIssues).toBe(0);
      expect(result.data?.stats.totalChanges).toBe(1);
    });
  });

  // ==================== unify_style operation ====================

  describe("unify_style operation", () => {
    it("should return revised content with style unification changes", async () => {
      const input: EditorInput = {
        operation: "unify_style",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("unify_style");
      expect(result.data?.changes[0].type).toBe("style_unification");
    });

    it("should use provided targetStyle params", async () => {
      const capturedMessages: unknown[] = [];
      agent.setLLMAdapter({
        chat: jest
          .fn()
          .mockImplementation((params: { messages: unknown[] }) => {
            capturedMessages.push(params.messages);
            return Promise.resolve({
              content: "统一风格内容".repeat(50),
              usage: { totalTokens: 100 },
            });
          }),
      } as never);

      const input: EditorInput = {
        operation: "unify_style",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {
          targetStyle: {
            vocabulary: "advanced",
            sentenceLength: "long",
          },
        },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      const messages = capturedMessages[0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt =
        messages.find((m) => m.role === "system")?.content ?? "";
      expect(systemPrompt).toContain("advanced");
    });

    it("should set fixedIssues=0 for style unification", async () => {
      const input: EditorInput = {
        operation: "unify_style",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.stats.fixedIssues).toBe(0);
    });
  });

  // ==================== final_review operation ====================

  describe("final_review operation", () => {
    it("should call quickEvaluate from chapterQualityEvaluator", async () => {
      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      await agent.execute(input, makeAgentContext());

      expect(mockChapterQualityEvaluator.quickEvaluate).toHaveBeenCalledWith(
        sampleContent,
        1, // chapterNumber from contextPackage
      );
    });

    it("should call checkQualityGate from qualityGate", async () => {
      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      await agent.execute(input, makeAgentContext());

      expect(mockQualityGate.checkQualityGate).toHaveBeenCalledWith(
        "project-1",
        "chapter-1",
        1,
        sampleContent,
        0,
      );
    });

    it("should return final_review operation in output", async () => {
      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.operation).toBe("final_review");
    });

    it("should include quality score in notes", async () => {
      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      const hasScoreNote = result.data?.notes?.some((n) =>
        n.includes("质量评分"),
      );
      expect(hasScoreNote).toBe(true);
    });

    it("should include quality gate status in notes", async () => {
      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      const hasGateNote = result.data?.notes?.some((n) =>
        n.includes("质量门禁"),
      );
      expect(hasGateNote).toBe(true);
    });

    it("should handle quality gate failure gracefully", async () => {
      mockQualityGate.checkQualityGate.mockRejectedValue(
        new Error("Quality gate service unavailable"),
      );

      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should still succeed even if quality gate fails
      expect(result.success).toBe(true);
    });

    it("should collect issues from quality gate into allIssues", async () => {
      mockQualityGate.checkQualityGate.mockResolvedValue({
        passed: false,
        scores: {
          overallScore: 50,
          diversityScore: 0.3,
          characterConsistency: 0.6,
        },
        issues: [
          {
            type: "diversity",
            severity: "CRITICAL",
            description: "词汇多样性不足",
          },
          {
            type: "character",
            severity: "WARNING",
            description: "角色一致性问题",
          },
        ],
      });

      const input: EditorInput = {
        operation: "final_review",
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      // Issues from quality gate should appear in the stats
      expect(result.data?.stats.fixedIssues).toBeGreaterThan(0);
    });
  });

  // ==================== Unknown operation ====================

  describe("unknown operation", () => {
    it("should return error for unknown operation", async () => {
      const input = {
        operation: "unknown_operation" as EditorInput["operation"],
        chapterId: "chapter-1",
        content: sampleContent,
        contextPackage: makeContextPackage(),
        params: {},
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Unknown operation");
    });
  });

  // ==================== countWords ====================

  describe("countWords (via stats in output)", () => {
    it("should count Chinese characters correctly", async () => {
      const chineseContent = "苏清婉"; // 3 Chinese chars
      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: chineseContent,
        contextPackage: makeContextPackage(),
        params: { issues: [] },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.stats.wordCountBefore).toBe(3);
      expect(result.data?.stats.wordCountAfter).toBe(3);
    });

    it("should count English words correctly", async () => {
      const englishContent = "She stood alone in darkness"; // 5 English words
      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: englishContent,
        contextPackage: makeContextPackage(),
        params: { issues: [] },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.stats.wordCountBefore).toBe(5);
    });

    it("should count mixed Chinese and English content", async () => {
      const mixedContent = "苏清婉 said hello"; // 3 Chinese + 2 English = 5
      const input: EditorInput = {
        operation: "fix_issues",
        chapterId: "chapter-1",
        content: mixedContent,
        contextPackage: makeContextPackage(),
        params: { issues: [] },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.stats.wordCountBefore).toBe(5);
    });
  });

  // ==================== Edge cases ====================

  describe("edge cases", () => {
    it("should return chapterId in all output types", async () => {
      const operations: EditorInput["operation"][] = [
        "fix_issues",
        "polish",
        "unify_style",
        "final_review",
      ];

      for (const operation of operations) {
        const input: EditorInput = {
          operation,
          chapterId: "test-chapter-id",
          content: sampleContent,
          contextPackage: makeContextPackage(),
          params: {},
        };

        const result = await agent.execute(input, makeAgentContext());
        expect(result.data?.chapterId).toBe("test-chapter-id");
      }
    });

    it("should handle empty content gracefully", async () => {
      const input: EditorInput = {
        operation: "polish",
        chapterId: "chapter-1",
        content: "",
        contextPackage: makeContextPackage(),
        params: { polishLevel: "light" },
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.stats.wordCountBefore).toBe(0);
    });
  });
});
