/**
 * Unit tests for LeaderLLMAdapter
 */

import {
  LeaderLLMAdapter,
  createLeaderLLMAdapter,
} from "../leader-llm-adapter";
import { LLMFactory } from "@/modules/ai-engine/llm/factory/llm-factory";
import { ILLMAdapter } from "@/modules/ai-engine/llm/abstractions/llm-adapter.interface";
import { TaskInput, MemberOutput } from "../../abstractions/member.interface";

// ==================== Helpers ====================

function makeMockLLMAdapter(responseContent: string): ILLMAdapter {
  return {
    chat: jest.fn().mockResolvedValue({ content: responseContent }),
    stream: jest.fn(),
    getModel: jest.fn().mockReturnValue("mock-model"),
  } as unknown as ILLMAdapter;
}

function makeLLMFactory(adapter?: ILLMAdapter): LLMFactory {
  return {
    getDefaultModel: jest.fn().mockReturnValue("default-model"),
    getAdapterForModel: jest
      .fn()
      .mockReturnValue(adapter ?? makeMockLLMAdapter("")),
  } as unknown as LLMFactory;
}

function makeTask(id = "task-1"): TaskInput {
  return {
    id,
    description: "Research AI market trends",
    requirements: ["Include statistics", "Cover 2024"],
    context: { domain: "technology" },
  };
}

function makeOutput(id = "out-1"): MemberOutput {
  return {
    id,
    taskId: "task-1",
    memberId: "m1",
    content: "AI trends research content",
    contentType: "text",
    completedAt: new Date(),
    quality: { score: 8, confidence: 0.9 },
  };
}

// ==================== Constructor ====================

describe("LeaderLLMAdapter - Constructor", () => {
  it("should use default model from llmFactory when no model provided", () => {
    const factory = makeLLMFactory();
    new LeaderLLMAdapter(factory);
    expect(factory.getDefaultModel).toHaveBeenCalled();
  });

  it("should use provided model instead of default", () => {
    const factory = makeLLMFactory();
    const adapter = new LeaderLLMAdapter(factory, "custom-model");
    // getDefaultModel should NOT be called when model is explicitly provided
    expect(factory.getDefaultModel).not.toHaveBeenCalled();
    expect(adapter).toBeDefined();
  });
});

// ==================== decomposeTask ====================

describe("LeaderLLMAdapter - decomposeTask", () => {
  it("should parse valid JSON subtask array from LLM response", async () => {
    const subtasksJson = JSON.stringify([
      {
        description: "Search for AI papers",
        suggestedRole: "researcher",
        dependencies: [],
        estimatedDuration: 30,
        priority: 1,
      },
      {
        description: "Analyze findings",
        suggestedRole: "analyst",
        dependencies: [0],
        estimatedDuration: 20,
        priority: 2,
      },
    ]);

    const mockLLM = makeMockLLMAdapter(subtasksJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const subtasks = await adapter.decomposeTask(
      makeTask(),
      ["researcher", "analyst"],
      "I am a leader",
    );

    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].description).toBe("Search for AI papers");
    expect(subtasks[0].suggestedRole).toBe("researcher");
    expect(subtasks[0].estimatedDuration).toBe(30 * 60000);
    expect(subtasks[0].priority).toBe(1);
    expect(subtasks[0].parentTaskId).toBe("task-1");
  });

  it("should return fallback subtask when JSON parse fails", async () => {
    const mockLLM = makeMockLLMAdapter("Not valid JSON at all");
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const subtasks = await adapter.decomposeTask(
      makeTask(),
      ["researcher"],
      "Persona",
    );

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].parentTaskId).toBe("task-1");
    expect(subtasks[0].suggestedRole).toBe("researcher");
  });

  it("should return fallback subtask when LLM throws", async () => {
    const mockLLM = {
      chat: jest.fn().mockRejectedValue(new Error("LLM unavailable")),
    } as unknown as ILLMAdapter;
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const subtasks = await adapter.decomposeTask(
      makeTask(),
      ["writer"],
      "Persona",
    );

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].suggestedRole).toBe("writer");
  });

  it("should throw when no LLM adapter is available", async () => {
    const factory = {
      getDefaultModel: jest.fn().mockReturnValue("missing-model"),
      getAdapterForModel: jest.fn().mockReturnValue(null),
    } as unknown as LLMFactory;
    const adapter = new LeaderLLMAdapter(factory);

    await expect(
      adapter.decomposeTask(makeTask(), [], "Persona"),
    ).rejects.toThrow("No LLM adapter available");
  });

  it("should handle subtasks without requirements and context", async () => {
    const responseJson = JSON.stringify([
      {
        description: "Simple task",
        suggestedRole: "researcher",
        estimatedDuration: 10,
        priority: 1,
      },
    ]);
    const mockLLM = makeMockLLMAdapter(responseJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const task: TaskInput = { id: "t1", description: "Simple" };
    const subtasks = await adapter.decomposeTask(
      task,
      ["researcher"],
      "Persona",
    );
    expect(subtasks).toHaveLength(1);
  });
});

