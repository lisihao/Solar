import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { SlidesSessionStatus, SlidesCheckpointType } from "@prisma/client";
import {
  SlidesCheckpointService,
  CreateCheckpointInput,
  CheckpointFilter,
} from "../checkpoint.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  CheckpointState,
  CheckpointMetadata,
  SlidesSession,
  Checkpoint,
} from "../checkpoint.types";

// ============================================================================
// Helpers
// ============================================================================

function buildCheckpointState(
  overrides: Partial<CheckpointState> = {},
): CheckpointState {
  return {
    pages: [],
    conversation: [],
    ...overrides,
  };
}

function buildCheckpointRecord(
  overrides: Partial<{
    id: string;
    sessionId: string;
    name: string;
    type: SlidesCheckpointType;
    version: string;
    stateJson: unknown;
    metadata: unknown;
    createdAt: Date;
  }> = {},
) {
  return {
    id: "cp-001",
    sessionId: "session-001",
    name: "Test Checkpoint",
    type: SlidesCheckpointType.AUTO_SAVE,
    version: "1.0.0",
    stateJson: buildCheckpointState(),
    metadata: {
      trigger: "auto",
      previousCheckpointId: undefined,
    } as CheckpointMetadata,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  };
}

function buildSessionRecord(
  overrides: Partial<{
    id: string;
    userId: string;
    title: string;
    status: SlidesSessionStatus;
    currentStateId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "session-001",
    userId: "user-001",
    title: "My Presentation",
    status: SlidesSessionStatus.ACTIVE,
    currentStateId: null,
    createdAt: new Date("2026-01-01T09:00:00Z"),
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  };
}

// ============================================================================
// Mock
// ============================================================================

const makePrismaMock = () => ({
  slidesSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  slidesCheckpoint: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  slidesMission: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  slidesMissionEvent: {
    deleteMany: jest.fn(),
  },
  slidesTask: {
    deleteMany: jest.fn(),
  },
});

// ============================================================================
// Tests
// ============================================================================

