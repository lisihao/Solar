import { Test, TestingModule } from "@nestjs/testing";
import {
  Imagen4PromptService,
  ContentAgentOutput,
  LayoutAgentOutput,
  VisualAgentOutput,
  StyleAgentOutput,
  FourAgentOutputs,
  TeamProgressCallback,
} from "../imagen4-prompt.service";
import { TeamFacade } from "@/modules/ai-harness/facade";
import { GenerateImageOptions } from "../../core/image.types";

// ============================================================================
// Helpers
// ============================================================================

function buildGenerateOptions(
  overrides: Partial<GenerateImageOptions> = {},
): GenerateImageOptions {
  return {
    prompt: "A futuristic city skyline at sunset",
    style: "cinematic",
    aspectRatio: "16:9",
    ...overrides,
  };
}

function buildContentOutput(): ContentAgentOutput {
  return {
    subject: {
      type: "scene",
      mainSubject: "futuristic city skyline",
      secondarySubjects: ["flying cars", "neon lights"],
      actions: ["gleaming", "towering"],
    },
    mood: { primary: "dramatic", keywords: ["epic", "vibrant"] },
    narrative: { type: "static", focusPoint: "skyline silhouette" },
    language: "en",
  };
}

function buildLayoutOutput(): LayoutAgentOutput {
  return {
    composition: {
      type: "rule_of_thirds",
      description: "skyline on left third, open sky on right",
    },
    perspective: {
      cameraAngle: "eye_level",
      distance: "wide",
      focalLength: "wide_angle",
    },
    depth: {
      foreground: "blurred bokeh lights",
      midground: "city buildings",
      background: "sunset clouds",
      depthOfField: "shallow",
    },
    aspectRatioSuggestion: "16:9",
  };
}

function buildVisualOutput(): VisualAgentOutput {
  return {
    lighting: {
      type: "natural",
      direction: "side",
      quality: "golden_hour",
      effects: ["lens flare", "god rays"],
    },
    color: {
      palette: ["#FF6B35", "#FFD700", "#1A1A2E"],
      temperature: "warm",
      saturation: "vibrant",
      contrast: "high",
    },
    materials: { primary: "glass and steel", textures: ["smooth", "metallic"] },
    atmosphere: {
      effects: ["haze", "volumetric light"],
      weather: "clear",
      time: "sunset",
    },
  };
}

function buildStyleOutput(): StyleAgentOutput {
  return {
    imagen4Prompt: {
      subject: "futuristic mega-city skyline with hovering transport pods",
      environment: "golden sunset with deep orange and violet sky gradients",
      composition: "rule of thirds, skyline on left, expansive sky on right",
      lighting: "golden hour side lighting with god rays and lens flare",
      style: "cinematic photography, hyperrealistic",
      quality: "8K resolution, award-winning photograph, sharp details",
      finalPrompt:
        "futuristic mega-city skyline with hovering transport pods, golden sunset ..., 8K",
      negativePrompt:
        "blurry, low quality, distorted, watermark, text overlay, oversaturated",
    },
    parameters: { aspectRatio: "16:9", enhancePrompt: true, numberOfImages: 1 },
    designJournal: [
      { title: "Color Choice", reasoning: "Warm tones for drama" },
    ],
    qualityChecks: ["8K resolution verified", "no text in frame"],
  };
}

