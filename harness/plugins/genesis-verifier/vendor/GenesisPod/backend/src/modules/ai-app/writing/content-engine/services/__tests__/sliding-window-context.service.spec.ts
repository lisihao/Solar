/**
 * SlidingWindowContextService Tests
 *
 * Covers:
 * 1. Project context initialization
 * 2. buildWorkingMemory construction
 * 3. slideWindow eviction behavior
 * 4. retrieveRelevantHistory keyword matching
 * 5. getAllCompletedTaskContents
 * 6. clearProject cleanup
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SlidingWindowContextService } from "../sliding-window-context.service";
import { AiChatService } from "@/modules/ai-harness/facade";
import { DEFAULT_SLIDING_WINDOW_CONFIG } from "../../interfaces";

const mockAiChatService = {
  chat: jest
    .fn()
    .mockResolvedValue({ content: "AI generated summary", tokensUsed: 30 }),
};

describe("SlidingWindowContextService", () => {
  let service: SlidingWindowContextService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidingWindowContextService,
        { provide: AiChatService, useValue: mockAiChatService },
      ],
    }).compile();

    service = module.get<SlidingWindowContextService>(
      SlidingWindowContextService,
    );
  });

  // ============================================================
  // initProject
  // ============================================================

  describe("initProject", () => {
    it("should initialize a project context store", () => {
      const store = service.initProject("p1", {
        title: "My Project",
        description: "A test project",
        totalTasks: 10,
      });
      expect(store.projectId).toBe("p1");
      expect(store.completedTaskCount).toBe(0);
      expect(store.totalWordCount).toBe(0);
      expect(store.recentSummaries).toHaveLength(0);
      expect(store.globalSummary).toContain("My Project");
    });

    it("should embed description in initial global summary", () => {
      const store = service.initProject("p2", {
        title: "Proj",
        description: "Special description text",
      });
      expect(store.globalSummary).toContain("Special description text");
    });

    it("should show totalTasks in global summary when provided", () => {
      const store = service.initProject("p3", {
        title: "P",
        description: "D",
        totalTasks: 42,
      });
      expect(store.globalSummary).toContain("42");
    });
  });

  // ============================================================
  // buildWorkingMemory
  // ============================================================

  describe("buildWorkingMemory", () => {
    beforeEach(() => {
      service.initProject("p1", {
        title: "Test Project",
        description: "A project for testing",
        totalTasks: 5,
      });
    });

    it("should throw for unknown project", async () => {
      await expect(
        service.buildWorkingMemory("unknown", "t1", "content"),
      ).rejects.toThrow("Project not found");
    });

    it("should return a WorkingMemoryContext with correct projectId and taskId", async () => {
      const ctx = await service.buildWorkingMemory("p1", "t1", "task content");
      expect(ctx.projectId).toBe("p1");
      expect(ctx.currentTaskId).toBe("t1");
      expect(ctx.globalSummary).toBeTruthy();
      expect(ctx.builtAt).toBeInstanceOf(Date);
    });

    it("should include currentTaskContent (possibly truncated)", async () => {
      const longContent = "x".repeat(5000);
      const ctx = await service.buildWorkingMemory("p1", "t1", longContent);
      expect(ctx.currentTaskContent.length).toBeLessThanOrEqual(
        longContent.length,
      );
    });

    it("should return empty relevantHistory when no query provided", async () => {
      const ctx = await service.buildWorkingMemory("p1", "t1", "content");
      expect(ctx.relevantHistory).toHaveLength(0);
    });

    it("should compute token usage", async () => {
      const ctx = await service.buildWorkingMemory(
        "p1",
        "t1",
        "some content here",
      );
      expect(ctx.tokenUsage.total).toBeGreaterThan(0);
      expect(ctx.tokenUsage.utilizationRate).toBeGreaterThan(0);
    });

    it("should include recent summaries after tasks complete", async () => {
      await service.slideWindow("p1", {
        id: "t0",
        title: "Task 0",
        result: "short content.",
        summary: "Summary of task 0",
      });
      const ctx = await service.buildWorkingMemory("p1", "t1", "content");
      expect(ctx.recentTaskSummaries.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // slideWindow
  // ============================================================

  describe("slideWindow", () => {
    beforeEach(() => {
      service.initProject("p1", {
        title: "Novel",
        description: "Writing a novel",
        totalTasks: 20,
      });
    });

    it("should throw for unknown project", async () => {
      await expect(
        service.slideWindow("unknown", {
          id: "t1",
          title: "T1",
          result: "content",
        }),
      ).rejects.toThrow("Project not found");
    });

    it("should increment completedTaskCount", async () => {
      await service.slideWindow("p1", {
        id: "t1",
        title: "Task 1",
        result: "done.",
      });
      const ctx = await service.buildWorkingMemory("p1", "current", "c");
      expect(ctx.recentTaskSummaries.length).toBeGreaterThan(0);
    });

    it("should use provided summary instead of generating one", async () => {
      const result = await service.slideWindow("p1", {
        id: "t1",
        title: "Task 1",
        result: "x".repeat(300),
        summary: "Custom summary",
      });
      expect(result.success).toBe(true);
      // AI should not have been called for summary generation
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should generate AI summary for long content when no summary provided", async () => {
      await service.slideWindow("p1", {
        id: "t1",
        title: "Task 1",
        result: "a".repeat(500),
      });
      expect(mockAiChatService.chat).toHaveBeenCalledTimes(1);
    });

    it("should evict oldest summaries when exceeding recentTaskCount", async () => {
      const config = { ...DEFAULT_SLIDING_WINDOW_CONFIG, recentTaskCount: 3 };

      for (let i = 0; i < 5; i++) {
        await service.slideWindow(
          "p1",
          {
            id: `t${i}`,
            title: `Task ${i}`,
            result: "done.",
            summary: `S${i}`,
          },
          config,
        );
      }

      const result = await service.slideWindow(
        "p1",
        { id: "t5", title: "Task 5", result: "done.", summary: "S5" },
        config,
      );

      expect(result.evictedSummaries.length).toBeGreaterThan(0);
    });

    it("should return windowState with correct counts", async () => {
      const result = await service.slideWindow("p1", {
        id: "t1",
        title: "Task 1",
        result: "done.",
        summary: "S1",
      });
      expect(result.windowState.totalCompletedTasks).toBe(1);
      expect(result.windowState.recentSummaryCount).toBe(1);
    });
  });

  // ============================================================
  // retrieveRelevantHistory
  // ============================================================

  describe("retrieveRelevantHistory", () => {
    beforeEach(async () => {
      service.initProject("p1", {
        title: "Research",
        description: "Research project",
        totalTasks: 10,
      });
      // Slide one task that contains distinctive keywords
      await service.slideWindow("p1", {
        id: "t1",
        title: "Machine Learning Overview",
        result:
          "Machine learning is a type of artificial intelligence that allows computer systems to learn.",
        summary: "Machine learning introduction",
      });
    });

    it("should return empty array for unknown project", async () => {
      const results = await service.retrieveRelevantHistory("unknown", "query");
      expect(results).toHaveLength(0);
    });

    it("should return empty array when query has no keyword matches", async () => {
      const results = await service.retrieveRelevantHistory(
        "p1",
        "cooking recipes",
      );
      expect(results).toHaveLength(0);
    });

    it("should return matches limited by maxChunks", async () => {
      // Add more tasks so we can test limiting
      for (let i = 2; i <= 5; i++) {
        await service.slideWindow("p1", {
          id: `t${i}`,
          title: `Machine Task ${i}`,
          result:
            "Machine learning machine systems learn data neural networks.",
          summary: `Summary ${i}`,
        });
      }
      const results = await service.retrieveRelevantHistory(
        "p1",
        "Machine learning",
        { maxChunks: 2 },
      );
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================
  // getFullTaskContent
  // ============================================================

  describe("getFullTaskContent", () => {
    beforeEach(async () => {
      service.initProject("p1", { title: "P", description: "D" });
      await service.slideWindow("p1", {
        id: "t1",
        title: "Task 1",
        result: "Full task content here.",
        summary: "Summary",
      });
    });

    it("should return full content for a known taskId", () => {
      const content = service.getFullTaskContent("t1");
      expect(content).toBe("Full task content here.");
    });

    it("should return null for unknown taskId", () => {
      expect(service.getFullTaskContent("nonexistent")).toBeNull();
    });
  });

  // ============================================================
  // getAllCompletedTaskContents
  // ============================================================

  describe("getAllCompletedTaskContents", () => {
    beforeEach(async () => {
      service.initProject("p1", { title: "P", description: "D" });
      await service.slideWindow("p1", {
        id: "t1",
        title: "Task 1",
        result: "Content 1.",
        summary: "S1",
      });
      await service.slideWindow("p1", {
        id: "t2",
        title: "Task 2",
        result: "Content 2.",
        summary: "S2",
      });
    });

    it("should return empty array for unknown project", () => {
      expect(service.getAllCompletedTaskContents("unknown")).toHaveLength(0);
    });

    it("should return all completed task contents", () => {
      const contents = service.getAllCompletedTaskContents("p1");
      expect(contents.length).toBe(2);
      const ids = contents.map((c) => c.taskId);
      expect(ids).toContain("t1");
      expect(ids).toContain("t2");
    });

    it("should include taskId, title, and content for each task", () => {
      const contents = service.getAllCompletedTaskContents("p1");
      const t1 = contents.find((c) => c.taskId === "t1");
      expect(t1?.title).toBe("Task 1");
      expect(t1?.content).toBe("Content 1.");
    });
  });

  // ============================================================
  // clearProject
  // ============================================================

  describe("clearProject", () => {
    it("should remove project context", async () => {
      service.initProject("p1", { title: "P", description: "D" });
      await service.slideWindow("p1", {
        id: "t1",
        title: "T",
        result: "content.",
        summary: "S",
      });
      service.clearProject("p1");

      await expect(service.buildWorkingMemory("p1", "t2", "x")).rejects.toThrow(
        "Project not found",
      );
    });

    it("should also clean up associated task content", async () => {
      service.initProject("p1", { title: "P", description: "D" });
      await service.slideWindow("p1", {
        id: "t1",
        title: "T",
        result: "content.",
        summary: "S",
      });
      service.clearProject("p1");

      // Task content should be gone too
      expect(service.getFullTaskContent("t1")).toBeNull();
    });

    it("should not throw for unknown project", () => {
      expect(() => service.clearProject("unknown")).not.toThrow();
    });
  });

  // ============================================================
  // updateGlobalSummary
  // ============================================================

  describe("updateGlobalSummary", () => {
    it("should call AI to generate a new summary", async () => {
      service.initProject("p1", {
        title: "Novel",
        description: "A novel project",
      });
      await service.slideWindow("p1", {
        id: "t1",
        title: "Chapter 1",
        result: "Long content...",
        summary: "S1",
      });
      const summary = await service.updateGlobalSummary("p1");
      expect(summary).toBe("AI generated summary");
      expect(mockAiChatService.chat).toHaveBeenCalledTimes(1);
    });

    it("should return current summary on AI failure", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(new Error("API fail"));
      service.initProject("p1", { title: "P", description: "D" });
      const summary = await service.updateGlobalSummary("p1");
      expect(typeof summary).toBe("string");
      expect(summary.length).toBeGreaterThan(0);
    });

    it("should throw for unknown project", async () => {
      await expect(service.updateGlobalSummary("unknown")).rejects.toThrow(
        "Project not found",
      );
    });
  });
});
