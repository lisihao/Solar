import { OCRRecognitionTool } from "../ocr-recognition.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock tesseract.js — jest.mock is hoisted, factory must be self-contained
// ============================================================================

jest.mock("tesseract.js", () => {
  const recognize = jest.fn();
  return {
    __esModule: true,
    default: { recognize },
    recognize,
  };
});

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "ocr-recognition",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildTesseractResult(
  overrides: {
    text?: string;
    confidence?: number;
    lines?: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
    words?: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
    imageSize?: { width: number; height: number };
  } = {},
) {
  return {
    data: {
      text: overrides.text ?? "Hello World\nThis is a test document.",
      confidence: overrides.confidence ?? 87.5,
      lines: overrides.lines ?? [
        {
          text: "Hello World",
          confidence: 90,
          bbox: { x0: 10, y0: 10, x1: 200, y1: 30 },
        },
        {
          text: "This is a test document.",
          confidence: 85,
          bbox: { x0: 10, y0: 40, x1: 300, y1: 60 },
        },
      ],
      words: overrides.words ?? [
        {
          text: "Hello",
          confidence: 92,
          bbox: { x0: 10, y0: 10, x1: 80, y1: 30 },
        },
        {
          text: "World",
          confidence: 88,
          bbox: { x0: 90, y0: 10, x1: 200, y1: 30 },
        },
      ],
      imageSize: overrides.imageSize ?? { width: 800, height: 600 },
    },
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("OCRRecognitionTool", () => {
  let tool: OCRRecognitionTool;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let Tesseract: { recognize: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Tesseract = require("tesseract.js");
    Tesseract.recognize.mockResolvedValue(buildTesseractResult());
    tool = new OCRRecognitionTool();
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id 'ocr-recognition'", () => {
      expect(tool.id).toBe("ocr-recognition");
    });

    it("should have category 'execution'", () => {
      expect(tool.category).toBe("execution");
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
    it("should return true when image.url is provided", () => {
      expect(
        tool.validateInput({ image: { url: "https://example.com/image.png" } }),
      ).toBe(true);
    });

    it("should return true when image.base64 is provided", () => {
      expect(tool.validateInput({ image: { base64: "aGVsbG8=" } })).toBe(true);
    });

    it("should return true when image.path is provided", () => {
      expect(tool.validateInput({ image: { path: "/tmp/scan.jpg" } })).toBe(
        true,
      );
    });

    it("should return false when image object is missing all sources", () => {
      expect(tool.validateInput({ image: {} })).toBe(false);
    });

    it("should return false when image is null", () => {
      expect(
        tool.validateInput({ image: null as unknown as { url?: string } }),
      ).toBe(false);
    });

    it("should return true with options provided", () => {
      expect(
        tool.validateInput({
          image: { url: "https://example.com/doc.png" },
          options: { language: "eng", detailed: true, minConfidence: 50 },
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Happy path - URL source
  // --------------------------------------------------------------------------

  describe("happy path - URL source", () => {
    it("should return success: true for URL-based image", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });

    it("should return extracted text", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data?.text).toBe("Hello World\nThis is a test document.");
    });

    it("should call tesseract.recognize with the image URL", async () => {
      await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(Tesseract.recognize).toHaveBeenCalledWith(
        "https://example.com/scan.png",
        expect.any(String),
        expect.any(Object),
      );
    });

    it("should use default language 'eng+chi_sim' when not specified", async () => {
      await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(Tesseract.recognize).toHaveBeenCalledWith(
        expect.any(String),
        "eng+chi_sim",
        expect.any(Object),
      );
    });

    it("should use custom language when specified", async () => {
      await tool.execute(
        {
          image: { url: "https://example.com/scan.png" },
          options: { language: "jpn" },
        },
        createMockContext(),
      );

      expect(Tesseract.recognize).toHaveBeenCalledWith(
        expect.any(String),
        "jpn",
        expect.any(Object),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Happy path - base64 source
  // --------------------------------------------------------------------------

  describe("happy path - base64 source", () => {
    it("should return success: true for base64-based image", async () => {
      const result = await tool.execute(
        { image: { base64: "aGVsbG8gd29ybGQ=" } },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
    });

    it("should call tesseract.recognize with the base64 data", async () => {
      await tool.execute(
        { image: { base64: "aGVsbG8=" } },
        createMockContext(),
      );

      expect(Tesseract.recognize).toHaveBeenCalledWith(
        "aGVsbG8=",
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Detailed results
  // --------------------------------------------------------------------------

  describe("detailed results", () => {
    it("should return details when detailed is true (default)", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data?.details).toBeDefined();
      expect(result.data?.details?.confidence).toBe(87.5);
    });

    it("should return lines in details", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(Array.isArray(result.data?.details?.lines)).toBe(true);
      expect(result.data?.details?.lines.length).toBeGreaterThan(0);
    });

    it("should return words in details", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(Array.isArray(result.data?.details?.words)).toBe(true);
      expect(result.data?.details?.words.length).toBeGreaterThan(0);
    });

    it("should not include details when detailed is false", async () => {
      const result = await tool.execute(
        {
          image: { url: "https://example.com/scan.png" },
          options: { detailed: false },
        },
        createMockContext(),
      );

      expect(result.data?.details).toBeUndefined();
    });

    it("should filter words by minConfidence", async () => {
      Tesseract.recognize.mockResolvedValueOnce(
        buildTesseractResult({
          words: [
            {
              text: "High",
              confidence: 95,
              bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
            },
            {
              text: "Low",
              confidence: 20,
              bbox: { x0: 60, y0: 0, x1: 100, y1: 20 },
            },
          ],
        }),
      );

      const result = await tool.execute(
        {
          image: { url: "https://example.com/scan.png" },
          options: { minConfidence: 50 },
        },
        createMockContext(),
      );

      const words = result.data?.details?.words || [];
      expect(words.every((w) => w.confidence >= 50)).toBe(true);
    });

    it("should return imageSize metadata when available", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data?.metadata?.imageSize).toEqual({
        width: 800,
        height: 600,
      });
    });

    it("should return language in metadata", async () => {
      const result = await tool.execute(
        {
          image: { url: "https://example.com/scan.png" },
          options: { language: "chi_sim" },
        },
        createMockContext(),
      );

      expect(result.data?.metadata?.language).toBe("chi_sim");
    });

    it("should return processingTime >= 0", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data?.processingTime).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return success: false when tesseract throws", async () => {
      Tesseract.recognize.mockRejectedValueOnce(
        new Error("Tesseract failed to load language"),
      );

      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Tesseract failed to load language");
    });

    it("should return empty text on error", async () => {
      Tesseract.recognize.mockRejectedValueOnce(new Error("OCR error"));

      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data?.text).toBe("");
    });

    it("should still return processingTime on error", async () => {
      Tesseract.recognize.mockRejectedValueOnce(new Error("fail"));

      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(typeof result.data?.processingTime).toBe("number");
    });

    it("should return language in metadata even on error", async () => {
      Tesseract.recognize.mockRejectedValueOnce(new Error("fail"));

      const result = await tool.execute(
        {
          image: { url: "https://example.com/scan.png" },
          options: { language: "eng" },
        },
        createMockContext(),
      );

      expect(result.data?.metadata?.language).toBe("eng");
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should always include all required output fields", async () => {
      const result = await tool.execute(
        { image: { url: "https://example.com/scan.png" } },
        createMockContext(),
      );

      expect(result.data).toHaveProperty("success");
      expect(result.data).toHaveProperty("text");
      expect(result.data).toHaveProperty("processingTime");
      expect(result.data).toHaveProperty("metadata");
    });
  });
});
