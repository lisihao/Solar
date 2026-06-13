/**
 * Unit tests for WriterAgent
 *
 * Covers:
 * - Agent metadata (id, name, capabilities)
 * - doExecute happy path: generates content, counts words, extracts metadata
 * - Quality service validation (missing service throws)
 * - buildQualityConstraints: narrative craft, expression memory, personality, historical, etc.
 * - Continuation logic: triggers when word count < 85% target
 * - cleanChapterTitle: strips various chapter title formats
 * - countWords: Chinese + English mixed
 * - identifyCheckpoints: character and terminology detection
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WriterAgent, WriterInput } from "../writer.agent";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ExpressionMemoryService } from "../../services/quality/expression-memory.service";
import { CharacterPersonalityService } from "../../services/quality/character-personality.service";
import { HistoricalKnowledgeService } from "../../services/quality/historical-knowledge.service";
import { ProfessionalVoiceService } from "../../services/quality/professional-voice.service";
import { SensoryImmersionService } from "../../services/quality/sensory-immersion.service";
import { OpeningHookService } from "../../services/quality/opening-hook.service";
import { NarrativeCraftService } from "../../services/quality/narrative-craft.service";
import { ForeshadowingService } from "../../services/quality/foreshadowing.service";
import { PacingControlService } from "../../services/quality/pacing-control.service";
import { DialogueConstraintsService } from "../../services/quality/dialogue-constraints.service";
import { CharacterConsistencyService } from "../../services/quality/character-consistency.service";
import type { AgentContext } from "@/modules/ai-harness/facade";
import type {
  WritingContextPackage,
  ChapterWritingContext,
} from "../../interfaces/writing-context.interface";

// ==================== Helpers ====================

function makeAgentContext(): AgentContext {
  return {
    agentId: "writer-agent",
    executionId: "exec-1",
    mode: "reactive",
    metadata: {},
  } as AgentContext;
}

/**
 * Minimal WritingContextPackage for tests
 */
function makeContextPackage(
  overrides: Partial<WritingContextPackage["extensions"]["storyBible"]> = {},
): WritingContextPackage {
  return {
    projectId: "project-1",
    hardConstraints: [{ severity: "error", rule: "No modern slang" }],
    glossary: { 长安: "Ancient Tang capital" },
    establishedFacts: [
      { statement: "Protagonist is female", importance: "high" },
    ],
    extensions: {
      storyBible: {
        projectId: "project-1",
        worldType: "唐朝",
        stylePresetId: undefined,
        writingStyle: {
          pov: "第三人称限定",
          tense: "过去时",
          vocabulary: "intermediate",
          dialogueStyle: "自然流畅",
          descriptionStyle: "细腻生动",
        },
        characters: [
          {
            id: "char-1",
            name: "苏清婉",
            aliases: ["婉儿"],
          },
        ],
        terminologies: [
          { term: "太医院", definition: "Imperial medical office" },
        ],
        ...overrides,
      } as WritingContextPackage["extensions"]["storyBible"],
    },
  } as unknown as WritingContextPackage;
}

function makeChapterContext(
  overrides: Partial<ChapterWritingContext> = {},
): ChapterWritingContext {
  return {
    chapter: {
      id: "chapter-1",
      chapterNumber: 1,
      title: "暴室惊魂",
      outline: "苏清婉发现宫廷阴谋",
    },
    previousContext: [],
    involvedCharacters: [
      {
        id: "char-1",
        name: "苏清婉",
        role: "protagonist",
        background: "宫廷女官",
        aliases: ["婉儿"],
        appearance: {
          gender: "female",
          hair: "乌黑",
          eyes: "黑",
        },
        personality: {
          traits: ["聪明", "谨慎"],
          speechPattern: "含蓄、措辞讲究",
        },
        currentState: {
          state: {
            location: "暴室",
            condition: "正常",
            mood: "警觉",
          },
        },
        abilities: [],
      },
    ],
    relevantWorldSettings: [
      { name: "暴室", category: "location", description: "宫廷女犯关押之所" },
    ],
    timelineContext: [
      {
        storyTime: "开元十年春",
        eventName: "入宫",
        description: "苏清婉入宫为女官",
        importance: 5,
      },
    ],
    writingInstructions: {
      targetWordCount: 3000,
      focusPoints: ["心理活动", "环境描写"],
      avoidPoints: [],
      additionalInstructions: "",
    },
    ...overrides,
  } as unknown as ChapterWritingContext;
}

