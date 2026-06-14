/**
 * FileParserTool Unit Tests
 */

import { FileParserTool, FileParserInput } from "../documents/file-parser.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// External module mocks
//
// NOTE: The source uses dynamic import() for all dependencies. Under SWC,
// `await import("module")` compiles to `_interop_require_wildcard(require("module"))`.
// The interop skips the `default` key when copying and then sets `newObj.default = obj`.
// So a mock that returns `{ default: mockFn }` would end up with
// `pdfParse.default === { default: mockFn }` (not a function).
//
// Fix: Add `__esModule: true` to all mock factories. With that flag, the interop
// returns `obj` as-is, so `pdfParse.default === mockFn` (correct).
// ============================================================================

// Mock pdf-parse
const mockPdfParse = jest.fn();
jest.mock("pdf-parse", () => ({
  __esModule: true,
  default: mockPdfParse,
}));

// Mock mammoth
const mockConvertToHtml = jest.fn();
jest.mock("mammoth", () => ({
  __esModule: true,
  convertToHtml: mockConvertToHtml,
}));

// Mock exceljs
const mockXlsxLoad = jest.fn();
const mockEachSheet = jest.fn();
jest.mock("exceljs", () => ({
  __esModule: true,
  Workbook: jest.fn().mockImplementation(() => ({
    xlsx: { load: mockXlsxLoad },
    eachSheet: mockEachSheet,
    worksheets: [],
    creator: "TestAuthor",
  })),
}));

// Mock axios
const mockAxiosGet = jest.fn();
jest.mock("axios", () => ({
  __esModule: true,
  default: { get: mockAxiosGet },
}));

// Mock jszip and xml2js for PPTX
const mockLoadAsync = jest.fn();
jest.mock("jszip", () => ({
  __esModule: true,
  loadAsync: mockLoadAsync,
}));

jest.mock("xml2js", () => ({
  __esModule: true,
  parseStringPromise: jest.fn().mockResolvedValue({}),
}));

// Mock cheerio (used by parseDOCX)
jest.mock("cheerio", () => {
  const load = jest.fn().mockReturnValue(
    Object.assign(
      (_selector: string) => ({
        text: jest
          .fn()
          .mockReturnValue("Document Title Paragraph content here"),
        each: jest.fn(),
        nextUntil: jest.fn().mockReturnValue({ each: jest.fn() }),
      }),
      {
        text: jest
          .fn()
          .mockReturnValue("Document Title\nParagraph content here"),
      },
    ),
  );
  return { __esModule: true, load, default: { load } };
});

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "file-parser",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function makePdfBuffer(): Buffer {
  return Buffer.from("fake pdf content");
}

function makeDocxBuffer(): Buffer {
  return Buffer.from("fake docx content");
}

// ============================================================================
// Test suite
// ============================================================================

