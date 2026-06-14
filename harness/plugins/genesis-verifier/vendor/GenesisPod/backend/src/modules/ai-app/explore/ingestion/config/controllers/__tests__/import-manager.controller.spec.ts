import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ImportManagerController } from "../import-manager.controller";
import { ImportManagerService } from "../../services/import-manager.service";
import { ImportTaskProcessorService } from "../../services/import-task-processor.service";
import { SourceWhitelistService } from "../../services/source-whitelist.service";
import { AiUrlClassifierService } from "../../services/ai-url-classifier.service";
import { ResourceType } from "@prisma/client";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockImportManagerService = {
  parseUrl: jest.fn(),
  createImportTask: jest.fn(),
  getImportTasks: jest.fn(),
  getImportTask: jest.fn(),
  getDataQualityMetrics: jest.fn(),
  parseUrlFull: jest.fn(),
  importWithMetadata: jest.fn(),
};

const mockImportTaskProcessorService = {
  processPendingTasks: jest.fn(),
  getTaskStats: jest.fn(),
};

const mockWhitelistService = {
  getWhitelist: jest.fn(),
};

const mockAiClassifierService = {
  classifyUrl: jest.fn(),
  getResourceTypeDescriptions: jest.fn(),
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ImportManagerController", () => {
  let controller: ImportManagerController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportManagerController],
      providers: [
        {
          provide: ImportManagerService,
          useValue: mockImportManagerService,
        },
        {
          provide: ImportTaskProcessorService,
          useValue: mockImportTaskProcessorService,
        },
        {
          provide: SourceWhitelistService,
          useValue: mockWhitelistService,
        },
        {
          provide: AiUrlClassifierService,
          useValue: mockAiClassifierService,
        },
      ],
    }).compile();

    controller = module.get<ImportManagerController>(ImportManagerController);

    // Default whitelist: inactive (no restrictions)
    mockWhitelistService.getWhitelist.mockResolvedValue({
      isActive: false,
      allowedDomains: [],
    });
  });

  // ── parseUrl ─────────────────────────────────────────────────────────────────

  describe("POST /parse-url", () => {
    it("throws BadRequestException when URL is missing", async () => {
      await expect(controller.parseUrl({ url: "" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("calls importManagerService.parseUrl and returns result", async () => {
      const mockResult = {
        url: "https://example.com",
        title: "Example",
        domain: "example.com",
      };
      mockImportManagerService.parseUrl.mockResolvedValue(mockResult);

      const result = await controller.parseUrl({ url: "https://example.com" });

      expect(mockImportManagerService.parseUrl).toHaveBeenCalledWith(
        "https://example.com",
      );
      expect(result).toEqual(mockResult);
    });

    it("rejects URL when domain is not in active whitelist", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["allowed.com"],
      });

      await expect(
        controller.parseUrl({
          url: "https://notallowed.com/page",
          resourceType: "BLOG" as ResourceType,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("allows URL when domain matches whitelist exactly", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["example.com"],
      });

      mockImportManagerService.parseUrl.mockResolvedValue({
        url: "https://example.com",
      });

      const result = await controller.parseUrl({
        url: "https://example.com/page",
        resourceType: "BLOG" as ResourceType,
      });

      expect(result).toBeDefined();
    });

    it("allows subdomain when parent domain is in whitelist", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["example.com"],
      });

      mockImportManagerService.parseUrl.mockResolvedValue({
        url: "https://blog.example.com",
      });

      const result = await controller.parseUrl({
        url: "https://blog.example.com/post",
        resourceType: "BLOG" as ResourceType,
      });

      expect(result).toBeDefined();
    });

    it("allows wildcard subdomain matching (*.example.com)", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["*.example.com"],
      });

      mockImportManagerService.parseUrl.mockResolvedValue({
        url: "https://sub.example.com",
      });

      const result = await controller.parseUrl({
        url: "https://sub.example.com/page",
        resourceType: "BLOG" as ResourceType,
      });

      expect(result).toBeDefined();
    });

    it("skips whitelist check when resourceType is not provided", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["allowed.com"],
      });

      mockImportManagerService.parseUrl.mockResolvedValue({
        url: "https://anything.com",
      });

      // Without resourceType, whitelist is not checked
      const result = await controller.parseUrl({
        url: "https://anything.com/page",
      });

      expect(mockWhitelistService.getWhitelist).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  // ── submitImport ─────────────────────────────────────────────────────────────

  describe("POST /import", () => {
    it("throws BadRequestException when resourceType is missing", async () => {
      await expect(
        controller.submitImport({
          resourceType: undefined as unknown as ResourceType,
          sourceUrl: "https://example.com",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when sourceUrl is missing", async () => {
      await expect(
        controller.submitImport({
          resourceType: "BLOG" as ResourceType,
          sourceUrl: "",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates import task and returns it", async () => {
      const mockTask = {
        id: "task-123",
        status: "PENDING",
        sourceUrl: "https://example.com",
      };
      mockImportManagerService.createImportTask.mockResolvedValue(mockTask);

      const result = await controller.submitImport({
        resourceType: "BLOG" as ResourceType,
        sourceUrl: "https://example.com",
        title: "Custom Title",
        ruleId: "rule-1",
      });

      expect(mockImportManagerService.createImportTask).toHaveBeenCalledWith({
        resourceType: "BLOG",
        sourceUrl: "https://example.com",
        title: "Custom Title",
        ruleId: "rule-1",
      });
      expect(result).toEqual(mockTask);
    });

    it("rejects import when domain not in active whitelist", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["allowed.com"],
      });

      await expect(
        controller.submitImport({
          resourceType: "BLOG" as ResourceType,
          sourceUrl: "https://blocked.com/article",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getTasks ─────────────────────────────────────────────────────────────────

  describe("GET /tasks", () => {
    it("returns paginated tasks with default limit and offset", async () => {
      mockImportManagerService.getImportTasks.mockResolvedValue({
        data: [{ id: "t1" }, { id: "t2" }],
        total: 2,
        limit: 50,
        offset: 0,
      });

      const result = await controller.getTasks();

      expect(mockImportManagerService.getImportTasks).toHaveBeenCalledWith(
        undefined,
        undefined,
        50,
        0,
      );
      expect(result).toMatchObject({
        data: [{ id: "t1" }, { id: "t2" }],
        pagination: {
          total: 2,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
    });

    it("parses limit and offset query params correctly", async () => {
      mockImportManagerService.getImportTasks.mockResolvedValue({
        data: [],
        total: 100,
        limit: 10,
        offset: 20,
      });

      const result = await controller.getTasks(
        undefined,
        undefined,
        "10",
        "20",
      );

      expect(mockImportManagerService.getImportTasks).toHaveBeenCalledWith(
        undefined,
        undefined,
        10,
        20,
      );
      expect(result.pagination.hasMore).toBe(true);
    });

    it("caps limit at maximum 200", async () => {
      mockImportManagerService.getImportTasks.mockResolvedValue({
        data: [],
        total: 0,
        limit: 200,
        offset: 0,
      });

      await controller.getTasks(undefined, undefined, "9999");

      expect(mockImportManagerService.getImportTasks).toHaveBeenCalledWith(
        undefined,
        undefined,
        200,
        0,
      );
    });

    it("filters by resourceType and status when provided", async () => {
      mockImportManagerService.getImportTasks.mockResolvedValue({
        data: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      await controller.getTasks("BLOG" as ResourceType, "PENDING");

      expect(mockImportManagerService.getImportTasks).toHaveBeenCalledWith(
        "BLOG",
        "PENDING",
        50,
        0,
      );
    });
  });

  // ── getTask ──────────────────────────────────────────────────────────────────

  describe("GET /tasks/:taskId", () => {
    it("returns the task when found", async () => {
      mockImportManagerService.getImportTask.mockResolvedValue({
        id: "task-abc",
        status: "COMPLETED",
      });

      const result = await controller.getTask("task-abc");

      expect(result).toEqual({ id: "task-abc", status: "COMPLETED" });
    });

    it("throws NotFoundException when task not found", async () => {
      mockImportManagerService.getImportTask.mockResolvedValue(null);

      await expect(controller.getTask("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getQualityMetrics ────────────────────────────────────────────────────────

  describe("GET /quality-metrics", () => {
    it("returns quality metrics data and stats", async () => {
      mockImportManagerService.getDataQualityMetrics.mockResolvedValue({
        data: [{ id: "m1", score: 90 }],
        stats: { avgScore: 85, totalCount: 100 },
      });

      const result = await controller.getQualityMetrics();

      expect(result).toEqual({
        data: [{ id: "m1", score: 90 }],
        stats: { avgScore: 85, totalCount: 100 },
      });
    });

    it("passes resourceType filter to service", async () => {
      mockImportManagerService.getDataQualityMetrics.mockResolvedValue({
        data: [],
        stats: {},
      });

      await controller.getQualityMetrics("BLOG" as ResourceType);

      expect(
        mockImportManagerService.getDataQualityMetrics,
      ).toHaveBeenCalledWith("BLOG");
    });
  });

  // ── parseUrlFull ─────────────────────────────────────────────────────────────

  describe("POST /parse-url-full", () => {
    it("throws BadRequestException when url is missing", async () => {
      await expect(
        controller.parseUrlFull({
          url: "",
          resourceType: "BLOG" as ResourceType,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when resourceType is missing", async () => {
      await expect(
        controller.parseUrlFull({
          url: "https://example.com",
          resourceType: undefined as unknown as ResourceType,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when whitelist is not found or inactive", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue(null);

      await expect(
        controller.parseUrlFull({
          url: "https://example.com",
          resourceType: "BLOG" as ResourceType,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("parses URL and returns full metadata when domain is allowed", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["example.com"],
      });

      mockImportManagerService.parseUrlFull.mockResolvedValue({
        metadata: { title: "Full Metadata" },
        validation: { isValid: true },
        duplicateCheck: { isDuplicate: false },
      });

      const result = await controller.parseUrlFull({
        url: "https://example.com/article",
        resourceType: "BLOG" as ResourceType,
      });

      expect(result).toMatchObject({
        metadata: { title: "Full Metadata" },
      });
    });
  });

  // ── importWithMetadata ───────────────────────────────────────────────────────

  describe("POST /import-with-metadata", () => {
    it("throws BadRequestException when url is missing", async () => {
      await expect(
        controller.importWithMetadata({
          url: "",
          resourceType: "BLOG" as ResourceType,
          metadata: { title: "Test" },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns task info after successful import", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["example.com"],
      });

      mockImportManagerService.importWithMetadata.mockResolvedValue({
        id: "task-xyz",
        status: "PENDING",
        sourceUrl: "https://example.com/article",
      });

      const result = await controller.importWithMetadata({
        url: "https://example.com/article",
        resourceType: "BLOG" as ResourceType,
        metadata: { title: "My Article" },
      });

      expect(result).toEqual({
        taskId: "task-xyz",
        status: "PENDING",
        sourceUrl: "https://example.com/article",
      });
    });
  });

  // ── processPendingImports ────────────────────────────────────────────────────

  describe("POST /process-pending", () => {
    it("processes pending tasks with default limit of 50", async () => {
      mockImportTaskProcessorService.processPendingTasks.mockResolvedValue({
        processed: 10,
        failed: 0,
      });

      const result = await controller.processPendingImports();

      expect(
        mockImportTaskProcessorService.processPendingTasks,
      ).toHaveBeenCalledWith(50);
      expect(result).toEqual({ processed: 10, failed: 0 });
    });

    it("uses provided limit query param", async () => {
      mockImportTaskProcessorService.processPendingTasks.mockResolvedValue({
        processed: 5,
        failed: 0,
      });

      await controller.processPendingImports("20");

      expect(
        mockImportTaskProcessorService.processPendingTasks,
      ).toHaveBeenCalledWith(20);
    });
  });

  // ── getTaskStats ─────────────────────────────────────────────────────────────

  describe("GET /task-stats", () => {
    it("returns task statistics", async () => {
      const stats = {
        PENDING: 5,
        PROCESSING: 2,
        COMPLETED: 100,
        FAILED: 3,
      };
      mockImportTaskProcessorService.getTaskStats.mockResolvedValue(stats);

      const result = await controller.getTaskStats();

      expect(result).toEqual(stats);
    });
  });

  // ── classifyUrl ──────────────────────────────────────────────────────────────

  describe("POST /classify-url", () => {
    it("throws BadRequestException when URL is missing", async () => {
      await expect(controller.classifyUrl({ url: "" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns classification result", async () => {
      const classification = {
        resourceType: "PAPER",
        confidence: 0.9,
        reason: "ArXiv URL detected",
      };
      mockAiClassifierService.classifyUrl.mockResolvedValue(classification);

      const result = await controller.classifyUrl({
        url: "https://arxiv.org/abs/2401.12345",
      });

      expect(result).toEqual(classification);
    });
  });

  // ── parseUrlAuto ─────────────────────────────────────────────────────────────

  describe("POST /parse-url-auto", () => {
    it("throws BadRequestException when URL is missing", async () => {
      await expect(controller.parseUrlAuto({ url: "" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns combined classification and metadata", async () => {
      mockAiClassifierService.classifyUrl.mockResolvedValue({
        resourceType: "BLOG" as ResourceType,
        confidence: 0.85,
        reason: "Blog post detected",
        alternatives: [],
        extractedInfo: { domain: "example.com" },
      });

      mockImportManagerService.parseUrlFull.mockResolvedValue({
        metadata: { title: "My Blog Post", url: "https://example.com/post" },
        validation: { isValid: true },
        duplicateCheck: { isDuplicate: false },
      });

      const result = await controller.parseUrlAuto({
        url: "https://example.com/post",
      });

      expect(result).toMatchObject({
        metadataSource: "direct",
        classification: {
          resourceType: "BLOG",
          confidence: 0.85,
        },
      });
    });

    it("uses fallback metadata on 403 error", async () => {
      mockAiClassifierService.classifyUrl.mockResolvedValue({
        resourceType: "BLOG" as ResourceType,
        confidence: 0.7,
        reason: "Default blog",
        extractedInfo: { domain: "blocked.com" },
      });

      mockImportManagerService.parseUrlFull.mockRejectedValue(
        new Error("403 Forbidden"),
      );

      const result = await controller.parseUrlAuto({
        url: "https://blocked.com/article",
      });

      expect(result.metadataSource).toMatch(/ai|url/);
      expect(result.metadata).toBeDefined();
    });

    it("uses default classification when AI classifier fails", async () => {
      mockAiClassifierService.classifyUrl.mockRejectedValue(
        new Error("AI service unavailable"),
      );

      mockImportManagerService.parseUrlFull.mockResolvedValue({
        metadata: { title: "Fallback Page" },
        validation: { isValid: true },
        duplicateCheck: { isDuplicate: false },
      });

      const result = await controller.parseUrlAuto({
        url: "https://example.com/page",
      });

      expect(result.classification.resourceType).toBe("BLOG");
    });
  });

  // ── importAuto ───────────────────────────────────────────────────────────────

  describe("POST /import-auto", () => {
    it("throws BadRequestException when URL is missing", async () => {
      await expect(controller.importAuto({ url: "" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("uses provided resourceType without calling AI classifier", async () => {
      mockImportManagerService.parseUrlFull.mockResolvedValue({
        metadata: { title: "Article" },
        validation: { isValid: true },
        duplicateCheck: { isDuplicate: false },
      });

      mockImportManagerService.importWithMetadata.mockResolvedValue({
        id: "task-auto",
        status: "PENDING",
        sourceUrl: "https://example.com/article",
      });

      await controller.importAuto({
        url: "https://example.com/article",
        resourceType: "NEWS" as ResourceType,
      });

      expect(mockAiClassifierService.classifyUrl).not.toHaveBeenCalled();
      expect(mockImportManagerService.importWithMetadata).toHaveBeenCalled();
    });

    it("uses AI classification when resourceType not provided", async () => {
      mockAiClassifierService.classifyUrl.mockResolvedValue({
        resourceType: "PAPER" as ResourceType,
        confidence: 0.9,
        reason: "Academic paper",
        extractedInfo: {},
      });

      mockImportManagerService.parseUrlFull.mockResolvedValue({
        metadata: { title: "Research Paper" },
      });

      mockImportManagerService.importWithMetadata.mockResolvedValue({
        id: "task-paper",
        status: "PENDING",
        sourceUrl: "https://arxiv.org/abs/2401.12345",
      });

      const result = await controller.importAuto({
        url: "https://arxiv.org/abs/2401.12345",
      });

      expect(mockAiClassifierService.classifyUrl).toHaveBeenCalled();
      expect(result.resourceType).toBe("PAPER");
    });
  });

  // ── getResourceTypes ─────────────────────────────────────────────────────────

  describe("GET /resource-types", () => {
    it("returns resource type descriptions as array", async () => {
      mockAiClassifierService.getResourceTypeDescriptions.mockReturnValue({
        BLOG: "Blog posts and articles",
        NEWS: "News articles",
        PAPER: "Academic papers",
      });

      const result = await controller.getResourceTypes();

      expect(result).toEqual([
        { type: "BLOG", description: "Blog posts and articles" },
        { type: "NEWS", description: "News articles" },
        { type: "PAPER", description: "Academic papers" },
      ]);
    });
  });

  // ── domain validation (private method tested via public interface) ────────────

  describe("domain validation", () => {
    it("matches regex pattern in whitelist", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["/example\\.com/"],
      });

      mockImportManagerService.parseUrl.mockResolvedValue({
        url: "https://example.com",
      });

      const result = await controller.parseUrl({
        url: "https://example.com/page",
        resourceType: "BLOG" as ResourceType,
      });

      expect(result).toBeDefined();
    });

    it("rejects when domain does not match any whitelist rule", async () => {
      mockWhitelistService.getWhitelist.mockResolvedValue({
        isActive: true,
        allowedDomains: ["only-this.com"],
      });

      await expect(
        controller.parseUrl({
          url: "https://other-domain.com/page",
          resourceType: "BLOG" as ResourceType,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
