/**
 * ReportSynthesisEngine Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportSynthesisEngine } from "../report-synthesis.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("ReportSynthesisEngine", () => {
  let service: ReportSynthesisEngine;
  let mockFacade: { chat: jest.Mock };

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn().mockResolvedValue({
        content: "Generated section content here.",
        tokensUsed: 100,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportSynthesisEngine,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ReportSynthesisEngine>(ReportSynthesisEngine);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ===================== generateSection =====================

  describe("generateSection", () => {
    it("should generate a section using facade.chat", async () => {
      const result = await service.generateSection("Write about AI trends", []);
      expect(result).toBeTruthy();
      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user" }),
          ]),
        }),
      );
    });

    it("should include source context when sources provided", async () => {
      const sources = [
        {
          id: 1,
          title: "AI Research 2024",
          url: "https://example.com/ai",
          snippet: "AI is transforming industries",
          domain: "example.com",
          publishedDate: "2024-01-01",
          accessedAt: new Date(),
        },
      ];

      await service.generateSection("Analyze AI impact", sources);

      const chatCall = mockFacade.chat.mock.calls[0][0];
      expect(chatCall.messages[0].content).toContain("AI Research 2024");
      expect(chatCall.messages[0].content).toContain("参考来源");
    });

    it("should apply custom creativity config", async () => {
      await service.generateSection("Write section", [], {
        creativity: "high",
      });

      const chatCall = mockFacade.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.creativity).toBe("high");
    });

    it("should sanitize the returned content", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: "```markdown\nSome content\n```",
        tokensUsed: 50,
      });

      const result = await service.generateSection("Test prompt", []);
      // sanitizeReport should strip markdown code block wrapper
      expect(result).not.toContain("```markdown");
    });

    it("should handle empty sources array", async () => {
      const result = await service.generateSection(
        "Prompt with no sources",
        [],
      );
      expect(result).toBeDefined();
    });
  });

  // ===================== checkConsistency =====================

  describe("checkConsistency", () => {
    it("should return consistent result for single section (no check needed)", async () => {
      const result = await service.checkConsistency([
        { title: "Section 1", content: "Content here" },
      ]);

      expect(result.isConsistent).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.issues).toHaveLength(0);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should return consistent result for empty sections", async () => {
      const result = await service.checkConsistency([]);
      expect(result.isConsistent).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it("should call LLM for multiple sections", async () => {
      const consistencyResponse = JSON.stringify({
        isConsistent: true,
        score: 0.9,
        issues: [],
        suggestions: ["Good consistency"],
      });
      mockFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${consistencyResponse}\n\`\`\``,
        tokensUsed: 150,
      });

      const sections = [
        { title: "Section 1", content: "Content about topic A" },
        { title: "Section 2", content: "Content about topic B" },
      ];

      const result = await service.checkConsistency(sections);
      expect(mockFacade.chat).toHaveBeenCalled();
      expect(result.isConsistent).toBe(true);
      expect(result.score).toBe(0.9);
    });

    it("should parse consistency issues from LLM response", async () => {
      const consistencyResponse = JSON.stringify({
        isConsistent: false,
        score: 0.6,
        issues: [
          {
            type: "contradiction",
            severity: "high",
            location: "章节1与章节2",
            description: "Contradictory claims",
            suggestedFix: "Review section 1",
          },
        ],
        suggestions: ["Fix contradictions"],
      });
      mockFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${consistencyResponse}\n\`\`\``,
        tokensUsed: 200,
      });

      const sections = [
        { title: "S1", content: "Claim A is true" },
        { title: "S2", content: "Claim A is false" },
      ];

      const result = await service.checkConsistency(sections);
      expect(result.isConsistent).toBe(false);
      expect(result.score).toBe(0.6);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe("contradiction");
      expect(result.issues[0].severity).toBe("high");
      expect(result.suggestions).toEqual(["Fix contradictions"]);
    });

    it("should handle LLM failure gracefully", async () => {
      mockFacade.chat.mockRejectedValueOnce(new Error("LLM unavailable"));

      const sections = [
        { title: "S1", content: "Content 1" },
        { title: "S2", content: "Content 2" },
      ];

      const result = await service.checkConsistency(sections);
      expect(result.isConsistent).toBe(true);
      expect(result.score).toBe(0.5);
      expect(result.suggestions[0]).toContain("一致性检查失败");
    });

    it("should clamp score to 0-1 range", async () => {
      const consistencyResponse = JSON.stringify({
        isConsistent: true,
        score: 1.5, // Out of bounds
        issues: [],
        suggestions: [],
      });
      mockFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${consistencyResponse}\n\`\`\``,
        tokensUsed: 50,
      });

      const sections = [
        { title: "S1", content: "Content 1" },
        { title: "S2", content: "Content 2" },
      ];

      const result = await service.checkConsistency(sections);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });
  });

  // ===================== buildCitations =====================

  describe("buildCitations", () => {
    const sources = [
      {
        id: 1,
        title: "Research Paper Alpha",
        url: "https://alpha.com/paper",
        domain: "alpha.com",
        publishedDate: "2024-01",
        accessedAt: new Date("2024-06-15"),
      },
      {
        id: 2,
        title: "Industry Report Beta",
        url: "https://beta.org/report",
        domain: "beta.org",
      },
    ];

    it("should build numbered citations by default", () => {
      const citations = service.buildCitations(sources);
      expect(citations[0]).toMatch(/^\[1\] Research Paper Alpha/);
      expect(citations[0]).toContain("https://alpha.com/paper");
      expect(citations[1]).toMatch(/^\[2\] Industry Report Beta/);
    });

    it("should build APA citations", () => {
      const citations = service.buildCitations(sources, "apa");
      expect(citations[0]).toContain("Research Paper Alpha");
      expect(citations[0]).toContain("alpha.com");
      expect(citations[0]).toContain("2024-01");
    });

    it("should build inline citations", () => {
      const citations = service.buildCitations(sources, "inline");
      expect(citations[0]).toContain("Research Paper Alpha");
      expect(citations[0]).toContain("https://alpha.com/paper");
      expect(citations[1]).toContain("Industry Report Beta");
    });

    it("should handle sources without URLs", () => {
      const sourcesNoUrl = [{ id: 1, title: "No URL Source" }];
      const citations = service.buildCitations(sourcesNoUrl);
      expect(citations[0]).toContain("No URL Source");
      expect(citations[0]).not.toContain("undefined");
    });

    it("should return empty array for empty sources", () => {
      expect(service.buildCitations([])).toEqual([]);
    });
  });

  // ===================== sanitizeReport =====================

  describe("sanitizeReport", () => {
    it("should return empty string for empty input", () => {
      expect(service.sanitizeReport("")).toBe("");
    });

    it("should remove markdown code block wrapper", () => {
      const content = "```markdown\n# Title\nContent here\n```";
      const result = service.sanitizeReport(content);
      expect(result).not.toContain("```markdown");
      expect(result).toContain("# Title");
    });

    it("should collapse excessive blank lines", () => {
      const content = "Para 1\n\n\n\n\nPara 2";
      const result = service.sanitizeReport(content);
      // 4+ consecutive newlines should be reduced
      expect(result.split("\n").filter((l) => l === "").length).toBeLessThan(4);
    });

    it("should trim trailing whitespace from lines", () => {
      const content = "Line one   \nLine two  ";
      const result = service.sanitizeReport(content);
      expect(result).not.toMatch(/\s+$/m);
    });

    it("should fix unpaired bold markers", () => {
      const content = "Normal **bold** and **incomplete";
      const result = service.sanitizeReport(content);
      // Should not throw, and unpaired ** should be removed
      expect(result).not.toContain("**incomplete");
    });

    it("should preserve well-formed markdown", () => {
      const content =
        "# Title\n\n## Section\n\nParagraph with **bold** and *italic* text.";
      const result = service.sanitizeReport(content);
      expect(result).toContain("# Title");
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
    });
  });
});
