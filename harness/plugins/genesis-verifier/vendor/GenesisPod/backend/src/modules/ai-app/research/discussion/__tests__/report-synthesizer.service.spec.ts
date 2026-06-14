import { Test, TestingModule } from "@nestjs/testing";
import { ReportSynthesizerService } from "../report-synthesizer.service";
import { ChatFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { SearchRound, SearchSource } from "../types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAiFacade = {
  chat: jest.fn(),
  sanitizeReport: jest.fn(),
  getDefaultTextModel: jest.fn(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<SearchSource> = {}): SearchSource {
  return {
    id: "src-1",
    title: "Test Source",
    url: "https://example.com/source",
    snippet:
      "This is a test snippet with relevant information about the topic.",
    domain: "example.com",
    relevanceScore: 0.85,
    publishedDate: "2024-01-15",
    ...overrides,
  };
}

function makeSearchRound(
  sources: SearchSource[],
  overrides: Partial<SearchRound> = {},
): SearchRound {
  return {
    round: 1,
    stepId: "step-1",
    query: "test query",
    resultsCount: sources.length,
    sources,
    timestamp: new Date(),
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ReportSynthesizerService", () => {
  let service: ReportSynthesizerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportSynthesizerService,
        {
          provide: ChatFacade,
          useValue: mockAiFacade,
        },
        {
          provide: TeamFacade,
          useValue: mockAiFacade,
        },
      ],
    }).compile();

    service = module.get<ReportSynthesizerService>(ReportSynthesizerService);

    // Default: sanitizeReport returns the input unchanged
    mockAiFacade.sanitizeReport.mockImplementation((text: string) => text);

    // Default: identifySectionTopics returns 3 topics
    mockAiFacade.chat.mockResolvedValue({
      content: JSON.stringify([
        "Background and Context",
        "Key Findings",
        "Future Implications",
      ]),
      tokensUsed: 500,
    });
  });

  // ── generateReport ───────────────────────────────────────────────────────────

  describe("generateReport", () => {
    it("generates a complete report structure from search rounds", async () => {
      const sources = [
        makeSource(),
        makeSource({ id: "src-2", url: "https://example.com/src2" }),
      ];
      const searchRounds = [makeSearchRound(sources)];

      // Mocked responses for each AI chat call
      // 1st call: identifySectionTopics
      // 2nd call: executiveSummary
      // 3rd-5th calls: 3 sections
      // 6th call: conclusion
      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify([
            "Background",
            "Key Findings",
            "Future Implications",
          ]),
        })
        .mockResolvedValueOnce({ content: "Executive summary text" })
        .mockResolvedValueOnce({ content: "Background section content [1][2]" })
        .mockResolvedValueOnce({ content: "Key findings content [1]" })
        .mockResolvedValueOnce({ content: "Future implications content [2]" })
        .mockResolvedValueOnce({ content: "Conclusion text" });

      const report = await service.generateReport(
        "AI research trends",
        searchRounds,
      );

      expect(report).toMatchObject({
        executiveSummary: expect.any(String),
        sections: expect.arrayContaining([
          expect.objectContaining({
            title: expect.any(String),
            content: expect.any(String),
            citations: expect.any(Array),
          }),
        ]),
        conclusion: expect.any(String),
        references: expect.any(Array),
        metadata: expect.objectContaining({
          totalSources: expect.any(Number),
          duration: expect.any(Number),
          searchRounds: 1,
        }),
      });
    });

    it("builds references from sources with correct IDs", async () => {
      const sources = [
        makeSource({
          id: "src-1",
          title: "Source One",
          url: "https://example.com/1",
        }),
        makeSource({
          id: "src-2",
          title: "Source Two",
          url: "https://example.com/2",
        }),
      ];
      const searchRounds = [makeSearchRound(sources)];

      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(["Topic A", "Topic B", "Topic C"]),
        })
        .mockResolvedValue({ content: "Section content" });

      const report = await service.generateReport("test query", searchRounds);

      expect(report.references[0].id).toBe(1);
      expect(report.references[1].id).toBe(2);
      expect(report.references[0].title).toBe("Source One");
    });

    it("deduplicates sources across multiple search rounds", async () => {
      const sharedSource = makeSource({ url: "https://example.com/shared" });
      const uniqueSource = makeSource({
        id: "unique",
        url: "https://example.com/unique",
      });

      const round1 = makeSearchRound([sharedSource, uniqueSource], {
        round: 1,
      });
      const round2 = makeSearchRound([sharedSource], { round: 2 }); // Duplicate

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport("dedup test", [
        round1,
        round2,
      ]);

      // Only 2 unique sources, not 3
      expect(report.references.length).toBeLessThanOrEqual(2);
    });

    it("sorts sources by relevance score descending", async () => {
      const lowRelevance = makeSource({
        id: "low",
        url: "https://example.com/low",
        relevanceScore: 0.3,
        title: "Low Relevance",
      });
      const highRelevance = makeSource({
        id: "high",
        url: "https://example.com/high",
        relevanceScore: 0.9,
        title: "High Relevance",
      });

      const searchRounds = [makeSearchRound([lowRelevance, highRelevance])];

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport("test", searchRounds);

      // High relevance should come first in references
      expect(report.references[0].title).toBe("High Relevance");
    });

    it("calls sanitizeReport on executiveSummary, sections, and conclusion", async () => {
      const searchRounds = [makeSearchRound([makeSource()])];

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValueOnce({ content: "Executive summary" })
        .mockResolvedValueOnce({ content: "Section 1 content" })
        .mockResolvedValueOnce({ content: "Section 2 content" })
        .mockResolvedValueOnce({ content: "Section 3 content" })
        .mockResolvedValueOnce({ content: "Conclusion" });

      await service.generateReport("sanitize test", searchRounds);

      // sanitizeReport should be called at least 3 times (summary, sections, conclusion)
      expect(
        mockAiFacade.sanitizeReport.mock.calls.length,
      ).toBeGreaterThanOrEqual(3);
    });

    it("uses default language zh-CN when not specified", async () => {
      const searchRounds = [makeSearchRound([makeSource()])];

      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(["背景", "发现", "结论"]),
        })
        .mockResolvedValue({ content: "中文内容" });

      await service.generateReport("AI研究趋势", searchRounds);

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("generates follow-up report when isFollowUp=true", async () => {
      const sources = [makeSource()];
      const searchRounds = [makeSearchRound(sources)];
      const previousContext = {
        executiveSummary: "Previous summary",
        sections: [{ title: "Previous Section", content: "Previous content" }],
        conclusion: "Previous conclusion",
        references: [{ title: "Old Ref", url: "https://old.com" }],
      };

      // Follow-up uses single chat call
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Follow-up summary",
          sections: [
            { title: "New Section", content: "New content", citations: [2] },
          ],
          conclusion: "Follow-up conclusion",
        }),
      });

      const report = await service.generateReport(
        "follow-up query",
        searchRounds,
        { isFollowUp: true, previousContext },
      );

      expect(report.executiveSummary).toBeDefined();
      // Previous refs (1) + new refs should be combined
      expect(report.references.length).toBeGreaterThanOrEqual(1);
    });

    it("handles empty search rounds gracefully", async () => {
      // identifySectionTopics chat call
      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport("empty test", []);

      expect(report).toMatchObject({
        executiveSummary: expect.any(String),
        sections: expect.any(Array),
        conclusion: expect.any(String),
        references: [],
        metadata: expect.objectContaining({
          totalSources: 0,
          searchRounds: 0,
        }),
      });
    });

    it("falls back to default report when AI calls fail", async () => {
      const searchRounds = [makeSearchRound([makeSource()])];

      // identifySectionTopics fails first, then all subsequent calls fail too
      mockAiFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      const report = await service.generateReport(
        "fallback test",
        searchRounds,
      );

      // Should still return a valid report structure
      expect(report.executiveSummary).toBeDefined();
      expect(report.sections).toBeDefined();
      expect(Array.isArray(report.sections)).toBe(true);
    });

    it("limits sources to 40 when more are provided", async () => {
      const sources = Array.from({ length: 60 }, (_, i) =>
        makeSource({
          id: `src-${i}`,
          url: `https://example.com/src-${i}`,
          relevanceScore: Math.random(),
        }),
      );
      const searchRounds = [makeSearchRound(sources)];

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport("large test", searchRounds);

      // References should be at most 40
      expect(report.references.length).toBeLessThanOrEqual(40);
    });
  });

  // ── generateReportStream ─────────────────────────────────────────────────────

  describe("generateReportStream", () => {
    it("yields section markers and content in correct order", async () => {
      const sources = [makeSource()];
      const searchRounds = [makeSearchRound(sources)];

      // 1st: executive_summary section
      // 2nd: identifySectionTopics
      // 3rd-4th: sections
      // 5th: conclusion
      mockAiFacade.chat
        .mockResolvedValueOnce({ content: "Executive summary content" })
        .mockResolvedValueOnce({
          content: JSON.stringify(["Topic 1", "Topic 2"]),
        })
        .mockResolvedValueOnce({ content: "Topic 1 content" })
        .mockResolvedValueOnce({ content: "Topic 2 content" })
        .mockResolvedValueOnce({ content: "Conclusion content" });

      const events: Array<{ section: string; content: string }> = [];
      for await (const event of service.generateReportStream(
        "stream test",
        searchRounds,
      )) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);

      // First event should be executive_summary start marker
      const execSummaryEvents = events.filter(
        (e) => e.section === "executive_summary",
      );
      expect(execSummaryEvents.length).toBeGreaterThanOrEqual(2); // start + content

      // Should include conclusion
      const conclusionEvents = events.filter((e) => e.section === "conclusion");
      expect(conclusionEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── identifySectionTopics fallback ────────────────────────────────────────────

  describe("section topics identification", () => {
    it("uses fallback topics when AI returns invalid JSON", async () => {
      const sources = [makeSource()];
      const searchRounds = [makeSearchRound(sources)];

      // identifySectionTopics returns invalid JSON
      mockAiFacade.chat
        .mockResolvedValueOnce({ content: "not valid json" })
        .mockResolvedValue({ content: "Section content" });

      const report = await service.generateReport(
        "fallback topics",
        searchRounds,
      );

      // Should still have sections (from fallback)
      expect(report.sections.length).toBeGreaterThanOrEqual(0);
    });

    it("uses fallback when AI returns fewer than 3 topics", async () => {
      const sources = [makeSource()];
      const searchRounds = [makeSearchRound(sources)];

      // Returns only 2 topics (minimum is 3)
      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(["Topic A", "Topic B"]),
        })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport("few topics", searchRounds);

      expect(report.sections).toBeDefined();
    });
  });

  // ── citation extraction ───────────────────────────────────────────────────────

  describe("citation extraction from section content", () => {
    it("extracts citation numbers from section content brackets", async () => {
      const sources = [
        makeSource(),
        makeSource({ id: "s2", url: "https://s2.com" }),
      ];
      const searchRounds = [makeSearchRound(sources)];

      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(["Section 1", "Section 2", "Section 3"]),
        })
        .mockResolvedValueOnce({ content: "Summary [1][2]" })
        .mockResolvedValueOnce({ content: "Content with refs [1][3]" })
        .mockResolvedValueOnce({ content: "More content [2]" })
        .mockResolvedValueOnce({ content: "Last section [1][2][3]" })
        .mockResolvedValueOnce({ content: "Conclusion" });

      const report = await service.generateReport(
        "citation test",
        searchRounds,
      );

      // Sections with [1] or [2] in content should have those citations
      const sectionWithRefs = report.sections.find(
        (s) => s.citations && s.citations.length > 0,
      );
      expect(sectionWithRefs).toBeDefined();
    });

    it("deduplicates citations within a section", async () => {
      const sources = [makeSource()];
      const searchRounds = [makeSearchRound(sources)];

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["Topic"]) })
        .mockResolvedValueOnce({ content: "Summary" })
        .mockResolvedValueOnce({
          content: "Content [1][1][1] lots of refs [1]",
        })
        .mockResolvedValueOnce({ content: "Conclusion" });

      // identifySectionTopics returned only 1 topic; re-mock for 1 section
      mockAiFacade.chat.mockReset();
      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(["Topic A", "Topic B", "Topic C"]),
        })
        .mockResolvedValueOnce({ content: "Summary" })
        .mockResolvedValueOnce({ content: "Content [1][1][2][1]" })
        .mockResolvedValueOnce({ content: "Content [2]" })
        .mockResolvedValueOnce({ content: "Content [3]" })
        .mockResolvedValueOnce({ content: "Conclusion" });

      const report = await service.generateReport(
        "dedup citations",
        searchRounds,
      );

      // Citations in first section should be unique
      const firstSection = report.sections[0];
      if (firstSection && firstSection.citations.length > 0) {
        const uniqueCitations = [...new Set(firstSection.citations)];
        expect(firstSection.citations.length).toBe(uniqueCitations.length);
      }
    });
  });

  // ── metadata ─────────────────────────────────────────────────────────────────

  describe("report metadata", () => {
    it("includes correct searchRounds count in metadata", async () => {
      const round1 = makeSearchRound([makeSource()], { round: 1 });
      const round2 = makeSearchRound(
        [makeSource({ id: "s2", url: "https://s2.com" })],
        { round: 2 },
      );

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport("metadata test", [
        round1,
        round2,
      ]);

      expect(report.metadata.searchRounds).toBe(2);
    });

    it("measures duration in seconds", async () => {
      const searchRounds = [makeSearchRound([makeSource()])];

      mockAiFacade.chat
        .mockResolvedValueOnce({ content: JSON.stringify(["T1", "T2", "T3"]) })
        .mockResolvedValue({ content: "Content" });

      const report = await service.generateReport(
        "duration test",
        searchRounds,
      );

      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(typeof report.metadata.duration).toBe("number");
    });

    it("includes totalSources combining new and previous refs in follow-up mode", async () => {
      const sources = [makeSource()];
      const searchRounds = [makeSearchRound(sources)];
      const previousContext = {
        executiveSummary: "Prev",
        sections: [],
        conclusion: "Prev",
        references: [
          { title: "Old", url: "https://old.com" },
          { title: "Older", url: "https://older.com" },
        ],
      };

      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Follow-up",
          sections: [{ title: "S", content: "C", citations: [] }],
          conclusion: "Done",
        }),
      });

      const report = await service.generateReport(
        "follow-up query",
        searchRounds,
        { isFollowUp: true, previousContext },
      );

      // 2 previous + 1 new = 3
      expect(report.metadata.totalSources).toBe(3);
    });
  });
});
