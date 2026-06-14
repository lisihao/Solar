/**
 * T6 (G1 动态规划) — dynamic-planning.ts 单元测试
 *
 * 直接测抽出的纯函数（tryDynamicDecomposition / leafStepIds），不经 orchestrator
 * god-class spec，避免该文件继续膨胀（pre-push god-class 看护）。
 */
import { Logger } from "@nestjs/common";
import {
  tryDynamicDecomposition,
  leafStepIds,
  PlanningEstimators,
} from "../dynamic-planning";
import { ITeam } from "../../abstractions/team.interface";
import { ITeamMember } from "../../abstractions/member.interface";
import {
  ParsedIntent,
  TaskType,
} from "../../../agents/abstractions/mission.types";
import { MissionExecutionProfile } from "../../constraints";
import { ExecutionStep } from "../orchestrator.interface";

const estimators: PlanningEstimators = {
  estimateStepDuration: () => 30000,
  estimateStepCost: () => 5,
};
const logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;

function makeMember(id: string, roleId: string, isLeader = false): ITeamMember {
  return {
    id,
    name: id,
    role: { id: roleId, name: roleId, capabilities: [] },
    skills: [],
    tools: [],
    isLeader: () => isLeader,
  } as unknown as ITeamMember;
}

describe("dynamic-planning", () => {
  const ORIG_FLAG = process.env.HARNESS_DYNAMIC_PLANNING;
  let team: ITeam;
  let leader: ITeamMember & {
    decomposeTask: jest.Mock;
    setAvailableRoles: jest.Mock;
  };
  let intent: ParsedIntent;
  let constraints: MissionExecutionProfile;

  afterEach(() => {
    if (ORIG_FLAG === undefined) delete process.env.HARNESS_DYNAMIC_PLANNING;
    else process.env.HARNESS_DYNAMIC_PLANNING = ORIG_FLAG;
    jest.clearAllMocks();
  });

  beforeEach(() => {
    const researcher = makeMember("m-researcher", "researcher");
    const writer = makeMember("m-writer", "writer");
    leader = {
      ...makeMember("leader-1", "leader", true),
      decomposeTask: jest.fn(),
      setAvailableRoles: jest.fn(),
    } as unknown as ITeamMember & {
      decomposeTask: jest.Mock;
      setAvailableRoles: jest.Mock;
    };
    const members = [leader, researcher, writer];
    team = {
      id: "team-1",
      leader,
      members,
      getMembersByRole: (roleId: string) =>
        members.filter((m) => m.role.id === roleId),
      getMemberById: (id: string) => members.find((m) => m.id === id),
    } as unknown as ITeam;
    intent = {
      id: "intent-1",
      missionId: "mission-1",
      primaryGoal: "Build a deep report",
      secondaryGoals: ["cite sources"],
      extractedInfo: { topics: [], entities: [], language: "en" },
      taskType: "research" as TaskType,
      complexity: {
        overall: "high",
        informational: "high",
        logical: "high",
        creative: "medium",
        estimatedSubTasks: 3,
        estimatedDuration: 120000,
        estimatedCost: 50,
      },
      suggestedStrategy: {
        workflowType: "parallel",
        memberConfig: [],
        needsIteration: false,
        needsHumanReview: false,
        riskFactors: [],
      },
      confidence: 0.9,
    } as ParsedIntent;
    constraints = {
      cost: {
        budget: 100,
        modelPreference: "balanced",
        allowOverBudget: false,
        warningThreshold: 80,
      },
      quality: {
        depth: "standard",
        accuracy: "prefer_evidence",
        reviewRequired: false,
        minReviewScore: 6,
        maxReworks: 2,
      },
      efficiency: {
        maxDuration: 300000,
        priority: "normal",
        allowParallel: true,
        maxParallelism: 4,
      },
    } as MissionExecutionProfile;
  });

  describe("tryDynamicDecomposition()", () => {
    it("flag OFF: returns null, never calls decomposeTask", async () => {
      delete process.env.HARNESS_DYNAMIC_PLANNING;
      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );
      expect(result).toBeNull();
      expect(leader.decomposeTask).not.toHaveBeenCalled();
    });

    it("flag ON + high complexity: builds steps from LLM decomposition", async () => {
      process.env.HARNESS_DYNAMIC_PLANNING = "true";
      leader.decomposeTask.mockResolvedValue([
        {
          id: "sub-a",
          parentTaskId: "intent-1",
          description: "gather sources",
          suggestedRole: "researcher",
          dependencies: [],
          estimatedDuration: 90000,
          priority: 1,
        },
        {
          id: "sub-b",
          parentTaskId: "intent-1",
          description: "draft report",
          suggestedRole: "writer",
          dependencies: ["sub-a"],
          estimatedDuration: 120000,
          priority: 2,
        },
      ]);

      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );

      expect(result).not.toBeNull();
      expect(leader.setAvailableRoles).toHaveBeenCalledWith(
        expect.arrayContaining(["researcher", "writer"]),
      );
      const ids = result!.map((s) => s.id);
      expect(ids).toEqual(["sub-a", "sub-b"]);
      expect(result!.find((s) => s.id === "sub-a")?.executor).toBe(
        "m-researcher",
      );
      expect(result!.find((s) => s.id === "sub-b")?.executor).toBe("m-writer");
      expect(result!.every((s) => s.type === "task")).toBe(true);
    });

    it("unknown suggestedRole falls back to leader as executor", async () => {
      process.env.HARNESS_DYNAMIC_PLANNING = "true";
      leader.decomposeTask.mockResolvedValue([
        {
          id: "s1",
          parentTaskId: "i",
          description: "x",
          suggestedRole: "nonexistent",
          dependencies: [],
          estimatedDuration: 1000,
          priority: 1,
        },
        {
          id: "s2",
          parentTaskId: "i",
          description: "y",
          suggestedRole: "researcher",
          dependencies: [],
          estimatedDuration: 1000,
          priority: 1,
        },
      ]);
      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );
      expect(result!.find((s) => s.id === "s1")?.executor).toBe("leader-1");
    });

    it("flag ON but <=1 subtask: returns null (static fallback)", async () => {
      process.env.HARNESS_DYNAMIC_PLANNING = "true";
      leader.decomposeTask.mockResolvedValue([
        {
          id: "only",
          parentTaskId: "i",
          description: "do it all",
          suggestedRole: "researcher",
          dependencies: [],
          estimatedDuration: 60000,
          priority: 1,
        },
      ]);
      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );
      expect(result).toBeNull();
    });

    it("flag ON but complexity not high/very_high: returns null", async () => {
      process.env.HARNESS_DYNAMIC_PLANNING = "true";
      intent.complexity.overall = "medium";
      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );
      expect(result).toBeNull();
      expect(leader.decomposeTask).not.toHaveBeenCalled();
    });

    it("flag ON + decomposeTask throws: returns null (static fallback)", async () => {
      process.env.HARNESS_DYNAMIC_PLANNING = "true";
      leader.decomposeTask.mockRejectedValue(new Error("LLM down"));
      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );
      expect(result).toBeNull();
    });

    it("very_high complexity is also eligible", async () => {
      process.env.HARNESS_DYNAMIC_PLANNING = "true";
      intent.complexity.overall = "very_high";
      leader.decomposeTask.mockResolvedValue([
        {
          id: "a",
          parentTaskId: "i",
          description: "a",
          suggestedRole: "researcher",
          dependencies: [],
          estimatedDuration: 1,
          priority: 1,
        },
        {
          id: "b",
          parentTaskId: "i",
          description: "b",
          suggestedRole: "writer",
          dependencies: [],
          estimatedDuration: 1,
          priority: 1,
        },
      ]);
      const result = await tryDynamicDecomposition(
        intent,
        team,
        constraints,
        estimators,
        logger,
      );
      expect(result).not.toBeNull();
    });
  });

  describe("leafStepIds()", () => {
    it("returns terminal steps (nothing depends on them)", () => {
      const steps: ExecutionStep[] = [
        {
          id: "a",
          name: "a",
          description: "",
          executor: "x",
          type: "task",
          dependencies: [],
          estimatedDuration: 1,
          estimatedCost: 1,
        },
        {
          id: "b",
          name: "b",
          description: "",
          executor: "x",
          type: "task",
          dependencies: ["a"],
          estimatedDuration: 1,
          estimatedCost: 1,
        },
        {
          id: "c",
          name: "c",
          description: "",
          executor: "x",
          type: "task",
          dependencies: ["a"],
          estimatedDuration: 1,
          estimatedCost: 1,
        },
      ];
      // b and c both depend on a → leaves are b, c
      expect(leafStepIds(steps).sort()).toEqual(["b", "c"]);
    });
  });
});