describe("SlidesCheckpointService", () => {
  let service: SlidesCheckpointService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidesCheckpointService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SlidesCheckpointService>(SlidesCheckpointService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // createSession
  // --------------------------------------------------------------------------

  describe("createSession", () => {
    it("should create a session and return mapped SlidesSession", async () => {
      const sessionRecord = buildSessionRecord();
      prisma.slidesSession.create.mockResolvedValue(sessionRecord);

      const result: SlidesSession = await service.createSession(
        "user-001",
        "My Presentation",
      );

      expect(result.id).toBe(sessionRecord.id);
      expect(result.userId).toBe("user-001");
      expect(result.status).toBe("active");
      expect(result.currentCheckpointId).toBeUndefined();
    });

    it("should pass correct data to prisma.slidesSession.create", async () => {
      const sessionRecord = buildSessionRecord();
      prisma.slidesSession.create.mockResolvedValue(sessionRecord);

      await service.createSession("user-001", "Quarterly Report");

      expect(prisma.slidesSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-001",
            title: "Quarterly Report",
            status: SlidesSessionStatus.ACTIVE,
          }),
        }),
      );
    });

    it("should map currentStateId to currentCheckpointId", async () => {
      const sessionRecord = buildSessionRecord({ currentStateId: "cp-999" });
      prisma.slidesSession.create.mockResolvedValue(sessionRecord);

      const result = await service.createSession("user-001", "Title");

      expect(result.currentCheckpointId).toBe("cp-999");
    });
  });

  // --------------------------------------------------------------------------
  // getSession
  // --------------------------------------------------------------------------

  describe("getSession", () => {
    it("should return null when session not found", async () => {
      prisma.slidesSession.findUnique.mockResolvedValue(null);

      const result = await service.getSession("nonexistent");

      expect(result).toBeNull();
    });

    it("should return mapped SlidesSession when found", async () => {
      const sessionRecord = buildSessionRecord({
        status: SlidesSessionStatus.COMPLETED,
      });
      prisma.slidesSession.findUnique.mockResolvedValue(sessionRecord);

      const result = await service.getSession("session-001");

      expect(result?.status).toBe("completed");
      expect(result?.id).toBe("session-001");
    });
  });

  // --------------------------------------------------------------------------
  // getSessions
  // --------------------------------------------------------------------------

  describe("getSessions", () => {
    it("should query with userId filter", async () => {
      prisma.slidesSession.findMany.mockResolvedValue([]);

      await service.getSessions({ userId: "user-001" });

      expect(prisma.slidesSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-001" }),
        }),
      );
    });

    it("should query with status filter mapped to prisma enum", async () => {
      prisma.slidesSession.findMany.mockResolvedValue([]);

      await service.getSessions({ status: "archived" });

      expect(prisma.slidesSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: SlidesSessionStatus.ARCHIVED,
          }),
        }),
      );
    });

    it("should default take to 50 when no limit provided", async () => {
      prisma.slidesSession.findMany.mockResolvedValue([]);

      await service.getSessions({});

      expect(prisma.slidesSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("should return empty array when no sessions exist", async () => {
      prisma.slidesSession.findMany.mockResolvedValue([]);

      const result = await service.getSessions({});

      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // updateSessionStatus / updateSessionTitle
  // --------------------------------------------------------------------------

  describe("updateSessionStatus", () => {
    it("should update session with correct prisma enum", async () => {
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());

      await service.updateSessionStatus("session-001", "completed");

      expect(prisma.slidesSession.update).toHaveBeenCalledWith({
        where: { id: "session-001" },
        data: { status: SlidesSessionStatus.COMPLETED },
      });
    });
  });

  describe("updateSessionTitle", () => {
    it("should update title and return mapped session", async () => {
      const updated = buildSessionRecord({ title: "New Title" });
      prisma.slidesSession.update.mockResolvedValue(updated);

      const result = await service.updateSessionTitle(
        "session-001",
        "New Title",
      );

      expect(result.title).toBe("New Title");
    });
  });

  // --------------------------------------------------------------------------
  // deleteSession
  // --------------------------------------------------------------------------

  describe("deleteSession", () => {
    it("should delete all related data in correct order", async () => {
      const callOrder: string[] = [];

      prisma.slidesMission.findMany.mockResolvedValue([
        { id: "mission-001" },
        { id: "mission-002" },
      ]);
      prisma.slidesMissionEvent.deleteMany.mockImplementation(() => {
        callOrder.push("events");
        return Promise.resolve({ count: 0 });
      });
      prisma.slidesTask.deleteMany.mockImplementation(() => {
        callOrder.push("tasks");
        return Promise.resolve({ count: 0 });
      });
      prisma.slidesMission.deleteMany.mockImplementation(() => {
        callOrder.push("missions");
        return Promise.resolve({ count: 0 });
      });
      prisma.slidesCheckpoint.deleteMany.mockImplementation(() => {
        callOrder.push("checkpoints");
        return Promise.resolve({ count: 0 });
      });
      prisma.slidesSession.delete.mockImplementation(() => {
        callOrder.push("session");
        return Promise.resolve({});
      });

      await service.deleteSession("session-001");

      expect(callOrder).toEqual([
        "events",
        "tasks",
        "missions",
        "checkpoints",
        "session",
      ]);
    });

    it("should skip mission-related deletes when no missions exist", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);
      prisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 0 });
      prisma.slidesSession.delete.mockResolvedValue({});

      await service.deleteSession("session-001");

      expect(prisma.slidesMissionEvent.deleteMany).not.toHaveBeenCalled();
      expect(prisma.slidesTask.deleteMany).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // create (checkpoint)
  // --------------------------------------------------------------------------

  describe("create", () => {
    it("should create checkpoint with generated version starting at 1.0.0", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null); // no previous
      const checkpointRecord = buildCheckpointRecord({ version: "1.0.0" });
      prisma.slidesCheckpoint.create.mockResolvedValue(checkpointRecord);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      const input: CreateCheckpointInput = {
        sessionId: "session-001",
        type: "auto_save",
        state: buildCheckpointState(),
      };

      const result = await service.create(input);

      expect(prisma.slidesCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: "1.0.0" }),
        }),
      );
      expect(result.id).toBe("cp-001");
    });

    it("should increment patch version from previous checkpoint", async () => {
      const previousCp = buildCheckpointRecord({ version: "1.0.5" });
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(previousCp);
      const newCp = buildCheckpointRecord({ version: "1.0.6" });
      prisma.slidesCheckpoint.create.mockResolvedValue(newCp);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(2);

      await service.create({
        sessionId: "session-001",
        type: "auto_save",
        state: buildCheckpointState(),
      });

      expect(prisma.slidesCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: "1.0.6" }),
        }),
      );
    });

    it("should use provided name instead of auto-generating", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null);
      const cp = buildCheckpointRecord({ name: "Manual Save Point" });
      prisma.slidesCheckpoint.create.mockResolvedValue(cp);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      await service.create({
        sessionId: "session-001",
        name: "Manual Save Point",
        type: "user_modified",
        state: buildCheckpointState(),
      });

      expect(prisma.slidesCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Manual Save Point" }),
        }),
      );
    });

    it("should update session currentStateId after creation", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null);
      const cp = buildCheckpointRecord({ id: "cp-new" });
      prisma.slidesCheckpoint.create.mockResolvedValue(cp);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      await service.create({
        sessionId: "session-001",
        type: "auto_save",
        state: buildCheckpointState(),
      });

      expect(prisma.slidesSession.update).toHaveBeenCalledWith({
        where: { id: "session-001" },
        data: { currentStateId: "cp-new" },
      });
    });

    it("should call prune when checkpoint count exceeds maxCheckpoints (50)", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null);
      prisma.slidesCheckpoint.create.mockResolvedValue(buildCheckpointRecord());
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(51); // over limit

      // prune will call findMany then deleteMany
      prisma.slidesCheckpoint.findMany.mockResolvedValue(
        Array.from({ length: 51 }, (_, i) => ({ id: `cp-${i}` })),
      );
      prisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 1 });

      await service.create({
        sessionId: "session-001",
        type: "auto_save",
        state: buildCheckpointState(),
      });

      expect(prisma.slidesCheckpoint.deleteMany).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // get
  // --------------------------------------------------------------------------

  describe("get", () => {
    it("should return mapped Checkpoint when found", async () => {
      const cpRecord = buildCheckpointRecord();
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(cpRecord);

      const result: Checkpoint = await service.get("cp-001");

      expect(result.id).toBe("cp-001");
      expect(result.type).toBe("auto_save");
      expect(result.version).toBe("1.0.0");
    });

    it("should throw NotFoundException when not found", async () => {
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(null);

      await expect(service.get("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // getLatestCheckpoint
  // --------------------------------------------------------------------------

  describe("getLatestCheckpoint", () => {
    it("should return null when no checkpoints exist", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null);

      const result = await service.getLatestCheckpoint("session-001");

      expect(result).toBeNull();
    });

    it("should return mapped checkpoint when found", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(
        buildCheckpointRecord(),
      );

      const result = await service.getLatestCheckpoint("session-001");

      expect(result?.id).toBe("cp-001");
    });
  });

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------

  describe("list", () => {
    it("should list all checkpoints with no filter", async () => {
      prisma.slidesCheckpoint.findMany.mockResolvedValue([
        buildCheckpointRecord({ id: "cp-001" }),
        buildCheckpointRecord({ id: "cp-002" }),
      ]);

      const results = await service.list();

      expect(results).toHaveLength(2);
    });

    it("should apply sessionId filter", async () => {
      prisma.slidesCheckpoint.findMany.mockResolvedValue([]);

      const filter: CheckpointFilter = { sessionId: "session-001" };
      await service.list(filter);

      expect(prisma.slidesCheckpoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sessionId: "session-001" }),
        }),
      );
    });

    it("should apply fromDate and toDate filters", async () => {
      prisma.slidesCheckpoint.findMany.mockResolvedValue([]);
      const fromDate = new Date("2026-01-01");
      const toDate = new Date("2026-01-31");

      await service.list({ fromDate, toDate });

      const call = prisma.slidesCheckpoint.findMany.mock.calls[0][0];
      expect(call.where.createdAt.gte).toEqual(fromDate);
      expect(call.where.createdAt.lte).toEqual(toDate);
    });
  });

  // --------------------------------------------------------------------------
  // restore
  // --------------------------------------------------------------------------

  describe("restore", () => {
    it("should update session currentStateId and create a restore checkpoint", async () => {
      const cp = buildCheckpointRecord({
        id: "cp-old",
        name: "Auto Save - 10:00:00",
      });
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(cp);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());

      // For the create() call inside restore
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(cp); // previous
      const restoredCp = buildCheckpointRecord({ id: "cp-restored" });
      prisma.slidesCheckpoint.create.mockResolvedValue(restoredCp);
      prisma.slidesCheckpoint.count.mockResolvedValue(2);

      const result = await service.restore("cp-old");

      expect(result.checkpointId).toBe("cp-old");
      expect(result.sessionId).toBe("session-001");
      expect(prisma.slidesSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentStateId: "cp-old" },
        }),
      );
    });

    it("should create restore checkpoint with name stripped of repeated prefix", async () => {
      const cp = buildCheckpointRecord({
        name: "Restored from: Restored from: Original Name",
      });
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(cp);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(cp);
      prisma.slidesCheckpoint.create.mockResolvedValue(buildCheckpointRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      await service.restore("cp-001");

      const createCall = prisma.slidesCheckpoint.create.mock.calls[0][0];
      // Should not have double "Restored from:"
      expect(createCall.data.name).not.toContain(
        "Restored from: Restored from:",
      );
    });

    it("should sync pages to latest mission when checkpoint has pages", async () => {
      const cp = buildCheckpointRecord({
        stateJson: {
          pages: [
            {
              pageNumber: 1,
              outline: {
                pageNumber: 1,
                title: "Test",
                templateType: "cover",
                contentBrief: "",
                keyElements: [],
                layoutHints: [],
              },
              status: "completed",
              html: "<div>page 1</div>",
            },
          ],
          conversation: [],
        },
      });

      prisma.slidesCheckpoint.findUnique.mockResolvedValue(cp);
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesMission.findFirst.mockResolvedValue({ id: "mission-001" });
      prisma.slidesMission.update.mockResolvedValue({});
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(cp);
      prisma.slidesCheckpoint.create.mockResolvedValue(buildCheckpointRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      await service.restore("cp-001");

      expect(prisma.slidesMission.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException when checkpoint not found", async () => {
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(null);

      await expect(service.restore("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // diff
  // --------------------------------------------------------------------------

  describe("diff", () => {
    it("should detect added, modified, and removed pages", async () => {
      const cp1 = buildCheckpointRecord({
        id: "cp-1",
        stateJson: {
          pages: [
            { pageNumber: 1, html: "<p>v1</p>", status: "completed" },
            { pageNumber: 2, html: "<p>v1 pg2</p>", status: "completed" },
          ],
          conversation: [],
        },
      });
      const cp2 = buildCheckpointRecord({
        id: "cp-2",
        stateJson: {
          pages: [
            { pageNumber: 1, html: "<p>v2</p>", status: "completed" }, // modified
            { pageNumber: 3, html: "<p>new</p>", status: "completed" }, // added
          ],
          conversation: [],
        },
      });

      prisma.slidesCheckpoint.findUnique
        .mockResolvedValueOnce(cp1)
        .mockResolvedValueOnce(cp2);

      const diffResult = await service.diff("cp-1", "cp-2");

      expect(diffResult.pagesAdded).toContain(3);
      expect(diffResult.pagesRemoved).toContain(2);
      expect(diffResult.pagesModified).toContain(1);
    });

    it("should detect taskDecomposition changes", async () => {
      const cp1 = buildCheckpointRecord({
        id: "cp-1",
        stateJson: {
          taskDecomposition: { totalPages: 5 },
          pages: [],
          conversation: [],
        },
      });
      const cp2 = buildCheckpointRecord({
        id: "cp-2",
        stateJson: {
          taskDecomposition: { totalPages: 10 },
          pages: [],
          conversation: [],
        },
      });

      prisma.slidesCheckpoint.findUnique
        .mockResolvedValueOnce(cp1)
        .mockResolvedValueOnce(cp2);

      const diffResult = await service.diff("cp-1", "cp-2");

      const taskDiff = diffResult.changes.find(
        (c) => c.field === "taskDecomposition",
      );
      expect(taskDiff).toBeDefined();
    });

    it("should return empty arrays when checkpoints are identical", async () => {
      const state = { pages: [], conversation: [] };
      const cp1 = buildCheckpointRecord({ id: "cp-1", stateJson: state });
      const cp2 = buildCheckpointRecord({ id: "cp-2", stateJson: state });

      prisma.slidesCheckpoint.findUnique
        .mockResolvedValueOnce(cp1)
        .mockResolvedValueOnce(cp2);

      const diffResult = await service.diff("cp-1", "cp-2");

      expect(diffResult.pagesAdded).toHaveLength(0);
      expect(diffResult.pagesModified).toHaveLength(0);
      expect(diffResult.pagesRemoved).toHaveLength(0);
      expect(diffResult.changes).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------

  describe("delete", () => {
    it("should call prisma.slidesCheckpoint.delete with correct id", async () => {
      prisma.slidesCheckpoint.delete.mockResolvedValue({});

      await service.delete("cp-001");

      expect(prisma.slidesCheckpoint.delete).toHaveBeenCalledWith({
        where: { id: "cp-001" },
      });
    });
  });

  // --------------------------------------------------------------------------
  // prune
  // --------------------------------------------------------------------------

  describe("prune", () => {
    it("should return 0 when checkpoint count is within limit", async () => {
      prisma.slidesCheckpoint.findMany.mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({ id: `cp-${i}` })),
      );

      const deleted = await service.prune("session-001", 50);

      expect(deleted).toBe(0);
      expect(prisma.slidesCheckpoint.deleteMany).not.toHaveBeenCalled();
    });

    it("should delete checkpoints beyond the keepLast limit", async () => {
      const checkpoints = Array.from({ length: 55 }, (_, i) => ({
        id: `cp-${i}`,
      }));
      prisma.slidesCheckpoint.findMany.mockResolvedValue(checkpoints);
      prisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 5 });

      const deleted = await service.prune("session-001", 50);

      expect(deleted).toBe(5);
      expect(prisma.slidesCheckpoint.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: checkpoints.slice(50).map((cp) => cp.id) },
        },
      });
    });
  });

  // --------------------------------------------------------------------------
  // getVersionTree
  // --------------------------------------------------------------------------

  describe("getVersionTree", () => {
    it("should build version tree with parent-child relationships", async () => {
      const cp1Record = buildCheckpointRecord({
        id: "cp-1",
        metadata: { trigger: "auto" },
      });
      const cp2Record = buildCheckpointRecord({
        id: "cp-2",
        metadata: { trigger: "auto", previousCheckpointId: "cp-1" },
      });

      prisma.slidesCheckpoint.findMany.mockResolvedValue([
        cp1Record,
        cp2Record,
      ]);

      const tree = await service.getVersionTree("session-001");

      const cp1Node = tree.find((n) => n.checkpoint.id === "cp-1");
      expect(cp1Node?.children).toContain("cp-2");

      const cp2Node = tree.find((n) => n.checkpoint.id === "cp-2");
      expect(cp2Node?.children).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // AutoSave config
  // --------------------------------------------------------------------------

  describe("auto save config", () => {
    it("should return default config", () => {
      const config = service.getAutoSaveConfig();
      expect(config.phaseComplete).toBe(true);
      expect(config.pageInterval).toBe(5);
      expect(config.maxCheckpoints).toBe(50);
    });

    it("should merge partial config updates", () => {
      service.setAutoSaveConfig({ pageInterval: 10, maxCheckpoints: 100 });

      const config = service.getAutoSaveConfig();
      expect(config.pageInterval).toBe(10);
      expect(config.maxCheckpoints).toBe(100);
      expect(config.phaseComplete).toBe(true); // unchanged
    });

    it("shouldAutoSave returns true for phase_complete when configured", () => {
      expect(service.shouldAutoSave("phase_complete")).toBe(true);
    });

    it("shouldAutoSave returns false for phase_complete when disabled", () => {
      service.setAutoSaveConfig({ phaseComplete: false });
      expect(service.shouldAutoSave("phase_complete")).toBe(false);
    });

    it("shouldAutoSave returns true for page_rendered on pageInterval multiple", () => {
      service.setAutoSaveConfig({ pageInterval: 5 });
      expect(service.shouldAutoSave("page_rendered", 5)).toBe(true);
      expect(service.shouldAutoSave("page_rendered", 10)).toBe(true);
      expect(service.shouldAutoSave("page_rendered", 3)).toBe(false);
    });

    it("shouldAutoSave returns false for page_rendered when pageNumber is undefined", () => {
      expect(service.shouldAutoSave("page_rendered", undefined)).toBe(false);
    });

    it("shouldAutoSave returns true for time_interval when interval > 0", () => {
      expect(service.shouldAutoSave("time_interval")).toBe(true);
    });

    it("shouldAutoSave returns false for time_interval when interval is 0", () => {
      service.setAutoSaveConfig({ timeIntervalMs: 0 });
      expect(service.shouldAutoSave("time_interval")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // generateVersion (tested via create)
  // --------------------------------------------------------------------------

  describe("version generation edge cases", () => {
    it("should roll over patch to minor at 100", async () => {
      // previous version: 1.0.99 -> next should be 1.1.0
      const previousCp = buildCheckpointRecord({ version: "1.0.99" });
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(previousCp);
      prisma.slidesCheckpoint.create.mockResolvedValue(
        buildCheckpointRecord({ version: "1.1.0" }),
      );
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      await service.create({
        sessionId: "session-001",
        type: "auto_save",
        state: buildCheckpointState(),
      });

      const createCall = prisma.slidesCheckpoint.create.mock.calls[0][0];
      expect(createCall.data.version).toBe("1.1.0");
    });

    it("should roll over minor to major at 100", async () => {
      const previousCp = buildCheckpointRecord({ version: "1.99.99" });
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(previousCp);
      prisma.slidesCheckpoint.create.mockResolvedValue(
        buildCheckpointRecord({ version: "2.0.0" }),
      );
      prisma.slidesSession.update.mockResolvedValue(buildSessionRecord());
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      await service.create({
        sessionId: "session-001",
        type: "auto_save",
        state: buildCheckpointState(),
      });

      const createCall = prisma.slidesCheckpoint.create.mock.calls[0][0];
      expect(createCall.data.version).toBe("2.0.0");
    });
  });
});
