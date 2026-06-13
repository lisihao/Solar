/**
 * AudioGenerationTool Unit Tests
 *
 * Tests the audio-generation tool in isolation by mocking ITTSService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  AudioGenerationTool,
  AudioGenerationOutput,
} from "../audio-generation.tool";
import {
  TTS_SERVICE,
  ITTSService,
} from "../../../abstractions/generation-services.interface";
import { ToolContext, ToolResult } from "../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-audio-001",
    toolId: "audio-generation",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock ITTSService
// ---------------------------------------------------------------------------

function createMockTtsService(): jest.Mocked<ITTSService> {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    getProvider: jest.fn().mockReturnValue("elevenlabs"),
    generateAudio: jest.fn().mockResolvedValue({
      audioUrl: "https://storage.example.com/audio/test-output.mp3",
      duration: 12.5,
    }),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AudioGenerationTool", () => {
  let tool: AudioGenerationTool;
  let mockTtsService: jest.Mocked<ITTSService>;

  beforeEach(async () => {
    mockTtsService = createMockTtsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioGenerationTool,
        { provide: TTS_SERVICE, useValue: mockTtsService },
      ],
    }).compile();

    tool = module.get<AudioGenerationTool>(AudioGenerationTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'audio-generation'", () => {
      expect(tool.id).toBe("audio-generation");
    });

    it("should belong to the 'generation' category", () => {
      expect(tool.category).toBe("generation");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty text", () => {
      expect(tool.validateInput({ text: "Hello world" })).toBe(true);
    });

    it("should return false for empty text", () => {
      expect(tool.validateInput({ text: "" })).toBe(false);
    });

    it("should return false for whitespace-only text", () => {
      expect(tool.validateInput({ text: "   " })).toBe(false);
    });

    it("should return false for text exceeding 50000 characters", () => {
      expect(tool.validateInput({ text: "a".repeat(50001) })).toBe(false);
    });

    it("should return true for text at exactly 50000 characters", () => {
      expect(tool.validateInput({ text: "a".repeat(50000) })).toBe(true);
    });

    it("should return false for speed below 0.5", () => {
      expect(tool.validateInput({ text: "hello", speed: 0.4 })).toBe(false);
    });

    it("should return false for speed above 2.0", () => {
      expect(tool.validateInput({ text: "hello", speed: 2.1 })).toBe(false);
    });

    it("should return true for speed at boundary 0.5", () => {
      expect(tool.validateInput({ text: "hello", speed: 0.5 })).toBe(true);
    });

    it("should return true for speed at boundary 2.0", () => {
      expect(tool.validateInput({ text: "hello", speed: 2.0 })).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with audioUrl when TTS service succeeds", async () => {
      const result: ToolResult<AudioGenerationOutput> = await tool.execute(
        { text: "Welcome to our podcast." },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.audioUrl).toBe(
        "https://storage.example.com/audio/test-output.mp3",
      );
      expect(result.data?.duration).toBe(12.5);
    });

    it("should include provider in output", async () => {
      const result = await tool.execute(
        { text: "Testing provider field" },
        makeContext(),
      );

      expect(result.data?.provider).toBe("elevenlabs");
    });

    it("should include metadata with voice, language, speed, wordCount", async () => {
      const result = await tool.execute(
        {
          text: "Hello world",
          voice: "Host1",
          language: "en-US",
          speed: 1.2,
        },
        makeContext(),
      );

      expect(result.data?.metadata?.voice).toBe("Host1");
      expect(result.data?.metadata?.language).toBe("en-US");
      expect(result.data?.metadata?.speed).toBe(1.2);
      expect(result.data?.metadata?.wordCount).toBe(2);
    });

    it("should use default voice Host1 when not specified", async () => {
      const result = await tool.execute(
        { text: "Default voice test" },
        makeContext(),
      );

      expect(result.data?.metadata?.voice).toBe("Host1");
    });

    it("should pass the correct format to output", async () => {
      const result = await tool.execute(
        { text: "Format test", format: "wav" },
        makeContext(),
      );

      expect(result.data?.format).toBe("wav");
    });

    it("should call generateAudio with correct script structure", async () => {
      await tool.execute(
        { text: "Script test", voice: "female", emotion: "excited" },
        makeContext(),
      );

      expect(mockTtsService.generateAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Generated Audio",
          script: expect.objectContaining({
            segments: expect.arrayContaining([
              expect.objectContaining({
                speaker: "female",
                text: "Script test",
                emotion: "excited",
              }),
            ]),
          }),
        }),
      );
    });

    it("should not include emotion field when emotion is neutral", async () => {
      await tool.execute(
        { text: "Neutral emotion", emotion: "neutral" },
        makeContext(),
      );

      const calledScript = mockTtsService.generateAudio.mock.calls[0][0];
      const segment = calledScript.script.segments[0];
      expect(segment.emotion).toBeUndefined();
    });

    it("should split text into segments when segmented=true", async () => {
      const multiParagraphText =
        "First paragraph.\n\nSecond paragraph.\n\nThird.";

      await tool.execute(
        { text: multiParagraphText, segmented: true },
        makeContext(),
      );

      const calledScript = mockTtsService.generateAudio.mock.calls[0][0];
      expect(calledScript.script.segments.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Service not available scenarios
  // -------------------------------------------------------------------------

  describe("execute() - service unavailable", () => {
    it("should return success:false when TTS service is not injected", async () => {
      // Create tool without TTS service
      const moduleWithoutService = await Test.createTestingModule({
        providers: [AudioGenerationTool],
      }).compile();

      const toolWithoutService =
        moduleWithoutService.get<AudioGenerationTool>(AudioGenerationTool);

      const result = await toolWithoutService.execute(
        { text: "No service" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("TTS service not available");
    });

    it("should return success:false when TTS service is not available (no API key)", async () => {
      mockTtsService.isAvailableAsync.mockResolvedValue(false);

      const result = await tool.execute(
        { text: "API key missing" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("TTS service not available");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return success:false when generateAudio returns null", async () => {
      mockTtsService.generateAudio.mockResolvedValue(null);

      const result = await tool.execute(
        { text: "Null result test" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Failed to generate audio");
    });

    it("should return success:false when generateAudio throws", async () => {
      mockTtsService.generateAudio.mockRejectedValue(
        new Error("ElevenLabs quota exceeded"),
      );

      const result = await tool.execute({ text: "Error test" }, makeContext());

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("ElevenLabs quota exceeded");
    });

    it("should return empty audioUrl on error", async () => {
      mockTtsService.generateAudio.mockRejectedValue(new Error("Timeout"));

      const result = await tool.execute({ text: "fail" }, makeContext());

      expect(result.data?.audioUrl).toBe("");
      expect(result.data?.duration).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { text: "Cancelled" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockTtsService.generateAudio).not.toHaveBeenCalled();
    });
  });
});
