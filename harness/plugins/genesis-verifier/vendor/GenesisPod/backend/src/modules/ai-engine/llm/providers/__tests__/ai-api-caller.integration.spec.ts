/**
 * AiApiCallerService - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Lines 19-21: resolveOpenAIContent image_url contentPart
 *  - Lines 42-44: resolveAnthropicContent image contentPart
 *  - Lines 63-78: resolveGeminiParts with hasImages (text+image, image only)
 *  - Lines 135-142: logOversizedRequest body (tokens > 100K threshold)
 *  - Lines 202-210: array content in estimatedChars reducer
 *  - Lines 254-266: deepseek-reasoner JSON constraint injection (with/without system msg)
 *  - Lines 598-606: array content in xAI estimatedChars reducer
 *  - Line 632: xAI outputSchema → json_schema response_format
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiApiCallerService } from "../ai-api-caller.service";
import { OpenaiCaller } from "../openai-caller";
import { AnthropicCaller } from "../anthropic-caller";
import { CohereCaller } from "../cohere-caller";
import { GoogleCaller } from "../google-caller";
import { XaiCaller } from "../xai-caller";
import { ModelCapabilityService } from "../../models/capability/model-capability.service";
import type { ChatMessage } from "../../types/task-profile.types";

function makeHttpResponse(data: unknown) {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as Record<string, unknown>,
  };
}

function makeSuccessApiResponse(content = "ok") {
  return {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { total_tokens: 10 },
  };
}

describe("AiApiCallerService (extended coverage)", () => {
  let service: AiApiCallerService;
  let mockHttpService: { post: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiApiCallerService,
        OpenaiCaller,
        AnthropicCaller,
        CohereCaller,
        GoogleCaller,
        XaiCaller,
        { provide: HttpService, useValue: mockHttpService },
        // v3.1 §A: 让 rejectsResponseFormat 走 catalog 真实判定（替代 isDeepseekReasoner）
        ModelCapabilityService,
      ],
    }).compile();

    service = module.get<AiApiCallerService>(AiApiCallerService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Lines 19-21: resolveOpenAIContent image_url contentPart
  // =========================================================================

  describe("resolveOpenAIContent with image_url contentParts (lines 19-21)", () => {
    it("builds image_url content part for OpenAI-compatible API", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(
          makeHttpResponse(makeSuccessApiResponse("vision response")),
        ) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "What is this?",
          contentParts: [
            { type: "text", text: "What is this?" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/img.png", detail: "high" },
            },
          ],
        },
      ];

      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        1000,
      );

      expect(result.content).toBe("vision response");

      // Verify the request body included image_url content parts
      const requestBody = mockHttpService.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const msgs = requestBody.messages as Array<{
        role: string;
        content: unknown;
      }>;
      const userContent = msgs[0].content as Array<Record<string, unknown>>;
      expect(Array.isArray(userContent)).toBe(true);
      const imagePart = userContent.find((p) => p.type === "image_url");
      expect(imagePart).toBeDefined();
    });

    it("builds image_url content part without detail (uses 'auto')", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(makeSuccessApiResponse("ok"))) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "Describe",
          contentParts: [
            {
              type: "image_url",
              image_url: { url: "https://example.com/img.png" },
              // detail not specified → should default to "auto"
            } as ChatMessage["contentParts"] extends Array<infer T> ? T : never,
          ],
        },
      ];

      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "key",
        "gpt-4o",
        messages,
        500,
      );

      expect(result.content).toBe("ok");
    });
  });

  // =========================================================================
  // Lines 202-210: array content in estimatedChars reducer
  // =========================================================================

  describe("estimatedChars reducer with array content (lines 202-210)", () => {
    it("handles array contentParts in estimatedChars calculation", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(makeSuccessApiResponse("ok"))) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "Multi-modal",
          contentParts: [
            { type: "text", text: "Hello world" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/big-image.png" },
            },
          ],
        },
      ];

      // Should not throw even with array content in estimatedChars
      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "key",
        "gpt-4o",
        messages,
        500,
      );

      expect(result.content).toBe("ok");
    });
  });

  // =========================================================================
  // Lines 135-142: logOversizedRequest body (tokens > 100K threshold)
  // =========================================================================

  describe("logOversizedRequest triggered (lines 135-142)", () => {
    it("logs error when request is oversized (>100K estimated tokens)", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(makeSuccessApiResponse("big response"))) as never,
      );

      // Create a very large message (>400K chars = >100K tokens)
      const bigContent = "x".repeat(500_000);
      const messages: ChatMessage[] = [{ role: "user", content: bigContent }];

      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "key",
        "gpt-4o",
        messages,
        1000,
      );

      expect(result.content).toBe("big response");
    });
  });

  // =========================================================================
  // Lines 254-266: deepseek-reasoner JSON constraint injection
  // =========================================================================

  describe("deepseek-reasoner JSON constraint injection (lines 254-266)", () => {
    it("injects JSON constraint into existing system message for deepseek-reasoner", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(makeSuccessApiResponse("{}"))) as never,
      );

      const messages: ChatMessage[] = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Return JSON" },
      ];

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "key",
        "deepseek-reasoner",
        messages,
        1000,
        undefined,
        120000,
        "max_tokens",
        "json", // responseFormat = "json"
        undefined, // reasoningDepth
        undefined, // outputSchema
        undefined, // schemaStrict
        false, // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        "deepseek", // v3.1 §A: provider → catalog rule matches deepseek-reasoner
      );

      const requestBody = mockHttpService.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const msgs = requestBody.messages as Array<{
        role: string;
        content: string;
      }>;
      const systemMsg = msgs.find((m) => m.role === "system");
      expect(systemMsg?.content).toContain("CRITICAL OUTPUT FORMAT");
    });

    it("injects JSON constraint as new system message when none exists for deepseek-reasoner", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(makeSuccessApiResponse("{}"))) as never,
      );

      const messages: ChatMessage[] = [
        { role: "user", content: "Return JSON please" },
        // No system message
      ];

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "key",
        "deepseek-reasoner",
        messages,
        1000,
        undefined,
        120000,
        "max_tokens",
        "json",
        undefined, // reasoningDepth
        undefined, // outputSchema
        undefined, // schemaStrict
        false, // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        "deepseek", // v3.1 §A: provider → catalog rule matches deepseek-reasoner
      );

      const requestBody = mockHttpService.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const msgs = requestBody.messages as Array<{
        role: string;
        content: string;
      }>;
      // System message should have been prepended
      expect(msgs[0].role).toBe("system");
      expect(msgs[0].content).toContain("CRITICAL OUTPUT FORMAT");
    });
  });

  // =========================================================================
  // Lines 42-44: resolveAnthropicContent image contentPart
  // =========================================================================

  describe("resolveAnthropicContent with image contentParts (lines 42-44)", () => {
    it("builds image source content for Anthropic API", async () => {
      const anthropicResponse = {
        content: [{ type: "text", text: "Anthropic says yes" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(anthropicResponse)) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "Look at this",
          contentParts: [
            { type: "text", text: "Look at this" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/photo.jpg" },
            },
          ],
        },
      ];

      const result = await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet",
        messages,
        1000,
      );

      expect(result.content).toBe("Anthropic says yes");
    });
  });

  // =========================================================================
  // Lines 63-78: resolveGeminiParts with hasImages
  // =========================================================================

  describe("resolveGeminiParts with images (lines 63-78)", () => {
    it("falls back to text parts when contentParts has images (Gemini limitation)", async () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini response" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(geminiResponse)) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "Describe this",
          contentParts: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/pic.jpg" },
            },
          ],
        },
      ];

      const result = await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        "gemini-key",
        "gemini-pro",
        messages,
        1000,
      );

      expect(result.content).toBe("Gemini response");
    });

    it("falls back to msg.content when contentParts has only images (no text parts)", async () => {
      const geminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Image only fallback" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(geminiResponse)) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "Fallback content",
          contentParts: [
            // Only image, no text parts
            {
              type: "image_url",
              image_url: { url: "https://example.com/pic.jpg" },
            },
          ],
        },
      ];

      const result = await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        "gemini-key",
        "gemini-pro",
        messages,
        1000,
      );

      expect(result.content).toBe("Image only fallback");
    });
  });

  // =========================================================================
  // Lines 598-606, 632: xAI API with array content + outputSchema
  // =========================================================================

  describe("callXAIAPI with contentParts and outputSchema (lines 598-606, 632)", () => {
    it("handles array content in xAI estimatedChars calculation", async () => {
      const xaiResponse = {
        choices: [
          { message: { content: "xAI result" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 15 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(xaiResponse)) as never,
      );

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: "What is this?",
          contentParts: [
            { type: "text", text: "What is this?" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/xai-img.png" },
            },
          ],
        },
      ];

      const result = await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "xai-key",
        "grok-2-vision",
        messages,
        1000,
      );

      expect(result.content).toBe("xAI result");
    });

    it("sets json_schema response_format when outputSchema provided to xAI (line 632)", async () => {
      const xaiResponse = {
        choices: [
          { message: { content: '{"result": "ok"}' }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(xaiResponse)) as never,
      );

      const messages: ChatMessage[] = [
        { role: "user", content: "Return structured data" },
      ];

      await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "xai-key",
        "grok-2",
        messages,
        1000,
        undefined,
        120000,
        "max_tokens",
        undefined,
        undefined,
        { type: "json_schema", schema: { type: "object", properties: {} } },
      );

      const requestBody = mockHttpService.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(requestBody["response_format"]).toMatchObject({
        type: "json_schema",
      });
    });
  });
});
