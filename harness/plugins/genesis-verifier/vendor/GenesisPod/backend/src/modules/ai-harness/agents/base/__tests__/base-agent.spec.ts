/**
 * Tests for BaseAgent
 * Uses a concrete subclass to exercise abstract class logic.
 */

import { Logger } from "@nestjs/common";
import { BaseAgent } from "../base-agent";
import {
  AgentContext,
  AgentInput,
  AgentOutput,
  AgentCapability,
} from "../../abstractions/agent.interface";
import { ExecutionMode } from "@/modules/ai-engine/facade/index";
import { ToolRegistry } from "../../../tools/registry";
import { SkillRegistry } from "../../../skills/registry";
import { ToolPipeline } from "../../../tools/middleware/tool-pipeline";
import {
  ILLMAdapter,
  LLMResponse,
  LLMToolDefinition,
} from "../../../llm/abstractions";

// ---------------------------------------------------------------------------
// Concrete test double
// ---------------------------------------------------------------------------

class TestAgent extends BaseAgent<AgentInput, AgentOutput> {
  readonly id = "test-agent";
  readonly name = "Test Agent";
  readonly description = "Agent used in unit tests";
  readonly supportedModes: ExecutionMode[] = ["reactive", "plan-based"];
  readonly capabilities: AgentCapability[] = [
    { id: "cap-1", name: "Cap 1", description: "desc", category: "test" },
  ];

  // allow injection of custom doExecute behaviour
  doExecuteImpl: (
    input: AgentInput,
    context: AgentContext,
  ) => Promise<AgentOutput> = async (_input, _context) => ({ message: "ok" });

  protected async doExecute(
    input: AgentInput,
    context: AgentContext,
  ): Promise<AgentOutput> {
    return this.doExecuteImpl(input, context);
  }

  // Expose protected helpers for testing
  public exposedCallTool<T>(
    toolId: string,
    toolInput: unknown,
    ctx: AgentContext,
  ) {
    return this.callTool<T>(toolId, toolInput, ctx);
  }

  public exposedCallSkill<TIn, TOut>(
    skillId: string,
    input: TIn,
    ctx: AgentContext,
  ) {
    return this.callSkill<TIn, TOut>(skillId, input, ctx);
  }

  public exposedCallLLM(
    messages: Parameters<BaseAgent["callLLM"]>[0],
    options?: Parameters<BaseAgent["callLLM"]>[1],
  ) {
    return this.callLLM(messages, options);
  }

  public exposedBuildMessages(userMessage: string, ctx: AgentContext) {
    return this.buildMessages(userMessage, ctx);
  }

