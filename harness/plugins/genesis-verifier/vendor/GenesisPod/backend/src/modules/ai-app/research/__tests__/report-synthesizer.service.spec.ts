/**
 * Tests for ReportSynthesizerService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportSynthesizerService } from "../discussion/report-synthesizer.service";
import { ChatFacade, TeamFacade } from "@/modules/ai-harness/facade";
import type { SearchRound } from "../discussion/types";

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    sanitizeReport: jest.fn((text: string) => text),
  })),
  TeamFacade: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    sanitizeReport: jest.fn((text: string) => text),
  })),
  TeamFacade: jest.fn().mockImplementation(() => ({})),
}));

describe("ReportSynthesizerService", () => {
  let service: ReportSynthesizerService;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockSearchRound: SearchRound = {
    round: 1,
    stepId: "step_1",
    query: "AI trends",
    resultsCount: 3,
    sources: [
      {
        id: "s1",
        title: "AI Progress Report",
        url: "https://example.com/ai",
        snippet: "AI is advancing rapidly in 2025...",
        domain: "example.com",
        relevanceScore: 0.9,
        publishedDate: "2025-01-01",
      },
      {
        id: "s2",
        title: "Machine Learning Updates",
        url: "https://ml.com/updates",
        snippet: "Latest ML breakthroughs...",
        domain: "ml.com",
        relevanceScore: 0.8,
      },
    ],
    timestamp: new Date(),
  };

  beforeEach(async () => {
    const mockFacadeInstance = {
      chat: jest.fn(),
      sanitizeReport: jest.fn((text: string) => text),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportSynthesizerService,
        {
          provide: ChatFacade,
          useValue: mockFacadeInstance,
        },
        {
          provide: TeamFacade,
          useValue: mockFacadeInstance,
        },
      ],
    }).compile();

    service = module.get<ReportSynthesizerService>(ReportSynthesizerService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateReport", () => {
    beforeEach(() => {
      // Mock section topics identification
      let callCount = 0;
      (aiFacade.chat as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: identify section topics
          return {
            content: JSON.stringify([
              "Current State of AI",
              "Key Breakthroughs",
              "Future Outlook",
            ]),
            tokensUsed: 100,
          };
        }
        // Subsequent calls: generate sections / summary / conclusion
        return {
          content: "Generated content for this section...",
          tokensUsed: 500,
        };
      });
    });

    it("should generate a report with sections", async () => {
      const report = await service.generateReport("AI trends 2025", [
        mockSearchRound,
      ]);

      expect(report).toBeDefined();
      expect(report.sections).toBeDefined();
      expect(Array.isArray(report.sections)).toBe(true);
      expect(report.references).toBeDefined();
      expect(report.metadata).toBeDefined();
    });

    it("should include metadata with correct fields", async () => {
      const report = await service.generateReport("AI trends 2025", [
        mockSearchRound,
      ]);

      expect(report.metadata.totalSources).toBeGreaterThanOrEqual(0);
      expect(report.metadata.searchRounds).toBe(1);
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("should build references from sources", async () => {
      const report = await service.generateReport("AI trends 2025", [
        mockSearchRound,
      ]);

      expect(report.references.length).toBeGreaterThan(0);
      expect(report.references[0].title).toBe("AI Progress Report");
      expect(report.references[0].url).toBe("https://example.com/ai");
    });

    it("should sanitize report content via aiFacade", async () => {
      await service.generateReport("AI trends 2025", [mockSearchRound]);

      expect(aiFacade.sanitizeReport).toHaveBeenCalled();
    });

    it("should fallback gracefully when AI fails", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("API Error"));

      const report = await service.generateReport("AI trends 2025", [
        mockSearchRound,
      ]);

      expect(report).toBeDefined();
      expect(report.sections.length).toBeGreaterThan(0);
    });

    it("should handle follow-up mode with previous context", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Updated summary...",
          sections: [
            { title: "Updates", content: "New findings...", citations: [1] },
          ],
          conclusion: "Updated conclusion...",
        }),
        tokensUsed: 500,
      });

      const previousContext = {
        executiveSummary: "Previous summary",
        sections: [{ title: "Section A", content: "Old content" }],
        conclusion: "Old conclusion",
        references: [{ title: "Old Ref", url: "https://old.com" }],
      };

      const report = await service.generateReport(
        "Follow-up query",
        [mockSearchRound],
        {
          isFollowUp: true,
          previousContext,
        },
      );

      expect(report).toBeDefined();
      // References should include both old and new refs
      expect(report.references.length).toBeGreaterThan(0);
    });

    it("should use language option for report generation", async () => {
      await service.generateReport("AI trends 2025", [mockSearchRound], {
        language: "en-US",
      });

      expect(aiFacade.chat).toHaveBeenCalled();
    });

    it("should deduplicate sources from multiple rounds", async () => {
      const duplicateRound: SearchRound = {
        round: 2,
        stepId: "step_2",
        query: "duplicate",
        resultsCount: 1,
        sources: [mockSearchRound.sources[0]], // Same URL
        timestamp: new Date(),
      };

      const report = await service.generateReport("Test", [
        mockSearchRound,
        duplicateRound,
      ]);

      // Should deduplicate
      const urls = report.references.map((r) => r.url);
      const uniqueUrls = new Set(urls);
      expect(urls.length).toBe(uniqueUrls.size);
    });

    it("should handle empty search rounds", async () => {
      const report = await service.generateReport("AI trends 2025", []);

      expect(report).toBeDefined();
      expect(report.metadata.totalSources).toBe(0);
    });

    it("should handle fallback when AI section topics returns invalid format", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValueOnce({
        content: "Not JSON",
        tokensUsed: 100,
      });
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "Section content",
        tokensUsed: 200,
      });

      const report = await service.generateReport("Test query", [
        mockSearchRound,
      ]);

      expect(report).toBeDefined();
    });
  });

  describe("generateReportStream", () => {
    it("should yield sections as it generates", async () => {
      let callCount = 0;
      (aiFacade.chat as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify(["Section A", "Section B"]),
            tokensUsed: 100,
          };
        }
        return { content: "Section content", tokensUsed: 200 };
      });

      const chunks: { section: string; content: string }[] = [];
      for await (const chunk of service.generateReportStream("AI trends", [
        mockSearchRound,
      ])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      // Should have executive_summary and conclusion at minimum
      const sections = chunks.map((c) => c.section);
      expect(sections).toContain("executive_summary");
      expect(sections).toContain("conclusion");
    });
  });
});
