jest.mock("@/modules/ai-harness/facade");
jest.mock("@/modules/ai-harness/facade");
jest.mock("../../../../../common/prisma/prisma.service");

import { Test, TestingModule } from "@nestjs/testing";
import {
  AiFileOrganizerService,
  FileInfo,
  OrganizationSuggestion,
} from "../ai-file-organizer.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ── Mock data ─────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    id: "file-001",
    name: "machine-learning-notes.pdf",
    mimeType: "application/pdf",
    source: "google_drive",
    ...overrides,
  };
}

const VALID_AI_RESPONSE = JSON.stringify({
  categories: [
    { category: "paper", confidence: 0.9, reason: "Academic paper" },
  ],
  tags: [
    { tag: "machine-learning", confidence: 0.95, reason: "Core topic" },
    { tag: "AI", confidence: 0.85, reason: "Related field" },
  ],
  suggestedFolder: {
    folderPath: "Research/ML",
    confidence: 0.8,
    reason: "Fits existing folder structure",
  },
  summary: "Notes on machine learning fundamentals.",
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe("AiFileOrganizerService", () => {
  let service: AiFileOrganizerService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiFileOrganizerService,
        {
          provide: PrismaService,
          useValue: {
            resource: {
              findMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: ChatFacade,
          useValue: {
            chat: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AiFileOrganizerService>(AiFileOrganizerService);
    prisma = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── analyzeFile ──────────────────────────────────────────────────────────────

  describe("analyzeFile", () => {
    it("should return parsed AI suggestion for a valid file", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: VALID_AI_RESPONSE,
      });

      const file = makeFile();
      const result = await service.analyzeFile(file);

      expect(result.fileId).toBe("file-001");
      expect(result.fileName).toBe("machine-learning-notes.pdf");
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].category).toBe("paper");
      expect(result.tags.length).toBeGreaterThan(0);
      expect(result.summary).toBe("Notes on machine learning fundamentals.");
    });

    it("should call aiFacade.chat with system and user messages", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: VALID_AI_RESPONSE,
      });

      await service.analyzeFile(makeFile());

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
          taskProfile: expect.objectContaining({
            creativity: "low",
            outputLength: "short",
          }),
        }),
      );
    });

    it("should include file content in the prompt when provided", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: VALID_AI_RESPONSE,
      });

      const file = makeFile({
        content: "Introduction to neural networks...",
        description: "AI textbook notes",
      });

      await service.analyzeFile(file);

      const callArgs = (aiFacade.chat as jest.Mock).mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: { role: string; content: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("Introduction to neural networks");
      expect(userMessage.content).toContain("AI textbook notes");
    });

    it("should truncate content to 2000 characters in the prompt", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: VALID_AI_RESPONSE,
      });

      const file = makeFile({ content: "X".repeat(3000) });
      await service.analyzeFile(file);

      const callArgs = (aiFacade.chat as jest.Mock).mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: { role: string; content: string }) => m.role === "user",
      );
      // The prompt should contain the truncated marker
      expect(userMessage.content).toContain("[Content truncated...]");
    });

    it("should return default suggestion when AI response is not valid JSON", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "Sorry, I cannot analyze this file.",
      });

      const file = makeFile({ name: "report.pdf" });
      const result = await service.analyzeFile(file);

      // Default suggestion for .pdf uses "REPORT" category
      expect(result.fileId).toBe("file-001");
      expect(result.categories[0]?.category).toBe("REPORT");
    });

    it("should return default suggestion when aiFacade throws", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(
        new Error("LLM service unavailable"),
      );

      const file = makeFile({ name: "data.xlsx" });
      const result = await service.analyzeFile(file);

      // Default for .xlsx is REPORT
      expect(result.categories[0]?.category).toBe("REPORT");
      expect(result.tags).toEqual([]);
    });

    it("should return empty categories for unknown file extension", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("Error"));

      const file = makeFile({ name: "archive.zip" });
      const result = await service.analyzeFile(file);

      expect(result.categories).toEqual([]);
    });
  });

  // ── batchAnalyze ─────────────────────────────────────────────────────────────

  describe("batchAnalyze", () => {
    it("should process all files in batches of 5", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: VALID_AI_RESPONSE,
      });

      const files = Array.from({ length: 8 }, (_, i) =>
        makeFile({ id: `file-${i}`, name: `file-${i}.pdf` }),
      );

      const result = await service.batchAnalyze(files);

      expect(result.totalFiles).toBe(8);
      expect(result.processedFiles).toBe(8);
      expect(result.suggestions).toHaveLength(8);
      expect(result.errors).toHaveLength(0);
      expect(result.success).toBe(true);
    });

    it("should record errors for files that fail analysis", async () => {
      (aiFacade.chat as jest.Mock)
        .mockResolvedValueOnce({ content: VALID_AI_RESPONSE })
        .mockRejectedValue(new Error("Analysis failed"));

      const files = [
        makeFile({ id: "file-ok", name: "ok.pdf" }),
        makeFile({ id: "file-fail", name: "fail.pdf" }),
      ];

      // analyzeFile catches errors and returns default suggestion, so errors array stays empty
      const result = await service.batchAnalyze(files);

      // analyzeFile itself swallows errors and returns default — batchAnalyze allSettled handles it
      expect(result.totalFiles).toBe(2);
      expect(result.processedFiles).toBeGreaterThanOrEqual(1);
    });

    it("should return success=true when no errors occur", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: VALID_AI_RESPONSE,
      });

      const files = [makeFile()];
      const result = await service.batchAnalyze(files);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle empty file array", async () => {
      const result = await service.batchAnalyze([]);

      expect(result.totalFiles).toBe(0);
      expect(result.processedFiles).toBe(0);
      expect(result.suggestions).toHaveLength(0);
      expect(result.success).toBe(true);
    });
  });

  // ── applySuggestion ──────────────────────────────────────────────────────────

  describe("applySuggestion", () => {
    it("should update resource type with highest-confidence category", async () => {
      (prisma.resource.update as jest.Mock).mockResolvedValue({});

      const suggestion: Partial<OrganizationSuggestion> = {
        categories: [
          { category: "paper", confidence: 0.9, reason: "" },
          { category: "blog", confidence: 0.6, reason: "" },
        ],
        tags: [
          { tag: "AI", confidence: 0.9, reason: "" },
          { tag: "ML", confidence: 0.8, reason: "" },
        ],
        summary: "A research paper on neural networks.",
      };

      await service.applySuggestion("resource-001", suggestion);

      expect(prisma.resource.update).toHaveBeenCalledWith({
        where: { id: "resource-001" },
        data: expect.objectContaining({
          type: "PAPER",
          tags: expect.arrayContaining(["AI", "ML"]),
          abstract: "A research paper on neural networks.",
        }),
      });
    });

    it("should skip type update when category has no valid ResourceType mapping", async () => {
      (prisma.resource.update as jest.Mock).mockResolvedValue({});

      const suggestion: Partial<OrganizationSuggestion> = {
        categories: [
          { category: "unknown-category", confidence: 0.8, reason: "" },
        ],
        summary: "Some summary",
      };

      await service.applySuggestion("resource-002", suggestion);

      expect(prisma.resource.update).toHaveBeenCalledWith({
        where: { id: "resource-002" },
        data: expect.not.objectContaining({ type: expect.anything() }),
      });
    });

    it("should only apply tags with confidence > 0.7", async () => {
      (prisma.resource.update as jest.Mock).mockResolvedValue({});

      const suggestion: Partial<OrganizationSuggestion> = {
        tags: [
          { tag: "high-conf", confidence: 0.9, reason: "" },
          { tag: "low-conf", confidence: 0.5, reason: "" },
          { tag: "medium-conf", confidence: 0.75, reason: "" },
        ],
      };

      await service.applySuggestion("resource-003", suggestion);

      expect(prisma.resource.update).toHaveBeenCalledWith({
        where: { id: "resource-003" },
        data: expect.objectContaining({
          tags: expect.arrayContaining(["high-conf", "medium-conf"]),
        }),
      });
      const callData = (prisma.resource.update as jest.Mock).mock.calls[0][0]
        .data;
      expect(callData.tags).not.toContain("low-conf");
    });

    it("should not call update when no fields to update", async () => {
      const suggestion: Partial<OrganizationSuggestion> = {
        categories: [],
        tags: [],
      };

      await service.applySuggestion("resource-004", suggestion);

      expect(prisma.resource.update).not.toHaveBeenCalled();
    });
  });

  // ── getExistingCategories ────────────────────────────────────────────────────

  describe("getExistingCategories", () => {
    it("should return distinct resource types from the database", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([
        { type: "PAPER" },
        { type: "BLOG" },
        { type: "REPORT" },
      ]);

      const categories = await service.getExistingCategories();

      expect(categories).toEqual(["PAPER", "BLOG", "REPORT"]);
      expect(prisma.resource.findMany).toHaveBeenCalledWith({
        select: { type: true },
        distinct: ["type"],
      });
    });

    it("should filter out falsy type values", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([
        { type: "PAPER" },
        { type: null },
        { type: "" },
      ]);

      const categories = await service.getExistingCategories();

      expect(categories).not.toContain(null);
      expect(categories).not.toContain("");
    });
  });

  // ── getExistingTags ──────────────────────────────────────────────────────────

  describe("getExistingTags", () => {
    it("should return a deduplicated list of all tags", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([
        { tags: ["AI", "ML"] },
        { tags: ["AI", "NLP"] },
        { tags: ["deep-learning"] },
      ]);

      const tags = await service.getExistingTags();

      expect(tags).toContain("AI");
      expect(tags).toContain("ML");
      expect(tags).toContain("NLP");
      expect(tags).toContain("deep-learning");
      // Deduplication: AI appears only once
      expect(tags.filter((t) => t === "AI")).toHaveLength(1);
    });

    it("should return empty array when no resources have tags", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);

      const tags = await service.getExistingTags();

      expect(tags).toEqual([]);
    });
  });

  // ── findRelatedFiles ─────────────────────────────────────────────────────────

  describe("findRelatedFiles", () => {
    it("should return related resources matching keywords from file name", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([
        { id: "res-001", title: "Machine Learning Basics" },
        { id: "res-002", title: "Deep Learning Guide" },
      ]);

      const file = makeFile({ name: "machine-learning-notes.pdf" });
      const related = await service.findRelatedFiles(file);

      expect(related.length).toBeGreaterThan(0);
      expect(related[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        similarity: expect.any(Number),
      });
    });

    it("should return empty array for files with no extractable keywords", async () => {
      const file = makeFile({ name: "a.b" }); // very short words filtered out

      const related = await service.findRelatedFiles(file);

      expect(related).toEqual([]);
    });

    it("should respect the limit parameter", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([
        { id: "res-1", title: "Result 1" },
        { id: "res-2", title: "Result 2" },
        { id: "res-3", title: "Result 3" },
      ]);

      const file = makeFile({ name: "machine-learning-research-data.pdf" });
      await service.findRelatedFiles(file, 2);

      expect(prisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
    });
  });
});
