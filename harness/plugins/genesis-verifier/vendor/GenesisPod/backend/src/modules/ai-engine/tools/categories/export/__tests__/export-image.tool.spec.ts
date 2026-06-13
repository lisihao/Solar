import { ExportImageTool } from "../export-image.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock sharp — jest.mock is hoisted, so the factory must be self-contained
//
// The source uses `import * as sharp from "sharp"` (namespace import).
// Under SWC compilation this becomes an interop that calls sharp.default(...)
// So the mock must expose the mock function both as the module export AND
// as the `default` property of the namespace object.
// ============================================================================

jest.mock("sharp", () => {
  const mockToBuffer = jest
    .fn()
    .mockResolvedValue(Buffer.from("fake-image-data"));
  const instance: Record<string, jest.Mock> = {
    resize: jest.fn(),
    png: jest.fn().mockReturnValue({ toBuffer: mockToBuffer }),
    jpeg: jest.fn().mockReturnValue({ toBuffer: mockToBuffer }),
    webp: jest.fn().mockReturnValue({ toBuffer: mockToBuffer }),
    flatten: jest.fn().mockReturnValue({
      jpeg: jest.fn().mockReturnValue({ toBuffer: mockToBuffer }),
    }),
    toBuffer: mockToBuffer,
  };
  instance.resize.mockReturnValue(instance);
  const sharpFn = jest.fn().mockReturnValue(instance);
  // Attach instance reference so tests can inspect calls
  (sharpFn as jest.Mock & { _instance: typeof instance })._instance = instance;
  // SWC compiles `import * as sharp from "sharp"` with _interop_require_wildcard.
  // When the factory result has __esModule=true, interop returns the object as-is,
  // so calling _sharp(...) calls sharpFn directly (it's a function with __esModule).
  Object.defineProperty(sharpFn, "__esModule", { value: true });
  Object.assign(sharpFn, { default: sharpFn, _instance: instance });
  return sharpFn;
});

// ============================================================================
// Mock puppeteer — used for HTML content path
// ============================================================================

