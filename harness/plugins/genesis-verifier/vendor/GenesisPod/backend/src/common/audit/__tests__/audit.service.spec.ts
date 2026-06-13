import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import {
  AuditService,
  AuditAction,
  AuditEntry,
  Audit,
  AUDIT_KEY,
} from "../audit.service";

describe("AuditService", () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService],
    }).compile();

    service = module.get<AuditService>(AuditService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    // Clear logs before each test
    service.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== log ====================

  describe("log", () => {
    it("stores audit entry in memory", async () => {
      await service.log({
        action: AuditAction.USER_LOGIN,
        userId: "user-1",
        result: "SUCCESS",
      });

      const logs = service.getRecent(10);
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe(AuditAction.USER_LOGIN);
      expect(logs[0].userId).toBe("user-1");
    });

    it("assigns an id and timestamp to each entry", async () => {
      await service.log({
        action: AuditAction.TOPIC_CREATE,
        result: "SUCCESS",
      });

      const logs = service.getRecent(1);
      expect(logs[0].id).toBeDefined();
      expect(logs[0].id).toMatch(/^audit_/);
      expect(logs[0].timestamp).toBeInstanceOf(Date);
    });

    it("uses provided timestamp when supplied", async () => {
      const ts = new Date("2025-01-01T00:00:00Z");
      await service.log({
        action: AuditAction.CUSTOM,
        timestamp: ts,
      });

      const logs = service.getRecent(1);
      expect(logs[0].timestamp).toEqual(ts);
    });

    it("uses Logger.log for SUCCESS results", async () => {
      const logSpy = jest.spyOn(Logger.prototype, "log");

      await service.log({
        action: AuditAction.MISSION_CREATE,
        result: "SUCCESS",
      });

      expect(logSpy).toHaveBeenCalled();
    });

    it("uses Logger.warn for FAILURE results", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");

      await service.log({
        action: AuditAction.AI_RESPONSE_ERROR,
        result: "FAILURE",
        errorMessage: "timeout",
      });

      expect(warnSpy).toHaveBeenCalled();
    });

    it("evicts oldest entry when maxLogs (1000) is exceeded", async () => {
      // Fill to 1001 entries
      const actions = Object.values(AuditAction);
      for (let i = 0; i < 1001; i++) {
        await service.log({
          action: actions[i % actions.length],
          userId: `user-${i}`,
        });
      }

      const logs = service.getRecent(2000);
      expect(logs.length).toBe(1000);
    });

    it("handles entries without optional fields", async () => {
      await service.log({ action: AuditAction.SYSTEM_ERROR });

      const logs = service.getRecent(1);
      expect(logs[0].userId).toBeUndefined();
      expect(logs[0].result).toBeUndefined();
      expect(logs[0].errorMessage).toBeUndefined();
    });
  });

  // ==================== logSuccess ====================

  describe("logSuccess", () => {
    it("stores a SUCCESS result entry", async () => {
      await service.logSuccess(AuditAction.TOPIC_CREATE, {
        userId: "user-1",
        resourceType: "Topic",
        resourceId: "topic-1",
        details: { title: "Test" },
      });

      const logs = service.getRecent(1);
      expect(logs[0].result).toBe("SUCCESS");
      expect(logs[0].action).toBe(AuditAction.TOPIC_CREATE);
    });
  });

  // ==================== logFailure ====================

  describe("logFailure", () => {
    it("stores a FAILURE result entry with error message", async () => {
      await service.logFailure(AuditAction.AI_RESPONSE_ERROR, "Model timeout", {
        resourceType: "AIResponse",
        details: { topicId: "t1", memberId: "m1", model: "" },
      });

      const logs = service.getRecent(1);
      expect(logs[0].result).toBe("FAILURE");
      expect(logs[0].errorMessage).toBe("Model timeout");
    });
  });

  // ==================== Convenience methods ====================

  describe("logTopicCreate", () => {
    it("logs topic creation with correct fields", async () => {
      await service.logTopicCreate("user-1", "topic-1", "My Topic");

      const logs = service.query({ action: AuditAction.TOPIC_CREATE });
      expect(logs).toHaveLength(1);
      expect(logs[0].resourceType).toBe("Topic");
      expect(logs[0].resourceId).toBe("topic-1");
      expect(logs[0].details).toEqual({ title: "My Topic" });
    });
  });

  describe("logMemberAdd", () => {
    it("logs member add with topic and member info", async () => {
      await service.logMemberAdd("user-1", "topic-1", "member-1", "Analyst");

      const logs = service.query({ action: AuditAction.MEMBER_ADD });
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe("user-1");
      expect(logs[0].details).toEqual({
        topicId: "topic-1",
        memberName: "Analyst",
      });
    });
  });

  describe("logMessageSend", () => {
    it("logs message send with isAI flag", async () => {
      await service.logMessageSend("user-1", "topic-1", "msg-1", true);

      const logs = service.query({ action: AuditAction.MESSAGE_SEND });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual({ topicId: "topic-1", isAI: true });
    });
  });

  describe("logAIResponseGenerate", () => {
    it("logs AI response generation with model and token info", async () => {
      await service.logAIResponseGenerate(
        "topic-1",
        "member-1",
        "msg-1",
        "gpt-4",
        1500,
      );

      const logs = service.query({ action: AuditAction.AI_RESPONSE_GENERATE });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toMatchObject({
        model: "gpt-4",
        tokensUsed: 1500,
      });
    });
  });

  describe("logAIResponseError", () => {
    it("logs AI response error with FAILURE result", async () => {
      await service.logAIResponseError("topic-1", "member-1", "Rate limit", "");

      const logs = service.query({ action: AuditAction.AI_RESPONSE_ERROR });
      expect(logs).toHaveLength(1);
      expect(logs[0].result).toBe("FAILURE");
      expect(logs[0].errorMessage).toBe("Rate limit");
    });
  });

  describe("logVoteCreate", () => {
    it("logs vote creation", async () => {
      await service.logVoteCreate(
        "user-1",
        "topic-1",
        "proposal-1",
        "Vote Title",
      );

      const logs = service.query({ action: AuditAction.VOTE_CREATE });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual({
        topicId: "topic-1",
        title: "Vote Title",
      });
    });
  });

  describe("logVoteCast", () => {
    it("logs vote casting with vote value", async () => {
      await service.logVoteCast("voter-1", "proposal-1", "APPROVE");

      const logs = service.query({ action: AuditAction.VOTE_CAST });
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe("voter-1");
      expect(logs[0].details).toEqual({ vote: "APPROVE" });
    });
  });

  describe("logMissionCreate", () => {
    it("logs mission creation with objective", async () => {
      await service.logMissionCreate(
        "user-1",
        "topic-1",
        "mission-1",
        "Research AI trends",
      );

      const logs = service.query({ action: AuditAction.MISSION_CREATE });
      expect(logs).toHaveLength(1);
      expect(logs[0].resourceId).toBe("mission-1");
      expect(logs[0].details).toEqual({
        topicId: "topic-1",
        objective: "Research AI trends",
      });
    });
  });

  describe("logMissionComplete", () => {
    it("logs mission completion with duration", async () => {
      await service.logMissionComplete("mission-1", 12345);

      const logs = service.query({ action: AuditAction.MISSION_COMPLETE });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual({ duration: 12345 });
    });
  });

  // ==================== query ====================

  describe("query", () => {
    beforeEach(async () => {
      await service.log({
        action: AuditAction.USER_LOGIN,
        userId: "user-1",
        resourceType: "User",
        resourceId: "user-1",
        result: "SUCCESS",
        timestamp: new Date("2025-06-01T10:00:00Z"),
      });
      await service.log({
        action: AuditAction.TOPIC_CREATE,
        userId: "user-2",
        resourceType: "Topic",
        resourceId: "topic-1",
        result: "SUCCESS",
        timestamp: new Date("2025-06-02T10:00:00Z"),
      });
      await service.log({
        action: AuditAction.USER_LOGIN,
        userId: "user-1",
        resourceType: "User",
        resourceId: "user-1",
        result: "FAILURE",
        errorMessage: "Wrong password",
        timestamp: new Date("2025-06-03T10:00:00Z"),
      });
    });

    it("filters by action", () => {
      const result = service.query({ action: AuditAction.USER_LOGIN });
      expect(result).toHaveLength(2);
      result.forEach((r) => expect(r.action).toBe(AuditAction.USER_LOGIN));
    });

    it("filters by userId", () => {
      const result = service.query({ userId: "user-1" });
      expect(result).toHaveLength(2);
      result.forEach((r) => expect(r.userId).toBe("user-1"));
    });

    it("filters by resourceType", () => {
      const result = service.query({ resourceType: "Topic" });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe(AuditAction.TOPIC_CREATE);
    });

    it("filters by resourceId", () => {
      const result = service.query({ resourceId: "topic-1" });
      expect(result).toHaveLength(1);
      expect(result[0].resourceId).toBe("topic-1");
    });

    it("filters by startTime", () => {
      const result = service.query({
        startTime: new Date("2025-06-02T00:00:00Z"),
      });
      expect(result).toHaveLength(2);
    });

    it("filters by endTime", () => {
      const result = service.query({
        endTime: new Date("2025-06-01T23:59:59Z"),
      });
      expect(result).toHaveLength(1);
    });

    it("filters by both startTime and endTime", () => {
      const result = service.query({
        startTime: new Date("2025-06-01T00:00:00Z"),
        endTime: new Date("2025-06-02T23:59:59Z"),
      });
      expect(result).toHaveLength(2);
    });

    it("limits results to specified count", () => {
      const result = service.query({ limit: 1 });
      expect(result).toHaveLength(1);
    });

    it("returns results sorted by timestamp descending", () => {
      const result = service.query({});
      expect(result[0].timestamp >= result[1].timestamp).toBe(true);
    });

    it("combines multiple filters (action + userId)", () => {
      const result = service.query({
        action: AuditAction.USER_LOGIN,
        userId: "user-1",
      });
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no match", () => {
      const result = service.query({ action: AuditAction.DEBATE_START });
      expect(result).toHaveLength(0);
    });
  });

  // ==================== getRecent ====================

  describe("getRecent", () => {
    it("returns logs sorted by timestamp descending", async () => {
      await service.log({
        action: AuditAction.USER_LOGIN,
        timestamp: new Date("2025-01-01"),
      });
      await service.log({
        action: AuditAction.TOPIC_CREATE,
        timestamp: new Date("2025-01-02"),
      });

      const result = service.getRecent(2);
      expect(result[0].action).toBe(AuditAction.TOPIC_CREATE);
      expect(result[1].action).toBe(AuditAction.USER_LOGIN);
    });

    it("defaults to 50 logs when no limit provided", async () => {
      for (let i = 0; i < 60; i++) {
        await service.log({ action: AuditAction.CUSTOM });
      }

      const result = service.getRecent();
      expect(result).toHaveLength(50);
    });
  });

  // ==================== getUserHistory ====================

  describe("getUserHistory", () => {
    it("returns actions for specified user only", async () => {
      await service.log({ action: AuditAction.USER_LOGIN, userId: "user-A" });
      await service.log({ action: AuditAction.TOPIC_CREATE, userId: "user-B" });
      await service.log({ action: AuditAction.MESSAGE_SEND, userId: "user-A" });

      const result = service.getUserHistory("user-A");
      expect(result).toHaveLength(2);
      result.forEach((r) => expect(r.userId).toBe("user-A"));
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await service.log({ action: AuditAction.CUSTOM, userId: "user-A" });
      }

      const result = service.getUserHistory("user-A", 3);
      expect(result).toHaveLength(3);
    });
  });

  // ==================== getResourceHistory ====================

  describe("getResourceHistory", () => {
    it("returns history for specified resource type and id", async () => {
      await service.log({
        action: AuditAction.TOPIC_CREATE,
        resourceType: "Topic",
        resourceId: "topic-1",
      });
      await service.log({
        action: AuditAction.TOPIC_UPDATE,
        resourceType: "Topic",
        resourceId: "topic-1",
      });
      await service.log({
        action: AuditAction.TOPIC_CREATE,
        resourceType: "Topic",
        resourceId: "topic-2",
      });

      const result = service.getResourceHistory("Topic", "topic-1");
      expect(result).toHaveLength(2);
      result.forEach((r) => {
        expect(r.resourceType).toBe("Topic");
        expect(r.resourceId).toBe("topic-1");
      });
    });
  });

  // ==================== clear ====================

  describe("clear", () => {
    it("removes all stored audit logs", async () => {
      await service.log({ action: AuditAction.USER_LOGIN });
      await service.log({ action: AuditAction.TOPIC_CREATE });

      service.clear();

      const result = service.getRecent(100);
      expect(result).toHaveLength(0);
    });
  });

  // ==================== @Audit decorator ====================

  describe("Audit decorator", () => {
    it("sets metadata with AUDIT_KEY", () => {
      const metadata = { action: AuditAction.MISSION_CREATE, logArgs: true };

      class TestController {
        @Audit(AuditAction.MISSION_CREATE, { logArgs: true })
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        createMission() {}
      }

      const reflectedMetadata = Reflect.getMetadata(
        AUDIT_KEY,
        TestController.prototype.createMission,
      );
      expect(reflectedMetadata).toMatchObject(metadata);
    });

    it("sets metadata without options", () => {
      class TestController {
        @Audit(AuditAction.VOTE_CAST)
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        castVote() {}
      }

      const reflectedMetadata = Reflect.getMetadata(
        AUDIT_KEY,
        TestController.prototype.castVote,
      );
      expect(reflectedMetadata.action).toBe(AuditAction.VOTE_CAST);
    });
  });

  // ==================== formatLogMessage (via log output) ====================

  describe("log message formatting", () => {
    it("includes all present fields in log output", async () => {
      const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();

      const entry: AuditEntry = {
        action: AuditAction.TOPIC_CREATE,
        userId: "user-1",
        resourceType: "Topic",
        resourceId: "topic-1",
        result: "SUCCESS",
        details: { title: "Test" },
      };

      await service.log(entry);

      const logMessage = logSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("[TOPIC_CREATE]");
      expect(logMessage).toContain("user=user-1");
      expect(logMessage).toContain("Topic=topic-1");
      expect(logMessage).toContain("SUCCESS");
    });

    it("includes error message in failure log", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();

      await service.log({
        action: AuditAction.SYSTEM_ERROR,
        result: "FAILURE",
        errorMessage: "database unreachable",
      });

      const warnMessage = warnSpy.mock.calls[0][0] as string;
      expect(warnMessage).toContain('error="database unreachable"');
    });

    it("omits optional fields when not present", async () => {
      const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();

      await service.log({ action: AuditAction.CUSTOM });

      const logMessage = logSpy.mock.calls[0][0] as string;
      expect(logMessage).not.toContain("user=");
      expect(logMessage).not.toContain("error=");
    });
  });
});
