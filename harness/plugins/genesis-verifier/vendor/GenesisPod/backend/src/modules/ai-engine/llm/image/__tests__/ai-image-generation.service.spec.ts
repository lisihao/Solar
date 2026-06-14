/**
 * Unit tests for AiImageGenerationService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosResponse } from "axios";
import { AiImageGenerationService } from "../../image/ai-image-generation.service";

// We mock sleep at the module level by mocking setTimeout to resolve immediately.
// This avoids the complexity of interleaving fake timer ticks with async operations.
jest.spyOn(global, "setTimeout").mockImplementation((fn: () => void) => {
  fn();
  return 0 as unknown as ReturnType<typeof setTimeout>;
});

function buildAxiosResponse<T>(data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: "OK",
    headers: {},
    config: {} as never,
  };
}

function buildAxiosError(
  status: number,
  message: string,
  code?: string,
): Error {
  const err = new Error(message) as Error & {
    isAxiosError: boolean;
    response?: { status: number; data: { error: { message: string } } };
    code?: string;
  };
  err.isAxiosError = true;
  err.response = { status, data: { error: { message } } };
  if (code) err.code = code;
  return err;
}

describe("AiImageGenerationService", () => {
  let service: AiImageGenerationService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageGenerationService,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<AiImageGenerationService>(AiImageGenerationService);
    httpService = module.get(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =====================================================================
  // isImageGenerationRequest
  // =====================================================================

  describe("isImageGenerationRequest", () => {
    it("returns true for Chinese image keywords", () => {
      expect(service.isImageGenerationRequest("帮我画一只猫")).toBe(true);
      expect(service.isImageGenerationRequest("生成一张风景图")).toBe(true);
      expect(service.isImageGenerationRequest("画图工具")).toBe(true);
      expect(service.isImageGenerationRequest("制作图表")).toBe(true);
      expect(service.isImageGenerationRequest("生成图")).toBe(true);
      expect(service.isImageGenerationRequest("画一个角色")).toBe(true);
      expect(service.isImageGenerationRequest("创建图示")).toBe(true);
      expect(service.isImageGenerationRequest("绘制流程图")).toBe(true);
    });

    it("returns true for English image keywords", () => {
      expect(service.isImageGenerationRequest("generate image of a cat")).toBe(
        true,
      );
      expect(service.isImageGenerationRequest("create image for me")).toBe(
        true,
      );
      expect(service.isImageGenerationRequest("draw a dragon")).toBe(true);
      expect(service.isImageGenerationRequest("make image of sunset")).toBe(
        true,
      );
      expect(service.isImageGenerationRequest("an illustration of")).toBe(true);
      expect(service.isImageGenerationRequest("show infographic")).toBe(true);
      expect(service.isImageGenerationRequest("diagram of the system")).toBe(
        true,
      );
      expect(service.isImageGenerationRequest("picture of a dog")).toBe(true);
      expect(service.isImageGenerationRequest("image of mountains")).toBe(true);
      expect(service.isImageGenerationRequest("visualize the data")).toBe(true);
    });

    it("returns true for uppercase / mixed-case keywords", () => {
      expect(service.isImageGenerationRequest("DRAW a cat")).toBe(true);
      expect(service.isImageGenerationRequest("Generate Image")).toBe(true);
    });

    it("returns false for non-image requests", () => {
      expect(
        service.isImageGenerationRequest("What is the capital of France?"),
      ).toBe(false);
      expect(service.isImageGenerationRequest("Write a poem about love")).toBe(
        false,
      );
      expect(service.isImageGenerationRequest("Summarize this document")).toBe(
        false,
      );
      expect(service.isImageGenerationRequest("")).toBe(false);
    });
  });

  // =====================================================================
  // callDallE3
  // =====================================================================

  describe("callDallE3", () => {
    it("returns markdown image from b64_json response", async () => {
      const b64 = "abc123base64data";
      const revisedPrompt = "A beautiful sunset";
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            data: [{ b64_json: b64, revised_prompt: revisedPrompt }],
          }),
        ),
      );

      const result = await service.callDallE3("test-key", "sunset");

      expect(result.model).toBe("dall-e-3");
      expect(result.tokensUsed).toBe(0);
      expect(result.content).toContain(`data:image/png;base64,${b64}`);
      expect(result.content).toContain(revisedPrompt);
    });

    it("returns markdown image without revised_prompt when absent", async () => {
      httpService.post.mockReturnValue(
        of(buildAxiosResponse({ data: [{ b64_json: "img123" }] })),
      );

      const result = await service.callDallE3("test-key", "cat");

      expect(result.content).toContain("data:image/png;base64,img123");
      expect(result.content).not.toContain("Prompt used:");
    });

    it("returns url-based markdown when response has url instead of b64_json", async () => {
      const url = "https://example.com/image.png";
      httpService.post.mockReturnValue(
        of(buildAxiosResponse({ data: [{ url }] })),
      );

      const result = await service.callDallE3("test-key", "landscape");

      expect(result.content).toBe(`![Generated Image](${url})`);
      expect(result.model).toBe("dall-e-3");
    });

    it("returns error message when API returns no image data", async () => {
      httpService.post.mockReturnValue(of(buildAxiosResponse({ data: [{}] })));

      const result = await service.callDallE3("test-key", "empty");

      expect(result.content).toContain("图像生成失败");
      expect(result.model).toBe("dall-e-3");
    });

    it("returns error message when data array is empty", async () => {
      httpService.post.mockReturnValue(of(buildAxiosResponse({ data: [] })));

      const result = await service.callDallE3("test-key", "nothing");

      expect(result.content).toContain("图像生成失败");
    });

    it("returns error message on non-retryable HTTP error (401)", async () => {
      const axiosErr = buildAxiosError(401, "Unauthorized");
      httpService.post.mockReturnValue(throwError(() => axiosErr));

      const result = await service.callDallE3("bad-key", "cat");

      expect(result.content).toContain("图像生成失败");
      expect(result.model).toBe("dall-e-3");
      expect(result.tokensUsed).toBe(0);
    });

    it("includes error message from API response in returned content", async () => {
      const axiosErr = buildAxiosError(400, "billing_hard_limit_reached");
      httpService.post.mockReturnValue(throwError(() => axiosErr));

      const result = await service.callDallE3("test-key", "cat");

      expect(result.content).toContain("billing_hard_limit_reached");
    });

    it("retries on rate-limit error (429) then succeeds", async () => {
      // Use a 429 message without "quota"/"exceeded" so it maps to RATE_LIMIT (retryable)
      // Messages containing "exceeded" map to QUOTA_EXCEEDED (non-retryable) instead.
      const rateLimitErr = buildAxiosError(429, "Too many requests, slow down");
      const successResponse = buildAxiosResponse({
        data: [{ b64_json: "retried_img" }],
      });

      httpService.post
        .mockReturnValueOnce(throwError(() => rateLimitErr))
        .mockReturnValueOnce(throwError(() => rateLimitErr))
        .mockReturnValueOnce(of(successResponse));

      // setTimeout is mocked to run immediately, so retries resolve without real delay
      const result = await service.callDallE3("test-key", "retry test");

      expect(result.content).toContain("retried_img");
      expect(httpService.post).toHaveBeenCalledTimes(3);
    });

    it("returns error content when max retries exceeded on rate-limit", async () => {
      // Use 429 without "exceeded" to get RATE_LIMIT (retryable) and trigger all 3 retries
      const rateLimitErr = buildAxiosError(429, "Too many requests, slow down");
      httpService.post.mockReturnValue(throwError(() => rateLimitErr));

      const result = await service.callDallE3("test-key", "max retry");

      expect(result.content).toContain("图像生成失败");
      expect(httpService.post).toHaveBeenCalledTimes(3);
    });

    it("uses correct Authorization header", async () => {
      httpService.post.mockReturnValue(
        of(buildAxiosResponse({ data: [{ b64_json: "x" }] })),
      );

      await service.callDallE3("my-api-key", "test");

      const callArgs = httpService.post.mock.calls[0];
      expect(callArgs[2]?.headers?.Authorization).toBe("Bearer my-api-key");
    });

    it("posts correct request body to DALL-E API", async () => {
      httpService.post.mockReturnValue(
        of(buildAxiosResponse({ data: [{ b64_json: "x" }] })),
      );

      await service.callDallE3("key", "a beautiful forest");

      const callArgs = httpService.post.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.openai.com/v1/images/generations");
      expect(callArgs[1]).toMatchObject({
        model: "dall-e-3",
        prompt: "a beautiful forest",
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
      });
    });
  });

  // =====================================================================
  // callImagenApi
  // =====================================================================

  describe("callImagenApi", () => {
    it("returns images from generatedImages (SDK format)", async () => {
      const b64 = "sdk_format_base64";
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ image: { imageBytes: b64 } }],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "a cat",
      );

      expect(result.content).toContain(`data:image/png;base64,${b64}`);
      expect(result.model).toBe("imagen-4.0-generate-001");
      expect(result.tokensUsed).toBe(0);
    });

    it("returns images from generatedImages with top-level imageBytes", async () => {
      const b64 = "top_level_bytes";
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ imageBytes: b64 }],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain(b64);
    });

    it("returns images from predictions (REST format)", async () => {
      const b64 = "rest_format_base64";
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            predictions: [{ bytesBase64Encoded: b64 }],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "a dog",
      );

      expect(result.content).toContain(`data:image/png;base64,${b64}`);
      expect(result.model).toBe("imagen-4.0-generate-001");
    });

    it("returns images from predictions with nested image.imageBytes", async () => {
      const b64 = "nested_pred_bytes";
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            predictions: [{ image: { imageBytes: b64 } }],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain(b64);
    });

    it("strips whitespace from base64 data", async () => {
      const b64WithSpaces = "abc  def\nghi";
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ image: { imageBytes: b64WithSpaces } }],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      // The base64 portion should have whitespace stripped to "abcdefghi"
      expect(result.content).toContain("abcdefghi");
      // The base64 section should not contain spaces or newlines
      const base64Match = result.content.match(/base64,([^)]+)/);
      expect(base64Match).not.toBeNull();
      expect(base64Match![1]).not.toMatch(/\s/);
    });

    it("generates markdown for multiple images", async () => {
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [
              { image: { imageBytes: "img1" } },
              { image: { imageBytes: "img2" } },
            ],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain("Generated Image 1");
      expect(result.content).toContain("Generated Image 2");
    });

    it("uses provided modelId when it contains 'imagen-4'", async () => {
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ image: { imageBytes: "x" } }],
          }),
        ),
      );

      const customModel = "imagen-4.0-ultra-001";
      const result = await service.callImagenApi("key", customModel, "test");

      expect(result.model).toBe(customModel);
      const callUrl = httpService.post.mock.calls[0][0];
      expect(callUrl).toContain(customModel);
    });

    it("falls back to default model when modelId does not contain 'imagen-4'", async () => {
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ image: { imageBytes: "x" } }],
          }),
        ),
      );

      const result = await service.callImagenApi("key", "gemini-pro", "test");

      expect(result.model).toBe("imagen-4.0-generate-001");
    });

    it("returns error content when no images found in response", async () => {
      httpService.post.mockReturnValue(
        of(buildAxiosResponse({ predictions: [], generatedImages: [] })),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain("Imagen 图像生成失败");
    });

    it("returns error content on API failure (401)", async () => {
      // The error classifier remaps 401 to "Invalid API key" message
      const axiosErr = buildAxiosError(401, "API key invalid");
      httpService.post.mockReturnValue(throwError(() => axiosErr));

      const result = await service.callImagenApi(
        "bad-key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain("Imagen 图像生成失败");
      // error classifier maps 401 -> "Invalid API key"
      expect(result.content).toContain("Invalid API key");
    });

    it("retries on temporary unavailability (503) then succeeds", async () => {
      const serverErr = buildAxiosError(503, "Service Unavailable");
      const successResponse = buildAxiosResponse({
        generatedImages: [{ image: { imageBytes: "retry_success" } }],
      });

      httpService.post
        .mockReturnValueOnce(throwError(() => serverErr))
        .mockReturnValueOnce(of(successResponse));

      // setTimeout is mocked to run immediately, so retries resolve without real delay
      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain("retry_success");
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it("uses x-goog-api-key header", async () => {
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ image: { imageBytes: "x" } }],
          }),
        ),
      );

      await service.callImagenApi(
        "google-api-key",
        "imagen-4.0-generate-001",
        "test",
      );

      const callArgs = httpService.post.mock.calls[0];
      expect(callArgs[2]?.headers?.["x-goog-api-key"]).toBe("google-api-key");
    });

    it("sends correct request body with aspect ratio 16:9", async () => {
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [{ image: { imageBytes: "x" } }],
          }),
        ),
      );

      await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "a landscape",
      );

      const callArgs = httpService.post.mock.calls[0];
      expect(callArgs[1]).toMatchObject({
        instances: [{ prompt: "a landscape" }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "16:9",
        },
      });
    });

    it("filters out null entries from generatedImages when imageBytes is missing", async () => {
      httpService.post.mockReturnValue(
        of(
          buildAxiosResponse({
            generatedImages: [
              { image: { imageBytes: "valid_img" } },
              { image: {} }, // no imageBytes
            ],
          }),
        ),
      );

      const result = await service.callImagenApi(
        "key",
        "imagen-4.0-generate-001",
        "test",
      );

      expect(result.content).toContain("valid_img");
      // Only one image should appear
      expect((result.content.match(/Generated Image/g) || []).length).toBe(1);
    });
  });
});
