import { Test, TestingModule } from "@nestjs/testing";
import { PdfGeneratorService } from "../pdf-generator.service";
import { TranscriptSegment } from "../youtube.service";
import {
  BilingualTranscript,
  VideoMetadata,
  SubtitleExportOptions,
} from "../pdf-generator.service";
import { PuppeteerPoolService } from "../../../../common/browser/puppeteer-pool.service";
import { Readable } from "stream";

describe("PdfGeneratorService", () => {
  let service: PdfGeneratorService;

  const mockEnglishSegments: TranscriptSegment[] = [
    { text: "Hello world", start: 0, duration: 2 },
    { text: "How are you?", start: 2.5, duration: 1.8 },
  ];

  const mockChineseSegments: TranscriptSegment[] = [
    { text: "你好世界", start: 0.1, duration: 2 },
    { text: "你好吗？", start: 2.6, duration: 1.8 },
  ];

  const mockBilingual: BilingualTranscript = {
    english: mockEnglishSegments,
    chinese: mockChineseSegments,
  };

  const mockMetadata: VideoMetadata = {
    videoId: "dQw4w9WgXcQ",
    title: "Test Video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    exportDate: new Date("2026-01-01T12:00:00Z"),
  };

  const defaultOptions: SubtitleExportOptions = {
    format: "bilingual-side",
    includeTimestamps: true,
    includeVideoUrl: true,
    includeMetadata: true,
  };

  // ─── Mock page factory ─────────────────────────────────────────────────────
  function makeMockPage(
    overrides: Partial<{
      setContent: jest.Mock;
      pdf: jest.Mock;
      close: jest.Mock;
    }> = {},
  ) {
    return {
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from("fake-pdf-content")),
      close: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  let mockPuppeteerPool: { getBrowser: jest.Mock; closeBrowser: jest.Mock };
  let mockBrowserNewPage: jest.Mock;
  let mockBrowserClose: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockBrowserClose = jest.fn().mockResolvedValue(undefined);
    mockBrowserNewPage = jest.fn().mockResolvedValue(makeMockPage());

    const mockBrowser = {
      newPage: mockBrowserNewPage,
      close: mockBrowserClose,
    };

    mockPuppeteerPool = {
      getBrowser: jest.fn().mockResolvedValue(mockBrowser),
      closeBrowser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfGeneratorService,
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    service = module.get<PdfGeneratorService>(PdfGeneratorService);
  });

  // ─── generatePdf ─────────────────────────────────────────────────

  describe("generatePdf", () => {
    it("returns a Readable stream containing PDF bytes", async () => {
      const stream = await service.generatePdf(
        mockBilingual,
        mockMetadata,
        defaultOptions,
      );

      expect(stream).toBeInstanceOf(Readable);

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        stream.on("end", resolve);
        stream.on("error", reject);
      });

      const content = Buffer.concat(chunks).toString();
      expect(content).toBe("fake-pdf-content");
    });

    it("launches puppeteer via pool for PDF generation", async () => {
      await service.generatePdf(mockBilingual, mockMetadata, defaultOptions);

      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalled();
    });

    it("closes browser even when pdf() throws", async () => {
      const mockPageWithError = makeMockPage({
        pdf: jest.fn().mockRejectedValue(new Error("PDF render failed")),
        close: jest.fn().mockResolvedValue(undefined),
      });
      mockBrowserNewPage.mockResolvedValue(mockPageWithError);

      await expect(
        service.generatePdf(mockBilingual, mockMetadata, defaultOptions),
      ).rejects.toThrow("PDF render failed");

      expect(mockPageWithError.close).toHaveBeenCalledTimes(1);
    });

    it("sets page content with generated HTML before calling pdf()", async () => {
      let capturedHtml = "";
      const mockPage = makeMockPage({
        setContent: jest.fn().mockImplementation((html) => {
          capturedHtml = html as string;
          return Promise.resolve();
        }),
      });
      mockBrowserNewPage.mockResolvedValue(mockPage);

      await service.generatePdf(mockBilingual, mockMetadata, defaultOptions);

      expect(capturedHtml).toContain("<!DOCTYPE html>");
      expect(capturedHtml).toContain("Test Video");
    });
  });

  // ─── alignTranscripts ────────────────────────────────────────────

  describe("alignTranscripts", () => {
    it("pairs segments with timestamps within 1 second of each other", () => {
      const en: TranscriptSegment[] = [
        { text: "First", start: 0, duration: 2 },
        { text: "Second", start: 3, duration: 1.5 },
      ];
      const zh: TranscriptSegment[] = [
        { text: "第一", start: 0.3, duration: 2 },
        { text: "第二", start: 3.4, duration: 1.5 },
      ];

      const result = service.alignTranscripts(en, zh);

      expect(result.english).toHaveLength(2);
      expect(result.chinese).toHaveLength(2);
      expect(result.english[0].text).toBe("First");
      expect(result.chinese[0].text).toBe("第一");
    });

    it("pads with empty Chinese segment when only English remains", () => {
      const en: TranscriptSegment[] = [
        { text: "Extra English", start: 10, duration: 2 },
      ];
      const zh: TranscriptSegment[] = [];

      const result = service.alignTranscripts(en, zh);

      expect(result.english[0].text).toBe("Extra English");
      expect(result.chinese[0].text).toBe("");
      expect(result.chinese[0].start).toBe(10);
    });

    it("pads with empty English segment when only Chinese remains", () => {
      const en: TranscriptSegment[] = [];
      const zh: TranscriptSegment[] = [
        { text: "额外中文", start: 5, duration: 2 },
      ];

      const result = service.alignTranscripts(en, zh);

      expect(result.english[0].text).toBe("");
      expect(result.chinese[0].text).toBe("额外中文");
    });

    it("separates segments when timestamps differ by more than 1 second", () => {
      const en: TranscriptSegment[] = [
        { text: "English first", start: 0, duration: 1 },
      ];
      const zh: TranscriptSegment[] = [
        { text: "中文后面", start: 5, duration: 1 },
      ];

      const result = service.alignTranscripts(en, zh);

      // English should come first with empty Chinese partner
      expect(result.english[0].text).toBe("English first");
      expect(result.chinese[0].text).toBe(""); // paired empty
    });

    it("handles empty both inputs", () => {
      const result = service.alignTranscripts([], []);
      expect(result.english).toHaveLength(0);
      expect(result.chinese).toHaveLength(0);
    });

    it("handles perfectly matched single segments", () => {
      const en: TranscriptSegment[] = [{ text: "Hi", start: 0, duration: 1 }];
      const zh: TranscriptSegment[] = [{ text: "嗨", start: 0, duration: 1 }];

      const result = service.alignTranscripts(en, zh);

      expect(result.english).toHaveLength(1);
      expect(result.chinese).toHaveLength(1);
    });
  });

  // ─── HTML generation – format routing ────────────────────────────

  describe("HTML generation via generatePdf", () => {
    const captureHtml = async (
      opts: SubtitleExportOptions,
    ): Promise<string> => {
      let capturedHtml = "";
      const mockPage = makeMockPage({
        setContent: jest.fn().mockImplementation((html: string) => {
          capturedHtml = html;
          return Promise.resolve();
        }),
      });
      mockBrowserNewPage.mockResolvedValue(mockPage);
      await service.generatePdf(mockBilingual, mockMetadata, opts);
      return capturedHtml;
    };

    it("includes metadata section when includeMetadata is true", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        includeMetadata: true,
      });
      expect(html).toContain("Test Video");
      expect(html).toContain('class="metadata"');
    });

    it("omits metadata section when includeMetadata is false", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        includeMetadata: false,
      });
      expect(html).not.toContain('class="metadata"');
    });

    it("includes URL in metadata when includeVideoUrl is true", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        includeMetadata: true,
        includeVideoUrl: true,
      });
      expect(html).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });

    it("omits URL from metadata when includeVideoUrl is false", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        includeMetadata: true,
        includeVideoUrl: false,
      });
      expect(html).not.toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });

    it("generates side-by-side layout for bilingual-side format", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        format: "bilingual-side",
      });
      // Row-aligned table so each English/Chinese pair shares one <tr>.
      expect(html).toContain("bilingual-table");
      expect(html).toContain("英文");
      expect(html).toContain("中文");
    });

    it("generates stacked layout for bilingual-stack format", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        format: "bilingual-stack",
      });
      expect(html).toContain("stacked");
    });

    it("generates English-only layout for english-only format", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        format: "english-only",
      });
      expect(html).toContain("英文字幕");
      expect(html).not.toContain("中文字幕");
    });

    it("generates Chinese-only layout for chinese-only format", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        format: "chinese-only",
      });
      expect(html).toContain("中文字幕");
      expect(html).not.toContain("英文字幕");
    });

    it("includes timestamps when includeTimestamps is true", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        includeTimestamps: true,
      });
      // bilingual-side uses a dedicated timestamp column
      expect(html).toContain('class="col-timestamp"');
      expect(html).toContain("[00:00]");
    });

    it("omits timestamps when includeTimestamps is false", async () => {
      const html = await captureHtml({
        ...defaultOptions,
        includeTimestamps: false,
      });
      expect(html).not.toContain('class="col-timestamp"');
      expect(html).not.toContain('class="timestamp"');
    });

    it("escapes HTML special characters in transcript text", async () => {
      const specialBilingual: BilingualTranscript = {
        english: [{ text: "Hello <world> & 'friends'", start: 0, duration: 1 }],
        chinese: [],
      };
      let capturedHtml = "";
      const mockPage = makeMockPage({
        setContent: jest.fn().mockImplementation((html: string) => {
          capturedHtml = html;
          return Promise.resolve();
        }),
      });
      mockBrowserNewPage.mockResolvedValue(mockPage);

      await service.generatePdf(specialBilingual, mockMetadata, {
        format: "english-only",
        includeTimestamps: false,
        includeVideoUrl: false,
        includeMetadata: false,
      });

      expect(capturedHtml).toContain("&lt;world&gt;");
      expect(capturedHtml).toContain("&amp;");
      expect(capturedHtml).not.toContain("<world>");
    });
  });

  // ─── timestamp formatting ─────────────────────────────────────────

  describe("timestamp formatting via HTML output", () => {
    it("formats timestamps under 1 hour as MM:SS", async () => {
      const transcript: BilingualTranscript = {
        english: [{ text: "Test", start: 65, duration: 2 }], // 1m 5s
        chinese: [],
      };
      let capturedHtml = "";
      const mockPage = makeMockPage({
        setContent: jest.fn().mockImplementation((html: string) => {
          capturedHtml = html;
          return Promise.resolve();
        }),
      });
      mockBrowserNewPage.mockResolvedValue(mockPage);

      await service.generatePdf(transcript, mockMetadata, {
        format: "english-only",
        includeTimestamps: true,
        includeVideoUrl: false,
        includeMetadata: false,
      });

      expect(capturedHtml).toContain("[01:05]");
    });

    it("formats timestamps over 1 hour as HH:MM:SS", async () => {
      const transcript: BilingualTranscript = {
        english: [{ text: "Test", start: 3661, duration: 2 }], // 1h 1m 1s
        chinese: [],
      };
      let capturedHtml = "";
      const mockPage = makeMockPage({
        setContent: jest.fn().mockImplementation((html: string) => {
          capturedHtml = html;
          return Promise.resolve();
        }),
      });
      mockBrowserNewPage.mockResolvedValue(mockPage);

      await service.generatePdf(transcript, mockMetadata, {
        format: "english-only",
        includeTimestamps: true,
        includeVideoUrl: false,
        includeMetadata: false,
      });

      expect(capturedHtml).toContain("[01:01:01]");
    });
  });
});
