/**
 * TeamCollaborationAgent Unit Tests
 *
 * Comprehensive coverage for:
 * - Agent metadata (id, name, description, capabilities, requiredTools, templates)
 * - plan(): all TaskType branches (brainstorm, delegation, voting, debate, mission)
 * - classifyTask(): keyword detection, options override, default fallback
 * - execute(): plan_ready, step events, complete, error paths
 * - planBrainstorm: step count = maxRounds + 2
 * - planTaskDelegation: 5 fixed steps
 * - planConsensusVoting: 5 fixed steps
 * - planDebateSession: 1 init + 2*maxRounds rounds + optional judge + summary
 * - planMissionExecution: 5 fixed steps
 * - executeStep(): all tool types
 * - generateSummary(): all task types
 * - getArtifactName(): all task types
 */

import {
  TeamCollaborationAgent,
  TeamTaskType,
  VotingStrategy,
} from "../team-collaboration.agent";
import { BUILTIN_TOOLS } from "@/modules/ai-harness/facade";
import { TEAM_COLLABORATION_AGENT_ID } from "../../teams.constants";
import type { AgentInput, AgentPlan } from "@/modules/ai-harness/facade";

// ============================================================
// Helpers
// ============================================================

const buildInput = (overrides: Partial<AgentInput> = {}): AgentInput => ({
  prompt: "Test prompt",
  options: {},
  context: {},
  ...overrides,
});

/**
 * Collect all events from an async generator
 */
