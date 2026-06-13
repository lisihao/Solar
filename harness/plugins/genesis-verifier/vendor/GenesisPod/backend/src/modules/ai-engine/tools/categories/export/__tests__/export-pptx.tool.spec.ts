import { ExportPPTXTool } from "../export-pptx.tool";
import { ExportOrchestratorService } from "@/common/export";
import { ToolContext } from "../../../abstractions/tool.interface";
import { ExportFormat } from "@prisma/client";

// ============================================================================
// Mock factory
// ============================================================================

function createMockExportOrchestrator() {
  return {
    createExportJob: jest.fn(),
    getJobStatus: jest.fn(),
  };
}

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "export-pptx",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function createCompletedJobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-pptx-001",
    status: "COMPLETED",
    downloadUrl: "https://storage.example.com/presentation.pptx",
    fileName: "presentation.pptx",
    fileSize: 55555,
    error: undefined,
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("ExportPPTXTool", () => {
  let tool: ExportPPTXTool;
  let mockOrchestrator: ReturnType<typeof createMockExportOrchestrator>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrchestrator = createMockExportOrchestrator();
    tool = new ExportPPTXTool(
      mockOrchestrator as unknown as ExportOrchestratorService,
    );
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id 'export-pptx'", () => {
      expect(tool.id).toBe("export-pptx");
    });

    it("should have category 'export'", () => {
      expect(tool.category).toBe("export");
    });

    it("should have a non-empty name", () => {
      expect(tool.name.length).toBeGreaterThan(0);
    });

    it("should have a non-empty description", () => {
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid title and content", () => {
      expect(
        tool.validateInput({
          title: "Q1 Review",
          content: "# Slide 1\n\nContent here\n\n# Slide 2\n\nMore content",
        }),
      ).toBe(true);
    });

    it("should return false when title is empty string", () => {
      expect(tool.validateInput({ title: "", content: "Slide content" })).toBe(
        false,
      );
    });

    it("should return false when title is whitespace only", () => {
      expect(
        tool.validateInput({ title: "  ", content: "Slide content" }),
      ).toBe(false);
    });

    it("should return false when content is empty string", () => {
      expect(tool.validateInput({ title: "Presentation", content: "" })).toBe(
        false,
      );
    });

    it("should return false when content is whitespace only", () => {
      expect(
        tool.validateInput({ title: "Presentation", content: "   " }),
      ).toBe(false);
    });

    it("should return true with all optional fields", () => {
      expect(
        tool.validateInput({
          title: "Presentation",
          content: "# Slide",
          author: "Jane Doe",
          company: "TechCorp",
          templateId: "tmpl-pptx-001",
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Happy path
  // --------------------------------------------------------------------------

  describe("happy path - completed export", () => {
    it("should return success: true when job completes", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Q1 Review", content: "# Slide 1\n\nContent" },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });

    it("should return correct PPTX MIME type", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Presentation", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
    });

    it("should use fileName from job result", async () => {
      const completedJob = createCompletedJobStatus({
        fileName: "q1-review.pptx",
      });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Presentation", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("q1-review.pptx");
    });

    it("should fall back to title-based filename when fileName is missing", async () => {
      const completedJob = createCompletedJobStatus({ fileName: undefined });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Strategy Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("Strategy Deck.pptx");
    });

    it("should return fileSize from job result", async () => {
      const completedJob = createCompletedJobStatus({ fileSize: 300000 });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Presentation", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.size).toBe(300000);
    });

    it("should pass ExportFormat.PPTX to createExportJob", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      const callArg = mockOrchestrator.createExportJob.mock.calls[0][1] as {
        format: ExportFormat;
      };
      expect(callArg.format).toBe(ExportFormat.PPTX);
    });

    it("should pass templateId to createExportJob when provided", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Deck", content: "Content", templateId: "pptx-tmpl-abc" },
        createMockContext(),
      );

      const callArg = mockOrchestrator.createExportJob.mock.calls[0][1] as {
        templateId?: string;
      };
      expect(callArg.templateId).toBe("pptx-tmpl-abc");
    });

    it("should use context.userId when calling createExportJob", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext({ userId: "user-xyz" }),
      );

      expect(mockOrchestrator.createExportJob.mock.calls[0][0]).toBe(
        "user-xyz",
      );
    });

    it("should use 'system' as userId when context.userId is not set", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext({ userId: undefined }),
      );

      expect(mockOrchestrator.createExportJob.mock.calls[0][0]).toBe("system");
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return success: false when job status is FAILED", async () => {
      const failedJob = {
        jobId: "job-fail-pptx",
        status: "FAILED",
        downloadUrl: undefined,
        error: "PPTX generation failed",
      };
      mockOrchestrator.createExportJob.mockResolvedValueOnce(failedJob);

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("PPTX generation failed");
    });

    it("should return success: false when COMPLETED but no downloadUrl", async () => {
      const noUrlJob = createCompletedJobStatus({ downloadUrl: undefined });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(noUrlJob);

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
    });

    it("should return success: false when createExportJob throws", async () => {
      mockOrchestrator.createExportJob.mockRejectedValueOnce(
        new Error("Export service down"),
      );

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Export service down");
    });

    it("should return empty strings on error", async () => {
      mockOrchestrator.createExportJob.mockRejectedValueOnce(new Error("fail"));

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("");
      expect(result.data?.mimeType).toBe("");
      expect(result.data?.size).toBe(0);
      expect(result.data?.base64Content).toBe("");
    });

    it("should return 'Export timed out' when job fails with no error message", async () => {
      const failedJob = {
        jobId: "job-timeout",
        status: "FAILED",
        downloadUrl: undefined,
        error: undefined,
      };
      mockOrchestrator.createExportJob.mockResolvedValueOnce(failedJob);

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.error).toBe("Export timed out");
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should always include all required output fields", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data).toHaveProperty("filename");
      expect(result.data).toHaveProperty("mimeType");
      expect(result.data).toHaveProperty("size");
      expect(result.data).toHaveProperty("base64Content");
      expect(result.data).toHaveProperty("success");
    });

    it("should return empty base64Content in download-URL mode", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Deck", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.base64Content).toBe("");
    });
  });
});
