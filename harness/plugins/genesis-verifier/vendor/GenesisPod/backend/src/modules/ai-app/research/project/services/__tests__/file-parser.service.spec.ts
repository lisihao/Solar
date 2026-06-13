import { BadRequestException } from "@nestjs/common";
import { FileParserService } from "../file-parser.service";
import type { ObjectStorageService } from "../../../../../platform/storage/object-store/object-storage.service";

// Mock pdf-parse
jest.mock("pdf-parse", () =>
  jest.fn().mockResolvedValue({
    text: "PDF extracted text\nSecond line\nThird line",
    numpages: 3,
    info: { Author: "Test Author" },
  }),
);

// Mock mammoth
jest.mock("mammoth", () => ({
  extractRawText: jest.fn().mockResolvedValue({
    value: "Word document extracted text\nParagraph two",
  }),
}));

function createMockR2Storage(enabled = false) {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    uploadBuffer: jest.fn().mockResolvedValue({
      success: true,
      url: "https://storage.example.com/file.pdf",
      key: "ai-studio/files/user-1/file.pdf",
    }),
  } as unknown as jest.Mocked<ObjectStorageService>;
}

function createMockFile(
  mimetype: string,
  originalname: string,
  content: string = "file content here",
): Express.Multer.File {
  return {
    buffer: Buffer.from(content),
    mimetype,
    originalname,
    size: Buffer.byteLength(content),
    fieldname: "files",
    encoding: "7bit",
    destination: "",
    filename: originalname,
    path: "",
    stream: null as never,
  };
}

describe("FileParserService", () => {
  let service: FileParserService;
  let mockR2Storage: jest.Mocked<ObjectStorageService>;

  beforeEach(() => {
    mockR2Storage = createMockR2Storage(false);
    service = new FileParserService(
      mockR2Storage as unknown as ObjectStorageService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("parseFile - PDF", () => {
    it("should parse PDF file and return structured content", async () => {
      const file = createMockFile("application/pdf", "test.pdf");

      const result = await service.parseFile(file, "user-1");

      expect(result.title).toBe("PDF extracted text");
      expect(result.content).toContain("PDF extracted text");
      expect(result.metadata.pageCount).toBe(3);
      expect(result.metadata.author).toBe("Test Author");
      expect(result.metadata.mimeType).toBe("application/pdf");
      expect(result.metadata.fileSize).toBeGreaterThan(0);
    });

    it("should generate abstract from PDF content", async () => {
      const file = createMockFile("application/pdf", "test.pdf");

      const result = await service.parseFile(file);

      expect(result.abstract).toBeDefined();
      expect(result.abstract).toContain("...");
    });

    it("should throw BadRequestException when PDF parsing fails", async () => {
      const pdfParse = require("pdf-parse");
      pdfParse.mockRejectedValueOnce(new Error("Invalid PDF"));

      const file = createMockFile("application/pdf", "corrupt.pdf");

      await expect(service.parseFile(file)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("parseFile - Word (DOCX)", () => {
    it("should parse DOCX file successfully", async () => {
      const file = createMockFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "test.docx",
      );

      const result = await service.parseFile(file, "user-1");

      expect(result.title).toBe("Word document extracted text");
      expect(result.content).toContain("Word document extracted text");
      expect(result.metadata.mimeType).toContain("wordprocessingml");
      expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it("should parse legacy DOC file", async () => {
      const file = createMockFile("application/msword", "legacy.doc");

      const result = await service.parseFile(file);

      expect(result.content).toContain("Word document extracted text");
    });

    it("should throw BadRequestException when Word parsing fails", async () => {
      const mammoth = require("mammoth");
      mammoth.extractRawText.mockRejectedValueOnce(
        new Error("Invalid Word document"),
      );

      const file = createMockFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "corrupt.docx",
      );

      await expect(service.parseFile(file)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("parseFile - Text", () => {
    it("should parse plain text file", async () => {
      const textContent = "First line of text\nSecond line\nThird line";
      const file = createMockFile("text/plain", "notes.txt", textContent);

      const result = await service.parseFile(file);

      expect(result.title).toBe("First line of text");
      expect(result.content).toBe(textContent);
      expect(result.metadata.mimeType).toBe("text/plain");
      expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it("should parse markdown file", async () => {
      const mdContent = "# Markdown Title\n\nParagraph content here\n";
      const file = createMockFile("text/markdown", "readme.md", mdContent);

      const result = await service.parseFile(file);

      expect(result.title).toBe("# Markdown Title");
      expect(result.content).toBe(mdContent);
    });

    it("should handle text file with .md extension via content type text/plain", async () => {
      const mdContent = "# Title\n\nContent";
      const file = createMockFile("text/plain", "notes.md", mdContent);

      const result = await service.parseFile(file);

      expect(result.content).toBe(mdContent);
    });

    it("should use originalname as title when content is empty", async () => {
      const file = createMockFile("text/plain", "empty.txt", "");

      const result = await service.parseFile(file);

      expect(result.title).toBe("empty.txt");
    });

    it("should generate abstract from text content", async () => {
      const longContent = "A".repeat(600);
      const file = createMockFile("text/plain", "long.txt", longContent);

      const result = await service.parseFile(file);

      expect(result.abstract).toBeDefined();
      expect(result.abstract).toContain("...");
    });
  });

  describe("parseFile - unsupported type", () => {
    it("should throw BadRequestException for unsupported MIME type", async () => {
      const file = createMockFile("image/png", "photo.png");

      await expect(service.parseFile(file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException for application/zip", async () => {
      const file = createMockFile("application/zip", "archive.zip");

      await expect(service.parseFile(file)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("parseFile - with R2 storage enabled", () => {
    beforeEach(() => {
      mockR2Storage.isEnabled.mockReturnValue(true);
    });

    it("should upload file to R2 and include URL in result", async () => {
      const file = createMockFile("text/plain", "upload.txt", "Hello world");

      const result = await service.parseFile(file, "user-upload");

      expect(mockR2Storage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        "ai-studio/files/user-upload",
        "upload.txt",
        "text/plain",
      );
      expect(result.fileUrl).toBe("https://storage.example.com/file.pdf");
      expect(result.metadata.storageKey).toBe(
        "ai-studio/files/user-1/file.pdf",
      );
    });

    it("should use anonymous prefix when userId is absent", async () => {
      const file = createMockFile("text/plain", "anon.txt", "Content");

      await service.parseFile(file);

      expect(mockR2Storage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        "ai-studio/files/anonymous",
        "anon.txt",
        "text/plain",
      );
    });

    it("should continue parsing even when R2 upload fails", async () => {
      mockR2Storage.uploadBuffer.mockResolvedValue({
        success: false,
        error: "R2 upload failed",
        url: undefined,
        key: undefined,
      });

      const file = createMockFile("text/plain", "fallback.txt", "Content");

      const result = await service.parseFile(file, "user-1");

      expect(result.content).toBe("Content");
      expect(result.fileUrl).toBeUndefined();
    });
  });

  describe("parseFile - .md extension detection", () => {
    it("should detect markdown by .md extension with text/plain MIME", async () => {
      const file = createMockFile("text/plain", "notes.md", "# Title\nContent");

      const result = await service.parseFile(file);

      expect(result.content).toContain("# Title");
    });
  });

  describe("word count calculation", () => {
    it("should calculate word count correctly for text files", async () => {
      const text = "one two three four five";
      const file = createMockFile("text/plain", "words.txt", text);

      const result = await service.parseFile(file);

      expect(result.metadata.wordCount).toBe(5);
    });
  });
});
