/**
 * CalendarIntegrationTool Unit Tests
 *
 * Tests the calendar-integration tool in isolation (no external dependencies).
 * This tool uses internal mock data, so no external mocking is needed.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  CalendarIntegrationTool,
  CalendarIntegrationInput,
  CalendarIntegrationOutput,
} from "../calendar-integration.tool";
import { ToolContext, ToolResult } from "../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-cal-001",
    toolId: "calendar-integration",
    createdAt: new Date(),
    ...overrides,
  };
}

const FUTURE_START = new Date(Date.now() + 3600000).toISOString();
const FUTURE_END = new Date(Date.now() + 7200000).toISOString();

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CalendarIntegrationTool", () => {
  let tool: CalendarIntegrationTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CalendarIntegrationTool],
    }).compile();

    tool = module.get<CalendarIntegrationTool>(CalendarIntegrationTool);
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'calendar-integration'", () => {
      expect(tool.id).toBe("calendar-integration");
    });

    it("should belong to the 'integration' category", () => {
      expect(tool.category).toBe("integration");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return false when operation is missing", () => {
      expect(
        tool.validateInput({
          operation: undefined as unknown as "CREATE_EVENT",
          provider: "google",
        }),
      ).toBe(false);
    });

    it("should return false when provider is missing", () => {
      expect(
        tool.validateInput({
          operation: "LIST_EVENTS",
          provider: undefined as unknown as "google",
        }),
      ).toBe(false);
    });

    it("should return false for CREATE_EVENT without required eventData fields", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_EVENT",
          provider: "google",
          eventData: {
            title: "Meeting",
            startTime: FUTURE_START,
          } as CalendarIntegrationInput["eventData"],
        }),
      ).toBe(false);
    });

    it("should return true for CREATE_EVENT with all required eventData", () => {
      expect(
        tool.validateInput({
          operation: "CREATE_EVENT",
          provider: "google",
          eventData: {
            title: "Team Meeting",
            startTime: FUTURE_START,
            endTime: FUTURE_END,
          },
        }),
      ).toBe(true);
    });

    it("should return false for UPDATE_EVENT without eventId", () => {
      expect(
        tool.validateInput({ operation: "UPDATE_EVENT", provider: "outlook" }),
      ).toBe(false);
    });

    it("should return true for UPDATE_EVENT with eventId", () => {
      expect(
        tool.validateInput({
          operation: "UPDATE_EVENT",
          provider: "outlook",
          eventId: "evt_12345",
        }),
      ).toBe(true);
    });

    it("should return false for DELETE_EVENT without eventId", () => {
      expect(
        tool.validateInput({ operation: "DELETE_EVENT", provider: "apple" }),
      ).toBe(false);
    });

    it("should return true for DELETE_EVENT with eventId", () => {
      expect(
        tool.validateInput({
          operation: "DELETE_EVENT",
          provider: "apple",
          eventId: "evt_789",
        }),
      ).toBe(true);
    });

    it("should return true for LIST_EVENTS with no extra fields", () => {
      expect(
        tool.validateInput({ operation: "LIST_EVENTS", provider: "google" }),
      ).toBe(true);
    });

    it("should return false for FIND_FREE_TIME without timeMin and timeMax", () => {
      expect(
        tool.validateInput({
          operation: "FIND_FREE_TIME",
          provider: "google",
          query: {},
        }),
      ).toBe(false);
    });

    it("should return true for FIND_FREE_TIME with timeMin and timeMax", () => {
      expect(
        tool.validateInput({
          operation: "FIND_FREE_TIME",
          provider: "google",
          query: { timeMin: FUTURE_START, timeMax: FUTURE_END },
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with created event for CREATE_EVENT", async () => {
      const result: ToolResult<CalendarIntegrationOutput> = await tool.execute(
        {
          operation: "CREATE_EVENT",
          provider: "google",
          eventData: {
            title: "Team Standup",
            startTime: FUTURE_START,
            endTime: FUTURE_END,
          },
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("CREATE_EVENT");
      expect(result.data?.event).toBeDefined();
      expect(result.data?.event?.title).toBe("Team Standup");
      expect(result.data?.event?.id).toBeDefined();
    });

    it("should include htmlLink in created event", async () => {
      const result = await tool.execute(
        {
          operation: "CREATE_EVENT",
          provider: "google",
          eventData: {
            title: "Planning Session",
            startTime: FUTURE_START,
            endTime: FUTURE_END,
          },
        },
        makeContext(),
      );

      expect(result.data?.event?.htmlLink).toContain("calendar.example.com");
    });

    it("should return success for CREATE_RECURRING_EVENT", async () => {
      const result = await tool.execute(
        {
          operation: "CREATE_RECURRING_EVENT",
          provider: "google",
          eventData: {
            title: "Weekly Sync",
            startTime: FUTURE_START,
            endTime: FUTURE_END,
            recurrence: "RRULE:FREQ=WEEKLY",
          },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("CREATE_RECURRING_EVENT");
    });

    it("should return updated event for UPDATE_EVENT", async () => {
      const result = await tool.execute(
        {
          operation: "UPDATE_EVENT",
          provider: "outlook",
          eventId: "evt_existing_123",
          eventData: {
            title: "Updated Meeting Title",
            startTime: FUTURE_START,
            endTime: FUTURE_END,
          },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.event?.id).toBe("evt_existing_123");
      expect(result.data?.event?.title).toBe("Updated Meeting Title");
    });

    it("should return success for DELETE_EVENT", async () => {
      const result = await tool.execute(
        {
          operation: "DELETE_EVENT",
          provider: "google",
          eventId: "evt_to_delete",
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("DELETE_EVENT");
      expect(result.data?.event).toBeUndefined(); // delete returns no event
    });

    it("should return event data for GET_EVENT", async () => {
      const result = await tool.execute(
        {
          operation: "GET_EVENT",
          provider: "google",
          eventId: "evt_sample_456",
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.event?.id).toBe("evt_sample_456");
      expect(result.data?.event?.title).toBeDefined();
    });

    it("should return events list for LIST_EVENTS", async () => {
      const result = await tool.execute(
        { operation: "LIST_EVENTS", provider: "google" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.events).toBeDefined();
      expect(Array.isArray(result.data?.events)).toBe(true);
      expect(result.data?.events?.length).toBeGreaterThan(0);
    });

    it("should respect maxResults in LIST_EVENTS query", async () => {
      const result = await tool.execute(
        {
          operation: "LIST_EVENTS",
          provider: "google",
          query: { maxResults: 1 },
        },
        makeContext(),
      );

      expect(result.data?.events?.length).toBeLessThanOrEqual(1);
    });

    it("should return free time slots for FIND_FREE_TIME", async () => {
      const result = await tool.execute(
        {
          operation: "FIND_FREE_TIME",
          provider: "google",
          query: { timeMin: FUTURE_START, timeMax: FUTURE_END, duration: 30 },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.freeSlots).toBeDefined();
      expect(Array.isArray(result.data?.freeSlots)).toBe(true);
      expect(result.data?.freeSlots?.length).toBeGreaterThan(0);
    });

    it("should return free slots with start and end times", async () => {
      const result = await tool.execute(
        {
          operation: "FIND_FREE_TIME",
          provider: "google",
          query: { timeMin: FUTURE_START, timeMax: FUTURE_END },
        },
        makeContext(),
      );

      const slot = result.data?.freeSlots?.[0];
      expect(slot).toHaveProperty("start");
      expect(slot).toHaveProperty("end");
    });

    it("should include correct operation in all results", async () => {
      const result = await tool.execute(
        { operation: "LIST_EVENTS", provider: "caldav" },
        makeContext(),
      );

      expect(result.data?.operation).toBe("LIST_EVENTS");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return success:false for unsupported operation", async () => {
      const result = await tool.execute(
        {
          operation: "UNKNOWN_OP" as CalendarIntegrationInput["operation"],
          provider: "google",
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Unsupported operation");
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { operation: "LIST_EVENTS", provider: "google" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
    });
  });
});
