/**
 * Imagen4PromptService Unit Tests
 *
 * Tests 4-Agent collaboration for Imagen 4 prompt generation
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Imagen4PromptService } from "../generation/imagen4-prompt.service";
import { TeamFacade } from "@/modules/ai-harness/facade";

// Helper to create an async generator that yields the given events
function createMockEventGenerator(events: object[]) {
  return async function* () {
    for (const event of events) {
      yield event;
    }
  };
}

describe("Imagen4PromptService", () => {
  let service: Imagen4PromptService;

  const mockFacade = {
    executeMissionStream: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Imagen4PromptService,
        { provide: TeamFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<Imagen4PromptService>(Imagen4PromptService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ generateImagen4Prompt ============

  describe("generateImagen4Prompt", () => {
    it("should generate prompt using Style Agent output when available", async () => {
      const styleOutput = {
        imagen4Prompt: {
          subject: "Mountain landscape",
          environment: "Alpine valley at sunset",
          composition: "Rule of thirds",
          lighting: "Golden hour warm light",
          style: "Cinematic photography",
          quality: "4K high resolution",
          finalPrompt:
            "A breathtaking mountain landscape in golden hour, rule of thirds composition, 4K resolution",
          negativePrompt: "blurry, low quality, distorted, watermark",
        },
        parameters: {
          aspectRatio: "16:9" as const,
          enhancePrompt: true,
          numberOfImages: 1,
        },
        designJournal: [
          { title: "Style decision", reasoning: "Cinematic style chosen" },
        ],
        qualityChecks: ["High resolution", "Good composition"],
      };

      const events = [
        {
          type: "step_started",
          timestamp: new Date().toISOString(),
          data: { stepId: "content-analysis" },
        },
        {
          type: "step_completed",
          timestamp: new Date().toISOString(),
          data: {
            stepId: "style-generation",
            result: styleOutput,
          },
        },
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: { result: {} },
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const result = await service.generateImagen4Prompt({
        prompt: "A beautiful mountain scene",
        aspectRatio: "16:9",
      });

      expect(result.finalPrompt).toContain("mountain");
      expect(result.negativePrompt).toBeDefined();
      expect(result.aspectRatio).toBeDefined();
      expect(result.statistics.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it("should fall back to manual composition when Style Agent output is absent", async () => {
      const events = [
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: { result: {} },
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const result = await service.generateImagen4Prompt({
        prompt: "A city at night with neon lights",
      });

      expect(result.finalPrompt).toBeDefined();
      expect(result.finalPrompt.length).toBeGreaterThan(0);
      expect(result.negativePrompt).toContain("blurry");
    });

    it("should call onProgress callback for each phase", async () => {
      const events = [
        {
          type: "step_started",
          timestamp: new Date().toISOString(),
          data: { stepId: "content-1" },
        },
        {
          type: "step_completed",
          timestamp: new Date().toISOString(),
          data: {
            stepId: "content-analysis",
            result: {
              subject: {
                type: "scene",
                mainSubject: "Mountain",
                secondarySubjects: [],
                actions: [],
              },
              mood: { primary: "peaceful", keywords: ["serene"] },
              narrative: { type: "static", focusPoint: "summit" },
              language: "en",
            },
          },
        },
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const progressEvents: object[] = [];
      const onProgress = jest.fn((event) => progressEvents.push(event));

      await service.generateImagen4Prompt(
        { prompt: "mountain scene" },
        onProgress,
      );

      expect(onProgress).toHaveBeenCalled();
    });

    it("should throw when mission fails", async () => {
      const events = [
        {
          type: "mission_failed",
          timestamp: new Date().toISOString(),
          data: { error: "Team execution failed due to LLM timeout" },
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      await expect(
        service.generateImagen4Prompt({ prompt: "test prompt" }),
      ).rejects.toThrow("Visual Design Team 执行失败");
    });

    it("should use content from agentOutputs for manual composition", async () => {
      const contentOutput = {
        subject: {
          type: "scene",
          mainSubject: "Futuristic cityscape",
          secondarySubjects: ["holographic billboards", "flying cars"],
          actions: ["glowing", "floating"],
        },
        mood: { primary: "energetic", keywords: ["vibrant", "dynamic"] },
        narrative: { type: "dynamic", focusPoint: "skyline" },
        language: "en",
      };

      const events = [
        {
          type: "step_completed",
          timestamp: new Date().toISOString(),
          data: {
            stepId: "content-analysis",
            result: contentOutput,
          },
        },
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const result = await service.generateImagen4Prompt({
        prompt: "sci-fi city",
      });

      expect(result.finalPrompt).toContain("Futuristic cityscape");
    });

    it("should include style in manual composition when provided", async () => {
      const events = [
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const result = await service.generateImagen4Prompt({
        prompt: "landscape",
        style: "watercolor",
      });

      expect(result.finalPrompt).toContain("watercolor");
    });

    it("should propagate general errors", async () => {
      mockFacade.executeMissionStream.mockImplementation(() => {
        throw new Error("Cannot create stream");
      });

      await expect(
        service.generateImagen4Prompt({ prompt: "test" }),
      ).rejects.toThrow("Cannot create stream");
    });
  });

  // ============ generateImagen4PromptStream ============

  describe("generateImagen4PromptStream", () => {
    it("should yield progress events from mission stream", async () => {
      const events = [
        {
          type: "step_started",
          timestamp: new Date().toISOString(),
          data: { stepId: "content" },
        },
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const streamEvents: object[] = [];
      const generator = service.generateImagen4PromptStream({
        prompt: "test prompt",
      });

      for await (const event of generator) {
        streamEvents.push(event);
      }

      expect(streamEvents.length).toBeGreaterThan(0);
      const types = streamEvents.map((e: Record<string, unknown>) => e.type);
      expect(types).toContain("progress");
      expect(types).toContain("complete");
    });

    it("should yield agent_output events when step_completed with result", async () => {
      const contentOutput = {
        subject: {
          type: "portrait",
          mainSubject: "A person",
          secondarySubjects: [],
          actions: [],
        },
        mood: { primary: "professional", keywords: [] },
        narrative: { type: "static", focusPoint: "face" },
        language: "en",
      };

      const events = [
        {
          type: "step_completed",
          timestamp: new Date().toISOString(),
          data: {
            stepId: "content-analysis",
            result: contentOutput,
          },
        },
        {
          type: "mission_completed",
          timestamp: new Date().toISOString(),
          data: {},
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const streamEvents: object[] = [];
      for await (const event of service.generateImagen4PromptStream({
        prompt: "portrait",
      })) {
        streamEvents.push(event);
      }

      const types = streamEvents.map((e: Record<string, unknown>) => e.type);
      expect(types).toContain("agent_output");
    });

    it("should yield error event when mission fails", async () => {
      const events = [
        {
          type: "mission_failed",
          timestamp: new Date().toISOString(),
          data: { error: "LLM failed" },
        },
      ];

      mockFacade.executeMissionStream.mockReturnValue(
        createMockEventGenerator(events)(),
      );

      const streamEvents: object[] = [];
      for await (const event of service.generateImagen4PromptStream({
        prompt: "test",
      })) {
        streamEvents.push(event);
      }

      const errorEvent = streamEvents.find(
        (e: Record<string, unknown>) => e.type === "error",
      );
      expect(errorEvent).toBeDefined();
    });

    it("should yield error event when stream throws", async () => {
      mockFacade.executeMissionStream.mockImplementation(() => {
        throw new Error("Stream creation failed");
      });

      const streamEvents: object[] = [];
      for await (const event of service.generateImagen4PromptStream({
        prompt: "test",
      })) {
        streamEvents.push(event);
      }

      const errorEvent = streamEvents.find(
        (e: Record<string, unknown>) => e.type === "error",
      );
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as Record<string, unknown>).message).toContain(
        "Stream creation failed",
      );
    });
  });
});
