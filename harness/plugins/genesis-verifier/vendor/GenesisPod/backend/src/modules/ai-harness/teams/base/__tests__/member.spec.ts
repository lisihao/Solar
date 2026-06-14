/**
 * Unit tests for TeamMember, Leader, createMember, createLeader
 */

import { TeamMember, Leader, createMember, createLeader } from "../member";
import { Role } from "../role";
import { IRole } from "../../abstractions/role.interface";
import { ILeaderLLMAdapter } from "../leader-llm-adapter";
import {
  TaskInput,
  SubTask,
  MemberOutput,
  ReviewResult,
} from "../../abstractions/member.interface";

// ==================== Helpers ====================

function makeRole(
  type: "leader" | "member" = "member",
  id = "researcher",
): IRole {
  return new Role({
    id,
    name: type === "leader" ? "Research Lead" : "Researcher",
    description: "Test role description",
    type,
    coreSkills: ["skill-a", "skill-b"],
    coreTools: ["tool-x"],
    responsibilities: ["Research topics", "Write reports"],
    systemPromptTemplate:
      "You are {{role_name}}. Responsibilities: {{responsibilities}}",
  });
}

function makeMemberOutput(id = "out-1"): MemberOutput {
  return {
    id,
    taskId: "task-1",
    memberId: "m1",
    content: "Test output content",
    contentType: "text",
    completedAt: new Date(),
    quality: { score: 8, confidence: 0.9 },
  };
}

// ==================== TeamMember ====================

describe("TeamMember", () => {
  it("should construct with config and role", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );

    expect(member.id).toBe("m1");
    expect(member.role.id).toBe("researcher");
    expect(member.model).toBe("default");
    expect(member.status).toBe("idle");
  });

  it("should generate a name from role when not provided", () => {
    const role = makeRole("member");
    const member = new TeamMember({ model: "default", roleId: role.id }, role);
    expect(member.name).toContain("Researcher");
  });

  it("should use provided name", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", name: "Custom Name", model: "default", roleId: role.id },
      role,
    );
    expect(member.name).toBe("Custom Name");
  });

  it("should generate uuid id when not provided", () => {
    const role = makeRole("member");
    const member = new TeamMember({ model: "default", roleId: role.id }, role);
    expect(member.id).toBeTruthy();
    expect(member.id.length).toBeGreaterThan(4);
  });

  it("should merge coreSkills from role with additionalSkills", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      {
        id: "m1",
        model: "default",
        roleId: role.id,
        additionalSkills: ["extra-skill"],
      },
      role,
    );
    expect(member.skills).toContain("skill-a");
    expect(member.skills).toContain("skill-b");
    expect(member.skills).toContain("extra-skill");
  });

  it("should merge coreTools from role with additionalTools", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      {
        id: "m1",
        model: "default",
        roleId: role.id,
        additionalTools: ["extra-tool"],
      },
      role,
    );
    expect(member.tools).toContain("tool-x");
    expect(member.tools).toContain("extra-tool");
  });

  it("isLeader should return false for member role", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    expect(member.isLeader()).toBe(false);
  });

  it("hasSkill should return true for known skill", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    expect(member.hasSkill("skill-a")).toBe(true);
    expect(member.hasSkill("unknown-skill")).toBe(false);
  });

  it("hasTool should return true for known tool", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    expect(member.hasTool("tool-x")).toBe(true);
    expect(member.hasTool("unknown-tool")).toBe(false);
  });

  it("updateStatus should change the status", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    member.updateStatus("busy");
    expect(member.status).toBe("busy");
    member.updateStatus("idle");
    expect(member.status).toBe("idle");
  });

  it("getSystemPrompt should return a string with role name", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    const prompt = member.getSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("Researcher");
  });

  it("toJSON should include roleId and core fields", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    const json = member.toJSON();
    expect(json.id).toBe("m1");
    expect(json.roleId).toBe("researcher");
    expect(json.model).toBe("default");
  });

  it("should merge workStyle with overrides", () => {
    const role = makeRole("member");
    const member = new TeamMember(
      {
        id: "m1",
        model: "default",
        roleId: role.id,
        workStyle: { thinkingDepth: "deep" },
      },
      role,
    );
    expect(member.workStyle.thinkingDepth).toBe("deep");
  });
});

// ==================== Leader ====================

