import {
  ConsensusMechanismTool,
  ConsensusProposal,
  Voter,
} from "../consensus-mechanism.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "consensus-mechanism",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildProposal(
  overrides: Partial<ConsensusProposal> = {},
): ConsensusProposal {
  return {
    proposalId: "prop-test-001",
    title: "Should we proceed with plan A?",
    description: "Voting on adopting plan A",
    voters: [
      { voterId: "agent-1" },
      { voterId: "agent-2" },
      { voterId: "agent-3" },
    ],
    strategy: "MAJORITY",
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("ConsensusMechanismTool", () => {
  let tool: ConsensusMechanismTool;

  beforeEach(() => {
    // Fresh instance so proposal store is clean
    tool = new ConsensusMechanismTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid CREATE_PROPOSAL operation", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal(),
        }),
      ).toBe(true);
    });

    it("should return false for CREATE_PROPOSAL without a title", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ title: "" }),
        }),
      ).toBe(false);
    });

    it("should return false for CREATE_PROPOSAL with empty voters array", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ voters: [] }),
        }),
      ).toBe(false);
    });

    it("should return false for CREATE_PROPOSAL without a strategy", () => {
      const proposal = buildProposal();
      // Remove strategy by using spread to omit it
      const { strategy: _omit, ...noStrategy } = proposal;
      expect(
        tool.validateInput({
          operation: "CREATE_PROPOSAL",
          proposal: noStrategy as ConsensusProposal,
        }),
      ).toBe(false);
    });

    it("should return false for CAST_VOTE without proposalId", () => {
      expect(
        tool.validateInput({
          operation: "CAST_VOTE",
          vote: { voterId: "agent-1", value: "APPROVE" },
        }),
      ).toBe(false);
    });

    it("should return false for CAST_VOTE without voterId", () => {
      expect(
        tool.validateInput({
          operation: "CAST_VOTE",
          proposalId: "prop-001",
          vote: { voterId: "", value: "APPROVE" },
        }),
      ).toBe(false);
    });

    it("should return true for CAST_VOTE with all required fields", () => {
      expect(
        tool.validateInput({
          operation: "CAST_VOTE",
          proposalId: "prop-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        }),
      ).toBe(true);
    });

    it("should return false for GET_STATUS without proposalId", () => {
      expect(tool.validateInput({ operation: "GET_STATUS" })).toBe(false);
    });

    it("should return true for GET_STATUS with proposalId", () => {
      expect(
        tool.validateInput({ operation: "GET_STATUS", proposalId: "prop-001" }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // CREATE_PROPOSAL
  // --------------------------------------------------------------------------

  describe("CREATE_PROPOSAL", () => {
    it("should create a proposal and return success: true with OPEN status", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "CREATE_PROPOSAL", proposal: buildProposal() },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("OPEN");
      expect(result.data?.proposalId).toBeTruthy();
    });

    it("should return initial statistics with zero votes", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "CREATE_PROPOSAL", proposal: buildProposal() },
        context,
      );

      expect(result.data?.statistics?.votesReceived).toBe(0);
      expect(result.data?.statistics?.totalVoters).toBe(3);
      expect(result.data?.statistics?.approves).toBe(0);
    });

    it("should use the provided proposalId when specified", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "custom-id-999" }),
        },
        context,
      );

      expect(result.data?.proposalId).toBe("custom-id-999");
    });
  });

  // --------------------------------------------------------------------------
  // CAST_VOTE
  // --------------------------------------------------------------------------

  describe("CAST_VOTE", () => {
    it("should accept a valid vote and update statistics", async () => {
      const context = createMockContext();

      // Create proposal first
      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "prop-vote-001" }),
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-vote-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.statistics?.votesReceived).toBe(1);
      expect(result.data?.statistics?.approves).toBe(1);
    });

    it("should return success: false when proposal does not exist", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "nonexistent-proposal",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("not found");
    });

    it("should reject duplicate votes from the same voter", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "prop-dupe-001" }),
        },
        context,
      );

      // First vote
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-dupe-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );

      // Duplicate vote
      const result = await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-dupe-001",
          vote: { voterId: "agent-1", value: "REJECT" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("already voted");
    });

    it("should reject votes from agents not in the voter list", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "prop-stranger-001" }),
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-stranger-001",
          vote: { voterId: "unknown-agent", value: "APPROVE" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("not in voter list");
    });
  });

  // --------------------------------------------------------------------------
  // GET_STATUS
  // --------------------------------------------------------------------------

  describe("GET_STATUS", () => {
    it("should return the current proposal status and statistics", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "prop-status-001" }),
        },
        context,
      );

      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-status-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );

      const result = await tool.execute(
        { operation: "GET_STATUS", proposalId: "prop-status-001" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("OPEN");
      expect(result.data?.statistics?.votesReceived).toBe(1);
    });

    it("should return success: false for a non-existent proposal", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "GET_STATUS", proposalId: "ghost-proposal" },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // CLOSE_VOTING and GET_RESULT
  // --------------------------------------------------------------------------

  describe("CLOSE_VOTING and GET_RESULT", () => {
    it("should close voting and return a result with consensusReached information", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "prop-close-001" }),
        },
        context,
      );

      // Cast enough votes for majority
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-close-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-close-001",
          vote: { voterId: "agent-2", value: "APPROVE" },
        },
        context,
      );

      const closeResult = await tool.execute(
        { operation: "CLOSE_VOTING", proposalId: "prop-close-001" },
        context,
      );

      expect(closeResult.data?.success).toBe(true);
      expect(closeResult.data?.result).toBeDefined();
      expect(typeof closeResult.data?.result?.consensusReached).toBe("boolean");
    });

    it("should reflect MAJORITY consensus when more than half approve", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({
            proposalId: "prop-majority-001",
            strategy: "MAJORITY",
          }),
        },
        context,
      );

      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-majority-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-majority-001",
          vote: { voterId: "agent-2", value: "APPROVE" },
        },
        context,
      );
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-majority-001",
          vote: { voterId: "agent-3", value: "REJECT" },
        },
        context,
      );

      const result = await tool.execute(
        { operation: "GET_RESULT", proposalId: "prop-majority-001" },
        context,
      );

      expect(result.data?.result?.consensusReached).toBe(true);
      expect(result.data?.result?.decision).toBe("APPROVE");
    });

    it("should not reach UNANIMOUS consensus when any voter rejects", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({
            proposalId: "prop-unanimous-001",
            strategy: "UNANIMOUS",
          }),
        },
        context,
      );

      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-unanimous-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-unanimous-001",
          vote: { voterId: "agent-2", value: "APPROVE" },
        },
        context,
      );
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-unanimous-001",
          vote: { voterId: "agent-3", value: "REJECT" },
        },
        context,
      );

      const result = await tool.execute(
        { operation: "GET_RESULT", proposalId: "prop-unanimous-001" },
        context,
      );

      expect(result.data?.result?.consensusReached).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // WEIGHTED strategy
  // --------------------------------------------------------------------------

  describe("WEIGHTED strategy", () => {
    it("should apply voter weights when calculating consensus", async () => {
      const context = createMockContext();
      const weightedVoters: Voter[] = [
        { voterId: "heavyweight", weight: 10 },
        { voterId: "lightweight", weight: 1 },
      ];

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({
            proposalId: "prop-weighted-001",
            strategy: "WEIGHTED",
            voters: weightedVoters,
          }),
        },
        context,
      );

      // Heavyweight approves, lightweight rejects — weighted APPROVE should win
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-weighted-001",
          vote: { voterId: "heavyweight", value: "APPROVE" },
        },
        context,
      );
      await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-weighted-001",
          vote: { voterId: "lightweight", value: "REJECT" },
        },
        context,
      );

      const result = await tool.execute(
        { operation: "GET_RESULT", proposalId: "prop-weighted-001" },
        context,
      );

      expect(result.data?.result?.consensusReached).toBe(true);
      expect(result.data?.result?.decision).toBe("APPROVE");
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return data.success: false for an unsupported operation", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: "INVALID_OP" as "CREATE_PROPOSAL",
        },
        context,
      );

      // doExecute hits the default branch, throws, catches internally and returns
      // { success: false, ... }. BaseTool.execute() wraps it as { success: true, data: { success: false } }.
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });

    it("should return success: false for CLOSE_VOTING with non-existent proposalId", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "CLOSE_VOTING", proposalId: "ghost-prop" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });

    it("should not throw when CAST_VOTE is called on a closed proposal", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE_PROPOSAL",
          proposal: buildProposal({ proposalId: "prop-closed-001" }),
        },
        context,
      );

      await tool.execute(
        { operation: "CLOSE_VOTING", proposalId: "prop-closed-001" },
        context,
      );

      const result = await tool.execute(
        {
          operation: "CAST_VOTE",
          proposalId: "prop-closed-001",
          vote: { voterId: "agent-1", value: "APPROVE" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("closed");
    });
  });
});
