import { AgentHandoffTool, AgentHandoffInput } from "../agent-handoff.tool";
import { ToolContext } from "../../../abstractions/tool.interface";
import { AIModelType } from "@prisma/client";

const BUILTIN_AGENTS = {
  DOCS: "docs",
  DESIGNER: "designer",
  RESEARCHER: "researcher",
} as const;

// ============================================================================
// Mock factory
// ============================================================================

type ChatOptions = {
  messages: Array<{ role: string; content: string }>;
  modelType: AIModelType;
  taskProfile?: { creativity?: string; outputLength?: string };
};

const mockAiChatService = {
  chat: jest.fn() as jest.MockedFunction<
    (options: ChatOptions) => Promise<{
      content: string;
      usage?: { totalTokens: number };
      model: string;
    }>
  >,
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "agent-handoff",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("AgentHandoffTool", () => {
  let tool: AgentHandoffTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new AgentHandoffTool(mockAiChatService as never);
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid input with a builtin targetAgent and prompt", () => {
      expect(
        tool.validateInput({
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research the latest AI trends" },
        }),
      ).toBe(true);
    });

    it("should allow a non-builtin targetAgent when task prompt is valid", () => {
      expect(
        tool.validateInput({
          targetAgent: "invalid-agent-xyz",
          task: { prompt: "Do something" },
        }),
      ).toBe(true);
    });

    it("should return false when task prompt is empty string", () => {
      expect(
        tool.validateInput({
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "" },
        }),
      ).toBe(false);
    });

    it("should return false when task prompt is whitespace only", () => {
      expect(
        tool.validateInput({
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "   " },
        }),
      ).toBe(false);
    });

    it("should return false when task is missing prompt field entirely", () => {
      expect(
        tool.validateInput({
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: {} as AgentHandoffInput["task"],
        }),
      ).toBe(false);
    });

    it("should return true for a valid fallbackAgent", () => {
      expect(
        tool.validateInput({
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Do research" },
          options: { fallbackAgent: BUILTIN_AGENTS.DOCS },
        }),
      ).toBe(true);
    });

    it("should allow a non-builtin fallbackAgent when task prompt is valid", () => {
      expect(
        tool.validateInput({
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Do research" },
          options: { fallbackAgent: "not-a-real-agent" },
        }),
      ).toBe(true);
    });

    it("should return true when all builtin agents are used as targetAgent", () => {
      for (const agentId of Object.values(BUILTIN_AGENTS)) {
        expect(
          tool.validateInput({
            targetAgent: agentId,
            task: { prompt: "Test task" },
          }),
        ).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Async mode (waitForResult = false)
  // --------------------------------------------------------------------------

  describe("async mode (waitForResult=false)", () => {
    it("should return success:true, status:delegated, and a handoffId without calling aiChatService", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Investigate quantum computing" },
          options: { waitForResult: false },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("delegated");
      expect(result.data?.handoffId).toBeTruthy();
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should return the correct targetAgent in async mode", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.DESIGNER,
          task: { prompt: "Design a poster" },
          options: { waitForResult: false },
        },
        context,
      );

      expect(result.data?.targetAgent).toBe(BUILTIN_AGENTS.DESIGNER);
    });

    it("should include metadata.handoffAt in async mode", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research topic" },
          options: { waitForResult: false },
        },
        context,
      );

      expect(result.data?.metadata?.handoffAt).toBeInstanceOf(Date);
    });

    it("should default to async mode when options are omitted", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.DOCS,
          task: { prompt: "Write a document" },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("delegated");
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Sync mode (waitForResult = true)
  // --------------------------------------------------------------------------

  describe("sync mode (waitForResult=true)", () => {
    it("should call aiChatService.chat and return status:completed with result", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Research findings: AI is advancing rapidly.",
        usage: { totalTokens: 120 },
        model: "gpt-4o",
      });

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research the latest AI trends" },
          options: { waitForResult: true },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("completed");
      expect(result.data?.result).toBeDefined();
      expect(mockAiChatService.chat).toHaveBeenCalledTimes(1);
    });

    it("should include metadata.completedAt in sync mode on success", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Done.",
        model: "gpt-4o",
      });

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Analyse trends" },
          options: { waitForResult: true },
        },
        context,
      );

      expect(result.data?.metadata?.completedAt).toBeInstanceOf(Date);
    });

    it("should include a non-empty handoffId in sync mode", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Result content",
        model: "gpt-4o",
      });

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.DOCS,
          task: { prompt: "Write docs" },
          options: { waitForResult: true },
        },
        context,
      );

      expect(typeof result.data?.handoffId).toBe("string");
      expect(result.data?.handoffId!.length).toBeGreaterThan(0);
    });

    it("should append context to user prompt when task.context is provided", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Contextual result",
        model: "gpt-4o",
      });

      const taskContext = { theme: "dark", language: "en" };

      await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: {
            prompt: "Research with context",
            context: taskContext,
          },
          options: { waitForResult: true },
        },
        context,
      );

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: { role: string; content: string }) => m.role === "user",
      );
      expect(userMessage?.content).toContain("Research with context");
      expect(userMessage?.content).toContain(
        JSON.stringify(taskContext, null, 2),
      );
    });

    it("should map priority:high to creativity:high in taskProfile", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Creative result",
        model: "gpt-4o",
      });

      await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.DESIGNER,
          task: { prompt: "Design something creative", priority: "high" },
          options: { waitForResult: true },
        },
        context,
      );

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.taskProfile?.creativity).toBe("high");
    });

    it("should map priority:normal to creativity:medium in taskProfile", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Standard result",
        model: "gpt-4o",
      });

      await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Standard research task", priority: "normal" },
          options: { waitForResult: true },
        },
        context,
      );

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.taskProfile?.creativity).toBe("medium");
    });

    it("should map priority:low to creativity:medium in taskProfile", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Low priority result",
        model: "gpt-4o",
      });

      await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Low priority task", priority: "low" },
          options: { waitForResult: true },
        },
        context,
      );

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.taskProfile?.creativity).toBe("medium");
    });
  });

  // --------------------------------------------------------------------------
  // Fallback agent
  // --------------------------------------------------------------------------

  describe("fallback agent", () => {
    it("should use fallbackAgent when primary agent throws, returning usedFallback:true", async () => {
      const context = createMockContext();
      // First call (primary agent) fails
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("Primary agent unavailable"),
      );
      // Second call (fallback agent) succeeds
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Fallback result",
        model: "gpt-4o",
      });

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research something" },
          options: {
            waitForResult: true,
            fallbackAgent: BUILTIN_AGENTS.DOCS,
          },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("completed");
      expect(result.data?.metadata?.usedFallback).toBe(true);
      expect(mockAiChatService.chat).toHaveBeenCalledTimes(2);
    });

    it("should return the fallbackAgent's ID in targetAgent field when fallback is used", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockRejectedValueOnce(new Error("Primary failed"));
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Fallback output",
        model: "gpt-4o",
      });

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research task" },
          options: {
            waitForResult: true,
            fallbackAgent: BUILTIN_AGENTS.DESIGNER,
          },
        },
        context,
      );

      expect(result.data?.targetAgent).toBe(BUILTIN_AGENTS.DESIGNER);
    });

    it("should return success:false, status:failed when both primary and fallback fail", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockRejectedValueOnce(new Error("Primary failed"));
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("Fallback also failed"),
      );

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research task" },
          options: {
            waitForResult: true,
            fallbackAgent: BUILTIN_AGENTS.DOCS,
          },
        },
        context,
      );

      expect(result.success).toBe(true); // outer ToolResult.success
      expect(result.data?.success).toBe(false);
      expect(result.data?.status).toBe("failed");
      expect(result.data?.error).toBeTruthy();
      expect(mockAiChatService.chat).toHaveBeenCalledTimes(2);
    });

    it("should return success:false, status:failed when primary fails and no fallback is configured", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("Primary agent error"),
      );

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Research task" },
          options: { waitForResult: true },
        },
        context,
      );

      expect(result.success).toBe(true); // outer ToolResult.success
      expect(result.data?.success).toBe(false);
      expect(result.data?.status).toBe("failed");
      expect(result.data?.error).toContain("Primary agent error");
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("metadata", () => {
    it("should always include metadata.handoffAt in both async and sync mode", async () => {
      const context = createMockContext();

      // Async
      const asyncResult = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Async task" },
          options: { waitForResult: false },
        },
        context,
      );
      expect(asyncResult.data?.metadata?.handoffAt).toBeInstanceOf(Date);

      // Sync
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Result",
        model: "gpt-4o",
      });
      const syncResult = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Sync task" },
          options: { waitForResult: true },
        },
        context,
      );
      expect(syncResult.data?.metadata?.handoffAt).toBeInstanceOf(Date);
    });

    it("should NOT include metadata.completedAt in async mode", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Async task" },
          options: { waitForResult: false },
        },
        context,
      );

      expect(result.data?.metadata?.completedAt).toBeUndefined();
    });

    it("should NOT include metadata.usedFallback when primary succeeds", async () => {
      const context = createMockContext();
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Primary succeeded",
        model: "gpt-4o",
      });

      const result = await tool.execute(
        {
          targetAgent: BUILTIN_AGENTS.RESEARCHER,
          task: { prompt: "Task with fallback configured but not needed" },
          options: {
            waitForResult: true,
            fallbackAgent: BUILTIN_AGENTS.DOCS,
          },
        },
        context,
      );

      expect(result.data?.metadata?.usedFallback).toBeUndefined();
    });
  });
});