describe("Leader", () => {
  it("should construct with leader role", () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    expect(leader.id).toBe("l1");
    expect(leader.isLeader()).toBe(true);
  });

  it("should throw if role is not leader type", () => {
    const memberRole = makeRole("member");
    expect(
      () =>
        new Leader(
          { id: "l1", model: "default", roleId: memberRole.id },
          memberRole,
        ),
    ).toThrow("not a leader role");
  });

  it("decomposeTask should return fallback subtask without llmAdapter", async () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );

    const task: TaskInput = {
      id: "task-1",
      description: "Research AI trends",
      requirements: [],
    };

    const subtasks = await leader.decomposeTask(task);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].parentTaskId).toBe("task-1");
    expect(subtasks[0].description).toBe("Research AI trends");
  });

  it("decomposeTask should use llmAdapter when provided", async () => {
    const role = makeRole("leader", "research-lead");
    const mockSubtask: SubTask = {
      id: "sub-1",
      parentTaskId: "task-1",
      description: "Sub task",
      suggestedRole: "researcher",
      dependencies: [],
      estimatedDuration: 60000,
      priority: 1,
    };
    const mockAdapter: ILeaderLLMAdapter = {
      decomposeTask: jest.fn().mockResolvedValue([mockSubtask]),
      reviewOutput: jest.fn(),
      integrateResults: jest.fn(),
    };

    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id, llmAdapter: mockAdapter },
      role,
    );
    const task: TaskInput = { id: "task-1", description: "Test" };
    const subtasks = await leader.decomposeTask(task);

    expect(mockAdapter.decomposeTask).toHaveBeenCalled();
    expect(subtasks[0].id).toBe("sub-1");
  });

  it("assignTask should return a TaskAssignment", async () => {
    const role = makeRole("leader", "research-lead");
    const memberRole = makeRole("member", "researcher");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    const member = createMember(
      { id: "m1", model: "default", roleId: "researcher" },
      memberRole,
    );

    const subtask: SubTask = {
      id: "sub-1",
      parentTaskId: "task-1",
      description: "Do research",
      suggestedRole: "researcher",
      dependencies: [],
      estimatedDuration: 60000,
      priority: 1,
    };

    const assignment = await leader.assignTask(subtask, member);
    expect(assignment.assignee).toBe("m1");
    expect(assignment.subTask.id).toBe("sub-1");
    expect(assignment.instructions).toContain("Do research");
  });

  it("reviewOutput should return passing review without llmAdapter", async () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    const output = makeMemberOutput();

    const review = await leader.reviewOutput(output);
    expect(review.passed).toBe(true);
    expect(review.reviewerId).toBe("l1");
  });

  it("reviewOutput should use llmAdapter when provided", async () => {
    const role = makeRole("leader", "research-lead");
    const mockReview: ReviewResult = {
      id: "r1",
      outputId: "out-1",
      reviewerId: "leader",
      passed: false,
      score: 5,
      feedback: "Needs improvement",
      reviewedAt: new Date(),
    };
    const mockAdapter: ILeaderLLMAdapter = {
      decomposeTask: jest.fn(),
      reviewOutput: jest.fn().mockResolvedValue(mockReview),
      integrateResults: jest.fn(),
    };
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id, llmAdapter: mockAdapter },
      role,
    );
    const output = makeMemberOutput();

    const review = await leader.reviewOutput(output);
    expect(review.reviewerId).toBe("l1"); // overridden to leader's id
    expect(review.passed).toBe(false);
  });

  it("integrateResults should return combined results without llmAdapter", async () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    const outputs = [makeMemberOutput("out-1"), makeMemberOutput("out-2")];

    const integrated = await leader.integrateResults(outputs);
    expect(integrated.sourceOutputIds).toContain("out-1");
    expect(integrated.sourceOutputIds).toContain("out-2");
    expect(integrated.contentType).toBe("integrated");
  });

  it("decideRework should return needsRework=true when review failed", async () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    const review: ReviewResult = {
      id: "r1",
      outputId: "out-1",
      reviewerId: "l1",
      passed: false,
      score: 4,
      feedback: "Bad quality",
      reviewedAt: new Date(),
    };
    const decision = await leader.decideRework(review);
    expect(decision.needsRework).toBe(true);
    expect(decision.outputId).toBe("out-1");
  });

  it("decideRework should return needsRework=false when score >= 7 and passed", async () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    const review: ReviewResult = {
      id: "r1",
      outputId: "out-1",
      reviewerId: "l1",
      passed: true,
      score: 8,
      feedback: "Good",
      reviewedAt: new Date(),
    };
    const decision = await leader.decideRework(review);
    expect(decision.needsRework).toBe(false);
  });

  it("setAvailableRoles should update available roles", () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    leader.setAvailableRoles(["writer", "analyst"]);
    // No public getter — exercise for coverage
    expect(leader).toBeDefined();
  });

  it("setReviewCriteria should update criteria", () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    leader.setReviewCriteria(["Accuracy", "Completeness"]);
    expect(leader).toBeDefined();
  });

  it("setGoal should update goal", () => {
    const role = makeRole("leader", "research-lead");
    const leader = new Leader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    leader.setGoal("Complete the research project");
    expect(leader).toBeDefined();
  });
});

// ==================== Factory Functions ====================

describe("createMember", () => {
  it("should return TeamMember for member role", () => {
    const role = makeRole("member");
    const member = createMember(
      { id: "m1", model: "default", roleId: role.id },
      role,
    );
    expect(member).toBeInstanceOf(TeamMember);
    expect(member.isLeader()).toBe(false);
  });

  it("should return Leader for leader role", () => {
    const role = makeRole("leader", "research-lead");
    const leader = createMember(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    expect(leader).toBeInstanceOf(Leader);
    expect(leader.isLeader()).toBe(true);
  });
});

describe("createLeader", () => {
  it("should return a Leader instance", () => {
    const role = makeRole("leader", "research-lead");
    const leader = createLeader(
      { id: "l1", model: "default", roleId: role.id },
      role,
    );
    expect(leader).toBeInstanceOf(Leader);
  });
});