// ==================== Mock Services ====================

function buildMockFacade() {
  return {
    chatWithSkills: jest.fn().mockResolvedValue({
      content: "苏清婉站在暴室门前".repeat(300), // ~3000+ chars
      tokensUsed: 1500,
    }),
  };
}

function buildMockExpressionMemory() {
  return {
    generateAvoidancePrompt: jest.fn().mockResolvedValue("avoid: 心中一震"),
  };
}

function buildMockCharacterPersonality() {
  return {
    getPersonalityConstraints: jest.fn().mockResolvedValue([
      {
        characterId: "char-1",
        characterName: "苏清婉",
        speechPatterns: ["确实", "想来"],
        vocabularyLevel: "formal",
        emotionalTendency: ["内敛"],
        tabooWords: ["哎呀"],
        catchphrases: [],
        dialogueExamples: [],
      },
    ]),
    generateConstraintPrompt: jest
      .fn()
      .mockReturnValue("personality-constraints"),
  };
}

function buildMockHistoricalKnowledge() {
  return {
    detectDynastyFromWorldType: jest.fn().mockReturnValue("唐"),
    generateHistoricalConstraintPrompt: jest
      .fn()
      .mockResolvedValue("historical-constraints"),
    getSupportedDynasties: jest.fn().mockReturnValue(["唐", "宋", "明"]),
  };
}

function buildMockProfessionalVoice() {
  return {
    generateChapterVoiceConstraints: jest
      .fn()
      .mockReturnValue("voice-constraints"),
  };
}

function buildMockSensoryImmersion() {
  return {
    generateImmersionConstraints: jest
      .fn()
      .mockReturnValue("immersion-constraints"),
  };
}

function buildMockOpeningHook() {
  return {
    generateOpeningConstraints: jest
      .fn()
      .mockReturnValue("opening-constraints"),
  };
}

function buildMockNarrativeCraft() {
  return {
    generateNarrativeCraftConstraints: jest
      .fn()
      .mockReturnValue("narrative-constraints"),
    analyzeContent: jest
      .fn()
      .mockReturnValue({ passed: true, score: 0.9, issues: [] }),
    rewriteEnding: jest.fn().mockResolvedValue("rewritten-content"),
  };
}

function buildMockForeshadowing() {
  return {
    generateForeshadowingGuidance: jest.fn().mockReturnValue({
      constraintPrompt: "foreshadowing-constraints",
    }),
  };
}

function buildMockPacingControl() {
  return {
    generatePacingConstraints: jest.fn().mockReturnValue("pacing-constraints"),
  };
}

function buildMockDialogueConstraints() {
  return {
    generateDialectConstraintPrompt: jest
      .fn()
      .mockResolvedValue("dialect-constraints"),
    generateCharacterDialoguePrompt: jest
      .fn()
      .mockResolvedValue("char-dialogue-constraints"),
  };
}

function buildMockCharacterConsistency() {
  return {
    generateCharacterBehaviorConstraints: jest.fn().mockResolvedValue({
      constraints: ["must not be cowardly"],
    }),
    formatBehaviorConstraintsAsPrompt: jest
      .fn()
      .mockReturnValue("behavior-constraints"),
  };
}

// ==================== Tests ====================

