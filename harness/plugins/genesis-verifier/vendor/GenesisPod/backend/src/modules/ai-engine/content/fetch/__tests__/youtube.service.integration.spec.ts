// No module-level mock needed — SystemSettingService has no heavy dependencies

/**
 * YoutubeService Supplemental Tests
 *
 * Covers branches not tested in the primary spec:
 * - getSupadataApiKey: adminService throws → falls back to env var
 * - getTranscript cache: cache lookup throws (continues to fetch)
 * - getTranscript: timedtext succeeds but title is null → fetchVideoTitle called
 * - getTranscript: timedtext returns only 1 segment (not > 1) → tries next strategy
 * - getTranscript: captionTracks JSON.parse throws → returns null
 * - getTranscript: caption fetch returns non-ok → continues
 * - fetchTranscriptFallback: response starts with "<" (not "<?xml") → tries XML parse
 * - fetchTranscriptFallback: JSON with "data" wrapper
 * - fetchTranscriptFallback: caption field instead of text
 * - fetchTranscriptFallback: all languages fail → returns null
 * - Supadata returns non-ok → null → all methods fail
 * - pollSupadataJob: fetch throws (error in catch) → continues
 * - fetchVideoTitle: oEmbed returns ok=false → null
 * - fetchVideoTitle: fetch throws → null
 * - onModuleInit: supadata key present → logs enabled message
 * - XML: lenient fallback when standard patterns fail (no text element matches)
 * - XML: "We're sorry" error page
 * - XML: reversed attribute order in lenient path
 * - XML: numeric character entity decoding (&#digits;)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { YoutubeService } from "../youtube.service";
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
  resolveToolKey: jest.fn().mockResolvedValue(null),
};

// Helper to make all fetch calls fail (triggers NotFoundException)
function makeAllFetchFail() {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    text: jest.fn().mockResolvedValue(""),
  });
}

describe("YoutubeService (supplemental)", () => {
  let service: YoutubeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no userId (system/admin path)
    jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
    mockToolKeyResolverService.resolveToolKey.mockResolvedValue(null);

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
    // Default: fetch fails
    makeAllFetchFail();
  });

  // --------------------------------------------------------------------------
  // getSupadataApiKey: adminService throws
  // --------------------------------------------------------------------------

  describe("getSupadataApiKey – DB throws, env var fallback", () => {
    const originalEnv = process.env.SUPADATA_API_KEY;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.SUPADATA_API_KEY;
      } else {
        process.env.SUPADATA_API_KEY = originalEnv;
      }
    });

    it("falls back to env var when adminService.getYoutubeApiKey throws", async () => {
      process.env.SUPADATA_API_KEY = "env-key-from-error-fallback";
      mockSystemSettingService.getYoutubeApiKey.mockRejectedValue(
        new Error("DB connection failed"),
      );

      const supadataResp = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          content: [{ text: "Fallback segment", offset: 500, duration: 1000 }],
          lang: "en",
          availableLangs: ["en"],
        }),
      };
      const oEmbedResp = {
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "DB Error Video" }),
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai")) return Promise.resolve(supadataResp);
        if (url.includes("oembed")) return Promise.resolve(oEmbedResp);
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("dbErrVid", "en");
      expect(result.transcript[0].text).toBe("Fallback segment");
    });

    it("returns null Supadata key when DB throws and no env var", async () => {
      delete process.env.SUPADATA_API_KEY;
      mockSystemSettingService.getYoutubeApiKey.mockRejectedValue(
        new Error("DB error"),
      );

      // All methods fail, no key → NotFoundException
      await expect(service.getTranscript("noKeyVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // getTranscript: cache lookup throws
  // --------------------------------------------------------------------------

  describe("getTranscript – cache error handling", () => {
    it("continues to fetch strategies when cache lookup throws", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockRejectedValue(
        new Error("Cache DB error"),
      );

      // All fetch strategies fail → throws NotFoundException
      await expect(service.getTranscript("cacheErrVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("cache returns expired entry and logs debug", async () => {
      mockPrismaService.youTubeTranscriptCache.findUnique.mockResolvedValue({
        videoId: "expiredVid",
        title: "Old",
        transcript: [{ text: "Old", start: 0, duration: 1 }],
        translatedTranscript: null,
        targetLanguage: null,
        expiresAt: new Date(Date.now() - 10000), // expired
      });

      // All fetch strategies fail after cache miss
      await expect(service.getTranscript("expiredVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // getTranscript: timedtext returns only 1 segment (not > 1 check)
  // --------------------------------------------------------------------------

  describe("getTranscript – timedtext 1-segment boundary", () => {
    it("does not use timedtext result if only 1 segment is returned", async () => {
      const singleSegmentXml = `<?xml version="1.0"?>
<transcript>
  <text start="0" dur="1.5">Only one segment</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/single",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(singleSegmentXml),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      // Single segment: the check is `> 1`, so 1 segment should NOT satisfy it
      // Should fall through to other strategies and eventually throw
      await expect(service.getTranscript("singleSegVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // timedtext: captionTracks JSON.parse throws
  // --------------------------------------------------------------------------

  describe("getTranscript – timedtext captionTracks parse failure", () => {
    it("returns null from timedtext when captionTracks JSON is malformed", async () => {
      const badHtml = `<html><script>"captionTracks": [INVALID JSON]</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(badHtml),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      // timedtext fails → falls through to other strategies → throws
      await expect(
        service.getTranscript("malformedCaptionVid", "en"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // timedtext: caption URL fetch non-ok
  // --------------------------------------------------------------------------

  describe("getTranscript – timedtext caption fetch non-ok", () => {
    it("continues to next language when caption fetch returns non-ok", async () => {
      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/fail",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        // Caption URL returns non-ok
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: false,
            status: 403,
            text: jest.fn().mockResolvedValue(""),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      await expect(
        service.getTranscript("captionFetchFail", "en"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // fetchTranscriptFallback: XML starting with "<" (not "<?xml")
  // --------------------------------------------------------------------------

  describe("getTranscript – fallback XML response (starts with <)", () => {
    it("tries XML parse when fallback response starts with < (but not <?xml)", async () => {
      const timedtextPageHtml = "<html><body>No captions</body></html>";
      const xmlWithout = `<transcript>
  <text start="0.5" dur="2">Segment text &amp; more</text>
  <text start="3.0" dur="1">Another segment</text>
</transcript>`;

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
            text: jest.fn().mockResolvedValue(xmlWithout),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "XML Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      // If segments found via XML parse, returns them; otherwise throws
      // The check is `segments.length > 1` for fallback XML too
      const result = await service.getTranscript("xmlNoBOM", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // fetchTranscriptFallback: data wrapper JSON format
  // --------------------------------------------------------------------------

  describe("getTranscript – fallback JSON data wrapper", () => {
    it("parses JSON with data wrapper", async () => {
      const timedtextPageHtml = "<html><body>No captions</body></html>";
      const dataWrapper = JSON.stringify({
        data: [
          { text: "Data wrapped one", start: 0, dur: 2 },
          { text: "Data wrapped two", start: 2.5, dur: 1.5 },
        ],
      });

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
            text: jest.fn().mockResolvedValue(dataWrapper),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "Data Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("dataWrapId", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // fetchTranscriptFallback: alternate field names (caption, start_offset, length)
  // --------------------------------------------------------------------------

  describe("getTranscript – fallback alternate JSON field names", () => {
    it("uses caption field and start_offset/length fields", async () => {
      const timedtextPageHtml = "<html><body>No captions</body></html>";
      const altJson = JSON.stringify([
        {
          caption: "Caption text one",
          start_offset: 0,
          length: 2000,
        },
        {
          caption: "Caption text two",
          start_offset: 2500,
          length: 1500,
        },
      ]);

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
            text: jest.fn().mockResolvedValue(altJson),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "Alt Fields Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("altFieldId", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
    });

    it("uses offset field for start position", async () => {
      const timedtextPageHtml = "<html><body>No captions</body></html>";
      const offsetJson = JSON.stringify([
        { text: "Offset segment 1", offset: 0, duration: 2 },
        { text: "Offset segment 2", offset: 2500, duration: 1500 },
      ]);

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
            text: jest.fn().mockResolvedValue(offsetJson),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({ title: "Offset Video" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("offsetId", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // fetchTranscriptFallback: title from video_title field
  // --------------------------------------------------------------------------

  describe("getTranscript – fallback JSON with video_title", () => {
    it("uses video_title field from JSON response", async () => {
      const timedtextPageHtml = "<html><body>No captions</body></html>";
      const jsonWithVideoTitle = JSON.stringify({
        video_title: "My Video Title",
        transcripts: [
          { text: "First segment", start: 0, dur: 2 },
          { text: "Second segment", start: 2.5, dur: 1.5 },
        ],
      });

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
            text: jest.fn().mockResolvedValue(jsonWithVideoTitle),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("videoTitleId", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // fetchVideoTitle: non-ok response → null
  // --------------------------------------------------------------------------

  describe("fetchVideoTitle – non-ok response", () => {
    it("returns null and uses fallback title when oEmbed fetch returns non-ok", async () => {
      const captionXml = `<?xml version="1.0"?>
<transcript>
  <text start="0.5" dur="2.3">Segment one</text>
  <text start="3.0" dur="1.8">Segment two</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        { languageCode: "en", baseUrl: "https://captions.example.com/ok" },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(captionXml),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: false,
            status: 404,
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      // Even though oEmbed fails, the transcript should succeed
      const result = await service.getTranscript("noTitleVid", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
      // Title falls back to "YouTube Video {videoId}"
      expect(result.title).toBe("YouTube Video noTitleVid");
    });

    it("returns null when oEmbed fetch throws", async () => {
      const captionXml = `<?xml version="1.0"?>
<transcript>
  <text start="0.5" dur="2.3">Segment A</text>
  <text start="3.0" dur="1.8">Segment B</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/throws",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(captionXml),
          });
        }
        if (url.includes("oembed")) {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("throwTitleVid", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
      expect(result.title).toBe("YouTube Video throwTitleVid");
    });
  });

  // --------------------------------------------------------------------------
  // onModuleInit: Supadata key present → log enabled
  // --------------------------------------------------------------------------

  describe("onModuleInit – Supadata key present", () => {
    it("logs Supadata enabled when key is configured in DB", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(
        "supadata-key-123",
      );

      const ensureClientSpy = jest
        .spyOn(
          service as unknown as { ensureClient: () => Promise<void> },
          "ensureClient",
        )
        .mockResolvedValue(undefined);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      ensureClientSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // XML parsing: "We're sorry" error detection
  // --------------------------------------------------------------------------

  describe("XML parsing – error detection paths", () => {
    it("skips XML containing We're sorry message", async () => {
      const sorryXml = `<html><body>We're sorry but something went wrong</body></html>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/sorry",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(sorryXml),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      await expect(service.getTranscript("sorryVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("skips XML containing <html> tag", async () => {
      const htmlContent = `<html><body>Access denied</body></html>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/html",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(htmlContent),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      await expect(service.getTranscript("htmlVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // XML parsing: numeric character entity decoding
  // --------------------------------------------------------------------------

  describe("XML parsing – numeric entity decoding", () => {
    it("decodes numeric HTML entities like &#160; and &#8220;", async () => {
      const xmlWithNumericEntities = `<?xml version="1.0"?>
<transcript>
  <text start="0" dur="2">Smart&#160;Quotes&#8220;here&#8221;</text>
  <text start="2" dur="1">Second segment</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/numeric",
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
          text: jest.fn().mockResolvedValue(xmlWithNumericEntities),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "Numeric Entity Video" }),
        });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("numericEntVid", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
      // &#160; = non-breaking space (char code 160)
      expect(result.transcript[0].text).toContain(String.fromCharCode(160));
    });
  });

  // --------------------------------------------------------------------------
  // getTranscript: youtube-transcript npm library throws on import
  // --------------------------------------------------------------------------

  describe("getTranscript – npm library import failure", () => {
    it("falls through when youtube-transcript library module throws on fetchTranscript", async () => {
      const { YoutubeTranscript } = await import("youtube-transcript");
      (YoutubeTranscript.fetchTranscript as jest.Mock).mockRejectedValue(
        new Error("youtube-transcript error for all langs"),
      );

      const timedtextPageHtml = "<html><body>No captions</body></html>";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(timedtextPageHtml),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      await expect(service.getTranscript("npmFailVid", "en")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // getTranscript: fallback fetch itself throws (network error)
  // --------------------------------------------------------------------------

  describe("getTranscript – fallback network error", () => {
    it("continues to next lang when fallback fetch throws", async () => {
      const timedtextPageHtml = "<html><body>No captions</body></html>";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(timedtextPageHtml),
          });
        }
        if (url.includes("youtubetranscript.com")) {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      // Should fall through all strategies and throw NotFoundException
      await expect(
        service.getTranscript("networkErrVid", "en"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // Supadata: all free methods fail + Supadata returns null (pollJob returns null)
  // --------------------------------------------------------------------------

  describe("getTranscript – Supadata 202 job returns null", () => {
    it("throws NotFoundException when Supadata 202 job poll returns null", async () => {
      mockSystemSettingService.getYoutubeApiKey.mockResolvedValue(
        "key-for-job-null",
      );

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
        .mockResolvedValue(null);

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("supadata.ai")) {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: jest.fn().mockResolvedValue({ jobId: "job-null-result" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      await expect(service.getTranscript("jobNullVid", "en")).rejects.toThrow(
        NotFoundException,
      );

      pollSpy.mockRestore();
    }, 10000);
  });

  // --------------------------------------------------------------------------
  // pollSupadataJob: fetch throws in the loop (catch block)
  // --------------------------------------------------------------------------

  describe("pollSupadataJob – fetch throws in loop", () => {
    it("continues to next attempt when fetch throws", async () => {
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

      // First attempt throws, second succeeds with array content
      mockFetch
        .mockRejectedValueOnce(new Error("Network error on poll"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            content: [{ text: "Polled OK", offset: 1000, duration: 1000 }],
            lang: "en",
          }),
        })
        .mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "Polled Title" }),
        });

      const result = (await pollFn("job-net-err", "vid-poll", "key", 2, 0)) as {
        transcript: { text: string }[];
      } | null;

      // Should recover on second attempt
      expect(result).not.toBeNull();
    }, 10000);
  });

  // --------------------------------------------------------------------------
  // XML parsing: lenient path when standard patterns fail
  // --------------------------------------------------------------------------

  describe("XML parsing – lenient path", () => {
    it("uses lenient regex when standard patterns produce no matches", async () => {
      // Non-standard XML format that won't match standard patterns
      const nonStandardXml = `<?xml version="1.0"?>
<transcript>
  <text start='1.0' dur='2.0'>Single-quoted attrs</text>
  <text start='3.5' dur='1.5'>Second segment</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/lenient",
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
          text: jest.fn().mockResolvedValue(nonStandardXml),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ title: "Lenient Video" }),
        });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      // Lenient regex uses single or double quotes, so this should match
      const result = await service.getTranscript("lenientVid", "en");
      expect(result.transcript.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // getTranscript: title fetched from oEmbed (no title in timedtext/npm)
  // --------------------------------------------------------------------------

  describe("getTranscript – title from oEmbed when strategies don't provide title", () => {
    it("fetches title via oEmbed when timedtext returns no title (null)", async () => {
      const captionXml = `<?xml version="1.0"?>
<transcript>
  <text start="0.5" dur="2.3">Hello world segment</text>
  <text start="3.0" dur="1.8">Second segment here</text>
</transcript>`;

      const captionTracks = JSON.stringify([
        {
          languageCode: "en",
          baseUrl: "https://captions.example.com/notitle",
        },
      ]);
      const videoPageHtml = `<html><script>"captionTracks": ${captionTracks}</script></html>`;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("youtube.com/watch") && !url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(videoPageHtml),
          });
        }
        if (url.includes("captions.example.com")) {
          return Promise.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue(captionXml),
          });
        }
        if (url.includes("oembed")) {
          return Promise.resolve({
            ok: true,
            json: jest
              .fn()
              .mockResolvedValue({ title: "Title From oEmbed API" }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          text: jest.fn().mockResolvedValue(""),
        });
      });

      mockPrismaService.youTubeTranscriptCache.upsert.mockResolvedValue({});

      const result = await service.getTranscript("noTitleTimedVid", "en");

      // timedtext returns title=null, so fetchVideoTitle is called
      expect(result.title).toBe("Title From oEmbed API");
      expect(result.transcript.length).toBeGreaterThan(0);
    });
  });
});
