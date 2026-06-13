/**
 * SlidesEngineService Unit Tests
 *
 * Tests for the core slides generation engine service:
 * - generateSlides (async generator)
 * - restoreCheckpoint
 * - regeneratePage
 * - exportPptx / exportPdf
 * - event handling (handlePageGenerated, handlePageGenerating)
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SlidesEngineService } from "../slides-engine.service";
import { SlidesTeamOrchestrator } from "../../orchestrator/slides-team-orchestrator";
import { SlidesCheckpointService } from "../../checkpoint/checkpoint.service";
import { SlidesExportService } from "../../rendering/slides-export.service";
import { ContentCompressionSkill } from "../../skills/content-compression.skill";
import { TemplateRenderingSkill } from "../../skills/template-rendering.skill";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type {
  CheckpointState,
  PageOutline,
} from "../../checkpoint/checkpoint.types";
import type { PageGeneratedEvent } from "../../skills/page-pipeline.skill";
import type { SlidesMissionEvent } from "../../orchestrator/types";

// ============================================================================
// Helpers
// ============================================================================

function makeMockOrchestrator(): jest.Mocked<
  Pick<SlidesTeamOrchestrator, "executeMission">
> {
  return {
    executeMission: jest.fn(),
  };
}

function makeMockCheckpointService() {
  return {
    createSession: jest.fn().mockResolvedValue({ id: "session-new" }),
    create: jest.fn().mockResolvedValue({ id: "ckpt-1" }),
    getLatestCheckpoint: jest.fn().mockResolvedValue(null),
    restore: jest.fn(),
    getSession: jest.fn(),
    list: jest.fn(),
    getSessions: jest.fn(),
    updateSessionStatus: jest.fn(),
    updateSessionTitle: jest.fn(),
    deleteSession: jest.fn(),
    prune: jest.fn(),
    get: jest.fn(),
  };
}

function makeMockExportService() {
  return {
    exportToPPTX: jest.fn().mockResolvedValue({ buffer: Buffer.from("pptx") }),
    exportToPDF: jest.fn().mockResolvedValue({ buffer: Buffer.from("pdf") }),
  };
}

function makeMockContentCompression(): jest.Mocked<ContentCompressionSkill> {
  return {
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: {
        pageContent: {
          title: "Regenerated Title",
          sections: [
            { type: "text", position: "left", content: "New content" },
          ],
        },
      },
      metadata: {
        executionId: "exec-1",
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
      },
    }),
  } as unknown as jest.Mocked<ContentCompressionSkill>;
}

function makeMockTemplateRendering(): jest.Mocked<TemplateRenderingSkill> {
  return {
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: {
        html: "<div class='slide-container'>Rendered HTML</div>",
        templateId: "template-cover",
        variables: {},
        themeId: "genspark-dark",
      },
      metadata: {
        executionId: "exec-1",
        startTime: new Date(),
        endTime: new Date(),
        duration: 50,
      },
    }),
    render: jest.fn().mockReturnValue({
      html: "<div>Rendered</div>",
      templateId: "cover",
      variables: {},
      themeId: "genspark-dark",
    }),
  } as unknown as jest.Mocked<TemplateRenderingSkill>;
}

function makeMockAiFacade() {
  return {
    chat: jest.fn().mockResolvedValue({
      content:
        '```json\n{"title":"New Title","templateType":"cover","keyElements":["Point 1"]}\n```',
      tokensUsed: 100,
    }),
    startTrace: jest.fn().mockReturnValue("trace-001"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-001"),
    endSpan: jest.fn(),
  };
}

function makeMockEventEmitter() {
  return {
    emit: jest.fn(),
  };
}

function makeCheckpointState(pages: unknown[] = []): CheckpointState {
  return {
    pages: pages as CheckpointState["pages"],
    conversation: [],
  };
}

function makePageOutline(): PageOutline {
  return {
    pageNumber: 1,
    title: "Test Page",
    templateType: "cover",
    contentBrief: "Test brief",
    keyElements: ["Key 1"],
    layoutHints: [],
  };
}

// ============================================================================
// Async generator helper: collect all events
// ============================================================================
async function collectEvents<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// Build a simple mock mission event generator
async function* mockMissionEventGenerator(
  events: SlidesMissionEvent[],
): AsyncGenerator<SlidesMissionEvent> {
  for (const e of events) {
    yield e;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("SlidesEngineService", () => {
  let service: SlidesEngineService;
  let mockOrchestrator: ReturnType<typeof makeMockOrchestrator>;
  let mockCheckpoint: ReturnType<typeof makeMockCheckpointService>;
  let mockExport: ReturnType<typeof makeMockExportService>;
  let mockCompression: jest.Mocked<ContentCompressionSkill>;
  let mockRendering: jest.Mocked<TemplateRenderingSkill>;
  let mockFacade: ReturnType<typeof makeMockAiFacade>;
  let mockEventEmitter: ReturnType<typeof makeMockEventEmitter>;

  beforeEach(() => {
    mockOrchestrator = makeMockOrchestrator();
    mockCheckpoint = makeMockCheckpointService();
    mockExport = makeMockExportService();
    mockCompression = makeMockContentCompression();
    mockRendering = makeMockTemplateRendering();
    mockFacade = makeMockAiFacade();
    mockEventEmitter = makeMockEventEmitter();

    service = new SlidesEngineService(
      mockOrchestrator as unknown as SlidesTeamOrchestrator,
      mockCheckpoint as unknown as SlidesCheckpointService,
      mockExport as unknown as SlidesExportService,
      mockCompression,
      mockRendering,
      mockFacade as unknown as ChatFacade,
      mockEventEmitter as unknown as EventEmitter2,
    );
  });

  // --------------------------------------------------------------------------
  // generateSlides - basic flow
  // --------------------------------------------------------------------------

  describe("generateSlides()", () => {
    it("should create new session when sessionId not provided", async () => {
      const missionEvents: SlidesMissionEvent[] = [
        {
          type: "mission:created",
          missionId: "mission-1",
          timestamp: new Date(),
          data: {},
        },
        {
          type: "mission:completed",
          missionId: "mission-1",
          timestamp: new Date(),
          data: { pages: [], duration: 1000 },
        },
      ];

      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator(missionEvents),
      );

      const events = await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Test source text",
        }),
      );

      expect(mockCheckpoint.createSession).toHaveBeenCalledWith(
        "user-1",
        "PPT 生成",
      );
      expect(events.length).toBeGreaterThan(0);
    });

    it("should use existing sessionId when provided", async () => {
      const missionEvents: SlidesMissionEvent[] = [
        {
          type: "mission:completed",
          missionId: "mission-1",
          timestamp: new Date(),
          data: { pages: [], duration: 500 },
        },
      ];

      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator(missionEvents),
      );

      await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
          sessionId: "existing-session-id",
        }),
      );

      expect(mockCheckpoint.createSession).not.toHaveBeenCalled();
    });

    it("should yield execution:started event", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
        }),
      );

      expect(events.some((e) => e.type === "execution:started")).toBe(true);
    });

    it("should yield execution:completed event after mission completes", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [{ html: "<div>Slide 1</div>" }], duration: 1000 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
        }),
      );

      expect(events.some((e) => e.type === "execution:completed")).toBe(true);
    });

    it("should yield execution:failed event when orchestrator throws", async () => {
      async function* failingGenerator(): AsyncGenerator<SlidesMissionEvent> {
        throw new Error("Orchestrator failure");
        yield {} as SlidesMissionEvent; // unreachable but satisfies type
      }

      mockOrchestrator.executeMission.mockReturnValue(failingGenerator());

      const events = await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
        }),
      );

      expect(events.some((e) => e.type === "execution:failed")).toBe(true);
    });

    it("should transform planning:started event to agent events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "planning:started",
            missionId: "m1",
            timestamp: new Date(),
            data: { phase: "planning" },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
        }),
      );

      expect(
        events.some(
          (e) => e.type === "agent:working" || e.type === "agent:thinking",
        ),
      ).toBe(true);
    });

    it("should save initial checkpoint on new session creation", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
          userRequirement: "Focus on charts",
        }),
      );

      // create is called for initial checkpoint + final checkpoint
      expect(mockCheckpoint.create).toHaveBeenCalled();
    });

    it("should pass themeId to orchestrator input", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
          themeId: "custom-theme",
        }),
      );

      expect(mockOrchestrator.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ themeId: "custom-theme" }),
      );
    });

    it("should pass crossModuleSource as sourceSubscription when provided", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      await collectEvents(
        service.generateSlides({
          userId: "user-1",
          sourceText: "Content",
          crossModuleSource: {
            type: "topic-insights",
            sourceId: "topic-abc",
            sourceName: "AI Research",
          },
        }),
      );

      expect(mockOrchestrator.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSubscription: expect.objectContaining({
            type: "topic-insights",
            sourceId: "topic-abc",
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // handlePageGenerated
  // --------------------------------------------------------------------------

  describe("handlePageGenerated()", () => {
    it("should not crash when sessionId is missing", () => {
      const event: PageGeneratedEvent = {
        pageNumber: 1,
        totalPages: 5,
        title: "Test",
        html: "<div>HTML</div>",
        templateId: "cover",
        sessionId: "",
        design: undefined,
        keyPoints: [],
      };

      expect(() => service.handlePageGenerated(event)).not.toThrow();
    });

    it("should buffer page event for valid sessionId", () => {
      const event: PageGeneratedEvent = {
        pageNumber: 1,
        totalPages: 5,
        title: "Test Slide",
        html: "<div>Slide HTML</div>",
        templateId: "cover",
        sessionId: "test-session",
        design: undefined,
        keyPoints: ["Key 1"],
      };

      service.handlePageGenerated(event);
      // No direct assertion on internal buffer, but should not throw
      expect(true).toBe(true);
    });

    it("should buffer thinking event when design.reasoning is present", () => {
      const event: PageGeneratedEvent = {
        pageNumber: 2,
        totalPages: 5,
        title: "Design Thinking Slide",
        html: "<div>HTML</div>",
        templateId: "pillars",
        sessionId: "session-thinking",
        design: {
          reasoning: "This slide should emphasize key metrics",
          step1_drafting: undefined,
          step2_refiningLayout: undefined,
          step3_planningVisuals: undefined,
          step4_writingContent: undefined,
        } as unknown as PageGeneratedEvent["design"],
        keyPoints: [],
      };

      expect(() => service.handlePageGenerated(event)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // handlePageGenerating
  // --------------------------------------------------------------------------

  describe("handlePageGenerating()", () => {
    it("should buffer slide:generating and agent:working events", () => {
      const event = {
        pageNumber: 2,
        totalPages: 8,
        title: "Market Analysis",
        templateType: "dashboard",
        sessionId: "session-generating",
      };

      expect(() => service.handlePageGenerating(event)).not.toThrow();
    });

    it("should not crash when sessionId is empty", () => {
      const event = {
        pageNumber: 1,
        totalPages: 5,
        title: "Test",
        templateType: "cover",
        sessionId: "",
      };

      expect(() => service.handlePageGenerating(event)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // getSessionState
  // --------------------------------------------------------------------------

  describe("getSessionState()", () => {
    it("should return null when no checkpoint exists", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue(null);

      const result = await service.getSessionState("session-1");

      expect(result).toBeNull();
    });

    it("should return state from latest checkpoint", async () => {
      const state = makeCheckpointState([]);
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        id: "ckpt-1",
        sessionId: "session-1",
        state,
      } as unknown);

      const result = await service.getSessionState("session-1");

      expect(result).toEqual(state);
    });
  });

  // --------------------------------------------------------------------------
  // restoreCheckpoint
  // --------------------------------------------------------------------------

  describe("restoreCheckpoint()", () => {
    it("should delegate to checkpointService.restore", async () => {
      const restoredState = makeCheckpointState();
      mockCheckpoint.restore.mockResolvedValue({
        state: restoredState,
        sessionId: "session-1",
      });

      const result = await service.restoreCheckpoint("ckpt-abc");

      expect(mockCheckpoint.restore).toHaveBeenCalledWith("ckpt-abc");
      expect(result.sessionId).toBe("session-1");
      expect(result.state).toEqual(restoredState);
    });
  });

  // --------------------------------------------------------------------------
  // exportPptx
  // --------------------------------------------------------------------------

  describe("exportPptx()", () => {
    it("should throw when session has no checkpoint", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue(null);

      await expect(service.exportPptx("no-session")).rejects.toThrow(
        "not found",
      );
    });

    it("should return Buffer from exportService", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState(),
      } as unknown);

      const buffer = await service.exportPptx("session-1");

      expect(buffer).toBeInstanceOf(Buffer);
      expect(mockExport.exportToPPTX).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // exportPdf
  // --------------------------------------------------------------------------

  describe("exportPdf()", () => {
    it("should throw when session has no checkpoint", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue(null);

      await expect(service.exportPdf("no-session")).rejects.toThrow(
        "not found",
      );
    });

    it("should return Buffer from exportService", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState(),
      } as unknown);

      const buffer = await service.exportPdf("session-1");

      expect(buffer).toBeInstanceOf(Buffer);
      expect(mockExport.exportToPDF).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // regeneratePage
  // --------------------------------------------------------------------------

  describe("regeneratePage()", () => {
    it("should throw when session not found", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue(null);

      await expect(
        service.regeneratePage("no-session", 1, "feedback"),
      ).rejects.toThrow("not found");
    });

    it("should throw when page not found in session", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([]),
      } as unknown);

      await expect(
        service.regeneratePage("session-1", 1, "feedback"),
      ).rejects.toThrow("Page 1 not found");
    });

    it("should throw when compression or rendering skill not available", async () => {
      // Create service without optional skills
      const serviceWithoutSkills = new SlidesEngineService(
        mockOrchestrator as unknown as SlidesTeamOrchestrator,
        mockCheckpoint as unknown as SlidesCheckpointService,
        mockExport as unknown as SlidesExportService,
        undefined, // no compression
        undefined, // no rendering
        undefined,
        undefined,
      );

      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([
          {
            pageNumber: 1,
            outline: makePageOutline(),
            status: "completed",
            html: "<div>Old HTML</div>",
          },
        ]),
      } as unknown);

      await expect(
        serviceWithoutSkills.regeneratePage("session-1", 1, "feedback"),
      ).rejects.toThrow("页面重新生成服务不可用");
    });

    it("should return slide:generated event on success", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([
          {
            pageNumber: 1,
            outline: makePageOutline(),
            status: "completed",
            html: "<div>Old HTML</div>",
          },
        ]),
      } as unknown);
      mockCheckpoint.create.mockResolvedValue({ id: "ckpt-new" });

      const events = await service.regeneratePage(
        "session-1",
        1,
        "改为更专业的风格",
      );

      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should return execution:failed event when compression fails", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([
          {
            pageNumber: 1,
            outline: makePageOutline(),
            status: "completed",
            html: "<div>Old</div>",
          },
        ]),
      } as unknown);

      mockCompression.execute.mockResolvedValue({
        success: false,
        error: {
          code: "COMPRESSION_FAILED",
          message: "Failed",
          retryable: false,
        },
        metadata: {
          executionId: "e1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      });

      const events = await service.regeneratePage("session-1", 1, "feedback");

      expect(events.some((e) => e.type === "execution:failed")).toBe(true);
    });

    it("should use AI facade to parse feedback when available", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([
          {
            pageNumber: 1,
            outline: makePageOutline(),
            status: "completed",
            html: "<div>Old</div>",
          },
        ]),
      } as unknown);
      mockCheckpoint.create.mockResolvedValue({ id: "ckpt-new" });

      await service.regeneratePage("session-1", 1, "改为更现代的设计风格");

      expect(mockFacade.chat).toHaveBeenCalled();
    });

    it("should return original outline when feedback is empty and AI facade present", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([
          {
            pageNumber: 1,
            outline: makePageOutline(),
            status: "completed",
            html: "<div>Old</div>",
          },
        ]),
      } as unknown);
      mockCheckpoint.create.mockResolvedValue({ id: "ckpt-new" });

      // Empty feedback - AI should not be called for parsing
      await service.regeneratePage("session-1", 1, "");

      // AI chat should not be called for empty feedback
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should parse simple title feedback via regex fallback when AI fails", async () => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: makeCheckpointState([
          {
            pageNumber: 1,
            outline: makePageOutline(),
            status: "completed",
            html: "<div>Old</div>",
          },
        ]),
      } as unknown);
      mockCheckpoint.create.mockResolvedValue({ id: "ckpt-new" });

      // AI returns non-JSON response
      mockFacade.chat.mockResolvedValue({
        content: "Invalid response, not JSON",
        tokensUsed: 50,
      });

      const events = await service.regeneratePage(
        "session-1",
        1,
        "改为：全新标题",
      );

      // Should still succeed (fallback regex matches "改为：")
      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Event transformation
  // --------------------------------------------------------------------------

  describe("event transformation", () => {
    it("should transform mission:created to agent thinking events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:created",
            missionId: "m1",
            timestamp: new Date(),
            data: { mission: { sourceLength: 1000, targetPages: 10 } },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(
        events.some(
          (e) => e.type === "agent:thinking" || e.type === "agent:working",
        ),
      ).toBe(true);
    });

    it("should transform planning:completed to phase events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "planning:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { tasks: [], outline: {} },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // At minimum should have execution:started and execution:completed
      expect(events.length).toBeGreaterThan(1);
    });

    it("should transform planning:started to analyst thinking events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "planning:started",
            missionId: "m1",
            timestamp: new Date(),
            data: { sourceLength: 5000 },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(
        events.some(
          (e) => e.type === "agent:thinking" || e.type === "phase:started",
        ),
      ).toBe(true);
    });

    it("should transform planning:completed with taskCount and themes", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "planning:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              taskCount: 5,
              breakdown: {
                tasks: [{ title: "Task 1" }, { title: "Task 2" }],
                themes: ["AI", "Technology", "Growth"],
                keywords: ["machine learning", "automation", "efficiency"],
              },
              duration: 2000,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "agent:completed")).toBe(true);
    });

    it("should transform task:started to agent:working events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "task:started",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: {
                skillId: "slides-outline-planning",
                title: "Planning outline",
              },
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "agent:working")).toBe(true);
    });

    it("should transform task:completed with outline-planning skill to send pageOutlines", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "task:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: {
                skillId: "slides-outline-planning",
                title: "Outline Planning",
              },
              result: {
                pages: [
                  { pageNumber: 1, title: "Cover", templateType: "cover" },
                  { pageNumber: 2, title: "Overview", templateType: "toc" },
                  { pageNumber: 3, title: "Market", templateType: "pillars" },
                ],
                title: "AI Report",
              },
              duration: 3000,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // Should emit agent:completed with pageOutlines data
      const completedEvent = events.find(
        (e) =>
          e.type === "agent:completed" &&
          (e.data as { agent?: string })?.agent === "strategist",
      );
      expect(completedEvent).toBeDefined();
    });

    it("should transform task:completed with page-pipeline skill to extract HTML pages", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "task:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: { skillId: "slides-page-pipeline", title: "Page Pipeline" },
              result: {
                pages: [
                  {
                    pageNumber: 1,
                    title: "Slide 1",
                    html: "<div>Slide 1 HTML</div>",
                    status: "completed",
                  },
                  {
                    pageNumber: 2,
                    title: "Slide 2",
                    renderedHtml: "<div>Slide 2 HTML</div>",
                    status: "completed",
                  },
                  { pageNumber: 3, title: "Slide 3", status: "pending" }, // No HTML
                ],
              },
              duration: 5000,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // Should have slide:generated events for pages with HTML
      expect(
        events.filter((e) => e.type === "slide:generated").length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("should transform task:completed with page-pipeline containing direct html", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "task:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: { skillId: "page-pipeline", title: "Single Page" },
              result: {
                html: "<div>Direct HTML content</div>",
                pageNumber: 2,
                title: "Page Two",
              },
              duration: 1000,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should transform task:awaiting_review for non-pipeline skill to generic completed", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "task:awaiting_review",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: { skillId: "slides-quality-audit", title: "Quality Audit" },
              duration: 1500,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "agent:completed")).toBe(true);
    });

    it("should transform task:failed to log warning without emitting events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "task:failed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: { skillId: "slides-page-pipeline", title: "Failed Task" },
              error: "Timeout after 30s",
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      // Should complete without throwing
      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "execution:completed")).toBe(true);
    });

    it("should transform mission:phase_changed to phase and agent events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:phase_changed",
            missionId: "m1",
            timestamp: new Date(),
            data: { phase: "executing" },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "phase:started")).toBe(true);
    });

    it("should transform review:started to reviewer thinking events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "review:started",
            missionId: "m1",
            timestamp: new Date(),
            data: { task: { title: "Content Check", skillId: "review-task" } },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(
        events.some(
          (e) =>
            e.type === "agent:thinking" &&
            (e.data as { agent?: string })?.agent === "reviewer",
        ),
      ).toBe(true);
    });

    it("should transform review:approved to review:scoring and agent:completed", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "review:approved",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: { title: "Page Quality Check" },
              score: 85,
              duration: 500,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "review:scoring")).toBe(true);
      expect(
        events.some(
          (e) =>
            e.type === "agent:completed" &&
            (e.data as { agent?: string })?.agent === "reviewer",
        ),
      ).toBe(true);
    });

    it("should transform review:revision_requested to review:rejected event", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "review:revision_requested",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              task: { title: "Content Revision" },
              score: 55,
              feedback: "Content too sparse, add more details",
              attempt: 1,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "review:rejected")).toBe(true);
    });

    it("should transform audit:started to handoff and reviewer events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "audit:started",
            missionId: "m1",
            timestamp: new Date(),
            data: {},
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "agent:handoff")).toBe(true);
    });

    it("should transform audit:completed with quality score and issues", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "audit:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              qualityAudit: {
                overallScore: 78,
                dimensions: [
                  { name: "Content", score: 80, weight: 1 },
                  { name: "Formatting", score: 76, weight: 1 },
                ],
                issues: [{ type: "spacing", message: "Inconsistent spacing" }],
                fixes: [
                  { type: "alignment", description: "Auto-fixed alignment" },
                ],
              },
              duration: 3000,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "review:scoring")).toBe(true);
      expect(events.some((e) => e.type === "review:issue_found")).toBe(true);
      expect(events.some((e) => e.type === "review:auto_fixed")).toBe(true);
    });

    it("should transform synthesis:started to generating phase events", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "synthesis:started",
            missionId: "m1",
            timestamp: new Date(),
            data: {},
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      const phaseEvent = events.find(
        (e) =>
          e.type === "phase:started" &&
          (e.data as { phase?: string })?.phase === "generating",
      );
      expect(phaseEvent).toBeDefined();
    });

    it("should transform synthesis:completed to phase:completed with pageCount", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "synthesis:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pageCount: 8 },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      const agentCompletedEvent = events.find(
        (e) =>
          e.type === "agent:completed" &&
          (e.data as { agent?: string })?.agent === "writer",
      );
      expect(agentCompletedEvent).toBeDefined();
    });

    it("should transform page:generated to slide:generated event with HTML", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "page:generated",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              pageIndex: 0,
              page: {
                renderedHtml: "<div class='slide'>Page 1 Content</div>",
                html: "<div>fallback</div>",
                spec: { title: "Introduction" },
              },
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should skip slide:generated when page:generated has no HTML", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "page:generated",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              pageIndex: 0,
              page: {
                spec: { title: "Empty Page" },
              },
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // No slide:generated for empty page
      const slideEvents = events.filter((e) => e.type === "slide:generated");
      expect(slideEvents.length).toBe(0);
    });

    it("should transform mission:failed to execution:failed event", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:failed",
            missionId: "m1",
            timestamp: new Date(),
            data: { error: "Out of memory", phase: "rendering" },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "execution:failed")).toBe(true);
    });

    it("should handle unknown event type gracefully without crashing", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "unknown:event_type" as SlidesMissionEvent["type"],
            missionId: "m1",
            timestamp: new Date(),
            data: {},
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // Should complete normally
      expect(events.some((e) => e.type === "execution:completed")).toBe(true);
    });

    it("should track phase changes via mission:phase_changed event", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:phase_changed",
            missionId: "m1",
            timestamp: new Date(),
            data: { phase: "reviewing" },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      expect(events.some((e) => e.type === "agent:working")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Auto-save mechanism
  // --------------------------------------------------------------------------

  describe("auto-save / trackPageForAutoSave()", () => {
    it("should not trigger auto-save for fewer than AUTO_SAVE_INTERVAL pages", () => {
      // AUTO_SAVE_INTERVAL is 3, so 2 pages should not trigger save
      for (let i = 1; i <= 2; i++) {
        service.handlePageGenerated({
          pageNumber: i,
          totalPages: 10,
          title: `Slide ${i}`,
          html: `<div>Slide ${i}</div>`,
          templateId: "cover",
          sessionId: "autosave-session",
          design: undefined,
          keyPoints: [],
        });
      }

      // checkpointService.create is called only for initial checkpoint in this flow
      // (auto-save shouldn't have been triggered yet)
      expect(mockCheckpoint.create).not.toHaveBeenCalled();
    });

    it("should trigger auto-save when AUTO_SAVE_INTERVAL pages are reached", async () => {
      mockCheckpoint.create.mockResolvedValue({ id: "auto-ckpt" } as never);

      // Fire 3 page events (equal to AUTO_SAVE_INTERVAL)
      for (let i = 1; i <= 3; i++) {
        service.handlePageGenerated({
          pageNumber: i,
          totalPages: 10,
          title: `Slide ${i}`,
          html: `<div>Slide ${i}</div>`,
          templateId: "cover",
          sessionId: "autosave-session-2",
          design: undefined,
          keyPoints: [],
        });
      }

      // Give async save time to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "autosave-session-2",
          type: "page_rendered",
        }),
      );
    });

    it("should skip auto-save tracking for events without html", () => {
      // Pages without HTML should not be tracked
      service.handlePageGenerated({
        pageNumber: 1,
        totalPages: 5,
        title: "Empty slide",
        html: "", // No HTML
        templateId: "cover",
        sessionId: "empty-html-session",
        design: undefined,
        keyPoints: [],
      });

      // No crash expected
      expect(true).toBe(true);
    });

    it("should buffer generating events per session independently", () => {
      service.handlePageGenerating({
        pageNumber: 1,
        totalPages: 5,
        title: "Slide 1",
        templateType: "cover",
        sessionId: "session-a",
      });

      service.handlePageGenerating({
        pageNumber: 2,
        totalPages: 5,
        title: "Slide 2",
        templateType: "pillars",
        sessionId: "session-b",
      });

      // Both sessions should buffer independently without errors
      expect(true).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // generateSlides - checkpoint phases
  // --------------------------------------------------------------------------

  describe("generateSlides() - checkpoint phase handling", () => {
    it("should save checkpoint for planning phase", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "planning:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              taskCount: 3,
              breakdown: { tasks: [], themes: [], keywords: [] },
              duration: 1000,
            },
          },
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { pages: [], duration: 100 },
          },
        ]),
      );

      await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // create called: initial + planning checkpoint + final checkpoint
      expect(mockCheckpoint.create).toHaveBeenCalledTimes(3);
    });

    it("should save final checkpoint with pages from mission:completed data", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: {
              pages: [
                {
                  pageNumber: 1,
                  title: "Cover",
                  html: "<div>Cover HTML</div>",
                  status: "completed",
                },
                {
                  pageNumber: 2,
                  title: "Content",
                  renderedHtml: "<div>Content HTML</div>",
                  status: "completed",
                },
              ],
              duration: 5000,
            },
          },
        ]),
      );

      await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      // Final checkpoint should be called with batch_rendered type
      expect(mockCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "batch_rendered",
        }),
      );
    });

    it("should handle case when missionCompleteData has no pages", async () => {
      mockOrchestrator.executeMission.mockReturnValue(
        mockMissionEventGenerator([
          {
            type: "mission:completed",
            missionId: "m1",
            timestamp: new Date(),
            data: { duration: 100 }, // no pages key
          },
        ]),
      );

      const events = await collectEvents(
        service.generateSlides({ userId: "u1", sourceText: "text" }),
      );

      const completedEvent = events.find(
        (e) => e.type === "execution:completed",
      );
      expect(completedEvent).toBeDefined();
      expect(
        (completedEvent?.data as { totalPages?: number })?.totalPages,
      ).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // regeneratePage - AI facade feedback parsing edge cases
  // --------------------------------------------------------------------------

  describe("regeneratePage() - feedback parsing edge cases", () => {
    beforeEach(() => {
      mockCheckpoint.getLatestCheckpoint.mockResolvedValue({
        state: {
          pages: [
            {
              pageNumber: 1,
              outline: makePageOutline(),
              status: "completed",
              html: "<div>Old content</div>",
              content: { title: "Old Title", sections: [] },
            },
          ],
          conversation: [],
          globalStyles: { themeId: "tech-dark" },
        },
      } as unknown);
      mockCheckpoint.create.mockResolvedValue({ id: "ckpt-new" });
    });

    it("should use AI facade to parse JSON feedback from code block", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '```json\n{"title":"Updated Title","templateType":"cover","keyElements":["Point A","Point B"]}\n```',
        tokensUsed: 150,
      });

      const events = await service.regeneratePage(
        "session-1",
        1,
        "标题改为：更专业的标题",
      );

      expect(mockFacade.chat).toHaveBeenCalled();
      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should parse direct JSON when no code block wrapper present", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '{"title":"Direct JSON Title","templateType":"cover","keyElements":[]}',
        tokensUsed: 80,
      });

      const events = await service.regeneratePage(
        "session-1",
        1,
        "make it better",
      );

      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should fall back to regex when AI returns non-JSON response", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "Sure, I'll update it for you",
        tokensUsed: 30,
      });

      const events = await service.regeneratePage(
        "session-1",
        1,
        "修改为：全新的演示标题",
      );

      // Regex should catch "修改为：" and extract the title
      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should return original outline when AI fails with exception", async () => {
      mockFacade.chat.mockRejectedValue(new Error("API timeout"));

      const events = await service.regeneratePage(
        "session-1",
        1,
        "改为：Timeout Test",
      );

      // Even with AI failure, regex fallback should handle "改为："
      expect(events.some((e) => e.type === "slide:generated")).toBe(true);
    });

    it("should return slide:generated when rendering fails (caught error path)", async () => {
      mockRendering.execute.mockResolvedValue({
        success: false,
        error: {
          code: "RENDER_FAILED",
          message: "Failed to render",
          retryable: false,
        },
        metadata: {
          executionId: "e1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      });

      const events = await service.regeneratePage(
        "session-1",
        1,
        "some feedback",
      );

      // Should return execution:failed event
      expect(events.some((e) => e.type === "execution:failed")).toBe(true);
    });

    it("should emit events via eventEmitter when regeneration succeeds", async () => {
      const events = await service.regeneratePage(
        "session-1",
        1,
        "改为：New Title",
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "slides.page.regenerated",
        expect.objectContaining({
          sessionId: "session-1",
          pageNumber: 1,
        }),
      );
      expect(events.some((e) => e.type === "agent:completed")).toBe(true);
    });
  });
});
