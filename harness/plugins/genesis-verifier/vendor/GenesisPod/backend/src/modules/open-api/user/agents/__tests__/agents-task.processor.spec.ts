import { Test, TestingModule } from "@nestjs/testing";
import { Job } from "bullmq";
import { AgentsTaskProcessor } from "../agents-task.processor";
import { AgentsService } from "../agents.service";
import { AgentOrchestrator } from "@/modules/ai-harness/agents/registry/agent-orchestrator";
import {
  AgentEvent,
  AgentInput,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import { AgentsTaskJobData } from "../agents-task-queue.service";

function makeJob(
  data: Partial<AgentsTaskJobData> = {},
): Job<AgentsTaskJobData> {
  return {
    id: "task-1",
    data: {
      taskId: "task-1",
      input: { prompt: "hi" } as AgentInput,
      agentId: "slides",
      userId: "user-1",
      ...data,
    },
  } as unknown as Job<AgentsTaskJobData>;
}

async function* gen(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const e of events) yield e;
}

describe("AgentsTaskProcessor", () => {
  let processor: AgentsTaskProcessor;
  let mockOrchestrator: { execute: jest.Mock };
  let mockAgentsService: {
    updateTaskStatus: jest.Mock;
    updateTaskPlan: jest.Mock;
    updateTaskResult: jest.Mock;
    saveArtifact: jest.Mock;
    publishEvent: jest.Mock;
  };

  beforeEach(async () => {
    mockOrchestrator = { execute: jest.fn() };
    mockAgentsService = {
      updateTaskStatus: jest.fn().mockResolvedValue(undefined),
      updateTaskPlan: jest.fn().mockResolvedValue(undefined),
      updateTaskResult: jest.fn().mockResolvedValue(undefined),
      saveArtifact: jest.fn().mockResolvedValue(undefined),
      publishEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsTaskProcessor,
        { provide: AgentOrchestrator, useValue: mockOrchestrator },
        { provide: AgentsService, useValue: mockAgentsService },
      ],
    }).compile();

    processor = module.get(AgentsTaskProcessor);
  });

  it("runs the full state machine: PLANNING -> EXECUTING -> COMPLETED", async () => {
    const plan = { taskId: "task-1", agentId: "slides", steps: [] } as never;
    const artifact = {
      id: "a1",
      type: "pptx",
      name: "deck.pptx",
      mimeType: "application/pptx",
      size: 1,
    } as never;
    const result = {
      success: true,
      artifacts: [],
      tokensUsed: 42,
      duration: 100,
    } as never;

    mockOrchestrator.execute.mockReturnValue(
      gen([
        { type: "plan_ready", plan },
        { type: "artifact", artifact },
        { type: "complete", result },
      ]),
    );

    const out = await processor.process(makeJob());

    expect(out).toEqual({ status: "ok" });
    expect(mockAgentsService.updateTaskStatus).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "PLANNING",
    );
    expect(mockAgentsService.updateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "EXECUTING",
    );
    expect(mockAgentsService.updateTaskPlan).toHaveBeenCalledWith(
      "task-1",
      plan,
    );
    expect(mockAgentsService.saveArtifact).toHaveBeenCalledWith(
      "task-1",
      artifact,
    );
    expect(mockAgentsService.updateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "COMPLETED",
    );
    expect(mockAgentsService.updateTaskResult).toHaveBeenCalledWith(
      "task-1",
      result,
    );
    // orchestrator called with input/agentId/userId from job data
    expect(mockOrchestrator.execute).toHaveBeenCalledWith(
      { prompt: "hi" },
      "slides",
      "user-1",
    );
  });

  it("marks FAILED on an error event from the orchestrator", async () => {
    mockOrchestrator.execute.mockReturnValue(
      gen([{ type: "error", error: "boom" }]),
    );

    const out = await processor.process(makeJob());

    expect(out).toEqual({ status: "ok" });
    expect(mockAgentsService.updateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "FAILED",
      "boom",
    );
  });

  it("marks FAILED and rethrows when execution throws (BullMQ retry)", async () => {
    mockOrchestrator.execute.mockImplementation(() => {
      // eslint-disable-next-line require-yield
      return (async function* () {
        throw new Error("orchestrator crashed");
      })();
    });

    await expect(processor.process(makeJob())).rejects.toThrow(
      "orchestrator crashed",
    );
    expect(mockAgentsService.updateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "FAILED",
      "orchestrator crashed",
    );
  });
});
