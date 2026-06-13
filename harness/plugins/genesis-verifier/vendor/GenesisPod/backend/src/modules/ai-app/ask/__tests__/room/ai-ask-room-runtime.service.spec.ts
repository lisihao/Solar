import { AskRoomMode, AskTurnStatus } from "@prisma/client";
import { AskRoomRuntimeService } from "../../ai-ask-room-runtime.service";

function makeAdapter() {
  return {
    execute: jest.fn(),
  };
}

describe("AskRoomRuntimeService", () => {
  function makeService() {
    const prisma = {
      askRoomMember: { findMany: jest.fn() },
      askRoomTurn: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      askMessage: { findMany: jest.fn(), create: jest.fn() },
      askSession: { findUniqueOrThrow: jest.fn() },
    };
    const roomService = {
      findUserRoom: jest.fn(),
      appendUserMessage: jest.fn(),
      createTurn: jest.fn(),
      finalizeTurn: jest.fn(),
      cancelTurn: jest.fn(),
      nextSequenceNum: jest.fn(),
    };
    const runtimeStateStore = {
      getSessionMaxEmittedSeq: jest.fn().mockResolvedValue(30),
      warmSessionMaxEmittedSeq: jest.fn().mockResolvedValue(undefined),
      recordSessionMaxEmittedSeq: jest.fn().mockResolvedValue(31),
      markTurnCancelled: jest.fn().mockResolvedValue(undefined),
      isTurnCancelled: jest.fn().mockResolvedValue(false),
      clearTurn: jest.fn().mockResolvedValue(undefined),
    };
    const freechatAdapter = makeAdapter();
    const parallelMergeAdapter = makeAdapter();
    const debateAdapter = makeAdapter();
    const voteAdapter = makeAdapter();
    const reviewAdapter = makeAdapter();
    const handoffAdapter = makeAdapter();

    const service = new AskRoomRuntimeService(
      prisma as never,
      roomService as never,
      runtimeStateStore as never,
      freechatAdapter as never,
      parallelMergeAdapter as never,
      debateAdapter as never,
      voteAdapter as never,
      reviewAdapter as never,
      handoffAdapter as never,
    );

    return {
      service,
      prisma,
      roomService,
      runtimeStateStore,
      freechatAdapter,
    };
  }

  it("uses shared session max emitted seq when appending user message", async () => {
    const { service, roomService, runtimeStateStore, prisma, freechatAdapter } =
      makeService();
    roomService.findUserRoom.mockResolvedValue({
      id: "s-1",
      roomConfig: {},
    });
    prisma.askRoomMember.findMany.mockResolvedValue([
      { id: "m-1", enabled: true, deletedAt: null, role: "LEADER" },
    ]);
    roomService.appendUserMessage.mockResolvedValue({
      id: "msg-1",
      sequenceNum: 31,
    });
    roomService.createTurn.mockResolvedValue({ id: "turn-1" });
    freechatAdapter.execute.mockResolvedValue({ messages: [], metadata: {} });
    prisma.askMessage.findMany.mockResolvedValue([]);
    prisma.askRoomTurn.findUniqueOrThrow.mockResolvedValue({ id: "turn-1" });
    prisma.askSession.findUniqueOrThrow.mockResolvedValue({ id: "s-1" });
    roomService.finalizeTurn.mockResolvedValue(undefined);

    await service.runTurn({
      sessionId: "s-1",
      userId: "u-1",
      dto: { content: "hello" } as never,
      emit: jest.fn(),
    });

    expect(runtimeStateStore.getSessionMaxEmittedSeq).toHaveBeenCalledWith(
      "s-1",
    );
    expect(roomService.appendUserMessage).toHaveBeenCalledWith(
      "s-1",
      "hello",
      [],
      30,
    );
    expect(runtimeStateStore.warmSessionMaxEmittedSeq).toHaveBeenCalledWith(
      "s-1",
      31,
    );
  });

  it("marks cancelled turns in shared runtime state before aborting local controller", async () => {
    const { service, roomService, runtimeStateStore } = makeService();
    roomService.cancelTurn.mockResolvedValue(undefined);

    const controller = new AbortController();
    (service as any).turnAbortControllers.set("turn-1", controller);

    await service.cancelTurn("s-1", "turn-1", "u-1");

    expect(roomService.cancelTurn).toHaveBeenCalledWith("s-1", "turn-1", "u-1");
    expect(runtimeStateStore.markTurnCancelled).toHaveBeenCalledWith("turn-1");
    expect(controller.signal.aborted).toBe(true);
  });

  it("aborts a running adapter when shared cancellation marker appears", async () => {
    jest.useFakeTimers();
    const emit = jest.fn();
    const {
      service,
      prisma,
      roomService,
      runtimeStateStore,
      freechatAdapter,
    } = makeService();
    runtimeStateStore.isTurnCancelled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    prisma.askMessage.findMany.mockResolvedValue([]);
    prisma.askRoomTurn.findUniqueOrThrow.mockResolvedValue({
      id: "turn-1",
      status: AskTurnStatus.RUNNING,
    });
    prisma.askSession.findUniqueOrThrow.mockResolvedValue({ id: "s-1" });
    prisma.askRoomTurn.findUnique.mockResolvedValue({
      status: AskTurnStatus.RUNNING,
    });
    roomService.finalizeTurn.mockResolvedValue(undefined);

    freechatAdapter.execute.mockImplementation(async (ctx: any) => {
      while (!ctx.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("FREECHAT adapter aborted");
    });

    const promise = (service as any).executeAdapterAsync({
      sessionId: "s-1",
      userId: "u-1",
      turnId: "turn-1",
      mode: AskRoomMode.FREECHAT,
      members: [{ id: "m-1", enabled: true, deletedAt: null, role: "LEADER" }],
      participants: [
        { id: "m-1", enabled: true, deletedAt: null, role: "LEADER" },
      ],
      userMessage: { id: "msg-1", sequenceNum: 1, content: "hello" },
      emitContext: { sessionId: "s-1", emit },
    });

    await jest.advanceTimersByTimeAsync(800);
    await promise;

    expect(runtimeStateStore.clearTurn).toHaveBeenCalledWith("turn-1");
    expect(roomService.finalizeTurn).toHaveBeenCalledWith(
      "turn-1",
      AskTurnStatus.CANCELLED,
      expect.objectContaining({
        error: expect.stringContaining("aborted"),
      }),
    );
    expect(
      emit.mock.calls.some(
        ([, event]) =>
          event.kind === "turn.complete" && event.status === "CANCELLED",
      ),
    ).toBe(true);
    jest.useRealTimers();
  });

  it("uses shared cancellation checks frequently but throttles DB fallback polling", async () => {
    jest.useFakeTimers();
    const emit = jest.fn();
    const {
      service,
      prisma,
      roomService,
      runtimeStateStore,
      freechatAdapter,
    } = makeService();
    runtimeStateStore.isTurnCancelled.mockResolvedValue(false);
    prisma.askMessage.findMany.mockResolvedValue([]);
    prisma.askRoomTurn.findUniqueOrThrow.mockResolvedValue({
      id: "turn-2",
      status: AskTurnStatus.RUNNING,
    });
    prisma.askSession.findUniqueOrThrow.mockResolvedValue({ id: "s-1" });
    prisma.askRoomTurn.findUnique.mockResolvedValue({
      status: AskTurnStatus.RUNNING,
    });
    roomService.finalizeTurn.mockResolvedValue(undefined);

    freechatAdapter.execute.mockImplementation(async (ctx: any) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (ctx.signal.aborted) {
        throw new Error("FREECHAT adapter aborted");
      }
      return { messages: [], metadata: {} };
    });

    const promise = (service as any).executeAdapterAsync({
      sessionId: "s-1",
      userId: "u-1",
      turnId: "turn-2",
      mode: AskRoomMode.FREECHAT,
      members: [{ id: "m-1", enabled: true, deletedAt: null, role: "LEADER" }],
      participants: [
        { id: "m-1", enabled: true, deletedAt: null, role: "LEADER" },
      ],
      userMessage: { id: "msg-2", sequenceNum: 1, content: "hello" },
      emitContext: { sessionId: "s-1", emit },
    });

    await jest.advanceTimersByTimeAsync(1600);
    await promise;

    expect(runtimeStateStore.isTurnCancelled).toHaveBeenCalled();
    expect(prisma.askRoomTurn.findUnique).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
