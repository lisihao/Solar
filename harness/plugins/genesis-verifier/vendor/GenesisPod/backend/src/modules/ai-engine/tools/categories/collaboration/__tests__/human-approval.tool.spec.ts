import { HumanApprovalTool, HumanApprovalInput } from "../human-approval.tool";
import { HumanApprovalPrimitiveService } from "../human-approval-primitive.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock factory
// ============================================================================

const mockPrisma = {
  $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
  longTermMemory: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "human-approval",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("HumanApprovalTool", () => {
  let tool: HumanApprovalTool;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Wrap the mock prisma in the REAL primitive so the existing prisma-call
    // assertions still hold (the tool now delegates store/poll/cleanup to it).
    tool = new HumanApprovalTool(
      new HumanApprovalPrimitiveService(mockPrisma as never),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for type:confirm with a valid prompt", () => {
      expect(
        tool.validateInput({
          type: "confirm",
          prompt: "Do you want to proceed?",
        }),
      ).toBe(true);
    });

    it("should return true for type:choose with valid choices", () => {
      expect(
        tool.validateInput({
          type: "choose",
          prompt: "Select a style",
          options: {
            choices: [
              { id: "modern", label: "Modern" },
              { id: "classic", label: "Classic" },
            ],
          },
        }),
      ).toBe(true);
    });

    it("should return true for type:input with a valid prompt", () => {
      expect(
        tool.validateInput({
          type: "input",
          prompt: "Please provide additional details",
        }),
      ).toBe(true);
    });

    it("should return true for type:review with a valid prompt", () => {
      expect(
        tool.validateInput({
          type: "review",
          prompt: "Please review this document",
        }),
      ).toBe(true);
    });

    it("should return false for an invalid type", () => {
      expect(
        tool.validateInput({
          type: "unknown" as HumanApprovalInput["type"],
          prompt: "Some prompt",
        }),
      ).toBe(false);
    });

    it("should return false when prompt is empty string", () => {
      expect(
        tool.validateInput({
          type: "confirm",
          prompt: "",
        }),
      ).toBe(false);
    });

    it("should return false when prompt is whitespace only", () => {
      expect(
        tool.validateInput({
          type: "confirm",
          prompt: "   ",
        }),
      ).toBe(false);
    });

    it("should return false for type:choose without choices", () => {
      expect(
        tool.validateInput({
          type: "choose",
          prompt: "Pick one",
        }),
      ).toBe(false);
    });

    it("should return false for type:choose with empty choices array", () => {
      expect(
        tool.validateInput({
          type: "choose",
          prompt: "Pick one",
          options: { choices: [] },
        }),
      ).toBe(false);
    });

    it("should return false for type:choose with a choice missing id or label", () => {
      expect(
        tool.validateInput({
          type: "choose",
          prompt: "Pick one",
          options: {
            choices: [{ id: "", label: "Option A" }],
          },
        }),
      ).toBe(false);
    });

    it("should return false for type:choose with a choice missing label", () => {
      expect(
        tool.validateInput({
          type: "choose",
          prompt: "Pick one",
          options: {
            choices: [{ id: "opt-a", label: "" }],
          },
        }),
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // waitForHumanResponse - response received
  // --------------------------------------------------------------------------

  describe("response received before timeout", () => {
    it("should return approved:true and timedOut:false when findUnique returns an approved response", async () => {
      const context = createMockContext();

      // upsert stores the request; findUnique returns approved response immediately
      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve this action?",
          options: { timeout: 10000 },
        },
        context,
      );

      // Fast-forward past the 2000ms poll interval
      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.success).toBe(true);
      expect(result.data?.approved).toBe(true);
      expect(result.data?.timedOut).toBe(false);
    });

    it("should return approved:false and timedOut:false when findUnique returns a rejected response", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: false },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve this action?",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.approved).toBe(false);
      expect(result.data?.timedOut).toBe(false);
    });

    it("should include the response choice for type:choose when approved", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true, choice: "modern" },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "choose",
          prompt: "Select a style",
          options: {
            choices: [
              { id: "modern", label: "Modern" },
              { id: "classic", label: "Classic" },
            ],
            timeout: 10000,
          },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.approved).toBe(true);
      expect(result.data?.response?.choice).toBe("modern");
    });

    it("should include the response input for type:input when approved", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true, input: { text: "Custom user input" } },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "input",
          prompt: "Please provide feedback",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.approved).toBe(true);
      expect(result.data?.response?.input).toEqual({
        text: "Custom user input",
      });
    });

    it("should include the response feedback for type:review when approved", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true, feedback: "Looks great, approved!" },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "review",
          prompt: "Review this document",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.approved).toBe(true);
      expect(result.data?.response?.feedback).toBe("Looks great, approved!");
    });

    it("should call deleteMany for both request and response keys after response is found", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Proceed?",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();
      await executePromise;

      // cleanup batches both keys into one deleteMany({ key: { in: [...] } })
      expect(mockPrisma.longTermMemory.deleteMany).toHaveBeenCalledTimes(1);
    });

    it("should call upsert once to store the approval request", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Proceed?",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();
      await executePromise;

      expect(mockPrisma.longTermMemory.upsert).toHaveBeenCalledTimes(1);
    });

    it("should store request with correct key format containing the requestId", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Proceed?",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();
      await executePromise;

      const upsertCall = mockPrisma.longTermMemory.upsert.mock.calls[0][0];
      // REQUEST_KEY format: approval:request:{requestId}
      expect(upsertCall.where.userId_key.key).toMatch(/^approval:request:.+/);
    });

    it("should poll findUnique with correct response key format", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Proceed?",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();
      await executePromise;

      const findUniqueCall =
        mockPrisma.longTermMemory.findUnique.mock.calls[0][0];
      // RESPONSE_KEY format: approval:response:{requestId}
      expect(findUniqueCall.where.userId_key.key).toMatch(
        /^approval:response:.+/,
      );
    });

    it("should include metadata with requestId, requestedAt, and responseTime", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue({
        value: { approved: true },
      });
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 1 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Proceed?",
          options: { timeout: 10000 },
        },
        context,
      );

      await jest.runAllTimersAsync();
      const result = await executePromise;

      expect(result.data?.metadata?.requestId).toBeTruthy();
      expect(result.data?.metadata?.requestedAt).toBeInstanceOf(Date);
      expect(typeof result.data?.metadata?.responseTime).toBe("number");
    });
  });

  // --------------------------------------------------------------------------
  // Timeout behaviour
  // --------------------------------------------------------------------------

  describe("timeout behaviour", () => {
    it("should return timedOut:true when findUnique always returns null", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      // Never returns a response
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve?",
          options: { timeout: 100 }, // very short timeout
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.success).toBe(true);
      expect(result.data?.timedOut).toBe(true);
    });

    it("should return approved:true on timeout when defaultAction is approve", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve?",
          options: { timeout: 100, defaultAction: "approve" },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.timedOut).toBe(true);
      expect(result.data?.approved).toBe(true);
    });

    it("should return approved:false on timeout when defaultAction is reject", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve?",
          options: { timeout: 100, defaultAction: "reject" },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.timedOut).toBe(true);
      expect(result.data?.approved).toBe(false);
    });

    it("should default to approved:false on timeout for type:confirm without defaultAction", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve without default?",
          options: { timeout: 100 },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.timedOut).toBe(true);
      expect(result.data?.approved).toBe(false);
    });

    it("should default to approved:true on timeout for type:input without defaultAction", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "input",
          prompt: "Enter something",
          options: { timeout: 100 },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.timedOut).toBe(true);
      expect(result.data?.approved).toBe(true);
    });

    it("should default to approved:true on timeout for type:review without defaultAction", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "review",
          prompt: "Review this",
          options: { timeout: 100 },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.timedOut).toBe(true);
      expect(result.data?.approved).toBe(true);
    });

    it("should default to approved:true on timeout for type:choose without defaultAction", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "choose",
          prompt: "Pick one",
          options: {
            choices: [
              { id: "a", label: "Option A" },
              { id: "b", label: "Option B" },
            ],
            timeout: 100,
          },
        },
        context,
      );

      await jest.runAllTimersAsync();

      const result = await executePromise;

      expect(result.data?.timedOut).toBe(true);
      expect(result.data?.approved).toBe(true);
    });

    it("should call deleteMany for request key cleanup on timeout", async () => {
      const context = createMockContext();

      mockPrisma.longTermMemory.upsert.mockResolvedValue({});
      mockPrisma.longTermMemory.findUnique.mockResolvedValue(null);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValue({ count: 0 });

      const executePromise = tool.execute(
        {
          type: "confirm",
          prompt: "Approve?",
          options: { timeout: 100 },
        },
        context,
      );

      await jest.runAllTimersAsync();
      await executePromise;

      // On timeout, cleanup([requestKey]) → one deleteMany with key IN [requestKey]
      expect(mockPrisma.longTermMemory.deleteMany).toHaveBeenCalledTimes(1);
      const deleteCall = mockPrisma.longTermMemory.deleteMany.mock.calls[0][0];
      expect(deleteCall.where.key.in[0]).toMatch(/^approval:request:.+/);
    });
  });
});
