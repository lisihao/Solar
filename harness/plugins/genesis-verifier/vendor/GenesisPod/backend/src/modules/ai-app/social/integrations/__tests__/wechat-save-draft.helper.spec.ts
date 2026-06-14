/**
 * Unit tests for wechat-save-draft.helper.ts
 *
 * runSaveDraftAttempts is designed to run inside a browser context via
 * page.evaluate. Here we polyfill the browser globals (window, document,
 * URLSearchParams, fetch) so the pure function can be tested in Node.js
 * without any Puppeteer dependency.
 */

import {
  runSaveDraftAttempts,
  type SaveDraftApiParams,
  type SaveDraftApiResult,
} from "../wechat/wechat-save-draft.helper";

// ---------------------------------------------------------------------------
// Browser-global polyfills (scoped to this test file)
// ---------------------------------------------------------------------------

// Minimal window object used by runSaveDraftAttempts
// The function uses `window` directly so we must set global.window to a
// proxy-like object and assign properties onto it.
const windowProxy: Record<string, unknown> = {};

const setupWindowGlobals = (overrides: Record<string, unknown> = {}) => {
  // Clear previous values
  delete windowProxy.wx;
  delete windowProxy.cgiData;
  // Set new values
  windowProxy.wx = undefined;
  windowProxy.cgiData = undefined;
  for (const [k, v] of Object.entries(overrides)) {
    windowProxy[k] = v;
  }
  // Make `window` in global scope equal to our proxy
  (global as Record<string, unknown>).window = windowProxy;
};

// Minimal document object
// document.scripts is iterable via Array.from; outerHTML on documentElement
const setupDocumentGlobals = (
  scripts: Array<{ textContent: string | null }> = [],
  outerHTMLContent = "",
) => {
  (global as Record<string, unknown>).document = {
    scripts, // Array.from(scripts) works since arrays are iterable
    documentElement: {
      outerHTML: outerHTMLContent,
    },
  };
};

// Build a mock fetch response
function makeFetchResponse(
  bodyText: string,
  status = 200,
): () => Promise<{ status: number; text: () => Promise<string> }> {
  return () =>
    Promise.resolve({
      status,
      text: () => Promise.resolve(bodyText),
    });
}

