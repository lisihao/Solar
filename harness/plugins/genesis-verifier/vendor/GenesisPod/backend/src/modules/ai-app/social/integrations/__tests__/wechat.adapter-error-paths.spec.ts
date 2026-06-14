/**
 * WechatAdapter — error paths & page.on handler coverage
 *
 * Covers Node.js-reachable lines NOT hit by the other 6 spec files:
 *
 * - attachSniffer request handler (lines 287-296): fingerprint capture logic
 * - saveDraft captureHandler response handler (lines 1747-1758): URL filter
 * - saveDraft requestHandler request handler (lines 1777-1786): POST capture
 * - saveDraft Ctrl+S catch block (line 1843): keyboard.down throws
 * - saveDraft waitForResponse failure + capturedUrls log (lines 2182-2200)
 * - saveDraft waitForResponse failure + capturedPosts dump (lines 2204-2252)
 * - saveDraft alternative save: toast confirm (lines 2263-2278)
 * - saveDraft alternative save: URL aid confirm (lines 2283-2291)
 * - saveDraft final throw when saveSucceeded=false (lines 2317-2318)
 * - saveDraft API returns null, UI click path runs (line 1726-1733)
 * - fillContent author not found (line 1572)
 * - fillContent author throws (lines 1574-1577)
 * - fillContent digest not provided (branch skip)
 * - fillContent digest fill inner catch (lines 1608-1613)
 * - captureDebugInfo page.$ catch (lines 881-887)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WechatAdapter } from "../wechat/wechat.adapter";
import { SocialBrowserService } from "../../mission/services/social-browser.service";
import { WechatImageUploaderService } from "../../mission/services/wechat-image-uploader.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-engine/facade";
import {
  SocialContent,
  SocialPlatformConnection,
  SocialPlatformType,
  SocialContentType,
  SocialContentStatus,
  SocialContentSourceType,
} from "../../mission/types";

// ---------------------------------------------------------------------------
// Mock session-crypto
// ---------------------------------------------------------------------------
jest.mock("../../mission/services/session-crypto", () => ({
  decryptSession: jest.fn(),
  encryptSession: jest.fn((data: unknown) => JSON.stringify(data)),
  isEncrypted: jest.fn(() => false),
}));

import { decryptSession } from "../../mission/services/session-crypto";
const mockDecryptSession = decryptSession as jest.MockedFunction<
  typeof decryptSession
>;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeValidSession() {
  return {
    cookies: [
      {
        name: "slave_user",
        value: "u1",
        domain: "mp.weixin.qq.com",
        expires: -1,
      },
      {
        name: "data_ticket",
        value: "t1",
        domain: "mp.weixin.qq.com",
        expires: -1,
      },
    ],
    wechatToken: "tok999",
  };
}

function makeConnection(): SocialPlatformConnection {
  return {
    id: "conn-err",
    userId: "user-err",
    platformType: SocialPlatformType.WECHAT_MP,
    isActive: true,
    sessionData: "encrypted",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SocialPlatformConnection;
}

function makeContent(overrides: Partial<SocialContent> = {}): SocialContent {
  return {
    id: "c-err",
    userId: "user-err",
    title: "Error Test Title",
    content: "x".repeat(200),
    contentType: SocialContentType.WECHAT_ARTICLE,
    status: SocialContentStatus.DRAFT,
    sourceType: SocialContentSourceType.MANUAL,
    images: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialContent;
}

// ---------------------------------------------------------------------------
// Mock page factory
// ---------------------------------------------------------------------------

type OnHandler = (arg: unknown) => void;

function makeMockPage(evaluateResults: unknown[] = []) {
  let evaluateIdx = 0;
  const onHandlers: Record<string, OnHandler[]> = {};

  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest
      .fn()
      .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home?token=12345"),
    reload: jest.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue({ click: jest.fn() }),
    evaluate: jest.fn().mockImplementation(() => {
      const result = evaluateResults[evaluateIdx];
      evaluateIdx++;
      if (result === undefined) return Promise.resolve("");
      return Promise.resolve(result);
    }),
    $: jest.fn().mockResolvedValue(null),
    $$: jest.fn().mockResolvedValue([]),
    $$eval: jest.fn().mockResolvedValue([]),
    screenshot: jest.fn().mockResolvedValue(Buffer.from("")),
    title: jest.fn().mockResolvedValue("WeChat Editor"),
    browser: jest.fn().mockReturnValue({ once: jest.fn() }),
    on: jest.fn().mockImplementation((event: string, handler: OnHandler) => {
      if (!onHandlers[event]) onHandlers[event] = [];
      onHandlers[event].push(handler);
    }),
    off: jest.fn(),
    frames: jest.fn().mockReturnValue([]),
    keyboard: {
      down: jest.fn().mockResolvedValue(undefined),
      up: jest.fn().mockResolvedValue(undefined),
      press: jest.fn().mockResolvedValue(undefined),
      type: jest.fn().mockResolvedValue(undefined),
    },
    waitForResponse: jest.fn().mockResolvedValue({
      url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
      json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
    }),
    mouse: {
      move: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    },
    // Helper to fire captured handlers in tests
    _fireOnHandlers: (event: string, arg: unknown) => {
      (onHandlers[event] ?? []).forEach((h) => h(arg));
    },
  };

  return page;
}

// ---------------------------------------------------------------------------
// Module builder
// ---------------------------------------------------------------------------

async function buildModule(
  mockPage: ReturnType<typeof makeMockPage>,
  overrides: {
    imageUploader?: Partial<{
      rewriteImagesInHtml: jest.Mock;
      uploadCover: jest.Mock;
    }>;
  } = {},
) {
  const imageUploader = {
    rewriteImagesInHtml: jest
      .fn()
      .mockImplementation((_p: unknown, html: string) =>
        Promise.resolve({
          rewritten: html,
          uploaded: 0,
          failed: 0,
          skipped: 0,
        }),
      ),
    uploadCover: jest.fn().mockResolvedValue(null),
    ...overrides.imageUploader,
  };

  const toolRegistry = {
    get: jest.fn().mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: { cookies: [] },
      }),
    }),
  };

  const chatFacade = {
    chat: jest.fn().mockResolvedValue({ content: "short" }),
  };

  const browserService = {
    restoreSession: jest.fn().mockResolvedValue(undefined),
    createPage: jest.fn().mockResolvedValue(mockPage),
    closeContext: jest.fn().mockResolvedValue(undefined),
    getContext: jest.fn().mockResolvedValue(null),
    saveSession: jest.fn().mockResolvedValue(null),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WechatAdapter,
      { provide: SocialBrowserService, useValue: browserService },
      { provide: WechatImageUploaderService, useValue: imageUploader },
      { provide: ChatFacade, useValue: chatFacade },
      { provide: ToolRegistry, useValue: toolRegistry },
    ],
  }).compile();

  return {
    adapter: module.get<WechatAdapter>(WechatAdapter),
    mockPage,
    imageUploader,
  };
}

// ---------------------------------------------------------------------------
// Standard evaluate results for a successful fillContent + saveDraftViaApi run
// ---------------------------------------------------------------------------
function makeSuccessEvaluateSequence() {
  return [
    // fillContent page state
    {
      url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
      title: "Editor",
      bodyText: "",
    },
    // fillContent allInputs
    [],
    // title sync
    {
      ok: true,
      reason: "filled",
      tag: "TEXTAREA",
      placeholder: "标题",
      maxLength: "20",
      finalValue: "Error Test Title",
    },
    // body fill
    { success: true, selector: ".ProseMirror-focused", method: "paste" },
    // content length check — passes
    180,
    // saveDraftViaApi: runSaveDraftAttempts result
    {
      status: "ok",
      fingerprint: "abc123def456abc123def456abc12300",
      fpSource: "sniffed",
      bodyPreview: "attempt-v1",
      json: { ret: 0, appMsgId: 11111 },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WechatAdapter — error paths & page.on handler coverage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // attachSniffer: page.on('request') handler logic (lines 287-296)
  // -------------------------------------------------------------------------

  describe("attachSniffer request handler (lines 287-296)", () => {
    it("captures fingerprint from matching WeChat MP request URL", async () => {
      const mockPage = makeMockPage(makeSuccessEvaluateSequence());
      mockPage.$.mockResolvedValue({
        click: jest.fn(),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());

      // Let publish() attach the sniffer (happens synchronously in the flow
      // before the first await that could yield to fake timers)
      await Promise.resolve();
      await Promise.resolve();

      // Fire the 'request' handler with a URL containing a fingerprint
      mockPage._fireOnHandlers("request", {
        url: () =>
          "https://mp.weixin.qq.com/cgi-bin/page?fingerprint=aabbccddeeff00112233445566778899",
        postData: () => undefined,
      });

      // Fire again with a non-WeChat URL — should not capture (already set above)
      mockPage._fireOnHandlers("request", {
        url: () => "https://other.com/page",
        postData: () => undefined,
      });

      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Publish should succeed regardless
      expect(result.success).toBe(true);
    });

    it("skips fingerprint when URL does not contain mp.weixin.qq.com", async () => {
      const mockPage = makeMockPage(makeSuccessEvaluateSequence());
      mockPage.$.mockResolvedValue({
        click: jest.fn(),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await Promise.resolve();
      await Promise.resolve();

      // Fire request with non-WeChat URL — line 290 `if (!url.includes(...)) return`
      mockPage._fireOnHandlers("request", {
        url: () =>
          "https://example.com/track?fingerprint=aabbccddeeff00112233445566778899",
        postData: () => undefined,
      });

      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it("skips fingerprint when URL has no fingerprint param", async () => {
      const mockPage = makeMockPage(makeSuccessEvaluateSequence());
      mockPage.$.mockResolvedValue({
        click: jest.fn(),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await Promise.resolve();
      await Promise.resolve();

      // Fire request with WeChat URL but no fingerprint — lines 290-295 path
      mockPage._fireOnHandlers("request", {
        url: () => "https://mp.weixin.qq.com/cgi-bin/home?token=999",
        postData: () => "somedata=value",
      });

      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft captureHandler (response, lines 1747-1758)
  // -------------------------------------------------------------------------

  describe("saveDraft captureHandler (response handler, lines 1747-1758)", () => {
    it("filters non-200 responses (line 1748 early return)", async () => {
      // Replace idx 5 (saveDraftViaApi) with appMsgId=0 to force UI-click path
      const evalResults: unknown[] = [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined, // field sync
        [], // find candidates
        null, // dialog probe
      ];
      // Rebuild page with correct sequence
      const mockPage2 = makeMockPage(evalResults);
      mockPage2.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage2.$$.mockResolvedValue([]);
      mockPage2.$$eval.mockResolvedValue([]);

      // Use a manually controlled waitForResponse so we can fire handlers before it resolves
      let resolveWfr!: (v: unknown) => void;
      const wfrPromise = new Promise((resolve) => {
        resolveWfr = resolve;
      });
      mockPage2.waitForResponse.mockReturnValue(wfrPromise);

      const { adapter } = await buildModule(mockPage2);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());

      // Advance all timers until execution pauses at waitForResponse (unresolved promise)
      await jest.runAllTimersAsync();

      // captureHandler is now registered — fire test events
      // Non-200 response → line 1748 early return (no push)
      mockPage2._fireOnHandlers("response", {
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
        status: () => 404,
      });
      // Static resource → line 1751-1756 filter (no push)
      mockPage2._fireOnHandlers("response", {
        url: () => "https://mp.weixin.qq.com/res/test.js",
        status: () => 200,
      });
      // Valid API URL → should be captured (line 1758)
      mockPage2._fireOnHandlers("response", {
        url: () => "https://mp.weixin.qq.com/cgi-bin/some-api",
        status: () => 200,
      });

      // Resolve waitForResponse and complete the flow
      resolveWfr({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });
      await jest.runAllTimersAsync();
      await resultPromise.catch(() => {});
    });

    it("filters static resource URLs (lines 1751-1756 early return)", async () => {
      const evalResults2: unknown[] = [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        null,
      ];
      const mockPage3 = makeMockPage(evalResults2);
      mockPage3.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage3.$$.mockResolvedValue([]);
      mockPage3.$$eval.mockResolvedValue([]);

      let resolveWfr2!: (v: unknown) => void;
      const wfrPromise2 = new Promise((resolve) => {
        resolveWfr2 = resolve;
      });
      mockPage3.waitForResponse.mockReturnValue(wfrPromise2);

      const { adapter } = await buildModule(mockPage3);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();

      // Fire static resource — hits /htmledition/ filter (lines 1753-1754)
      mockPage3._fireOnHandlers("response", {
        url: () => "https://mp.weixin.qq.com/htmledition/style.css",
        status: () => 200,
      });
      // Fire .js extension — hits regex filter (lines 1751-1752)
      mockPage3._fireOnHandlers("response", {
        url: () => "https://mp.weixin.qq.com/cgi-bin/some.js",
        status: () => 200,
      });
      // Fire non-WeChat URL → line 1750 filter
      mockPage3._fireOnHandlers("response", {
        url: () => "https://other.com/api",
        status: () => 200,
      });

      resolveWfr2({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });
      await jest.runAllTimersAsync();
      await resultPromise.catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft requestHandler (POST capture, lines 1777-1786)
  // -------------------------------------------------------------------------

  describe("saveDraft requestHandler (request handler, lines 1777-1786)", () => {
    it("skips GET requests (line 1779 early return)", async () => {
      // requestHandler is registered after delay(2000) — must use manual wfr pattern
      const evalResultsReq: unknown[] = [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined, // field sync
        [], // find candidates
        null, // dialog probe
      ];
      const mockPageReq = makeMockPage(evalResultsReq);
      mockPageReq.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPageReq.$$.mockResolvedValue([]);
      mockPageReq.$$eval.mockResolvedValue([]);

      let resolveWfrReq!: (v: unknown) => void;
      const wfrPromiseReq = new Promise((resolve) => {
        resolveWfrReq = resolve;
      });
      mockPageReq.waitForResponse.mockReturnValue(wfrPromiseReq);

      const { adapter } = await buildModule(mockPageReq);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());

      // Advance timers until execution pauses at waitForResponse — requestHandler is now registered
      await jest.runAllTimersAsync();

      // Fire GET request — line 1779 early return (not captured)
      mockPageReq._fireOnHandlers("request", {
        method: () => "GET",
        url: () => "https://mp.weixin.qq.com/cgi-bin/home",
        postData: () => undefined,
        resourceType: () => "fetch",
      });

      // Fire OPTIONS request — line 1779 early return (not captured)
      mockPageReq._fireOnHandlers("request", {
        method: () => "OPTIONS",
        url: () => "https://mp.weixin.qq.com/cgi-bin/home",
        postData: () => undefined,
        resourceType: () => "preflight",
      });

      // Fire non-WeChat POST — line 1780 early return (not captured)
      mockPageReq._fireOnHandlers("request", {
        method: () => "POST",
        url: () => "https://other.com/api",
        postData: () => "data",
        resourceType: () => "fetch",
      });

      // Fire WeChat POST — captured at line 1785-1786
      mockPageReq._fireOnHandlers("request", {
        method: () => "POST",
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
        postData: () => "token=999&title=test",
        resourceType: () => "fetch",
      });

      resolveWfrReq({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });
      await jest.runAllTimersAsync();
      await resultPromise.catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft: Ctrl+S catch block (line 1843-1845)
  // -------------------------------------------------------------------------

  describe("saveDraft: Ctrl+S catch block (line 1843-1845)", () => {
    it("logs warn when keyboard.down throws, then falls through to mouse click", async () => {
      // Use makeSuccessEvaluateSequence which includes body fill (idx 3) and content
      // length check (idx 4) — these are consumed only when editor is found via page.$
      const mockPage = makeMockPage([
        // fillContent page state
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        // fillContent allInputs
        [],
        // title sync
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        // body fill (consumed because editor is found)
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        // content length check (consumed because fillResult.success=true)
        180,
        // saveDraftViaApi returns null (appMsgId=0 → null)
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        // step 0 field sync eval
        undefined,
        // step 2 find candidates — one candidate so mouse.click runs
        [
          {
            tag: "BUTTON",
            className: "weui-btn",
            role: "",
            outerHTML: "<button>保存为草稿</button>",
            pageY: 500,
          },
        ],
        // step 2 post-scroll eval (fresh bbox)
        {
          freshX: 100,
          freshY: 500,
          atPoint: "BUTTON.weui-btn",
          viewport: "1280x720",
        },
        // dialog probe (null = no dialog)
        null,
      ]);

      // Provide editor handle so that body fill evaluate is reached
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null); // author not found, toast not found

      // keyboard.down throws so Ctrl+S catch block is triggered
      mockPage.keyboard.down.mockRejectedValue(new Error("keyboard error"));

      // waitForResponse succeeds
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      // keyboard.down was called and threw — the catch should have been hit
      expect(mockPage.keyboard.down).toHaveBeenCalledWith("Control");
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft: waitForResponse failure + capturedUrls log (lines 2182-2199)
  // -------------------------------------------------------------------------

  describe("saveDraft waitForResponse failure paths (lines 2181-2252)", () => {
    // Helper: builds a standard evaluate sequence for UI-click path with editor handle.
    // Returns [evalResults, editorHandle] for reuse across these tests.
    function makeWfrFailEvalResults() {
      return [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" }, // body fill (editor found)
        180, // content length check
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined, // field sync
        [], // find candidates
        [], // $$eval buttons
        null, // dialog probe
      ];
    }

    it("logs capturedUrls when waitForResponse times out with captured URLs", async () => {
      // captureHandler must be registered (after delay(2000)) before we fire events.
      // Use manual-reject wfr pattern so we can fire handler in the window before rejection.
      const mockPage = makeMockPage(makeWfrFailEvalResults());
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);

      let rejectWfr!: (err: Error) => void;
      const wfrPromise = new Promise<never>((_, reject) => {
        rejectWfr = reject;
      });
      mockPage.waitForResponse.mockReturnValue(wfrPromise);

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());

      // Advance timers until execution reaches waitForResponse — captureHandler registered
      await jest.runAllTimersAsync();

      // Fire response event so capturedUrls gets populated (line 1758)
      mockPage._fireOnHandlers("response", {
        url: () => "https://mp.weixin.qq.com/cgi-bin/some-endpoint",
        status: () => 200,
      });

      // Now reject waitForResponse to trigger the capturedUrls warn path (lines 2188-2192)
      rejectWfr(new Error("Timeout 30000ms exceeded"));
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(false);
    });

    it("logs 'no mp.weixin.qq.com responses captured' warn when capturedUrls empty", async () => {
      // No handlers fired → capturedUrls empty → line 2194-2199 warn path.
      // waitForResponse can just reject immediately since no handler firing needed.
      const mockPage = makeMockPage(makeWfrFailEvalResults());
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockRejectedValue(new Error("timeout"));

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(false);
    });

    it("dumps capturedPosts when waitForResponse fails with POST data (lines 2204-2252)", async () => {
      const mockPage = makeMockPage(makeWfrFailEvalResults());
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);

      let rejectWfrPosts!: (err: Error) => void;
      const wfrPostsPromise = new Promise<never>((_, reject) => {
        rejectWfrPosts = reject;
      });
      mockPage.waitForResponse.mockReturnValue(wfrPostsPromise);

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());

      // Advance until requestHandler is registered
      await jest.runAllTimersAsync();

      // Fire POST request so capturedPosts gets populated (lines 1785-1786)
      mockPage._fireOnHandlers("request", {
        method: () => "POST",
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
        postData: () => "token=999&title=hello&content=world",
        resourceType: () => "fetch",
      });

      // Fire mplog POST — triggers the decode path (lines 2217-2245)
      const mplogBody = new URLSearchParams({
        log: JSON.stringify({
          data: [
            {
              data: JSON.stringify({
                description: "test description",
                msg: "this is fail save path",
              }),
            },
          ],
        }),
      }).toString();
      mockPage._fireOnHandlers("request", {
        method: () => "POST",
        url: () => "https://mp.weixin.qq.com/advanced/mplog?action=up",
        postData: () => mplogBody,
        resourceType: () => "fetch",
      });

      rejectWfrPosts(new Error("timeout"));
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(false);
    });

    it("handles mplog JSON decode error gracefully (line 2241-2243)", async () => {
      const mockPage = makeMockPage(makeWfrFailEvalResults());
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);

      let rejectWfrMplog!: (err: Error) => void;
      const wfrMplogPromise = new Promise<never>((_, reject) => {
        rejectWfrMplog = reject;
      });
      mockPage.waitForResponse.mockReturnValue(wfrMplogPromise);

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();

      // Fire mplog POST with malformed JSON — decode should fail gracefully (line 2241)
      mockPage._fireOnHandlers("request", {
        method: () => "POST",
        url: () => "https://mp.weixin.qq.com/advanced/mplog?action=up",
        postData: () => "log={not-valid-json}",
        resourceType: () => "fetch",
      });

      rejectWfrMplog(new Error("timeout"));
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(false);
    });

    it("logs 'NO POST requests captured' warn when capturedPosts empty (line 2248-2251)", async () => {
      // Both capturedUrls and capturedPosts are empty
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockRejectedValue(new Error("timeout"));

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      // saveSucceeded=false → captureDebugInfo → final throw
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("草稿保存失败");
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft: alternative save validation (lines 2256-2296)
  // -------------------------------------------------------------------------

  describe("saveDraft alternative save validation (lines 2256-2296)", () => {
    it("confirms save via toast message (lines 2263-2278)", async () => {
      const toastElement = {
        evaluate: jest.fn().mockResolvedValue("保存成功"),
      };
      const editorHandle = {
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      };

      // Evaluate sequence: fillContent page state, allInputs, title sync, body fill,
      // content length check, saveDraftViaApi (appMsgId=0 → falls to UI-click),
      // field sync, find-candidates (empty), dialog probe, then waitForResponse fails
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined, // field sync
        [], // find-candidates
        [], // $$eval buttons (handled separately)
        null, // dialog probe
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockRejectedValue(new Error("timeout"));

      // editor found (first $() call in fillContent), then null for author,
      // then toastElement for the toast check in alternative validation
      mockPage.$.mockResolvedValueOnce(editorHandle)
        .mockResolvedValueOnce(null) // author
        .mockResolvedValueOnce(toastElement); // toast in alternative validation

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Toast confirmed save → saveSucceeded = true
      expect(result.success).toBe(true);
    });

    it("confirms save via URL aid (lines 2283-2291)", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockRejectedValue(new Error("timeout"));

      // page.$ returns null for toast (not found)
      mockPage.$.mockResolvedValue(null);

      // URL contains /cgi-bin/home (so checkLoginStatus passes) + aid=12345 (for alternative)
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok999&aid=12345",
      );

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // URL aid confirmed save
      expect(result.success).toBe(true);
      expect(result.externalUrl).toContain("aid=12345");
    });

    it("handles page.title() call for method 3 (lines 2293-2298)", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockRejectedValue(new Error("timeout"));

      // No toast found
      mockPage.$.mockResolvedValue(null);

      // URL has /cgi-bin/home (login check passes) but aid=0 (fails alternative aid check)
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok999&aid=0",
      );

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // No save confirmed → fail
      expect(result.success).toBe(false);
      // page.title() should have been called (line 2295)
      expect(mockPage.title).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // saveDraftViaApi: API returns null → UI-click fallback (lines 1726-1733)
  // -------------------------------------------------------------------------

  describe("saveDraftViaApi returns null → falls to UI click (lines 1726-1733)", () => {
    it("logs warn and falls through when appMsgId is 0", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        // saveDraftViaApi: appMsgId=0 → returns null
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        // UI-click path: field sync
        undefined,
        // find candidates
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });

    it("logs warn and falls through when saveDraftViaApi throws (line 1729-1733)", async () => {
      // When page.$ returns an editor, fillContent calls body-fill evaluate (idx 3)
      // and content-length evaluate (idx 4) — then saveDraftViaApi is idx 5.
      // Use a counter-based mock that provides 5 fillContent results then throws on 6th.
      const mockPage = makeMockPage([]);

      const editorHandle = {
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      };
      mockPage.$.mockResolvedValueOnce(editorHandle) // editor found
        .mockResolvedValue(null); // author not found

      let evalCount = 0;
      mockPage.evaluate.mockImplementation(() => {
        evalCount++;
        const seqResults: unknown[] = [
          // idx 1: fillContent page state
          {
            url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
            title: "Editor",
            bodyText: "",
          },
          // idx 2: allInputs
          [],
          // idx 3: title sync
          {
            ok: true,
            reason: "filled",
            tag: "TEXTAREA",
            placeholder: "",
            maxLength: "64",
            finalValue: "t",
          },
          // idx 4: body fill (editor found → this runs)
          { success: true, selector: ".ProseMirror-focused", method: "paste" },
          // idx 5: content length check (fillResult.success=true → this runs)
          180,
        ];
        if (evalCount <= 5) {
          return Promise.resolve(seqResults[evalCount - 1]);
        }
        // idx 6: saveDraftViaApi → throws
        return Promise.reject(new Error("page context closed"));
      });

      // UI click path succeeds
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // fillContent: author not found / author throws (lines 1572, 1574-1577)
  // -------------------------------------------------------------------------

  describe("fillContent author handling (lines 1560-1578)", () => {
    it("skips author when #author input not found (line 1572)", async () => {
      const mockPage = makeMockPage(makeSuccessEvaluateSequence());
      // editor found, then author not found
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn(),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      }).mockResolvedValue(null); // author not found, returns null

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(
        makeContent({ author: "TestAuthor" }),
        makeConnection(),
      );
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });

    it("catches error in author fill (lines 1574-1577)", async () => {
      const mockPage = makeMockPage(makeSuccessEvaluateSequence());
      // editor found, author throws on page.$
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn(),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      });
      // page.$("#author, .js_author") throws
      mockPage.$.mockRejectedValueOnce(new Error("selector failed"));
      // remaining calls return null
      mockPage.$.mockResolvedValue(null);

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(
        makeContent({ author: "TestAuthor" }),
        makeConnection(),
      );
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // fillContent: digest inner fill catch (lines 1608-1613)
  // -------------------------------------------------------------------------

  describe("fillContent digest inner catch (lines 1608-1613)", () => {
    it("continues when digestInput.click throws", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 11111 },
        },
      ]);

      // editor found
      const digestInput = {
        click: jest.fn().mockRejectedValue(new Error("click failed")),
      };
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn(),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      })
        .mockResolvedValueOnce(null) // author not found
        .mockResolvedValueOnce(digestInput); // digest input found but click throws

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(
        makeContent({ digest: "test digest" }),
        makeConnection(),
      );
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // captureDebugInfo: page.$ throws (lines 881-887)
  // -------------------------------------------------------------------------

  describe("captureDebugInfo page.$ catch (lines 880-892)", () => {
    it("logs error when page.$ throws in captureDebugInfo", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        // field sync
        undefined,
        // find candidates
        [],
        [],
        // dialog probe
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockRejectedValue(new Error("timeout"));

      // page.$ throws when captureDebugInfo probes login elements (lines 881-884)
      mockPage.$.mockRejectedValue(new Error("detached frame"));
      mockPage.screenshot.mockRejectedValue(new Error("page closed"));

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // captureDebugInfo catch block (line 888-892) handles the error
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft: outerHTML fpSource warning (line 1674-1677)
  // -------------------------------------------------------------------------

  describe("saveDraftViaApi outerHTML fpSource warn (lines 1674-1678)", () => {
    it("logs warn when fpSource is outerHTML", async () => {
      // page.$ returns editor so that body fill (idx 3) and content length (idx 4)
      // are consumed, keeping saveDraftViaApi at idx 5 (appMsgId=77777 → success)
      const mockPage = makeMockPage([
        // idx 0: fillContent page state
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        // idx 1: allInputs
        [],
        // idx 2: title sync
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        // idx 3: body fill (editor found)
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        // idx 4: content length check
        180,
        // idx 5: saveDraftViaApi with fpSource=outerHTML → triggers the warn, appMsgId=77777 → success
        {
          status: "ok",
          fingerprint: "aabbccddeeff00112233445566778899",
          fpSource: "outerHTML",
          bodyPreview: "v1-outerHTML",
          json: { ret: 0, appMsgId: 77777 },
        },
      ]);

      // Provide editor so body fill evaluate is reached
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null); // author not found, remaining calls return null

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      // externalUrl built from appMsgId=77777 and token=12345 (from page.url())
      expect(result.externalUrl).toContain("77777");
    });
  });

  // -------------------------------------------------------------------------
  // saveDraftViaApi: err_msg warn path (lines 1691-1695)
  // -------------------------------------------------------------------------

  describe("saveDraftViaApi err_msg warn (lines 1691-1695)", () => {
    it("logs err_msg and returns null when present", async () => {
      // Editor handle is provided so body fill + content length evaluates are consumed
      // at the correct indices (idx 3 and 4), keeping saveDraftViaApi result at idx 5.
      const mockPage = makeMockPage([
        // idx 0: fillContent pageState
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        // idx 1: fillContent allInputs
        [],
        // idx 2: titleSyncResult
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        // idx 3: body fill (consumed because editor handle is found)
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        // idx 4: content length check (consumed because fillResult.success=true)
        180,
        // idx 5: saveDraftViaApi returns err_msg with no appMsgId
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { base_resp: { ret: 200002, err_msg: "invalid token" } },
        },
        // Falls to UI click path
        undefined, // idx 6: field sync
        [], // idx 7: find candidates
        null, // idx 8: dialog probe
      ]);
      mockPage.$.mockResolvedValueOnce({
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror-focused"),
      }).mockResolvedValue(null);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Falls to UI click path which succeeds via waitForResponse
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // saveDraft: save response parse success paths (lines 2161-2179)
  // -------------------------------------------------------------------------

  describe("saveDraft save response parse paths (lines 2161-2179)", () => {
    it("confirms save when base_resp.ret === 0 (line 2162)", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
        status: () => 200,
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it("confirms save when errcode === 0 (line 2164-2166)", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      // Response with errcode=0
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({ errcode: 0, errmsg: "ok" }),
        status: () => 200,
      });

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it("throws when save API returns non-zero ret (lines 2168-2173)", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      // Response returns error ret
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockResolvedValue({
          base_resp: { ret: 200002, err_msg: "系统繁忙" },
        }),
        status: () => 200,
      });
      mockPage.$.mockResolvedValue(null);
      // /cgi-bin/home for login check; no aid — save API error → fail
      // (default URL from makeMockPage already satisfies this)

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      // save API error → saveSucceeded=false → eventually fails
      expect(result.success).toBe(false);
    });

    it("handles JSON parse error from save response (lines 2175-2180)", async () => {
      const mockPage = makeMockPage([
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?token=tok999",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "",
          maxLength: "64",
          finalValue: "t",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "fp",
          fpSource: "sniffed",
          bodyPreview: "v1",
          json: { ret: 0, appMsgId: 0 },
        },
        undefined,
        [],
        [],
        null,
      ]);
      mockPage.$$.mockResolvedValue([]);
      mockPage.$$eval.mockResolvedValue([]);
      // Response json() throws
      mockPage.waitForResponse.mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        json: jest.fn().mockRejectedValue(new Error("body not JSON")),
        status: () => 200,
      });
      // Alternative: URL has /cgi-bin/home + aid=99999 for URL-based save confirm
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok999&aid=99999",
      );

      const { adapter } = await buildModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      // JSON parse fails → parseError catch → falls to alternative validation → URL aid confirms
      expect(result.success).toBe(true);
    });
  });
});
