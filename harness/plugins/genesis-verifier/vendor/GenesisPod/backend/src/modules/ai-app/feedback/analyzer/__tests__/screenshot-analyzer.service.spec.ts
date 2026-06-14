/**
 * ScreenshotAnalyzerService Unit Tests
 *
 * Tests screenshot analysis using Vision APIs:
 * - analyzeScreenshots() - top-level with multiple attachments
 * - analyzeSingleScreenshot() - individual image analysis
 * - callVisionApi() / provider dispatch (OpenAI, Gemini, Claude, unknown)
 * - parseVisionResponse() - JSON extraction from LLM text
 * - mergeAnalysisResults() - multi-screenshot deduplication
 * - quickErrorCheck() - keyword scanning for error indicators
 * - API key resolution via SecretsService
 */

// Mock global fetch before imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock ChatFacade and SecretsService modules
jest.mock("@/modules/ai-harness/facade/domain/chat.facade");
jest.mock("../../../../platform/credentials/storage/secrets/secrets.service");

import { Test, TestingModule } from "@nestjs/testing";
import { ScreenshotAnalyzerService } from "../screenshot-analyzer.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SecretsService } from "../../../../platform/credentials/storage/secrets/secrets.service";
import type { FeedbackAttachment } from "../../triage/triage-decision.types";

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeImageAttachment = (
  filename = "screenshot.png",
  url = "https://storage.example.com/screenshot.png",
): FeedbackAttachment => ({
  filename,
  url,
  mimeType: "image/png",
  size: 102400,
});

const makePdfAttachment = (): FeedbackAttachment => ({
  filename: "document.pdf",
  url: "https://storage.example.com/doc.pdf",
  mimeType: "application/pdf",
  size: 512000,
});

const buildVisionJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    detectedText: ["Error 500", "Internal Server Error"],
    detectedErrors: ["HTTP 500 Internal Server Error"],
    uiElements: ["Button", "Modal"],
    pageIdentified: "AI Research Page",
    issueDescription: "Server error displayed in modal",
    ...overrides,
  });

// ── Mock helpers ────────────────────────────────────────────────────────────

const mockOpenAIModel = {
  id: "model-openai",
  modelId: "gpt-4o",
  displayName: "GPT-4o",
  provider: "openai",
  apiKey: "sk-test-openai",
  secretKey: null,
  apiEndpoint: null,
  maxTokens: 4096,
};

const mockGeminiModel = {
  id: "model-gemini",
  modelId: "gemini-1.5-pro",
  displayName: "Gemini 1.5 Pro",
  provider: "google",
  apiKey: "gm-test-key",
  secretKey: null,
  apiEndpoint: null,
  maxTokens: 8192,
};

