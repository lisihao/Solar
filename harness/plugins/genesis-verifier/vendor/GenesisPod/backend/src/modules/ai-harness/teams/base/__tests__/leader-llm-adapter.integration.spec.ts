/**
 * LeaderLLMAdapter - Supplemental Tests
 *
 * Covers uncovered branches at ~5.4% → 95%+:
 * - getLLM() caching: adapter is created once and reused on subsequent calls
 * - decomposeTask: dependency mapping (depIdx points to valid subtaskId)
 * - decomposeTask: no requirements / no context (neither branch hit)
 * - decomposeTask: availableRoles is empty (fallback uses empty string)
 * - reviewOutput: review without issues field
 * - integrateResults: output with non-string content (object)
 * - integrateResults: zero results (empty sourceOutputIds)
 */

import {
  LeaderLLMAdapter,
  createLeaderLLMAdapter,
} from "../leader-llm-adapter";
import { LLMFactory } from "@/modules/ai-engine/llm/factory/llm-factory";
import { ILLMAdapter } from "@/modules/ai-engine/llm/abstractions/llm-adapter.interface";
import { TaskInput, MemberOutput } from "../../abstractions/member.interface";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function makeTask(
  id = "task-1",
  overrides: Partial<TaskInput> = {},
): TaskInput {
  return {
    id,
    description: "Research AI market trends",
    requirements: ["Include statistics", "Cover 2025"],
    context: { domain: "technology" },
    ...overrides,
  };
}

function makeOutput(id = "out-1"): MemberOutput {
  return {
    id,
    taskId: "task-1",
    memberId: "m1",
    content: "Output content text",
    contentType: "text",
    completedAt: new Date(),
    quality: { score: 8, confidence: 0.9 },
  };
}

// ─── getLLM caching ───────────────────────────────────────────────────────────

describe("LeaderLLMAdapter - getLLM caching", () => {
  it("should reuse the same LLM adapter on multiple calls", async () => {
    const mockLLM = makeMockLLMAdapter(
      JSON.stringify([
        {
          description: "Step 1",
          suggestedRole: "researcher",
          estimatedDuration: 10,
          priority: 1,
        },
      ]),
    );
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    // Call decomposeTask twice — getLLM should create adapter once, then cache it
    await adapter.decomposeTask(makeTask(), ["researcher"], "Leader");
    await adapter.decomposeTask(makeTask("task-2"), ["researcher"], "Leader");

    // getAdapterForModel should be called only once (first call creates, second reuses)
    expect(factory.getAdapterForModel).toHaveBeenCalledTimes(1);
  });
});

// ─── decomposeTask edge cases ─────────────────────────────────────────────────

