import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { YoutubeService, TranscriptSegment } from "../youtube.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SystemSettingService } from "@/common/settings/system-setting.service";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";

// Mock external fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock dynamic imports for youtube-transcript
jest.mock(
  "youtube-transcript",
  () => ({ YoutubeTranscript: { fetchTranscript: jest.fn() } }),
  { virtual: true },
);

const mockPrismaService = {
  youTubeTranscriptCache: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

const mockSystemSettingService = {
  getYoutubeApiKey: jest.fn(),
};

const mockToolKeyResolverService = {
  resolveToolKey: jest.fn(),
};

describe("YoutubeService", () => {
  let service: YoutubeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no userId (system path)
    jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YoutubeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SystemSettingService, useValue: mockSystemSettingService },
        {
          provide: ToolKeyResolverService,
          useValue: mockToolKeyResolverService,
        },
      ],
    }).compile();

    service = module.get<YoutubeService>(YoutubeService);

    // Default: no cache hit
    mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue(null);
    // Default: no Supadata key
    mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(null);
    mockToolKeyResolverService.resolveToolKey.mockResolvedValue(null);
  });

  // ─── extractVideoId ──────────────────────────────────────────────

  describe("extractVideoId", () => {
    it("extracts ID from standard watch URL", () => {
      const id = service.extractVideoId(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(id).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from youtu.be short URL", () => {
      const id = service.extractVideoId("https://youtu.be/dQw4w9WgXcQ");
      expect(id).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from embed URL", () => {
      const id = service.extractVideoId(
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
      );
      expect(id).toBe("dQw4w9WgXcQ");
    });

    it("extracts bare 11-char video ID", () => {
      const id = service.extractVideoId("dQw4w9WgXcQ");
      expect(id).toBe("dQw4w9WgXcQ");
    });

    it("returns null for invalid URL", () => {
      const id = service.extractVideoId("https://not-youtube.com/video/abc");
      expect(id).toBeNull();
    });

    it("handles watch URL with extra query params", () => {
      const id = service.extractVideoId(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
      );
      expect(id).toBe("dQw4w9WgXcQ");
    });
  });

  // ─── getTranscript – cache hit ───────────────────────────────────

  describe("getTranscript – cache hit", () => {
    it("returns cached transcript when cache is valid", async () => {
      const mockSegments: TranscriptSegment[] = [
        { text: "Hello", start: 0, duration: 2 },
      ];
      const futureExpiry = new Date(Date.now() + 1_000_000);

      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
        title: "Test Video",
        transcript: mockSegments,
        translatedTranscript: null,
        targetLanguage: null,
        expiresAt: futureExpiry,
      });

      const result = await service.getTranscript("abc123", "en");

      expect(result.videoId).toBe("abc123");
      expect(result.title).toBe("Test Video");
      expect(result.transcript).toEqual(mockSegments);
      expect(result.hasTranslation).toBe(false);
    });

    it("returns original transcript with translation as a side channel when cached", async () => {
      // Regression: previous code returned `translatedTranscript` as the primary
      // `transcript` whenever it existed. A sparse single-segment translation thus
      // wiped out the full 2k-segment original on the explore/youtube viewer.
      // Now `transcript` is always the original; translation is exposed separately.
      const original: TranscriptSegment[] = [
        { text: "Hello", start: 0, duration: 2 },
        { text: "world", start: 2, duration: 2 },
      ];
      const translated: TranscriptSegment[] = [
        { text: "你好", start: 0, duration: 2, translatedText: "你好" },
      ];
      const futureExpiry = new Date(Date.now() + 1_000_000);

      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
        title: "Test Video",
        transcript: original,
        translatedTranscript: translated,
        targetLanguage: "zh-CN",
        expiresAt: futureExpiry,
      });

      const result = await service.getTranscript("abc123", "en");

      expect(result.hasTranslation).toBe(true);
      expect(result.transcript).toEqual(original); // primary stays full
      expect(result.translatedTranscript).toEqual(translated);
      expect(result.targetLanguage).toBe("zh-CN");
    });

    it("ignores expired cache entry and attempts fresh fetch", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
        title: "Old Title",
        transcript: [],
        translatedTranscript: null,
        targetLanguage: null,
        expiresAt: new Date(Date.now() - 1000), // expired
      });

      // All fetch attempts should fail so we can verify the cache was skipped
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(""),
      });

      await expect(service.getTranscript("abc123", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getTranscript – timedtext API ───────────────────────────────

  describe("getTranscript – timedtext API (free strategy)", () => {
    it("returns transcript when timedtext API succeeds", async () => {
      const captionXml = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="0.5" dur="2.3">First segment</text>
  <text start="3.0" dur="1.8">Second segment</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://timedtext.example.com/captions",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(videoPageHtml),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(captionXml),
        })
        // fetchVideoTitle via oEmbed
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "Test Video Title" }),
        });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("abc123", "en");

      expect(result.transcript.length).toBeGreaterThan(0);
      expect(result.transcript[0].text).toBe("First segment");
    });
  });

  // ─── getTranscript – all free methods fail → Supadata ────────────

  describe("getTranscript – Supadata fallback", () => {
    it("uses Supadata when all free methods fail and key is configured", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(
        "supadata-key-123",
      );

      // The service tries timedtext (video page fetch), fallback (up to 13 language attempts),
      // then npm (dynamic import). We make all fail with non-ok responses.
      // Use a default mock that returns { ok: false } for all free-method fetches,
      // then override specific calls for Supadata.
      const supadataResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          content: [
            { text: "Segment one", offset: 1000, duration: 2000 },
            { text: "Segment two", offset: 3000, duration: 1500 },
          ],
          lang: "en",
          availableLangs: ["en"],
        }),
      };
      const oEmbedResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "Video via Supadata" }),
      };

      let _callCount = 0;
      mockFetch.mockImplementation((url: string) => {
        _callCount++;
        // Supadata API URL
        if (typeof url === "string" && url.includes("supadata.ai")) {
          return Promise.resolve(supadataResponse);
        }
        // oEmbed for title
        if (typeof url === "string" && url.includes("oembed")) {
          return Promise.resolve(oEmbedResponse);
        }
        // All other free-method calls fail
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("xyz789", "en");

      expect(result.transcript).toHaveLength(2);
      expect(result.transcript[0].text).toBe("Segment one");
      expect(result.transcript[0].start).toBe(1); // 1000ms → 1s
    });

    it("throws NotFoundException when all methods fail and no Supadata key", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue(""),
      });

      await expect(service.getTranscript("failid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when Supadata also fails", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue(""),
      });

      await expect(service.getTranscript("failid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── saveTranslation ─────────────────────────────────────────────

  describe("saveTranslation", () => {
    it("saves translation when original transcript exists in cache", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
        transcript: [{ text: "Hello", start: 0, duration: 2 }],
      });
      mockPrismaService.youTubeTranscriptCache.update.mockResolvedValue({});

      const translated: TranscriptSegment[] = [
        { text: "你好", start: 0, duration: 2 },
      ];
      await expect(
        service.saveTranslation("abc123", translated, "zh-CN"),
      ).resolves.toBeUndefined();

      expect(
        mockPrismaService.youTubeTranscriptCache.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { videoId: "abc123" },
          data: expect.objectContaining({ targetLanguage: "zh-CN" }),
        }),
      );
    });

    it("throws when no original transcript is cached", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.saveTranslation("nope", [], "zh-CN"),
      ).rejects.toThrow("Original transcript must be cached");
    });

    it("re-throws Prisma errors during translation save", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
      });
      mockPrismaService.youTubeTranscriptCache.update.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.saveTranslation("abc123", [], "zh-CN"),
      ).rejects.toThrow("DB write error");
    });

    it("merges incoming partial translation into existing array (does not overwrite)", async () => {
      // Regression: prior code overwrote translatedTranscript on each save. The
      // explore/youtube viewer translates segments on-demand and flushes only the
      // freshly-translated segments — that wiped the global cache to 1 segment.
      const existing: TranscriptSegment[] = [
        { text: "A", start: 0, duration: 2, translatedText: "甲" },
        { text: "B", start: 2, duration: 2, translatedText: "乙" },
        { text: "C", start: 4, duration: 2, translatedText: "丙" },
      ];
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
        transcript: [],
        translatedTranscript: existing,
        targetLanguage: "zh-CN",
      });
      mockPrismaService.youTubeTranscriptCache.update.mockResolvedValue({});

      const incoming: TranscriptSegment[] = [
        // overwrite middle segment
        { text: "B", start: 2, duration: 2, translatedText: "乙2" },
        // new segment
        { text: "D", start: 6, duration: 2, translatedText: "丁" },
      ];
      await service.saveTranslation("abc123", incoming, "zh-CN");

      const call =
        mockPrismaService.youTubeTranscriptCache.update.mock.calls[0][0];
      const merged = call.data.translatedTranscript as TranscriptSegment[];
      expect(merged.map((s) => s.start)).toEqual([0, 2, 4, 6]);
      expect(merged.find((s) => s.start === 2)?.translatedText).toBe("乙2");
      expect(merged.find((s) => s.start === 6)?.translatedText).toBe("丁");
    });

    it("replaces existing translation when target language changes", async () => {
      const existing: TranscriptSegment[] = [
        { text: "A", start: 0, duration: 2, translatedText: "甲" },
      ];
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "abc123",
        transcript: [],
        translatedTranscript: existing,
        targetLanguage: "zh-CN",
      });
      mockPrismaService.youTubeTranscriptCache.update.mockResolvedValue({});

      const incoming: TranscriptSegment[] = [
        { text: "A", start: 0, duration: 2, translatedText: "A-jp" },
      ];
      await service.saveTranslation("abc123", incoming, "ja");

      const call =
        mockPrismaService.youTubeTranscriptCache.update.mock.calls[0][0];
      const merged = call.data.translatedTranscript as TranscriptSegment[];
      expect(merged).toHaveLength(1);
      expect(merged[0].translatedText).toBe("A-jp");
      expect(call.data.targetLanguage).toBe("ja");
    });
  });

  // ─── getTranslationStatus ─────────────────────────────────────────

  describe("getTranslationStatus", () => {
    it("returns hasTranslation=true when translation exists", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        translatedTranscript: [{ text: "你好", start: 0, duration: 2 }],
        targetLanguage: "zh-CN",
      });

      const result = await service.getTranslationStatus("abc123");
      expect(result.hasTranslation).toBe(true);
      expect(result.targetLanguage).toBe("zh-CN");
    });

    it("returns hasTranslation=false when no translation", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        translatedTranscript: null,
        targetLanguage: null,
      });

      const result = await service.getTranslationStatus("abc123");
      expect(result.hasTranslation).toBe(false);
      expect(result.targetLanguage).toBeUndefined();
    });

    it("returns hasTranslation=false when cache miss", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.getTranslationStatus("missing");
      expect(result.hasTranslation).toBe(false);
    });

    it("returns hasTranslation=false when DB call throws", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.getTranslationStatus("abc123");
      expect(result.hasTranslation).toBe(false);
    });
  });

  // ─── cacheTranscript ─────────────────────────────────────────────

  describe("cacheTranscript", () => {
    it("upserts transcript in cache", async () => {
      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const segments: TranscriptSegment[] = [
        { text: "Hi", start: 0, duration: 1 },
      ];
      await service.cacheTranscript("vid1", "Title", segments, "en");

      expect(
        mockPrismaService.youTubeTranscriptCache.upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { videoId: "vid1" },
          create: expect.objectContaining({ videoId: "vid1", title: "Title" }),
          update: expect.objectContaining({ title: "Title" }),
        }),
      );
    });
  });

  // ─── XML parsing (indirectly via getTranscript) ───────────────────

  describe("XML parsing via getTranscript", () => {
    it("parses standard YouTube XML captions format", async () => {
      const xml = `<?xml version="1.0"?>
<transcript>
  <text start="1.23" dur="2.50">Hello &amp; world</text>
  <text start="4.00" dur="1.00">Goodbye friend</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        { languageCode: "en", baseUrl: "https://captions.example.com/en" },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(videoPageHtml),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(xml),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "My Video" }),
        });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("vid1", "en");

      // &amp; is decoded to & in HTML entity decoding
      expect(result.transcript[0].text).toBe("Hello & world");
      expect(result.transcript[1].text).toBe("Goodbye friend");
      expect(result.transcript[0].start).toBeCloseTo(1.23);
      expect(result.transcript[0].duration).toBeCloseTo(2.5);
    });

    it("skips HTML/error page content in XML parser", async () => {
      const htmlError =
        "<!DOCTYPE html><html><body>An error occurred</body></html>";

      const captionTracks = JSON.stringify([
        { languageCode: "en", baseUrl: "https://captions.example.com/en" },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(videoPageHtml),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(htmlError),
        })
        // fallback attempts also fail
        .mockResolvedValue({ ok: false, status: 404 });

      await expect(service.getTranscript("vid1", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Supadata – 202 async job polling ─────────────────────────────

  describe("Supadata async job handling", () => {
    it("polls until job completes and returns transcript", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue("test-key");

      // Spy on the private pollSupadataJob to return result immediately
      // instead of waiting for real setTimeout delays
      const pollSpy = jest
        .spyOn(
          service as unknown as {
            pollSupadataJob: (
              jobId: string,
              videoId: string,
              apiKey: string,
            ) => Promise<unknown>;
          },
          "pollSupadataJob",
        )
        .mockResolvedValue({
          videoId: "jobvid",
          title: "Polled Video",
          transcript: [{ text: "Done", start: 0.5, duration: 1 }],
        });

      mockFetch.mockImplementation((url: string) => {
        // Supadata transcript endpoint returns 202 (async job)
        if (typeof url === "string" && url.includes("supadata.ai")) {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: jest.fn().mockResolvedValue({ jobId: "job-abc" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("jobvid", "en");

      expect(result.transcript[0].text).toBe("Done");
      expect(pollSpy).toHaveBeenCalledWith("job-abc", "jobvid", "test-key");
      pollSpy.mockRestore();
    }, 10000);
  });

  // ─── onModuleInit ─────────────────────────────────────────────────

  describe("onModuleInit", () => {
    it("completes without throwing when initialization succeeds", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(null);

      // Mock ensureClient – we spy on the private method via any cast
      const ensureClientSpy = jest
        .spyOn(
          service as unknown as { ensureClient: () => Promise<void> },
          "ensureClient",
        )
        .mockResolvedValue(undefined);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      ensureClientSpy.mockRestore();
    });

    it("logs error but does not throw when initialization fails", async () => {
      const ensureClientSpy = jest
        .spyOn(
          service as unknown as { ensureClient: () => Promise<void> },
          "ensureClient",
        )
        .mockRejectedValue(new Error("import failure"));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      ensureClientSpy.mockRestore();
    });
  });

  // ─── getTranscript – fallback JSON parsing ───────────────────────────────────

  describe("getTranscript – fallback JSON transcript", () => {
    it("parses JSON array response from fallback service", async () => {
      const jsonArray = JSON.stringify([
        { text: "Hello world", start: 0, dur: 2 },
        { text: "Second segment", start: 2.5, dur: 1.5 },
      ]);

      // timedtext fails (no caption tracks), fallback uses JSON
      const timedtextPageHtml = "<html><body>No captions</body></html>";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(timedtextPageHtml),
          });
        }
        if (url.includes("youtubetranscript.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(jsonArray),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "My Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("fallbackId", "en");

      expect(result.transcript.length).toBeGreaterThanOrEqual(1);
    });

    it("parses JSON with transcripts wrapper from fallback service", async () => {
      const jsonWrapper = JSON.stringify({
        transcripts: [
          { text: "First", start: 0, dur: 1 },
          { text: "Second", start: 1.5, dur: 1 },
        ],
      });

      const timedtextPageHtml = "<html><body>No captions</body></html>";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(timedtextPageHtml),
          });
        }
        if (url.includes("youtubetranscript.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(jsonWrapper),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "My Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("wrapId", "en");

      expect(result.transcript.length).toBeGreaterThanOrEqual(1);
    });

    it("skips fallback response that starts with non-transcript XML", async () => {
      const xmlString = `<?xml version="1.0"?><root><item>no transcript here</item></root>`;

      const timedtextPageHtml = "<html><body>No captions</body></html>";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(timedtextPageHtml),
          });
        }
        if (url.includes("youtubetranscript.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(xmlString),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      // All methods fail, should throw NotFoundException
      await expect(service.getTranscript("xmlFallId", "en")).rejects.toThrow();
    });
  });

  // ─── Supadata – string content response ──────────────────────────────────────

  describe("fetchTranscriptSupadata – string content", () => {
    it("handles plain text string content from Supadata", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(
        "supadata-key",
      );

      const oEmbedResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "Text Video" }),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai/v1/transcript?")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              content: "This is the full transcript as plain text",
              lang: "en",
              availableLangs: ["en"],
            }),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve(oEmbedResponse);
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("textVid", "en");

      expect(result.transcript).toHaveLength(1);
      expect(result.transcript[0].text).toBe(
        "This is the full transcript as plain text",
      );
      expect(result.transcript[0].start).toBe(0);
    });

    it("returns null when Supadata returns unexpected content type", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(
        "supadata-key",
      );

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai/v1/transcript?")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              content: 42, // neither string nor array
              lang: "en",
              availableLangs: ["en"],
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      // Since Supadata returns null, should throw NotFoundException
      await expect(
        service.getTranscript("unexpectedVid", "en"),
      ).rejects.toThrow();
    });
  });

  // ─── pollSupadataJob – internal behavior ─────────────────────────────────────

  describe("pollSupadataJob", () => {
    it("returns null after max attempts when job stays in 202 state", async () => {
      // Access private method via any cast
      const pollFn = (
        service as unknown as {
          pollSupadataJob: (
            jobId: string,
            videoId: string,
            apiKey: string,
            maxAttempts: number,
            intervalMs: number,
          ) => Promise<unknown>;
        }
      ).pollSupadataJob.bind(service);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 202,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await pollFn("job-timeout", "vid-1", "key", 2, 0);

      expect(result).toBeNull();
    }, 10000);

    it("returns null when job fetch fails", async () => {
      const pollFn = (
        service as unknown as {
          pollSupadataJob: (
            jobId: string,
            videoId: string,
            apiKey: string,
            maxAttempts: number,
            intervalMs: number,
          ) => Promise<unknown>;
        }
      ).pollSupadataJob.bind(service);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await pollFn("job-fail", "vid-1", "key", 2, 0);

      expect(result).toBeNull();
    }, 10000);

    it("returns transcript when job succeeds with array content", async () => {
      const pollFn = (
        service as unknown as {
          pollSupadataJob: (
            jobId: string,
            videoId: string,
            apiKey: string,
            maxAttempts: number,
            intervalMs: number,
          ) => Promise<unknown>;
        }
      ).pollSupadataJob.bind(service);

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("transcript/job-ok")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              content: [
                { text: "Polled segment", offset: 500, duration: 1000 },
              ],
              lang: "en",
            }),
          });
        }
        // oEmbed for fetchVideoTitle
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "Polled Video Title" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      const result = (await pollFn("job-ok", "vid-ok", "key", 2, 0)) as {
        transcript: { text: string }[];
      };

      expect(result).not.toBeNull();
      expect(result.transcript[0].text).toBe("Polled segment");
    }, 10000);

    it("returns transcript when job succeeds with string content", async () => {
      const pollFn = (
        service as unknown as {
          pollSupadataJob: (
            jobId: string,
            videoId: string,
            apiKey: string,
            maxAttempts: number,
            intervalMs: number,
          ) => Promise<unknown>;
        }
      ).pollSupadataJob.bind(service);

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("transcript/job-str")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              content: "Full text transcript",
              lang: "en",
            }),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "String Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      const result = (await pollFn("job-str", "vid-str", "key", 2, 0)) as {
        transcript: { text: string }[];
      };

      expect(result).not.toBeNull();
      expect(result.transcript[0].text).toBe("Full text transcript");
    }, 10000);

    it("returns null when job returns unexpected content type", async () => {
      const pollFn = (
        service as unknown as {
          pollSupadataJob: (
            jobId: string,
            videoId: string,
            apiKey: string,
            maxAttempts: number,
            intervalMs: number,
          ) => Promise<unknown>;
        }
      ).pollSupadataJob.bind(service);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          content: 999, // neither string nor array
          lang: "en",
        }),
      });

      const result = await pollFn("job-bad", "vid-bad", "key", 2, 0);

      expect(result).toBeNull();
    }, 10000);
  });

  // ─── XML parsing – edge cases ─────────────────────────────────────────────────

  describe("XML parsing – edge cases", () => {
    it("parses XML with reversed dur/start attribute order", async () => {
      const reversedXml = `<?xml version="1.0"?>
<transcript>
  <text dur="2.5" start="1.0">Reversed order</text>
  <text dur="3.0" start="4.0">Another segment</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        { languageCode: "en", baseUrl: "https://captions.example.com/rev" },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(videoPageHtml),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(reversedXml),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "Rev Video" }),
        });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("revId", "en");

      expect(result.transcript.length).toBeGreaterThan(0);
    });

    it("decodes HTML entities in transcript text", async () => {
      const xmlWithEntities = `<?xml version="1.0"?>
<transcript>
  <text start="0" dur="2">&amp; &lt;tag&gt; &quot;quoted&quot; &#39;apos&#39;</text>
  <text start="2" dur="1">second segment</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        { languageCode: "en", baseUrl: "https://captions.example.com/ent" },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(videoPageHtml),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(xmlWithEntities),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "Entity Video" }),
        });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("entId", "en");

      // &amp; → "&", &quot; → '"', &#39; → "'"
      // Note: &lt;tag&gt; decodes to <tag> which is then stripped by HTML tag removal
      expect(result.transcript[0].text).toContain("&");
      expect(result.transcript[0].text).toContain('"quoted"');
      expect(result.transcript[0].text).toContain("'apos'");
    });

    it("returns error page detection (HTML response in XML parser)", async () => {
      // The 'skips HTML/error page content in XML parser' test verifies this already.
      // Here we test an additional path: XML containing <error> tag
      const errorXml = `<xml><error>Video unavailable</error></xml>`;

      const captionTracks = JSON.stringify([
        { languageCode: "en", baseUrl: "https://captions.example.com/err" },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(videoPageHtml),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(errorXml),
        })
        .mockResolvedValue({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });

      await expect(service.getTranscript("errorId", "en")).rejects.toThrow();
    });
  });

  // ─── getTranscript – cloud environment handling ───────────────────────────────

  describe("getTranscript – cloud environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      delete process.env.RAILWAY_ENVIRONMENT;
    });

    it("skips youtubei.js in production environment", async () => {
      process.env.NODE_ENV = "production";

      // All free methods fail → throws NotFoundException
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue(""),
      });

      await expect(service.getTranscript("cloudVid", "en")).rejects.toThrow();
    });

    it("skips youtubei.js when RAILWAY_ENVIRONMENT is set", async () => {
      process.env.RAILWAY_ENVIRONMENT = "production";

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue(""),
      });

      await expect(service.getTranscript("railwayVid", "en")).rejects.toThrow();
    });
  });

  // ─── cacheTranscript – error handling ─────────────────────────────────────────

  describe("cacheTranscript – error handling", () => {
    it("silently swallows errors when upsert fails", async () => {
      mockPrismaService.youTubeTranscriptCache.upsert.mockRejectedValue(
        new Error("DB write error"),
      );

      // Should not throw since saveToCache catches and warns
      await expect(
        service.cacheTranscript("vidErr", "Title", [], "en"),
      ).resolves.toBeUndefined();
    });
  });

  // ─── BYOK: getSupadataApiKey – ToolKeyResolver path ─────────────────────────

  describe("getSupadataApiKey – BYOK userId path", () => {
    it("uses ToolKeyResolverService when userId is present", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue("user-123");
      mockToolKeyResolverService.resolveToolKey.mockResolvedValue({
        value: "byok-supadata-key",
        source: "user",
        secretName: "supadata-api-key",
      });

      const supadataResult = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          content: [{ text: "BYOK segment", offset: 1000, duration: 2000 }],
          lang: "en",
          availableLangs: ["en"],
        }),
      };
      const oEmbedResult = {
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "BYOK Video" }),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai")) return Promise.resolve(supadataResult);
        if (url.includes("oembed")) return Promise.resolve(oEmbedResult);
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("byokVid", "en");

      expect(mockToolKeyResolverService.resolveToolKey).toHaveBeenCalledWith(
        "supadata",
        "user-123",
      );
      expect(result.transcript[0].text).toBe("BYOK segment");
    });

    it("falls back to admin path when no userId is present", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue("admin-key");

      const supadataResult = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          content: [{ text: "Admin segment", offset: 500, duration: 1000 }],
          lang: "en",
          availableLangs: ["en"],
        }),
      };
      const oEmbedResult = {
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "Admin Video" }),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai")) return Promise.resolve(supadataResult);
        if (url.includes("oembed")) return Promise.resolve(oEmbedResult);
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      await service.getTranscript("adminVid", "en");

      expect(mockToolKeyResolverService.resolveToolKey).not.toHaveBeenCalled();
      expect(mockSystemSettingService.getYoutubeApiKey).toHaveBeenCalledWith(
        "supadata",
      );
    });
  });

  // ─── getSupadataApiKey – fallback to env var ──────────────────────────────────

  describe("getSupadataApiKey – env var fallback", () => {
    const originalEnv = process.env.SUPADATA_API_KEY;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.SUPADATA_API_KEY;
      } else {
        process.env.SUPADATA_API_KEY = originalEnv;
      }
    });

    it("falls back to SUPADATA_API_KEY env var when DB returns null", async () => {
      process.env.SUPADATA_API_KEY = "env-supadata-key";
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(null);

      const supadataResult = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          content: [{ text: "Env key segment", offset: 1000, duration: 2000 }],
          lang: "en",
          availableLangs: ["en"],
        }),
      };
      const oEmbedResult = {
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "Env Video" }),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai")) return Promise.resolve(supadataResult);
        if (url.includes("oembed")) return Promise.resolve(oEmbedResult);
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("envVid", "en");

      expect(result.transcript[0].text).toBe("Env key segment");
    });
  });
});