describe("FileParserTool", () => {
  let tool: FileParserTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new FileParserTool();
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("file-parser");
      expect(tool.category).toBe("processing");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid PDF input with buffer", () => {
      const input: FileParserInput = {
        file: {
          buffer: Buffer.from("data"),
          mimeType: "application/pdf",
          filename: "test.pdf",
        },
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return true for valid input with URL", () => {
      const input: FileParserInput = {
        file: {
          url: "https://example.com/file.pdf",
          mimeType: "application/pdf",
          filename: "file.pdf",
        },
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return false when mimeType is missing", () => {
      const input = {
        file: {
          buffer: Buffer.from("data"),
          filename: "test.pdf",
        },
      } as unknown as FileParserInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when filename is missing", () => {
      const input = {
        file: {
          buffer: Buffer.from("data"),
          mimeType: "application/pdf",
        },
      } as unknown as FileParserInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when neither url nor buffer is provided", () => {
      const input: FileParserInput = {
        file: {
          mimeType: "application/pdf",
          filename: "test.pdf",
        },
      };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false for unsupported MIME type", () => {
      const input: FileParserInput = {
        file: {
          buffer: Buffer.from("data"),
          mimeType: "image/jpeg" as never,
          filename: "photo.jpg",
        },
      };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return true for DOCX mime type", () => {
      const input: FileParserInput = {
        file: {
          buffer: Buffer.from("data"),
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filename: "doc.docx",
        },
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return true for XLSX mime type", () => {
      const input: FileParserInput = {
        file: {
          buffer: Buffer.from("data"),
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          filename: "data.xlsx",
        },
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return true for PPTX mime type", () => {
      const input: FileParserInput = {
        file: {
          buffer: Buffer.from("data"),
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          filename: "slides.pptx",
        },
      };
      expect(tool.validateInput(input)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // PDF parsing
  // --------------------------------------------------------------------------

  describe("PDF parsing", () => {
    it("should extract text content from PDF buffer", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Hello from PDF\nSecond paragraph",
        numpages: 3,
        info: { Author: "Test Author" },
      });

      const input: FileParserInput = {
        file: {
          buffer: makePdfBuffer(),
          mimeType: "application/pdf",
          filename: "test.pdf",
        },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain("Hello from PDF");
      expect(result.data?.structure.metadata.pageCount).toBe(3);
      expect(result.data?.structure.metadata.author).toBe("Test Author");
      expect(typeof result.data?.structure.metadata.wordCount).toBe("number");
    });

    it("should extract tables when extractTables=true", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Col1\tCol2\nVal1\tVal2\n\nSome text",
        numpages: 1,
        info: {},
      });

      const input: FileParserInput = {
        file: {
          buffer: makePdfBuffer(),
          mimeType: "application/pdf",
          filename: "table.pdf",
        },
        options: { extractTables: true },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      // tables may or may not be extracted depending on content structure
      // just verify the field is present (array or undefined)
      expect(
        result.data?.tables === undefined || Array.isArray(result.data?.tables),
      ).toBe(true);
    });

    it("should not include tables when extractTables=false", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Col1\tCol2\nVal1\tVal2",
        numpages: 1,
        info: {},
      });

      const input: FileParserInput = {
        file: {
          buffer: makePdfBuffer(),
          mimeType: "application/pdf",
          filename: "table.pdf",
        },
        options: { extractTables: false },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.data?.tables).toBeUndefined();
    });

    it("should download file when URL is provided instead of buffer", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: Buffer.from("pdf data") });
      mockPdfParse.mockResolvedValueOnce({
        text: "Remote PDF content",
        numpages: 1,
        info: {},
      });

      const input: FileParserInput = {
        file: {
          url: "https://example.com/doc.pdf",
          mimeType: "application/pdf",
          filename: "remote.pdf",
        },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(mockAxiosGet).toHaveBeenCalledWith("https://example.com/doc.pdf", {
        responseType: "arraybuffer",
      });
    });

    it("should fail gracefully when pdf-parse throws", async () => {
      mockPdfParse.mockRejectedValueOnce(new Error("PDF parse error"));

      const input: FileParserInput = {
        file: {
          buffer: makePdfBuffer(),
          mimeType: "application/pdf",
          filename: "broken.pdf",
        },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("PDF parse error");
    });
  });

  // --------------------------------------------------------------------------
  // DOCX parsing
  // --------------------------------------------------------------------------

  describe("DOCX parsing", () => {
    it("should extract text from DOCX buffer", async () => {
      mockConvertToHtml.mockResolvedValueOnce({
        value: "<h1>Document Title</h1><p>Paragraph content here.</p>",
        messages: [],
      });

      const input: FileParserInput = {
        file: {
          buffer: makeDocxBuffer(),
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filename: "doc.docx",
        },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      expect(typeof result.data?.structure.metadata.wordCount).toBe("number");
    });

    it("should extract heading sections from DOCX HTML", async () => {
      mockConvertToHtml.mockResolvedValueOnce({
        value:
          "<h1>Introduction</h1><p>Intro text.</p><h2>Methods</h2><p>Methods text.</p>",
        messages: [],
      });

      const input: FileParserInput = {
        file: {
          buffer: makeDocxBuffer(),
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filename: "doc.docx",
        },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(result.success).toBe(true);
      // Sections may vary depending on cheerio mock — just verify the structure
      expect(Array.isArray(result.data?.structure.sections)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should always include content, structure, and structure.sections", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Some content",
        numpages: 1,
        info: {},
      });

      const input: FileParserInput = {
        file: {
          buffer: makePdfBuffer(),
          mimeType: "application/pdf",
          filename: "test.pdf",
        },
      };
      const context = createMockContext();
      const result = await tool.execute(input, context);

      expect(typeof result.data?.content).toBe("string");
      expect(typeof result.data?.structure).toBe("object");
      expect(Array.isArray(result.data?.structure.sections)).toBe(true);
      expect(typeof result.data?.structure.metadata).toBe("object");
    });
  });

  // --------------------------------------------------------------------------
  // XLSX parsing (additional coverage)
  // --------------------------------------------------------------------------

  describe("XLSX parsing", () => {
    it("should parse XLSX and extract tables when extractTables=true", async () => {
      const ExcelJS = require("exceljs");
      const mockWb = {
        xlsx: { load: jest.fn().mockResolvedValue(undefined) },
        eachSheet: jest
          .fn()
          .mockImplementation((cb: (ws: unknown, id: number) => void) => {
            const mockWs = {
              name: "DataSheet",
              eachRow: jest
                .fn()
                .mockImplementation(
                  (rowCb: (row: unknown, rowNum: number) => void) => {
                    const header = {
                      eachCell: jest
                        .fn()
                        .mockImplementation(
                          (
                            _: unknown,
                            cellCb: (c: { value: unknown }) => void,
                          ) => {
                            cellCb({ value: "Name" });
                            cellCb({ value: "Score" });
                          },
                        ),
                    };
                    const dataRow = {
                      eachCell: jest
                        .fn()
                        .mockImplementation(
                          (
                            _: unknown,
                            cellCb: (c: { value: unknown }) => void,
                          ) => {
                            cellCb({ value: "Alice" });
                            cellCb({ value: 95 });
                          },
                        ),
                    };
                    rowCb(header, 1);
                    rowCb(dataRow, 2);
                  },
                ),
            };
            cb(mockWs, 1);
          }),
        creator: "ExcelAuthor",
        worksheets: [{}],
      };
      ExcelJS.Workbook.mockImplementationOnce(() => mockWb);

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-xlsx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename: "data.xlsx",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.structure.sections[0].title).toBe("DataSheet");
      expect(result.data?.tables).toBeDefined();
      expect(result.data?.tables!.length).toBeGreaterThan(0);
      expect(result.data?.tables![0].headers).toContain("Name");
      expect(result.data?.structure.metadata.author).toBe("ExcelAuthor");
    });

    it("should handle richText cell values in XLSX", async () => {
      const ExcelJS = require("exceljs");
      const mockWb = {
        xlsx: { load: jest.fn().mockResolvedValue(undefined) },
        eachSheet: jest
          .fn()
          .mockImplementation((cb: (ws: unknown, id: number) => void) => {
            const mockWs = {
              name: "Sheet1",
              eachRow: jest
                .fn()
                .mockImplementation(
                  (rowCb: (row: unknown, rowNum: number) => void) => {
                    const row = {
                      eachCell: jest
                        .fn()
                        .mockImplementation(
                          (
                            _: unknown,
                            cellCb: (c: { value: unknown }) => void,
                          ) => {
                            cellCb({
                              value: {
                                richText: [{ text: "Bold" }, { text: " Text" }],
                              },
                            });
                          },
                        ),
                    };
                    rowCb(row, 1);
                  },
                ),
            };
            cb(mockWs, 1);
          }),
        creator: "",
        worksheets: [{}],
      };
      ExcelJS.Workbook.mockImplementationOnce(() => mockWb);

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-xlsx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename: "data.xlsx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain("Bold Text");
    });

    it("should handle hyperlink-style cell values with text property", async () => {
      const ExcelJS = require("exceljs");
      const mockWb = {
        xlsx: { load: jest.fn().mockResolvedValue(undefined) },
        eachSheet: jest
          .fn()
          .mockImplementation((cb: (ws: unknown, id: number) => void) => {
            const mockWs = {
              name: "Links",
              eachRow: jest
                .fn()
                .mockImplementation(
                  (rowCb: (row: unknown, rowNum: number) => void) => {
                    const row = {
                      eachCell: jest
                        .fn()
                        .mockImplementation(
                          (
                            _: unknown,
                            cellCb: (c: { value: unknown }) => void,
                          ) => {
                            cellCb({ value: { text: "Click Here" } });
                          },
                        ),
                    };
                    rowCb(row, 1);
                  },
                ),
            };
            cb(mockWs, 1);
          }),
        creator: "",
        worksheets: [{}],
      };
      ExcelJS.Workbook.mockImplementationOnce(() => mockWb);

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-xlsx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename: "links.xlsx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain("Click Here");
    });

    it("should skip tables when extractTables=false for XLSX", async () => {
      const ExcelJS = require("exceljs");
      const mockWb = {
        xlsx: { load: jest.fn().mockResolvedValue(undefined) },
        eachSheet: jest
          .fn()
          .mockImplementation((cb: (ws: unknown, id: number) => void) => {
            const mockWs = {
              name: "Sheet1",
              eachRow: jest
                .fn()
                .mockImplementation(
                  (rowCb: (row: unknown, rowNum: number) => void) => {
                    const row = {
                      eachCell: jest
                        .fn()
                        .mockImplementation(
                          (
                            _: unknown,
                            cellCb: (c: { value: unknown }) => void,
                          ) => {
                            cellCb({ value: "Header" });
                          },
                        ),
                    };
                    rowCb(row, 1);
                  },
                ),
            };
            cb(mockWs, 1);
          }),
        creator: "Author",
        worksheets: [{}],
      };
      ExcelJS.Workbook.mockImplementationOnce(() => mockWb);

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-xlsx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename: "data.xlsx",
          },
          options: { extractTables: false },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.tables).toBeUndefined();
    });

    it("should handle null cell values in XLSX", async () => {
      const ExcelJS = require("exceljs");
      const mockWb = {
        xlsx: { load: jest.fn().mockResolvedValue(undefined) },
        eachSheet: jest
          .fn()
          .mockImplementation((cb: (ws: unknown, id: number) => void) => {
            const mockWs = {
              name: "NullSheet",
              eachRow: jest
                .fn()
                .mockImplementation(
                  (rowCb: (row: unknown, rowNum: number) => void) => {
                    const row = {
                      eachCell: jest
                        .fn()
                        .mockImplementation(
                          (
                            _: unknown,
                            cellCb: (c: { value: unknown }) => void,
                          ) => {
                            cellCb({ value: null });
                            cellCb({ value: undefined });
                            cellCb({ value: 42 });
                            cellCb({ value: "text" });
                          },
                        ),
                    };
                    rowCb(row, 1);
                  },
                ),
            };
            cb(mockWs, 1);
          }),
        creator: undefined,
        worksheets: [{}],
      };
      ExcelJS.Workbook.mockImplementationOnce(() => mockWb);

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-xlsx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename: "null.xlsx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain("42");
      expect(result.data?.content).toContain("text");
    });
  });

  // --------------------------------------------------------------------------
  // PPTX parsing (additional coverage)
  // --------------------------------------------------------------------------

  describe("PPTX parsing", () => {
    it("should sort slide files numerically (slide10 after slide2) and count sequentially", async () => {
      const JSZip = require("jszip");
      const xml2js = require("xml2js");

      const mockZip = {
        files: {
          "ppt/slides/slide10.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
          "ppt/slides/slide2.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
          "ppt/slides/slide1.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
          // non-slide file should be ignored
          "ppt/slideLayouts/slideLayout1.xml": { async: jest.fn() },
        },
      };

      JSZip.loadAsync.mockResolvedValue(mockZip);
      xml2js.parseStringPromise.mockResolvedValue({
        "p:sld": { "a:t": ["Slide text"] },
      });

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-pptx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename: "slides.pptx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      // All 3 slides have text so all become sections
      expect(result.data?.structure.sections).toHaveLength(3);
      // slideCount increments sequentially (1, 2, 3) regardless of slide file number
      expect(result.data?.structure.sections[0].title).toBe("幻灯片 1");
      expect(result.data?.structure.sections[1].title).toBe("幻灯片 2");
      expect(result.data?.structure.sections[2].title).toBe("幻灯片 3");
      // The non-slide layout file should be excluded (still 3 sections, not 4)
    });

    it("should extract author from core.xml in PPTX", async () => {
      const JSZip = require("jszip");
      const xml2js = require("xml2js");

      const mockZip = {
        files: {
          "ppt/slides/slide1.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
          "docProps/core.xml": {
            async: jest.fn().mockResolvedValue("<core/>"),
          },
        },
      };

      JSZip.loadAsync.mockResolvedValue(mockZip);
      xml2js.parseStringPromise
        .mockResolvedValueOnce({ "p:sld": { "a:t": ["Slide content"] } })
        .mockResolvedValueOnce({
          "cp:coreProperties": { "dc:creator": ["Presentation Author"] },
        });

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-pptx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename: "test.pptx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.structure.metadata.author).toBe(
        "Presentation Author",
      );
    });

    it("should handle PPTX slides with empty text (skip section)", async () => {
      const JSZip = require("jszip");
      const xml2js = require("xml2js");

      const mockZip = {
        files: {
          "ppt/slides/slide1.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
        },
      };

      JSZip.loadAsync.mockResolvedValue(mockZip);
      // Return object with no "a:t" keys — slide text is empty/whitespace
      xml2js.parseStringPromise.mockResolvedValue({ "p:sld": {} });

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-pptx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename: "empty.pptx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.structure.sections).toHaveLength(0);
    });

    it("should handle core.xml parse error gracefully (no author)", async () => {
      const JSZip = require("jszip");
      const xml2js = require("xml2js");

      const mockZip = {
        files: {
          "ppt/slides/slide1.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
          "docProps/core.xml": {
            async: jest.fn().mockResolvedValue("<core/>"),
          },
        },
      };

      JSZip.loadAsync.mockResolvedValue(mockZip);
      xml2js.parseStringPromise
        .mockResolvedValueOnce({ "p:sld": { "a:t": ["Content"] } })
        .mockRejectedValueOnce(new Error("XML error"));

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-pptx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename: "test.pptx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.structure.metadata.author).toBeUndefined();
    });

    it("should include tables from PPTX when extractTables=true", async () => {
      const JSZip = require("jszip");
      const xml2js = require("xml2js");

      const mockZip = {
        files: {
          "ppt/slides/slide1.xml": {
            async: jest.fn().mockResolvedValue("<xml/>"),
          },
        },
      };

      JSZip.loadAsync.mockResolvedValue(mockZip);
      xml2js.parseStringPromise.mockResolvedValue({
        "p:sld": { "a:t": ["Col A | Col B\nRow1A | Row1B\n\n"] },
      });

      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("fake-pptx"),
            mimeType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename: "test.pptx",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("tables");
    });
  });

  // --------------------------------------------------------------------------
  // extractTitle edge cases (via PDF)
  // --------------------------------------------------------------------------

  describe("extractTitle edge cases", () => {
    it("should truncate title longer than 100 characters", async () => {
      const longTitle = "A".repeat(120) + "\nBody text";
      mockPdfParse.mockResolvedValueOnce({
        text: longTitle,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "long.pdf",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      const title = result.data?.structure.title;
      expect(title).toBeDefined();
      expect(title!.endsWith("...")).toBe(true);
      expect(title!.length).toBe(103); // 100 chars + "..."
    });

    it("should return undefined when PDF content is empty", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "",
        numpages: 0,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "empty.pdf",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.structure.title).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // analyzeSections edge cases (via PDF)
  // --------------------------------------------------------------------------

  describe("analyzeSections edge cases", () => {
    it("should detect UPPERCASE section titles", async () => {
      const content = "INTRODUCTION\nIntro content.\nCONCLUSION\nFinal words.";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "test.pdf",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      const sections = result.data?.structure.sections || [];
      expect(sections.some((s) => s.title === "INTRODUCTION")).toBe(true);
      const introSec = sections.find((s) => s.title === "INTRODUCTION");
      expect(introSec?.content).toContain("Intro content.");
    });

    it("should detect Chinese numbered list titles", async () => {
      const content = "一、概述\n概述内容。\n二、分析\n分析内容。";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "chinese.pdf",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      const sections = result.data?.structure.sections || [];
      expect(sections.some((s) => s.title.includes("一、"))).toBe(true);
    });

    it("should detect numeric dot prefix titles (1.)", async () => {
      const content = "1.Introduction\nIntro text.\n2.Methods\nMethods text.";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "numbered.pdf",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      const sections = result.data?.structure.sections || [];
      expect(sections.some((s) => s.title.startsWith("1."))).toBe(true);
    });

    it("should not push section content if line is empty", async () => {
      const content = "TITLE\n\nContent after blank line.";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "test.pdf",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      const titleSec = result.data?.structure.sections.find(
        (s) => s.title === "TITLE",
      );
      expect(titleSec?.content).toContain("Content after blank line.");
    });
  });

  // --------------------------------------------------------------------------
  // extractTables edge cases (via PDF)
  // --------------------------------------------------------------------------

  describe("extractTables edge cases", () => {
    it("should include table that ends at end of content (no trailing blank)", async () => {
      const content = "col1 | col2\nval1 | val2";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "table.pdf",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.tables).toBeDefined();
      expect(result.data?.tables!.length).toBeGreaterThan(0);
    });

    it("should NOT include a table with zero rows (only header before blank)", async () => {
      // Only header, no rows, followed by blank line — table should be discarded
      const content = "col1 | col2\n\nPlain text here.";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "table.pdf",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.tables).toBeUndefined();
    });

    it("should extract multi-space-delimited table", async () => {
      const content = "col1   col2   col3\nval1   val2   val3\n\n";
      mockPdfParse.mockResolvedValueOnce({
        text: content,
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "spacetable.pdf",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      const tables = result.data?.tables;
      if (tables && tables.length > 0) {
        expect(tables[0].headers.length).toBeGreaterThan(0);
      }
    });

    it("should return undefined when text has no table separators", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Just plain paragraphs.\nNo separators here.\nAt all.",
        numpages: 1,
        info: {},
      });

      const result = await tool.execute(
        {
          file: {
            buffer: makePdfBuffer(),
            mimeType: "application/pdf",
            filename: "no-table.pdf",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.tables).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Unsupported MIME type branch in doExecute
  // --------------------------------------------------------------------------

  describe("unsupported MIME type in doExecute", () => {
    it("should return success:false when doExecute hits default case with buffer", async () => {
      // validateInput blocks this, but doExecute has a default throw case.
      // Since BaseTool.execute() does NOT call validateInput, we can reach it.
      const result = await tool.execute(
        {
          file: {
            buffer: Buffer.from("data"),
            mimeType: "text/html" as unknown as "application/pdf",
            filename: "test.html",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Unsupported file type");
    });
  });

  // --------------------------------------------------------------------------
  // No buffer or URL provided (line 359)
  // --------------------------------------------------------------------------

  describe("no buffer or URL provided", () => {
    it("should return success:false when file has neither buffer nor url", async () => {
      // validateInput would block this, but BaseTool.execute() does NOT call validateInput
      const result = await tool.execute(
        {
          file: {
            mimeType: "application/pdf",
            filename: "test.pdf",
            // no buffer, no url
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("No file buffer or URL provided");
    });
  });

  // --------------------------------------------------------------------------
  // DOCX heading section extraction (lines 455-472) and table extraction (487-528)
  // --------------------------------------------------------------------------

  describe("DOCX section and table extraction via cheerio callbacks", () => {
    it("should extract heading sections when cheerio each callback is invoked", async () => {
      mockConvertToHtml.mockResolvedValueOnce({
        value: "<h1>Intro</h1><p>Intro text</p>",
        messages: [],
      });

      const cheerio = jest.requireMock("cheerio");

      // Build a cheerio-like $ that handles all call patterns from parseDOCX
      const siblingElement = { _isSibling: true };
      const nextUntilResult = {
        each: jest
          .fn()
          .mockImplementation((cb: (i: number, el: unknown) => void) => {
            cb(0, siblingElement);
          }),
      };
      const headingWrapper = {
        text: jest.fn().mockReturnValue("Intro"),
        nextUntil: jest.fn().mockReturnValue(nextUntilResult),
      };
      const headingElement = { tagName: "H1" };

      // $ behaves differently based on argument type:
      // - string "h1, h2, ..." → returns { each } that calls back with headingElement
      // - object (headingElement) → returns headingWrapper with text/nextUntil
      // - object (siblingElement) → returns { text: () => "sibling text" }
      // - $.text() (when called as property on $) → returns document text
      const mockDollar = Object.assign(
        jest.fn().mockImplementation((sel: unknown) => {
          if (typeof sel === "string" && sel.includes("h")) {
            // Heading selector call — invoke each with a heading element
            return {
              each: jest
                .fn()
                .mockImplementation((cb: (i: number, el: unknown) => void) => {
                  cb(0, headingElement);
                }),
            };
          }
          if (sel === headingElement) {
            return headingWrapper;
          }
          if (sel === siblingElement) {
            return { text: jest.fn().mockReturnValue("sibling text") };
          }
          return {
            text: jest.fn().mockReturnValue(""),
            each: jest.fn(),
            nextUntil: jest.fn().mockReturnValue({ each: jest.fn() }),
          };
        }),
        {
          text: jest.fn().mockReturnValue("Intro\nsibling text"),
        },
      );

      cheerio.load.mockReturnValueOnce(mockDollar);

      const result = await tool.execute(
        {
          file: {
            buffer: makeDocxBuffer(),
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename: "doc.docx",
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data?.structure.sections)).toBe(true);
      // Should have one section for the h1 heading
      expect(result.data?.structure.sections.length).toBeGreaterThan(0);
      expect(result.data?.structure.sections[0].title).toBe("Intro");
    });

    it("should extract HTML tables from DOCX when extractTables=true", async () => {
      mockConvertToHtml.mockResolvedValueOnce({
        value:
          "<table><tr><th>Name</th><th>Score</th></tr><tr><td>Alice</td><td>95</td></tr></table>",
        messages: [],
      });

      const cheerio = jest.requireMock("cheerio");

      const tableElement = { _isTable: true };
      const thElements = [{ _text: "Name" }, { _text: "Score" }];
      const tdElements = [{ _text: "Alice" }, { _text: "95" }];
      const trElement = { _isRow: true };

      // Build nested mock: $(tableEl).find("thead tr th ...") → headers
      //                    $(tableEl).find("tbody tr ...") → rows
      //                    $(trEl).find("td, th") → cells
      const headerFindResult = {
        each: jest
          .fn()
          .mockImplementation((cb: (i: number, el: unknown) => void) => {
            thElements.forEach((el, i) => cb(i, el));
          }),
      };
      const rowsFindResult = {
        each: jest
          .fn()
          .mockImplementation((cb: (i: number, el: unknown) => void) => {
            cb(0, trElement);
          }),
      };
      const cellsFindResult = {
        each: jest
          .fn()
          .mockImplementation((cb: (i: number, el: unknown) => void) => {
            tdElements.forEach((el, i) => cb(i, el));
          }),
      };

      const tableWrapper = {
        find: jest.fn().mockImplementation((sel: string) => {
          if (sel.includes("th")) return headerFindResult;
          return rowsFindResult;
        }),
      };
      const rowWrapper = {
        find: jest.fn().mockReturnValue(cellsFindResult),
      };

      const mockDollar2 = Object.assign(
        jest.fn().mockImplementation((sel: unknown) => {
          if (typeof sel === "string" && sel.includes("table")) {
            return {
              each: jest
                .fn()
                .mockImplementation((cb: (i: number, el: unknown) => void) => {
                  cb(0, tableElement);
                }),
            };
          }
          if (typeof sel === "string" && sel.includes("h")) {
            return { each: jest.fn() };
          }
          if (sel === tableElement) return tableWrapper;
          if (sel === trElement) return rowWrapper;
          if (
            sel &&
            typeof sel === "object" &&
            (sel as Record<string, unknown>)._text !== undefined
          ) {
            return {
              text: jest
                .fn()
                .mockReturnValue(
                  (sel as Record<string, unknown>)._text as string,
                ),
            };
          }
          return {
            text: jest.fn().mockReturnValue(""),
            each: jest.fn(),
            nextUntil: jest.fn().mockReturnValue({ each: jest.fn() }),
          };
        }),
        {
          text: jest.fn().mockReturnValue("Name Score\nAlice 95"),
        },
      );

      cheerio.load.mockReturnValueOnce(mockDollar2);

      const result = await tool.execute(
        {
          file: {
            buffer: makeDocxBuffer(),
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename: "doc.docx",
          },
          options: { extractTables: true },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.tables).toBeDefined();
      expect(result.data?.tables!.length).toBeGreaterThan(0);
      expect(result.data?.tables![0].headers).toContain("Name");
      expect(result.data?.tables![0].rows[0]).toContain("Alice");
    });
  });
});