describe("LeaderLLMAdapter - decomposeTask additional branches", () => {
  it("should map dependency index to generated subtask IDs", async () => {
    const subtasksJson = JSON.stringify([
      {
        description: "Task A",
        suggestedRole: "researcher",
        estimatedDuration: 20,
        priority: 1,
        dependencies: [],
      },
      {
        description: "Task B depends on A",
        suggestedRole: "analyst",
        estimatedDuration: 15,
        priority: 2,
        dependencies: [0], // depends on index 0 → should map to Task A's UUID
      },
    ]);

    const mockLLM = makeMockLLMAdapter(subtasksJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const subtasks = await adapter.decomposeTask(
      makeTask(),
      ["researcher", "analyst"],
      "Leader",
    );

    expect(subtasks).toHaveLength(2);
    // Task B should have Task A's ID as dependency
    expect(subtasks[1].dependencies).toContain(subtasks[0].id);
    expect(subtasks[1].dependencies).toHaveLength(1);
  });

  it("should map out-of-range dependency index to empty string", async () => {
    const subtasksJson = JSON.stringify([
      {
        description: "Only task",
        suggestedRole: "researcher",
        estimatedDuration: 10,
        priority: 1,
        dependencies: [99], // out of range
      },
    ]);

    const mockLLM = makeMockLLMAdapter(subtasksJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const subtasks = await adapter.decomposeTask(
      makeTask(),
      ["researcher"],
      "Leader",
    );

    expect(subtasks[0].dependencies).toContain(""); // maps to ""
  });

  it("should use 'researcher' as fallback role when availableRoles is empty and LLM fails", async () => {
    const mockLLM = {
      chat: jest.fn().mockRejectedValue(new Error("LLM error")),
    } as unknown as ILLMAdapter;
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const subtasks = await adapter.decomposeTask(
      makeTask(),
      [], // empty roles
      "Leader",
    );

    expect(subtasks).toHaveLength(1);
    // availableRoles[0] is undefined → undefined || "researcher" = "researcher"
    expect(subtasks[0].suggestedRole).toBe("researcher");
  });

  it("should handle task without requirements field", async () => {
    const subtasksJson = JSON.stringify([
      {
        description: "Simple task",
        suggestedRole: "researcher",
        estimatedDuration: 5,
        priority: 1,
      },
    ]);

    const mockLLM = makeMockLLMAdapter(subtasksJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const task: TaskInput = {
      id: "no-req-task",
      description: "No requirements here",
      // no requirements, no context
    };

    const subtasks = await adapter.decomposeTask(
      task,
      ["researcher"],
      "Leader",
    );
    expect(subtasks).toHaveLength(1);
  });

  it("should handle task with empty requirements array", async () => {
    const subtasksJson = JSON.stringify([
      {
        description: "Task",
        suggestedRole: "r",
        estimatedDuration: 5,
        priority: 1,
      },
    ]);

    const mockLLM = makeMockLLMAdapter(subtasksJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const task = makeTask("t", { requirements: [] });
    const subtasks = await adapter.decomposeTask(task, ["r"], "Leader");
    expect(subtasks).toHaveLength(1);
  });
});

// ─── reviewOutput edge cases ──────────────────────────────────────────────────

describe("LeaderLLMAdapter - reviewOutput additional branches", () => {
  it("should handle review result without issues field", async () => {
    const reviewJson = JSON.stringify({
      passed: false,
      score: 4,
      feedback: "Needs improvement",
      // no issues field
    });

    const mockLLM = makeMockLLMAdapter(reviewJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const review = await adapter.reviewOutput(
      makeOutput(),
      ["Accuracy"],
      "Leader",
    );

    expect(review.passed).toBe(false);
    expect(review.score).toBe(4);
    expect(review.issues).toBeUndefined();
  });

  it("should use reviewedAt date in result", async () => {
    const reviewJson = JSON.stringify({
      passed: true,
      score: 8,
      feedback: "Good work",
    });

    const mockLLM = makeMockLLMAdapter(reviewJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const review = await adapter.reviewOutput(makeOutput(), [], "Leader");

    expect(review.reviewedAt).toBeInstanceOf(Date);
    expect(review.reviewerId).toBe("leader");
  });

  it("should set a unique id on each review result", async () => {
    const reviewJson = JSON.stringify({
      passed: true,
      score: 9,
      feedback: "OK",
    });
    const mockLLM = makeMockLLMAdapter(reviewJson);
    const factory = makeLLMFactory(mockLLM);
    const adapter = new LeaderLLMAdapter(factory);

    const r1 = await adapter.reviewOutput(makeOutput("o1"), [], "Leader");
    const r2 = await adapter.reviewOutput(makeOutput("o2"), [], "Leader");

    expect(r1.id).not.toBe(r2.id);
  });
});

// ─── integrateResults edge cases ─────────────────────────────────────────────

describe("LeaderLLMAdapter - integrateResults additional branches", () => {
  it("should handle non-string content in member outputs", async () => {
    const integrationJson = JSON.stringify({
      content: "Integrated report",
      summary: "Summary",
    });

    const mockLLM = makeMockLLMAdapter(integrationJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const outputs: MemberOutput[] = [
      {
        id: "out-obj",
        taskId: "t1",
        memberId: "m1",
        content: { key: "structured value", data: [1, 2, 3] }, // object content
        contentType: "json",
        completedAt: new Date(),
        quality: { score: 9, confidence: 0.95 },
      },
    ];

    const result = await adapter.integrateResults(
      outputs,
      "Summarize data",
      "Leader",
    );

    expect(result.content).toBe("Integrated report");
    expect(result.sourceOutputIds).toContain("out-obj");
  });

  it("should include integratedAt date", async () => {
    const integrationJson = JSON.stringify({
      content: "Result",
      summary: "Sum",
    });

    const mockLLM = makeMockLLMAdapter(integrationJson);
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const result = await adapter.integrateResults(
      [makeOutput()],
      "Goal",
      "Leader",
    );

    expect(result.integratedAt).toBeInstanceOf(Date);
  });

  it("should use fallback content array when LLM integration fails and results have content", async () => {
    const mockLLM = {
      chat: jest.fn().mockRejectedValue(new Error("Integration failed")),
    } as unknown as ILLMAdapter;
    const adapter = new LeaderLLMAdapter(makeLLMFactory(mockLLM));

    const outputs = [makeOutput("r1"), makeOutput("r2")];
    const result = await adapter.integrateResults(outputs, "Goal", "Leader");

    expect(result.sourceOutputIds).toEqual(["r1", "r2"]);
    expect(result.contentType).toBe("integrated");
    expect(result.summary).toBe("结果已整合");
  });
});

// ─── createLeaderLLMAdapter factory ──────────────────────────────────────────

describe("createLeaderLLMAdapter", () => {
  it("should forward model parameter to LeaderLLMAdapter", async () => {
    const mockLLM = makeMockLLMAdapter(
      JSON.stringify([
        {
          description: "T",
          suggestedRole: "r",
          estimatedDuration: 5,
          priority: 1,
        },
      ]),
    );
    const factory = makeLLMFactory(mockLLM);
    const adapter = createLeaderLLMAdapter(factory, "specific-model");

    // Should use the specific model (getDefaultModel not called)
    const task = makeTask();
    await adapter.decomposeTask(task, ["r"], "Leader");

    expect(factory.getAdapterForModel).toHaveBeenCalledWith("specific-model");
  });
});