const mockClaudeModel = {
  id: "model-claude",
  modelId: "claude-3-5-sonnet-20241022",
  displayName: "Claude 3.5 Sonnet",
  provider: "anthropic",
  apiKey: "sk-ant-test",
  secretKey: null,
  apiEndpoint: null,
  maxTokens: 4096,
};

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("ScreenshotAnalyzerService", () => {
  let service: ScreenshotAnalyzerService;
  let mockFacade: jest.Mocked<ChatFacade>;
  let mockSecrets: jest.Mocked<SecretsService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreenshotAnalyzerService,
        {
          provide: ChatFacade,
          useValue: {
            getDefaultTextModel: jest.fn(),
            getFullModelConfig: jest.fn(),
          },
        },
        {
          provide: SecretsService,
          useValue: {
            getValue: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ScreenshotAnalyzerService>(ScreenshotAnalyzerService);
    mockFacade = module.get(ChatFacade);
    mockSecrets = module.get(SecretsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ── analyzeScreenshots - no image attachments ────────────────────────────

  describe("analyzeScreenshots - no images", () => {
    it("returns hasScreenshot false when no attachments provided", async () => {
      const result = await service.analyzeScreenshots([]);
      expect(result).toEqual({ hasScreenshot: false });
    });

    it("returns hasScreenshot false when only non-image attachments provided", async () => {
      const result = await service.analyzeScreenshots([makePdfAttachment()]);
      expect(result).toEqual({ hasScreenshot: false });
    });
  });

  // ── analyzeScreenshots - OpenAI provider ─────────────────────────────────

  describe("analyzeScreenshots - OpenAI vision", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockOpenAIModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockOpenAIModel);
    });

    it("analyzes a single screenshot via OpenAI and returns structured result", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: buildVisionJson() } }],
        }),
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
      expect(result.detectedErrors).toContain("HTTP 500 Internal Server Error");
      expect(result.pageIdentified).toBe("AI Research Page");
      expect(result.issueDescription).toBe("Server error displayed in modal");
    });

    it("uses correct OpenAI API endpoint and authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: buildVisionJson() } }],
        }),
      });

      await service.analyzeScreenshots([makeImageAttachment()]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("chat/completions"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockOpenAIModel.apiKey}`,
          }),
        }),
      );
    });

    it("resolves API key from SecretsService when secretKey is set", async () => {
      const modelWithSecret = {
        ...mockOpenAIModel,
        apiKey: null,
        secretKey: "openai-api-key-secret",
      };
      mockFacade.getDefaultTextModel.mockResolvedValue(modelWithSecret);
      mockFacade.getFullModelConfig.mockResolvedValue(modelWithSecret);
      mockSecrets.getValue.mockResolvedValue("sk-resolved-from-vault");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: buildVisionJson() } }],
        }),
      });

      await service.analyzeScreenshots([makeImageAttachment()]);

      expect(mockSecrets.getValue).toHaveBeenCalledWith(
        "openai-api-key-secret",
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-resolved-from-vault",
          }),
        }),
      );
    });

    it("throws when no API key available for OpenAI model", async () => {
      const noKeyModel = { ...mockOpenAIModel, apiKey: null, secretKey: null };
      mockFacade.getDefaultTextModel.mockResolvedValue(noKeyModel);
      mockFacade.getFullModelConfig.mockResolvedValue(noKeyModel);

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      // Error is caught internally and returns partial result
      expect(result.hasScreenshot).toBe(true);
      expect(result.issueDescription).toContain("screenshot.png");
    });

    it("returns fallback when OpenAI Vision API returns non-OK status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
    });
  });

  // ── analyzeScreenshots - Gemini provider ──────────────────────────────────

  describe("analyzeScreenshots - Gemini vision", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockGeminiModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockGeminiModel);
    });

    it("downloads image as base64 and calls Gemini Vision API", async () => {
      // First fetch: download image; second: Gemini generateContent
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => "image/png" },
          arrayBuffer: async () => Buffer.from("fake-image-data"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: { parts: [{ text: buildVisionJson() }] },
              },
            ],
          }),
        });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call should be to Gemini API
      const geminiCall = mockFetch.mock.calls[1];
      expect(geminiCall[0]).toContain("generativelanguage.googleapis.com");
    });

    it("returns error fallback when Gemini API returns non-OK", async () => {
      // Image download succeeds, Gemini fails
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => Buffer.from("img"),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => "Forbidden",
        });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
    });
  });

  // ── analyzeScreenshots - Claude provider ──────────────────────────────────

  describe("analyzeScreenshots - Claude vision", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockClaudeModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockClaudeModel);
    });

    it("downloads image and calls Claude Messages API with base64 image block", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => "image/png" },
          arrayBuffer: async () => Buffer.from("claude-img-data"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ text: buildVisionJson() }],
          }),
        });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
      const claudeCall = mockFetch.mock.calls[1];
      expect(claudeCall[0]).toContain("anthropic.com");
      expect(claudeCall[1].headers).toMatchObject({
        "x-api-key": mockClaudeModel.apiKey,
        "anthropic-version": "2023-06-01",
      });
    });
  });

  // ── analyzeScreenshots - unknown provider ─────────────────────────────────

  describe("analyzeScreenshots - unknown provider fallback", () => {
    it("falls back to OpenAI-compatible format for unrecognized provider", async () => {
      const unknownModel = {
        ...mockOpenAIModel,
        provider: "custom-llm",
        apiKey: "custom-key",
      };
      mockFacade.getDefaultTextModel.mockResolvedValue(unknownModel);
      mockFacade.getFullModelConfig.mockResolvedValue(unknownModel);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: buildVisionJson() } }],
        }),
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
    });
  });

  // ── analyzeScreenshots - no default model ────────────────────────────────

  describe("analyzeScreenshots - no model available", () => {
    it("returns per-screenshot error fallback when no default model is available", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      // When getDefaultTextModel returns null, the error is caught at the
      // single-screenshot level, so hasScreenshot is true with a per-file hint
      expect(result.hasScreenshot).toBe(true);
      // The issueDescription mentions the specific screenshot filename
      expect(result.issueDescription).toContain("screenshot.png");
    });
  });

  // ── mergeAnalysisResults - multiple screenshots ──────────────────────────

  describe("analyzeScreenshots - multiple images", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockOpenAIModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockOpenAIModel);
    });

    it("merges results from multiple screenshots and deduplicates items", async () => {
      const response1 = buildVisionJson({
        detectedText: ["Error 500"],
        detectedErrors: ["Server Error"],
        uiElements: ["Modal"],
        pageIdentified: "Research Page",
        issueDescription: "First screenshot error",
      });
      const response2 = buildVisionJson({
        detectedText: ["Error 500", "Please try again"],
        detectedErrors: ["Server Error"],
        uiElements: ["Button", "Modal"],
        pageIdentified: "Research Page",
        issueDescription: "Second screenshot error",
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: response1 } }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: response2 } }],
          }),
        });

      const result = await service.analyzeScreenshots([
        makeImageAttachment("screenshot1.png"),
        makeImageAttachment("screenshot2.png"),
      ]);

      expect(result.hasScreenshot).toBe(true);
      // Deduplication: "Error 500" should appear only once
      const errorCount = (result.detectedText ?? []).filter(
        (t) => t === "Error 500",
      ).length;
      expect(errorCount).toBe(1);
      // Descriptions from both images are joined
      expect(result.issueDescription).toContain("First screenshot error");
      expect(result.issueDescription).toContain("Second screenshot error");
    });

    it("merges multiple page identifications with comma separator", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: buildVisionJson({ pageIdentified: "Research Page" }),
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: buildVisionJson({ pageIdentified: "Settings Page" }),
                },
              },
            ],
          }),
        });

      const result = await service.analyzeScreenshots([
        makeImageAttachment("img1.png"),
        makeImageAttachment("img2.png"),
      ]);

      expect(result.pageIdentified).toContain("Research Page");
      expect(result.pageIdentified).toContain("Settings Page");
    });
  });

  // ── parseVisionResponse - JSON extraction ────────────────────────────────

  describe("vision response parsing", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockOpenAIModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockOpenAIModel);
    });

    it("parses JSON embedded within surrounding text", async () => {
      const responseWithText = `Here is my analysis:
${buildVisionJson()}
End of analysis.`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: responseWithText } }],
        }),
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
      expect(result.detectedErrors).toContain("HTTP 500 Internal Server Error");
    });

    it("falls back to raw response text when no JSON is found", async () => {
      const plainText = "I can see a login page with a red error banner.";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: plainText } }],
        }),
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
      expect(result.issueDescription).toContain("login page");
    });

    it("returns empty arrays for missing fields in JSON response", async () => {
      const minimalJson = JSON.stringify({
        issueDescription: "Minimal result",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: minimalJson } }],
        }),
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.detectedText).toEqual([]);
      expect(result.detectedErrors).toEqual([]);
      expect(result.uiElements).toEqual([]);
    });
  });

  // ── quickErrorCheck ──────────────────────────────────────────────────────

  describe("quickErrorCheck", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockOpenAIModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockOpenAIModel);
    });

    it("returns hasError true with errorHint when detectedErrors are present", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: buildVisionJson({
                  detectedErrors: ["NullPointerException at line 42"],
                }),
              },
            },
          ],
        }),
      });

      const result = await service.quickErrorCheck([makeImageAttachment()]);

      expect(result.hasError).toBe(true);
      expect(result.errorHint).toBe("NullPointerException at line 42");
    });

    it("detects error from detectedText containing error keyword", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: buildVisionJson({
                  detectedErrors: [],
                  detectedText: ["The request failed to complete"],
                }),
              },
            },
          ],
        }),
      });

      const result = await service.quickErrorCheck([makeImageAttachment()]);

      expect(result.hasError).toBe(true);
      expect(result.errorHint).toContain("failed");
    });

    it("detects 404 status code as error keyword", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: buildVisionJson({
                  detectedErrors: [],
                  detectedText: ["Page Not Found 404"],
                }),
              },
            },
          ],
        }),
      });

      const result = await service.quickErrorCheck([makeImageAttachment()]);

      expect(result.hasError).toBe(true);
    });

    it("detects 500 status code as error keyword", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: buildVisionJson({
                  detectedErrors: [],
                  detectedText: ["HTTP 500 Server Error"],
                }),
              },
            },
          ],
        }),
      });

      const result = await service.quickErrorCheck([makeImageAttachment()]);

      expect(result.hasError).toBe(true);
    });

    it("returns hasError false when no errors detected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: buildVisionJson({
                  detectedErrors: [],
                  detectedText: ["Welcome to the dashboard", "User Profile"],
                }),
              },
            },
          ],
        }),
      });

      const result = await service.quickErrorCheck([makeImageAttachment()]);

      expect(result.hasError).toBe(false);
      expect(result.errorHint).toBeUndefined();
    });

    it("returns hasError false when no image attachments", async () => {
      const result = await service.quickErrorCheck([]);

      expect(result.hasError).toBe(false);
    });

    it("detects Chinese error keyword '错误'", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: buildVisionJson({
                  detectedErrors: [],
                  detectedText: ["系统发生错误，请稍后重试"],
                }),
              },
            },
          ],
        }),
      });

      const result = await service.quickErrorCheck([makeImageAttachment()]);

      expect(result.hasError).toBe(true);
    });
  });

  // ── fetchImageAsBase64 error handling ────────────────────────────────────

  describe("image fetch failures", () => {
    beforeEach(() => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockGeminiModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockGeminiModel);
    });

    it("returns per-screenshot error fallback when image download fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Image fetch failed"));

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
      expect(result.issueDescription).toContain("screenshot.png");
    });

    it("throws when image fetch returns non-OK status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await service.analyzeScreenshots([makeImageAttachment()]);

      expect(result.hasScreenshot).toBe(true);
    });
  });

  // ── custom apiEndpoint ───────────────────────────────────────────────────

  describe("custom API endpoint", () => {
    it("uses custom apiEndpoint when configured for OpenAI-compatible provider", async () => {
      const customModel = {
        ...mockOpenAIModel,
        apiEndpoint: "https://my-llm-proxy.example.com/v1",
      };
      mockFacade.getDefaultTextModel.mockResolvedValue(customModel);
      mockFacade.getFullModelConfig.mockResolvedValue(customModel);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: buildVisionJson() } }],
        }),
      });

      await service.analyzeScreenshots([makeImageAttachment()]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("my-llm-proxy.example.com"),
        expect.any(Object),
      );
    });
  });
});