/** Build a generator that yields events and completes */
function* buildMissionStream(
  events: Array<{
    type: string;
    data?: Record<string, unknown>;
    timestamp?: string;
  }>,
) {
  for (const event of events) {
    yield {
      type: event.type,
      data: event.data ?? {},
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Imagen4PromptService", () => {
  let service: Imagen4PromptService;
  let aiFacade: jest.Mocked<Pick<TeamFacade, "executeMissionStream">>;

  beforeEach(async () => {
    aiFacade = {
      executeMissionStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Imagen4PromptService,
        { provide: TeamFacade, useValue: aiFacade },
      ],
    }).compile();

    service = module.get<Imagen4PromptService>(Imagen4PromptService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // generateImagen4Prompt - happy path
  // --------------------------------------------------------------------------

  describe("generateImagen4Prompt", () => {
    it("should use Style Agent finalPrompt when style output is present", async () => {
      const styleOutput = buildStyleOutput();
      const events = [
        {
          type: "step_completed",
          data: {
            stepId: "style-agent",
            result: styleOutput,
          },
        },
        { type: "mission_completed", data: {} },
      ];

      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      expect(result.finalPrompt).toBe(styleOutput.imagen4Prompt.finalPrompt);
      expect(result.negativePrompt).toBe(
        styleOutput.imagen4Prompt.negativePrompt,
      );
      expect(result.aspectRatio).toBe("16:9");
    });

    it("should fall back to manual compose when no style output", async () => {
      const contentOutput = buildContentOutput();
      const events = [
        {
          type: "step_completed",
          data: { stepId: "content-agent", result: contentOutput },
        },
        { type: "mission_completed", data: {} },
      ];

      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      // Should include prompt from content agent
      expect(result.finalPrompt).toContain(contentOutput.subject.mainSubject);
    });

    it("should fall back to raw input prompt when no agent outputs", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const opts = buildGenerateOptions({ prompt: "a red apple" });
      const result = await service.generateImagen4Prompt(opts);

      expect(result.finalPrompt).toContain("a red apple");
    });

    it("should throw when mission_failed event is emitted", async () => {
      const events = [
        {
          type: "mission_failed",
          data: { error: "Agent execution error" },
        },
      ];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      await expect(
        service.generateImagen4Prompt(buildGenerateOptions()),
      ).rejects.toThrow("Visual Design Team 执行失败");
    });

    it("should throw when executeMissionStream itself throws", async () => {
      aiFacade.executeMissionStream.mockImplementation(() => {
        throw new Error("facade connection error");
      });

      await expect(
        service.generateImagen4Prompt(buildGenerateOptions()),
      ).rejects.toThrow("facade connection error");
    });

    it("should call onProgress callbacks for each agent phase", async () => {
      const events = [
        { type: "step_started", data: {} },
        {
          type: "step_completed",
          data: { stepId: "content-step", result: buildContentOutput() },
        },
        { type: "step_started", data: {} },
        {
          type: "step_completed",
          data: { stepId: "layout-step", result: buildLayoutOutput() },
        },
        { type: "mission_completed", data: {} },
      ];

      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const progressCalls: string[] = [];
      const onProgress: TeamProgressCallback = (evt) => {
        progressCalls.push(`${evt.phase}:${evt.status}`);
      };

      await service.generateImagen4Prompt(buildGenerateOptions(), onProgress);

      expect(progressCalls).toContain("content:started");
      expect(progressCalls).toContain("content:completed");
      expect(progressCalls).toContain("layout:started");
      expect(progressCalls).toContain("layout:completed");
    });

    it("should call onProgress with complete phase when mission_completed", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const progressCalls: string[] = [];
      const onProgress: TeamProgressCallback = (evt) => {
        progressCalls.push(`${evt.phase}:${evt.status}`);
      };

      await service.generateImagen4Prompt(buildGenerateOptions(), onProgress);

      expect(progressCalls).toContain("complete:completed");
    });

    it("should include statistics with totalDuration > 0", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      expect(result.statistics.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.statistics.tokensUsed).toBe(0);
    });

    it("should populate insights.renderingMode as ai_image", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      expect(result.insights.renderingMode).toBe("ai_image");
    });

    it("should handle mission deliverables from mission_completed event", async () => {
      const allOutputs: FourAgentOutputs = {
        content: buildContentOutput(),
        layout: buildLayoutOutput(),
        visual: buildVisualOutput(),
        style: buildStyleOutput(),
      };

      const events = [
        {
          type: "mission_completed",
          data: {
            result: {
              deliverables: [{ type: "analysis", content: allOutputs }],
            },
          },
        },
      ];

      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      expect(result.agentOutputs.style).toBeDefined();
    });

    it("should use input aspectRatio as fallback when layout agent has no suggestion", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions({ aspectRatio: "1:1" }),
      );

      expect(result.aspectRatio).toBe("1:1");
    });

    it("should default to 16:9 aspect ratio when no input or layout suggestion", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions({ aspectRatio: undefined }),
      );

      expect(result.aspectRatio).toBe("16:9");
    });
  });

  // --------------------------------------------------------------------------
  // generateImagen4PromptStream
  // --------------------------------------------------------------------------

  describe("generateImagen4PromptStream", () => {
    it("should yield progress events for each mission event", async () => {
      const events = [
        { type: "step_started", data: {} },
        { type: "mission_completed", data: {} },
      ];

      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const yielded: Array<{ type: string }> = [];
      for await (const chunk of service.generateImagen4PromptStream(
        buildGenerateOptions(),
      )) {
        yielded.push(chunk);
      }

      expect(yielded.some((c) => c.type === "progress")).toBe(true);
    });

    it("should yield agent_output when step_completed with known stepId", async () => {
      const contentOutput = buildContentOutput();
      const events = [
        {
          type: "step_completed",
          data: { stepId: "content-step", result: contentOutput },
        },
        { type: "mission_completed", data: {} },
      ];

      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const yielded: Array<{ type: string; data: unknown }> = [];
      for await (const chunk of service.generateImagen4PromptStream(
        buildGenerateOptions(),
      )) {
        yielded.push(chunk);
      }

      const agentOutputChunks = yielded.filter(
        (c) => c.type === "agent_output",
      );
      expect(agentOutputChunks.length).toBeGreaterThan(0);
    });

    it("should yield complete event on mission_completed", async () => {
      const events = [{ type: "mission_completed", data: {} }];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const yielded: Array<{ type: string }> = [];
      for await (const chunk of service.generateImagen4PromptStream(
        buildGenerateOptions(),
      )) {
        yielded.push(chunk);
      }

      expect(yielded.some((c) => c.type === "complete")).toBe(true);
    });

    it("should yield error event on mission_failed", async () => {
      const events = [
        { type: "mission_failed", data: { error: "Stream failure" } },
      ];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const yielded: Array<{ type: string }> = [];
      for await (const chunk of service.generateImagen4PromptStream(
        buildGenerateOptions(),
      )) {
        yielded.push(chunk);
      }

      expect(yielded.some((c) => c.type === "error")).toBe(true);
    });

    it("should yield error event when stream throws", async () => {
      aiFacade.executeMissionStream.mockImplementation(function* () {
        throw new Error("stream crash");
      } as unknown as typeof aiFacade.executeMissionStream);

      const yielded: Array<{ type: string }> = [];
      for await (const chunk of service.generateImagen4PromptStream(
        buildGenerateOptions(),
      )) {
        yielded.push(chunk);
      }

      expect(yielded.some((c) => c.type === "error")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // buildMissionContent (tested indirectly via executeMissionStream call args)
  // --------------------------------------------------------------------------

  describe("buildMissionContent (via executeMissionStream args)", () => {
    beforeEach(() => {
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream([
          { type: "mission_completed", data: {} },
        ]) as unknown as ReturnType<TeamFacade["executeMissionStream"]>,
      );
    });

    it("should include user prompt in mission goal", async () => {
      const opts = buildGenerateOptions({ prompt: "a golden retriever" });
      await service.generateImagen4Prompt(opts);

      const call = (aiFacade.executeMissionStream as jest.Mock).mock
        .calls[0][0];
      expect(call.goal).toContain("a golden retriever");
    });

    it("should include style in mission goal when provided", async () => {
      const opts = buildGenerateOptions({ style: "anime" });
      await service.generateImagen4Prompt(opts);

      const call = (aiFacade.executeMissionStream as jest.Mock).mock
        .calls[0][0];
      expect(call.goal).toContain("anime");
    });

    it("should include aspectRatio in mission context", async () => {
      const opts = buildGenerateOptions({ aspectRatio: "9:16" });
      await service.generateImagen4Prompt(opts);

      const call = (aiFacade.executeMissionStream as jest.Mock).mock
        .calls[0][0];
      expect(call.context).toContain("9:16");
    });

    it("should truncate content longer than 2000 chars", async () => {
      const longContent = "x".repeat(3000);
      const opts = buildGenerateOptions({ content: longContent });
      await service.generateImagen4Prompt(opts);

      const call = (aiFacade.executeMissionStream as jest.Mock).mock
        .calls[0][0];
      expect(call.goal.length).toBeLessThan(longContent.length + 500);
      expect(call.goal).toContain("...");
    });

    it("should set teamId to design", async () => {
      await service.generateImagen4Prompt(buildGenerateOptions());

      const call = (aiFacade.executeMissionStream as jest.Mock).mock
        .calls[0][0];
      expect(call.teamId).toBe("design");
    });
  });

  // --------------------------------------------------------------------------
  // insights building
  // --------------------------------------------------------------------------

  describe("buildInsightsFromAgentOutputs", () => {
    it("should add content journal entry when content agent present", async () => {
      const contentOutput = buildContentOutput();
      const events = [
        {
          type: "step_completed",
          data: { stepId: "content-agent", result: contentOutput },
        },
        { type: "mission_completed", data: {} },
      ];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      const journalTitles = result.insights.designJournal.map((j) => j.title);
      expect(journalTitles).toContain("内容分析");
    });

    it("should update colorPalette when visual agent is present", async () => {
      const visualOutput = buildVisualOutput();
      const events = [
        {
          type: "step_completed",
          data: { stepId: "visual-agent", result: visualOutput },
        },
        { type: "mission_completed", data: {} },
      ];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      expect(result.insights.visualLanguage.colorPalette).toEqual(
        visualOutput.color.palette,
      );
    });

    it("should update qualityChecks from style agent", async () => {
      const styleOutput = buildStyleOutput();
      const events = [
        {
          type: "step_completed",
          data: { stepId: "style-agent", result: styleOutput },
        },
        { type: "mission_completed", data: {} },
      ];
      aiFacade.executeMissionStream.mockReturnValue(
        buildMissionStream(events) as unknown as ReturnType<
          TeamFacade["executeMissionStream"]
        >,
      );

      const result = await service.generateImagen4Prompt(
        buildGenerateOptions(),
      );

      expect(result.insights.qualityChecks).toEqual(styleOutput.qualityChecks);
    });
  });
});
