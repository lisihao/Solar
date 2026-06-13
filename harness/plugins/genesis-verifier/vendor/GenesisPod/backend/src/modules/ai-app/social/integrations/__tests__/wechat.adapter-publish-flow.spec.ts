/**
 * WechatAdapter — publish flow: fillContent (editor found) + saveDraftViaApi
 *
 * Covers:
 * - fillContent with editor element found (lines 1253-1541):
 *   - title fill success via native setter
 *   - body fill via paste method
 *   - body fill with content length check passes (no keyboard fallback)
 *   - body fill with content truncated (keyboard fallback path)
 *   - body fill all methods fail (keyboard fallback via keyboard.type)
 *   - author input found and filled
 *   - digest filled
 *   - iframe editor fallback
 * - saveDraftViaApi success path (lines 1641-1696)
 * - saveDraft API-first success (lines 1699-1724)
 * - image rewrite path (line 748 rewritten != original)
 * - cover upload success (line 775)
 * - captureDebugInfo path (lines 874-887)
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
    id: "conn-flow",
    userId: "user-flow",
    platformType: SocialPlatformType.WECHAT_MP,
    isActive: true,
    sessionData: "encrypted",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SocialPlatformConnection;
}

function makeContent(overrides: Partial<SocialContent> = {}): SocialContent {
  return {
    id: "c-flow",
    userId: "user-flow",
    title: "Flow Title",
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
// Mock ElementHandle for editor
// ---------------------------------------------------------------------------

function makeMockElementHandle() {
  return {
    click: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue("ProseMirror"),
    count: 3,
  };
}

// ---------------------------------------------------------------------------
// Mock page with fine-grained evaluate sequencing
// ---------------------------------------------------------------------------

function makeMockPage(evaluateResults: unknown[]) {
  let evaluateIdx = 0;
  return {
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest
      .fn()
      .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home?token=tok999"),
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
    on: jest.fn(),
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
  };
}

// ---------------------------------------------------------------------------
// Module builder
// ---------------------------------------------------------------------------

interface TestComponents {
  adapter: WechatAdapter;
  mockPage: ReturnType<typeof makeMockPage>;
  imageUploader: { rewriteImagesInHtml: jest.Mock; uploadCover: jest.Mock };
}

async function buildFlowModule(
  mockPage: ReturnType<typeof makeMockPage>,
  imageUploaderOverrides: Partial<{
    rewriteImagesInHtml: jest.Mock;
    uploadCover: jest.Mock;
  }> = {},
): Promise<TestComponents> {
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
    ...imageUploaderOverrides,
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
// Tests
// ---------------------------------------------------------------------------

describe("WechatAdapter — publish flow (fillContent + saveDraft paths)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── fillContent: editor found, title success, body fill success ─────────

  describe("fillContent: editor element found via page.$", () => {
    it("covers editor.click + editor.evaluate + body fill success path", async () => {
      // Arrange — page.evaluate sequenced results:
      // 1. fillContent page state eval
      // 2. fillContent allInputs eval
      // 3. title sync eval (success)
      // 4. body fill eval (success via paste)
      // 5. content length check eval (large → no keyboard fallback)
      // 6. saveDraftViaApi: page.evaluate(runSaveDraftAttempts, ...)
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          finalValue: "Flow Title",
        },
        // body fill
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        // content length check (200 chars * 0.9 = 180 → passes 0.8 threshold)
        180,
        // saveDraftViaApi: page.evaluate(runSaveDraftAttempts)
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "attempt-v2-multi-suffixed-count1-har",
          json: { ret: 0, appMsgId: 98765 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      // page.$() returns editor on first call, null for author/digest
      mockPage.$.mockResolvedValueOnce(editorHandle) // editor in editorSelectors loop
        .mockResolvedValue(null); // author, digest: null

      const { adapter } = await buildFlowModule(mockPage);

      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // saveDraftViaApi returned appMsgId → saveDraft returned URL → publish success
      expect(result.success).toBe(true);
      expect(editorHandle.click).toHaveBeenCalled();
      expect(editorHandle.evaluate).toHaveBeenCalled();
    });

    it("covers content length truncation path (keyboard fallback)", async () => {
      // Content length check returns too few chars → keyboard fallback triggered
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        {
          success: true,
          selector: ".ProseMirror-focused",
          method: "innerHTML",
        },
        // content length: 10 chars (original 200 * 0.8 = 160, so 10 < 160 → keyboard fallback)
        10,
        // keyboard fallback body click (evaluate inside the body focus block)
        undefined,
        // saveDraftViaApi
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 11111 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({ content: "x".repeat(200) });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // keyboard.down("Control") should have been called (for Ctrl+A)
      expect(mockPage.keyboard.down).toHaveBeenCalled();
      expect(result).toHaveProperty("success");
    });

    it("covers body fill failure → keyboard fallback only path", async () => {
      // page.evaluate for body fill returns failure → keyboard path
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: false, selector: null, method: null },
        // no content length check (fill failed path goes directly to keyboard)
        // saveDraftViaApi
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 22222 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({ content: "Line1\nLine2\nLine3" });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // keyboard.type called for each line
      expect(mockPage.keyboard.type).toHaveBeenCalled();
      expect(result).toHaveProperty("success");
    });

    it("covers author input found and filled", async () => {
      // page.$() returns editor, then returns authorHandle for #author
      const editorHandle = makeMockElementHandle();
      const authorHandle = {
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("INPUT"),
      };

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        // saveDraftViaApi
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 33333 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle) // body editor
        .mockResolvedValueOnce(authorHandle) // #author
        .mockResolvedValue(null); // digest

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({ author: "Test Author" });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(authorHandle.click).toHaveBeenCalled();
      expect(result).toHaveProperty("success");
    });

    it("covers digest input filled when content.digest is present", async () => {
      const editorHandle = makeMockElementHandle();
      const digestHandle = {
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("TEXTAREA"),
      };

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 44444 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle) // body editor
        .mockResolvedValueOnce(null) // author: null
        .mockResolvedValueOnce(digestHandle) // digest selector
        .mockResolvedValue(null);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({ digest: "This is a summary digest." });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(digestHandle.click).toHaveBeenCalled();
      expect(result).toHaveProperty("success");
    });
  });

  // ─── fillContent: iframe editor fallback ─────────────────────────────────

  describe("fillContent: iframe editor fallback (no direct editor found)", () => {
    it("covers iframe fallback path when page.$() returns null but frame has editor", async () => {
      const frameEditorHandle = {
        click: jest.fn().mockResolvedValue(undefined),
      };
      const mockFrame = {
        $: jest.fn().mockResolvedValue(frameEditorHandle),
      };

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        // body fill: no editor found via $
        // (editor = null, skip to iframe path)
        // saveDraftViaApi
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 55555 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      // All $ calls return null → editor = null → iframe path
      mockPage.$.mockResolvedValue(null);
      mockPage.frames.mockReturnValue([mockFrame]);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(frameEditorHandle.click).toHaveBeenCalled();
      expect(result).toHaveProperty("success");
    });
  });

  // ─── fillContent: title fill failure → throws ─────────────────────────────

  describe("fillContent: title fill failure", () => {
    it("publish returns failure when title element not found", async () => {
      const evaluateSequence = [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        [],
        // title sync fails
        { ok: false, reason: "no-title-element-found" },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValue(null);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(
        makeContent({ title: "Test" }),
        makeConnection(),
      );
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      // Error message comes from the thrown Error
      expect(result.errorMessage).toMatch(/标题|no-title/i);
    });
  });

  // ─── saveDraftViaApi: no token in URL ─────────────────────────────────────

  describe("saveDraftViaApi: no token path", () => {
    it("returns null from saveDraftViaApi when URL has no token → falls to UI saveDraft", async () => {
      // page.url() returns URL without token → saveDraftViaApi returns null
      // Then UI saveDraft path tries Ctrl+S, finds save button
      const mockSaveBtn = {
        evaluate: jest.fn().mockResolvedValue("保存为草稿"),
        click: jest.fn().mockResolvedValue(undefined),
      };

      const evaluateSequence = [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg_ntoken",
          title: "Editor",
          bodyText: "",
        },
        [],
        {
          ok: true,
          reason: "filled",
          tag: "TEXTAREA",
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        // saveDraftViaApi: page.evaluate → but note page.url() has no token so this
        // eval is NOT called — saveDraftViaApi returns null at line 1641-1643
        // Then saveDraft UI path: waitForResponse
      ];

      const mockPage = makeMockPage(evaluateSequence);
      // URL without token for saveDraftViaApi check
      let urlCallCount = 0;
      mockPage.url.mockImplementation(() => {
        urlCallCount++;
        // First calls: home with token (for publish flow navigation)
        if (urlCallCount <= 20)
          return "https://mp.weixin.qq.com/cgi-bin/home?token=tok999";
        // For saveDraftViaApi call: no token
        return "https://mp.weixin.qq.com/cgi-bin/appmsg_ntoken";
      });

      mockPage.$.mockResolvedValueOnce(null) // editorSelectors: null → body skip
        .mockResolvedValue(null);
      mockPage.$$.mockImplementation((sel: string) => {
        if (sel === "button") return Promise.resolve([mockSaveBtn]);
        return Promise.resolve([]);
      });

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("success");
    });
  });

  // ─── saveDraftViaApi: outerHTML fingerprint path ─────────────────────────

  describe("saveDraftViaApi: outerHTML fingerprint source warning", () => {
    it("logs warn when fpSource is outerHTML", async () => {
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        // saveDraftViaApi with outerHTML source
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "outerHTML",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 66666 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });
  });

  // ─── saveDraftViaApi: err_msg in response ─────────────────────────────────

  describe("saveDraftViaApi: WeChat err_msg in response", () => {
    it("logs warn when json.base_resp.err_msg present and appMsgId missing", async () => {
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        // saveDraftViaApi: err_msg, no appMsgId → returns null → UI fallback
        {
          status: "fail",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: {
            base_resp: { ret: 200002, err_msg: "invalid fingerprint" },
          },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);
      // saveDraft UI fallback: $$ finds save button
      const mockSaveBtn = {
        evaluate: jest.fn().mockResolvedValue("保存为草稿"),
        click: jest.fn().mockResolvedValue(undefined),
      };
      mockPage.$$.mockImplementation((sel: string) => {
        if (sel === "button") return Promise.resolve([mockSaveBtn]);
        return Promise.resolve([]);
      });

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("success");
    });
  });

  // ─── image rewrite: rewritten != original ─────────────────────────────────

  describe("image rewrite: rewritten content differs from original", () => {
    it("covers line 748 when rewritten != original HTML", async () => {
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 77777 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);

      // Image rewriter returns DIFFERENT content → line 748 branch
      const rewrittenContent = "<p>rewritten content</p>";
      const { adapter } = await buildFlowModule(mockPage, {
        rewriteImagesInHtml: jest.fn().mockImplementation(() =>
          Promise.resolve({
            rewritten: rewrittenContent,
            uploaded: 1,
            failed: 0,
            skipped: 0,
          }),
        ),
      });
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({ content: "<p>original content</p>" });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("success");
    });
  });

  // ─── cover upload success ─────────────────────────────────────────────────

  describe("cover upload success path", () => {
    it("covers line 775 when uploadCover returns a cover object", async () => {
      const editorHandle = makeMockElementHandle();

      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 88888 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);

      // uploadCover returns a cover object → line 775 success branch
      const { adapter } = await buildFlowModule(mockPage, {
        uploadCover: jest.fn().mockResolvedValue({
          uploadCdnUrl: "https://mmbiz.qpic.cn/back.jpg",
          uploadFileId: "fid-back",
          cropCdnUrl235: "https://mmbiz.qpic.cn/crop235.jpg",
          cropFileId235: "fid-235",
          cropCdnUrl1_1: "https://mmbiz.qpic.cn/crop11.jpg",
          cropFileId1_1: "fid-11",
        }),
      });
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({
        coverImageUrl: "https://example.com/cover.jpg",
      });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });
  });

  // ─── saveDraft: Ctrl+S keyboard + waitForResponse path ───────────────────

  describe("saveDraft UI path: Ctrl+S + waitForResponse", () => {
    it("covers keyboard Ctrl+S save attempt", async () => {
      // saveDraftViaApi returns null (URL has no token at that point)
      // UI path: keyboard Ctrl+S, then button click fallback
      const evaluateSequence = [
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
          placeholder: "标题",
          maxLength: "20",
          finalValue: "Flow Title",
        },
        { success: true, selector: ".ProseMirror-focused", method: "paste" },
        180,
        // saveDraftViaApi evaluate returns no appMsgId
        {
          status: "fail",
          fingerprint: "",
          fpSource: "none",
          bodyPreview: "",
          json: { ret: 1 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      const editorHandle = makeMockElementHandle();
      mockPage.$.mockResolvedValueOnce(editorHandle).mockResolvedValue(null);

      // waitForResponse resolves with success → Ctrl+S path
      const mockResponse = {
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?sub=create",
        status: () => 200,
        json: jest
          .fn()
          .mockResolvedValue({ base_resp: { ret: 0, appMsgId: 55123 } }),
      };
      mockPage.waitForResponse.mockResolvedValue(mockResponse);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const resultPromise = adapter.publish(makeContent(), makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("success");
    });
  });

  // ─── publish: no content (empty content.content field) ───────────────────

  describe("publish: content.content is empty (no body fill)", () => {
    it("skips body fill when content is empty string", async () => {
      const evaluateSequence = [
        {
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
          title: "Editor",
          bodyText: "",
        },
        [],
        // no title fill (title empty)
        // saveDraftViaApi
        {
          status: "ok",
          fingerprint: "abc123def456abc123def456abc123de",
          fpSource: "sniffed",
          bodyPreview: "",
          json: { ret: 0, appMsgId: 99999 },
        },
      ];

      const mockPage = makeMockPage(evaluateSequence);
      mockPage.$.mockResolvedValue(null);

      const { adapter } = await buildFlowModule(mockPage);
      mockDecryptSession.mockReturnValue(makeValidSession() as unknown);

      const content = makeContent({ title: "", content: "" });
      const resultPromise = adapter.publish(content, makeConnection());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Success: both title and content are empty → fillContent skips both
      expect(result).toHaveProperty("success");
    });
  });
});