// Mock PuppeteerPoolService
const mockPage = {
  setViewport: jest.fn().mockResolvedValue(undefined),
  setContent: jest.fn().mockResolvedValue(undefined),
  screenshot: jest.fn().mockResolvedValue(Buffer.from("screenshot-data")),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
};
const mockPuppeteerPool = {
  getBrowser: jest.fn().mockResolvedValue(mockBrowser),
};

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "export-image",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>`;
const SAMPLE_HTML = `<div><h1>Hello World</h1><p>Some content here</p></div>`;

// ============================================================================
// Test suite
// ============================================================================

describe("ExportImageTool", () => {
  let tool: ExportImageTool;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let sharpMock: jest.Mock & { _instance: Record<string, jest.Mock> };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharpMock = require("sharp") as jest.Mock & {
      _instance: Record<string, jest.Mock>;
    };

    // Reset the toBuffer mock on the instance to return fresh buffer
    const toBuffer = sharpMock._instance.toBuffer;
    toBuffer.mockResolvedValue(Buffer.from("fake-image-data"));
    sharpMock._instance.png.mockReturnValue({ toBuffer });
    sharpMock._instance.jpeg.mockReturnValue({ toBuffer });
    sharpMock._instance.webp.mockReturnValue({ toBuffer });
    sharpMock._instance.flatten.mockReturnValue({
      jpeg: jest.fn().mockReturnValue({ toBuffer }),
    });
    sharpMock._instance.resize.mockReturnValue(sharpMock._instance);
    sharpMock.mockReturnValue(sharpMock._instance);
    // Keep default in sync
    sharpMock.default = sharpMock;

    tool = new ExportImageTool(mockPuppeteerPool as any);
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id 'export-image'", () => {
      expect(tool.id).toBe("export-image");
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
    it("should return true for valid SVG content", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG })).toBe(true);
    });

    it("should return true for valid HTML content", () => {
      expect(tool.validateInput({ content: SAMPLE_HTML })).toBe(true);
    });

    it("should return false when content is empty", () => {
      expect(tool.validateInput({ content: "" })).toBe(false);
    });

    it("should return false when content is whitespace only", () => {
      expect(tool.validateInput({ content: "   " })).toBe(false);
    });

    it("should return true with valid PNG format", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, format: "png" })).toBe(
        true,
      );
    });

    it("should return true with valid JPEG format", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, format: "jpeg" })).toBe(
        true,
      );
    });

    it("should return true with valid WebP format", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, format: "webp" })).toBe(
        true,
      );
    });

    it("should return false for unsupported format", () => {
      expect(
        tool.validateInput({ content: SAMPLE_SVG, format: "bmp" as "png" }),
      ).toBe(false);
    });

    it("should return false when width is zero", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, width: 0 })).toBe(false);
    });

    it("should return false when width is negative", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, width: -100 })).toBe(
        false,
      );
    });

    it("should return false when height is zero", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, height: 0 })).toBe(
        false,
      );
    });

    it("should return false when quality is below 1", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, quality: 0 })).toBe(
        false,
      );
    });

    it("should return false when quality exceeds 100", () => {
      expect(tool.validateInput({ content: SAMPLE_SVG, quality: 101 })).toBe(
        false,
      );
    });

    it("should return true when valid dimensions and quality are provided", () => {
      expect(
        tool.validateInput({
          content: SAMPLE_SVG,
          width: 800,
          height: 600,
          quality: 90,
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SVG happy paths
  // --------------------------------------------------------------------------

  describe("SVG conversion", () => {
    it("should return success: true for SVG content", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });

    it("should default to PNG format", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.data?.filename).toMatch(/\.png$/);
      expect(result.data?.mimeType).toBe("image/png");
    });

    it("should use custom filename when provided", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG, filename: "my-chart" },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("my-chart.png");
    });

    it("should return JPEG MIME type when format is jpeg", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG, format: "jpeg" },
        createMockContext(),
      );

      expect(result.data?.mimeType).toBe("image/jpeg");
      expect(result.data?.filename).toMatch(/\.jpeg$/);
    });

    it("should return WebP MIME type when format is webp", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG, format: "webp" },
        createMockContext(),
      );

      expect(result.data?.mimeType).toBe("image/webp");
      expect(result.data?.filename).toMatch(/\.webp$/);
    });

    it("should return base64Content in output", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.data?.base64Content).toBeTruthy();
      expect(typeof result.data?.base64Content).toBe("string");
    });

    it("should return size > 0 for valid output", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.data?.size).toBeGreaterThan(0);
    });

    it("should call sharp.resize when width and height are provided", async () => {
      await tool.execute(
        { content: SAMPLE_SVG, width: 800, height: 600 },
        createMockContext(),
      );

      expect(sharpMock._instance.resize).toHaveBeenCalledWith(
        800,
        600,
        expect.any(Object),
      );
    });
  });

  // --------------------------------------------------------------------------
  // HTML happy paths
  // --------------------------------------------------------------------------

  describe("HTML conversion", () => {
    it("should detect HTML content and use puppeteer pool", async () => {
      const result = await tool.execute(
        { content: SAMPLE_HTML },
        createMockContext(),
      );

      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalled();
      expect(result.data?.success).toBe(true);
    });

    it("should set viewport when width and height are provided for HTML", async () => {
      await tool.execute(
        { content: SAMPLE_HTML, width: 1024, height: 768 },
        createMockContext(),
      );

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 1024,
        height: 768,
      });
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return success: false when sharp throws", async () => {
      sharpMock.mockImplementationOnce(() => {
        throw new Error("sharp processing error");
      });
      sharpMock.default = sharpMock;

      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("sharp processing error");
    });

    it("should return empty strings on error", async () => {
      sharpMock.mockImplementationOnce(() => {
        throw new Error("fail");
      });
      sharpMock.default = sharpMock;

      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.data?.filename).toBe("");
      expect(result.data?.mimeType).toBe("");
      expect(result.data?.size).toBe(0);
      expect(result.data?.base64Content).toBe("");
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should always include all required output fields", async () => {
      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result.data).toHaveProperty("filename");
      expect(result.data).toHaveProperty("mimeType");
      expect(result.data).toHaveProperty("size");
      expect(result.data).toHaveProperty("base64Content");
      expect(result.data).toHaveProperty("success");
    });

    it("should return outer result.success property", async () => {
      sharpMock.mockImplementationOnce(() => {
        throw new Error("fail");
      });
      sharpMock.default = sharpMock;

      const result = await tool.execute(
        { content: SAMPLE_SVG },
        createMockContext(),
      );

      expect(result).toHaveProperty("success");
    });
  });
});
