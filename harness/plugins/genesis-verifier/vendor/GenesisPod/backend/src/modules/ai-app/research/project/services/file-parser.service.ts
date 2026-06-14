import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ObjectStorageService } from "../../../../platform/facade";

interface ParsedFile {
  title: string;
  content: string;
  abstract?: string;
  fileUrl?: string; // BackBlaze 存储的文件 URL
  metadata: {
    pageCount?: number;
    wordCount?: number;
    author?: string;
    fileSize: number;
    mimeType: string;
    storageKey?: string; // BackBlaze 存储的 key
  };
}

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  constructor(private readonly r2Storage: ObjectStorageService) {}

  // Supported file types
  private readonly SUPPORTED_TYPES: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/msword": "doc",
    "text/plain": "txt",
    "text/markdown": "md",
  };

  async parseFile(
    file: Express.Multer.File,
    userId?: string,
  ): Promise<ParsedFile> {
    const fileType =
      this.SUPPORTED_TYPES[file.mimetype] ||
      (file.originalname.endsWith(".md") ? "md" : null);

    if (!fileType) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    this.logger.log(
      `Parsing ${fileType} file: ${file.originalname} (${file.size} bytes)`,
    );

    // 1. 先上传原文件到 BackBlaze
    let fileUrl: string | undefined;
    let storageKey: string | undefined;

    if (this.r2Storage.isEnabled()) {
      const prefix = userId
        ? `ai-studio/files/${userId}`
        : "ai-studio/files/anonymous";
      const result = await this.r2Storage.uploadBuffer(
        file.buffer,
        prefix,
        file.originalname,
        file.mimetype,
      );

      if (result.success && result.url) {
        fileUrl = result.url;
        storageKey = result.key;
        this.logger.log(`File uploaded to BackBlaze: ${result.key}`);
      } else {
        this.logger.warn(`Failed to upload to BackBlaze: ${result.error}`);
      }
    }

    // 2. 解析文件内容
    let parsed: ParsedFile;

    switch (fileType) {
      case "pdf":
        parsed = await this.parsePdf(file);
        break;
      case "docx":
      case "doc":
        parsed = await this.parseWord(file);
        break;
      case "txt":
      case "md":
        parsed = this.parseText(file);
        break;
      default:
        throw new BadRequestException(
          `Parser not implemented for: ${fileType}`,
        );
    }

    // 3. 添加文件 URL 和存储信息
    parsed.fileUrl = fileUrl;
    parsed.metadata.storageKey = storageKey;

    return parsed;
  }

  private async parsePdf(file: Express.Multer.File): Promise<ParsedFile> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParser = require("pdf-parse");
      const data = await pdfParser(file.buffer);

      // Extract title from first line or filename
      const lines = data.text.split("\n").filter((l: string) => l.trim());
      const title =
        lines[0]?.substring(0, 200) || file.originalname.replace(".pdf", "");

      // Generate abstract from first 500 chars
      const abstract = data.text.substring(0, 500).trim() + "...";

      return {
        title,
        content: data.text,
        abstract,
        metadata: {
          pageCount: data.numpages,
          wordCount: data.text.split(/\s+/).length,
          author: data.info?.Author || undefined,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to parse PDF: ${errMsg}`);
      throw new BadRequestException(`Failed to parse PDF: ${errMsg}`);
    }
  }

  private async parseWord(file: Express.Multer.File): Promise<ParsedFile> {
    // Use mammoth for .docx files
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const text = result.value;

      const lines = text.split("\n").filter((l: string) => l.trim());
      const title =
        lines[0]?.substring(0, 200) ||
        file.originalname.replace(/\.(docx?|doc)$/, "");

      return {
        title,
        content: text,
        abstract: text.substring(0, 500).trim() + "...",
        metadata: {
          wordCount: text.split(/\s+/).length,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to parse Word document: ${errMsg}`);
      throw new BadRequestException(`Failed to parse Word document: ${errMsg}`);
    }
  }

  private parseText(file: Express.Multer.File): ParsedFile {
    const text = file.buffer.toString("utf-8");
    const lines = text.split("\n").filter((l: string) => l.trim());
    const title = lines[0]?.substring(0, 200) || file.originalname;

    return {
      title,
      content: text,
      abstract: text.substring(0, 500).trim() + "...",
      metadata: {
        wordCount: text.split(/\s+/).length,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    };
  }
}
