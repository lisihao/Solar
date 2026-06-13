import { Test } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  AskRoomMemberType,
  AskRoomMode,
  AskSessionMode,
  AskTurnStatus,
} from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AskRoomService } from "../../ai-ask-room.service";

function makePrismaMock() {
  return {
    askSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    askRoomMember: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    askRoomTurn: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    askMessage: {
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

describe("AskRoomService", () => {
  let service: AskRoomService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = makePrismaMock();
    prisma.$transaction.mockImplementation((cb: unknown) => {
      if (typeof cb === "function") {
        return Promise.resolve((cb as (tx: PrismaMock) => unknown)(prisma));
      }
      return Promise.resolve(cb);
    });
    const module = await Test.createTestingModule({
      providers: [AskRoomService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AskRoomService);
  });

  describe("createRoom (fresh)", () => {
    it("creates ROOM session with initial members", async () => {
      prisma.askSession.create.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.ROOM,
      });
      prisma.askRoomMember.create.mockResolvedValue({});

      await service.createRoom("u-1", {
        title: "Team",
        initialMembers: [
          {
            memberType: AskRoomMemberType.VIRTUAL,
            modelId: "model-x",
            displayName: "A",
          },
        ],
      });

      expect(prisma.askSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "u-1",
            title: "Team",
            mode: AskSessionMode.ROOM,
          }),
        }),
      );
      expect(prisma.askRoomMember.create).toHaveBeenCalledTimes(1);
    });

    it("rejects REGISTERED member without agentId", async () => {
      await expect(
        service.createRoom("u-1", {
          initialMembers: [
            {
              memberType: AskRoomMemberType.REGISTERED,
              modelId: "model-x",
              displayName: "A",
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("createRoom (upgrade)", () => {
    it("upgrades a SOLO session to ROOM", async () => {
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.SOLO,
      });
      prisma.askSession.update.mockResolvedValue({
        id: "s-1",
        mode: AskSessionMode.ROOM,
      });

      const result = await service.createRoom("u-1", {
        fromSessionId: "s-1",
      });
      expect(prisma.askSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s-1" },
          data: expect.objectContaining({ mode: AskSessionMode.ROOM }),
        }),
      );
      expect(result.mode).toBe(AskSessionMode.ROOM);
    });

    it("rejects upgrading a session that is already ROOM", async () => {
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.ROOM,
      });
      await expect(
        service.createRoom("u-1", { fromSessionId: "s-1" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects upgrading a session that does not belong to user", async () => {
      prisma.askSession.findFirst.mockResolvedValue(null);
      await expect(
        service.createRoom("u-1", { fromSessionId: "s-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("findUserRoom", () => {
    it("rejects non-ROOM session", async () => {
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.SOLO,
      });
      await expect(service.findUserRoom("s-1", "u-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects session of another user", async () => {
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-2",
        mode: AskSessionMode.ROOM,
      });
      await expect(service.findUserRoom("s-1", "u-1")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("addMember", () => {
    beforeEach(() => {
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.ROOM,
      });
      prisma.askSession.findUnique.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.ROOM,
        roomConfig: { maxParticipants: 8 },
      });
    });

    it("rejects when room is at max capacity", async () => {
      prisma.askRoomMember.count.mockResolvedValue(8);
      await expect(
        service.addMember("s-1", "u-1", {
          memberType: AskRoomMemberType.VIRTUAL,
          modelId: "model-x",
          displayName: "X",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates VIRTUAL member with agentId stripped", async () => {
      prisma.askRoomMember.count.mockResolvedValue(0);
      prisma.askRoomMember.create.mockResolvedValue({ id: "m-x" });

      await service.addMember("s-1", "u-1", {
        memberType: AskRoomMemberType.VIRTUAL,
        agentId: "should-be-ignored",
        modelId: "model-x",
        displayName: "X",
      });

      expect(prisma.askRoomMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberType: AskRoomMemberType.VIRTUAL,
            agentId: null,
          }),
        }),
      );
    });
  });

  describe("removeMember (soft-delete)", () => {
    it("sets deletedAt + enabled=false instead of physical delete", async () => {
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.ROOM,
      });
      prisma.askRoomMember.findFirst.mockResolvedValue({
        id: "m-1",
        sessionId: "s-1",
      });
      await service.removeMember("s-1", "m-1", "u-1");
      expect(prisma.askRoomMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "m-1" },
          data: expect.objectContaining({
            enabled: false,
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe("appendUserMessage", () => {
    it("uses next sequenceNum starting from 1 when room is empty", async () => {
      prisma.askMessage.aggregate.mockResolvedValue({
        _max: { sequenceNum: null },
      });
      prisma.askMessage.create.mockResolvedValue({ id: "m" });

      await service.appendUserMessage("s-1", "hi", []);
      expect(prisma.askMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sequenceNum: 1 }),
        }),
      );
    });

    it("increments sequenceNum from current max", async () => {
      prisma.askMessage.aggregate.mockResolvedValue({
        _max: { sequenceNum: 42 },
      });
      prisma.askMessage.create.mockResolvedValue({ id: "m" });

      await service.appendUserMessage("s-1", "hi", []);
      expect(prisma.askMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sequenceNum: 43 }),
        }),
      );
    });

    it("respects minSeq when in-flight events exceed DB max (multi-turn race)", async () => {
      // 2026-05-09 screenshot 48-49："AI 思考显示在问题的上方" 真因 regression。
      // turn 1 流式中：DB MAX=1（仅 user_1），但 in-flight events 已 emit 到 seq=30。
      // turn 2 user msg 必须取 max(dbMax=1, minSeq=30) + 1 = 31，否则 user_2 emit
      // seq=2 会落到 turn 1 events 中间，前端排序错乱。
      prisma.askMessage.aggregate.mockResolvedValue({
        _max: { sequenceNum: 1 },
      });
      prisma.askMessage.create.mockResolvedValue({ id: "m" });

      await service.appendUserMessage("s-1", "hi", [], 30);
      expect(prisma.askMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sequenceNum: 31 }),
        }),
      );
    });

    it("uses dbMax+1 when minSeq is lower than DB max", async () => {
      // minSeq 兜底不得退化常规路径：DB max=42 + minSeq=10 → 应仍是 43 而非 11。
      prisma.askMessage.aggregate.mockResolvedValue({
        _max: { sequenceNum: 42 },
      });
      prisma.askMessage.create.mockResolvedValue({ id: "m" });

      await service.appendUserMessage("s-1", "hi", [], 10);
      expect(prisma.askMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sequenceNum: 43 }),
        }),
      );
    });
  });

  describe("cancelTurn", () => {
    it("is idempotent — already-terminated turn returns current state without throwing", async () => {
      // 2026-05-09（screenshot 42 / "停止按钮无效"）：cancel 改幂等。
      // 之前用户多次点 停止 在 turn 即将完成时会收 4×400 BadRequest；
      // 现在已结束 turn 直接返回 noop。
      prisma.askSession.findFirst.mockResolvedValue({
        id: "s-1",
        userId: "u-1",
        mode: AskSessionMode.ROOM,
      });
      const completedTurn = {
        id: "t-1",
        sessionId: "s-1",
        status: AskTurnStatus.COMPLETED,
      };
      prisma.askRoomTurn.findFirst.mockResolvedValue(completedTurn);
      const result = await service.cancelTurn("s-1", "t-1", "u-1");
      expect(result).toEqual(completedTurn);
      // update 不应被调用
      expect(prisma.askRoomTurn.update).not.toHaveBeenCalled();
    });
  });

  describe("createTurn", () => {
    it("inserts AskRoomTurn with status RUNNING", async () => {
      prisma.askRoomTurn.create.mockResolvedValue({});
      await service.createTurn({
        sessionId: "s-1",
        triggerMessageId: "msg-1",
        mode: AskRoomMode.FREECHAT,
        participantIds: ["m-1"],
      });
      expect(prisma.askRoomTurn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: "s-1",
            triggerMessageId: "msg-1",
            mode: AskRoomMode.FREECHAT,
            status: AskTurnStatus.RUNNING,
          }),
        }),
      );
    });
  });
});