describe("WriterAgent", () => {
  let agent: WriterAgent;
  let mockFacade: ReturnType<typeof buildMockFacade>;
  let mockExpressionMemory: ReturnType<typeof buildMockExpressionMemory>;
  let mockCharacterPersonality: ReturnType<
    typeof buildMockCharacterPersonality
  >;
  let mockHistoricalKnowledge: ReturnType<typeof buildMockHistoricalKnowledge>;
  let mockNarrativeCraft: ReturnType<typeof buildMockNarrativeCraft>;

  beforeEach(async () => {
    mockFacade = buildMockFacade();
    mockExpressionMemory = buildMockExpressionMemory();
    mockCharacterPersonality = buildMockCharacterPersonality();
    mockHistoricalKnowledge = buildMockHistoricalKnowledge();
    mockNarrativeCraft = buildMockNarrativeCraft();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WriterAgent,
        { provide: ChatFacade, useValue: mockFacade },
        { provide: ExpressionMemoryService, useValue: mockExpressionMemory },
        {
          provide: CharacterPersonalityService,
          useValue: mockCharacterPersonality,
        },
        {
          provide: HistoricalKnowledgeService,
          useValue: mockHistoricalKnowledge,
        },
        {
          provide: ProfessionalVoiceService,
          useValue: buildMockProfessionalVoice(),
        },
        {
          provide: SensoryImmersionService,
          useValue: buildMockSensoryImmersion(),
        },
        { provide: OpeningHookService, useValue: buildMockOpeningHook() },
        { provide: NarrativeCraftService, useValue: mockNarrativeCraft },
        { provide: ForeshadowingService, useValue: buildMockForeshadowing() },
        { provide: PacingControlService, useValue: buildMockPacingControl() },
        {
          provide: DialogueConstraintsService,
          useValue: buildMockDialogueConstraints(),
        },
        {
          provide: CharacterConsistencyService,
          useValue: buildMockCharacterConsistency(),
        },
      ],
    }).compile();

    agent = module.get<WriterAgent>(WriterAgent);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Agent Metadata ====================

  describe("agent metadata", () => {
    it("should have correct agent id", () => {
      expect(agent.id).toBe("writer-agent");
    });

    it("should have correct name", () => {
      expect(agent.name).toBe("Writer Agent");
    });

    it("should include chapter-writing capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "chapter-writing");
      expect(cap).toBeDefined();
      expect(cap?.category).toBe("generation");
    });

    it("should include quality-control capability", () => {
      const cap = agent.capabilities.find((c) => c.id === "quality-control");
      expect(cap).toBeDefined();
    });

    it("should support reactive and hybrid modes", () => {
      expect(agent.supportedModes).toContain("reactive");
      expect(agent.supportedModes).toContain("hybrid");
    });

    it("should require TEXT_GENERATION tool", () => {
      expect(agent.requiredTools).toContain("text-generation");
    });
  });

  // ==================== execute (happy path) ====================

  describe("execute (happy path)", () => {
    it("should return WriterOutput with content and wordCount", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.chapterId).toBe("chapter-1");
      expect(result.data?.content).toBeTruthy();
      expect(result.data?.wordCount).toBeGreaterThan(0);
    });

    it("should call chatWithSkills for content generation", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(mockFacade.chatWithSkills).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: "writing",
          taskProfile: expect.objectContaining({ creativity: "high" }),
        }),
      );
    });

    it("should include metadata with involvedCharacters", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.metadata.involvedCharacters).toContain("苏清婉");
    });

    it("should extract timeline storyTime into metadata", async () => {
      const chapterContext = makeChapterContext();
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext,
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.metadata.storyTime).toBe("开元十年春");
    });

    it("should return checkpoints for characters mentioned in content", async () => {
      // Content includes character name 苏清婉 (repeated in mock response)
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      const charCheckpoint = result.data?.checkpoints.find(
        (cp) => cp.type === "character_mention",
      );
      expect(charCheckpoint).toBeDefined();
    });
  });

  // ==================== Quality Constraint Building ====================

  describe("buildQualityConstraints", () => {
    it("should call generateAvoidancePrompt from expressionMemory", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(mockExpressionMemory.generateAvoidancePrompt).toHaveBeenCalledWith(
        "project-1",
        1, // chapterNumber
      );
    });

    it("should call getPersonalityConstraints for involved characters", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(
        mockCharacterPersonality.getPersonalityConstraints,
      ).toHaveBeenCalledWith("project-1", ["苏清婉"]);
    });

    it("should detect dynasty and generate historical constraints", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage({ worldType: "唐朝" }),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(
        mockHistoricalKnowledge.detectDynastyFromWorldType,
      ).toHaveBeenCalledWith("唐朝");
      expect(
        mockHistoricalKnowledge.generateHistoricalConstraintPrompt,
      ).toHaveBeenCalledWith("唐");
    });

    it("should skip historical constraints when dynasty not detected", async () => {
      mockHistoricalKnowledge.detectDynastyFromWorldType.mockReturnValue(null);

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage({ worldType: "modern-world" }),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(
        mockHistoricalKnowledge.generateHistoricalConstraintPrompt,
      ).not.toHaveBeenCalled();
    });

    it("should call generateNarrativeCraftConstraints (highest priority)", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(
        mockNarrativeCraft.generateNarrativeCraftConstraints,
      ).toHaveBeenCalled();
    });

    it("should still execute when narrative craft throws (non-critical)", async () => {
      mockNarrativeCraft.generateNarrativeCraftConstraints.mockImplementation(
        () => {
          throw new Error("narrative service unavailable");
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should still succeed despite narrative craft failure
      expect(result.success).toBe(true);
    });

    it("should propagate error when expressionMemory throws (critical)", async () => {
      mockExpressionMemory.generateAvoidancePrompt.mockRejectedValue(
        new Error("expression memory DB down"),
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      // expressionMemory error is re-thrown, execute wraps it
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("expression memory DB down");
    });

    it("should build timeline constraints when chapter has important events", async () => {
      const chapterContext = makeChapterContext({
        timelineContext: [
          {
            storyTime: "正月初一",
            eventName: "宴席事件",
            description: "皇帝在宴席上晕倒",
            importance: 5,
          },
          {
            storyTime: "正月初二",
            eventName: "普通事件",
            description: "日常巡逻",
            importance: 1, // Below threshold of 3 — should be excluded
          },
        ] as ChapterWritingContext["timelineContext"],
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext,
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should still succeed with timeline constraint in system prompt
      expect(result.success).toBe(true);
    });
  });

  // ==================== System Prompt Building ====================

  describe("buildWriterSystemPrompt", () => {
    it("should include SUPER_CONSTRAINTS_HEADER in system prompt", async () => {
      const capturedMessages: unknown[] = [];
      mockFacade.chatWithSkills.mockImplementation(
        (params: { messages: unknown[] }) => {
          // The system prompt is in skillContext.systemPrompt
          capturedMessages.push(params);
          return Promise.resolve({
            content: "内容".repeat(1000),
            tokensUsed: 100,
          });
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      // Verify chatWithSkills was called with skillContext containing systemPrompt
      const callArgs = mockFacade.chatWithSkills.mock.calls[0][0] as {
        skillContext: { systemPrompt: string };
      };
      expect(callArgs.skillContext.systemPrompt).toContain("绝对禁止");
    });

    it("should embed glossary into system prompt", async () => {
      let capturedSystemPrompt = "";
      mockFacade.chatWithSkills.mockImplementation(
        (params: { skillContext: { systemPrompt: string } }) => {
          capturedSystemPrompt = params.skillContext?.systemPrompt ?? "";
          return Promise.resolve({
            content: "内容".repeat(1000),
            tokensUsed: 100,
          });
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(capturedSystemPrompt).toContain("长安");
    });
  });

  // ==================== Chapter Prompt Building ====================

  describe("buildChapterPrompt", () => {
    it("should include chapter number and title in user prompt", async () => {
      const capturedUserPrompts: string[] = [];
      mockFacade.chatWithSkills.mockImplementation(
        (params: { messages: Array<{ role: string; content: string }> }) => {
          capturedUserPrompts.push(params.messages[0].content);
          return Promise.resolve({
            content: "内容".repeat(1000),
            tokensUsed: 100,
          });
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(capturedUserPrompts[0]).toContain("第1章");
      expect(capturedUserPrompts[0]).toContain("暴室惊魂");
    });

    it("should include target word count requirement in user prompt", async () => {
      const capturedUserPrompts: string[] = [];
      mockFacade.chatWithSkills.mockImplementation(
        (params: { messages: Array<{ role: string; content: string }> }) => {
          capturedUserPrompts.push(params.messages[0].content);
          return Promise.resolve({
            content: "内容".repeat(1000),
            tokensUsed: 100,
          });
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      expect(capturedUserPrompts[0]).toContain("3000");
    });
  });

  // ==================== cleanChapterTitle ====================

  describe("cleanChapterTitle (via doExecute)", () => {
    const testCases = [
      { title: "第一章 暴室惊魂\n正文内容", expected: "正文内容" },
      { title: "## 第二章 危局\n正文内容", expected: "正文内容" },
      { title: "### 第三章：转折\n正文内容", expected: "正文内容" },
      { title: "## Chapter 1: Prologue\n正文内容", expected: "正文内容" },
      { title: "正文内容（无标题）", expected: "正文内容（无标题）" },
    ];

    for (const { title } of testCases) {
      it(`should strip title format: "${title.slice(0, 30)}..."`, async () => {
        mockFacade.chatWithSkills.mockResolvedValue({
          content: title,
          tokensUsed: 100,
        });

        const chapterContext = makeChapterContext({
          writingInstructions: {
            targetWordCount: 1, // low target so no continuation needed
          } as ChapterWritingContext["writingInstructions"],
        });

        const input: WriterInput = {
          chapterId: "chapter-1",
          contextPackage: makeContextPackage(),
          chapterContext,
        };

        const result = await agent.execute(input, makeAgentContext());

        expect(result.success).toBe(true);
        expect(result.data?.content).not.toContain("第一章");
        expect(result.data?.content).not.toContain("Chapter 1:");
      });
    }
  });

  // ==================== Word continuation ====================

  describe("word count continuation", () => {
    it("should trigger continuation when content is below 85% of target", async () => {
      // First call returns ~40 chars (far below 3000 * 0.85 = 2550)
      // Second call returns enough content (4000+ chars) to satisfy the threshold
      mockFacade.chatWithSkills
        .mockResolvedValueOnce({
          content: "内容不足".repeat(10),
          tokensUsed: 10,
        })
        .mockResolvedValueOnce({
          content: "续写内容".repeat(1000),
          tokensUsed: 500,
        });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 3000,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      await agent.execute(input, makeAgentContext());

      // chatWithSkills called exactly twice (initial + one continuation that fills the gap)
      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(2);
    });

    it("should attempt continuation at most 2 times", async () => {
      // All calls return insufficient content
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "少量内容",
        tokensUsed: 10,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 3000,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      await agent.execute(input, makeAgentContext());

      // 1 initial + max 2 continuation attempts = 3 total
      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(3);
    });

    it("should run narrative craft check on continuation content", async () => {
      mockNarrativeCraft.analyzeContent.mockReturnValue({
        passed: false,
        score: 0.3,
        issues: [{ match: "而这一切，只是开始", type: "preview_ending" }],
      });

      mockFacade.chatWithSkills
        .mockResolvedValueOnce({
          content: "内容不足".repeat(10),
          tokensUsed: 10,
        })
        .mockResolvedValueOnce({
          content: "续写内容而这一切，只是开始".repeat(20),
          tokensUsed: 200,
        });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 3000,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      await agent.execute(input, makeAgentContext());

      expect(mockNarrativeCraft.analyzeContent).toHaveBeenCalled();
      expect(mockNarrativeCraft.rewriteEnding).toHaveBeenCalled();
    });

    it("should not trigger continuation when content meets 85% threshold", async () => {
      // 3000 * 0.85 = 2550 minimum; return enough Chinese chars
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "内容".repeat(2000), // 4000 Chinese chars >> 2550
        tokensUsed: 500,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      await agent.execute(input, makeAgentContext());

      // Only the initial call, no continuation
      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== countWords ====================

  describe("countWords (via wordCount in output)", () => {
    it("should count Chinese characters correctly", async () => {
      const chineseContent = "苏清婉站在殿前"; // 7 Chinese chars
      mockFacade.chatWithSkills.mockResolvedValue({
        content: chineseContent,
        tokensUsed: 10,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 1,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.wordCount).toBe(7);
    });

    it("should count English words correctly", async () => {
      const englishContent = "She stood alone"; // 3 English words
      mockFacade.chatWithSkills.mockResolvedValue({
        content: englishContent,
        tokensUsed: 10,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 1,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.wordCount).toBe(3);
    });

    it("should handle mixed Chinese and English content", async () => {
      const mixedContent = "苏清婉 said hello"; // 3 Chinese + 2 English
      mockFacade.chatWithSkills.mockResolvedValue({
        content: mixedContent,
        tokensUsed: 10,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 1,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.wordCount).toBe(5);
    });
  });

  // ==================== identifyCheckpoints ====================

  describe("identifyCheckpoints", () => {
    it("should detect character aliases in content", async () => {
      // Content must mention both char name AND alias for alias_usage checkpoint to trigger
      // (alias is only checked when char.name is already found in content)
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "苏清婉（婉儿）站在长廊末端".repeat(100),
        tokensUsed: 100,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      const aliasCheckpoint = result.data?.checkpoints.find(
        (cp) => cp.type === "alias_usage",
      );
      expect(aliasCheckpoint).toBeDefined();
    });

    it("should detect terminology usage", async () => {
      // Content mentions 太医院
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "她去太医院求诊".repeat(100),
        tokensUsed: 100,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      const termCheckpoint = result.data?.checkpoints.find(
        (cp) => cp.type === "terminology_usage",
      );
      expect(termCheckpoint).toBeDefined();
    });

    it("should limit checkpoints to 20", async () => {
      // Create context with many characters and terminologies
      const contextPackage = makeContextPackage({
        characters: Array.from({ length: 25 }, (_, i) => ({
          id: `char-${i}`,
          name: `角色${i}`,
          aliases: [],
        })),
        terminologies: Array.from({ length: 25 }, (_, i) => ({
          term: `术语${i}`,
          definition: `definition ${i}`,
        })),
      } as Partial<WritingContextPackage["extensions"]["storyBible"]>);

      // Content mentions all characters and terminologies
      const content = Array.from(
        { length: 25 },
        (_, i) => `角色${i}和术语${i}`,
      ).join("，");
      mockFacade.chatWithSkills.mockResolvedValue({
        content: content.repeat(10),
        tokensUsed: 200,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage,
        chapterContext: makeChapterContext(),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.data?.checkpoints.length).toBeLessThanOrEqual(20);
    });
  });

  // ==================== Character Constraints ====================

  describe("buildCharacterConstraints (via formatCharacterForPrompt)", () => {
    it("should add constraint for injured character", async () => {
      const chapterContext = makeChapterContext({
        involvedCharacters: [
          {
            id: "char-1",
            name: "苏清婉",
            role: "protagonist",
            currentState: {
              state: {
                condition: "受伤严重",
                location: "暴室",
              },
            },
            appearance: {},
            personality: { traits: [], speechPattern: "" },
            abilities: [],
          },
        ] as ChapterWritingContext["involvedCharacters"],
      });

      mockFacade.chatWithSkills.mockImplementation(
        (_params: { skillContext: { systemPrompt: string } }) => {
          return Promise.resolve({
            content: "内容".repeat(1000),
            tokensUsed: 100,
          });
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext,
      };

      await agent.execute(input, makeAgentContext());

      // The system prompt user message should mention injury constraint
      const userPromptCall = mockFacade.chatWithSkills.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      };
      expect(userPromptCall.messages[0].content).toContain("受伤");
    });

    it("should add speechPattern constraint when character has speech pattern", async () => {
      const chapterContext = makeChapterContext({
        involvedCharacters: [
          {
            id: "char-1",
            name: "苏清婉",
            role: "protagonist",
            personality: {
              traits: ["聪明"],
              speechPattern: "含蓄委婉，措辞讲究",
            },
            currentState: { state: {} },
            appearance: {},
            abilities: [],
          },
        ] as ChapterWritingContext["involvedCharacters"],
        // Use a small target word count so the initial content is sufficient and no continuation happens
        writingInstructions: {
          targetWordCount: 100,
          focusPoints: [],
          avoidPoints: [],
          additionalInstructions: "",
        } as ChapterWritingContext["writingInstructions"],
      });

      // Capture only the FIRST call's user prompt by recording all calls
      const capturedUserPrompts: string[] = [];
      mockFacade.chatWithSkills.mockImplementation(
        (params: { messages: Array<{ content: string }> }) => {
          capturedUserPrompts.push(params.messages[0].content);
          return Promise.resolve({
            content: "内容".repeat(1000),
            tokensUsed: 100,
          });
        },
      );

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext,
      };

      await agent.execute(input, makeAgentContext());

      // The speech pattern should appear in the initial chapter prompt (first call)
      expect(capturedUserPrompts[0]).toContain("含蓄委婉");
    });
  });

  // ==================== Dynamic maxTokens ====================

  describe("dynamic maxTokens based on target word count", () => {
    it("should use extended output length for large target word count (>=5000)", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 6000,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      await agent.execute(input, makeAgentContext());

      const callArgs = mockFacade.chatWithSkills.mock.calls[0][0] as {
        taskProfile: { outputLength: string };
      };
      expect(callArgs.taskProfile.outputLength).toBe("extended");
    });

    it("should use long output length for standard target word count (<5000)", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 3000,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      await agent.execute(input, makeAgentContext());

      const callArgs = mockFacade.chatWithSkills.mock.calls[0][0] as {
        taskProfile: { outputLength: string };
      };
      expect(callArgs.taskProfile.outputLength).toBe("long");
    });
  });

  // ==================== Edge cases ====================

  describe("edge cases", () => {
    it("should handle empty previous context gracefully", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({ previousContext: [] }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
    });

    it("should handle chapter with no involved characters", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({ involvedCharacters: [] }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(
        mockCharacterPersonality.getPersonalityConstraints,
      ).not.toHaveBeenCalled();
    });

    it("should handle chapter with no timeline context", async () => {
      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({ timelineContext: [] }),
      };

      const result = await agent.execute(input, makeAgentContext());

      expect(result.success).toBe(true);
      expect(result.data?.metadata.storyTime).toBeUndefined();
    });

    it("should handle LLM returning empty content", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "",
        tokensUsed: 0,
      });

      const input: WriterInput = {
        chapterId: "chapter-1",
        contextPackage: makeContextPackage(),
        chapterContext: makeChapterContext({
          writingInstructions: {
            targetWordCount: 1,
          } as ChapterWritingContext["writingInstructions"],
        }),
      };

      const result = await agent.execute(input, makeAgentContext());

      // Should still return output with empty content
      expect(result.success).toBe(true);
      expect(result.data?.wordCount).toBe(0);
    });
  });
});
