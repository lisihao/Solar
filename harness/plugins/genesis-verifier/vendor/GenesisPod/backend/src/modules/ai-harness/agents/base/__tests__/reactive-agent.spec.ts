/**
 * Tests for ReactiveAgent
 * Covers the ReAct loop, tool call execution, stream events, and edge cases.
 */

import { Logger } from "@nestjs/common";
import { ReactiveAgent, ReactAgentConfig } from "../reactive-agent";
import {
  AgentContext,
  AgentInput,
  AgentOutput,
  AgentCapability,
  ToolCallRecord,
} from "../../abstractions/agent.interface";
import {
  ILLMAdapter,
  LLMResponse,
  LLMToolDefinition,
} from "../../../llm/abstractions";
import { ToolRegistry } from "../../../tools/registry";

// ---------------------------------------------------------------------------
// Concrete test double
// ---------------------------------------------------------------------------

class TestReactiveAgent extends ReactiveAgent<AgentInput, AgentOutput> {
  readonly id = "test-reactive-agent";
  readonly name = "Test Reactive Agent";
  readonly description = "Used in unit tests";
  readonly capabilities: AgentCapability[] = [];

  private _toolDefs: LLMToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    },
  ];

  processOutputImpl: (
    content: string,
    context: AgentContext,
    toolResults: ToolCallRecord[],
  ) => Promise<AgentOutput> = async (content) => ({ message: content });

  protected getToolDefinitions(): LLMToolDefinition[] {
    return this._toolDefs;
  }

  protected async processOutput(
    content: string,
    context: AgentContext,
    toolResults: ToolCallRecord[],
  ): Promise<AgentOutput> {
    return this.processOutputImpl(content, context, toolResults);
  }

  constructor(config?: Partial<ReactAgentConfig>) {
    super(config);
  }

  setToolDefs(defs: LLMToolDefinition[]) {
    this._toolDefs = defs;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    executionId: "exec-react",
    agentId: "test-reactive-agent",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeInput(prompt = "Search for AI"): AgentInput {
  return { prompt };
}

function makeLLMResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    id: "resp-test",
    content: "Final answer",
    finishReason: "stop",
    model: "gpt-4o",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReactiveAgent", () => {
  let agent: TestReactiveAgent;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    agent = new TestReactiveAgent();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // supportedModes
  // -------------------------------------------------------------------------

  it("supports only reactive mode", () => {
    expect(agent.supportedModes).toEqual(["reactive"]);
  });

  // -------------------------------------------------------------------------
  // execute – direct response (no tool calls)
  // -------------------------------------------------------------------------

  describe("execute – direct LLM response", () => {
    it("returns success with processed output when LLM responds without tool calls", async () => {
      const adapter: ILLMAdapter = {
        chat: jest
          .fn()
          .mockResolvedValue(makeLLMResponse({ content: "Direct answer" })),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const result = await agent.execute(makeInput(), makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.message).toBe("Direct answer");
    });
  });

  // -------------------------------------------------------------------------
  // execute – tool call then final answer
  // -------------------------------------------------------------------------

  describe("execute – tool call cycle", () => {
    it("executes tool call and processes final response", async () => {
      const toolResult = { success: true, data: { hits: ["result1"] } };
      const tool = { execute: jest.fn().mockResolvedValue(toolResult) };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      let callCount = 0;
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First call: request a tool call
            return makeLLMResponse({
              content: "",
              toolCalls: [
                {
                  id: "call-1",
                  type: "function" as const,
                  name: "search",
                  arguments: { q: "AI" },
                },
              ],
            });
          }
          // Second call: final answer
          return makeLLMResponse({ content: "AI is transformative" });
        }),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const result = await agent.execute(makeInput(), makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.message).toBe("AI is transformative");
      expect(tool.execute).toHaveBeenCalledTimes(1);
    });

    it("records tool call in processOutput's toolResults argument", async () => {
      const toolResult = { success: true, data: "found" };
      const tool = { execute: jest.fn().mockResolvedValue(toolResult) };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      let iteration = 0;
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockImplementation(async () => {
          iteration++;
          return iteration === 1
            ? makeLLMResponse({
                content: "",
                toolCalls: [
                  {
                    id: "c1",
                    type: "function" as const,
                    name: "search",
                    arguments: {},
                  },
                ],
              })
            : makeLLMResponse({ content: "done" });
        }),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const capturedToolResults: ToolCallRecord[][] = [];
      agent.processOutputImpl = async (_content, _ctx, toolResults) => {
        capturedToolResults.push(toolResults);
        return { message: "ok" };
      };

      await agent.execute(makeInput(), makeContext());

      expect(capturedToolResults[0]).toHaveLength(1);
      expect(capturedToolResults[0][0].toolId).toBe("search");
      expect(capturedToolResults[0][0].success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute – tool call fails
  // -------------------------------------------------------------------------

  describe("execute – tool call failure", () => {
    it("records tool failure and continues to next LLM call", async () => {
      const registry = {
        tryGet: jest.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      let iteration = 0;
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockImplementation(async () => {
          iteration++;
          return iteration === 1
            ? makeLLMResponse({
                content: "",
                toolCalls: [
                  {
                    id: "c1",
                    type: "function" as const,
                    name: "search",
                    arguments: {},
                  },
                ],
              })
            : makeLLMResponse({ content: "fallback answer" });
        }),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const capturedToolResults: ToolCallRecord[][] = [];
      agent.processOutputImpl = async (_content, _ctx, toolResults) => {
        capturedToolResults.push(toolResults);
        return { message: "ok" };
      };

      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(capturedToolResults[0][0].success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // execute – maxIterations reached
  // -------------------------------------------------------------------------

  describe("execute – max iterations", () => {
    it("returns failure result when maxIterations is exhausted", async () => {
      const registry = {
        tryGet: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue({ success: true, data: null }),
        }),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      // Always respond with a tool call → infinite loop, but capped by maxIterations
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(
          makeLLMResponse({
            content: "",
            toolCalls: [
              {
                id: "c1",
                type: "function" as const,
                name: "search",
                arguments: {},
              },
            ],
          }),
        ),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const agentLimited = new TestReactiveAgent({ maxIterations: 2 });
      agentLimited.setLLMAdapter(adapter);
      agentLimited.setToolRegistry(registry);

      const result = await agentLimited.execute(makeInput(), makeContext());
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/max iterations/i);
    });
  });

  // -------------------------------------------------------------------------
  // execute – cancellation
  // -------------------------------------------------------------------------

  describe("execute – cancellation", () => {
    it("returns failure when AbortSignal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(makeLLMResponse()),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const result = await agent.execute(
        makeInput(),
        makeContext({ signal: controller.signal }),
      );
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/cancelled/i);
    });
  });

  // -------------------------------------------------------------------------
  // executeStream
  // -------------------------------------------------------------------------

  describe("executeStream", () => {
    it("yields started, thinking, message, and completed events on success", async () => {
      const adapter: ILLMAdapter = {
        chat: jest
          .fn()
          .mockResolvedValue(makeLLMResponse({ content: "streamed answer" })),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const gen = agent.executeStream(makeInput(), makeContext());
      const types: string[] = [];

      for await (const event of gen) {
        types.push((event as { type: string }).type);
      }

      expect(types).toContain("started");
      expect(types).toContain("thinking");
      expect(types).toContain("message");
      expect(types).toContain("completed");
    });

    it("yields tool_call and tool_result events during tool execution", async () => {
      const tool = {
        execute: jest.fn().mockResolvedValue({ success: true, data: "found" }),
      };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      let iteration = 0;
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockImplementation(async () => {
          iteration++;
          return iteration === 1
            ? makeLLMResponse({
                content: "",
                toolCalls: [
                  {
                    id: "c1",
                    type: "function" as const,
                    name: "search",
                    arguments: {},
                  },
                ],
              })
            : makeLLMResponse({ content: "final" });
        }),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const gen = agent.executeStream(makeInput(), makeContext());
      const types: string[] = [];

      for await (const event of gen) {
        types.push((event as { type: string }).type);
      }

      expect(types).toContain("tool_call");
      expect(types).toContain("tool_result");
    });

    it("yields error event on cancellation", async () => {
      const controller = new AbortController();
      controller.abort();

      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(makeLLMResponse()),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);

      const gen = agent.executeStream(
        makeInput(),
        makeContext({ signal: controller.signal }),
      );
      const types: string[] = [];

      for await (const event of gen) {
        types.push((event as { type: string }).type);
      }

      expect(types).toContain("error");
    });
  });

  // -------------------------------------------------------------------------
  // buildInitialMessages
  // -------------------------------------------------------------------------

  describe("buildInitialMessages", () => {
    it("builds messages with user prompt from AgentInput", () => {
      const adapter: ILLMAdapter = {
        chat: jest.fn().mockResolvedValue(makeLLMResponse()),
      } as unknown as ILLMAdapter;
      agent.setLLMAdapter(adapter);
      agent.setSystemPrompt("You are a helpful assistant.");

      // Trigger execute so we can inspect the messages passed to chat
      const input = makeInput("What is AI?");

      // We test indirectly by checking that adapter.chat was called
      // with the expected user message.
      return agent.execute(input, makeContext()).then(() => {
        const callArgs = (adapter.chat as jest.Mock).mock.calls[0][0] as {
          messages: Array<{ role: string; content: string }>;
        };
        const userMsg = callArgs.messages.find((m) => m.role === "user");
        expect(userMsg?.content).toBe("What is AI?");
      });
    });
  });

  // -------------------------------------------------------------------------
  // config merging
  // -------------------------------------------------------------------------

  describe("config", () => {
    it("uses default maxIterations of 10", () => {
      const cfg = (agent as unknown as { config: ReactAgentConfig }).config;
      expect(cfg.maxIterations).toBe(10);
    });

    it("merges custom config with defaults", () => {
      const custom = new TestReactiveAgent({
        maxIterations: 5,
        autoExecuteTools: false,
      });
      const cfg = (custom as unknown as { config: ReactAgentConfig }).config;
      expect(cfg.maxIterations).toBe(5);
      expect(cfg.autoExecuteTools).toBe(false);
      expect(cfg.toolSelectionStrategy).toBe("auto"); // default
    });
  });
});