// Default params
function makeParams(
  overrides: Partial<SaveDraftApiParams> = {},
): SaveDraftApiParams {
  return {
    token: "12345",
    title: "Test Title",
    author: "System",
    digest: "Short digest",
    content: "<p>Content</p>",
    sniffedFingerprint: "",
    coverBackCdnUrl: "",
    coverCrop235CdnUrl: "",
    coverCrop235FileId: "",
    coverCrop1_1CdnUrl: "",
    coverCrop1_1FileId: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: run with mocked fetch
// ---------------------------------------------------------------------------

async function runWith(
  params: SaveDraftApiParams,
  fetchImpl: (
    url: string,
    opts?: RequestInit,
  ) => Promise<{ status: number; text: () => Promise<string> }>,
): Promise<SaveDraftApiResult> {
  (global as Record<string, unknown>).fetch = fetchImpl;
  return runSaveDraftAttempts(params);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSaveDraftAttempts", () => {
  beforeEach(() => {
    // Reset globals to clean state
    setupWindowGlobals();
    setupDocumentGlobals();
    (global as Record<string, unknown>).URLSearchParams = URLSearchParams;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── fingerprint source: sniffed ──────────────────────────────────────────

  describe("fingerprint resolution", () => {
    it("uses sniffedFingerprint when provided", async () => {
      const fp = "a".repeat(32);
      const responseJson = JSON.stringify({
        base_resp: { ret: 0 },
        appMsgId: 111,
      });
      const result = await runWith(
        makeParams({ sniffedFingerprint: fp }),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("sniffed");
    });

    it("falls back to window.wx.commonData.fingerprint when sniff is empty", async () => {
      const fp = "b".repeat(32);
      setupWindowGlobals({
        wx: { commonData: { fingerprint: fp } },
      });
      setupDocumentGlobals();
      const responseJson = JSON.stringify({
        base_resp: { ret: 0 },
        appMsgId: 222,
      });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("window.wx.commonData.fingerprint");
    });

    it("falls back to window.wx.commonData.t when fingerprint missing", async () => {
      const fp = "c".repeat(32);
      setupWindowGlobals({
        wx: { commonData: { t: fp } },
      });
      setupDocumentGlobals();
      const responseJson = JSON.stringify({ base_resp: { ret: 1 }, ret: 1 });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("window.wx.commonData.t");
    });

    it("falls back to window.wx.fp when it is a string", async () => {
      const fp = "d".repeat(32);
      setupWindowGlobals({ wx: { fp } });
      setupDocumentGlobals();
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("window.wx.fp(string)");
    });

    it("falls back to window.wx.fp.t when fp is object with t property", async () => {
      const fp = "e".repeat(32);
      setupWindowGlobals({ wx: { fp: { t: fp } } });
      setupDocumentGlobals();
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("window.wx.fp.t");
    });

    it("falls back to window.cgiData.fingerprint", async () => {
      const fp = "f".repeat(32);
      setupWindowGlobals({ cgiData: { fingerprint: fp } });
      setupDocumentGlobals();
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("window.cgiData.fingerprint");
    });

    it("falls back to window.cgiData.t", async () => {
      const fp = "0".repeat(32);
      setupWindowGlobals({ cgiData: { t: fp } });
      setupDocumentGlobals();
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("window.cgiData.t");
    });

    it("falls back to inline script scanning", async () => {
      const fp = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
      setupWindowGlobals();
      // Pattern: /(?:fingerprint|"t"|'t'|\bt)["':\s]+["']([a-f0-9]{32})["']/
      // Match: fingerprint:"<32hex>"
      setupDocumentGlobals([
        { textContent: `var data = {fingerprint:"${fp}"}` },
      ]);
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("inline-script");
    });

    it("falls back to outerHTML scan when no script matches", async () => {
      const fp = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
      setupWindowGlobals();
      setupDocumentGlobals(
        [{ textContent: "no-match-here" }],
        `<html><head><meta name="token" content="${fp}"/></head></html>`,
      );
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("outerHTML");
    });

    it("returns empty fingerprint and source when nothing found", async () => {
      setupWindowGlobals();
      setupDocumentGlobals([], "");
      const responseJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseJson),
      );
      expect(result.fingerprint).toBe("");
      expect(result.fpSource).toBe("");
    });
  });

  // ─── schema fallback: first schema wins ────────────────────────────────────

  describe("schema retry logic", () => {
    it("returns winning json on first successful schema (ret=0 + appMsgId)", async () => {
      const winningJson = JSON.stringify({
        base_resp: { ret: 0 },
        appMsgId: 999,
      });
      const result = await runWith(
        makeParams({ sniffedFingerprint: "a".repeat(32) }),
        makeFetchResponse(winningJson),
      );
      expect(result.json?.appMsgId).toBe(999);
      expect(result.json?.base_resp?.ret).toBe(0);
      expect(result.status).toBeGreaterThan(0);
    });

    it("continues to second schema when first returns ret!=0", async () => {
      let callCount = 0;
      const fetchMock = () => {
        callCount++;
        const body =
          callCount === 1
            ? JSON.stringify({
                base_resp: { ret: 200002, err_msg: "bad fingerprint" },
              })
            : JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 888 });
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(body),
        });
      };
      const result = await runWith(makeParams(), fetchMock);
      expect(callCount).toBe(2);
      expect(result.json?.appMsgId).toBe(888);
    });

    it("continues to third schema when first two fail", async () => {
      let callCount = 0;
      const fetchMock = () => {
        callCount++;
        const body =
          callCount < 3
            ? JSON.stringify({ base_resp: { ret: 1 } })
            : JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 777 });
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(body),
        });
      };
      const result = await runWith(makeParams(), fetchMock);
      expect(callCount).toBe(3);
      expect(result.json?.appMsgId).toBe(777);
    });

    it("returns last attempt result when all schemas fail", async () => {
      const failJson = JSON.stringify({
        base_resp: { ret: 1, err_msg: "fail" },
      });
      let callCount = 0;
      const fetchMock = () => {
        callCount++;
        return Promise.resolve({
          status: 400,
          text: () => Promise.resolve(failJson),
        });
      };
      const result = await runWith(makeParams(), fetchMock);
      expect(callCount).toBe(3);
      expect(result.json).toBeNull();
      expect(result.status).toBe(400);
    });

    it("handles non-JSON response body without throwing", async () => {
      const result = await runWith(
        makeParams(),
        makeFetchResponse("not-json-at-all"),
      );
      expect(result.json).toBeNull();
      // bodyPreview includes the attempt data
      expect(result.bodyPreview).toContain("not-json-at-all");
    });

    it("stops at first winner and does not call further schemas", async () => {
      let callCount = 0;
      const fetchMock = () => {
        callCount++;
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 555 }),
            ),
        });
      };
      const result = await runWith(makeParams(), fetchMock);
      // Only first schema should have been called (winner)
      expect(callCount).toBe(1);
      expect(result.json?.appMsgId).toBe(555);
    });

    it("uses json.ret instead of base_resp.ret when base_resp absent", async () => {
      const responseBody = JSON.stringify({ ret: 0, appMsgId: 444 });
      const result = await runWith(
        makeParams(),
        makeFetchResponse(responseBody),
      );
      expect(result.json?.appMsgId).toBe(444);
    });
  });

  // ─── cover fields ──────────────────────────────────────────────────────────

  describe("cover fields in request body", () => {
    it("includes cover cdn_url fields when all cover params provided", async () => {
      const params = makeParams({
        sniffedFingerprint: "a".repeat(32),
        coverBackCdnUrl: "https://mmbiz.qpic.cn/back.jpg",
        coverCrop235CdnUrl: "https://mmbiz.qpic.cn/crop235.jpg",
        coverCrop235FileId: "12345",
        coverCrop1_1CdnUrl: "https://mmbiz.qpic.cn/crop11.jpg",
        coverCrop1_1FileId: "67890",
      });

      let capturedBody = "";
      const fetchMock = (_url: string, opts?: RequestInit) => {
        capturedBody = (opts?.body as string) || "";
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 333 }),
            ),
        });
      };

      await runWith(params, fetchMock);
      expect(capturedBody).toContain("cdn_url0=");
      expect(capturedBody).toContain("cdn_url_back0=");
      expect(capturedBody).toContain("crop_list0=");
    });

    it("sends empty cover fields when cover params are all empty", async () => {
      let capturedBody = "";
      const fetchMock = (_url: string, opts?: RequestInit) => {
        capturedBody = (opts?.body as string) || "";
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 222 }),
            ),
        });
      };

      await runWith(makeParams(), fetchMock);
      // crop_list0 should be empty string when no cover
      expect(capturedBody).toContain("crop_list0=");
      // cdn_url0 should be present but empty
      expect(capturedBody).toContain("cdn_url0=");
    });

    it("sends numeric file_id when coverCrop235FileId is numeric string", async () => {
      const params = makeParams({
        coverBackCdnUrl: "https://back.cdn",
        coverCrop235CdnUrl: "https://235.cdn",
        coverCrop235FileId: "99999",
        coverCrop1_1CdnUrl: "https://11.cdn",
        coverCrop1_1FileId: "88888",
      });

      let capturedBody = "";
      const fetchMock = (_url: string, opts?: RequestInit) => {
        capturedBody = (opts?.body as string) || "";
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 111 }),
            ),
        });
      };

      await runWith(params, fetchMock);
      // crop_list0 should contain the encoded JSON with numeric file_ids
      const cropList0Match = capturedBody.match(/crop_list0=([^&]*)/);
      expect(cropList0Match).toBeTruthy();
      const cropDecoded = decodeURIComponent(cropList0Match![1]);
      expect(cropDecoded).toContain("99999");
    });

    it("uses string file_id when value is non-numeric", async () => {
      const params = makeParams({
        coverBackCdnUrl: "https://back.cdn",
        coverCrop235CdnUrl: "https://235.cdn",
        coverCrop235FileId: "non-numeric-id",
        coverCrop1_1CdnUrl: "https://11.cdn",
        coverCrop1_1FileId: "another-non-numeric",
      });

      let capturedBody = "";
      const fetchMock = (_url: string, opts?: RequestInit) => {
        capturedBody = (opts?.body as string) || "";
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 1 }),
            ),
        });
      };

      await runWith(params, fetchMock);
      const cropList0Match = capturedBody.match(/crop_list0=([^&]*)/);
      expect(cropList0Match).toBeTruthy();
      const cropDecoded = decodeURIComponent(cropList0Match![1]);
      expect(cropDecoded).toContain("non-numeric-id");
    });
  });

  // ─── bodyPreview truncation ────────────────────────────────────────────────

  describe("bodyPreview", () => {
    it("truncates bodyPreview to 2500 chars", async () => {
      const longBody = "x".repeat(5000);
      const result = await runWith(makeParams(), makeFetchResponse(longBody));
      expect(result.bodyPreview.length).toBeLessThanOrEqual(2500);
    });

    it("includes all schema attempt names in bodyPreview", async () => {
      const failJson = JSON.stringify({ base_resp: { ret: 1 } });
      const result = await runWith(makeParams(), makeFetchResponse(failJson));
      expect(result.bodyPreview).toContain("v2-multi-suffixed");
    });
  });

  // ─── request structure ─────────────────────────────────────────────────────

  describe("request structure", () => {
    it("sends POST with application/x-www-form-urlencoded content-type", async () => {
      let capturedOptions: RequestInit | undefined;
      const fetchMock = (_url: string, opts?: RequestInit) => {
        capturedOptions = opts;
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 1 }),
            ),
        });
      };
      await runWith(makeParams(), fetchMock);
      expect(capturedOptions?.method).toBe("POST");
      expect(capturedOptions?.headers?.["Content-Type"]).toContain(
        "application/x-www-form-urlencoded",
      );
      expect(capturedOptions?.credentials).toBe("include");
    });

    it("includes token in first schema endpoint URL", async () => {
      let capturedUrl = "";
      const fetchMock = (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 1 }),
            ),
        });
      };
      await runWith(makeParams({ token: "TOKEN123" }), fetchMock);
      expect(capturedUrl).toContain("TOKEN123");
    });

    it("first schema URL contains type=77", async () => {
      let capturedUrl = "";
      const fetchMock = (url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 1 }),
            ),
        });
      };
      await runWith(makeParams({ token: "tok" }), fetchMock);
      expect(capturedUrl).toContain("type=77");
    });

    it("third schema uses appmsg?action=add_appmsg endpoint", async () => {
      const urls: string[] = [];
      const fetchMock = (url: string) => {
        urls.push(url);
        const isThird = urls.length === 3;
        const body = isThird
          ? JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 1 })
          : JSON.stringify({ base_resp: { ret: 1 } });
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(body),
        });
      };
      await runWith(makeParams({ token: "tok" }), fetchMock);
      expect(urls.length).toBeGreaterThanOrEqual(3);
      expect(urls[2]).toContain("action=add_appmsg");
    });
  });

  // ─── result construction ────────────────────────────────────────────────────

  describe("result construction", () => {
    it("returns winningStatus from first successful response", async () => {
      const fetchMock = () =>
        Promise.resolve({
          status: 201,
          text: () =>
            Promise.resolve(
              JSON.stringify({ base_resp: { ret: 0 }, appMsgId: 1 }),
            ),
        });
      const result = await runWith(makeParams(), fetchMock);
      expect(result.status).toBe(201);
    });

    it("returns last status when no winner", async () => {
      let call = 0;
      const fetchMock = () => {
        call++;
        const status = call === 3 ? 500 : 200;
        return Promise.resolve({
          status,
          text: () =>
            Promise.resolve(JSON.stringify({ base_resp: { ret: 1 } })),
        });
      };
      const result = await runWith(makeParams(), fetchMock);
      expect(result.status).toBe(500);
    });

    it("returns null json when all schemas return non-zero ret", async () => {
      const result = await runWith(
        makeParams(),
        makeFetchResponse(JSON.stringify({ base_resp: { ret: 42 } })),
      );
      expect(result.json).toBeNull();
    });

    it("returns null json when ret=0 but appMsgId absent", async () => {
      const result = await runWith(
        makeParams(),
        makeFetchResponse(JSON.stringify({ base_resp: { ret: 0 } })),
      );
      // ret=0 but no appMsgId => no winner => json remains null
      expect(result.json).toBeNull();
    });
  });

  // ─── wx.fp.t edge case ────────────────────────────────────────────────────

  describe("window.wx.fp edge cases", () => {
    it("handles wx.fp as object with empty t string", async () => {
      setupWindowGlobals({ wx: { fp: { t: "" } } });
      setupDocumentGlobals();
      const result = await runWith(
        makeParams(),
        makeFetchResponse(JSON.stringify({ base_resp: { ret: 1 } })),
      );
      // empty t → fingerprint remains empty (wx.fp.t = "" → falsy)
      expect(result.fingerprint).toBe("");
    });

    it("handles wx.fp as object without t (uses outerHTML fallback)", async () => {
      const fp = "aabbccddeeff00112233445566778899";
      setupWindowGlobals({ wx: { fp: { otherField: "x" } } });
      setupDocumentGlobals([], `<html>"${fp}"</html>`);
      const result = await runWith(
        makeParams(),
        makeFetchResponse(JSON.stringify({ base_resp: { ret: 1 } })),
      );
      expect(result.fingerprint).toBe(fp);
      expect(result.fpSource).toBe("outerHTML");
    });
  });
});
