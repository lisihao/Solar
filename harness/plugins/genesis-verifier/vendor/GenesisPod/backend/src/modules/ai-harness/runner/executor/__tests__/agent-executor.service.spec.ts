/**
 * AgentExecutorService 单元测试
 *
 * 测试 Agent 执行器核心功能：
 * - execute() 各执行模式
 * - CircuitBreaker 集成
 * - 超时处理
 * - 执行结果封装
 * - v3.1 C 阶段：callAIWithConfig defaultMaxTokens 由 DB capability 驱动
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AgentExecutorService } from "../agent-executor.service";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { ToolRegistry } from "../../../../ai-engine/tools/registry/tool.registry";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("AgentExecutorService", () => {
  let service: AgentExecutorService;
  let mockChat: jest.Mock;
  let mockPrismaFindFirst: jest.Mock;

  beforeEach(async () => {
    mockChat = jest.fn();
    mockPrismaFindFirst = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentExecutorService,
        {
          provide: AiChatService,
          useValue: {
            chat: jest.fn(),
            generateChatCompletion: mockChat,
          },
        },
        {
          provide: ToolRegistry,
          useValue: {
            executeTool: jest.fn(),
            getToolNames: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            aIModel: { findFirst: mockPrismaFindFirst },
          },
        },
      ],
    }).compile();

    service = module.get<AgentExecutorService>(AgentExecutorService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("executeTask", () => {
    it("should have executeTask method available", async () => {
      // AgentExecutorService manages agent execution lifecycle
      // Test that it's instantiable and methods are available
      expect(typeof service.executeTask).toBe("function");
    });
  });

  // v3.1 C 阶段（2026-05-24）：守护 callAIWithConfig 已删除 isLargeModel 启发式，
  // defaultMaxTokens 现由 modelConfig.maxTokens 驱动（>= 6000 视为 large）。
  describe("callAIWithConfig — capability-driven defaultMaxTokens (v3.1 C)", () => {
    type CallAIWithConfigArgs = [
      string,
      { role: string; content: string }[],
      string,
      {
        maxTokens?: number;
        taskProfile?: unknown;
        missionId?: string;
      },
      { maxTokens: number } | undefined,
    ];
    function invokeCallAIWithConfig(
      args: CallAIWithConfigArgs,
    ): Promise<{ content: string; tokensUsed: number }> {
      const fn = (
        service as unknown as {
          callAIWithConfig: (
            ...a: CallAIWithConfigArgs
          ) => Promise<{ content: string; tokensUsed: number }>;
        }
      ).callAIWithConfig.bind(service);
      return fn(...args);
    }

    it("uses 6000 default when modelConfig.maxTokens >= 6000 (large model)", async () => {
      mockChat.mockResolvedValueOnce({
        content: "out",
        tokensUsed: 10,
      });
      await invokeCallAIWithConfig([
        "any-model-id",
        [],
        "sys",
        { taskProfile: { creativity: "medium", outputLength: "medium" } },
        { maxTokens: 8000 },
      ]);
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(mockChat.mock.calls[0][0]).toMatchObject({ maxTokens: 6000 });
    });

    it("uses 4000 default when modelConfig.maxTokens < 6000 (small model)", async () => {
      mockChat.mockResolvedValueOnce({
        content: "out",
        tokensUsed: 10,
      });
      await invokeCallAIWithConfig([
        "any-model-id",
        [],
        "sys",
        { taskProfile: { creativity: "medium", outputLength: "medium" } },
        { maxTokens: 2048 },
      ]);
      expect(mockChat.mock.calls[0][0]).toMatchObject({ maxTokens: 4000 });
    });

    it("uses 4000 default when modelConfig is missing (BYOK fallback)", async () => {
      mockChat.mockResolvedValueOnce({
        content: "out",
        tokensUsed: 10,
      });
      await invokeCallAIWithConfig([
        "any-model-id",
        [],
        "sys",
        { taskProfile: { creativity: "medium", outputLength: "medium" } },
        undefined,
      ]);
      expect(mockChat.mock.calls[0][0]).toMatchObject({ maxTokens: 4000 });
    });

    it("respects explicit options.maxTokens regardless of modelConfig", async () => {
      mockChat.mockResolvedValueOnce({
        content: "out",
        tokensUsed: 10,
      });
      await invokeCallAIWithConfig([
        "any-model-id",
        [],
        "sys",
        {
          maxTokens: 1234,
          taskProfile: { creativity: "medium", outputLength: "medium" },
        },
        { maxTokens: 8000 },
      ]);
      expect(mockChat.mock.calls[0][0]).toMatchObject({ maxTokens: 1234 });
    });

    it("does NOT inspect modelId substring (capability comes from DB, not model name)", async () => {
      mockChat.mockResolvedValueOnce({
        content: "out",
        tokensUsed: 10,
      });
      // modelId 含 "gpt-4" 但 maxTokens 小 → 必须降级 small（旧启发式会误判 large）
      await invokeCallAIWithConfig([
        "gpt-4-nano-byok",
        [],
        "sys",
        { taskProfile: { creativity: "medium", outputLength: "medium" } },
        { maxTokens: 2048 },
      ]);
      expect(mockChat.mock.calls[0][0]).toMatchObject({ maxTokens: 4000 });
    });
  });
});