// ==================== reviewOutput ====================

describe("LeaderLLMAdapter - reviewOutput", () => {
  it("should parse valid review JSON from LLM response", async () => {
    const reviewJson = JSON.stringify({
      passed: true,
      score: 9,
      feedback: "Excellent work",
      issues: [
        {
          type: "suggestion",
          description: "Add more examples",
          suggestion: "Include case studies",
        },
      ],
    });

    const mockLLM = makeMockLLMAdapter(reviewJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const review = await adapter.reviewOutput(
      makeOutput(),
      ["Accuracy", "Completeness"],
      "Leader persona",
    );

    expect(review.passed).toBe(true);
    expect(review.score).toBe(9);
    expect(review.feedback).toBe("Excellent work");
    expect(review.issues).toHaveLength(1);
    expect(review.outputId).toBe("out-1");
  });

  it("should return default passing review when JSON parse fails", async () => {
    const mockLLM = makeMockLLMAdapter("Invalid response");
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const review = await adapter.reviewOutput(makeOutput(), [], "Persona");

    expect(review.passed).toBe(true);
    expect(review.score).toBe(7);
    expect(review.outputId).toBe("out-1");
  });

  it("should return default review when LLM throws", async () => {
    const mockLLM = {
      chat: jest.fn().mockRejectedValue(new Error("Timeout")),
    } as unknown as ILLMAdapter;
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const review = await adapter.reviewOutput(makeOutput(), [], "Persona");
    expect(review.passed).toBe(true);
  });

  it("should handle object content type in output", async () => {
    const reviewJson = JSON.stringify({
      passed: true,
      score: 8,
      feedback: "OK",
    });
    const mockLLM = makeMockLLMAdapter(reviewJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const output: MemberOutput = {
      id: "out-2",
      taskId: "task-1",
      memberId: "m1",
      content: { data: "structured content" },
      contentType: "json",
      completedAt: new Date(),
      quality: { score: 8, confidence: 0.9 },
    };

    const review = await adapter.reviewOutput(output, [], "Persona");
    expect(review.outputId).toBe("out-2");
  });
});

// ==================== integrateResults ====================

describe("LeaderLLMAdapter - integrateResults", () => {
  it("should parse valid integration JSON from LLM response", async () => {
    const integrationJson = JSON.stringify({
      content: "Integrated report with all findings",
      summary: "Comprehensive AI market analysis",
    });

    const mockLLM = makeMockLLMAdapter(integrationJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const results = [makeOutput("out-1"), makeOutput("out-2")];
    const integrated = await adapter.integrateResults(
      results,
      "Write comprehensive report",
      "Persona",
    );

    expect(integrated.content).toBe("Integrated report with all findings");
    expect(integrated.summary).toBe("Comprehensive AI market analysis");
    expect(integrated.sourceOutputIds).toContain("out-1");
    expect(integrated.sourceOutputIds).toContain("out-2");
    expect(integrated.contentType).toBe("integrated");
  });

  it("should return fallback integration when JSON parse fails", async () => {
    const mockLLM = makeMockLLMAdapter("Not JSON");
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const results = [makeOutput("out-1")];
    const integrated = await adapter.integrateResults(
      results,
      "Goal",
      "Persona",
    );

    expect(integrated.sourceOutputIds).toContain("out-1");
    expect(integrated.contentType).toBe("integrated");
  });

  it("should return fallback when LLM throws", async () => {
    const mockLLM = {
      chat: jest.fn().mockRejectedValue(new Error("API error")),
    } as unknown as ILLMAdapter;
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const results = [makeOutput("out-1"), makeOutput("out-2")];
    const integrated = await adapter.integrateResults(
      results,
      "Goal",
      "Persona",
    );

    expect(integrated.sourceOutputIds).toHaveLength(2);
  });

  it("should handle empty results array", async () => {
    const integrationJson = JSON.stringify({
      content: "Nothing to integrate",
      summary: "Empty",
    });
    const mockLLM = makeMockLLMAdapter(integrationJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const integrated = await adapter.integrateResults([], "Goal", "Persona");
    expect(integrated.sourceOutputIds).toHaveLength(0);
  });
});

// ==================== Factory Function ====================

describe("createLeaderLLMAdapter", () => {
  it("should return an ILeaderLLMAdapter instance", () => {
    const factory = makeLLMFactory();
    const adapter = createLeaderLLMAdapter(factory);
    expect(adapter).toBeDefined();
    expect(typeof adapter.decomposeTask).toBe("function");
    expect(typeof adapter.reviewOutput).toBe("function");
    expect(typeof adapter.integrateResults).toBe("function");
  });

  it("should accept optional model parameter", () => {
    const factory = makeLLMFactory();
    const adapter = createLeaderLLMAdapter(factory, "claude-3");
    expect(adapter).toBeDefined();
  });
});
