/**
 * Additional coverage tests for WechatImageUploaderService.
 *
 * Target: push lines from 57% to >=90%.
 * Covers:
 *   - isUrlSsrfSafe edge cases
 *   - shouldSkip branches
 *   - fetchImage paths (no body / missing content-type)
 *   - uploadOne SSRF reject + protocol-relative
 *   - uploadCover boundary paths
 *   - rewriteImagesInHtml misc paths
 *   - runUploadAttempts / runCoverUploadAttempts / runCoverCropMulti
 *     (browser functions called directly via page.evaluate passthrough)
 */
import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import type { Page } from "puppeteer";
import { WechatImageUploaderService } from "../wechat-image-uploader.service";

// ---------------------------------------------------------------------------
// Minimal browser globals needed for the private browser-context functions.
// These must be set BEFORE the service calls page.evaluate with them.
// ---------------------------------------------------------------------------
const originalWindow = global.window;
const originalDocument = global.document;

/** Make page.evaluate(fn, ...args) actually call fn(...args) in Node.js. */
function makePassthroughPage(): { evaluate: jest.Mock } {
  return {
    evaluate: jest
      .fn()
      .mockImplementation(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
  };
}

describe("WechatImageUploaderService – extras", () => {
  let service: WechatImageUploaderService;
  let mockPage: { evaluate: jest.Mock };

  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [WechatImageUploaderService],
    }).compile();

    service = moduleRef.get(WechatImageUploaderService);
    mockPage = { evaluate: jest.fn() };
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // Restore globals that browser-function tests may have patched
    if (originalWindow !== undefined) {
      global.window = originalWindow;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (global as any).window;
    }
    if (originalDocument !== undefined) {
      global.document = originalDocument;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (global as any).document;
    }
    jest.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Helper factories
  // ---------------------------------------------------------------------------

  /** Returns a fetch mock that streams one small chunk then done. */
  const makeFetchOk = (mime = "image/jpeg"): void => {
    mockFetch.mockImplementation(async () => {
      let returned = false;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", mime]]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (returned) return { done: true, value: undefined };
              returned = true;
              return { done: false, value: new Uint8Array(16) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };
    });
  };

  const okUpload = (url: string, fileId = "200000001") => ({
    url,
    fileId,
    aiStatus: 1,
    ext: "jpg",
    attempts: [
      { endpoint: "filetransfer-upload-material", ret: 0, url, fileId },
    ],
  });

  const okCoverUpload = () => ({
    mediaId: "300000001",
    cdnUrl: "https://mmbiz.qpic.cn/cover/orig",
    aiStatus: 1,
    ext: "png",
    attempts: [],
  });

  const okCropMulti = () => ({
    ok: true,
    cropFileId235: "300000002",
    cropCdnUrl235: "https://mmbiz.qpic.cn/cover/235",
    cropFileId1_1: "300000003",
    cropCdnUrl1_1: "https://mmbiz.qpic.cn/cover/1_1",
    fingerprintSource: "sniffed",
    bodyPreview: '{"base_resp":{"ret":0}}',
  });

  // ---------------------------------------------------------------------------
  // isUrlSsrfSafe – branches not covered by existing spec
  // ---------------------------------------------------------------------------

  describe("isUrlSsrfSafe via rewriteImagesInHtml (SSRF rejects)", () => {
    it("rejects non-http/https protocol (ftp://)", async () => {
      const html = `<img src="ftp://files.example.com/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects 172.16.x.x (RFC1918 class-B private)", async () => {
      const html = `<img src="http://172.16.5.5/secret.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects 172.31.255.255 (last addr of RFC1918 class-B)", async () => {
      const html = `<img src="http://172.31.255.255/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
    });

    it("allows 172.32.0.1 (just outside RFC1918 class-B block)", async () => {
      makeFetchOk();
      mockPage.evaluate.mockResolvedValue(
        okUpload("https://mmbiz.qpic.cn/ok172"),
      );
      const html = `<img src="http://172.32.0.1/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(mockFetch).toHaveBeenCalled();
      expect(result.uploaded).toBe(1);
    });

    it("rejects 192.168.1.1 (RFC1918 class-C private)", async () => {
      const html = `<img src="http://192.168.1.1/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects 100.64.0.1 (CGNAT range)", async () => {
      const html = `<img src="http://100.64.0.1/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
    });

    it("rejects 100.127.255.255 (last CGNAT addr)", async () => {
      const html = `<img src="http://100.127.255.255/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
    });

    it("allows 100.128.0.1 (just outside CGNAT block)", async () => {
      makeFetchOk();
      mockPage.evaluate.mockResolvedValue(
        okUpload("https://mmbiz.qpic.cn/ok100128"),
      );
      const html = `<img src="http://100.128.0.1/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(mockFetch).toHaveBeenCalled();
      expect(result.uploaded).toBe(1);
    });

    it("rejects 0.0.0.1 (IP starting with 0)", async () => {
      const html = `<img src="http://0.0.0.1/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
    });

    it("rejects hostname with no dot (single-label)", async () => {
      const html = `<img src="http://localhost2/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects hostname with invalid characters (underscore)", async () => {
      const html = `<img src="http://my_server.example.com/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.failed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects malformed URL (triple-slash) → caught by shouldSkip or SSRF", async () => {
      const html = `<img src="http:///triple-slash/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.uploaded).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // shouldSkip – protocol-relative and other WeChat-hosted domains
  // ---------------------------------------------------------------------------

  describe("shouldSkip – additional domains", () => {
    it("skips mmbiz.qlogo.cn images (WeChat logo CDN)", async () => {
      const html = `<img src="https://mmbiz.qlogo.cn/avatar/abc" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.skipped).toBe(1);
      expect(result.uploaded).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips mp.weixin.qq.com images", async () => {
      const html = `<img src="https://mp.weixin.qq.com/article/thumb.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.skipped).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips protocol-relative mmbiz URLs (// prefix)", async () => {
      const html = `<img src="//mmbiz.qpic.cn/relative/img" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.skipped).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // rewriteImagesInHtml – edge: empty HTML / no img tags
  // ---------------------------------------------------------------------------

  describe("rewriteImagesInHtml – no img tags", () => {
    it("returns zeros and original HTML when no img tags present", async () => {
      const html = "<p>Just text, no images here.</p>";
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );
      expect(result.uploaded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.rewritten).toBe(html);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it("returns zeros for empty string HTML", async () => {
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        "",
        "tok",
      );
      expect(result.uploaded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // uploadOne – SSRF reject path (via rewriteImagesInHtml)
  // ---------------------------------------------------------------------------

  describe("uploadOne – SSRF reject logs warn", () => {
    it("logs warn and returns null when SSRF check fails (private IP)", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      const html = `<img src="http://10.0.0.1/private.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.failed).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // uploadOne – protocol-relative URL (// prefix) is normalized
  // ---------------------------------------------------------------------------

  describe("uploadOne – protocol-relative URL is normalized and uploaded", () => {
    it("normalizes //example.com/img.jpg to https: and uploads successfully", async () => {
      makeFetchOk();
      mockPage.evaluate.mockResolvedValue(
        okUpload("https://mmbiz.qpic.cn/normalized"),
      );

      const html = `<img src="//example.com/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.uploaded).toBe(1);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // fetchImage – no response.body path
  // ---------------------------------------------------------------------------

  describe("fetchImage – no response.body", () => {
    it("treats null body as upload failure (warn logged)", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]) as unknown as Headers,
        body: null,
      });

      const html = `<img src="https://nobody.example.com/img.png" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.failed).toBe(1);
      expect(mockPage.evaluate).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // fetchImage – content-type missing → defaults to image/jpeg
  // ---------------------------------------------------------------------------

  describe("fetchImage – missing content-type defaults to image/jpeg", () => {
    it("still uploads when response has no content-type header", async () => {
      mockFetch.mockImplementation(async () => {
        let returned = false;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null } as unknown as Headers,
          body: {
            getReader: () => ({
              read: async () => {
                if (returned) return { done: true, value: undefined };
                returned = true;
                return { done: false, value: new Uint8Array(8) };
              },
              cancel: jest.fn().mockResolvedValue(undefined),
            }),
          },
        };
      });
      mockPage.evaluate.mockResolvedValue(
        okUpload("https://mmbiz.qpic.cn/noct"),
      );

      const html = `<img src="https://nocontenttype.example.com/img" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.uploaded).toBe(1);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // uploadCover – boundary paths
  // ---------------------------------------------------------------------------

  describe("uploadCover – boundary paths", () => {
    it("returns null for empty string externalUrl", async () => {
      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "",
        "tok",
        "fp",
      );
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it("returns null for data: URI cover", async () => {
      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "data:image/png;base64,AAAA",
        "tok",
        "fp",
      );
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("normalizes // protocol-relative cover URL and proceeds with upload", async () => {
      makeFetchOk();
      mockPage.evaluate
        .mockResolvedValueOnce(okCoverUpload())
        .mockResolvedValueOnce(okCropMulti());

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "//example.com/cover.jpg",
        "tok",
        "fp",
      );

      expect(result).not.toBeNull();
      expect(result?.uploadFileId).toBe("300000001");
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });

    it("returns null when SSRF check blocks cover URL", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "http://192.168.1.100/cover.jpg",
        "tok",
        "fp",
      );

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("SSRF-unsafe"),
      );
      warnSpy.mockRestore();
    });

    it("returns null when cover fetch throws network error", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://unreachable.example.com/cover.jpg",
        "tok",
        "fp",
      );

      expect(result).toBeNull();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to fetch cover image"),
      );
      warnSpy.mockRestore();
    });

    it("returns null when crop_multi ok=true but cropFileId235 is null", async () => {
      makeFetchOk();
      mockPage.evaluate
        .mockResolvedValueOnce(okCoverUpload())
        .mockResolvedValueOnce({
          ok: true,
          cropFileId235: null,
          cropCdnUrl235: "https://mmbiz.qpic.cn/cover/235",
          cropFileId1_1: "300000003",
          cropCdnUrl1_1: "https://mmbiz.qpic.cn/cover/1_1",
          fingerprintSource: "sniffed",
          bodyPreview: "{}",
        });

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://example.com/cover.jpg",
        "tok",
        "fp",
      );

      expect(result).toBeNull();
    });

    it("returns null when crop_multi ok=true but cropCdnUrl1_1 is null", async () => {
      makeFetchOk();
      mockPage.evaluate
        .mockResolvedValueOnce(okCoverUpload())
        .mockResolvedValueOnce({
          ok: true,
          cropFileId235: "300000002",
          cropCdnUrl235: "https://mmbiz.qpic.cn/cover/235",
          cropFileId1_1: "300000003",
          cropCdnUrl1_1: null,
          fingerprintSource: "sniffed",
          bodyPreview: "{}",
        });

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://example.com/cover.jpg",
        "tok",
        "fp",
      );

      expect(result).toBeNull();
    });

    it("logs upload attempt details and crop_multi result", async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);

      makeFetchOk();
      mockPage.evaluate
        .mockResolvedValueOnce(okCoverUpload())
        .mockResolvedValueOnce(okCropMulti());

      await service.uploadCover(
        mockPage as unknown as Page,
        "https://example.com/cover2.jpg",
        "tok",
        "fp",
      );

      const logCalls = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logCalls.some((m) => m.includes("[uploadCover] upload"))).toBe(
        true,
      );
      expect(logCalls.some((m) => m.includes("[uploadCover] crop_multi"))).toBe(
        true,
      );
      logSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // rewriteImagesInHtml – warn log on upload failure
  // ---------------------------------------------------------------------------

  describe("rewriteImagesInHtml – warn logging paths", () => {
    it("logs warn for non-mmbiz upload result (XSS defense path)", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      makeFetchOk();
      mockPage.evaluate.mockResolvedValue(
        okUpload("https://suspicious.cdn.com/img.jpg"),
      );

      const html = `<img src="https://safe.example.com/photo.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.failed).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rejected non-mmbiz"),
      );
      warnSpy.mockRestore();
    });

    it("logs warn when upload detail is missing from map (failed upload)", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      makeFetchOk();
      mockPage.evaluate.mockResolvedValue({
        url: null,
        fileId: null,
        aiStatus: 0,
        ext: "jpg",
        attempts: [],
      });

      const html = `<img src="https://failme.example.com/x.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.failed).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Image upload failed"),
      );
      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent upload – more than UPLOAD_CONCURRENCY (3) unique images
  // ---------------------------------------------------------------------------

  describe("uploadConcurrently – >3 unique images", () => {
    it("processes 5 unique images with concurrency=3 (all uploaded)", async () => {
      makeFetchOk();
      const cdnUrls = [
        "https://mmbiz.qpic.cn/batch/1",
        "https://mmbiz.qpic.cn/batch/2",
        "https://mmbiz.qpic.cn/batch/3",
        "https://mmbiz.qpic.cn/batch/4",
        "https://mmbiz.qpic.cn/batch/5",
      ];
      cdnUrls.forEach((url, i) => {
        mockPage.evaluate.mockResolvedValueOnce(
          okUpload(url, String(400000001 + i)),
        );
      });

      const imgs = [
        `<img src="https://a1.example.com/1.jpg" />`,
        `<img src="https://a2.example.com/2.jpg" />`,
        `<img src="https://a3.example.com/3.jpg" />`,
        `<img src="https://a4.example.com/4.jpg" />`,
        `<img src="https://a5.example.com/5.jpg" />`,
      ].join("\n");

      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        imgs,
        "tok",
      );

      expect(result.uploaded).toBe(5);
      expect(result.failed).toBe(0);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(5);
    });
  });

  // ---------------------------------------------------------------------------
  // isUrlSsrfSafe – public IP that should be allowed
  // ---------------------------------------------------------------------------

  describe("isUrlSsrfSafe – public IP addresses that should be allowed", () => {
    it("allows a valid public IPv4 address (8.8.8.8)", async () => {
      makeFetchOk();
      mockPage.evaluate.mockResolvedValue(
        okUpload("https://mmbiz.qpic.cn/google-dns"),
      );

      const html = `<img src="http://8.8.8.8/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(mockFetch).toHaveBeenCalled();
      expect(result.uploaded).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Browser-context functions: runUploadAttempts
  // We use a passthrough page.evaluate that actually calls the function in Node.
  // atob / Blob / FormData / fetch are available in Node 18+.
  // ---------------------------------------------------------------------------

  describe("runUploadAttempts (passthrough page.evaluate)", () => {
    beforeEach(() => {
      mockPage = makePassthroughPage();
    });

    it("returns url+fileId when filetransfer endpoint succeeds", async () => {
      makeFetchOk(); // Node-side fetch for image download
      // page.evaluate fetch (inside browser fn) → also goes through global.fetch
      // We need two fetch calls: one for fetchImage, one for the upload POST.
      // Reset and set up sequence:
      mockFetch.mockReset();

      // Call 1: fetchImage (Node-side)
      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      // Call 2: filetransfer POST (browser-fn-side, but hits global.fetch too)
      const filetransferMock = {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { ret: 0, err_msg: "" },
          cdn_url: "https://mmbiz.qpic.cn/upload/testimg",
          content: "535900001",
          ai_status: 1,
        }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(filetransferMock);

      const html = `<img src="https://cdn.example.com/photo.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "TOKEN123",
      );

      expect(result.uploaded).toBe(1);
      expect(result.rewritten).toContain("mmbiz.qpic.cn/upload/testimg");
      expect(result.rewritten).toContain("data-imgfileid=");
    });

    it("falls back to misc-uploadimg2 when filetransfer returns ret=-1", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      // filetransfer fails
      const filetransferFail = {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { ret: -1, err_msg: "permission denied" },
        }),
      };

      // misc-uploadimg2 fallback succeeds (url only, no fileId)
      const miscSuccess = {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { ret: 0 },
          content: "https://mmbiz.qpic.cn/upload/fallback",
        }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(filetransferFail)
        .mockResolvedValueOnce(miscSuccess);

      const html = `<img src="https://fallback.example.com/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "TOKEN456",
      );

      // misc-uploadimg2 returns url but no fileId → uploadOne returns null → failed
      expect(result.failed).toBe(1);
    });

    it("returns url=null when both endpoints fail (fetch throws)", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockRejectedValueOnce(new Error("network error")) // filetransfer throws
        .mockRejectedValueOnce(new Error("network error")); // misc throws

      const html = `<img src="https://bothfail.example.com/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "TOKEN789",
      );

      expect(result.failed).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("handles non-JSON response from endpoint gracefully", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      // json() rejects → catches → {} → ret = -1
      const nonJsonResp = {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(nonJsonResp) // filetransfer → {} → fail
        .mockResolvedValueOnce(nonJsonResp); // misc-uploadimg2 → {} → fail

      const html = `<img src="https://nonjson.example.com/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      expect(result.failed).toBe(1);
    });

    it("handles content that is a URL (contentIsUrl=true) → fileId becomes null", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      // content is a URL → contentIsUrl=true → fileId=null
      const contentUrlResp = {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { ret: 0, err_msg: "" },
          cdn_url: "https://mmbiz.qpic.cn/upload/contenturl",
          content: "https://some.url/image.jpg",
          ai_status: 0,
        }),
      };

      // misc-uploadimg2 fallback also has no fileId
      const miscResp = {
        ok: true,
        status: 200,
        json: async () => ({
          base_resp: { ret: 0 },
          content: "https://mmbiz.qpic.cn/upload/misc",
        }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(contentUrlResp)
        .mockResolvedValueOnce(miscResp);

      const html = `<img src="https://contenturl.example.com/img.jpg" />`;
      const result = await service.rewriteImagesInHtml(
        mockPage as unknown as Page,
        html,
        "tok",
      );

      // filetransfer: url exists but fileId=null → skips to misc-uploadimg2
      // misc: url exists but fileId=null → uploadOne returns null → failed
      expect(result.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Browser-context functions: runCoverUploadAttempts
  // ---------------------------------------------------------------------------

  describe("runCoverUploadAttempts (passthrough page.evaluate)", () => {
    beforeEach(() => {
      mockPage = makePassthroughPage();
    });

    it("extracts mediaId from content field and returns full cover result", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      // Step 1: cover upload via filetransfer
      const coverUploadResp = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0, err_msg: "" },
            cdn_url: "https://mmbiz.qpic.cn/cover/raw",
            content: "600000001",
            ai_status: 1,
          }),
      };

      // Step 2: crop_multi
      // For crop we need window/document globals
      (global as unknown as Record<string, unknown>).window = {
        wx: undefined,
      };
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const cropResp = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            result: [
              { file_id: 600000002, cdnurl: "https://mmbiz.qpic.cn/cover/235" },
              { file_id: 600000003, cdnurl: "https://mmbiz.qpic.cn/cover/1_1" },
            ],
          }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(coverUploadResp)
        .mockResolvedValueOnce(cropResp);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://external.example.com/cover.jpg",
        "TOKEN_COVER",
        "abcdef0123456789abcdef0123456789", // 32-char hex fingerprint
      );

      expect(result).not.toBeNull();
      expect(result?.uploadFileId).toBe("600000001");
      expect(result?.uploadCdnUrl).toBe("https://mmbiz.qpic.cn/cover/raw");
      expect(result?.cropFileId235).toBe("600000002");
      expect(result?.cropCdnUrl235).toBe("https://mmbiz.qpic.cn/cover/235");
      expect(result?.cropFileId1_1).toBe("600000003");
      expect(result?.cropCdnUrl1_1).toBe("https://mmbiz.qpic.cn/cover/1_1");
    });

    it("uses content_url field as cdnUrl when cdn_url is absent", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const coverResp = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            content_url: "https://mmbiz.qpic.cn/cover/contenturl",
            file_id: "700000001",
            ai_status: 0,
          }),
      };

      (global as unknown as Record<string, unknown>).window = {};
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const cropResp = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            result: [
              {
                file_id: 700000002,
                cdnurl: "https://mmbiz.qpic.cn/cover/235b",
              },
              {
                file_id: 700000003,
                cdnurl: "https://mmbiz.qpic.cn/cover/1_1b",
              },
            ],
          }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(coverResp)
        .mockResolvedValueOnce(cropResp);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://contenturl.example.com/cover.png",
        "TCOVER2",
        "",
      );

      expect(result).not.toBeNull();
      expect(result?.uploadCdnUrl).toBe(
        "https://mmbiz.qpic.cn/cover/contenturl",
      );
      expect(result?.uploadFileId).toBe("700000001");
    });

    it("falls back to upload_img endpoint when scene8 returns ret=-1", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const scene8Fail = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ base_resp: { ret: -1, err_msg: "denied" } }),
      };

      const uploadImgOk = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            cdn_url: "https://mmbiz.qpic.cn/cover/uploadimg",
            media_id: 800000001,
            ai_status: 1,
          }),
      };

      (global as unknown as Record<string, unknown>).window = {};
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const cropResp = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            result: [
              {
                file_id: 800000002,
                cdnurl: "https://mmbiz.qpic.cn/cover/235c",
              },
              {
                file_id: 800000003,
                cdnurl: "https://mmbiz.qpic.cn/cover/1_1c",
              },
            ],
          }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(scene8Fail)
        .mockResolvedValueOnce(uploadImgOk)
        .mockResolvedValueOnce(cropResp);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fallback.example.com/cover.jpg",
        "TCOVER3",
        "fp32",
      );

      expect(result).not.toBeNull();
      expect(result?.uploadFileId).toBe("800000001");
    });

    it("returns null when both cover endpoints return ret=-1", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const failResp = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ base_resp: { ret: -1, err_msg: "fail" } }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(failResp)
        .mockResolvedValueOnce(failResp);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://bothfail.example.com/cover.jpg",
        "TCOVER4",
        "fp",
      );

      expect(result).toBeNull();
    });

    it("handles non-JSON text response in cover upload (rawText parse fails)", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const htmlResp = {
        ok: true,
        status: 200,
        text: async () => "<html>error</html>",
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(htmlResp)
        .mockResolvedValueOnce(htmlResp);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://htmlresp.example.com/cover.jpg",
        "TCOVER5",
        "fp",
      );

      // Both endpoints return non-JSON → mediaId=null → uploadCover returns null
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Browser-context functions: runCoverCropMulti fingerprint fallback paths
  // ---------------------------------------------------------------------------

  describe("runCoverCropMulti fingerprint fallback paths (passthrough)", () => {
    beforeEach(() => {
      mockPage = makePassthroughPage();
    });

    const setupFetchForCover = (fingerprint: string): void => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const coverOk = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            cdn_url: "https://mmbiz.qpic.cn/cover/fptest",
            content: "900000001",
            ai_status: 1,
          }),
      };

      const cropOk = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            result: [
              {
                file_id: 900000002,
                cdnurl: "https://mmbiz.qpic.cn/cover/235fp",
              },
              {
                file_id: 900000003,
                cdnurl: "https://mmbiz.qpic.cn/cover/1_1fp",
              },
            ],
          }),
      };

      void fingerprint; // used by caller to set window.wx
      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(coverOk)
        .mockResolvedValueOnce(cropOk);
    };

    it("uses fingerprint from window.wx.commonData.fingerprint when sniffed is empty", async () => {
      setupFetchForCover("");
      (global as unknown as Record<string, unknown>).window = {
        wx: { commonData: { fingerprint: "aabbccdd11223344aabbccdd11223344" } },
      };
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fp1.example.com/cover.jpg",
        "tok",
        "", // empty sniffed → falls back to window.wx
      );

      expect(result).not.toBeNull();
      expect(result?.cropFileId235).toBe("900000002");
    });

    it("uses fingerprint from window.wx.commonData.t when fingerprint field missing", async () => {
      setupFetchForCover("");
      (global as unknown as Record<string, unknown>).window = {
        wx: { commonData: { t: "tt11223344aabbccdd11223344aabbcc" } },
      };
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fp2.example.com/cover.jpg",
        "tok",
        "",
      );

      expect(result).not.toBeNull();
    });

    it("uses fingerprint from window.wx.fp when it is a string", async () => {
      setupFetchForCover("");
      (global as unknown as Record<string, unknown>).window = {
        wx: { fp: "fpstring1122334455667788aabbccdd" },
      };
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fp3.example.com/cover.jpg",
        "tok",
        "",
      );

      expect(result).not.toBeNull();
    });

    it("uses fingerprint from window.wx.fp.t when fp is an object with .t", async () => {
      setupFetchForCover("");
      (global as unknown as Record<string, unknown>).window = {
        wx: { fp: { t: "fpt1122334455667788aabbccddeeff0" } },
      };
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fp4.example.com/cover.jpg",
        "tok",
        "",
      );

      expect(result).not.toBeNull();
    });

    it("falls back to outerHTML regex when all window.wx paths miss", async () => {
      setupFetchForCover("");
      (global as unknown as Record<string, unknown>).window = { wx: undefined };
      // Embed a 32-char hex in the HTML
      (global as unknown as Record<string, unknown>).document = {
        documentElement: {
          outerHTML: '<html data-fp="aabbccddeeff00112233445566778899"></html>',
        },
      };

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fp5.example.com/cover.jpg",
        "tok",
        "",
      );

      expect(result).not.toBeNull();
    });

    it("proceeds with empty fingerprint when all fallbacks fail", async () => {
      setupFetchForCover("");
      (global as unknown as Record<string, unknown>).window = {};
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://fp6.example.com/cover.jpg",
        "tok",
        "",
      );

      // No fingerprint → crop still runs (empty fingerprint)
      expect(result).not.toBeNull();
    });

    it("handles crop_multi fetch exception and returns null for uploadCover", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const coverOk = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            cdn_url: "https://mmbiz.qpic.cn/cover/cropthrow",
            content: "950000001",
            ai_status: 1,
          }),
      };

      (global as unknown as Record<string, unknown>).window = {};
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      // crop_multi fetch throws network error
      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(coverOk)
        .mockRejectedValueOnce(new Error("crop network error"));

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://cropthrow.example.com/cover.jpg",
        "tok",
        "fp32chars0123456789abcdefabcdef0",
      );

      // crop_multi returns ok=false when fetch throws → uploadCover returns null
      expect(result).toBeNull();
    });

    it("handles crop_multi response with ret!=0 → ok=false → null", async () => {
      mockFetch.mockReset();

      let fetchImageReturned = false;
      const fetchImageMock = {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "image/jpeg"],
        ]) as unknown as Headers,
        body: {
          getReader: () => ({
            read: async () => {
              if (fetchImageReturned) return { done: true, value: undefined };
              fetchImageReturned = true;
              return { done: false, value: new Uint8Array(4) };
            },
            cancel: jest.fn().mockResolvedValue(undefined),
          }),
        },
      };

      const coverOk = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_resp: { ret: 0 },
            cdn_url: "https://mmbiz.qpic.cn/cover/cropfail",
            content: "960000001",
            ai_status: 1,
          }),
      };

      (global as unknown as Record<string, unknown>).window = {};
      (global as unknown as Record<string, unknown>).document = {
        documentElement: { outerHTML: "<html></html>" },
      };

      const cropFail = {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ base_resp: { ret: -1 }, result: [] }),
      };

      mockFetch
        .mockResolvedValueOnce(fetchImageMock)
        .mockResolvedValueOnce(coverOk)
        .mockResolvedValueOnce(cropFail);

      const result = await service.uploadCover(
        mockPage as unknown as Page,
        "https://cropfail.example.com/cover.jpg",
        "tok",
        "fp32",
      );

      expect(result).toBeNull();
    });
  });
});
