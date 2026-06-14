import { ExportDOCXTool } from "../export-docx.tool";
import { ExportOrchestratorService } from "@/common/export";
import { ToolContext } from "../../../abstractions/tool.interface";

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
    toolId: "export-docx",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function createCompletedJobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-001",
    status: "COMPLETED",
    downloadUrl: "https://storage.example.com/file.docx",
    fileName: "test-doc.docx",
    fileSize: 12345,
    error: undefined,
    ...overrides,
  };
}

function createPendingJobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-001",
    status: "PENDING",
    downloadUrl: undefined,
    fileName: undefined,
    fileSize: undefined,
    error: undefined,
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("ExportDOCXTool", () => {
  let tool: ExportDOCXTool;
  let mockOrchestrator: ReturnType<typeof createMockExportOrchestrator>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrchestrator = createMockExportOrchestrator();
    tool = new ExportDOCXTool(
      mockOrchestrator as unknown as ExportOrchestratorService,
    );
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id 'export-docx'", () => {
      expect(tool.id).toBe("export-docx");
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
        tool.validateInput({ title: "My Document", content: "# Hello World" }),
      ).toBe(true);
    });

    it("should return false when title is empty string", () => {
      expect(tool.validateInput({ title: "", content: "Some content" })).toBe(
        false,
      );
    });

    it("should return false when title is whitespace only", () => {
      expect(
        tool.validateInput({ title: "   ", content: "Some content" }),
      ).toBe(false);
    });

    it("should return false when content is empty string", () => {
      expect(tool.validateInput({ title: "My Doc", content: "" })).toBe(false);
    });

    it("should return false when content is whitespace only", () => {
      expect(tool.validateInput({ title: "My Doc", content: "   " })).toBe(
        false,
      );
    });

    it("should return true with optional fields provided", () => {
      expect(
        tool.validateInput({
          title: "Report",
          content: "Content here",
          author: "John",
          company: "Acme",
          templateId: "tmpl-001",
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Happy path
  // --------------------------------------------------------------------------

  describe("happy path - completed export", () => {
    it("should return success: true when job completes immediately", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Test Document", content: "# Hello\n\nThis is a test." },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });

    it("should return correct MIME type for DOCX", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    });

    it("should use fileName from job result when available", async () => {
      const completedJob = createCompletedJobStatus({
        fileName: "custom-name.docx",
      });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("custom-name.docx");
    });

    it("should fall back to title-based filename when fileName is not provided", async () => {
      const completedJob = createCompletedJobStatus({ fileName: undefined });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "My Report", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("My Report.docx");
    });

    it("should return fileSize from job result", async () => {
      const completedJob = createCompletedJobStatus({ fileSize: 54321 });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.size).toBe(54321);
    });

    it("should pass templateId to createExportJob when provided", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Doc", content: "Content", templateId: "tmpl-xyz" },
        createMockContext(),
      );

      const callArg = mockOrchestrator.createExportJob.mock.calls[0][1] as {
        templateId?: string;
      };
      expect(callArg.templateId).toBe("tmpl-xyz");
    });

    it("should use context.userId when calling createExportJob", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext({ userId: "specific-user-456" }),
      );

      expect(mockOrchestrator.createExportJob.mock.calls[0][0]).toBe(
        "specific-user-456",
      );
    });

    it("should use 'system' as userId when context.userId is not set", async () => {
      const completedJob = createCompletedJobStatus();
      mockOrchestrator.createExportJob.mockResolvedValueOnce(completedJob);

      await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext({ userId: undefined }),
      );

      expect(mockOrchestrator.createExportJob.mock.calls[0][0]).toBe("system");
    });
  });

  // --------------------------------------------------------------------------
  // Failed / timed-out export
  // --------------------------------------------------------------------------

  describe("failed export", () => {
    it("should return success: false when job status is FAILED", async () => {
      const failedJob = {
        jobId: "job-002",
        status: "FAILED",
        downloadUrl: undefined,
        fileName: undefined,
        fileSize: undefined,
        error: "Internal export error",
      };
      mockOrchestrator.createExportJob.mockResolvedValueOnce(failedJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeTruthy();
    });

    it("should return success: false when COMPLETED but no downloadUrl", async () => {
      const noUrlJob = createCompletedJobStatus({ downloadUrl: undefined });
      mockOrchestrator.createExportJob.mockResolvedValueOnce(noUrlJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
    });

    it("should return success: false and error message when createExportJob throws", async () => {
      mockOrchestrator.createExportJob.mockRejectedValueOnce(
        new Error("Service unavailable"),
      );

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Service unavailable");
    });

    it("should return empty strings for filename/mimeType on error", async () => {
      mockOrchestrator.createExportJob.mockRejectedValueOnce(new Error("fail"));

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("");
      expect(result.data?.mimeType).toBe("");
      expect(result.data?.size).toBe(0);
    });

    it("should use 'Export timed out' message when job has no error field", async () => {
      const timedOutJob = {
        jobId: "job-003",
        status: "FAILED",
        downloadUrl: undefined,
        error: undefined,
      };
      mockOrchestrator.createExportJob.mockResolvedValueOnce(timedOutJob);

      const result = await tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
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

    it("should poll getJobStatus when initial status is not terminal", async () => {
      const pendingJob = createPendingJobStatus({ jobId: "job-poll-001" });
      const completedJob = createCompletedJobStatus({ jobId: "job-poll-001" });

      mockOrchestrator.createExportJob.mockResolvedValueOnce(pendingJob);
      mockOrchestrator.getJobStatus.mockResolvedValueOnce(completedJob);

      jest.useFakeTimers();

      const executePromise = tool.execute(
        { title: "Doc", content: "Content" },
        createMockContext(),
      );

      // Advance through the polling delay
      await jest.runAllTimersAsync();

      const result = await executePromise;

      jest.useRealTimers();

      expect(mockOrchestrator.getJobStatus).toHaveBeenCalled();
      expect(result.data?.success).toBe(true);
    });
  });
});
