/**
 * AgentSubFacade — branch coverage spec
 *
 * Covers branches in executeAgent() and isAgentAvailable().
 */

import { AgentSubFacade } from "../agent.sub-facade";

function makeOrchestration(
  overrides: {
    agentExecutor?: unknown;
  } = {},
) {
  return {
    circuitBreaker: {} as any,
    agentExecutor: overrides.agentExecutor,
  } as any;
}

describe("AgentSubFacade", () => {
  describe("executeAgent() — no orchestration", () => {
    it("returns error result when orchestration is undefined", async () => {
      const facade = new AgentSubFacade(undefined);
      const result = await facade.executeAgent({
        agentType: "analyst",
        task: "Analyze market trends",
      } as any);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/AgentExecutorService not available/);
    });

    it("returns error result when agentExecutor is missing", async () => {
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: undefined }),
      );
      const result = await facade.executeAgent({
        agentType: "analyst",
        task: "Analyze market trends",
      } as any);
      expect(result.success).toBe(false);
    });
  });

  describe("executeAgent() — with orchestration", () => {
    function makeExecutor(result: unknown) {
      return {
        executeTask: jest.fn().mockResolvedValue(result),
        isAgentAvailable: jest.fn().mockReturnValue(true),
      };
    }

    it("returns success result when executeTask resolves", async () => {
      const executor = makeExecutor({
        success: true,
        content: "Analysis complete",
        tokensUsed: 500,
        duration: 200,
        error: undefined,
        retryable: false,
        searchResults: [],
      });
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      const result = await facade.executeAgent({
        agentType: "analyst",
        task: "Analyze market trends",
        model: "CHAT" as any,
        context: "Some context",
        config: {
          maxTokens: 1000,
          temperature: 0.5,
          enableSearch: true,
          maxRetries: 2,
          timeout: 5000,
        },
      } as any);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Analysis complete");
    });

    it("uses metadata for missionId and topicId when provided", async () => {
      const executor = makeExecutor({
        success: true,
        content: "done",
        tokensUsed: 100,
        duration: 50,
        error: undefined,
        retryable: false,
      });
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      await facade.executeAgent({
        agentType: "analyst",
        task: "Task",
        metadata: { missionId: "m-1", topicId: "t-1" },
      } as any);

      const context = executor.executeTask.mock.calls[0][0];
      expect(context.missionId).toBe("m-1");
      expect(context.topicId).toBe("t-1");
    });

    it("applies taskProfile creativity to temperature when config.temperature not set", async () => {
      const executor = makeExecutor({
        success: true,
        content: "done",
        tokensUsed: 100,
        duration: 50,
      });
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      await facade.executeAgent({
        agentType: "analyst",
        task: "Task",
        taskProfile: { creativity: "low", outputLength: "medium" },
        config: {},
      } as any);

      const [, config] = executor.executeTask.mock.calls[0];
      expect(typeof config.temperature).toBe("number");
      expect(typeof config.maxTokens).toBe("number");
    });

    it("does not override config.temperature when already set", async () => {
      const executor = makeExecutor({
        success: true,
        content: "done",
        tokensUsed: 100,
        duration: 50,
      });
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      await facade.executeAgent({
        agentType: "analyst",
        task: "Task",
        taskProfile: { creativity: "high", outputLength: "long" },
        config: { temperature: 0.3, maxTokens: 2000 },
      } as any);

      const [, config] = executor.executeTask.mock.calls[0];
      expect(config.temperature).toBe(0.3);
      expect(config.maxTokens).toBe(2000);
    });

    it("applies taskProfile outputLength to maxTokens when not set", async () => {
      const executor = makeExecutor({
        success: true,
        content: "done",
        tokensUsed: 100,
        duration: 50,
      });
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      await facade.executeAgent({
        agentType: "analyst",
        task: "Task",
        taskProfile: { outputLength: "long" },
        config: {},
      } as any);

      const [, config] = executor.executeTask.mock.calls[0];
      expect(config.maxTokens).toBeGreaterThan(0);
    });

    it("returns error result when executeTask throws", async () => {
      const executor = {
        executeTask: jest
          .fn()
          .mockRejectedValue(new Error("service unavailable")),
        isAgentAvailable: jest.fn(),
      };
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      const result = await facade.executeAgent({
        agentType: "analyst",
        task: "Task",
        config: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("service unavailable");
      expect(result.retryable).toBe(true);
    });

    it("returns error result when executeTask throws non-Error", async () => {
      const executor = {
        executeTask: jest.fn().mockRejectedValue("raw error"),
        isAgentAvailable: jest.fn(),
      };
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      const result = await facade.executeAgent({
        agentType: "analyst",
        task: "Task",
        config: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("raw error");
    });
  });

  describe("isAgentAvailable()", () => {
    it("returns false when orchestration missing", () => {
      const facade = new AgentSubFacade(undefined);
      expect(facade.isAgentAvailable("analyst")).toBe(false);
    });

    it("returns false when agentExecutor missing", () => {
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: undefined }),
      );
      expect(facade.isAgentAvailable("analyst")).toBe(false);
    });

    it("delegates to agentExecutor.isAgentAvailable", () => {
      const isAgentAvailable = jest.fn().mockReturnValue(true);
      const executor = { isAgentAvailable, executeTask: jest.fn() };
      const facade = new AgentSubFacade(
        makeOrchestration({ agentExecutor: executor }),
      );

      expect(facade.isAgentAvailable("analyst")).toBe(true);
      expect(isAgentAvailable).toHaveBeenCalledWith("analyst");
    });
  });
});
