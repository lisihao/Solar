/**
 * A2ATeamMemberAdapter Tests
 */

import { Logger } from "@nestjs/common";
import { A2ATeamMemberAdapter } from "../a2a-team-member-adapter";
import { A2AAgentCard, A2ATaskStatus } from "../../a2a.types";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ===================== Fixtures =====================

function buildAgentCard(overrides: Partial<A2AAgentCard> = {}): A2AAgentCard {
  return {
    name: "Test Research Agent",
    description: "An external agent for deep research tasks",
    url: "https://external-agent.example.com/a2a/tasks",
    provider: {
      organization: "ExternalCo",
      url: "https://external-agent.example.com",
    },
    version: "2.1.0",
    capabilities: {
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: false,
    },
    authentication: {
      schemes: ["Bearer"],
    },
    defaultInputModes: ["text", "text/plain"],
    defaultOutputModes: ["text/markdown"],
    skills: [
      {
        id: "research-skill",
        name: "Research",
        description: "Conducts deep research on topics",
        tags: ["research", "analysis"],
      },
      {
        id: "summary-skill",
        name: "Summary",
        description: "Summarizes complex information",
        tags: ["summary"],
      },
    ],
    ...overrides,
  };
}

describe("A2ATeamMemberAdapter", () => {
  let agentCard: A2AAgentCard;

  beforeEach(() => {
    agentCard = buildAgentCard();
  });

  afterEach(() => jest.clearAllMocks());

  // ===================== Constructor =====================

  describe("constructor", () => {
    it("creates adapter with correct name from agent card", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.name).toBe("Test Research Agent");
    });

    it("creates adapter with model derived from version", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.model).toBe("external-a2a-2.1.0");
    });

    it("generates a unique id when none is provided", () => {
      const a1 = new A2ATeamMemberAdapter(agentCard);
      const a2 = new A2ATeamMemberAdapter(agentCard);
      expect(a1.id).not.toBe(a2.id);
      expect(a1.id).toMatch(/^a2a-member-/);
    });

    it("uses provided id from options", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard, {
        id: "custom-member-id",
      });
      expect(adapter.id).toBe("custom-member-id");
    });

    it("uses provided status from options", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard, {
        status: "executing",
      });
      expect(adapter.status).toBe("executing");
    });

    it("defaults to idle status when not provided", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.status).toBe("idle");
    });

    it("maps skills from agent card", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.skills).toEqual(["research-skill", "summary-skill"]);
    });

    it("has empty tools (external agents manage their own tools)", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.tools).toEqual([]);
    });

    it("sets persona to agent card description", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.persona).toBe(agentCard.description);
    });

    it("sets workStyle to external agent defaults", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.workStyle).toMatchObject({
        thinkingDepth: "standard",
        outputStyle: "balanced",
        collaborationStyle: "independent",
        riskTolerance: "conservative",
      });
    });

    it("stores metadata with type a2a-external and agent URL", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.metadata?.type).toBe("a2a-external");
      expect(adapter.metadata?.agentUrl).toBe(
        "https://external-agent.example.com/a2a/tasks",
      );
      expect(adapter.metadata?.provider).toEqual(agentCard.provider);
      expect(adapter.metadata?.version).toBe("2.1.0");
    });

    it("handles agent card with no skills gracefully", () => {
      const card = buildAgentCard({ skills: [] });
      const adapter = new A2ATeamMemberAdapter(card);
      expect(adapter.skills).toEqual([]);
    });
  });

  // ===================== Role (ExternalA2ARole) =====================

  describe("role", () => {
    it("creates role with id derived from agent name", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.id).toBe("a2a-test-research-agent");
    });

    it("creates role with multiple words in name (spaces replaced with hyphens)", () => {
      const card = buildAgentCard({ name: "My Awesome Agent" });
      const adapter = new A2ATeamMemberAdapter(card);
      expect(adapter.role.id).toBe("a2a-my-awesome-agent");
    });

    it("role type is always 'member'", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.type).toBe("member");
    });

    it("role has correct name and description", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.name).toBe(agentCard.name);
      expect(adapter.role.description).toBe(agentCard.description);
    });

    it("role coreSkills maps from agent card skills", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.coreSkills).toEqual([
        "research-skill",
        "summary-skill",
      ]);
    });

    it("role optionalSkills is empty", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.optionalSkills).toEqual([]);
    });

    it("role coreTools and optionalTools are empty", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.coreTools).toEqual([]);
      expect(adapter.role.optionalTools).toEqual([]);
    });

    it("role responsibilities are derived from skill descriptions", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.responsibilities).toContain(
        "Conducts deep research on topics",
      );
      expect(adapter.role.responsibilities).toContain(
        "Summarizes complex information",
      );
    });

    it("role limitations include three standard restrictions", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.limitations).toHaveLength(3);
      expect(adapter.role.limitations[0]).toContain(
        "Cannot act as team leader",
      );
    });

    it("role systemPromptTemplate uses agent description", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.systemPromptTemplate).toBe(agentCard.description);
    });

    it("role metadata includes provider, version, url, capabilities", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.role.metadata).toMatchObject({
        provider: agentCard.provider,
        version: agentCard.version,
        url: agentCard.url,
        capabilities: agentCard.capabilities,
      });
    });
  });

  // ===================== isLeader =====================

  describe("isLeader()", () => {
    it("always returns false — A2A agents cannot be team leaders", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.isLeader()).toBe(false);
    });
  });

  // ===================== hasSkill =====================

  describe("hasSkill()", () => {
    it("returns true when agent has the skill", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.hasSkill("research-skill")).toBe(true);
      expect(adapter.hasSkill("summary-skill")).toBe(true);
    });

    it("returns false when agent does not have the skill", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.hasSkill("unknown-skill")).toBe(false);
    });

    it("returns false for empty string skill id", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.hasSkill("")).toBe(false);
    });
  });

  // ===================== hasTool =====================

  describe("hasTool()", () => {
    it("always returns false — external agents manage their own tools", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.hasTool("any-tool")).toBe(false);
      expect(adapter.hasTool("web-search")).toBe(false);
      expect(adapter.hasTool("")).toBe(false);
    });
  });

  // ===================== getSystemPrompt =====================

  describe("getSystemPrompt()", () => {
    it("returns the agent card description as system prompt", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.getSystemPrompt()).toBe(agentCard.description);
    });

    it("reflects updates to description correctly", () => {
      const card = buildAgentCard({
        description: "Custom specialized description for testing",
      });
      const adapter = new A2ATeamMemberAdapter(card);
      expect(adapter.getSystemPrompt()).toBe(
        "Custom specialized description for testing",
      );
    });
  });

  // ===================== updateStatusFromA2ATask =====================

  describe("updateStatusFromA2ATask()", () => {
    it("maps PENDING to 'waiting'", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      adapter.updateStatusFromA2ATask(A2ATaskStatus.PENDING);
      expect(adapter.status).toBe("waiting");
    });

    it("maps RUNNING to 'executing'", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      adapter.updateStatusFromA2ATask(A2ATaskStatus.RUNNING);
      expect(adapter.status).toBe("executing");
    });

    it("maps COMPLETED to 'completed'", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      adapter.updateStatusFromA2ATask(A2ATaskStatus.COMPLETED);
      expect(adapter.status).toBe("completed");
    });

    it("maps FAILED to 'failed'", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      adapter.updateStatusFromA2ATask(A2ATaskStatus.FAILED);
      expect(adapter.status).toBe("failed");
    });

    it("maps CANCELLED to 'failed'", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      adapter.updateStatusFromA2ATask(A2ATaskStatus.CANCELLED);
      expect(adapter.status).toBe("failed");
    });

    it("maps unknown status to 'idle' with a warning", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      // Cast an unknown value
      adapter.updateStatusFromA2ATask("UNKNOWN_STATUS" as A2ATaskStatus);
      expect(adapter.status).toBe("idle");
    });

    it("logs debug when status changes", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const adapter = new A2ATeamMemberAdapter(agentCard);
      // starts as 'idle'; change to 'executing'
      adapter.updateStatusFromA2ATask(A2ATaskStatus.RUNNING);
      expect(debugSpy).toHaveBeenCalled();
    });

    it("does NOT log debug when status remains the same", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard, {
        status: "waiting",
      });
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      // Set to same waiting status
      adapter.updateStatusFromA2ATask(A2ATaskStatus.PENDING);
      // Status didn't change (was already 'waiting'), so no debug log
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("can update status multiple times", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      adapter.updateStatusFromA2ATask(A2ATaskStatus.PENDING);
      expect(adapter.status).toBe("waiting");
      adapter.updateStatusFromA2ATask(A2ATaskStatus.RUNNING);
      expect(adapter.status).toBe("executing");
      adapter.updateStatusFromA2ATask(A2ATaskStatus.COMPLETED);
      expect(adapter.status).toBe("completed");
    });
  });

  // ===================== getAgentCard =====================

  describe("getAgentCard()", () => {
    it("returns the original agent card", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.getAgentCard()).toEqual(agentCard);
    });

    it("returns the same reference", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.getAgentCard()).toBe(agentCard);
    });
  });

  // ===================== getAgentUrl =====================

  describe("getAgentUrl()", () => {
    it("returns the agent card url", () => {
      const adapter = new A2ATeamMemberAdapter(agentCard);
      expect(adapter.getAgentUrl()).toBe(
        "https://external-agent.example.com/a2a/tasks",
      );
    });

    it("reflects the correct url from different agent cards", () => {
      const card = buildAgentCard({
        url: "https://different-agent.example.com/a2a",
      });
      const adapter = new A2ATeamMemberAdapter(card);
      expect(adapter.getAgentUrl()).toBe(
        "https://different-agent.example.com/a2a",
      );
    });
  });
});