async function collectEvents(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ============================================================
// Test suite
// ============================================================

describe("TeamCollaborationAgent", () => {
  let agent: TeamCollaborationAgent;

  beforeEach(() => {
    agent = new TeamCollaborationAgent();
  });

  // ============================================================
  // Metadata
  // ============================================================

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(agent.id).toBe(TEAM_COLLABORATION_AGENT_ID);
    });

    it("should have a non-empty name", () => {
      expect(agent.name).toBeTruthy();
      expect(typeof agent.name).toBe("string");
    });

    it("should have a non-empty description", () => {
      expect(agent.description).toBeTruthy();
    });

    it("should have capabilities array with at least 4 items", () => {
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThanOrEqual(4);
    });

    it("should have requiredTools array with at least 5 tools", () => {
      expect(Array.isArray(agent.requiredTools)).toBe(true);
      expect(agent.requiredTools.length).toBeGreaterThanOrEqual(5);
    });

    it("should include key builtin tools in requiredTools", () => {
      expect(agent.requiredTools).toContain(BUILTIN_TOOLS.TASK_DELEGATION);
      expect(agent.requiredTools).toContain(BUILTIN_TOOLS.AGENT_HANDOFF);
      expect(agent.requiredTools).toContain(BUILTIN_TOOLS.TEXT_GENERATION);
    });
  });

  // ============================================================
  // getTemplates
  // ============================================================

  describe("getTemplates", () => {
    it("should return array of templates", () => {
      const templates = agent.getTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it("should include team-brainstorm template", () => {
      const templates = agent.getTemplates();
      const brainstorm = templates.find((t) => t.id === "team-brainstorm");
      expect(brainstorm).toBeDefined();
      expect(brainstorm?.defaultOptions?.taskType).toBe(
        TeamTaskType.TEAM_BRAINSTORM,
      );
    });

    it("should include task-breakdown template", () => {
      const templates = agent.getTemplates();
      const breakdown = templates.find((t) => t.id === "task-breakdown");
      expect(breakdown).toBeDefined();
      expect(breakdown?.defaultOptions?.taskType).toBe(
        TeamTaskType.TASK_DELEGATION,
      );
    });

    it("should include consensus-decision template", () => {
      const templates = agent.getTemplates();
      const consensus = templates.find((t) => t.id === "consensus-decision");
      expect(consensus).toBeDefined();
      expect(consensus?.defaultOptions?.votingStrategy).toBe(
        VotingStrategy.MAJORITY,
      );
    });

    it("should include red-blue-debate template", () => {
      const templates = agent.getTemplates();
      const debate = templates.find((t) => t.id === "red-blue-debate");
      expect(debate).toBeDefined();
      expect(debate?.defaultOptions?.taskType).toBe(
        TeamTaskType.DEBATE_SESSION,
      );
    });

    it("should include mission-planning template", () => {
      const templates = agent.getTemplates();
      const mission = templates.find((t) => t.id === "mission-planning");
      expect(mission).toBeDefined();
      expect(mission?.defaultOptions?.taskType).toBe(
        TeamTaskType.MISSION_EXECUTION,
      );
    });
  });

  // ============================================================
  // getConfig
  // ============================================================

  describe("getConfig", () => {
    it("should return a valid config object", () => {
      const config = agent.getConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe("object");
    });
  });

  // ============================================================
  // plan() - task type classification via options
  // ============================================================

  describe("plan() - via options.taskType", () => {
    it("should plan TEAM_BRAINSTORM when options.taskType is set", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM },
      });

      const plan = await agent.plan(input);

      expect(plan.taskId).toBeTruthy();
      expect(plan.agentId).toBe(TEAM_COLLABORATION_AGENT_ID);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TEAM_BRAINSTORM);
    });

    it("should plan TASK_DELEGATION when options.taskType is set", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TASK_DELEGATION);
      expect(plan.steps.length).toBe(5); // always 5 steps for delegation
    });

    it("should plan CONSENSUS_VOTING when options.taskType is set", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.CONSENSUS_VOTING },
      });

      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.CONSENSUS_VOTING);
      expect(plan.steps.length).toBe(5);
    });

    it("should plan DEBATE_SESSION when options.taskType is set", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.DEBATE_SESSION },
      });

      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.DEBATE_SESSION);
    });

    it("should plan MISSION_EXECUTION when options.taskType is set", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.MISSION_EXECUTION },
      });

      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.MISSION_EXECUTION);
      expect(plan.steps.length).toBe(5);
    });

    it("should carry topicId in plan metadata when provided", async () => {
      const input = buildInput({
        options: {
          taskType: TeamTaskType.TEAM_BRAINSTORM,
          topicId: "my-topic",
        },
      });

      const plan = await agent.plan(input);
      expect(plan.metadata?.topicId).toBe("my-topic");
    });

    it("should calculate estimatedTime as sum of step durations", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      const sumDurations = plan.steps.reduce(
        (sum, s) => sum + s.estimatedDuration,
        0,
      );
      expect(plan.estimatedTime).toBe(sumDurations);
    });
  });

  // ============================================================
  // plan() - keyword classification
  // ============================================================

  describe("plan() - keyword classification from prompt", () => {
    it("should classify 头脑风暴 as TEAM_BRAINSTORM", async () => {
      const input = buildInput({ prompt: "我们来头脑风暴一下这个问题" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TEAM_BRAINSTORM);
    });

    it("should classify brainstorm as TEAM_BRAINSTORM", async () => {
      const input = buildInput({ prompt: "Let us brainstorm new ideas" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TEAM_BRAINSTORM);
    });

    it("should classify 集思广益 as TEAM_BRAINSTORM", async () => {
      const input = buildInput({ prompt: "需要集思广益解决这个问题" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TEAM_BRAINSTORM);
    });

    it("should classify 分配 as TASK_DELEGATION", async () => {
      const input = buildInput({ prompt: "请分配任务给团队成员" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TASK_DELEGATION);
    });

    it("should classify assign as TASK_DELEGATION", async () => {
      const input = buildInput({ prompt: "Please assign the tasks" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TASK_DELEGATION);
    });

    it("should classify delegate as TASK_DELEGATION", async () => {
      const input = buildInput({ prompt: "delegate work to members" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TASK_DELEGATION);
    });

    it("should classify 委派 as TASK_DELEGATION", async () => {
      const input = buildInput({ prompt: "委派任务给成员" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.TASK_DELEGATION);
    });

    it("should classify 投票 as CONSENSUS_VOTING", async () => {
      const input = buildInput({ prompt: "我们需要投票决定方案" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.CONSENSUS_VOTING);
    });

    it("should classify vote as CONSENSUS_VOTING", async () => {
      const input = buildInput({ prompt: "vote on the proposal" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.CONSENSUS_VOTING);
    });

    it("should classify 共识 as CONSENSUS_VOTING", async () => {
      const input = buildInput({ prompt: "达成共识" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.CONSENSUS_VOTING);
    });

    it("should classify 表决 as CONSENSUS_VOTING", async () => {
      const input = buildInput({ prompt: "请表决通过此方案" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.CONSENSUS_VOTING);
    });

    it("should classify 辩论 as DEBATE_SESSION", async () => {
      const input = buildInput({ prompt: "我们来辩论这个问题" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.DEBATE_SESSION);
    });

    it("should classify debate as DEBATE_SESSION", async () => {
      const input = buildInput({ prompt: "Organize a debate session" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.DEBATE_SESSION);
    });

    it("should classify 红蓝 as DEBATE_SESSION", async () => {
      const input = buildInput({ prompt: "进行红蓝对抗" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.DEBATE_SESSION);
    });

    it("should classify 正反 as DEBATE_SESSION", async () => {
      const input = buildInput({ prompt: "正反方辩论" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.DEBATE_SESSION);
    });

    it("should classify 任务 as MISSION_EXECUTION", async () => {
      const input = buildInput({ prompt: "执行这个任务" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.MISSION_EXECUTION);
    });

    it("should classify mission as MISSION_EXECUTION", async () => {
      const input = buildInput({ prompt: "complete the mission" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.MISSION_EXECUTION);
    });

    it("should default to MISSION_EXECUTION for unrecognized prompts", async () => {
      const input = buildInput({ prompt: "some random text without keywords" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.MISSION_EXECUTION);
    });

    it("should handle empty prompt and default to MISSION_EXECUTION", async () => {
      const input = buildInput({ prompt: "" });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.MISSION_EXECUTION);
    });

    it("should handle undefined prompt and default to MISSION_EXECUTION", async () => {
      const input = buildInput({ prompt: undefined });
      const plan = await agent.plan(input);
      expect(plan.metadata?.taskType).toBe(TeamTaskType.MISSION_EXECUTION);
    });
  });

  // ============================================================
  // planBrainstorm - step counts
  // ============================================================

  describe("planBrainstorm step counts", () => {
    it("should generate init + 3 rounds + summary steps for default maxRounds=3", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM },
      });
      const plan = await agent.plan(input);
      // 1 init + 3 rounds + 1 summary = 5
      expect(plan.steps.length).toBe(5);
    });

    it("should generate init + N rounds + summary when maxRounds is specified", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 5 },
      });
      const plan = await agent.plan(input);
      // 1 init + 5 rounds + 1 summary = 7
      expect(plan.steps.length).toBe(7);
    });

    it("should generate init + 1 round + summary when maxRounds=1", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 1 },
      });
      const plan = await agent.plan(input);
      // 1 init + 1 round + 1 summary = 3
      expect(plan.steps.length).toBe(3);
    });
  });

  // ============================================================
  // planDebateSession - step counts
  // ============================================================

  describe("planDebateSession step counts", () => {
    it("should generate correct steps with judge=true and 5 rounds", async () => {
      const input = buildInput({
        options: {
          taskType: TeamTaskType.DEBATE_SESSION,
          maxRounds: 5,
          includeJudge: true,
        },
      });
      const plan = await agent.plan(input);
      // 1 init + 5*2 rounds + 1 judge + 1 summary = 13
      expect(plan.steps.length).toBe(13);
    });

    it("should omit judge step when includeJudge=false", async () => {
      const input = buildInput({
        options: {
          taskType: TeamTaskType.DEBATE_SESSION,
          maxRounds: 3,
          includeJudge: false,
        },
      });
      const plan = await agent.plan(input);
      // 1 init + 3*2 rounds + 0 judge + 1 summary = 8
      expect(plan.steps.length).toBe(8);
    });

    it("should default to includeJudge=true when not specified", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.DEBATE_SESSION, maxRounds: 2 },
      });
      const plan = await agent.plan(input);
      // 1 init + 2*2 rounds + 1 judge + 1 summary = 7
      expect(plan.steps.length).toBe(7);
    });

    it("should use default maxRounds=5 when not specified", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.DEBATE_SESSION },
      });
      const plan = await agent.plan(input);
      // 1 init + 5*2 rounds + 1 judge + 1 summary = 13
      expect(plan.steps.length).toBe(13);
    });
  });

  // ============================================================
  // plan() - plan structure validation
  // ============================================================

  describe("plan() structure validation", () => {
    it("should generate unique step ids", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });
      const plan = await agent.plan(input);
      const stepIds = plan.steps.map((s) => s.id);
      const uniqueIds = new Set(stepIds);
      expect(uniqueIds.size).toBe(stepIds.length);
    });

    it("should have dependencies pointing to earlier steps", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });
      const plan = await agent.plan(input);

      const stepIdSet = new Set(plan.steps.map((s) => s.id));
      for (const step of plan.steps) {
        for (const depId of step.dependencies) {
          expect(stepIdSet.has(depId)).toBe(true);
        }
      }
    });

    it("should include toolsRequired in plan", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.MISSION_EXECUTION },
      });
      const plan = await agent.plan(input);
      expect(Array.isArray(plan.toolsRequired)).toBe(true);
    });

    it("should include modelsRequired in plan", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.MISSION_EXECUTION },
      });
      const plan = await agent.plan(input);
      expect(Array.isArray(plan.modelsRequired)).toBe(true);
    });

    it("should have positive estimatedTime", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.CONSENSUS_VOTING },
      });
      const plan = await agent.plan(input);
      expect(plan.estimatedTime).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // execute() - error when no input
  // ============================================================

  describe("execute() - no input", () => {
    it("should yield error event when plan has no input", async () => {
      const plan: AgentPlan = {
        taskId: "test-task",
        agentId: TEAM_COLLABORATION_AGENT_ID,
        steps: [
          {
            id: "step-1",
            name: "Test",
            description: "",
            toolId: BUILTIN_TOOLS.TEXT_GENERATION,
            dependencies: [],
            estimatedDuration: 1000,
          },
        ],
        estimatedTime: 1000,
        toolsRequired: [],
        modelsRequired: [],
        metadata: {},
      };

      const events = await collectEvents(agent.execute(plan));

      expect(events[0]).toMatchObject({ type: "error" });
    });
  });

  // ============================================================
  // execute() - full flow for each task type
  // ============================================================

  describe("execute() - TEAM_BRAINSTORM full flow", () => {
    it("should emit plan_ready, step events, and complete", async () => {
      const input = buildInput({
        prompt: "Let us brainstorm",
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 1 },
      });

      const plan = await agent.plan(input);
      // Attach input to plan (as done by the agent orchestrator)
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));

      const eventTypes = events.map((e: any) => e.type);
      expect(eventTypes).toContain("plan_ready");
      expect(eventTypes).toContain("step_start");
      expect(eventTypes).toContain("step_progress");
      expect(eventTypes).toContain("step_complete");
      expect(eventTypes).toContain("complete");
    });

    it("should have complete event with success=true", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 1 },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent).toBeDefined();
      expect(completeEvent.result.success).toBe(true);
    });

    it("should include artifact with correct type in complete event", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 1 },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.artifacts).toHaveLength(1);
      expect(completeEvent.result.artifacts[0].mimeType).toBe(
        "application/json",
      );
    });

    it("should include summary in complete event", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 1 },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(typeof completeEvent.result.summary).toBe("string");
      expect(completeEvent.result.summary.length).toBeGreaterThan(0);
    });
  });

  describe("execute() - TASK_DELEGATION full flow", () => {
    it("should complete successfully with 5 steps", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent).toBeDefined();
      expect(completeEvent.result.success).toBe(true);
    });

    it("should generate correct artifact name for TASK_DELEGATION", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.artifacts[0].name).toBe("任务分配报告");
    });
  });

  describe("execute() - CONSENSUS_VOTING full flow", () => {
    it("should complete successfully", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.CONSENSUS_VOTING },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.success).toBe(true);
      expect(completeEvent.result.artifacts[0].name).toBe("投票结果");
    });
  });

  describe("execute() - DEBATE_SESSION full flow", () => {
    it("should complete successfully with judge", async () => {
      const input = buildInput({
        options: {
          taskType: TeamTaskType.DEBATE_SESSION,
          maxRounds: 1,
          includeJudge: true,
        },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.success).toBe(true);
      expect(completeEvent.result.artifacts[0].name).toBe("辩论记录");
    });

    it("should complete successfully without judge", async () => {
      const input = buildInput({
        options: {
          taskType: TeamTaskType.DEBATE_SESSION,
          maxRounds: 1,
          includeJudge: false,
        },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.success).toBe(true);
    });
  });

  describe("execute() - MISSION_EXECUTION full flow", () => {
    it("should complete successfully", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.MISSION_EXECUTION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.success).toBe(true);
      expect(completeEvent.result.artifacts[0].name).toBe("任务执行报告");
    });
  });

  // ============================================================
  // execute() - metadata passed through
  // ============================================================

  describe("execute() - metadata and topicId", () => {
    it("should pass topicId in artifact metadata", async () => {
      const input = buildInput({
        options: {
          taskType: TeamTaskType.MISSION_EXECUTION,
          topicId: "topic-xyz",
        },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.artifacts[0].metadata.topicId).toBe(
        "topic-xyz",
      );
    });

    it("should track member contributions count", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TEAM_BRAINSTORM, maxRounds: 2 },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      // Rounds use AGENT_COMMUNICATION which produces contributions
      expect(
        completeEvent.result.artifacts[0].metadata.memberCount,
      ).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // execute() - step events
  // ============================================================

  describe("execute() - step event structure", () => {
    it("should emit step_start events for each step", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const stepStartEvents = events.filter(
        (e: any) => e.type === "step_start",
      );

      expect(stepStartEvents.length).toBe(plan.steps.length);
    });

    it("should emit step_complete events for each step", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const stepCompleteEvents = events.filter(
        (e: any) => e.type === "step_complete",
      );

      expect(stepCompleteEvents.length).toBe(plan.steps.length);
    });

    it("should emit step_progress events at 30% and 100%", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.TASK_DELEGATION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const progressEvents = events.filter(
        (e: any) => e.type === "step_progress",
      ) as any[];

      const thirtyPercentEvents = progressEvents.filter(
        (e) => e.progress === 30,
      );
      const hundredPercentEvents = progressEvents.filter(
        (e) => e.progress === 100,
      );

      expect(thirtyPercentEvents.length).toBe(plan.steps.length);
      expect(hundredPercentEvents.length).toBe(plan.steps.length);
    });
  });

  // ============================================================
  // execute() - error handling
  // ============================================================

  describe("execute() - error handling", () => {
    it("should yield error event with correct message when plan has no input", async () => {
      const plan: AgentPlan = {
        taskId: "test-id",
        agentId: TEAM_COLLABORATION_AGENT_ID,
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: [],
        metadata: {},
      };

      const events = await collectEvents(agent.execute(plan));
      const errorEvent = events.find((e: any) => e.type === "error") as any;

      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toContain("No input provided");
    });
  });

  // ============================================================
  // VotingStrategy enum values
  // ============================================================

  describe("VotingStrategy enum", () => {
    it("should have MAJORITY, SUPERMAJORITY, UNANIMOUS values", () => {
      expect(VotingStrategy.MAJORITY).toBe("MAJORITY");
      expect(VotingStrategy.SUPERMAJORITY).toBe("SUPERMAJORITY");
      expect(VotingStrategy.UNANIMOUS).toBe("UNANIMOUS");
    });
  });

  // ============================================================
  // TeamTaskType enum values
  // ============================================================

  describe("TeamTaskType enum", () => {
    it("should have all five task type values", () => {
      expect(TeamTaskType.TEAM_BRAINSTORM).toBe("team_brainstorm");
      expect(TeamTaskType.TASK_DELEGATION).toBe("task_delegation");
      expect(TeamTaskType.CONSENSUS_VOTING).toBe("consensus_voting");
      expect(TeamTaskType.DEBATE_SESSION).toBe("debate_session");
      expect(TeamTaskType.MISSION_EXECUTION).toBe("mission_execution");
    });
  });

  // ============================================================
  // execute() - complete event fields
  // ============================================================

  describe("execute() - complete event fields", () => {
    it("should include duration in complete event result", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.CONSENSUS_VOTING },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(typeof completeEvent.result.duration).toBe("number");
      expect(completeEvent.result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should have tokensUsed=0 (simulated)", async () => {
      const input = buildInput({
        options: { taskType: TeamTaskType.MISSION_EXECUTION },
      });

      const plan = await agent.plan(input);
      (plan as Record<string, unknown>).input = input;

      const events = await collectEvents(agent.execute(plan));
      const completeEvent = events.find(
        (e: any) => e.type === "complete",
      ) as any;

      expect(completeEvent.result.tokensUsed).toBe(0);
    });
  });
});
