import { AskRoomRuntimeStateStore } from "../../ai-ask-room-runtime-state.store";

describe("AskRoomRuntimeStateStore", () => {
  it("merges local + cached session max sequence and persists monotonic updates", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;

    const storeA = new AskRoomRuntimeStateStore(cache);
    const storeB = new AskRoomRuntimeStateStore(cache);

    expect(await storeA.getSessionMaxEmittedSeq("s-1")).toBe(0);
    await storeA.recordSessionMaxEmittedSeq("s-1", 12);
    expect(await storeB.getSessionMaxEmittedSeq("s-1")).toBe(12);

    await storeB.recordSessionMaxEmittedSeq("s-1", 5);
    expect(await storeA.getSessionMaxEmittedSeq("s-1")).toBe(12);

    await storeB.recordSessionMaxEmittedSeq("s-1", 18);
    expect(await storeA.getSessionMaxEmittedSeq("s-1")).toBe(18);
  });

  it("shares cancelled turn markers across instances", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;

    const storeA = new AskRoomRuntimeStateStore(cache);
    const storeB = new AskRoomRuntimeStateStore(cache);

    expect(await storeB.isTurnCancelled("turn-1")).toBe(false);
    await storeA.markTurnCancelled("turn-1");
    expect(await storeB.isTurnCancelled("turn-1")).toBe(true);
    await storeB.clearTurn("turn-1");
    expect(await storeA.isTurnCancelled("turn-1")).toBe(false);
  });

  it("uses persisted max watermark to prevent cross-instance seq regression", async () => {
    let persisted = 0;
    const prisma = {
      askRoomSessionRuntimeState: {
        findUnique: jest.fn(async () => ({ maxEmittedSeq: persisted })),
      },
      $queryRaw: jest.fn(
        async (
          _strings: TemplateStringsArray,
          sessionId: string,
          seq: number,
        ) => {
          persisted = Math.max(persisted, seq);
          return [{ max_emitted_seq: persisted, session_id: sessionId }];
        },
      ),
    } as never;

    const storeA = new AskRoomRuntimeStateStore(undefined, prisma);
    const storeB = new AskRoomRuntimeStateStore(undefined, prisma);

    await storeA.recordSessionMaxEmittedSeq("s-atomic", 12);
    await storeB.recordSessionMaxEmittedSeq("s-atomic", 5);
    await storeB.recordSessionMaxEmittedSeq("s-atomic", 18);

    expect(await storeA.getSessionMaxEmittedSeq("s-atomic")).toBe(18);
    expect(await storeB.getSessionMaxEmittedSeq("s-atomic")).toBe(18);
  });

  it("falls back to local state when cache reads fail", async () => {
    const cache = {
      get: jest.fn(async () => {
        throw new Error("cache unavailable");
      }),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => undefined),
    } as never;

    const store = new AskRoomRuntimeStateStore(cache);
    await store.recordSessionMaxEmittedSeq("s-fallback", 9);

    expect(await store.getSessionMaxEmittedSeq("s-fallback")).toBe(9);
    expect(await store.isTurnCancelled("turn-fallback")).toBe(false);
  });

  it("clears local and cached session watermarks", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;

    const store = new AskRoomRuntimeStateStore(cache);
    await store.recordSessionMaxEmittedSeq("s-clear", 14);
    expect(await store.getSessionMaxEmittedSeq("s-clear")).toBe(14);

    await store.clearSession("s-clear");
    expect(await store.getSessionMaxEmittedSeq("s-clear")).toBe(0);
  });
});