  public exposedParseJsonResponse<T>(content: string, fallback?: T) {
    return this.parseJsonResponse<T>(content, fallback);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    executionId: "exec-1",
    agentId: "test-agent",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeInput(prompt = "hello"): AgentInput {
  return { prompt };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BaseAgent", () => {
  let agent: TestAgent;

  beforeEach(() => {
    // Suppress Logger output in tests
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    agent = new TestAgent();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor / property defaults
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("should initialise default version to 1.0.0", () => {
      expect(agent.version).toBe("1.0.0");
    });

    it("should start with zero stats", () => {
      expect(agent.getStats()).toEqual({
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        totalTokensUsed: 0,
        toolsCalled: [],
        skillsCalled: [],
      });
    });
  });

  // -------------------------------------------------------------------------
  // setToolRegistry / setSkillRegistry / setLLMAdapter / setSystemPrompt
  // -------------------------------------------------------------------------

  describe("setters", () => {
    it("setToolRegistry stores the registry", () => {
      const registry = {} as ToolRegistry;
      agent.setToolRegistry(registry);
      expect(
        (agent as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
      ).toBe(registry);
    });

    it("setSkillRegistry stores the registry", () => {
      const registry = {} as SkillRegistry;
      agent.setSkillRegistry(registry);
      expect(
        (agent as unknown as { skillRegistry: SkillRegistry }).skillRegistry,
      ).toBe(registry);
    });

    it("setLLMAdapter stores the adapter", () => {
      const adapter = {} as ILLMAdapter;
      agent.setLLMAdapter(adapter);
      expect((agent as unknown as { llmAdapter: ILLMAdapter }).llmAdapter).toBe(
        adapter,
      );
    });

    it("setSystemPrompt stores the prompt", () => {
      agent.setSystemPrompt("You are helpful.");
      expect((agent as unknown as { systemPrompt: string }).systemPrompt).toBe(
        "You are helpful.",
      );
    });
  });

  // -------------------------------------------------------------------------
  // execute – success path
  // -------------------------------------------------------------------------

  describe("execute (success)", () => {
    it("returns success result with data", async () => {
      const result = await agent.execute(makeInput(), makeContext());

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: "ok" });
      expect(result.metadata.executionId).toBe("exec-1");
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("increments successCount stat", async () => {
      await agent.execute(makeInput(), makeContext());
      expect(agent.getStats().successCount).toBe(1);
      expect(agent.getStats().totalExecutions).toBe(1);
    });

    it("uses uuid when executionId is absent from context", async () => {
      const ctx = makeContext({ executionId: undefined as unknown as string });
      const result = await agent.execute(makeInput(), ctx);
      expect(result.metadata.executionId).toBeTruthy();
    });

    it("includes toolsCalled and skillsCalled arrays in metadata", async () => {
      const result = await agent.execute(makeInput(), makeContext());
      expect(Array.isArray(result.metadata.toolsCalled)).toBe(true);
      expect(Array.isArray(result.metadata.skillsCalled)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute – cancellation
  // -------------------------------------------------------------------------

  describe("execute – cancellation", () => {
    it("returns failure result when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = makeContext({ signal: controller.signal });

      const result = await agent.execute(makeInput(), ctx);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cancelled");
      expect(agent.getStats().failureCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // execute – mode validation
  // -------------------------------------------------------------------------

  describe("execute – mode validation", () => {
    it("returns failure when unsupported mode is requested", async () => {
      const ctx = makeContext({ mode: "direct" as ExecutionMode });
      // 'direct' is not in supportedModes of TestAgent
      const result = await agent.execute(makeInput(), ctx);
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/invalid execution mode/i);
    });

    it("succeeds for a supported mode", async () => {
      const ctx = makeContext({ mode: "reactive" });
      const result = await agent.execute(makeInput(), ctx);
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute – doExecute throws
  // -------------------------------------------------------------------------

  describe("execute – error path", () => {
    it("returns failure result when doExecute throws", async () => {
      agent.doExecuteImpl = async () => {
        throw new Error("something went wrong");
      };

      const result = await agent.execute(makeInput(), makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("something went wrong");
      expect(agent.getStats().failureCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // executeStream
  // -------------------------------------------------------------------------

  describe("executeStream", () => {
    it("yields started then completed events on success", async () => {
      const gen = agent.executeStream(makeInput(), makeContext());
      const events: unknown[] = [];

      for await (const event of gen) {
        events.push(event);
      }

      const types = (events as Array<{ type: string }>).map((e) => e.type);
      expect(types).toContain("started");
      expect(types).toContain("completed");
    });

    it("yields completed event (containing failure result) when doExecute throws", async () => {
      // BaseAgent.executeStream wraps execute() internally: even on error it emits
      // a 'completed' event carrying the failed AgentResult. The 'error' event path
      // is triggered only when execute() itself throws, which the default implementation
      // never does (it catches internally and returns success:false).
      agent.doExecuteImpl = async () => {
        throw new Error("stream error");
      };

      const gen = agent.executeStream(makeInput(), makeContext());
      const events: Array<{ type: string; data?: unknown }> = [];

      for await (const event of gen) {
        events.push(event as { type: string; data?: unknown });
      }

      const types = events.map((e) => e.type);
      // The default executeStream implementation yields 'started' and 'completed'.
      // The completed event carries a failed AgentResult.
      expect(types).toContain("started");
      expect(types).toContain("completed");

      const completedEvent = events.find((e) => e.type === "completed") as
        | { type: string; data: { success: boolean } }
        | undefined;
      expect(completedEvent?.data).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // plan
  // -------------------------------------------------------------------------

  describe("plan", () => {
    it("returns an empty execution plan by default", async () => {
      const plan = await agent.plan(makeInput(), makeContext());
      expect(plan.agentId).toBe("test-agent");
      expect(plan.steps).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // callTool
  // -------------------------------------------------------------------------

  describe("callTool", () => {
    it("throws when toolRegistry is not set", async () => {
      await expect(
        agent.exposedCallTool("web-search", {}, makeContext()),
      ).rejects.toThrow(/missing/i);
    });

    it("throws when tool is not registered in the registry", async () => {
      const registry = {
        tryGet: jest.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      await expect(
        agent.exposedCallTool("unknown-tool", {}, makeContext()),
      ).rejects.toThrow(/missing/i);
    });

    it("calls tool.execute and returns its result", async () => {
      const toolResult = { success: true, data: { answer: 42 } };
      const tool = { execute: jest.fn().mockResolvedValue(toolResult) };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      const result = await agent.exposedCallTool<{ answer: number }>(
        "my-tool",
        { q: "test" },
        makeContext(),
      );

      expect(result).toEqual(toolResult);
      expect(tool.execute).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // callTool with ToolPipeline
  // -------------------------------------------------------------------------

  describe("callTool with ToolPipeline", () => {
    it("routes callTool through pipeline.execute when pipeline is set", async () => {
      const toolResult = {
        success: true as const,
        data: { answer: 42 },
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };
      const tool = { execute: jest.fn().mockResolvedValue(toolResult) };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      const mockPipeline = {
        execute: jest.fn().mockResolvedValue(toolResult),
      } as unknown as ToolPipeline;
      agent.setToolPipeline(mockPipeline);

      const result = await agent.exposedCallTool<{ answer: number }>(
        "my-tool",
        { q: "test" },
        makeContext(),
      );

      expect(mockPipeline.execute).toHaveBeenCalledTimes(1);
      expect(tool.execute).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      // tool was called via pipeline → toolsCalled should include the id
      expect(agent.getStats().toolsCalled).toContain("my-tool");
    });

    it("falls back to tool.execute when no pipeline is set", async () => {
      const toolResult = {
        success: true as const,
        data: "direct",
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };
      const tool = { execute: jest.fn().mockResolvedValue(toolResult) };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);
      // do NOT set pipeline

      const result = await agent.exposedCallTool("my-tool", {}, makeContext());

      expect(tool.execute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it("returns failure result from pipeline without throwing, and does not push to toolsCalled", async () => {
      const failResult = {
        success: false as const,
        error: { code: "TOOL_ERR", message: "pipeline error" },
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };
      const tool = { execute: jest.fn() };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      const mockPipeline = {
        execute: jest.fn().mockResolvedValue(failResult),
      } as unknown as ToolPipeline;
      agent.setToolPipeline(mockPipeline);

      const result = await agent.exposedCallTool("my-tool", {}, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("pipeline error");
      expect(agent.getStats().toolsCalled).not.toContain("my-tool");
    });
  });

  // -------------------------------------------------------------------------
  // callSkill
  // -------------------------------------------------------------------------

  describe("callSkill", () => {
    it("throws when skillRegistry is not set", async () => {
      await expect(
        agent.exposedCallSkill("my-skill", {}, makeContext()),
      ).rejects.toThrow(/missing/i);
    });

    it("throws when skill is not found in registry", async () => {
      const registry = {
        tryGet: jest.fn().mockReturnValue(undefined),
      } as unknown as SkillRegistry;
      agent.setSkillRegistry(registry);

      await expect(
        agent.exposedCallSkill("unknown-skill", {}, makeContext()),
      ).rejects.toThrow(/missing/i);
    });

    it("calls skill.execute and returns its result", async () => {
      const skillResult = { success: true, data: "done" };
      const skill = { execute: jest.fn().mockResolvedValue(skillResult) };
      const registry = {
        tryGet: jest.fn().mockReturnValue(skill),
      } as unknown as SkillRegistry;
      agent.setSkillRegistry(registry);

      const result = await agent.exposedCallSkill<unknown, string>(
        "my-skill",
        { input: "x" },
        makeContext(),
      );
      expect(result).toEqual(skillResult);
    });
  });

  // -------------------------------------------------------------------------
  // callLLM
  // -------------------------------------------------------------------------

  describe("callLLM", () => {
    it("throws AgentError when llmAdapter is not set", async () => {
      await expect(
        agent.exposedCallLLM([{ role: "user", content: "hi" }]),
      ).rejects.toThrow(/LLM adapter not set/i);
    });

    it("calls adapter.chat and returns response", async () => {
      const mockResponse: LLMResponse = {
        id: "resp-1",
        content: "Hello!",
        finishReason: "stop",
        model: "gpt-4o",
        createdAt: new Date(),
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      };
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(mockResponse),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const response = await agent.exposedCallLLM([
        { role: "user", content: "hi" },
      ]);

      expect(response.content).toBe("Hello!");
      expect(agent.getStats().totalTokensUsed).toBe(10);
    });

    it("accumulates token usage across multiple LLM calls", async () => {
      const mockResponse: LLMResponse = {
        id: "resp-2",
        content: "hi",
        finishReason: "stop",
        model: "gpt-4o",
        createdAt: new Date(),
        usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 },
      };
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(mockResponse),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      await agent.exposedCallLLM([{ role: "user", content: "msg1" }]);
      await agent.exposedCallLLM([{ role: "user", content: "msg2" }]);

      expect(agent.getStats().totalTokensUsed).toBe(12);
    });

    it("wraps adapter errors as AgentError", async () => {
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockRejectedValue(new Error("network error")),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      await expect(
        agent.exposedCallLLM([{ role: "user", content: "hi" }]),
      ).rejects.toThrow(/LLM call failed/i);
    });

    it("passes tools option to adapter.chat", async () => {
      const mockResponse: LLMResponse = {
        id: "resp-3",
        content: "ok",
        finishReason: "stop",
        model: "gpt-4o",
        createdAt: new Date(),
      };
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(mockResponse),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const tools: LLMToolDefinition[] = [
        {
          type: "function",
          function: {
            name: "search",
            description: "search tool",
            parameters: { type: "object", properties: {} },
          },
        },
      ];

      await agent.exposedCallLLM([{ role: "user", content: "hi" }], { tools });

      expect(adapter.chat).toHaveBeenCalledWith(
        expect.objectContaining({ tools }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // buildMessages
  // -------------------------------------------------------------------------

  describe("buildMessages", () => {
    it("returns a message list with only user message when no systemPrompt or memory", () => {
      const messages = agent.exposedBuildMessages(
        "What is 2+2?",
        makeContext(),
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: "user", content: "What is 2+2?" });
    });

    it("prepends system prompt when set", () => {
      agent.setSystemPrompt("You are helpful.");
      const messages = agent.exposedBuildMessages("hi", makeContext());
      expect(messages[0]).toEqual({
        role: "system",
        content: "You are helpful.",
      });
      expect(messages[1]).toEqual({ role: "user", content: "hi" });
    });

    it("includes history messages from context.memory", () => {
      const ctx = makeContext({
        memory: {
          messages: [{ role: "assistant", content: "previous reply" }],
        },
      });
      const messages = agent.exposedBuildMessages("next question", ctx);
      const roles = messages.map((m) => m.role);
      expect(roles).toContain("assistant");
      expect(roles[roles.length - 1]).toBe("user");
    });
  });

  // -------------------------------------------------------------------------
  // parseJsonResponse
  // -------------------------------------------------------------------------

  describe("parseJsonResponse", () => {
    it("parses plain JSON string", () => {
      const result = agent.exposedParseJsonResponse<{ x: number }>('{"x":1}');
      expect(result).toEqual({ x: 1 });
    });

    it("parses JSON wrapped in markdown code fence", () => {
      const content = '```json\n{"x": 2}\n```';
      const result = agent.exposedParseJsonResponse<{ x: number }>(content);
      expect(result).toEqual({ x: 2 });
    });

    it("returns fallback on parse failure when fallback is provided", () => {
      const fallback = { x: 99 };
      const result = agent.exposedParseJsonResponse<{ x: number }>(
        "not json",
        fallback,
      );
      expect(result).toEqual(fallback);
    });

    it("throws when content is invalid JSON and no fallback is provided", () => {
      expect(() => agent.exposedParseJsonResponse("{{bad json}}")).toThrow(
        /Failed to parse JSON response/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe("getStats", () => {
    it("returns a copy (mutation does not affect internal state)", async () => {
      const stats = agent.getStats();
      stats.totalExecutions = 999;
      expect(agent.getStats().totalExecutions).toBe(0);
    });

    it("tracks multiple executions correctly", async () => {
      agent.doExecuteImpl = async () => ({ message: "ok" });
      await agent.execute(makeInput(), makeContext());

      agent.doExecuteImpl = async () => {
        throw new Error("fail");
      };
      await agent.execute(makeInput(), makeContext());

      const stats = agent.getStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(1);
    });
  });
});
