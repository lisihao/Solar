import { ExportPDFTool } from "../export-pdf.tool";
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
    toolId: "export-pdf",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function createCompletedJobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-pdf-001",
    status: "COMPLETED",
    downloadUrl: "https://storage.example.com/report.pdf",
    fileName: "report.pdf",
    fileSize: 98765,
    error: undefined,
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("ExportPDFTool", () => {
  let tool: ExportPDFTool;
  let mockOrchestrator: ReturnType<typeof createMockExportOrchestrator>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrchestrator = createMockExportOrchestrator();
    tool = new ExportPDFTool(
      mockOrchestrator as unknown as ExportOrchestratorService,
    );
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id 'export-pdf'", () => {
      expect(tool.id).toBe("export-pdf");
    });

    it("should have category 'export'", () => {
      expect(tool.category).toBe("export");
    });

    it("should have a non-empty name", () => {
      expect(tool.name.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid title and content", () => {
      expect(
        tool.validateInput({
          title: "Annual Report",
          content: "# Summary\n\nDetails here.",
        }),
      ).toBe(true);
    });

    it("should return false when title is empty", () => {
      expect(tool.validateInput({ title: "", content: "Content" })).toBe(false);
    });

    it("should return false when title is whitespace only", () => {
      expect(tool.validateInput({ title: "  ", content: "Content" })).toBe(
        false,
      );
    });

    it("should return false when content is empty", () => {
      expect(tool.validateInput({ title: "Title", content: "" })).toBe(false);
    });

    it("should return false when content is whitespace only", () => {
      expect(tool.validateInput({ title: "Title", content: "   " })).toBe(
        false,
      );
    });

    it("should return true for valid A4 page size", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          pageSize: "A4",
        }),
      ).toBe(true);
    });

    it("should return true for valid A3 page size", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          pageSize: "A3",
        }),
      ).toBe(true);
    });

    it("should return true for valid Letter page size", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          pageSize: "Letter",
        }),
      ).toBe(true);
    });

    it("should return true for valid Legal page size", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          pageSize: "Legal",
        }),
      ).toBe(true);
    });

    it("should return false for invalid page size", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          pageSize: "B5" as "A4",
        }),
      ).toBe(false);
    });

    it("should return true for valid margins", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          margins: { top: 20, right: 15, bottom: 20, left: 15 },
        }),
      ).toBe(true);
    });

    it("should return false for negative margin value", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          margins: { top: -5 },
        }),
      ).toBe(false);
    });

    it("should return false for non-number margin value", () => {
      expect(
        tool.validateInput({
          title: "Doc",
          content: "Content",
          margins: { top: "20" as unknown as number },
        }),
      ).toBe(false);
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
        { title: "Annual Report", content: "# Section\n\nContent." },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });

    it("should return correct PDF MIME type", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Report", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.mimeType).toBe("application/pdf");
    });

    it("should use fileName from job result", async () => {
      const completedJob = createCompletedJobStatus({
        fileName: "my-report.pdf",
      });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Report", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("my-report.pdf");
    });

    it("should fall back to title-based filename when fileName is missing", async () => {
      const completedJob = createCompletedJobStatus({ fileName: undefined });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Financial Report", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("Financial Report.pdf");
    });

    it("should return fileSize from job result", async () => {
      const completedJob = createCompletedJobStatus({ fileSize: 200000 });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.size).toBe(200000);
    });

    it("should pass ExportFormat.PDF to createExportJob", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      const callArg = mockOrchestrator.createExportJob.mock.calls[0][1] as {
        format: ExportFormat;
      };
      expect(callArg.format).toBe(ExportFormat.PDF);
    });

    it("should use context.userId when calling createExportJob", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext({ userId: "user-abc" }),
      );

      expect(mockOrchestrator.createExportJob.mock.calls[0][0]).toBe(
        "user-abc",
      );
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return success: false when job status is FAILED", async () => {
      const failedJob = {
        jobId: "job-fail-001",
        status: "FAILED",
        downloadUrl: undefined,
        error: "PDF generation error",
      };
      mockOrchestrator.createExportJob.mockResolvedValueOnce(failedJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("PDF generation error");
    });

    it("should return success: false when createExportJob throws", async () => {
      mockOrchestrator.createExportJob.mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Network error");
    });

    it("should return empty strings on error", async () => {
      mockOrchestrator.createExportJob.mockRejectedValueOnce(new Error("fail"));

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
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
        { title: "Doc", content: "Content" },
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
        { title: "Doc", content: "Content" },
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
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.base64Content).toBe("");
    });
  });
});
